import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { InboundService } from './inbound.service';
import {
  type ReceiveInput,
  ReceivingDetailService,
} from './receiving-detail.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('WMS receiving detail persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('enforces receipt conservation, lot/serial rules, LPN events and variance disposition', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const warehouseId = randomUUID();
    const ownerId = randomUUID();
    const productId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'receiving-detail-db-test',
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
        batchControl: 'REQUIRED',
        createdBy: actorId,
        currentVersionNumber: 1,
        id: productId,
        minimumRemainingDays: 30,
        name: '批次序列收货商品',
        serialControl: 'REQUIRED',
        shelfLifeDays: 365,
        sku: `RCT-${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.productVersion.create({
      data: {
        createdBy: actorId,
        productId,
        sku: `RCT-V-${randomUUID().slice(0, 8)}`,
        snapshot: {
          batchControl: 'REQUIRED',
          minimumRemainingDays: 30,
          serialControl: 'REQUIRED',
          shelfLifeDays: 365,
        },
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    const mdm = new MdmReferenceService(prisma as never);
    const inbound = new InboundService(prisma as never, mdm);
    const receiving = new ReceivingDetailService(prisma as never, mdm);

    async function prepare(quantity = '2') {
      const created = await inbound.create(
        {
          asnMode: 'NONE',
          lines: [
            {
              baseUom: 'EA',
              lineNo: 1,
              originalUom: 'EA',
              productId,
              quantityBase: quantity,
              quantityOriginal: quantity,
            },
          ],
          ownerId,
          sourceRef: `PO-${randomUUID().slice(0, 8)}`,
          sourceType: 'PURCHASE',
          sourceVersion: 1,
          warehouseId,
        },
        context,
        command(),
      );
      const expected = await inbound.publish(
        created.inboundId,
        { expectedVersion: created.version },
        context,
        command(),
      );
      const arrived = await inbound.checkIn(
        created.inboundId,
        {
          approvalReference: 'TEMP-APPROVED',
          expectedVersion: expected.version,
          occurredAt: '2026-07-15T01:00:00.000Z',
          temporaryRegistration: true,
        },
        context,
        command(),
      );
      const tasks = await inbound.createTasks(
        created.inboundId,
        {
          expectedVersion: arrived.version,
          tasks: [
            {
              assignedTo: actorId,
              workload: quantity,
              workloadUom: 'EA',
            },
          ],
        },
        context,
        command(),
      );
      const taskId = tasks.taskIds[0]!;
      const started = await inbound.transitionTask(
        taskId,
        { expectedVersion: 1, targetStatus: 'IN_PROGRESS' },
        context,
        command(),
      );
      const line = await prisma.inboundLine.findFirstOrThrow({
        where: { inboundOrderId: created.inboundId, tenantId },
      });
      return {
        inboundId: created.inboundId,
        line,
        taskId,
        taskVersion: started.version,
      };
    }

    const prepared = await prepare();
    const blind = await receiving.preview(prepared.inboundId, 'BLIND', context);
    expect(blind.lines[0]).not.toHaveProperty('expectedQuantityBase');
    const ordered = await receiving.preview(
      prepared.inboundId,
      'ORDERED',
      context,
    );
    expect(ordered.lines[0]).toMatchObject({
      expectedQuantityBase: '2',
      receivedQuantityBase: '0',
    });
    const exactReceipt: ReceiveInput = {
      expectedTaskVersion: prepared.taskVersion,
      lines: [
        {
          accepted: { quantityBase: '2', quantityOriginal: '2' },
          inboundLineId: prepared.line.id,
          lots: [
            {
              clientRef: 'lot-1',
              expiryDate: '2026-07-20',
              productionDate: '2026-01-01',
              quantityBase: '2',
              quantityOriginal: '2',
              supplierBatchNo: 'SUP-LOT-001',
            },
          ],
          pending: { quantityBase: '0', quantityOriginal: '0' },
          received: { quantityBase: '2', quantityOriginal: '2' },
          rejected: { quantityBase: '0', quantityOriginal: '0' },
          serials: [
            { lotClientRef: 'lot-1', serialNumber: 'SERIAL-001' },
            { lotClientRef: 'lot-1', serialNumber: 'SERIAL-002' },
          ],
          variances: [
            {
              photoRefs: [
                { attachmentId: randomUUID(), fileName: 'damage.jpg' },
              ],
              reason: '外箱破损',
              type: 'DAMAGE',
            },
          ],
        },
      ],
      mode: 'ORDERED',
      receivedAt: '2026-07-15T02:00:00.000Z',
      taskId: prepared.taskId,
    };
    await expect(
      receiving.receive(
        prepared.inboundId,
        {
          ...exactReceipt,
          lines: exactReceipt.lines.map((line) => ({
            ...line,
            accepted: { quantityBase: '1', quantityOriginal: '1' },
          })),
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'RECEIPT_QUANTITY_NOT_CONSERVED' });
    await expect(
      receiving.receive(
        prepared.inboundId,
        {
          ...exactReceipt,
          lines: exactReceipt.lines.map((line) => ({
            ...line,
            accepted: { quantityBase: '1', quantityOriginal: '1' },
            ...(line.lots
              ? {
                  lots: line.lots.map((lot) => ({
                    ...lot,
                    quantityBase: '1',
                    quantityOriginal: '1',
                  })),
                }
              : {}),
            received: { quantityBase: '1', quantityOriginal: '1' },
            serials: [{ lotClientRef: 'lot-1', serialNumber: 'SHORT-001' }],
          })),
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({
      code: 'RECEIPT_VARIANCE_AUTHORIZATION_REQUIRED',
      statusCode: 403,
    });
    const confirmed = await receiving.receive(
      prepared.inboundId,
      exactReceipt,
      context,
      command(),
    );
    expect(confirmed.receiptIds).toHaveLength(1);
    expect(confirmed.quarantinedLotIds).toHaveLength(1);
    const receiptId = confirmed.receiptIds[0]!;
    await expect(
      prisma.receiptLine.update({
        data: { varianceReason: 'MUTATED' },
        where: { id: receiptId },
      }),
    ).rejects.toBeTruthy();
    expect(
      await prisma.serialNumber.count({
        where: { status: 'QUARANTINED', tenantId },
      }),
    ).toBe(2);

    const short = await prepare();
    const authorizedShort = await receiving.receive(
      short.inboundId,
      {
        expectedTaskVersion: short.taskVersion,
        lines: [
          {
            accepted: { quantityBase: '1', quantityOriginal: '1' },
            authorizationReference: 'SUPERVISOR-APPROVAL-001',
            inboundLineId: short.line.id,
            lots: [
              {
                clientRef: 'short-lot',
                expiryDate: '2027-12-31',
                productionDate: '2026-07-01',
                quantityBase: '1',
                quantityOriginal: '1',
                supplierBatchNo: 'SUP-SHORT',
              },
            ],
            pending: { quantityBase: '0', quantityOriginal: '0' },
            received: { quantityBase: '1', quantityOriginal: '1' },
            rejected: { quantityBase: '0', quantityOriginal: '0' },
            serials: [
              { lotClientRef: 'short-lot', serialNumber: 'SERIAL-SHORT-001' },
            ],
            varianceReason: '供应商短装',
          },
        ],
        mode: 'BLIND',
        receivedAt: '2026-07-15T02:00:00.000Z',
        taskId: short.taskId,
      },
      context,
      command(),
      true,
    );
    expect(authorizedShort.varianceIds).toHaveLength(1);

    const duplicate = await prepare('1');
    await expect(
      receiving.receive(
        duplicate.inboundId,
        {
          expectedTaskVersion: duplicate.taskVersion,
          lines: [
            {
              accepted: { quantityBase: '1', quantityOriginal: '1' },
              inboundLineId: duplicate.line.id,
              lots: [
                {
                  clientRef: 'dup-lot',
                  expiryDate: '2027-12-31',
                  productionDate: '2026-07-01',
                  quantityBase: '1',
                  quantityOriginal: '1',
                  supplierBatchNo: 'SUP-DUP',
                },
              ],
              pending: { quantityBase: '0', quantityOriginal: '0' },
              received: { quantityBase: '1', quantityOriginal: '1' },
              rejected: { quantityBase: '0', quantityOriginal: '0' },
              serials: [
                { lotClientRef: 'dup-lot', serialNumber: 'SERIAL-SHORT-001' },
              ],
            },
          ],
          mode: 'ORDERED',
          receivedAt: '2026-07-15T02:00:00.000Z',
          taskId: duplicate.taskId,
        },
        context,
        command(),
      ),
    ).rejects.toBeTruthy();

    const carton = await receiving.createHandlingUnit(
      prepared.inboundId,
      {
        contents: [
          {
            quantityBase: '2',
            quantityOriginal: '2',
            receiptLineId: receiptId,
          },
        ],
        lpn: `CARTON-${randomUUID().slice(0, 8)}`,
        type: 'CARTON',
      },
      context,
      command(),
    );
    const pallet = await receiving.createHandlingUnit(
      prepared.inboundId,
      {
        contents: [],
        lpn: `PALLET-${randomUUID().slice(0, 8)}`,
        type: 'PALLET',
      },
      context,
      command(),
    );
    const built = await receiving.buildHandlingUnit(
      pallet.handlingUnitId,
      {
        childExpectedVersion: carton.version,
        childId: carton.handlingUnitId,
        parentExpectedVersion: pallet.version,
      },
      context,
      command(),
    );
    expect(built.parentId).toBe(pallet.handlingUnitId);
    const split = await receiving.splitHandlingUnit(
      carton.handlingUnitId,
      {
        contents: [
          {
            quantityBase: '1',
            quantityOriginal: '1',
            receiptLineId: receiptId,
          },
        ],
        expectedVersion: built.version,
      },
      context,
      command(),
    );
    const reprint = await receiving.reprintLabel(
      split.targetId,
      { copies: 2, reason: '标签污损' },
      context,
      command(),
    );
    const splitUnit = await prisma.handlingUnit.findUniqueOrThrow({
      where: { id: split.targetId },
    });
    expect(reprint.labelNumber).toBe(splitUnit.labelNumber);
    expect(
      await prisma.labelJob.count({
        where: { handlingUnitId: split.targetId, tenantId },
      }),
    ).toBe(2);
    const merged = await receiving.mergeHandlingUnit(
      carton.handlingUnitId,
      {
        sourceExpectedVersion: 1,
        sourceId: split.targetId,
        targetExpectedVersion: split.sourceVersion,
      },
      context,
      command(),
    );
    expect(merged.sourceStatus).toBe('MERGED');
    const event = await prisma.handlingUnitEvent.findFirstOrThrow({
      where: { type: 'MERGED', tenantId },
    });
    await expect(
      prisma.handlingUnitEvent.update({
        data: { payload: { mutated: true } },
        where: { id: event.id },
      }),
    ).rejects.toBeTruthy();

    const noPhoto = await receiving.openVariance(
      {
        inboundOrderId: prepared.inboundId,
        reason: '冷链温度超限',
        temperature: '12.5',
        temperatureUom: 'C',
        type: 'TEMPERATURE',
      },
      context,
      command(),
    );
    await expect(
      receiving.disposeVariance(
        noPhoto.varianceId,
        { expectedVersion: 1, reason: '拒收', targetStatus: 'REJECTED' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'RECEIVING_REJECTION_PHOTO_REQUIRED' });
    await expect(
      receiving.disposeVariance(
        noPhoto.varianceId,
        {
          expectedVersion: 1,
          reason: '转质检复核',
          targetStatus: 'QUALITY_REVIEW',
        },
        context,
        command(),
      ),
    ).resolves.toMatchObject({ status: 'QUALITY_REVIEW', version: 2 });
    const damage = await prisma.receivingVariance.findFirstOrThrow({
      where: {
        receiptLineId: receiptId,
        status: 'PENDING',
        type: 'DAMAGE',
        tenantId,
      },
    });
    await expect(
      receiving.disposeVariance(
        damage.id,
        { expectedVersion: 1, reason: '货损拒收', targetStatus: 'REJECTED' },
        context,
        command(),
      ),
    ).resolves.toMatchObject({ status: 'REJECTED', version: 2 });
    await expect(
      receiving.disposeVariance(
        damage.id,
        {
          expectedVersion: 2,
          reason: '重复处置',
          targetStatus: 'SUPPLEMENTED',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'RECEIVING_DISPOSITION_INVALID' });

    const detail = await receiving.get(prepared.inboundId, context);
    expect(detail).toMatchObject({
      handlingUnits: expect.arrayContaining([
        expect.objectContaining({ id: carton.handlingUnitId }),
      ]),
      receiptLines: [expect.objectContaining({ id: receiptId })],
    });
    expect(
      await prisma.platformOutbox.count({
        where: {
          aggregateType: {
            in: ['InboundOrder', 'HandlingUnit', 'ReceivingVariance'],
          },
          tenantId,
        },
      }),
    ).toBeGreaterThan(12);
  });
});
