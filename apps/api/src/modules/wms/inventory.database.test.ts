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

  it('serializes capacity, transfers ownership with double movements, and controls full counts', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const ownerId = randomUUID();
    const targetOwnerId = randomUUID();
    const productId = randomUUID();
    const warehouseId = randomUUID();
    const sourceLocationId = randomUUID();
    const capacityLocationId = randomUUID();
    const transferLocationId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'internal-operations-db-test',
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
        name: '库内作业测试商品',
        sku: `OPS-${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.productVersion.create({
      data: {
        createdBy: actorId,
        productId,
        sku: `OPS-V-${randomUUID().slice(0, 8)}`,
        snapshot: {
          baseUom: 'EA',
          volumePerBase: '0.25',
          weightPerBase: '0.5',
        },
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    await prisma.warehouse.create({
      data: {
        code: `OPS-${randomUUID().slice(0, 8)}`,
        createdBy: actorId,
        id: warehouseId,
        name: '库内作业测试仓',
        status: 'ACTIVE',
        tenantId,
        timeZone: 'Asia/Shanghai',
        updatedBy: actorId,
      },
    });
    await prisma.warehouseLocation.createMany({
      data: [
        {
          code: 'OPS-SOURCE',
          createdBy: actorId,
          id: sourceLocationId,
          name: '移库源位',
          status: 'ACTIVE',
          tenantId,
          type: 'LOCATION',
          updatedBy: actorId,
          warehouseId,
        },
        {
          code: 'OPS-CAPACITY',
          createdBy: actorId,
          id: capacityLocationId,
          mixingRules: {
            allowMixedLots: false,
            allowMixedOwners: false,
            allowMixedProducts: false,
            maxQuantityBase: '10',
          },
          name: '单托容量位',
          palletCapacity: '1',
          status: 'ACTIVE',
          tenantId,
          type: 'LOCATION',
          updatedBy: actorId,
          warehouseId,
        },
        {
          code: 'OPS-TARGET',
          createdBy: actorId,
          id: transferLocationId,
          maxVolume: '100',
          maxWeight: '100',
          name: '普通目标位',
          status: 'ACTIVE',
          tenantId,
          type: 'LOCATION',
          updatedBy: actorId,
          volumeUom: 'M3',
          warehouseId,
          weightUom: 'KG',
        },
      ],
    });
    const service = new InventoryService(
      prisma as never,
      new MdmReferenceService(prisma as never),
    );
    const sources = await Promise.all(
      [randomUUID(), randomUUID()].map((handlingUnitId, index) =>
        service.receive(
          {
            baseUom: 'EA',
            businessRef: `OPS-OPENING-${index + 1}`,
            businessType: 'OPENING',
            handlingUnitId,
            locationId: sourceLocationId,
            originalUom: 'EA',
            ownerId,
            productId,
            quantityBase: '5',
            quantityOriginal: '5',
            status: 'AVAILABLE',
            warehouseId,
          },
          context,
          command(),
        ),
      ),
    );

    const capacityRace = await Promise.allSettled(
      sources.map((source) =>
        service.transfer(
          source.balanceId,
          {
            expectedVersion: 1,
            quantityBase: '1',
            quantityOriginal: '1',
            reason: '并发容量校验',
            targetLocationId: capacityLocationId,
          },
          context,
          command(),
        ),
      ),
    );
    expect(
      capacityRace.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      capacityRace.filter(({ status }) => status === 'rejected'),
    ).toHaveLength(1);
    const failedCapacity = await prisma.capacityCheck.findFirstOrThrow({
      where: { allowed: false, locationId: capacityLocationId, tenantId },
    });
    expect(failedCapacity.exclusionReasons).toContain(
      'PALLET_CAPACITY_EXCEEDED',
    );
    const successfulIndex = capacityRace.findIndex(
      ({ status }) => status === 'fulfilled',
    );
    const movedSource = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { id: sources[successfulIndex]!.balanceId },
    });
    const transfer = await service.transfer(
      movedSource.id,
      {
        expectedVersion: movedSource.version,
        quantityBase: '1',
        quantityOriginal: '1',
        reason: '部分数量移库',
        targetLocationId: transferLocationId,
      },
      context,
      command(),
    );
    expect(transfer).toMatchObject({ sourceVersion: movedSource.version + 1 });
    const task = await prisma.inventoryTransferTask.findUniqueOrThrow({
      where: { id: transfer.transferId },
    });
    expect(task).toMatchObject({
      sourceLocationId,
      targetLocationId: transferLocationId,
    });
    await expect(
      prisma.inventoryTransferTask.update({
        data: { reason: '篡改事实' },
        where: { id: task.id },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.capacityCheck.update({
        data: { allowed: true },
        where: { id: failedCapacity.id },
      }),
    ).rejects.toBeTruthy();

    await expect(
      service.transferOwnership(
        transfer.targetBalanceId,
        {
          approvalReference: '',
          contractReference: 'CONTRACT-OPS-001',
          expectedVersion: transfer.targetVersion,
          quantityBase: '1',
          quantityOriginal: '1',
          reason: '缺少审批',
          targetOwnerId,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({
      code: 'OWNERSHIP_TRANSFER_AUTHORIZATION_REQUIRED',
      statusCode: 403,
    });
    const ownership = await service.transferOwnership(
      transfer.targetBalanceId,
      {
        approvalReference: 'APPROVAL-OWN-001',
        chargeFactSnapshot: { currency: 'CNY', unitPrice: '2.5' },
        contractReference: 'CONTRACT-OPS-001',
        expectedVersion: transfer.targetVersion,
        quantityBase: '1',
        quantityOriginal: '1',
        reason: '合同授权货权变更',
        targetOwnerId,
      },
      context,
      command(),
    );
    const ownershipFact = await prisma.ownershipTransfer.findUniqueOrThrow({
      where: { id: ownership.transferId },
    });
    expect(ownershipFact).toMatchObject({
      fromOwnerId: ownerId,
      toOwnerId: targetOwnerId,
    });
    expect(
      await prisma.inventoryMovement.findMany({
        orderBy: { createdAt: 'asc' },
        select: { type: true },
        where: {
          id: {
            in: [
              ownershipFact.outboundMovementId,
              ownershipFact.inboundMovementId,
            ],
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        { type: 'OWNERSHIP_OUT' },
        { type: 'OWNERSHIP_IN' },
      ]),
    );
    await expect(
      prisma.ownershipTransfer.update({
        data: { approvalReference: 'MUTATED' },
        where: { id: ownershipFact.id },
      }),
    ).rejects.toBeTruthy();

    const planned = await service.createCount(
      {
        blind: true,
        freezeInventory: true,
        type: 'FULL',
        warehouseId,
      },
      context,
      command(),
    );
    expect(planned).toMatchObject({ frozen: true, status: 'PLANNED' });
    let count = await service.getCount(planned.countId, context);
    expect(count.lines).toHaveLength(planned.lineCount);
    expect(count.freezes.every(({ status }) => status === 'ACTIVE')).toBe(true);
    await expect(
      service.transitionCount(
        planned.countId,
        { expectedVersion: planned.version, targetStatus: 'REVIEWING' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_COUNT_TRANSITION_INVALID' });
    const counting = await service.transitionCount(
      planned.countId,
      { expectedVersion: planned.version, targetStatus: 'COUNTING' },
      context,
      command(),
    );
    const varianceLine = count.lines[0]!;
    for (const line of count.lines) {
      const quantity =
        line.id === varianceLine.id
          ? line.expectedQuantityBase.sub(1)
          : line.expectedQuantityBase;
      await service.countLine(
        line.id,
        {
          expectedVersion: line.version,
          quantityBase: quantity.toString(),
          quantityOriginal: quantity.toString(),
          ...(line.id === varianceLine.id ? { reason: '初盘短少一件' } : {}),
        },
        context,
        command(),
      );
    }
    const recounted = await service.countLine(
      varianceLine.id,
      {
        expectedVersion: varianceLine.version + 1,
        quantityBase: varianceLine.expectedQuantityBase.sub(1).toString(),
        quantityOriginal: varianceLine.expectedQuantityOriginal
          .sub(1)
          .toString(),
        reason: '复盘确认短少一件',
      },
      context,
      command(),
    );
    const reviewing = await service.transitionCount(
      planned.countId,
      { expectedVersion: counting.version, targetStatus: 'REVIEWING' },
      context,
      command(),
    );
    await expect(
      service.transitionCount(
        planned.countId,
        { expectedVersion: reviewing.version, targetStatus: 'POSTED' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_COUNT_VARIANCE_UNAPPROVED' });
    await service.approveCountLine(
      varianceLine.id,
      {
        approvalReference: 'COUNT-APPROVAL-001',
        expectedVersion: recounted.version,
        quantityBase: varianceLine.expectedQuantityBase.sub(1).toString(),
        quantityOriginal: varianceLine.expectedQuantityOriginal
          .sub(1)
          .toString(),
        reason: '主管批准盘亏差异',
      },
      context,
      command(),
    );
    const posted = await service.transitionCount(
      planned.countId,
      { expectedVersion: reviewing.version, targetStatus: 'POSTED' },
      context,
      command(),
    );
    await expect(
      service.transitionCount(
        planned.countId,
        { expectedVersion: posted.version, targetStatus: 'CLOSED' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_COUNT_FREEZE_ACTIVE' });
    count = await service.getCount(planned.countId, context);
    for (const locationId of [
      ...new Set(
        count.freezes
          .filter(({ status }) => status === 'ACTIVE')
          .map(({ locationId }) => locationId),
      ),
    ])
      await service.releaseCountSegment(
        planned.countId,
        { locationId, reason: '区域复核完成，分段解冻' },
        context,
        command(),
      );
    await expect(
      service.transitionCount(
        planned.countId,
        { expectedVersion: posted.version, targetStatus: 'CLOSED' },
        context,
        command(),
      ),
    ).resolves.toMatchObject({ status: 'CLOSED' });

    const cycleBalance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { onHandBase: { gt: 0 }, tenantId, warehouseId },
    });
    await expect(
      service.createCount(
        {
          balanceIds: [cycleBalance.id],
          blind: false,
          freezeInventory: false,
          type: 'CYCLE',
          warehouseId,
        },
        context,
        command(),
      ),
    ).resolves.toMatchObject({ frozen: false, lineCount: 1 });
  });
});
