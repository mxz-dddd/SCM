import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { InventoryService } from './inventory.service';
import { OutboundService } from './outbound.service';
import { PickService } from './pick.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('WMS outbound planning and allocation persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('simulates waves, prevents concurrent over-allocation and resolves shortages', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const ownerId = randomUUID();
    const productId = randomUUID();
    const warehouseId = randomUUID();
    const locationId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'outbound-db-test',
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
        name: '出库分配测试商品',
        sku: `OUT-${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.productVersion.create({
      data: {
        createdBy: actorId,
        productId,
        sku: `OUT-V-${randomUUID().slice(0, 8)}`,
        snapshot: { baseUom: 'EA' },
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    await prisma.warehouse.create({
      data: {
        code: `OUT-${randomUUID().slice(0, 8)}`,
        createdBy: actorId,
        id: warehouseId,
        name: '出库分配测试仓',
        status: 'ACTIVE',
        tenantId,
        timeZone: 'Asia/Shanghai',
        updatedBy: actorId,
      },
    });
    await prisma.warehouseLocation.create({
      data: {
        code: 'OUT-01',
        createdBy: actorId,
        id: locationId,
        name: '出库储位',
        status: 'ACTIVE',
        tenantId,
        type: 'LOCATION',
        updatedBy: actorId,
        warehouseId,
      },
    });
    const mdm = new MdmReferenceService(prisma as never);
    const inventory = new InventoryService(prisma as never, mdm);
    const service = new OutboundService(prisma as never, mdm, inventory);
    const picking = new PickService(prisma as never, mdm);
    const stock = await inventory.receive(
      {
        baseUom: 'EA',
        businessRef: 'OUTBOUND-OPENING',
        businessType: 'OPENING',
        handlingUnitId: randomUUID(),
        locationId,
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
    );
    await expect(
      service.createOutbound(
        {
          cutoffAt: new Date(Date.now() + 3_600_000).toISOString(),
          destinationSnapshot: {},
          lines: [],
          ownerId,
          serviceLevel: 'NEXT_DAY',
          sourceRef: 'OMS-INVALID',
          type: 'SALES',
          warehouseId,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'OUTBOUND_INPUT_INVALID' });
    const orders = await Promise.all(
      [1, 2].map((index) =>
        service.createOutbound(
          {
            carrierMode: 'ROAD',
            cutoffAt: new Date(Date.now() + 3_600_000).toISOString(),
            destinationSnapshot: {
              address: `测试目的地 ${index}`,
              countryCode: 'CN',
            },
            lines: [
              {
                baseUom: 'EA',
                lineNo: 1,
                originalUom: 'EA',
                productId,
                quantityBase: '4',
                quantityOriginal: '4',
              },
            ],
            ownerId,
            routeCode: 'R-01',
            serviceLevel: 'NEXT_DAY',
            sourceRef: `OMS-OUT-${index}`,
            temperatureZone: 'AMBIENT',
            type: 'SALES',
            warehouseId,
          },
          context,
          command(),
        ),
      ),
    );
    for (const order of orders)
      await expect(
        service.releaseOutbound(
          order.outboundId,
          { expectedVersion: order.version },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'RELEASED' });
    const template = await service.saveWaveTemplate(
      {
        capacitySnapshot: {
          maxLines: 10,
          maxOrders: 10,
          maxQuantityBase: '100',
        },
        criteria: {
          carrierMode: 'ROAD',
          orderType: 'SALES',
          routeCode: 'R-01',
          temperatureZone: 'AMBIENT',
        },
        name: '道路常温波次',
        strategy: {
          issueMethod: 'FEFO',
          minimumSplits: true,
          wholeHandlingUnitFirst: true,
        },
        warehouseId,
        workloadFactors: { perBase: '0.1', perLine: '1', perOrder: '2' },
      },
      context,
      command(),
    );
    await expect(
      service.simulateWave(template.templateId, context),
    ).resolves.toMatchObject({
      lineCount: 2,
      orderCount: 2,
      quantityBase: '8',
    });
    const waves = await Promise.all(
      orders.map((order) =>
        service.createWave(
          {
            cutoffAt: new Date(Date.now() + 2_000_000).toISOString(),
            orderIds: [order.outboundId],
            templateId: template.templateId,
          },
          context,
          command(),
        ),
      ),
    );
    await expect(
      service.transitionWave(
        waves[0]!.waveId,
        { expectedVersion: waves[0]!.version, targetStatus: 'RELEASED' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'WAVE_TRANSITION_INVALID' });
    const planned = await Promise.all(
      waves.map((wave) =>
        service.transitionWave(
          wave.waveId,
          { expectedVersion: wave.version, targetStatus: 'PLANNED' },
          context,
          command(),
        ),
      ),
    );
    const released = await Promise.all(
      waves.map((wave, index) =>
        service.transitionWave(
          wave.waveId,
          {
            expectedVersion: planned[index]!.version,
            targetStatus: 'RELEASED',
          },
          context,
          command(),
        ),
      ),
    );
    expect(released.every(({ status }) => status === 'RELEASED')).toBe(true);
    const allocationTotal = await prisma.outboundAllocation.aggregate({
      _sum: { quantityBase: true },
      where: { tenantId },
    });
    expect(allocationTotal._sum.quantityBase?.lessThanOrEqualTo(5)).toBe(true);
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { id: stock.balanceId },
    });
    expect(balance.allocatedBase.toString()).toBe(
      allocationTotal._sum.quantityBase?.toString(),
    );
    expect(balance.availableBase.add(balance.allocatedBase).toString()).toBe(
      '5',
    );
    const lines = await prisma.outboundLine.findMany({ where: { tenantId } });
    expect(
      lines
        .reduce(
          (sum, line) => sum.add(line.allocatedBase).add(line.shortageBase),
          balance.onHandBase.mul(0),
        )
        .toString(),
    ).toBe('8');
    const shortages = await prisma.outboundShortageCase.findMany({
      where: { status: 'OPEN', tenantId },
    });
    expect(shortages.length).toBeGreaterThan(0);
    for (const shortage of shortages)
      await service.resolveShortage(
        shortage.id,
        {
          expectedVersion: shortage.version,
          resolutionSnapshot: {
            approvedShortShipBase: shortage.shortageBase.toString(),
          },
          type: 'SHORT_SHIP',
        },
        context,
        command(),
      );
    for (const [index, wave] of waves.entries())
      await expect(
        service.transitionWave(
          wave.waveId,
          {
            expectedVersion: released[index]!.version,
            targetStatus: 'COMPLETED',
          },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
    const allocation = await prisma.outboundAllocation.findFirstOrThrow({
      where: { tenantId },
    });
    expect(allocation.strategyTrace).toMatchObject({
      strategy: expect.objectContaining({ issueMethod: 'FEFO' }),
      templateVersion: 1,
    });
    await expect(
      prisma.outboundAllocation.update({
        data: { quantityBase: '999' },
        where: { id: allocation.id },
      }),
    ).rejects.toBeTruthy();
    expect(
      await prisma.platformOutbox.count({
        where: { eventName: 'outbound.shortage-resolved.v1', tenantId },
      }),
    ).toBe(shortages.length);

    const pickLines = await prisma.pickTaskLine.findMany({
      where: { tenantId },
    });
    expect(pickLines.length).toBeGreaterThan(0);
    const selectedLine = [...pickLines].sort((left, right) =>
      right.requiredBase.comparedTo(left.requiredBase),
    )[0]!;
    expect(selectedLine.requiredBase.greaterThan(1)).toBe(true);
    const selectedTask = await prisma.pickTask.findUniqueOrThrow({
      where: { id: selectedLine.taskId },
    });
    expect(selectedTask.mode).toBe('ORDER');
    expect(
      await prisma.pickRouteVersion.count({
        where: { taskId: selectedTask.id, tenantId },
      }),
    ).toBe(1);
    const assigned = await picking.assignTask(
      selectedTask.id,
      {
        assigneeId: actorId,
        containerCode: 'TOTE-P2-19',
        expectedVersion: selectedTask.version,
      },
      context,
      command(),
    );
    const replanned = await picking.replanRoute(
      selectedTask.id,
      {
        aisleDirection: 'REVERSE',
        congestionSnapshot: { [selectedLine.sourceLocationId]: 2 },
        expectedVersion: assigned.version,
      },
      context,
      command(),
    );
    expect(replanned.routeVersion).toBe(2);
    expect(
      await prisma.pickRouteVersion.count({
        where: { taskId: selectedTask.id, tenantId },
      }),
    ).toBe(2);
    const started = await picking.startTask(
      selectedTask.id,
      { expectedVersion: replanned.version },
      context,
      command(),
    );
    expect(started.status).toBe('IN_PROGRESS');
    const wrongScan = {
      deviceId: 'RF-P2-19',
      deviceSequence: '1',
      ...(selectedLine.handlingUnitId
        ? { handlingUnitId: selectedLine.handlingUnitId }
        : {}),
      productId: selectedLine.productId,
      quantityBase: '1',
      scannedAt: new Date().toISOString(),
      sourceLocationId: randomUUID(),
      targetContainerCode: 'TOTE-P2-19',
      taskLineId: selectedLine.id,
    };
    await expect(
      picking.scan(selectedTask.id, wrongScan, context, command()),
    ).rejects.toMatchObject({ code: 'PICK_SOURCE_LOCATION_MISMATCH' });
    expect(
      await prisma.pickScanEvent.count({
        where: { outcome: 'REJECTED', tenantId },
      }),
    ).toBe(1);
    await expect(
      picking.scan(selectedTask.id, wrongScan, context, command()),
    ).rejects.toMatchObject({ code: 'PICK_SOURCE_LOCATION_MISMATCH' });
    await expect(
      picking.scan(
        selectedTask.id,
        { ...wrongScan, productId: randomUUID() },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'PICK_DEVICE_SEQUENCE_CONFLICT' });
    const pickedQuantity = selectedLine.requiredBase.sub(1).toString();
    const acceptedScan = {
      ...wrongScan,
      deviceSequence: '2',
      productId: selectedLine.productId,
      quantityBase: pickedQuantity,
      sourceLocationId: selectedLine.sourceLocationId,
    };
    const accepted = await picking.scan(
      selectedTask.id,
      acceptedScan,
      context,
      command(),
    );
    expect(accepted.outcome).toBe('ACCEPTED');
    await expect(
      picking.scan(selectedTask.id, acceptedScan, context, command()),
    ).resolves.toMatchObject({
      confirmationId: accepted.confirmationId,
      replayed: true,
    });
    const afterPickLine = await prisma.pickTaskLine.findUniqueOrThrow({
      where: { id: selectedLine.id },
    });
    expect(() =>
      picking.shortPick(
        selectedLine.id,
        {
          expectedLineVersion: afterPickLine.version,
          reason: '',
          reasonCode: '',
          shortBase: '1',
        },
        context,
        command(),
      ),
    ).toThrow('Short-pick reason code and explanation are required');
    const short = await picking.shortPick(
      selectedLine.id,
      {
        expectedLineVersion: afterPickLine.version,
        reason: '储位实物短少',
        reasonCode: 'LOCATION_SHORT',
        shortBase: '1',
      },
      context,
      command(),
    );
    expect(short.status).toBe('OPEN');
    const resolvedShort = await picking.resolveShortPick(
      short.shortPickId,
      {
        expectedVersion: short.version,
        resolutionSnapshot: { approvedBy: actorId, action: 'short ship' },
        type: 'SHORT_SHIP',
      },
      context,
      command(),
    );
    expect(resolvedShort.taskStatus).toBe('REVIEWING');
    const actualLines = [
      {
        productId: selectedLine.productId,
        quantityBase: pickedQuantity,
        taskLineId: selectedLine.id,
      },
    ];
    const failed = await picking.verifyTask(
      selectedTask.id,
      {
        actualSnapshot: { containerCode: 'WRONG-TOTE', lines: actualLines },
        expectedVersion: resolvedShort.taskVersion,
        scopeRef: 'TOTE-P2-19',
        scopeType: 'CONTAINER',
      },
      context,
      command(),
    );
    expect(failed.status).toBe('FAILED');
    const correction = await picking.correctVerification(
      failed.verificationId,
      {
        actualSnapshot: { action: 'returned wrong container' },
        correctionType: 'RETURN',
      },
      context,
      command(),
    );
    expect(correction.status).toBe('CORRECTED');
    const passed = await picking.verifyTask(
      selectedTask.id,
      {
        actualSnapshot: {
          containerCode: 'TOTE-P2-19',
          lines: actualLines,
        },
        expectedVersion: failed.taskVersion,
        scopeRef: 'TOTE-P2-19',
        scopeType: 'CONTAINER',
      },
      context,
      command(),
    );
    expect(passed.status).toBe('PASSED');
    expect(
      (await prisma.pickTask.findUniqueOrThrow({ where: { id: selectedTask.id } }))
        .status,
    ).toBe('COMPLETED');
    await expect(
      prisma.pickConfirmation.update({
        data: { quantityBase: '999' },
        where: { id: accepted.confirmationId! },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.pickVerificationResult.update({
        data: { scopeRef: 'MUTATED' },
        where: { id: failed.verificationId },
      }),
    ).rejects.toBeTruthy();
  });
});
