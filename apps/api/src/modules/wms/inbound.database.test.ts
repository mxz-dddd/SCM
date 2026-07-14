import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { InboundService } from './inbound.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('WMS inbound access persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('preserves ASN quantities, arrival facts, task transitions and scan resolutions', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const warehouseId = randomUUID();
    const ownerId = randomUUID();
    const customerId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'wms-inbound-db-test',
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
    const productId = randomUUID();
    const packageSpecId = randomUUID();
    const customerBarcode = `CUS-${randomUUID().slice(0, 8)}`;
    const gtin = '01234567890128';
    await prisma.product.create({
      data: {
        baseUom: 'EA',
        createdBy: actorId,
        currentVersionNumber: 1,
        id: productId,
        name: '入库测试商品',
        sku: `WMS-${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.productVersion.create({
      data: {
        createdBy: actorId,
        productId,
        sku: `WMS-V-${randomUUID().slice(0, 8)}`,
        snapshot: { baseUom: 'EA', name: '入库测试商品' },
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    await prisma.packageSpec.create({
      data: {
        baseUom: 'EA',
        code: 'CASE',
        createdBy: actorId,
        id: packageSpecId,
        level: 'CASE',
        name: '十件箱',
        originalUom: 'CASE',
        productId,
        publishedAt: new Date(),
        quantityInBase: '10',
        status: 'PUBLISHED',
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    await prisma.productBarcode.createMany({
      data: [
        {
          barcode: customerBarcode,
          createdBy: actorId,
          customerId,
          isPrimary: true,
          productId,
          status: 'ACTIVE',
          tenantId,
          type: 'CUSTOMER',
          updatedBy: actorId,
        },
        {
          barcode: gtin,
          createdBy: actorId,
          isPrimary: true,
          productId,
          status: 'ACTIVE',
          tenantId,
          type: 'GS1',
          updatedBy: actorId,
        },
      ],
    });

    const service = new InboundService(
      prisma as never,
      new MdmReferenceService(prisma as never),
    );
    const created = await service.create(
      {
        asnMode: 'FULL',
        expectedArrival: '2026-07-15T01:00:00.000Z',
        lines: [
          {
            baseUom: 'EA',
            lineNo: 1,
            originalUom: 'CASE',
            packageSpecId,
            productId,
            quantityBase: '20',
            quantityOriginal: '2',
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
    expect(created).toMatchObject({ status: 'DRAFT', version: 1 });
    const line = await prisma.inboundLine.findFirstOrThrow({
      where: { inboundOrderId: created.inboundId, tenantId },
    });
    const partialPackages = {
      expectedVersion: 1,
      packages: [
        {
          clientRef: 'carton',
          contents: [
            {
              baseUom: 'EA',
              inboundLineId: line.id,
              originalUom: 'CASE',
              quantityBase: '10',
              quantityOriginal: '1',
            },
          ],
          lpn: `LPN-PART-${randomUUID().slice(0, 8)}`,
          packageType: 'CARTON' as const,
        },
      ],
    };
    await expect(
      service.parsePackages(
        created.inboundId,
        {
          ...partialPackages,
          packages: partialPackages.packages.map((item) => ({
            ...item,
            contents: item.contents.map((content) => ({
              ...content,
              quantityOriginal: '2',
            })),
          })),
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'INBOUND_PACKAGE_CONVERSION_INVALID' });
    await expect(
      service.parsePackages(
        created.inboundId,
        partialPackages,
        context,
        command(),
      ),
    ).rejects.toMatchObject({
      code: 'INBOUND_PACKAGE_QUANTITY_NOT_CONSERVED',
      statusCode: 409,
    });
    const parsed = await service.parsePackages(
      created.inboundId,
      {
        expectedVersion: 1,
        packages: [
          {
            clientRef: 'carton',
            contents: [
              {
                baseUom: 'EA',
                batchNo: 'LOT-001',
                inboundLineId: line.id,
                originalUom: 'CASE',
                quantityBase: '20',
                quantityOriginal: '2',
              },
            ],
            lpn: `LPN-C-${randomUUID().slice(0, 8)}`,
            packageType: 'CARTON',
            parentRef: 'pallet',
          },
          {
            clientRef: 'pallet',
            contents: [],
            lpn: `LPN-P-${randomUUID().slice(0, 8)}`,
            packageType: 'PALLET',
          },
        ],
      },
      context,
      command(),
    );
    expect(parsed).toMatchObject({ packageCount: 2, version: 2 });
    const packages = await prisma.inboundPackage.findMany({
      where: { inboundOrderId: created.inboundId, tenantId },
    });
    const carton = packages.find(
      ({ packageType }) => packageType === 'CARTON',
    )!;
    expect(carton.parentPackageId).toBe(
      packages.find(({ packageType }) => packageType === 'PALLET')!.id,
    );
    await expect(
      prisma.inboundPackage.update({
        data: { lpn: `MUTATED-${randomUUID()}` },
        where: { id: carton.id },
      }),
    ).rejects.toBeTruthy();

    const expected = await service.publish(
      created.inboundId,
      { expectedVersion: parsed.version },
      context,
      command(),
    );
    expect(expected).toMatchObject({ status: 'EXPECTED', version: 3 });
    const appointmentId = randomUUID();
    await expect(
      service.projectAppointment(
        created.inboundId,
        {
          appointmentId,
          appointmentSnapshot: {},
          sourceVersion: 0,
          status: 'CONFIRMED',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'INBOUND_APPOINTMENT_VERSION_INVALID' });
    const appointment = await service.projectAppointment(
      created.inboundId,
      {
        appointmentId,
        appointmentSnapshot: { appointmentNo: 'APT-001' },
        expectedArrival: '2026-07-15T02:00:00.000Z',
        sourceVersion: 2,
        status: 'CONFIRMED',
      },
      context,
      command(),
    );
    expect(appointment).toMatchObject({ applied: true, sourceVersion: 2 });
    await expect(
      service.projectAppointment(
        created.inboundId,
        {
          appointmentId,
          appointmentSnapshot: { appointmentNo: 'STALE' },
          sourceVersion: 1,
          status: 'CANCELLED',
        },
        context,
        command(),
      ),
    ).resolves.toMatchObject({ applied: false, sourceVersion: 2 });
    await expect(
      service.checkIn(
        created.inboundId,
        {
          expectedVersion: 4,
          occurredAt: '2026-07-15T02:05:00.000Z',
          temporaryRegistration: true,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({
      code: 'INBOUND_TEMPORARY_APPROVAL_REQUIRED',
      statusCode: 403,
    });
    const arrived = await service.checkIn(
      created.inboundId,
      {
        appointmentId,
        expectedVersion: 4,
        occurredAt: '2026-07-15T02:10:00.000Z',
        vehicleSnapshot: { plateNo: '沪A00001' },
      },
      context,
      command(),
    );
    expect(arrived).toMatchObject({ status: 'ARRIVED', version: 5 });
    const arrival = await prisma.arrivalEvent.findFirstOrThrow({
      where: { inboundOrderId: created.inboundId, tenantId },
    });
    await expect(
      prisma.arrivalEvent.update({
        data: { approvalReference: 'MUTATED' },
        where: { id: arrival.id },
      }),
    ).rejects.toBeTruthy();

    const receiving = await service.createTasks(
      created.inboundId,
      {
        expectedVersion: arrived.version,
        tasks: [{ workload: '20', workloadUom: 'EA' }],
      },
      context,
      command(),
    );
    expect(receiving).toMatchObject({ status: 'RECEIVING', version: 6 });
    await expect(
      service.complete(
        created.inboundId,
        { expectedVersion: receiving.version },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'INBOUND_COMPLETE_PRECONDITION_FAILED' });
    const taskId = receiving.taskIds[0]!;
    const claimantA = randomUUID();
    const claimantB = randomUUID();
    const claims = await Promise.allSettled([
      service.claimTask(
        taskId,
        { assignedTo: claimantA, expectedVersion: 1, reason: '抢单 A' },
        context,
        command(),
      ),
      service.claimTask(
        taskId,
        { assignedTo: claimantB, expectedVersion: 1, reason: '抢单 B' },
        context,
        command(),
      ),
    ]);
    expect(claims.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(claims.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    let task = await prisma.receiptTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    const transferred = await service.transferTask(
      taskId,
      {
        assignedTo: randomUUID(),
        expectedVersion: task.version,
        reason: '班次交接',
      },
      context,
      command(),
    );
    expect(transferred.status).toBe('ASSIGNED');
    let transitioned = await service.transitionTask(
      taskId,
      { expectedVersion: transferred.version, targetStatus: 'IN_PROGRESS' },
      context,
      command(),
    );
    await expect(
      service.transitionTask(
        taskId,
        { expectedVersion: transitioned.version, targetStatus: 'PAUSED' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'RECEIPT_PAUSE_REASON_REQUIRED' });
    transitioned = await service.transitionTask(
      taskId,
      {
        expectedVersion: transitioned.version,
        reason: '月台阻塞',
        targetStatus: 'PAUSED',
      },
      context,
      command(),
    );
    transitioned = await service.transitionTask(
      taskId,
      { expectedVersion: transitioned.version, targetStatus: 'IN_PROGRESS' },
      context,
      command(),
    );
    transitioned = await service.transitionTask(
      taskId,
      { expectedVersion: transitioned.version, targetStatus: 'COMPLETED' },
      context,
      command(),
    );
    expect(transitioned.status).toBe('COMPLETED');
    task = await prisma.receiptTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(task.completedAt).not.toBeNull();
    expect(
      await prisma.laborAssignment.count({
        where: { receiptTaskId: taskId, tenantId },
      }),
    ).toBe(2);
    await expect(
      service.complete(
        created.inboundId,
        { expectedVersion: receiving.version },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'INBOUND_COMPLETE_PRECONDITION_FAILED' });

    const customerScan = await service.scan(
      {
        customerId,
        deviceId: 'RF-01',
        deviceSequence: 1,
        inboundOrderId: created.inboundId,
        rawBarcode: customerBarcode,
        scannedAt: '2026-07-15T03:00:00.000Z',
      },
      context,
      command(),
    );
    expect(customerScan).toMatchObject({
      objectId: productId,
      objectType: 'PRODUCT',
      status: 'RESOLVED',
    });
    const gs1Scan = await service.scan(
      {
        deviceId: 'RF-01',
        deviceSequence: 2,
        rawBarcode: `(01)${gtin}(17)300101(10)LOT1`,
        scannedAt: '2026-07-15T03:01:00.000Z',
      },
      context,
      command(),
    );
    expect(gs1Scan).toMatchObject({
      objectType: 'PRODUCT',
      status: 'RESOLVED',
    });
    const unresolved = await service.scan(
      {
        deviceId: 'RF-01',
        deviceSequence: 3,
        rawBarcode: `UNKNOWN-${randomUUID()}`,
        scannedAt: '2026-07-15T03:02:00.000Z',
      },
      context,
      command(),
    );
    expect(unresolved.status).toBe('UNRESOLVED');
    await expect(
      service.manualResolve(
        unresolved.scanEventId,
        { objectId: carton.id, objectType: 'PACKAGE', reason: '' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'SCAN_RESOLUTION_REASON_REQUIRED' });
    const manual = await service.manualResolve(
      unresolved.scanEventId,
      { objectId: carton.id, objectType: 'PACKAGE', reason: '客户码映射确认' },
      context,
      command(),
    );
    expect(manual).toMatchObject({ objectType: 'PACKAGE', status: 'MANUAL' });
    await expect(
      service.scan(
        {
          deviceId: 'RF-01',
          deviceSequence: 3,
          rawBarcode: 'REPLAY-WITHOUT-IDEMPOTENCY',
          scannedAt: '2026-07-15T03:03:00.000Z',
        },
        context,
        command(),
      ),
    ).rejects.toBeTruthy();
    expect(
      await prisma.platformOutbox.count({
        where: {
          aggregateType: { in: ['InboundOrder', 'ReceiptTask', 'ScanEvent'] },
          tenantId,
        },
      }),
    ).toBeGreaterThan(10);
  });
});
