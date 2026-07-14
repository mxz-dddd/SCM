import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const tenantId = '10000000-0000-4000-8000-000000000100';
const administratorId = '10000000-0000-4000-8000-000000000101';
const administratorRoleId = '10000000-0000-4000-8000-000000000104';
const secondUserId = '20000000-0000-4000-8000-000000000201';
const customerId = '20000000-0000-4000-8000-000000000202';
const addressId = '20000000-0000-4000-8000-000000000203';
const warehouseId = '20000000-0000-4000-8000-000000000204';
const locationId = '20000000-0000-4000-8000-000000000205';
const primaryProductId = '20000000-0000-4000-8000-000000000206';
const concurrentProductId = '20000000-0000-4000-8000-000000000207';
const ruleSetCode = 'P2_E2E_ALLOCATE';
const calendarCode = 'P2_E2E_RELEASE';

type JsonObject = Record<string, unknown>;

function headers(token: string, idempotencyKey?: string) {
  return {
    Authorization: `Bearer ${token}`,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    'X-Correlation-Id': randomUUID(),
    'X-Tenant-Id': tenantId,
  };
}

async function json(response: Awaited<ReturnType<APIRequestContext['post']>>) {
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
  const result = await json(response);
  expect(response.ok(), `${path}: ${JSON.stringify(result)}`).toBe(true);
  return result;
}

async function get(request: APIRequestContext, token: string, path: string) {
  const response = await request.get(path, { headers: headers(token) });
  const result = await json(response);
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
  const result = await json(response);
  expect(response.ok(), JSON.stringify(result)).toBe(true);
  return String(result.accessToken);
}

async function seedProduct(
  productId: string,
  productVersionId: string,
  packageSpecId: string,
  sku: string,
) {
  await prisma.product.upsert({
    create: {
      baseUom: 'EA',
      createdBy: administratorId,
      currentVersionNumber: 1,
      id: productId,
      name: `${sku} 验收商品`,
      sku,
      status: 'ACTIVE',
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: productId },
  });
  await prisma.productVersion.upsert({
    create: {
      createdBy: administratorId,
      id: productVersionId,
      productId,
      sku,
      snapshot: {
        baseUom: 'EA',
        grossWeight: '1',
        name: `${sku} 验收商品`,
        sku,
        volume: '1',
      },
      tenantId,
      updatedBy: administratorId,
      versionNumber: 1,
    },
    update: { updatedBy: administratorId },
    where: { id: productVersionId },
  });
  await prisma.packageSpec.upsert({
    create: {
      baseUom: 'EA',
      code: 'EA',
      createdBy: administratorId,
      id: packageSpecId,
      level: 'EACH',
      name: '单件',
      originalUom: 'EA',
      productId,
      publishedAt: new Date(),
      quantityInBase: '1',
      status: 'PUBLISHED',
      tenantId,
      updatedBy: administratorId,
      versionNumber: 1,
    },
    update: { updatedBy: administratorId },
    where: { id: packageSpecId },
  });
}

async function createApprovedOrder(
  request: APIRequestContext,
  token: string,
  productId: string,
  quantity: string,
  suffix: string,
) {
  const created = await post(request, token, '/api/v1/oms/orders', {
    channel: 'API',
    currency: 'CNY',
    customerId,
    deliveryAddressId: addressId,
    externalOrderNo: `ERP-${suffix}`,
    externalVersion: '1',
    lines: [{ lineNo: 1, productId, quantity, uom: 'EA' }],
    mappingVersion: 'erp-p2-e2e-v1',
    rawPayload: { quantity, source: 'ERP', suffix },
    requestedFrom: new Date(Date.now() + 3_600_000).toISOString(),
    requestedUntil: new Date(Date.now() + 86_400_000).toISOString(),
    totalAmount: '50',
    type: 'SALES',
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
      username: 'p2-user-two',
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
      id: '20000000-0000-4000-8000-000000000214',
      roleId: administratorRoleId,
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: '20000000-0000-4000-8000-000000000214' },
  });
  await prisma.partner.upsert({
    create: {
      code: 'P2-E2E-CUSTOMER',
      createdBy: administratorId,
      id: customerId,
      legalName: 'P2 验收客户',
      status: 'ACTIVE',
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: customerId },
  });
  await prisma.partnerRole.upsert({
    create: {
      createdBy: administratorId,
      id: '20000000-0000-4000-8000-000000000215',
      partnerId: customerId,
      roleType: 'CUSTOMER',
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: '20000000-0000-4000-8000-000000000215' },
  });
  await prisma.partnerAddress.upsert({
    create: {
      addressType: 'DELIVERY',
      city: '上海',
      code: 'P2-E2E-SHIP-TO',
      countryCode: 'CN',
      createdBy: administratorId,
      geocodeStatus: 'VERIFIED',
      geocodedAt: new Date(),
      id: addressId,
      latitude: '31.23040000',
      longitude: '121.47370000',
      partnerId: customerId,
      rawText: '上海市 P2 验收路 1 号',
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: addressId },
  });
  await Promise.all([
    seedProduct(
      primaryProductId,
      '20000000-0000-4000-8000-000000000216',
      '20000000-0000-4000-8000-000000000218',
      'P2-E2E-PRIMARY',
    ),
    seedProduct(
      concurrentProductId,
      '20000000-0000-4000-8000-000000000217',
      '20000000-0000-4000-8000-000000000219',
      'P2-E2E-CONCURRENT',
    ),
  ]);
  await prisma.warehouse.upsert({
    create: {
      code: 'P2-E2E-WH',
      createdBy: administratorId,
      id: warehouseId,
      name: 'P2 验收仓',
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
      code: 'P2-E2E-A01',
      createdBy: administratorId,
      id: locationId,
      name: 'P2 验收储位',
      sequence: 1,
      status: 'ACTIVE',
      tenantId,
      type: 'LOCATION',
      updatedBy: administratorId,
      warehouseId,
    },
    update: { updatedBy: administratorId },
    where: { id: locationId },
  });
  const ruleSetId = '20000000-0000-4000-8000-000000000208';
  await prisma.ruleSet.upsert({
    create: {
      code: ruleSetCode,
      createdBy: administratorId,
      id: ruleSetId,
      name: 'P2 验收分配规则',
      publishedAt: new Date(),
      scenario: 'ALLOCATION',
      status: 'PUBLISHED',
      tenantId,
      updatedBy: administratorId,
      versionNumber: 1,
    },
    update: { updatedBy: administratorId },
    where: { id: ruleSetId },
  });
  await prisma.ruleDefinition.upsert({
    create: {
      code: 'INCLUDE_ALL',
      conditions: [],
      createdBy: administratorId,
      id: '20000000-0000-4000-8000-000000000212',
      name: '包含全部候选',
      priority: 1,
      result: { effect: 'INCLUDE', score: 1 },
      ruleSetId,
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: '20000000-0000-4000-8000-000000000212' },
  });
  const calendar = await prisma.businessCalendar.upsert({
    create: {
      code: calendarCode,
      createdBy: administratorId,
      effectiveFrom: new Date('2020-01-01'),
      effectiveUntil: new Date('2035-12-31'),
      name: 'P2 验收发布日历',
      publishedAt: new Date(),
      status: 'ACTIVE',
      id: '20000000-0000-4000-8000-000000000209',
      tenantId,
      timeZone: 'Asia/Shanghai',
      updatedBy: administratorId,
      versionNumber: 1,
      workingDays: [0, 1, 2, 3, 4, 5, 6],
    },
    update: { updatedBy: administratorId },
    where: { id: '20000000-0000-4000-8000-000000000209' },
  });
  await prisma.workingWindow.upsert({
    create: {
      calendarId: calendar.id,
      createdBy: administratorId,
      cutoffTime: '23:59',
      id: '20000000-0000-4000-8000-000000000213',
      resourceId: warehouseId,
      resourceType: 'WAREHOUSE',
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: '20000000-0000-4000-8000-000000000213' },
  });
});

test.afterAll(async () => prisma.$disconnect());

test('场景① ERP 订单贯通审核、分配、波次、拣包、装运与事件回写', async ({
  request,
}) => {
  const token = await login(request, 'platform-admin', 'P2-E2E-RF-01');
  const orderPayload = {
    channel: 'API',
    currency: 'CNY',
    customerId,
    deliveryAddressId: addressId,
    externalOrderNo: 'ERP-P2-E2E-FULL-01',
    externalVersion: '1',
    lines: [
      { lineNo: 1, productId: primaryProductId, quantity: '5', uom: 'EA' },
    ],
    mappingVersion: 'erp-p2-e2e-v1',
    rawPayload: { externalOrderNo: 'ERP-P2-E2E-FULL-01', revision: 1 },
    requestedFrom: new Date(Date.now() + 3_600_000).toISOString(),
    requestedUntil: new Date(Date.now() + 86_400_000).toISOString(),
    totalAmount: '50',
    type: 'SALES',
  };
  const createKey = randomUUID();
  const created = await post(
    request,
    token,
    '/api/v1/oms/orders',
    orderPayload,
    createKey,
  );
  const replayedCreate = await post(
    request,
    token,
    '/api/v1/oms/orders',
    orderPayload,
    createKey,
  );
  expect(replayedCreate).toEqual(created);
  const conflict = await request.post('/api/v1/oms/orders', {
    data: { ...orderPayload, totalAmount: '51' },
    headers: headers(token, createKey),
  });
  expect(conflict.status()).toBe(409);

  const submitted = await post(
    request,
    token,
    `/api/v1/oms/orders/${String(created.orderId)}/submit`,
    { expectedVersion: Number(created.version) },
  );
  const approved = await post(
    request,
    token,
    `/api/v1/oms/orders/${String(created.orderId)}/review`,
    {
      autoApproveLimit: '10000',
      creditAvailable: '10000',
      expectedVersion: Number(submitted.version),
    },
  );
  expect(approved.status).toBe('APPROVED');

  await post(request, token, '/api/v1/oms/availability-projections', {
    baseUom: 'EA',
    onHand: '5',
    ownerId: customerId,
    productId: primaryProductId,
    snapshotAt: new Date().toISOString(),
    sourceVersion: 1,
    uncertainty: 'CONFIRMED',
    warehouseId,
  });
  const allocation = await post(
    request,
    token,
    `/api/v1/oms/orders/${String(created.orderId)}/allocations`,
    {
      expectedVersion: Number(approved.version),
      ownerId: customerId,
      ruleSetCode,
    },
  );
  expect(allocation.status).toBe('ALLOCATED');
  const releasedOrder = await post(
    request,
    token,
    `/api/v1/oms/orders/${String(created.orderId)}/release`,
    {
      calendarCode,
      expectedVersion: Number(allocation.version),
      serviceLevel: 'NEXT_DAY',
      weight: '5',
      weightUom: 'KG',
    },
  );
  expect(releasedOrder.status).toBe('RELEASED');
  const fulfillmentId = String((releasedOrder.fulfillmentIds as string[])[0]);
  const shipmentRef = String((releasedOrder.shipmentRequestIds as string[])[0]);

  const stock = await post(request, token, '/api/v1/wms/inventory/receipts', {
    baseUom: 'EA',
    businessRef: fulfillmentId,
    businessType: 'OMS_FULFILLMENT',
    locationId,
    originalUom: 'EA',
    ownerId: customerId,
    productId: primaryProductId,
    quantityBase: '5',
    quantityOriginal: '5',
    status: 'AVAILABLE',
    warehouseId,
  });
  const outbound = await post(request, token, '/api/v1/wms/outbounds', {
    carrierMode: 'ROAD',
    customerId,
    cutoffAt: new Date(Date.now() + 86_400_000).toISOString(),
    destinationSnapshot: { addressId, city: '上海' },
    lines: [
      {
        baseUom: 'EA',
        lineNo: 1,
        originalUom: 'EA',
        productId: primaryProductId,
        quantityBase: '5',
        quantityOriginal: '5',
      },
    ],
    ownerId: customerId,
    routeCode: 'P2-E2E-ROUTE',
    serviceLevel: 'NEXT_DAY',
    sourceRef: fulfillmentId,
    temperatureZone: 'AMBIENT',
    type: 'SALES',
    warehouseId,
  });
  const outboundReleased = await post(
    request,
    token,
    `/api/v1/wms/outbounds/${String(outbound.outboundId)}/release`,
    { expectedVersion: Number(outbound.version) },
  );
  expect(outboundReleased.status).toBe('RELEASED');
  const template = await post(request, token, '/api/v1/wms/wave-templates', {
    capacitySnapshot: {
      maxLines: 10,
      maxOrders: 10,
      maxQuantityBase: '100',
    },
    criteria: {
      carrierMode: 'ROAD',
      orderType: 'SALES',
      routeCode: 'P2-E2E-ROUTE',
      temperatureZone: 'AMBIENT',
    },
    name: 'P2 验收波次模板',
    strategy: {
      issueMethod: 'FIFO',
      minimumSplits: true,
      wholeHandlingUnitFirst: true,
    },
    warehouseId,
    workloadFactors: { perBase: '0.1', perLine: '1', perOrder: '2' },
  });
  const wave = await post(request, token, '/api/v1/wms/waves', {
    cutoffAt: new Date(Date.now() + 43_200_000).toISOString(),
    orderIds: [outbound.outboundId],
    templateId: template.templateId,
  });
  const planned = await post(
    request,
    token,
    `/api/v1/wms/waves/${String(wave.waveId)}/transition`,
    { expectedVersion: Number(wave.version), targetStatus: 'PLANNED' },
  );
  const waveReleased = await post(
    request,
    token,
    `/api/v1/wms/waves/${String(wave.waveId)}/transition`,
    { expectedVersion: Number(planned.version), targetStatus: 'RELEASED' },
  );

  const picking = await get(request, token, '/api/v1/wms/picking');
  const task = (picking.tasks as JsonObject[]).find(
    (candidate) => candidate.outboundOrderId === outbound.outboundId,
  )!;
  const line = (picking.lines as JsonObject[]).find(
    (candidate) => candidate.taskId === task.id,
  )!;
  const containerCode = 'P2-E2E-TOTE-01';
  const assigned = await post(
    request,
    token,
    `/api/v1/wms/pick-tasks/${String(task.id)}/assign`,
    {
      assigneeId: administratorId,
      containerCode,
      expectedVersion: Number(task.version),
    },
  );
  const started = await post(
    request,
    token,
    `/api/v1/wms/pick-tasks/${String(task.id)}/start`,
    { expectedVersion: Number(assigned.version) },
  );
  expect(started.status).toBe('IN_PROGRESS');
  const scanPayload = {
    deviceId: 'P2-E2E-RF-01',
    deviceSequence: '1',
    productId: primaryProductId,
    quantityBase: '5',
    scannedAt: new Date().toISOString(),
    sourceLocationId: line.sourceLocationId,
    targetContainerCode: containerCode,
    taskLineId: line.id,
  };
  const scan = await post(
    request,
    token,
    `/api/v1/wms/pick-tasks/${String(task.id)}/scans`,
    scanPayload,
  );
  const scanReplay = await post(
    request,
    token,
    `/api/v1/wms/pick-tasks/${String(task.id)}/scans`,
    scanPayload,
  );
  expect(scanReplay).toMatchObject({
    confirmationId: scan.confirmationId,
    replayed: true,
  });

  const pickingAfterScan = await get(request, token, '/api/v1/wms/picking');
  const taskAfterScan = (pickingAfterScan.tasks as JsonObject[]).find(
    (candidate) => candidate.id === task.id,
  )!;
  const offlineCommand = {
    businessRef: String(task.id),
    businessVersion: Number(taskAfterScan.version),
    commandType: 'PICK_SCAN',
    deviceSequence: '2',
    idempotencyKey: 'P2-E2E-OFFLINE-SCAN-2',
    payload: { scanEventId: scan.scanEventId },
  };
  const offline = await post(
    request,
    token,
    '/api/v1/wms/offline-devices/P2-E2E-RF-01/sync',
    { commands: [offlineCommand] },
  );
  const offlineReplay = await post(
    request,
    token,
    '/api/v1/wms/offline-devices/P2-E2E-RF-01/sync',
    { commands: [offlineCommand] },
  );
  expect((offlineReplay.results as JsonObject[])[0]).toMatchObject({
    commandId: (offline.results as JsonObject[])[0]!.commandId,
    replayed: true,
  });

  const verified = await post(
    request,
    token,
    `/api/v1/wms/pick-tasks/${String(task.id)}/verify`,
    {
      actualSnapshot: {
        containerCode,
        lines: [
          {
            productId: primaryProductId,
            quantityBase: '5',
            taskLineId: line.id,
          },
        ],
      },
      expectedVersion: Number(taskAfterScan.version),
      scopeRef: containerCode,
      scopeType: 'CONTAINER',
    },
  );
  expect(verified.status).toBe('PASSED');
  await post(
    request,
    token,
    `/api/v1/wms/waves/${String(wave.waveId)}/transition`,
    {
      expectedVersion: Number(waveReleased.version),
      targetStatus: 'COMPLETED',
    },
  );

  const pack = await post(
    request,
    token,
    `/api/v1/wms/outbounds/${String(outbound.outboundId)}/pack-tasks`,
    {
      boxes: [{ code: 'P2-E2E-BOX', maxVolume: '100', maxWeight: '100' }],
      materialSnapshot: { buffer: 'paper' },
      ruleSnapshot: {
        defaultUnitVolume: '1',
        defaultUnitWeight: '1',
        volumeTolerancePct: '10',
        weightTolerancePct: '10',
      },
      serviceSnapshot: { service: 'STANDARD_PACK' },
    },
  );
  const packageId = String((pack.packageIds as string[])[0]);
  await post(request, token, `/api/v1/wms/packages/${packageId}/measurements`, {
    deviceId: 'P2-E2E-SCALE-01',
    deviceSequence: '1',
    height: '1',
    length: '1',
    measuredAt: new Date().toISOString(),
    source: 'ELECTRONIC_SCALE',
    volume: '5',
    weight: '5',
    width: '1',
  });
  const packWorkbench = await get(request, token, '/api/v1/wms/pack-ship');
  const packageUnit = (packWorkbench.packages as JsonObject[]).find(
    (candidate) => candidate.id === packageId,
  )!;
  await post(request, token, `/api/v1/wms/packages/${packageId}/seal`, {
    expectedVersion: Number(packageUnit.version),
  });
  await post(request, token, `/api/v1/wms/packages/${packageId}/labels`, {
    contentRef: 's3://p2-e2e/labels/shipping-v1.pdf',
    labelType: 'SHIPPING',
    templateVersion: 'p2-e2e-carrier-v1',
  });
  await post(request, token, `/api/v1/wms/packages/${packageId}/stage`, {
    loadSequence: 1,
    maxVolume: '100',
    routeCode: 'P2-E2E-ROUTE',
    shipmentRef,
    stagingLocationId: locationId,
    tripRef: 'P2-E2E-TRIP-01',
  });
  const load = await post(
    request,
    token,
    `/api/v1/wms/outbounds/${String(outbound.outboundId)}/load-tasks`,
    {
      dockRef: 'P2-E2E-DOCK-01',
      maxVolume: '100',
      maxWeight: '100',
      sealNo: 'P2-E2E-SEAL-01',
      shipmentRef,
      vehicleRef: 'P2-E2E-VEHICLE-01',
    },
  );
  const loadScan = {
    deviceId: 'P2-E2E-RF-LOAD-01',
    deviceSequence: '1',
    dockRef: 'P2-E2E-DOCK-01',
    packageId,
    sealNo: 'P2-E2E-SEAL-01',
    vehicleRef: 'P2-E2E-VEHICLE-01',
  };
  const loaded = await post(
    request,
    token,
    `/api/v1/wms/load-tasks/${String(load.loadTaskId)}/confirm`,
    loadScan,
  );
  const loadedReplay = await post(
    request,
    token,
    `/api/v1/wms/load-tasks/${String(load.loadTaskId)}/confirm`,
    loadScan,
  );
  expect(loadedReplay).toMatchObject({
    confirmationId: loaded.confirmationId,
    replayed: true,
  });
  const afterLoad = await get(request, token, '/api/v1/wms/pack-ship');
  const loadedTask = (afterLoad.loads as JsonObject[]).find(
    (candidate) => candidate.id === load.loadTaskId,
  )!;
  const shipInput = {
    actualAt: new Date().toISOString(),
    expectedVersion: Number(loadedTask.version),
  };
  const [leftShip, rightShip] = await Promise.all([
    post(
      request,
      token,
      `/api/v1/wms/load-tasks/${String(load.loadTaskId)}/ship`,
      shipInput,
    ),
    post(
      request,
      token,
      `/api/v1/wms/load-tasks/${String(load.loadTaskId)}/ship`,
      shipInput,
    ),
  ]);
  expect(leftShip.dispatchId).toBe(rightShip.dispatchId);
  expect([leftShip.replayed, rightShip.replayed].sort()).toEqual([false, true]);

  const inventory = await get(
    request,
    token,
    `/api/v1/wms/inventory?productId=${primaryProductId}`,
  );
  const balance = (inventory.items as JsonObject[]).find(
    (candidate) => candidate.id === stock.balanceId,
  )!;
  expect(balance).toMatchObject({
    allocatedBase: '0',
    availableBase: '0',
    onHandBase: '0',
  });
  expect(
    await prisma.pickConfirmation.count({
      where: { taskId: String(task.id), tenantId },
    }),
  ).toBe(1);
  expect(
    await prisma.offlineCommand.count({
      where: { deviceId: 'P2-E2E-RF-01', tenantId },
    }),
  ).toBe(1);
  expect(
    await prisma.inventoryMovement.count({
      where: { balanceId: String(stock.balanceId), type: 'SHIPMENT', tenantId },
    }),
  ).toBe(1);
  expect(
    await prisma.platformOutbox.count({
      where: {
        aggregateId: String(outbound.outboundId),
        eventName: 'outbound.shipped.v1',
        tenantId,
      },
    }),
  ).toBe(1);
});

test('场景③ 两用户并发分配仅一方成功且可用量不超卖', async ({ request }) => {
  const [firstToken, secondToken] = await Promise.all([
    login(request, 'platform-admin', 'P2-E2E-CONCURRENT-01'),
    login(request, 'p2-user-two', 'P2-E2E-CONCURRENT-02'),
  ]);
  await post(request, firstToken, '/api/v1/oms/availability-projections', {
    baseUom: 'EA',
    onHand: '5',
    ownerId: customerId,
    productId: concurrentProductId,
    snapshotAt: new Date().toISOString(),
    sourceVersion: 1,
    uncertainty: 'CONFIRMED',
    warehouseId,
  });
  const [firstOrder, secondOrder] = await Promise.all([
    createApprovedOrder(
      request,
      firstToken,
      concurrentProductId,
      '4',
      'P2-E2E-CONCURRENT-01',
    ),
    createApprovedOrder(
      request,
      secondToken,
      concurrentProductId,
      '4',
      'P2-E2E-CONCURRENT-02',
    ),
  ]);
  const [first, second] = await Promise.all([
    post(
      request,
      firstToken,
      `/api/v1/oms/orders/${String(firstOrder.created.orderId)}/allocations`,
      {
        expectedVersion: Number(firstOrder.reviewed.version),
        ownerId: customerId,
        ruleSetCode,
      },
    ),
    post(
      request,
      secondToken,
      `/api/v1/oms/orders/${String(secondOrder.created.orderId)}/allocations`,
      {
        expectedVersion: Number(secondOrder.reviewed.version),
        ownerId: customerId,
        ruleSetCode,
      },
    ),
  ]);
  expect([first.status, second.status].sort()).toEqual(['ALLOCATED', 'FAILED']);
  const projections = await get(
    request,
    firstToken,
    `/api/v1/oms/availability?productId=${concurrentProductId}&ownerId=${customerId}`,
  );
  const projection = (projections.items as JsonObject[])[0]!;
  expect(projection.allocated).toBe('4');
  expect(
    await prisma.permissionDecisionAudit.count({
      where: {
        accountId: secondUserId,
        permissionCode: 'oms.order.allocate',
        tenantId,
      },
    }),
  ).toBe(1);
});
