import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { InventoryService } from './inventory.service';
import { OutboundService } from './outbound.service';
import { PackShipService } from './pack-ship.service';
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
    const packShip = new PackShipService(prisma as never, mdm, inventory);
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
      (
        await prisma.pickTask.findUniqueOrThrow({
          where: { id: selectedTask.id },
        })
      ).status,
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

    const outboundId = selectedTask.outboundOrderId!;
    const pack = await packShip.createPackTask(
      outboundId,
      {
        boxes: [{ code: 'BOX-L', maxVolume: '100', maxWeight: '100' }],
        materialSnapshot: { buffer: 'paper' },
        ruleSnapshot: {
          defaultUnitVolume: '1',
          defaultUnitWeight: '1',
          volumeTolerancePct: '10',
          weightTolerancePct: '10',
        },
        serviceSnapshot: { service: 'STANDARD_PACK' },
      },
      context,
      command(),
    );
    expect(pack.status).toBe('PACKING');
    expect(pack.packageIds).toHaveLength(1);
    let packageUnit = await prisma.packageUnit.findUniqueOrThrow({
      where: { id: pack.packageIds[0]! },
    });
    const excessive = await packShip.measurePackage(
      packageUnit.id,
      {
        deviceId: 'SCALE-P2-20',
        deviceSequence: '1',
        height: '2',
        length: '2',
        measuredAt: new Date().toISOString(),
        rawSnapshot: { protocol: 'TEST-SCALE' },
        source: 'ELECTRONIC_SCALE',
        volume: '20',
        weight: '20',
        width: '2',
      },
      context,
      command(),
    );
    expect(excessive.status).toBe('EXCEPTION');
    packageUnit = await prisma.packageUnit.findUniqueOrThrow({
      where: { id: packageUnit.id },
    });
    await expect(
      packShip.sealPackage(
        packageUnit.id,
        { expectedVersion: packageUnit.version },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'PACKAGE_WEIGHT_EXCEPTION_OPEN' });
    const weightException = await prisma.weightException.findUniqueOrThrow({
      where: { id: excessive.exceptionId! },
    });
    await packShip.resolveWeightException(
      weightException.id,
      {
        expectedVersion: weightException.version,
        resolutionSnapshot: {
          approval: actorId,
          reason: 'manual count confirms extra buffer material',
        },
      },
      context,
      command(),
    );
    const sealed = await packShip.sealPackage(
      packageUnit.id,
      { expectedVersion: packageUnit.version },
      context,
      command(),
    );
    expect(sealed.status).toBe('SEALED');
    const label = await packShip.issueLabel(
      packageUnit.id,
      {
        contentRef: 's3://labels/p2-20-v1.pdf',
        labelType: 'SHIPPING',
        templateVersion: 'carrier-v1',
      },
      context,
      command(),
    );
    const voided = await packShip.voidLabel(
      label.labelId,
      { reason: 'printer damaged first copy' },
      context,
      command(),
    );
    expect(voided.status).toBe('VOID');
    await expect(
      packShip.stagePackage(
        packageUnit.id,
        {
          loadSequence: 1,
          maxVolume: '100',
          routeCode: 'R-01',
          shipmentRef: 'TMS-SHIP-P2-20',
          stagingLocationId: locationId,
          tripRef: 'TRIP-P2-20',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'STAGING_ACTIVE_LABEL_REQUIRED' });
    const reprinted = await packShip.issueLabel(
      packageUnit.id,
      {
        contentRef: 's3://labels/p2-20-v2.pdf',
        labelType: 'SHIPPING',
        reason: 'replacement print',
        replaceLabelId: label.labelId,
        templateVersion: 'carrier-v1',
      },
      context,
      command(),
    );
    expect(reprinted.labelVersion).toBe(3);
    const staged = await packShip.stagePackage(
      packageUnit.id,
      {
        loadSequence: 1,
        maxVolume: '100',
        routeCode: 'R-01',
        shipmentRef: 'TMS-SHIP-P2-20',
        stagingLocationId: locationId,
        tripRef: 'TRIP-P2-20',
      },
      context,
      command(),
    );
    expect(staged.status).toBe('STAGED');
    expect(
      await prisma.platformOutbox.count({
        where: { aggregateId: outboundId, eventName: 'outbound.ready.v1' },
      }),
    ).toBe(1);
    const load = await packShip.createLoadTask(
      outboundId,
      {
        dockRef: 'DOCK-P2-20',
        maxVolume: '100',
        maxWeight: '100',
        sealNo: 'SEAL-P2-20',
        shipmentRef: 'TMS-SHIP-P2-20',
        vehicleRef: 'VEHICLE-P2-20',
      },
      context,
      command(),
    );
    await expect(
      packShip.confirmLoad(
        load.loadTaskId,
        {
          deviceId: 'RF-LOAD-P2-20',
          deviceSequence: '1',
          dockRef: 'WRONG-DOCK',
          packageId: packageUnit.id,
          sealNo: 'SEAL-P2-20',
          vehicleRef: 'VEHICLE-P2-20',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'LOAD_SCAN_MISMATCH' });
    const loadScan = {
      deviceId: 'RF-LOAD-P2-20',
      deviceSequence: '2',
      dockRef: 'DOCK-P2-20',
      packageId: packageUnit.id,
      sealNo: 'SEAL-P2-20',
      vehicleRef: 'VEHICLE-P2-20',
    };
    const loaded = await packShip.confirmLoad(
      load.loadTaskId,
      loadScan,
      context,
      command(),
    );
    expect(loaded.loaded).toBe(true);
    await expect(
      packShip.confirmLoad(load.loadTaskId, loadScan, context, command()),
    ).resolves.toMatchObject({
      confirmationId: loaded.confirmationId,
      replayed: true,
    });
    const loadedTask = await prisma.loadTask.findUniqueOrThrow({
      where: { id: load.loadTaskId },
    });
    const concurrentShipInput = {
      actualAt: new Date().toISOString(),
      expectedVersion: loadedTask.version,
    };
    const concurrentShip = await Promise.all([
      packShip.ship(load.loadTaskId, concurrentShipInput, context, command()),
      packShip.ship(load.loadTaskId, concurrentShipInput, context, command()),
    ]);
    const shipped = concurrentShip[0]!;
    expect(shipped.status).toBe('SHIPPED');
    expect(concurrentShip[1]!.dispatchId).toBe(shipped.dispatchId);
    expect(concurrentShip.filter(({ replayed }) => replayed)).toHaveLength(1);
    const shippedOrder = await prisma.outboundOrder.findUniqueOrThrow({
      where: { id: outboundId },
    });
    expect(shippedOrder.status).toBe('SHIPPED');
    expect(
      await prisma.platformOutbox.count({
        where: { aggregateId: outboundId, eventName: 'outbound.shipped.v1' },
      }),
    ).toBe(1);
    const finalBalance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { id: stock.balanceId },
    });
    expect(
      finalBalance.availableBase
        .add(finalBalance.allocatedBase)
        .add(finalBalance.holdBase)
        .toString(),
    ).toBe(finalBalance.onHandBase.toString());
    await expect(
      packShip.cancelOutbound(
        outboundId,
        { reason: 'customer request after shipment', reasonCode: 'CUSTOMER' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'OUTBOUND_SHIPPED_IRREVERSIBLE' });
    expect(
      await prisma.cancellationPlan.count({
        where: { outboundOrderId: outboundId, status: 'REJECTED', tenantId },
      }),
    ).toBe(1);
    const otherOrderId = orders.find(
      ({ outboundId: id }) => id !== outboundId,
    )!.outboundId;
    await expect(
      packShip.cancelOutbound(
        otherOrderId,
        {
          reason: 'customer cancelled before shipment',
          reasonCode: 'CUSTOMER',
        },
        context,
        command(),
      ),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(
      prisma.packageMeasurement.update({
        data: { weight: '999' },
        where: { id: excessive.measurementId },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.shippingLabel.update({
        data: { contentRef: 'mutated' },
        where: { id: label.labelId },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.loadConfirmation.update({
        data: { confirmedAt: new Date(0) },
        where: { id: loaded.confirmationId },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.outboundDispatch.update({
        data: { shipmentRef: 'mutated' },
        where: { id: shipped.dispatchId },
      }),
    ).rejects.toBeTruthy();
  });
});
