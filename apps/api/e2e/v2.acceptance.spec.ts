import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const tenantId = '10000000-0000-4000-8000-000000000100';
const administratorId = '10000000-0000-4000-8000-000000000101';
const customerId = '82000000-0000-4000-8000-000000000202';
const addressId = '82000000-0000-4000-8000-000000000203';
const warehouseId = '82000000-0000-4000-8000-000000000204';
const productId = '82000000-0000-4000-8000-000000000206';
const ruleSetCode = 'V2_E2E_ALLOCATE';
const calendarCode = 'V2_E2E_RELEASE';
const passedScenarios = new Set<string>();

type JsonObject = Record<string, unknown>;

function headers(
  token: string,
  requestedTenantId = tenantId,
  idempotencyKey?: string,
) {
  return {
    Authorization: `Bearer ${token}`,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    'X-Correlation-Id': randomUUID(),
    'X-Tenant-Id': requestedTenantId,
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
  requestedTenantId = tenantId,
  idempotencyKey = randomUUID(),
) {
  const response = await request.post(path, {
    data,
    headers: headers(token, requestedTenantId, idempotencyKey),
  });
  const result = await body(response);
  expect(response.ok(), `${path}: ${JSON.stringify(result)}`).toBe(true);
  return result;
}

async function get(
  request: APIRequestContext,
  token: string,
  path: string,
  requestedTenantId = tenantId,
) {
  const response = await request.get(path, {
    headers: headers(token, requestedTenantId),
  });
  const result = await body(response);
  expect(response.ok(), `${path}: ${JSON.stringify(result)}`).toBe(true);
  return result;
}

async function login(
  request: APIRequestContext,
  tenantCode = 'PLATFORM',
  username = 'platform-admin',
) {
  const response = await request.post('/api/v1/auth/login', {
    data: {
      deviceId: `v2-e2e-${tenantCode.toLowerCase()}`,
      password: process.env.SEED_ADMIN_PASSWORD,
      tenantCode,
      username,
    },
    headers: { 'X-Correlation-Id': randomUUID() },
  });
  const result = await body(response);
  expect(response.ok(), JSON.stringify(result)).toBe(true);
  return String(result.accessToken);
}

async function poll<T>(
  label: string,
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 30_000,
): Promise<T> {
  const startedAt = Date.now();
  let last: T | undefined;
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      last = await read();
      if (accept(last)) return last;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `${label} timed out after ${timeoutMs}ms; last=${JSON.stringify(last)}; error=${lastError instanceof Error ? lastError.message : String(lastError ?? '')}`,
  );
}

async function createOrder(
  request: APIRequestContext,
  token: string,
  suffix: string,
) {
  return post(request, token, '/api/v1/oms/orders', {
    channel: 'API',
    currency: 'CNY',
    customerId,
    deliveryAddressId: addressId,
    externalOrderNo: `ERP-V2-${suffix}-${randomUUID()}`,
    externalVersion: '1',
    lines: [{ lineNo: 1, productId, quantity: '5', uom: 'EA' }],
    mappingVersion: 'v2-e2e-v1',
    rawPayload: { source: 'V2-E2E', suffix },
    requestedFrom: new Date(Date.now() + 3_600_000).toISOString(),
    requestedUntil: new Date(Date.now() + 86_400_000).toISOString(),
    totalAmount: '50',
    type: 'SALES',
  });
}

function eventEnvelope(event: {
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: number;
  correlationId: string;
  eventName: string;
  id: string;
  occurredAt: Date;
  payload: unknown;
  schemaVersion: number;
  traceId: string | null;
}) {
  return {
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    aggregateVersion: event.aggregateVersion,
    eventId: event.id,
    eventType: event.eventName,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
    schemaVersion: event.schemaVersion,
    traceId: event.traceId ?? event.correlationId,
  };
}

async function seedProduct() {
  await prisma.product.upsert({
    create: {
      baseUom: 'EA',
      createdBy: administratorId,
      currentVersionNumber: 1,
      id: productId,
      name: 'V2 E2E 验收商品',
      sku: 'V2-E2E-SKU',
      status: 'ACTIVE',
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: productId },
  });
  await prisma.productVersion.create({
    data: {
      createdBy: administratorId,
      id: '82000000-0000-4000-8000-000000000216',
      productId,
      sku: 'V2-E2E-SKU',
      snapshot: {
        baseUom: 'EA',
        grossWeight: '1',
        name: 'V2 E2E 验收商品',
        sku: 'V2-E2E-SKU',
        volume: '1',
      },
      tenantId,
      updatedBy: administratorId,
      versionNumber: 1,
    },
  });
  await prisma.packageSpec.create({
    data: {
      baseUom: 'EA',
      code: 'EA',
      createdBy: administratorId,
      id: '82000000-0000-4000-8000-000000000218',
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
  });
}

test.describe.serial('SCM V2 runtime closure', () => {
  test.beforeAll(async () => {
    // Test seed only: business outcomes below are produced through HTTP + Worker.
    await prisma.partner.create({
      data: {
        code: 'V2-E2E-CUSTOMER',
        createdBy: administratorId,
        id: customerId,
        legalName: 'V2 E2E 验收客户',
        status: 'ACTIVE',
        tenantId,
        updatedBy: administratorId,
      },
    });
    await prisma.partnerRole.create({
      data: {
        createdBy: administratorId,
        id: '82000000-0000-4000-8000-000000000215',
        partnerId: customerId,
        roleType: 'CUSTOMER',
        tenantId,
        updatedBy: administratorId,
      },
    });
    await prisma.partnerAddress.create({
      data: {
        addressType: 'DELIVERY',
        city: '上海',
        code: 'V2-E2E-SHIP-TO',
        countryCode: 'CN',
        createdBy: administratorId,
        geocodeStatus: 'VERIFIED',
        geocodedAt: new Date(),
        id: addressId,
        latitude: '31.23040000',
        longitude: '121.47370000',
        partnerId: customerId,
        rawText: '上海市 V2 验收路 1 号',
        tenantId,
        updatedBy: administratorId,
      },
    });
    await seedProduct();
    await prisma.warehouse.create({
      data: {
        code: 'V2-E2E-WH',
        createdBy: administratorId,
        id: warehouseId,
        name: 'V2 E2E 验收仓',
        status: 'ACTIVE',
        tenantId,
        timeZone: 'Asia/Shanghai',
        updatedBy: administratorId,
      },
    });
    const ruleSetId = '82000000-0000-4000-8000-000000000208';
    await prisma.ruleSet.create({
      data: {
        code: ruleSetCode,
        createdBy: administratorId,
        id: ruleSetId,
        name: 'V2 E2E 分配规则',
        publishedAt: new Date(),
        scenario: 'ALLOCATION',
        status: 'PUBLISHED',
        tenantId,
        updatedBy: administratorId,
        versionNumber: 1,
      },
    });
    await prisma.ruleDefinition.create({
      data: {
        code: 'INCLUDE_ALL',
        conditions: [],
        createdBy: administratorId,
        id: '82000000-0000-4000-8000-000000000212',
        name: '包含全部候选',
        priority: 1,
        result: { effect: 'INCLUDE', score: 1 },
        ruleSetId,
        tenantId,
        updatedBy: administratorId,
      },
    });
    const calendar = await prisma.businessCalendar.create({
      data: {
        code: calendarCode,
        createdBy: administratorId,
        effectiveFrom: new Date('2020-01-01'),
        effectiveUntil: new Date('2035-12-31'),
        id: '82000000-0000-4000-8000-000000000209',
        name: 'V2 E2E 发布日历',
        publishedAt: new Date(),
        status: 'ACTIVE',
        tenantId,
        timeZone: 'Asia/Shanghai',
        updatedBy: administratorId,
        versionNumber: 1,
        workingDays: [0, 1, 2, 3, 4, 5, 6],
      },
    });
    await prisma.workingWindow.create({
      data: {
        calendarId: calendar.id,
        createdBy: administratorId,
        cutoffTime: '23:59',
        id: '82000000-0000-4000-8000-000000000213',
        resourceId: warehouseId,
        resourceType: 'WAREHOUSE',
        tenantId,
        updatedBy: administratorId,
      },
    });
  });

  test.afterAll(async () => {
    const migrations = await prisma.$queryRaw<readonly { count: bigint }[]>`
      SELECT count(*)::bigint AS count
      FROM public._prisma_migrations
      WHERE finished_at IS NOT NULL
    `;
    console.log(
      `V2_E2E_RESULT=${JSON.stringify({
        commitSha: process.env.V2_COMMIT_SHA,
        migrations: Number(migrations[0]?.count ?? 0),
        p95: null,
        scenarioCount: passedScenarios.size,
        scenarios: [...passedScenarios],
        testCount: 5,
      })}`,
    );
    await prisma.$disconnect();
  });

  test('OMS release is automatically orchestrated once into WMS and TMS', async ({
    request,
  }) => {
    const token = await login(request);
    const created = await createOrder(request, token, 'ORCHESTRATION');
    expect(String(created.orderNo)).toMatch(/^OMS_BUSINESS_ORDER-\d{8}-\d{8}$/);
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
    await post(request, token, '/api/v1/oms/availability-projections', {
      baseUom: 'EA',
      onHand: '5',
      ownerId: customerId,
      productId,
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
    const released = await post(
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
    const fulfillmentId = String((released.fulfillmentIds as string[])[0]);
    const shipmentRef = String((released.shipmentRequestIds as string[])[0]);

    const automaticOutbound = await poll(
      'automatic WMS outbound',
      async () => {
        const workbench = await get(request, token, '/api/v1/wms/outbounds');
        return (workbench.orders as JsonObject[]).find(
          (candidate) => candidate.sourceRef === fulfillmentId,
        );
      },
      (value) => value?.status === 'RELEASED',
    );
    const transport = await poll(
      'automatic TMS order',
      async () => {
        const workbench = await get(
          request,
          token,
          `/api/v1/tms/transport-orders?query=${shipmentRef}`,
        );
        return (workbench.items as JsonObject[]).find(
          (candidate) => candidate.sourceRef === shipmentRef,
        );
      },
      (value) => Boolean(value),
    );
    await poll(
      'fulfillment process executing',
      async () => {
        const workbench = await get(
          request,
          token,
          '/api/v1/oms/fulfillment-processes',
        );
        return (workbench.items as JsonObject[]).find(
          (candidate) => candidate.id === released.processId,
        )?.status;
      },
      (value) => value === 'EXECUTING',
    );
    expect(String(automaticOutbound?.outboundNo)).toMatch(
      /^WMS_OUTBOUND-\d{8}-\d{8}$/,
    );
    expect(String(transport?.orderNo)).toMatch(
      /^TMS_TRANSPORT_ORDER-\d{8}-\d{8}$/,
    );

    const fulfillmentEvent = await prisma.platformOutbox.findFirstOrThrow({
      where: {
        aggregateId: fulfillmentId,
        eventName: 'fulfillment.released.v2',
        tenantId,
      },
    });
    const shipmentEvent = await prisma.platformOutbox.findFirstOrThrow({
      where: {
        aggregateId: shipmentRef,
        eventName: 'shipment.requested.v2',
        tenantId,
      },
    });
    await post(
      request,
      token,
      '/api/v1/wms/events/fulfillment-released',
      eventEnvelope(fulfillmentEvent),
    );
    await post(
      request,
      token,
      '/api/v1/tms/events/shipment-requested',
      eventEnvelope(shipmentEvent),
    );
    expect(
      await prisma.outboundOrder.count({
        where: { sourceRef: fulfillmentId, tenantId },
      }),
    ).toBe(1);
    expect(
      await prisma.transportOrder.count({
        where: { sourceRef: shipmentRef, tenantId },
      }),
    ).toBe(1);
    passedScenarios.add('oms-release-auto-wms-tms');
    passedScenarios.add('event-replay-idempotent');
    passedScenarios.add('business-number-unified');
  });

  test('delivery retries, dead letters, blocks its partition and replays in order', async ({
    request,
  }) => {
    const token = await login(request);
    const future = () => new Date(Date.now() + 60_000);

    const retryOrder = await createOrder(request, token, 'RETRY');
    const retryEvent = await prisma.platformOutbox.findFirstOrThrow({
      where: {
        aggregateId: String(retryOrder.orderId),
        eventName: 'order.created.v1',
        tenantId,
      },
    });
    await prisma.platformOutbox.update({
      data: { availableAt: future() },
      where: { id: retryEvent.id },
    });
    await prisma.platformOutbox.update({
      data: { availableAt: new Date() },
      where: { id: retryEvent.id },
    });
    const retryDelivery = await poll(
      'retry delivery created',
      () =>
        prisma.eventDelivery.findUnique({
          where: {
            tenantId_eventId_consumer: {
              consumer: 'oms.order-timeline.v1',
              eventId: retryEvent.id,
              tenantId,
            },
          },
        }),
      (value) => value?.status === 'PENDING',
    );
    const retryEndpoint = retryDelivery!.endpoint;
    await prisma.eventDelivery.update({
      data: { endpoint: '/api/v1/failure-injection', maxAttempts: 2 },
      where: { id: retryDelivery!.id },
    });
    await poll(
      'temporary consumer failure',
      () =>
        prisma.eventDelivery.findUniqueOrThrow({
          where: { id: retryDelivery!.id },
        }),
      (value) => value.status === 'FAILED' && value.attemptCount === 1,
    );
    await prisma.eventDelivery.update({
      data: { endpoint: retryEndpoint },
      where: { id: retryDelivery!.id },
    });
    await poll(
      'temporary consumer retry succeeds',
      () =>
        prisma.eventDelivery.findUniqueOrThrow({
          where: { id: retryDelivery!.id },
        }),
      (value) => value.status === 'PROCESSED' && value.attemptCount === 2,
    );

    const blockedOrder = await createOrder(request, token, 'DEAD-LETTER');
    const createdEvent = await prisma.platformOutbox.findFirstOrThrow({
      where: {
        aggregateId: String(blockedOrder.orderId),
        eventName: 'order.created.v1',
        tenantId,
      },
    });
    await prisma.platformOutbox.update({
      data: { availableAt: future() },
      where: { id: createdEvent.id },
    });
    const submitted = await post(
      request,
      token,
      `/api/v1/oms/orders/${String(blockedOrder.orderId)}/submit`,
      { expectedVersion: Number(blockedOrder.version) },
    );
    expect(submitted.status).toBe('OPEN');
    const submittedEvent = await prisma.platformOutbox.findFirstOrThrow({
      where: {
        aggregateId: String(blockedOrder.orderId),
        eventName: 'order.opened.v1',
        tenantId,
      },
    });
    await prisma.platformOutbox.update({
      data: { availableAt: future() },
      where: { id: submittedEvent.id },
    });
    await prisma.platformOutbox.updateMany({
      data: { availableAt: new Date() },
      where: { id: { in: [createdEvent.id, submittedEvent.id] } },
    });
    const first = await poll(
      'first EVERY_EVENT delivery created',
      () =>
        prisma.eventDelivery.findUnique({
          where: {
            tenantId_eventId_consumer: {
              consumer: 'oms.order-timeline.v1',
              eventId: createdEvent.id,
              tenantId,
            },
          },
        }),
      (value) => value?.status === 'PENDING',
    );
    await prisma.eventDelivery.update({
      data: { availableAt: future() },
      where: { id: first!.id },
    });
    const second = await poll(
      'second EVERY_EVENT delivery created',
      () =>
        prisma.eventDelivery.findUnique({
          where: {
            tenantId_eventId_consumer: {
              consumer: 'oms.order-timeline.v1',
              eventId: submittedEvent.id,
              tenantId,
            },
          },
        }),
      (value) => value?.status === 'PENDING',
    );
    await prisma.eventDelivery.update({
      data: { availableAt: future() },
      where: { id: second!.id },
    });
    const originalEndpoint = first!.endpoint;
    await prisma.eventDelivery.update({
      data: {
        availableAt: new Date(),
        endpoint: '/api/v1/failure-injection',
        maxAttempts: 1,
      },
      where: { id: first!.id },
    });
    await prisma.eventDelivery.update({
      data: { availableAt: new Date() },
      where: { id: second!.id },
    });
    const dead = await poll(
      'required delivery dead letter',
      () =>
        prisma.eventDelivery.findUniqueOrThrow({ where: { id: first!.id } }),
      (value) => value.status === 'DEAD_LETTER',
    );
    const deadEvent = await poll(
      'dead-letter event relayed',
      () =>
        prisma.platformOutbox.findFirst({
          where: {
            eventName: 'control.event-delivery-dead-lettered.v1',
            payload: { path: ['deliveryId'], equals: first!.id },
            tenantId,
          },
        }),
      (value) => value?.status === 'PUBLISHED',
    );
    await poll(
      'worker continued other partitions',
      () =>
        prisma.eventDelivery.count({
          where: { eventId: deadEvent!.id, status: 'PROCESSED', tenantId },
        }),
      (value) => value > 0,
    );
    expect(
      await prisma.eventDelivery.findUniqueOrThrow({
        where: { id: second!.id },
      }),
    ).toMatchObject({ attemptCount: 0, status: 'PENDING' });

    await post(
      request,
      token,
      `/api/v1/platform/events/deliveries/${first!.id}/replay`,
      { expectedVersion: dead.version },
    );
    await prisma.eventDelivery.update({
      data: { endpoint: originalEndpoint },
      where: { id: first!.id },
    });
    const completed = await poll(
      'partition resumes after manual replay',
      () =>
        prisma.eventDelivery.findMany({
          orderBy: { processedAt: 'asc' },
          where: { id: { in: [first!.id, second!.id] } },
        }),
      (value) =>
        value.length === 2 && value.every((row) => row.status === 'PROCESSED'),
    );
    expect(completed[0]!.id).toBe(first!.id);
    expect(
      await prisma.eventInbox.count({
        where: {
          consumer: 'oms.order-timeline.v1',
          eventId: { in: [createdEvent.id, submittedEvent.id] },
          status: 'PROCESSED',
          tenantId,
        },
      }),
    ).toBe(2);
    passedScenarios.add('consumer-temporary-failure-retry');
    passedScenarios.add('dead-letter-replay-partition-block');
    passedScenarios.add('delivery-order-every-event');
  });

  test('one restricted Worker discovers and processes two active tenants', async ({
    request,
  }) => {
    const token = await login(request);
    const provision = async (code: string) => {
      const tenant = await post(request, token, '/api/v1/platform/tenants', {
        code,
        currency: 'CNY',
        defaultLocale: 'zh-CN',
        initialAdmin: {
          displayName: `${code} Administrator`,
          password: process.env.SEED_ADMIN_PASSWORD,
          username: `${code.toLowerCase()}-admin`,
        },
        isolationMode: 'SHARED_SCHEMA',
        name: `${code} V2 Tenant`,
        timezone: 'Asia/Shanghai',
      });
      await post(
        request,
        token,
        `/api/v1/platform/tenants/${String(tenant.tenantId)}/transitions`,
        { expectedVersion: 1, targetStatus: 'ACTIVE' },
      );
      return String(tenant.tenantId);
    };
    const tenantA = await provision(
      `V2A${randomUUID().slice(0, 8).toUpperCase()}`,
    );
    const tenantB = await provision(
      `V2B${randomUUID().slice(0, 8).toUpperCase()}`,
    );
    const workerToken = process.env.WORKER_CONTROL_TOKEN!;
    await poll(
      'worker discovers both tenants',
      async () => {
        const response = await request.get('/api/v1/internal/worker/tenants', {
          headers: { Authorization: `Bearer ${workerToken}` },
        });
        expect(response.ok()).toBe(true);
        return ((await body(response)).items as JsonObject[]).map((item) =>
          String(item.tenantId),
        );
      },
      (items) => items.includes(tenantA) && items.includes(tenantB),
    );
    await Promise.all(
      [tenantA, tenantB].map((activeTenantId) =>
        poll(
          `worker processes ${activeTenantId}`,
          () =>
            prisma.eventDelivery.count({
              where: {
                status: 'PROCESSED',
                tenantId: activeTenantId,
              },
            }),
          (value) => value > 0,
        ),
      ),
    );
    const forbidden = await request.get('/api/v1/oms/orders', {
      headers: headers(workerToken, tenantA),
    });
    expect(forbidden.status()).toBe(403);
    expect(await body(forbidden)).toMatchObject({
      code: 'WORKER_OPERATION_FORBIDDEN',
    });
    passedScenarios.add('multi-tenant-worker');
    passedScenarios.add('worker-allowlist');
  });

  test('real external quota and webhook SSRF policy reject unsafe traffic', async ({
    request,
  }) => {
    const token = await login(request);
    const policy = await post(
      request,
      token,
      '/api/v1/integration/gateway/policies',
      {
        allowedIps: [],
        code: `V2-QUOTA-${Date.now()}`,
        dailyLimit: 10,
        maxRequestBytes: 10_000,
        name: 'V2 external heartbeat quota',
        perMinuteLimit: 2,
        requiredScopes: [],
        routePattern: '/api/v1/external/iot/heartbeat',
        sensitiveDailyLimit: 2,
      },
    );
    await post(
      request,
      token,
      `/api/v1/integration/gateway/policies/${String(policy.id)}/transition`,
      { expectedVersion: 1, target: 'ACTIVE' },
    );
    const credential = await post(
      request,
      token,
      '/api/v1/integration/gateway/credentials',
      { name: 'V2 quota API key', scopes: ['iot.write'], type: 'API_KEY' },
    );
    const gatewayHeaders = {
      'Content-Type': 'application/json',
      'X-Correlation-Id': randomUUID(),
      'X-SCM-API-Secret': String(credential.secret),
      'X-SCM-Key-Id': String(credential.keyId),
    };
    for (let index = 0; index < 2; index += 1) {
      const acceptedByGateway = await request.post(
        '/api/v1/external/iot/heartbeat',
        { data: {}, headers: gatewayHeaders },
      );
      expect(acceptedByGateway.status()).not.toBe(429);
      expect(acceptedByGateway.status()).not.toBe(401);
      expect(acceptedByGateway.status()).not.toBe(403);
    }
    const limited = await request.post('/api/v1/external/iot/heartbeat', {
      data: {},
      headers: { ...gatewayHeaders, 'X-Correlation-Id': randomUUID() },
    });
    expect(limited.status()).toBe(429);
    expect(await body(limited)).toMatchObject({
      code: 'GATEWAY_RATE_LIMIT_EXCEEDED',
    });

    for (const endpointUrl of [
      'https://169.254.169.254/latest/meta-data',
      'https://127.0.0.1/internal',
      'https://[::1]/internal',
    ]) {
      const rejected = await request.post(
        '/api/v1/integration/exchange/webhooks',
        {
          data: {
            endpointUrl,
            eventTypes: ['order.released.v1'],
            name: 'V2 SSRF probe',
          },
          headers: headers(token, tenantId, randomUUID()),
        },
      );
      expect(rejected.status()).toBe(400);
      expect(await body(rejected)).toMatchObject({
        code: 'WEBHOOK_ENDPOINT_FORBIDDEN',
      });
    }
    passedScenarios.add('gateway-real-request-quota');
    passedScenarios.add('webhook-ssrf');
  });

  test('browser deep links render independent narrow-screen terminals', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    const webUrl = process.env.V2_WEB_URL ?? 'http://127.0.0.1:4173';
    for (const [path, title] of [
      ['/portal/customer', '客户门户'],
      ['/portal/partner', '伙伴门户'],
      ['/driver', '司机执行端'],
      ['/rf', '仓储 RF 端'],
    ] as const) {
      await page.goto(`${webUrl}${path}`);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: `${title}底部导航` }),
      ).toBeVisible();
    }
    await page.goto(`${webUrl}/platform/components`);
    await expect(
      page.getByRole('heading', { name: '统一业务组件' }),
    ).toBeVisible();
    passedScenarios.add('url-deep-link-mobile-shell');
  });
});
