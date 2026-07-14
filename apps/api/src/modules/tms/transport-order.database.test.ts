import { randomUUID } from 'node:crypto';
import { PrismaClient, type TransportOrderType } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import type {
  ReceiveTransportOrderInput,
  ReviewTransportOrderInput,
} from './transport-order.service';
import { TransportOrderService } from './transport-order.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('TMS transport order persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('receives normalized demand and enforces every review transition with immutable facts', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'tms-transport-db-test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const command = () => ({
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      ipAddress: '127.0.0.1',
    });
    const service = new TransportOrderService(prisma as never);
    const input = (
      suffix: string,
      type: TransportOrderType = 'SALES',
    ): ReceiveTransportOrderInput => ({
      carrierRequirementSnapshot: { qualification: 'COLD_CHAIN' },
      chargeResponsibilitySnapshot: {
        payerRef: `CUSTOMER-${suffix}`,
        term: 'PREPAID',
      },
      customerRef: `CUSTOMER-${suffix}`,
      customerSnapshot: { code: `C-${suffix}`, name: '测试客户' },
      deliveryWindowFrom: '2026-07-16T06:00:00.000Z',
      deliveryWindowTo: '2026-07-16T10:00:00.000Z',
      destinationAddressRef: `ADDR-D-${suffix}`,
      destinationAddressSnapshot: {
        city: '上海市',
        countryCode: 'CN',
        line1: '浦东新区测试路 2 号',
      },
      externalOrderNo: `EXT-${suffix}`,
      originAddressRef: `ADDR-O-${suffix}`,
      originAddressSnapshot: {
        city: '苏州市',
        countryCode: 'CN',
        line1: '工业园区测试路 1 号',
      },
      packagingSnapshot: { packageSpecVersion: 'PKG-V1', palletCount: 2 },
      pickupWindowFrom: '2026-07-16T01:00:00.000Z',
      pickupWindowTo: '2026-07-16T03:00:00.000Z',
      prohibitedGoodsSnapshot: { declared: false },
      serviceLevel: 'NEXT_DAY',
      sourceRef: `SO-${suffix}`,
      sourceSnapshot: { lineCount: 2, sourceDomain: 'OMS' },
      sourceType: 'OMS_SALES_ORDER',
      sourceVersion: '1',
      temperatureMax: '8',
      temperatureMin: '2',
      temperatureUom: 'C',
      type,
      vehicleRequirementSnapshot: { refrigerated: true },
      volume: '2.5',
      volumeBase: '2.5',
      volumeUom: 'M3',
      weight: '1200',
      weightBase: '1200',
      weightUom: 'KG',
    });
    const healthy = (expectedVersion: number): ReviewTransportOrderInput => ({
      addressConfirmed: true,
      carrierQualified: true,
      chargeResponsibilityConfirmed: true,
      decision: 'APPROVE',
      expectedVersion,
      prohibitedGoodsDetected: false,
      reason: '全部审核项通过',
      timeWindowFeasible: true,
      vehicleCompatible: true,
    });
    const exception = (
      expectedVersion: number,
      decision: 'FREEZE' | 'RETURN',
    ): ReviewTransportOrderInput => ({
      ...healthy(expectedVersion),
      addressConfirmed: false,
      decision,
      reason: decision === 'FREEZE' ? '地址待主管复核' : '退回来源方修正地址',
    });

    expect(() =>
      service.receive(
        {
          ...input('BAD'),
          originAddressSnapshot: { countryCode: 'CN' },
        },
        context,
        command(),
      ),
    ).toThrow(expect.objectContaining({ code: 'TMS_TRANSPORT_INPUT_INVALID' }));

    const approvedOrder = await service.receive(
      input('APPROVE'),
      context,
      command(),
    );
    const approved = await service.review(
      approvedOrder.transportOrderId,
      healthy(approvedOrder.version),
      context,
      command(),
    );
    expect(approved).toMatchObject({ status: 'PLANNED', version: 2 });
    await expect(
      service.review(
        approvedOrder.transportOrderId,
        healthy(approved.version),
        context,
        command(),
      ),
    ).rejects.toMatchObject({
      code: 'TMS_TRANSPORT_REVIEW_TRANSITION_INVALID',
    });

    const frozenOrder = await service.receive(
      input('FROZEN'),
      context,
      command(),
    );
    const frozen = await service.review(
      frozenOrder.transportOrderId,
      exception(frozenOrder.version, 'FREEZE'),
      context,
      command(),
    );
    expect(frozen.status).toBe('FROZEN');
    const frozenReturned = await service.review(
      frozenOrder.transportOrderId,
      exception(frozen.version, 'RETURN'),
      context,
      command(),
    );
    expect(frozenReturned.status).toBe('RETURNED');
    const returnedApproved = await service.review(
      frozenOrder.transportOrderId,
      healthy(frozenReturned.version),
      context,
      command(),
    );
    expect(returnedApproved.status).toBe('PLANNED');

    const returnedOrder = await service.receive(
      input('RETURNED', 'TRANSFER'),
      context,
      command(),
    );
    const returned = await service.review(
      returnedOrder.transportOrderId,
      exception(returnedOrder.version, 'RETURN'),
      context,
      command(),
    );
    expect(returned.status).toBe('RETURNED');
    const returnedFrozen = await service.review(
      returnedOrder.transportOrderId,
      exception(returned.version, 'FREEZE'),
      context,
      command(),
    );
    expect(returnedFrozen.status).toBe('FROZEN');
    const frozenApproved = await service.review(
      returnedOrder.transportOrderId,
      healthy(returnedFrozen.version),
      context,
      command(),
    );
    expect(frozenApproved.status).toBe('PLANNED');

    expect(() =>
      service.review(
        approvedOrder.transportOrderId,
        { ...healthy(approved.version), addressConfirmed: false },
        context,
        command(),
      ),
    ).toThrow(expect.objectContaining({ code: 'TMS_TRANSPORT_REVIEW_FAILED' }));

    const approvalFact = await prisma.transportOrderApproval.findFirstOrThrow({
      where: { tenantId },
    });
    await expect(
      prisma.transportOrderApproval.update({
        data: { reason: 'attempted mutation' },
        where: { id: approvalFact.id },
      }),
    ).rejects.toBeDefined();
    expect(
      await prisma.platformOutbox.count({
        where: { aggregateType: 'TransportOrder', tenantId },
      }),
    ).toBe(10);
    expect(
      await prisma.platformAuditLog.count({
        where: { resourceType: 'TransportOrder', tenantId },
      }),
    ).toBe(10);
    const page = await service.list(
      { page: '1', pageSize: '2', status: 'PLANNED' },
      context,
    );
    expect(page).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(page.items).toHaveLength(2);
  });
});
