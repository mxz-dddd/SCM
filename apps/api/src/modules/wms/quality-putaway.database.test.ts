import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { RuleEvaluationFacade } from '../platform/public/rule-evaluation.facade';
import { RuleEngineService } from '../platform/rule-engine.service';
import { InboundService } from './inbound.service';
import { InventoryService } from './inventory.service';
import { QualityPutawayService } from './quality-putaway.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('WMS quality, putaway and cross-dock persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('keeps quality gated and prevents concurrent split putaway from exceeding one handling unit', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const ownerId = randomUUID();
    const productId = randomUUID();
    const warehouseId = randomUUID();
    const storageAId = randomUUID();
    const storageBId = randomUUID();
    const chilledId = randomUUID();
    const stagingId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'quality-putaway-db-test',
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
        batchControl: 'OPTIONAL',
        createdBy: actorId,
        currentVersionNumber: 1,
        id: productId,
        name: '质检上架商品',
        sku: `QPA-${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
        temperatureZone: 'AMBIENT',
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.productVersion.create({
      data: {
        createdBy: actorId,
        productId,
        sku: `QPA-V-${randomUUID().slice(0, 8)}`,
        snapshot: {
          baseUom: 'EA',
          batchControl: 'OPTIONAL',
          hazardous: false,
          temperatureZone: 'AMBIENT',
        },
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
        name: '质检测试仓',
        status: 'ACTIVE',
        tenantId,
        timeZone: 'Asia/Shanghai',
        updatedBy: actorId,
      },
    });
    await prisma.warehouseLocation.createMany({
      data: [
        {
          code: 'A-01',
          createdBy: actorId,
          hazardousAllowed: false,
          id: storageAId,
          name: '常温库位 A',
          palletCapacity: '2',
          sequence: 1,
          status: 'ACTIVE',
          temperatureZone: 'AMBIENT',
          tenantId,
          type: 'LOCATION',
          updatedBy: actorId,
          warehouseId,
        },
        {
          code: 'A-02',
          createdBy: actorId,
          hazardousAllowed: false,
          id: storageBId,
          name: '常温库位 B',
          palletCapacity: '2',
          sequence: 2,
          status: 'ACTIVE',
          temperatureZone: 'AMBIENT',
          tenantId,
          type: 'LOCATION',
          updatedBy: actorId,
          warehouseId,
        },
        {
          code: 'C-01',
          createdBy: actorId,
          hazardousAllowed: false,
          id: chilledId,
          name: '冷藏库位',
          palletCapacity: '2',
          sequence: 3,
          status: 'ACTIVE',
          temperatureZone: 'CHILLED',
          tenantId,
          type: 'LOCATION',
          updatedBy: actorId,
          warehouseId,
        },
        {
          code: 'XD-01',
          createdBy: actorId,
          hazardousAllowed: false,
          id: stagingId,
          name: '越库暂存位',
          sequence: 4,
          status: 'ACTIVE',
          temperatureZone: 'AMBIENT',
          tenantId,
          type: 'STAGING',
          updatedBy: actorId,
          warehouseId,
        },
      ],
    });
    const ruleSetId = randomUUID();
    await prisma.ruleSet.create({
      data: {
        code: 'PUTAWAY_TEST',
        createdBy: actorId,
        id: ruleSetId,
        name: 'Putaway test',
        publishedAt: new Date(),
        scenario: 'PUTAWAY',
        status: 'PUBLISHED',
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    await prisma.ruleDefinition.create({
      data: {
        code: 'INCLUDE_ALL',
        conditions: [],
        createdBy: actorId,
        name: 'Include all candidates',
        priority: 1,
        result: { effect: 'INCLUDE', score: 1 },
        ruleSetId,
        tenantId,
        updatedBy: actorId,
      },
    });

    const mdm = new MdmReferenceService(prisma as never);
    const inbound = new InboundService(prisma as never, mdm);
    const quality = new QualityPutawayService(
      prisma as never,
      mdm,
      new RuleEvaluationFacade(
        new RuleEngineService(
          new IdempotencyService(prisma as never),
          prisma as never,
        ),
      ),
      new InventoryService(prisma as never, mdm),
    );

    async function seedInbound(options: { lot: boolean; unit: boolean }) {
      const inboundOrderId = randomUUID();
      const inboundLineId = randomUUID();
      const receiptTaskId = randomUUID();
      const receiptLineId = randomUUID();
      await prisma.inboundOrder.create({
        data: {
          createdBy: actorId,
          id: inboundOrderId,
          inboundNo: `IN-${randomUUID().slice(0, 8)}`,
          ownerId,
          sourceRef: `PO-${randomUUID().slice(0, 8)}`,
          sourceType: 'PURCHASE',
          sourceVersion: 1,
          status: 'RECEIVING',
          tenantId,
          updatedBy: actorId,
          warehouseId,
        },
      });
      await prisma.inboundLine.create({
        data: {
          baseUom: 'EA',
          createdBy: actorId,
          id: inboundLineId,
          inboundOrderId,
          lineNo: 1,
          originalUom: 'EA',
          productId,
          productSnapshot: {
            baseUom: 'EA',
            hazardous: false,
            temperatureZone: 'AMBIENT',
          },
          quantityBase: '10',
          quantityOriginal: '10',
          tenantId,
          updatedBy: actorId,
        },
      });
      await prisma.receiptTask.create({
        data: {
          assignedTo: actorId,
          completedAt: new Date(),
          createdBy: actorId,
          id: receiptTaskId,
          inboundOrderId,
          status: 'COMPLETED',
          taskNo: `RCT-${randomUUID().slice(0, 8)}`,
          tenantId,
          updatedBy: actorId,
          workload: '10',
          workloadUom: 'EA',
        },
      });
      await prisma.receiptLine.create({
        data: {
          acceptedQuantityBase: '10',
          acceptedQuantityOriginal: '10',
          createdBy: actorId,
          expectedBaseUom: 'EA',
          expectedOriginalUom: 'EA',
          expectedQuantityBase: '10',
          expectedQuantityOriginal: '10',
          id: receiptLineId,
          inboundLineId,
          inboundOrderId,
          mode: 'ORDERED',
          pendingQuantityBase: '0',
          pendingQuantityOriginal: '0',
          productId,
          productSnapshot: {
            baseUom: 'EA',
            hazardous: false,
            temperatureZone: 'AMBIENT',
          },
          receiptTaskId,
          receivedAt: new Date(),
          receivedBaseUom: 'EA',
          receivedOriginalUom: 'EA',
          receivedQuantityBase: '10',
          receivedQuantityOriginal: '10',
          rejectedQuantityBase: '0',
          rejectedQuantityOriginal: '0',
          tenantId,
          updatedBy: actorId,
        },
      });
      const lot = options.lot
        ? await prisma.inventoryLot.create({
            data: {
              baseUom: 'EA',
              createdBy: actorId,
              inboundOrderId,
              originalUom: 'EA',
              ownerId,
              productId,
              quantityBase: '10',
              quantityOriginal: '10',
              receiptLineId,
              status: 'RECEIVED',
              supplierBatchNo: `LOT-${randomUUID().slice(0, 8)}`,
              tenantId,
              updatedBy: actorId,
            },
          })
        : null;
      const unit = options.unit
        ? await prisma.handlingUnit.create({
            data: {
              createdBy: actorId,
              inboundOrderId,
              labelNumber: `LBL-${randomUUID().slice(0, 8)}`,
              lpn: `LPN-${randomUUID().slice(0, 8)}`,
              tenantId,
              type: 'PALLET',
              updatedBy: actorId,
            },
          })
        : null;
      if (unit)
        await prisma.handlingUnitContent.create({
          data: {
            baseUom: 'EA',
            createdBy: actorId,
            handlingUnitId: unit.id,
            originalUom: 'EA',
            productId,
            quantityBase: '10',
            quantityOriginal: '10',
            receiptLineId,
            tenantId,
            updatedBy: actorId,
          },
        });
      return { inboundOrderId, lot, receiptLineId, unit };
    }

    const putawaySource = await seedInbound({ lot: true, unit: true });
    await expect(
      inbound.complete(
        putawaySource.inboundOrderId,
        { expectedVersion: 1 },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'INBOUND_COMPLETE_PRECONDITION_FAILED' });
    await expect(
      quality.createInspection(
        putawaySource.inboundOrderId,
        {
          planMode: 'SAMPLE',
          planSnapshot: { basis: 'supplier-risk' },
          receiptLineId: putawaySource.receiptLineId,
          riskScore: '45',
          sampleSize: 2,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'QUALITY_INSPECTION_SOURCE_INVALID' });
    const inspection = await quality.createInspection(
      putawaySource.inboundOrderId,
      {
        inventoryLotId: putawaySource.lot!.id,
        planMode: 'SAMPLE',
        planSnapshot: { basis: 'supplier-risk' },
        receiptLineId: putawaySource.receiptLineId,
        riskScore: '45',
        sampleSize: 2,
      },
      context,
      command(),
    );
    await expect(
      quality.transitionInspection(
        inspection.inspectionId,
        { expectedVersion: 1, targetStatus: 'ACCEPTED' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'QUALITY_INSPECTION_TRANSITION_INVALID' });
    const inspecting = await quality.transitionInspection(
      inspection.inspectionId,
      { expectedVersion: 1, targetStatus: 'INSPECTING' },
      context,
      command(),
    );
    const results = [
      {
        expectedSnapshot: { max: 1 },
        itemCode: 'DAMAGE',
        measuredSnapshot: { value: 2 },
        passed: false,
        sampleRef: 'S-1',
      },
      {
        expectedSnapshot: { max: 1 },
        itemCode: 'DAMAGE',
        measuredSnapshot: { value: 0 },
        passed: true,
        sampleRef: 'S-2',
      },
    ];
    await expect(
      quality.transitionInspection(
        inspection.inspectionId,
        {
          expectedVersion: inspecting.version,
          results: results.slice(0, 1),
          targetStatus: 'REJECTED',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'QUALITY_RESULTS_REQUIRED' });
    await expect(
      quality.transitionInspection(
        inspection.inspectionId,
        {
          expectedVersion: inspecting.version,
          results,
          targetStatus: 'ACCEPTED',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'QUALITY_ACCEPT_WITH_FAILURE' });
    const rejected = await quality.transitionInspection(
      inspection.inspectionId,
      {
        expectedVersion: inspecting.version,
        resultSummary: { failed: 1 },
        results,
        targetStatus: 'REJECTED',
      },
      context,
      command(),
    );
    await expect(
      quality.dispose(
        inspection.inspectionId,
        {
          expectedInspectionVersion: rejected.version,
          quantityBase: '10',
          quantityOriginal: '10',
          reason: '特采放行',
          type: 'CONCESSION',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({
      code: 'QUALITY_DISPOSITION_REASON_OR_APPROVAL_REQUIRED',
    });
    await expect(
      quality.dispose(
        inspection.inspectionId,
        {
          approvalReference: 'QA-APPROVAL-001',
          expectedInspectionVersion: rejected.version,
          quantityBase: '5',
          quantityOriginal: '5',
          reason: '部分特采',
          type: 'CONCESSION',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'QUALITY_DISPOSITION_QUANTITY_INVALID' });
    await quality.dispose(
      inspection.inspectionId,
      {
        approvalReference: 'QA-APPROVAL-001',
        expectedInspectionVersion: rejected.version,
        quantityBase: '10',
        quantityOriginal: '10',
        reason: '特采放行',
        type: 'CONCESSION',
      },
      context,
      command(),
    );
    expect(
      await prisma.inventoryLot.findUniqueOrThrow({
        where: { id: putawaySource.lot!.id },
      }),
    ).toMatchObject({ status: 'RELEASED' });

    const decisions = await Promise.all([
      quality.decidePutaway(
        putawaySource.inboundOrderId,
        {
          handlingUnitId: putawaySource.unit!.id,
          inventoryLotId: putawaySource.lot!.id,
          productId,
          ruleSetCode: 'PUTAWAY_TEST',
        },
        context,
        command(),
      ),
      quality.decidePutaway(
        putawaySource.inboundOrderId,
        {
          handlingUnitId: putawaySource.unit!.id,
          inventoryLotId: putawaySource.lot!.id,
          productId,
          ruleSetCode: 'PUTAWAY_TEST',
        },
        context,
        command(),
      ),
    ]);
    expect(decisions[0]!.evaluationTraceId).toBeTruthy();
    expect(decisions[0]!.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: chilledId,
          reason: 'TEMPERATURE_INCOMPATIBLE',
        }),
      ]),
    );
    const concurrent = await Promise.allSettled(
      decisions.map((decision) =>
        quality.createPutawayTask(
          decision.decisionId,
          {
            assignedTo: actorId,
            decisionExpectedVersion: decision.version,
            quantityBase: '6',
            quantityOriginal: '6',
          },
          context,
          command(),
        ),
      ),
    );
    expect(
      concurrent.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      concurrent.filter(({ status }) => status === 'rejected'),
    ).toHaveLength(1);
    const firstTask = concurrent.find(
      (result) => result.status === 'fulfilled',
    )!;
    if (firstTask.status !== 'fulfilled') throw new Error('task missing');
    const remainingDecision = await prisma.putawayDecision.findFirstOrThrow({
      where: {
        id: { in: decisions.map(({ decisionId }) => decisionId) },
        status: 'PROPOSED',
        tenantId,
      },
    });
    const secondTask = await quality.createPutawayTask(
      remainingDecision.id,
      {
        assignedTo: actorId,
        decisionExpectedVersion: remainingDecision.version,
        quantityBase: '4',
        quantityOriginal: '4',
      },
      context,
      command(),
    );

    async function executeTask(taskId: string, version: number) {
      const started = await quality.startPutawayTask(
        taskId,
        { expectedVersion: version },
        context,
        command(),
      );
      const task = await prisma.putawayTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      const target = await prisma.warehouseLocation.findUniqueOrThrow({
        where: { id: task.targetLocationId },
      });
      return { started, target };
    }
    const firstExecution = await executeTask(
      firstTask.value.taskId,
      firstTask.value.version,
    );
    await expect(
      quality.confirmPutaway(
        firstTask.value.taskId,
        {
          expectedVersion: firstExecution.started.version,
          scannedLpn: 'WRONG-LPN',
          scannedTargetCode: firstExecution.target.code,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'PUTAWAY_SCAN_MISMATCH' });
    const firstMovement = await quality.confirmPutaway(
      firstTask.value.taskId,
      {
        expectedVersion: firstExecution.started.version,
        scannedLpn: putawaySource.unit!.lpn,
        scannedTargetCode: firstExecution.target.code,
      },
      context,
      command(),
    );
    expect(
      await prisma.handlingUnit.findUniqueOrThrow({
        where: { id: putawaySource.unit!.id },
      }),
    ).toMatchObject({ status: 'ACTIVE' });
    const secondExecution = await executeTask(
      secondTask.taskId,
      secondTask.version,
    );
    await quality.confirmPutaway(
      secondTask.taskId,
      {
        expectedVersion: secondExecution.started.version,
        scannedLpn: putawaySource.unit!.lpn,
        scannedTargetCode: secondExecution.target.code,
      },
      context,
      command(),
    );
    expect(
      await prisma.handlingUnit.findUniqueOrThrow({
        where: { id: putawaySource.unit!.id },
      }),
    ).toMatchObject({ status: 'CLOSED' });
    await expect(
      prisma.putawayMovement.update({
        data: { scannedTargetCode: 'MUTATED' },
        where: { id: firstMovement.movementId },
      }),
    ).rejects.toBeTruthy();
    const completed = await inbound.complete(
      putawaySource.inboundOrderId,
      { expectedVersion: 1 },
      context,
      command(),
    );
    expect(completed).toMatchObject({
      accepted: '10',
      received: '10',
      status: 'COMPLETED',
    });
    expect(
      await prisma.platformOutbox.count({
        where: {
          aggregateId: putawaySource.inboundOrderId,
          eventName: 'inbound.completed.v1',
          tenantId,
        },
      }),
    ).toBe(1);

    const crossDockSource = await seedInbound({ lot: false, unit: false });
    await expect(
      quality.createCrossDock(
        crossDockSource.inboundOrderId,
        {
          demandRef: 'SO-BLOCKED',
          demandSnapshot: { productId },
          productId,
          quantityBase: '10',
          quantityOriginal: '10',
          receiptLineId: crossDockSource.receiptLineId,
          stagingLocationId: stagingId,
          windowEnd: '2027-07-14T10:00:00.000Z',
          windowStart: '2027-07-14T09:00:00.000Z',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'CROSS_DOCK_SOURCE_INVALID' });
    const exempt = await quality.createInspection(
      crossDockSource.inboundOrderId,
      {
        planMode: 'EXEMPT',
        planSnapshot: { reason: 'trusted-supplier' },
        receiptLineId: crossDockSource.receiptLineId,
        riskScore: '0',
        sampleSize: 0,
      },
      context,
      command(),
    );
    await quality.transitionInspection(
      exempt.inspectionId,
      { expectedVersion: exempt.version, targetStatus: 'ACCEPTED' },
      context,
      command(),
    );
    await expect(
      quality.createCrossDock(
        crossDockSource.inboundOrderId,
        {
          demandRef: 'SO-MISMATCH',
          demandSnapshot: { productId: randomUUID() },
          productId,
          quantityBase: '10',
          quantityOriginal: '10',
          receiptLineId: crossDockSource.receiptLineId,
          stagingLocationId: stagingId,
          windowEnd: '2027-07-14T10:00:00.000Z',
          windowStart: '2027-07-14T09:00:00.000Z',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'CROSS_DOCK_DEMAND_MISMATCH' });
    const allocation = await quality.createCrossDock(
      crossDockSource.inboundOrderId,
      {
        demandRef: 'SO-READY',
        demandSnapshot: { productId },
        productId,
        quantityBase: '10',
        quantityOriginal: '10',
        receiptLineId: crossDockSource.receiptLineId,
        stagingLocationId: stagingId,
        windowEnd: '2027-07-14T10:00:00.000Z',
        windowStart: '2027-07-14T09:00:00.000Z',
      },
      context,
      command(),
    );
    const reserved = await quality.transitionCrossDock(
      allocation.allocationId,
      { expectedVersion: allocation.version, targetStatus: 'RESERVED' },
      context,
      command(),
    );
    const crossed = await quality.transitionCrossDock(
      allocation.allocationId,
      { expectedVersion: reserved.version, targetStatus: 'COMPLETED' },
      context,
      command(),
    );
    await expect(
      quality.transitionCrossDock(
        allocation.allocationId,
        { expectedVersion: crossed.version, targetStatus: 'RESERVED' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'CROSS_DOCK_TRANSITION_INVALID' });
    await expect(
      inbound.complete(
        crossDockSource.inboundOrderId,
        { expectedVersion: 1 },
        context,
        command(),
      ),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });
});
