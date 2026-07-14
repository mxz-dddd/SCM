import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { PartnerService } from '../mdm/partner.service';
import { ProductService } from '../mdm/product.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { OrderIntakeService, type SaveOrderInput } from './order-intake.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('multi-channel order intake persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('preserves raw input, versions, duplicate cases and validated quantity snapshots', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'order-intake-db-test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const command = (key = randomUUID()) => ({
      correlationId: randomUUID(),
      idempotencyKey: key,
      ipAddress: '127.0.0.1',
    });
    const idempotency = new IdempotencyService(prisma as never);
    const partners = new PartnerService(idempotency, prisma as never);
    const products = new ProductService(idempotency, prisma as never);
    const references = new MdmReferenceService(prisma as never);
    const orders = new OrderIntakeService(references, prisma as never);

    const partner = await partners.save(
      undefined,
      { code: `CUS-${randomUUID().slice(0, 8)}`, legalName: '订单客户' },
      context,
      command(),
    );
    await partners.addRole(
      { partnerId: partner.partnerId, roleType: 'CUSTOMER' },
      context,
      command(),
    );
    await partners.transition(
      partner.partnerId,
      'ACTIVE',
      { expectedVersion: partner.version },
      context,
      command(),
    );
    const address = await partners.saveAddress(
      {
        addressType: 'DELIVERY',
        city: '上海',
        code: 'SHIP-TO',
        countryCode: 'CN',
        partnerId: partner.partnerId,
        rawText: '上海市测试路 1 号',
      },
      context,
      command(),
    );
    await partners.geocode(
      address.addressId,
      {
        expectedVersion: address.version,
        latitude: '31.23040000',
        longitude: '121.47370000',
        provider: 'TEST',
        targetStatus: 'VERIFIED',
      },
      context,
      command(),
    );
    const pendingAddress = await partners.saveAddress(
      {
        addressType: 'DELIVERY',
        code: 'PENDING-SHIP-TO',
        countryCode: 'CN',
        partnerId: partner.partnerId,
        rawText: '待地理校验地址',
      },
      context,
      command(),
    );

    const product = await products.saveProduct(
      undefined,
      { baseUom: 'EA', name: '订单测试商品', sku: `SKU-${randomUUID().slice(0, 8)}` },
      context,
      command(),
    );
    await products.savePackageSpec(
      {
        baseUom: 'EA',
        code: 'EA',
        level: 'EACH',
        name: '单件',
        originalUom: 'EA',
        productId: product.productId,
        quantityInBase: '1',
      },
      context,
      command(),
    );
    const casePackage = await products.savePackageSpec(
      {
        baseUom: 'EA',
        code: 'CASE',
        level: 'CASE',
        name: '箱',
        originalUom: 'CASE',
        productId: product.productId,
        quantityInBase: '12',
      },
      context,
      command(),
    );
    await products.publishProduct(
      product.productId,
      { expectedVersion: product.version },
      context,
      command(),
    );

    const externalOrderNo = `SO-${randomUUID().slice(0, 8)}`;
    const validInput: SaveOrderInput = {
      channel: 'API',
      customerId: partner.partnerId,
      deliveryAddressId: address.addressId,
      extensions: { salesOrg: 'CN01' },
      externalOrderNo,
      externalVersion: '1',
      lines: [
        {
          lineNo: 1,
          packageSpecId: casePackage.packageSpecId,
          productId: product.productId,
          quantity: '2',
          uom: 'CASE',
        },
      ],
      mappingVersion: 'erp-order-v1',
      rawPayload: { externalOrderNo, revision: 1 },
      requestedFrom: '2026-07-15T01:00:00.000Z',
      requestedUntil: '2026-07-15T09:00:00.000Z',
      requiredExtensionFields: ['salesOrg'],
      type: 'SALES',
    };
    const draft = await orders.create(validInput, context, command());
    expect(draft).toMatchObject({ replayed: false, status: 'DRAFT', version: 1 });
    await expect(orders.create(validInput, context, command())).resolves.toMatchObject({
      orderId: draft.orderId,
      replayed: true,
    });
    await expect(
      orders.create(
        { ...validInput, rawPayload: { externalOrderNo, revision: 2 } },
        context,
        command(),
      ),
    ).rejects.toMatchObject({
      code: 'ORDER_EXTERNAL_CONTENT_CONFLICT',
      statusCode: 409,
    });
    expect(
      await prisma.duplicateCase.count({
        where: { businessOrderId: draft.orderId, tenantId },
      }),
    ).toBe(1);

    const opened = await orders.submit(
      draft.orderId,
      { expectedVersion: draft.version },
      false,
      context,
      command(),
    );
    expect(opened).toMatchObject({ accepted: true, status: 'OPEN', version: 2 });
    const convertedLine = await prisma.businessOrderLine.findFirstOrThrow({
      where: { orderId: draft.orderId, status: 'ACTIVE', tenantId },
    });
    expect(convertedLine.quantityOriginal?.toString()).toBe('2');
    expect(convertedLine.quantityBase?.toString()).toBe('24');
    expect(convertedLine.baseUom).toBe('EA');
    expect(convertedLine.packageSpecVersion).toBe(casePackage.versionNumber);
    await expect(
      orders.submit(
        draft.orderId,
        { expectedVersion: opened.version },
        false,
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_MUTABLE', statusCode: 409 });

    const warningExternalNo = `WARN-${randomUUID().slice(0, 8)}`;
    const warningDraft = await orders.create(
      {
        ...validInput,
        deliveryAddressId: pendingAddress.addressId,
        externalOrderNo: warningExternalNo,
        rawPayload: { externalOrderNo: warningExternalNo },
      },
      context,
      command(),
    );
    const warningBlocked = await orders.submit(
      warningDraft.orderId,
      { expectedVersion: warningDraft.version },
      false,
      context,
      command(),
    );
    expect(warningBlocked).toMatchObject({
      accepted: false,
      fieldErrors: [],
      status: 'INVALID',
    });
    expect(warningBlocked.warnings).toHaveLength(1);
    await expect(
      orders.submit(
        warningDraft.orderId,
        { expectedVersion: warningBlocked.version },
        true,
        context,
        command(),
      ),
    ).resolves.toMatchObject({ accepted: true, status: 'OPEN' });

    const invalidExternalNo = `FILE-${randomUUID().slice(0, 8)}`;
    const incomplete = await orders.create(
      {
        channel: 'FILE',
        externalOrderNo: invalidExternalNo,
        lines: [{ lineNo: 1, quantity: 'not-a-number' }],
        mappingVersion: 'file-v1',
        rawPayload: { externalOrderNo: invalidExternalNo },
        requestedFrom: '2026-07-16T09:00:00.000Z',
        requestedUntil: '2026-07-16T01:00:00.000Z',
        type: 'SALES',
      },
      context,
      command(),
    );
    const invalid = await orders.submit(
      incomplete.orderId,
      { expectedVersion: incomplete.version },
      false,
      context,
      command(),
    );
    expect(invalid.status).toBe('INVALID');
    expect(invalid.fieldErrors.map(({ field }) => field)).toEqual(
      expect.arrayContaining([
        'customerId',
        'deliveryAddressId',
        'requestedUntil',
        'lines[0].productId',
        'lines[0].quantity',
      ]),
    );
    await expect(
      orders.update(
        incomplete.orderId,
        { ...validInput, expectedVersion: 1, externalOrderNo: invalidExternalNo },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'ORDER_VERSION_CONFLICT', statusCode: 409 });
    const corrected = await orders.update(
      incomplete.orderId,
      {
        ...validInput,
        expectedVersion: invalid.version,
        externalOrderNo: invalidExternalNo,
        rawPayload: { externalOrderNo: invalidExternalNo, corrected: true },
      },
      context,
      command(),
    );
    expect(corrected).toMatchObject({ status: 'INVALID', version: 3 });
    await expect(
      orders.submit(
        incomplete.orderId,
        { expectedVersion: corrected.version },
        false,
        context,
        command(),
      ),
    ).resolves.toMatchObject({ accepted: true, status: 'OPEN', version: 4 });
    expect(
      await prisma.changeSet.count({
        where: { businessOrderId: incomplete.orderId, tenantId },
      }),
    ).toBe(3);
    const version = await prisma.orderVersion.findFirstOrThrow({
      where: { businessOrderId: draft.orderId, tenantId, versionNumber: 1 },
    });
    await expect(
      prisma.orderVersion.update({
        data: { changeReason: 'MUTATED' },
        where: { id: version.id },
      }),
    ).rejects.toThrow();
  });
});
