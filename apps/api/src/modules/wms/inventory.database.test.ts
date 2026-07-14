import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { InventoryService } from './inventory.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('WMS inventory balance and TraceChain persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('preserves balance invariants and allows only one concurrent over-reservation', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const ownerId = randomUUID();
    const productId = randomUUID();
    const warehouseId = randomUUID();
    const locationId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'inventory-db-test',
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
    await prisma.product.create({
      data: {
        baseUom: 'EA',
        createdBy: actorId,
        currentVersionNumber: 1,
        id: productId,
        name: '库存并发测试商品',
        sku: `INV-${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.productVersion.create({
      data: {
        createdBy: actorId,
        productId,
        sku: `INV-V-${randomUUID().slice(0, 8)}`,
        snapshot: { baseUom: 'EA' },
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    await prisma.warehouse.create({
      data: {
        code: `WH-${randomUUID().slice(0, 8)}`,
        createdBy: actorId,
        id: warehouseId,
        name: '库存测试仓',
        status: 'ACTIVE',
        tenantId,
        timeZone: 'Asia/Shanghai',
        updatedBy: actorId,
      },
    });
    await prisma.warehouseLocation.create({
      data: {
        code: 'INV-01',
        createdBy: actorId,
        id: locationId,
        name: '库存测试库位',
        status: 'ACTIVE',
        tenantId,
        type: 'LOCATION',
        updatedBy: actorId,
        warehouseId,
      },
    });
    const service = new InventoryService(
      prisma as never,
      new MdmReferenceService(prisma as never),
    );
    const received = await service.receive(
      {
        baseUom: 'EA',
        businessRef: 'OPENING-001',
        businessType: 'OPENING',
        locationId,
        originalUom: 'EA',
        ownerId,
        productId,
        quantityBase: '10',
        quantityOriginal: '10',
        status: 'AVAILABLE',
        warehouseId,
      },
      context,
      command(),
    );
    let balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { id: received.balanceId },
    });
    expect(balance).toMatchObject({ status: 'AVAILABLE', version: 1 });
    expect(balance.onHandBase.toString()).toBe('10');
    expect(balance.availableBase.toString()).toBe('10');

    const held = await service.hold(
      balance.id,
      {
        expectedVersion: balance.version,
        quantityBase: '2',
        quantityOriginal: '2',
        reason: '订单争议',
        requiresApproval: true,
        scopeRef: 'SO-HOLD-001',
        scopeType: 'ORDER',
      },
      context,
      command(),
    );
    expect(held).toMatchObject({ balanceVersion: 2, status: 'ACTIVE' });
    await expect(
      service.releaseHold(
        held.holdId,
        {
          expectedBalanceVersion: held.balanceVersion,
          expectedVersion: held.version,
          reason: '争议解除',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_HOLD_APPROVAL_REQUIRED' });
    const releasedHold = await service.releaseHold(
      held.holdId,
      {
        approvalReference: 'APPROVAL-HOLD-001',
        expectedBalanceVersion: held.balanceVersion,
        expectedVersion: held.version,
        reason: '主管批准解冻',
      },
      context,
      command(),
    );
    expect(releasedHold).toMatchObject({
      balanceVersion: 3,
      status: 'RELEASED',
    });

    const reservations = await Promise.allSettled([
      service.reserve(
        balance.id,
        {
          expectedVersion: releasedHold.balanceVersion,
          quantityBase: '7',
          quantityOriginal: '7',
          sourceRef: 'SO-CONCURRENT-A',
          sourceType: 'ORDER',
        },
        context,
        command(),
      ),
      service.reserve(
        balance.id,
        {
          expectedVersion: releasedHold.balanceVersion,
          quantityBase: '7',
          quantityOriginal: '7',
          sourceRef: 'SO-CONCURRENT-B',
          sourceType: 'ORDER',
        },
        context,
        command(),
      ),
    ]);
    expect(
      reservations.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      reservations.filter(({ status }) => status === 'rejected'),
    ).toHaveLength(1);
    const reserved = reservations.find(
      (result) => result.status === 'fulfilled',
    )!;
    if (reserved.status !== 'fulfilled') throw new Error('reservation missing');
    balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { id: balance.id },
    });
    expect(balance.availableBase.toString()).toBe('3');
    expect(balance.allocatedBase.toString()).toBe('7');
    expect(
      balance.onHandBase
        .sub(balance.allocatedBase)
        .sub(balance.holdBase)
        .toString(),
    ).toBe(balance.availableBase.toString());
    const releasedReservation = await service.releaseReservation(
      reserved.value.reservationId,
      {
        expectedBalanceVersion: balance.version,
        expectedVersion: reserved.value.version,
        reason: '订单取消',
      },
      context,
      command(),
    );
    expect(releasedReservation).toMatchObject({
      balanceVersion: 5,
      status: 'RELEASED',
    });

    const damaged = await service.transitionStatus(
      balance.id,
      {
        expectedVersion: releasedReservation.balanceVersion,
        quantityBase: '2',
        quantityOriginal: '2',
        reason: '发现外观破损',
        targetStatus: 'DAMAGED',
      },
      context,
      command(),
    );
    await expect(
      service.transitionStatus(
        damaged.balanceId,
        {
          approvalReference: 'QA-001',
          expectedVersion: damaged.version,
          quantityBase: '2',
          quantityOriginal: '2',
          reason: '错误跳转',
          targetStatus: 'AVAILABLE',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_STATUS_TRANSITION_INVALID' });
    const disposition = await service.transitionStatus(
      damaged.balanceId,
      {
        expectedVersion: damaged.version,
        quantityBase: '2',
        quantityOriginal: '2',
        reason: '转待处置',
        targetStatus: 'PENDING_DISPOSITION',
      },
      context,
      command(),
    );
    await expect(
      service.transitionStatus(
        disposition.balanceId,
        {
          expectedVersion: disposition.version,
          quantityBase: '2',
          quantityOriginal: '2',
          reason: '无审批放行',
          targetStatus: 'AVAILABLE',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_STATUS_APPROVAL_REQUIRED' });
    const restored = await service.transitionStatus(
      disposition.balanceId,
      {
        approvalReference: 'QA-APPROVAL-002',
        expectedVersion: disposition.version,
        quantityBase: '2',
        quantityOriginal: '2',
        reason: '特采恢复可用',
        targetStatus: 'AVAILABLE',
      },
      context,
      command(),
    );
    expect(restored.balanceId).toBe(balance.id);

    const trace = await service.trace(balance.id, context);
    expect(trace.chainValid).toBe(true);
    expect(trace.movements.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        'RECEIPT',
        'HOLD',
        'RELEASE_HOLD',
        'RESERVE',
        'RELEASE_RESERVATION',
      ]),
    );
    const allowedTransitions = [
      ['AVAILABLE', 'HOLD'],
      ['AVAILABLE', 'DAMAGED'],
      ['AVAILABLE', 'EXPIRED'],
      ['AVAILABLE', 'PENDING_DISPOSITION'],
      ['PENDING_INSPECTION', 'AVAILABLE'],
      ['PENDING_INSPECTION', 'HOLD'],
      ['HOLD', 'AVAILABLE'],
      ['HOLD', 'DAMAGED'],
      ['HOLD', 'EXPIRED'],
      ['HOLD', 'PENDING_DISPOSITION'],
      ['DAMAGED', 'PENDING_DISPOSITION'],
      ['EXPIRED', 'PENDING_DISPOSITION'],
      ['PENDING_DISPOSITION', 'AVAILABLE'],
      ['PENDING_DISPOSITION', 'HOLD'],
    ] as const;
    for (const [fromStatus, targetStatus] of allowedTransitions) {
      const source = await prisma.inventoryBalance.create({
        data: {
          availableBase: fromStatus === 'AVAILABLE' ? '1' : '0',
          availableOriginal: fromStatus === 'AVAILABLE' ? '1' : '0',
          baseUom: 'EA',
          createdBy: actorId,
          handlingUnitId: randomUUID(),
          holdBase: fromStatus === 'AVAILABLE' ? '0' : '1',
          holdOriginal: fromStatus === 'AVAILABLE' ? '0' : '1',
          locationId,
          onHandBase: '1',
          onHandOriginal: '1',
          originalUom: 'EA',
          ownerId,
          productId,
          status: fromStatus,
          tenantId,
          updatedBy: actorId,
          warehouseId,
        },
      });
      await expect(
        service.transitionStatus(
          source.id,
          {
            ...(['DAMAGED', 'EXPIRED', 'PENDING_DISPOSITION'].includes(
              fromStatus,
            ) && targetStatus === 'AVAILABLE'
              ? { approvalReference: `APP-${randomUUID()}` }
              : {}),
            expectedVersion: source.version,
            quantityBase: '1',
            quantityOriginal: '1',
            reason: `${fromStatus} -> ${targetStatus}`,
            targetStatus,
          },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: targetStatus });
    }
    await expect(
      prisma.inventoryMovement.update({
        data: { businessRef: 'MUTATED' },
        where: { id: received.movementId },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.inventoryBalance.update({
        data: { availableBase: '999' },
        where: { id: balance.id },
      }),
    ).rejects.toBeTruthy();
    expect(
      await prisma.platformOutbox.count({
        where: { eventName: 'inventory.changed.v1', tenantId },
      }),
    ).toBeGreaterThan(0);
  });
});
