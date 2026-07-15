import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const tenantId = '10000000-0000-4000-8000-000000000100';
const administratorId = '10000000-0000-4000-8000-000000000101';
const administratorRoleId = '10000000-0000-4000-8000-000000000104';
const secondUserId = '30000000-0000-4000-8000-000000000201';
const supplierId = '30000000-0000-4000-8000-000000000202';
const addressId = '30000000-0000-4000-8000-000000000203';
const warehouseId = '30000000-0000-4000-8000-000000000204';
const locationId = '30000000-0000-4000-8000-000000000205';
const productId = '30000000-0000-4000-8000-000000000206';
const putawayRuleCode = 'P3_E2E_PUTAWAY';

type JsonObject = Record<string, unknown>;
interface SlotFixture {
  endsAt: Date;
  id: string;
  startsAt: Date;
  version: number;
}
let inboundSlot: SlotFixture;
let competingSlot: SlotFixture;
let fullTargetSlot: SlotFixture;

function headers(token: string, idempotencyKey?: string) {
  return {
    Authorization: `Bearer ${token}`,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    'X-Correlation-Id': randomUUID(),
    'X-Tenant-Id': tenantId,
  };
}
async function body(response: Awaited<ReturnType<APIRequestContext['post']>>) {
  return (await response.json()) as JsonObject;
}
async function post(
  request: APIRequestContext,
  token: string,
  path: string,
  data: unknown,
  idempotencyKey = randomUUID(),
) {
  const response = await request.post(path, {
    data,
    headers: headers(token, idempotencyKey),
  });
  const result = await body(response);
  expect(response.ok(), `${path}: ${JSON.stringify(result)}`).toBe(true);
  return result;
}
async function get(request: APIRequestContext, token: string, path: string) {
  const response = await request.get(path, { headers: headers(token) });
  const result = await body(response);
  expect(response.ok(), `${path}: ${JSON.stringify(result)}`).toBe(true);
  return result;
}
async function login(
  request: APIRequestContext,
  username: string,
  deviceId: string,
) {
  const response = await request.post('/api/v1/auth/login', {
    data: {
      deviceId,
      password: process.env.SEED_ADMIN_PASSWORD,
      tenantCode: 'PLATFORM',
      username,
    },
    headers: { 'X-Correlation-Id': randomUUID() },
  });
  const result = await body(response);
  expect(response.ok(), JSON.stringify(result)).toBe(true);
  return String(result.accessToken);
}

async function createApprovedPurchaseOrder(
  request: APIRequestContext,
  token: string,
  suffix: string,
  quantity = '10',
) {
  const created = await post(request, token, '/api/v1/oms/orders', {
    channel: 'API',
    currency: 'CNY',
    customerId: supplierId,
    deliveryAddressId: addressId,
    externalOrderNo: `P3-PO-${suffix}`,
    externalVersion: '1',
    lines: [{ lineNo: 1, productId, quantity, uom: 'EA' }],
    mappingVersion: 'p3-e2e-purchase-v1',
    rawPayload: { source: 'ERP', suffix },
    requestedFrom: new Date(Date.now() + 3_600_000).toISOString(),
    requestedUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    totalAmount: '100',
    type: 'PURCHASE',
  });
  const submitted = await post(
    request,
    token,
    `/api/v1/oms/orders/${String(created.orderId)}/submit`,
    { expectedVersion: Number(created.version) },
  );
  const reviewed = await post(
    request,
    token,
    `/api/v1/oms/orders/${String(created.orderId)}/review`,
    {
      autoApproveLimit: '10000',
      creditAvailable: '10000',
      expectedVersion: Number(submitted.version),
    },
  );
  expect(reviewed.status).toBe('APPROVED');
  return { created, reviewed };
}

function appointmentInput(
  slot: SlotFixture,
  sourceRef: string,
  sourceLineRef: string,
  quantity = '1',
  windowFrom = slot.startsAt,
  windowTo = slot.endsAt,
) {
  return {
    approvalPolicy: {
      customerRequiresApproval: false,
      requiresApprovalServiceTypes: [],
    },
    orderLinks: [
      {
        bookableQuantityBase: quantity,
        packageSpecSnapshot: { version: 1 },
        quantity,
        quantityBase: quantity,
        quantityBaseUom: 'EA',
        quantityUom: 'EA',
        sourceLineRef,
        sourceRef,
        sourceSnapshot: { sourceRef },
        sourceType: 'ASN',
      },
    ],
    requesterPartyRef: supplierId,
    requesterSnapshot: { role: 'SUPPLIER' },
    requestedWindowFrom: windowFrom.toISOString(),
    requestedWindowTo: windowTo.toISOString(),
    serviceType: 'INBOUND',
    slotVersion: slot.version,
    timeSlotId: slot.id,
    type: 'ORDER_LINKED',
    urgent: false,
    vehicleSnapshot: { plateNumber: '沪P30001', vehicleType: 'VAN' },
    warehouseRef: warehouseId,
    workload: {
      laborHours: quantity,
      pallets: quantity,
      quantity,
      quantityUom: 'EA',
      vehicles: quantity,
    },
  };
}

test.beforeAll(async () => {
  const administrator = await prisma.account.findUniqueOrThrow({
    where: { id: administratorId },
  });
  await prisma.account.upsert({
    create: {
      createdBy: administratorId,
      id: secondUserId,
      kind: 'USER',
      passwordHash: administrator.passwordHash,
      tenantId,
      updatedBy: administratorId,
      username: 'p3-user-two',
    },
    update: {
      passwordHash: administrator.passwordHash,
      updatedBy: administratorId,
    },
    where: { id: secondUserId },
  });
  await prisma.accountRole.upsert({
    create: {
      accountId: secondUserId,
      createdBy: administratorId,
      id: '30000000-0000-4000-8000-000000000214',
      roleId: administratorRoleId,
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: '30000000-0000-4000-8000-000000000214' },
  });
  await prisma.partner.upsert({
    create: {
      code: 'P3-E2E-SUPPLIER',
      createdBy: administratorId,
      id: supplierId,
      legalName: 'P3 验收供应商',
      status: 'ACTIVE',
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: supplierId },
  });
  for (const [id, roleType] of [
    ['30000000-0000-4000-8000-000000000215', 'SUPPLIER'],
    ['30000000-0000-4000-8000-000000000216', 'CUSTOMER'],
  ] as const)
    await prisma.partnerRole.upsert({
      create: {
        createdBy: administratorId,
        id,
        partnerId: supplierId,
        roleType,
        tenantId,
        updatedBy: administratorId,
      },
      update: { updatedBy: administratorId },
      where: { id },
    });
  await prisma.partnerAddress.upsert({
    create: {
      addressType: 'DELIVERY',
      city: '上海',
      code: 'P3-E2E-ADDRESS',
      countryCode: 'CN',
      createdBy: administratorId,
      geocodeStatus: 'VERIFIED',
      geocodedAt: new Date(),
      id: addressId,
      latitude: '31.23040000',
      longitude: '121.47370000',
      partnerId: supplierId,
      rawText: '上海市 P3 验收路 1 号',
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: addressId },
  });
  await prisma.warehouse.upsert({
    create: {
      code: 'P3-E2E-WH',
      createdBy: administratorId,
      id: warehouseId,
      name: 'P3 验收仓',
      status: 'ACTIVE',
      tenantId,
      timeZone: 'Asia/Shanghai',
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: warehouseId },
  });
  await prisma.warehouseLocation.upsert({
    create: {
      code: 'P3-A-01',
      createdBy: administratorId,
      hazardousAllowed: false,
      id: locationId,
      name: 'P3 常温库位',
      palletCapacity: '100',
      sequence: 1,
      status: 'ACTIVE',
      temperatureZone: 'AMBIENT',
      tenantId,
      type: 'LOCATION',
      updatedBy: administratorId,
      warehouseId,
    },
    update: { updatedBy: administratorId },
    where: { id: locationId },
  });
  await prisma.product.upsert({
    create: {
      baseUom: 'EA',
      batchControl: 'REQUIRED',
      createdBy: administratorId,
      currentVersionNumber: 1,
      id: productId,
      name: 'P3 验收商品',
      sku: 'P3-E2E-SKU',
      status: 'ACTIVE',
      temperatureZone: 'AMBIENT',
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: productId },
  });
  if (
    !(await prisma.productVersion.findUnique({
      where: { id: '30000000-0000-4000-8000-000000000217' },
    }))
  )
    await prisma.productVersion.create({
      data: {
        createdBy: administratorId,
        id: '30000000-0000-4000-8000-000000000217',
        productId,
        sku: 'P3-E2E-SKU',
        snapshot: {
          baseUom: 'EA',
          batchControl: 'REQUIRED',
          hazardous: false,
          serialControl: 'NONE',
          temperatureZone: 'AMBIENT',
        },
        tenantId,
        updatedBy: administratorId,
        versionNumber: 1,
      },
    });
  const ruleSetId = '30000000-0000-4000-8000-000000000208';
  if (!(await prisma.ruleSet.findUnique({ where: { id: ruleSetId } })))
    await prisma.ruleSet.create({
      data: {
        code: putawayRuleCode,
        createdBy: administratorId,
        id: ruleSetId,
        name: 'P3 验收上架规则',
        publishedAt: new Date(),
        scenario: 'PUTAWAY',
        status: 'PUBLISHED',
        tenantId,
        updatedBy: administratorId,
        versionNumber: 1,
      },
    });
  if (
    !(await prisma.ruleDefinition.findUnique({
      where: { id: '30000000-0000-4000-8000-000000000209' },
    }))
  )
    await prisma.ruleDefinition.create({
      data: {
        code: 'P3_INCLUDE_ALL',
        conditions: [],
        createdBy: administratorId,
        id: '30000000-0000-4000-8000-000000000209',
        name: 'P3 包含全部库位',
        priority: 1,
        result: { effect: 'INCLUDE', score: 10 },
        ruleSetId,
        tenantId,
        updatedBy: administratorId,
      },
    });

  const resourceRef = randomUUID();
  const profile = await prisma.capacityProfile.create({
    data: {
      blacklistDates: [],
      calendarCode: 'P3-E2E',
      capacityLaborHours: 20,
      capacityPallets: 20,
      capacityQuantity: 20,
      capacityQuantityUom: 'EA',
      capacityVehicles: 20,
      createdBy: administratorId,
      effectiveFrom: new Date(),
      internalLaborHours: 0,
      internalPallets: 0,
      internalQuantity: 0,
      internalVehicles: 0,
      leadTimeMinutes: 0,
      profileCode: `P3-${randomUUID()}`,
      publishedAt: new Date(),
      resourceRef,
      resourceSnapshot: { warehouseId },
      resourceType: 'DOCK',
      revision: 1,
      serviceType: 'INBOUND',
      shiftCode: 'DAY',
      shiftEndTime: '23:00',
      shiftStartTime: '00:00',
      slotMinutes: 60,
      status: 'PUBLISHED',
      tenantId,
      updatedBy: administratorId,
      warehouseRef: warehouseId,
    },
  });
  const base = new Date(Date.now() + 2 * 3_600_000);
  base.setUTCMinutes(0, 0, 0);
  const calendar = await prisma.capacityCalendar.create({
    data: {
      calendarDate: base,
      calendarSnapshot: { timeZone: 'UTC' },
      capacityProfileId: profile.id,
      createdBy: administratorId,
      shiftCode: 'DAY',
      tenantId,
      updatedBy: administratorId,
    },
  });
  const makeSlot = async (offsetHours: number, capacity: number, used = 0) => {
    const startsAt = new Date(base.getTime() + offsetHours * 3_600_000);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);
    const slot = await prisma.timeSlot.create({
      data: {
        calendarSnapshot: { timeZone: 'UTC' },
        capacityCalendarId: calendar.id,
        capacityLaborHours: capacity,
        capacityPallets: capacity,
        capacityProfileId: profile.id,
        capacityQuantity: capacity,
        capacityQuantityUom: 'EA',
        capacityVehicles: capacity,
        createdBy: administratorId,
        endsAt,
        resourceRef,
        resourceType: 'DOCK',
        serviceType: 'INBOUND',
        startsAt,
        tenantId,
        updatedBy: administratorId,
        usedLaborHours: used,
        usedPallets: used,
        usedQuantity: used,
        usedVehicles: used,
        warehouseRef: warehouseId,
      },
    });
    return { endsAt, id: slot.id, startsAt, version: slot.version };
  };
  inboundSlot = await makeSlot(0, 20);
  competingSlot = await makeSlot(2, 1);
  fullTargetSlot = await makeSlot(3, 1, 1);
});

test.afterAll(async () => prisma.$disconnect());

test('场景② ASN 经预约门岗、收货质检上架并回写 OMS/ERP 事件', async ({
  request,
}) => {
  const token = await login(request, 'platform-admin', 'P3-E2E-INBOUND');
  const order = await createApprovedPurchaseOrder(request, token, 'INBOUND-01');
  const orderLine = await prisma.businessOrderLine.findFirstOrThrow({
    where: { orderId: String(order.created.orderId), tenantId },
  });
  const asn = await post(
    request,
    token,
    `/api/v1/oms/orders/${String(order.created.orderId)}/asns`,
    {
      expectedArrival: inboundSlot.startsAt.toISOString(),
      expiresAt: new Date(
        inboundSlot.endsAt.getTime() + 86_400_000,
      ).toISOString(),
      externalAsnNo: 'P3-E2E-ASN-01',
      lines: [
        {
          baseUom: 'EA',
          batchNo: 'P3-LOT-01',
          packageNo: 'P3-PALLET-01',
          productId,
          quantityBase: '10',
          quantityOriginal: '10',
          originalUom: 'EA',
          sourceOrderLineId: orderLine.id,
        },
      ],
      packages: [
        {
          packageNo: 'P3-PALLET-01',
          snapshot: { pallet: true },
          type: 'PALLET',
        },
      ],
      partnerId: supplierId,
      shipmentReference: 'P3-SHIPMENT-REF',
      warehouseId,
    },
  );
  expect(asn.status).toBe('ACCEPTED');
  const asnLine = await prisma.partnerAsnLine.findFirstOrThrow({
    where: { asnId: String(asn.asnId), tenantId },
  });
  const appointment = await post(
    request,
    token,
    '/api/v1/ams/appointments',
    appointmentInput(inboundSlot, String(asn.asnId), asnLine.id, '10'),
  );
  expect(appointment.status).toBe('CONFIRMED');
  const verification = await post(
    request,
    token,
    '/api/v1/ams/onsite/gate/verifications',
    {
      appointmentId: appointment.appointmentId,
      evidence: {
        credentialsValid: true,
        driverMatches: true,
        ordersValid: true,
        vehicleMatches: true,
      },
      identityType: 'QR_CODE',
      identityValue: `P3-QR-${String(appointment.appointmentId)}`,
      manualRelease: false,
      observedAt: new Date().toISOString(),
      policy: {
        allowEarly: true,
        allowLate: false,
        allowWalkIn: false,
        earlyGraceMinutes: 240,
        lateGraceMinutes: 30,
      },
    },
  );
  const pass = await post(
    request,
    token,
    `/api/v1/ams/onsite/appointments/${String(appointment.appointmentId)}/gate-passes`,
    {
      gateVerificationId: verification.gateVerificationId,
      plateNumber: '沪P30001',
      validMinutes: 120,
    },
  );
  const entered = await post(
    request,
    token,
    '/api/v1/ams/onsite/gate/access-events',
    {
      eventType: 'ENTRY',
      evidenceSnapshot: { gate: 'P3-GATE-01' },
      token: pass.token,
    },
  );
  expect(entered.decision).toBe('ALLOWED');

  const inbound = await post(request, token, '/api/v1/wms/inbounds', {
    asnMode: 'FULL',
    expectedArrival: inboundSlot.startsAt.toISOString(),
    lines: [
      {
        baseUom: 'EA',
        batchRequired: true,
        lineNo: 1,
        originalUom: 'EA',
        productId,
        quantityBase: '10',
        quantityOriginal: '10',
        sourceLineRef: asnLine.id,
      },
    ],
    ownerId: supplierId,
    sourceRef: asn.asnId,
    sourceType: 'ASN',
    sourceVersion: Number(asn.version),
    supplierId,
    warehouseId,
  });
  const published = await post(
    request,
    token,
    `/api/v1/wms/inbounds/${String(inbound.inboundId)}/publish`,
    { expectedVersion: Number(inbound.version) },
  );
  await post(
    request,
    token,
    `/api/v1/wms/inbounds/${String(inbound.inboundId)}/appointment-projections`,
    {
      appointmentId: appointment.appointmentId,
      appointmentSnapshot: {
        appointmentNo: appointment.appointmentNo,
        asnId: asn.asnId,
      },
      expectedArrival: inboundSlot.startsAt.toISOString(),
      sourceVersion: Number(appointment.version),
      status: 'CONFIRMED',
      vehicleSnapshot: { plateNumber: '沪P30001' },
    },
  );
  const projectedOrder = await prisma.inboundOrder.findUniqueOrThrow({
    where: { id: String(inbound.inboundId) },
  });
  const arrived = await post(
    request,
    token,
    `/api/v1/wms/inbounds/${String(inbound.inboundId)}/check-in`,
    {
      appointmentId: appointment.appointmentId,
      expectedVersion: projectedOrder.version,
      gateId: randomUUID(),
      occurredAt: new Date().toISOString(),
      vehicleSnapshot: { plateNumber: '沪P30001' },
    },
  );
  expect(arrived.status).toBe('ARRIVED');
  const taskBatch = await post(
    request,
    token,
    `/api/v1/wms/inbounds/${String(inbound.inboundId)}/receipt-tasks`,
    {
      expectedVersion: Number(arrived.version),
      tasks: [
        {
          assignedTo: administratorId,
          priority: 100,
          workload: '10',
          workloadUom: 'EA',
        },
      ],
    },
  );
  const taskId = String((taskBatch.taskIds as string[])[0]);
  const startedTask = await post(
    request,
    token,
    `/api/v1/wms/receipt-tasks/${taskId}/transition`,
    { expectedVersion: 1, targetStatus: 'IN_PROGRESS' },
  );
  const inboundLine = await prisma.inboundLine.findFirstOrThrow({
    where: { inboundOrderId: String(inbound.inboundId), tenantId },
  });
  const receipt = await post(
    request,
    token,
    `/api/v1/wms/inbounds/${String(inbound.inboundId)}/receive`,
    {
      expectedTaskVersion: Number(startedTask.version),
      lines: [
        {
          accepted: { quantityBase: '10', quantityOriginal: '10' },
          inboundLineId: inboundLine.id,
          lots: [
            {
              clientRef: 'LOT-1',
              quantityBase: '10',
              quantityOriginal: '10',
              supplierBatchNo: 'P3-LOT-01',
            },
          ],
          pending: { quantityBase: '0', quantityOriginal: '0' },
          received: { quantityBase: '10', quantityOriginal: '10' },
          rejected: { quantityBase: '0', quantityOriginal: '0' },
        },
      ],
      mode: 'ORDERED',
      receivedAt: new Date().toISOString(),
      taskId,
    },
  );
  await post(request, token, `/api/v1/wms/receipt-tasks/${taskId}/transition`, {
    expectedVersion: Number(startedTask.version),
    targetStatus: 'COMPLETED',
  });
  const receiptId = String((receipt.receiptIds as string[])[0]);
  const lot = await prisma.inventoryLot.findFirstOrThrow({
    where: {
      inboundOrderId: String(inbound.inboundId),
      receiptLineId: receiptId,
      tenantId,
    },
  });
  const unit = await post(
    request,
    token,
    `/api/v1/wms/inbounds/${String(inbound.inboundId)}/handling-units`,
    {
      contents: [
        {
          quantityBase: '10',
          quantityOriginal: '10',
          receiptLineId: receiptId,
        },
      ],
      lpn: 'P3-LPN-0001',
      type: 'PALLET',
    },
  );
  const inspection = await post(
    request,
    token,
    `/api/v1/wms/inbounds/${String(inbound.inboundId)}/inspections`,
    {
      inventoryLotId: lot.id,
      planMode: 'FULL',
      planSnapshot: { policy: 'P3-E2E-FULL' },
      receiptLineId: receiptId,
      riskScore: '10',
      sampleSize: 1,
    },
  );
  const inspecting = await post(
    request,
    token,
    `/api/v1/wms/inspections/${String(inspection.inspectionId)}/transition`,
    { expectedVersion: Number(inspection.version), targetStatus: 'INSPECTING' },
  );
  const accepted = await post(
    request,
    token,
    `/api/v1/wms/inspections/${String(inspection.inspectionId)}/transition`,
    {
      expectedVersion: Number(inspecting.version),
      resultSummary: { passed: 1 },
      results: [
        {
          expectedSnapshot: { result: 'PASS' },
          itemCode: 'APPEARANCE',
          measuredSnapshot: { result: 'PASS' },
          passed: true,
          sampleRef: 'S-1',
        },
      ],
      targetStatus: 'ACCEPTED',
    },
  );
  expect(accepted.status).toBe('ACCEPTED');
  const decision = await post(
    request,
    token,
    `/api/v1/wms/inbounds/${String(inbound.inboundId)}/putaway-decisions`,
    {
      handlingUnitId: unit.handlingUnitId,
      inventoryLotId: lot.id,
      productId,
      ruleSetCode: putawayRuleCode,
    },
  );
  const putawayTask = await post(
    request,
    token,
    `/api/v1/wms/putaway-decisions/${String(decision.decisionId)}/tasks`,
    {
      assignedTo: administratorId,
      decisionExpectedVersion: Number(decision.version),
      quantityBase: '10',
      quantityOriginal: '10',
    },
  );
  const startedPutaway = await post(
    request,
    token,
    `/api/v1/wms/putaway-tasks/${String(putawayTask.taskId)}/start`,
    { expectedVersion: Number(putawayTask.version) },
  );
  const target = await prisma.warehouseLocation.findUniqueOrThrow({
    where: { id: String(decision.selectedLocationId) },
  });
  const movement = await post(
    request,
    token,
    `/api/v1/wms/putaway-tasks/${String(putawayTask.taskId)}/confirm`,
    {
      expectedVersion: Number(startedPutaway.version),
      scannedLpn: unit.lpn,
      scannedTargetCode: target.code,
    },
  );
  expect(movement.status).toBe('COMPLETED');
  const currentInbound = await prisma.inboundOrder.findUniqueOrThrow({
    where: { id: String(inbound.inboundId) },
  });
  const completed = await post(
    request,
    token,
    `/api/v1/wms/inbounds/${String(inbound.inboundId)}/complete`,
    { expectedVersion: currentInbound.version },
  );
  expect(completed.status).toBe('COMPLETED');
  const completedOutbox = await prisma.platformOutbox.findFirstOrThrow({
    where: {
      aggregateId: String(inbound.inboundId),
      eventName: 'inbound.completed.v1',
      tenantId,
    },
  });
  const consumed = await post(
    request,
    token,
    '/api/v1/oms/timeline-events/consume',
    {
      aggregateId: String(inbound.inboundId),
      aggregateType: 'InboundOrder',
      aggregateVersion: Number(completed.version),
      eventId: completedOutbox.id,
      eventType: 'inbound.completed.v1',
      occurredAt: completedOutbox.createdAt.toISOString(),
      payload: {
        actorId: administratorId,
        fromStatus: 'RECEIVING',
        inboundId: inbound.inboundId,
        orderId: order.created.orderId,
        summary: 'ASN 收货质检上架完成，回写 OMS/ERP',
        toStatus: 'COMPLETED',
      },
      schemaVersion: 1,
      traceId: completedOutbox.correlationId,
    },
  );
  expect(consumed.status).toBe('PROCESSED');
  const timeline = await get(
    request,
    token,
    `/api/v1/oms/orders/${String(order.created.orderId)}/timeline?timeZone=Asia%2FShanghai`,
  );
  expect(timeline.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        eventType: 'inbound.completed.v1',
        sourceDomain: 'INBOUND',
        toStatus: 'COMPLETED',
      }),
    ]),
  );
  const balance = await prisma.inventoryBalance.findFirstOrThrow({
    where: {
      handlingUnitId: String(unit.handlingUnitId),
      locationId,
      productId,
      tenantId,
    },
  });
  expect(balance.onHandBase.toString()).toBe('10');
  expect(balance.availableBase.toString()).toBe('10');
});

test('场景④ 两用户抢同一时隙仅一方成功，改期失败保持原预约', async ({
  request,
}) => {
  const [firstToken, secondToken] = await Promise.all([
    login(request, 'platform-admin', 'P3-E2E-SLOT-01'),
    login(request, 'p3-user-two', 'P3-E2E-SLOT-02'),
  ]);
  const windowFrom = competingSlot.startsAt;
  const windowTo = fullTargetSlot.endsAt;
  const [left, right] = await Promise.all([
    request.post('/api/v1/ams/appointments', {
      data: appointmentInput(
        competingSlot,
        'P3-SOURCE-A',
        'LINE-A',
        '1',
        windowFrom,
        windowTo,
      ),
      headers: headers(firstToken, randomUUID()),
    }),
    request.post('/api/v1/ams/appointments', {
      data: appointmentInput(
        competingSlot,
        'P3-SOURCE-B',
        'LINE-B',
        '1',
        windowFrom,
        windowTo,
      ),
      headers: headers(secondToken, randomUUID()),
    }),
  ]);
  expect([left.ok(), right.ok()].filter(Boolean)).toHaveLength(1);
  expect([left.status(), right.status()].sort((a, b) => a - b)).toEqual([
    201, 409,
  ]);
  const winner = await body(left.ok() ? left : right);
  const loser = await body(left.ok() ? right : left);
  expect(loser.code).toBe('AMS_TIME_SLOT_CAPACITY_CONFLICT');
  const appointmentId = String(winner.appointmentId);
  const before = await prisma.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
  });
  const reservation =
    await prisma.appointmentCapacityReservation.findFirstOrThrow({
      where: { appointmentId, status: 'ACTIVE', tenantId },
    });
  const sourceBefore = await prisma.timeSlot.findUniqueOrThrow({
    where: { id: competingSlot.id },
  });
  const targetBefore = await prisma.timeSlot.findUniqueOrThrow({
    where: { id: fullTargetSlot.id },
  });
  const reschedule = await request.post(
    `/api/v1/ams/appointments/${appointmentId}/reschedule`,
    {
      data: {
        expectedVersion: before.version,
        newRequestedWindowFrom: windowFrom.toISOString(),
        newRequestedWindowTo: windowTo.toISOString(),
        newSlotVersion: targetBefore.version,
        newTimeSlotId: fullTargetSlot.id,
        reason: 'P3 验收容量冲突',
      },
      headers: headers(left.ok() ? firstToken : secondToken, randomUUID()),
    },
  );
  const rescheduleBody = await body(reschedule);
  expect(reschedule.status()).toBe(409);
  expect(rescheduleBody.code).toBe('AMS_RESCHEDULE_CAPACITY_CONFLICT');
  const after = await prisma.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
  });
  const sourceAfter = await prisma.timeSlot.findUniqueOrThrow({
    where: { id: competingSlot.id },
  });
  const targetAfter = await prisma.timeSlot.findUniqueOrThrow({
    where: { id: fullTargetSlot.id },
  });
  const activeReservations =
    await prisma.appointmentCapacityReservation.findMany({
      where: { appointmentId, status: 'ACTIVE', tenantId },
    });
  expect(after).toMatchObject({
    status: 'CONFIRMED',
    timeSlotId: before.timeSlotId,
    version: before.version,
  });
  expect(activeReservations).toHaveLength(1);
  expect(activeReservations[0]!.id).toBe(reservation.id);
  expect(sourceAfter.usedQuantity.toString()).toBe(
    sourceBefore.usedQuantity.toString(),
  );
  expect(sourceAfter.version).toBe(sourceBefore.version);
  expect(targetAfter.usedQuantity.toString()).toBe(
    targetBefore.usedQuantity.toString(),
  );
  expect(targetAfter.version).toBe(targetBefore.version);
});

test('场景⑤ 拒单释放容量可改派，POD 退回不能结算', async ({ request }) => {
  const token = await login(request, 'platform-admin', 'P3-E2E-TMS');
  const now = new Date();
  const tenderShipmentId = randomUUID();
  const podShipmentId = randomUUID();
  const shipmentData = (
    id: string,
    status: 'TENDERED' | 'DELIVERED',
    suffix: string,
  ) => ({
    consolidationPlanId: randomUUID(),
    createdBy: administratorId,
    deliveryWindowTo: new Date(now.getTime() + 86_400_000),
    destinationSnapshot: { city: '上海' },
    id,
    mode: 'ROAD_FTL' as const,
    originSnapshot: { city: '苏州' },
    pickupWindowFrom: now,
    requirementSnapshot: {},
    shipmentNo: `P3-SHP-${suffix}-${randomUUID()}`,
    status,
    tenantId,
    totalPallets: 1,
    totalVolumeBase: 10,
    totalWeightBase: 10,
    updatedBy: administratorId,
  });
  await prisma.shipment.createMany({
    data: [
      shipmentData(tenderShipmentId, 'TENDERED', 'TENDER'),
      shipmentData(podShipmentId, 'DELIVERED', 'POD'),
    ],
  });
  const pool = await prisma.capacityPool.create({
    data: {
      calendarSnapshot: {},
      carrierRef: 'CARRIER-A',
      carrierSnapshot: {},
      createdBy: administratorId,
      poolNo: `POOL-${randomUUID()}`,
      qualificationSnapshot: { qualified: true },
      regionCode: 'EAST',
      reservedPallets: 1,
      reservedVolumeBase: 10,
      reservedWeightBase: 10,
      serviceDate: now,
      sourceType: 'CONTRACT',
      tenantId,
      totalPallets: 10,
      totalVolumeBase: 100,
      totalWeightBase: 100,
      updatedBy: administratorId,
      vehicleType: 'VAN',
    },
  });
  const reservation = await prisma.capacityReservation.create({
    data: {
      capacityPoolId: pool.id,
      createdBy: administratorId,
      expiresAt: new Date(now.getTime() + 3_600_000),
      pallets: 1,
      reservationNo: `RES-${randomUUID()}`,
      shipmentId: tenderShipmentId,
      tenantId,
      updatedBy: administratorId,
      volumeBase: 10,
      weightBase: 10,
    },
  });
  const tender = await prisma.carrierTender.create({
    data: {
      capacityReservationId: reservation.id,
      carrierRef: 'CARRIER-A',
      carrierSnapshot: {},
      createdBy: administratorId,
      currency: 'CNY',
      expiresAt: new Date(now.getTime() + 3_600_000),
      priceAmount: 100,
      requirementSnapshot: {},
      shipmentId: tenderShipmentId,
      tenantId,
      tenderNo: `TEN-${randomUUID()}`,
      updatedBy: administratorId,
    },
  });
  const rejected = await post(
    request,
    token,
    `/api/v1/tms/capacity-tender/tenders/${tender.id}/respond`,
    {
      decision: 'REJECT',
      expectedVersion: tender.version,
      reason: '承运商无可用车辆',
    },
  );
  expect(rejected).toMatchObject({
    shipmentStatus: 'APPROVED',
    status: 'REJECTED',
  });
  const [released, restoredPool, restoredShipment, retender] =
    await Promise.all([
      prisma.capacityReservation.findUniqueOrThrow({
        where: { id: reservation.id },
      }),
      prisma.capacityPool.findUniqueOrThrow({ where: { id: pool.id } }),
      prisma.shipment.findUniqueOrThrow({ where: { id: tenderShipmentId } }),
      prisma.retenderCase.findFirstOrThrow({
        where: { originalTenderId: tender.id, tenantId },
      }),
    ]);
  expect(released).toMatchObject({
    releaseReason: 'TENDER_REJECTED',
    status: 'RELEASED',
  });
  expect(restoredPool.reservedWeightBase.toString()).toBe('0');
  expect(restoredPool.reservedVolumeBase.toString()).toBe('0');
  expect(restoredPool.reservedPallets.toString()).toBe('0');
  expect(restoredShipment.status).toBe('APPROVED');
  expect(retender).toMatchObject({
    reasonCode: 'CARRIER_REJECTED',
    status: 'OPEN',
  });
  expect(retender.originalPriceAmount.toString()).toBe('100');

  const confirmation = await prisma.deliveryConfirmation.create({
    data: {
      arrivedAt: now,
      confirmationNo: `DCF-${randomUUID()}`,
      createdBy: administratorId,
      deliveryLocationSnapshot: {},
      hasVariance: false,
      itemSummary: [],
      recipientName: '验收收货人',
      recipientSnapshot: {},
      shipmentId: podShipmentId,
      signatureSnapshot: {},
      signedAt: new Date(now.getTime() + 30_000),
      tenantId,
      unloadingCompletedAt: new Date(now.getTime() + 20_000),
      unloadingStartedAt: new Date(now.getTime() + 10_000),
      updatedBy: administratorId,
    },
  });
  const pod = await prisma.proofOfDelivery.create({
    data: {
      createdBy: administratorId,
      deliveryConfirmationId: confirmation.id,
      fileReferences: [{ objectId: 'P3-POD-OBJECT' }],
      pageCount: 1,
      podNo: `POD-${randomUUID()}`,
      shipmentId: podShipmentId,
      signatureSnapshot: {},
      submittedBy: administratorId,
      tenantId,
      updatedBy: administratorId,
    },
  });
  const reviewing = await post(
    request,
    token,
    `/api/v1/tms/delivery/pods/${pod.id}/review`,
    {
      checkSnapshot: {},
      decision: 'START',
      expectedVersion: pod.version,
      reason: '开始审核',
    },
  );
  const returned = await post(
    request,
    token,
    `/api/v1/tms/delivery/pods/${pod.id}/review`,
    {
      checkSnapshot: { clarityConfirmed: false },
      decision: 'RETURN',
      expectedVersion: Number(reviewing.version),
      reason: '影像不清晰，退回补件',
    },
  );
  expect(returned.status).toBe('RETURNED');
  const settle = await request.post(
    `/api/v1/tms/billing/shipments/${podShipmentId}/settle`,
    { data: { expectedVersion: 1 }, headers: headers(token, randomUUID()) },
  );
  const settleBody = await body(settle);
  expect(settle.status()).toBe(409);
  expect(settleBody.code).toBe('TMS_SETTLEMENT_POLICY_BLOCKED');
  expect(
    (await prisma.shipment.findUniqueOrThrow({ where: { id: podShipmentId } }))
      .status,
  ).toBe('DELIVERED');
  expect(
    await prisma.proofOfDelivery.findUniqueOrThrow({ where: { id: pod.id } }),
  ).toMatchObject({ status: 'RETURNED', version: 3 });
});
