import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { IdempotencyService } from '../platform/idempotency.service';
import { ProductService } from './product.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('product and package persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('preserves snapshots, scoped barcodes, decimal quantities, tenant isolation and idempotency', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'mdm-database-test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const otherContext: TenantContext = { ...context, tenantId: randomUUID() };
    const command = (key = randomUUID()) => ({
      correlationId: randomUUID(),
      idempotencyKey: key,
      ipAddress: '127.0.0.1',
    });
    const service = new ProductService(
      new IdempotencyService(prisma as never),
      prisma as never,
    );
    try {
      const category = await service.createCategory(
        { code: 'FOOD', name: '食品' },
        context,
        command(),
      );
      const productInput = {
        baseUom: 'EA',
        batchControl: 'REQUIRED' as const,
        categoryId: category.categoryId,
        minimumRemainingDays: 30,
        name: '测试商品',
        shelfLifeDays: 365,
        sku: `SKU-${randomUUID().slice(0, 8).toUpperCase()}`,
        temperatureZone: 'AMBIENT' as const,
      };
      const createKey = randomUUID();
      const created = await service.saveProduct(
        undefined,
        productInput,
        context,
        command(createKey),
      );
      const replayed = await service.saveProduct(
        undefined,
        productInput,
        context,
        command(createKey),
      );
      expect(replayed).toEqual(created);
      await expect(
        service.saveProduct(
          undefined,
          { ...productInput, name: '异内容' },
          context,
          command(createKey),
        ),
      ).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        statusCode: 409,
      });

      const each = await service.savePackageSpec(
        {
          baseUom: 'EA',
          code: 'EACH',
          level: 'EACH',
          name: '单件',
          originalUom: 'EA',
          productId: created.productId,
          quantityInBase: '1',
        },
        context,
        command(),
      );
      const carton = await service.savePackageSpec(
        {
          baseUom: 'EA',
          code: 'CASE',
          grossWeight: '4.125',
          level: 'CASE',
          name: '整箱',
          originalUom: 'CASE',
          productId: created.productId,
          quantityInBase: '12.5',
          weightUom: 'KG',
        },
        context,
        command(),
      );
      await service.addBarcode(
        {
          barcode: `690${Date.now()}`,
          isPrimary: true,
          packageSpecId: each.packageSpecId,
          productId: created.productId,
          type: 'EAN',
        },
        context,
        command(),
      );
      const barcodeValue = `CUST-${randomUUID()}`;
      const customerId = randomUUID();
      await service.addBarcode(
        {
          barcode: barcodeValue,
          customerId,
          packageSpecId: carton.packageSpecId,
          productId: created.productId,
          type: 'CUSTOMER',
        },
        context,
        command(),
      );
      await expect(
        service.addBarcode(
          {
            barcode: barcodeValue,
            customerId,
            productId: created.productId,
            type: 'CUSTOMER',
          },
          context,
          command(),
        ),
      ).rejects.toMatchObject({
        code: 'PRODUCT_BARCODE_CONFLICT',
        statusCode: 409,
      });

      const published = await service.publishProduct(
        created.productId,
        { expectedVersion: created.version },
        context,
        command(),
      );
      expect(published).toMatchObject({ productVersion: 1, status: 'ACTIVE' });
      await expect(
        service.convert(carton.packageSpecId, { amount: '2.4' }, context),
      ).resolves.toMatchObject({
        baseAmount: '30',
        originalAmount: '2.4',
        packageSpecId: carton.packageSpecId,
        packageSpecVersion: 1,
      });
      await expect(
        service.getProduct(created.productId, otherContext),
      ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND', statusCode: 404 });
      await expect(
        service.resolveBarcode(barcodeValue, customerId, context),
      ).resolves.toMatchObject({
        product: { id: created.productId },
        packageSpec: { id: carton.packageSpecId },
      });

      const updated = await service.saveProduct(
        created.productId,
        {
          ...productInput,
          expectedVersion: published.version,
          name: '测试商品新版',
        },
        context,
        command(),
      );
      const republished = await service.publishProduct(
        created.productId,
        { expectedVersion: updated.version },
        context,
        command(),
      );
      expect(republished.productVersion).toBe(2);
      const snapshots = await prisma.productVersion.findMany({
        orderBy: { versionNumber: 'asc' },
        where: { productId: created.productId, tenantId },
      });
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]?.snapshot).toMatchObject({ name: '测试商品' });
      expect(snapshots[1]?.snapshot).toMatchObject({ name: '测试商品新版' });
      await expect(
        prisma.productVersion.update({
          data: { sku: 'MUTATED' },
          where: { id: snapshots[0]!.id },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.packageSpec.update({
          data: { quantityInBase: '99' },
          where: { id: carton.packageSpecId },
        }),
      ).rejects.toThrow();

      const inactivated = await service.deactivateProduct(
        created.productId,
        { expectedVersion: republished.version },
        context,
        command(),
      );
      expect(inactivated.status).toBe('INACTIVE');
      await expect(
        service.deactivateProduct(
          created.productId,
          { expectedVersion: inactivated.version },
          context,
          command(),
        ),
      ).rejects.toMatchObject({
        code: 'PRODUCT_TRANSITION_INVALID',
        statusCode: 409,
      });
      expect(
        await prisma.platformAuditLog.count({
          where: { resourceType: 'Product', tenantId },
        }),
      ).toBeGreaterThanOrEqual(4);
      expect(
        await prisma.platformOutbox.count({
          where: { aggregateType: 'Product', tenantId },
        }),
      ).toBeGreaterThanOrEqual(4);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "mdm"."product_version" DISABLE TRIGGER product_version_immutable',
      );
      await prisma.productVersion.deleteMany({ where: { tenantId } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "mdm"."product_version" ENABLE TRIGGER product_version_immutable',
      );
      await prisma.productBarcode.deleteMany({ where: { tenantId } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "mdm"."package_spec" DISABLE TRIGGER package_spec_published_immutable',
      );
      await prisma.packageSpec.deleteMany({ where: { tenantId } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "mdm"."package_spec" ENABLE TRIGGER package_spec_published_immutable',
      );
      await prisma.product.deleteMany({ where: { tenantId } });
      await prisma.productCategory.deleteMany({ where: { tenantId } });
      // AuditLog and its derived ChangeHistory are immutable business facts. Keep
      // the random-tenant rows instead of globally toggling platform triggers,
      // which would race with other database tests running in parallel.
      await prisma.platformOutbox.deleteMany({ where: { tenantId } });
      await prisma.idempotencyRecord.deleteMany({ where: { tenantId } });
    }
  });
});
