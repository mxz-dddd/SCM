import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { PrismaClient, type ControlReconciliationType } from '@prisma/client';

const prisma = new PrismaClient();
const tenantId = '10000000-0000-4000-8000-000000000100';
const administratorId = '10000000-0000-4000-8000-000000000101';
const partnerId = '40000000-0000-4000-8000-000000000201';
const contractId = '40000000-0000-4000-8000-000000000202';
const rateCardId = '40000000-0000-4000-8000-000000000203';
const historicalRateId = '40000000-0000-4000-8000-000000000204';
const occurredAt = '2030-07-10T10:00:00.000Z';

type JsonObject = Record<string, unknown>;

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
  data?: unknown,
  idempotencyKey = randomUUID(),
) {
  const response = await request.post(path, {
    ...(data === undefined ? {} : { data }),
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

async function login(request: APIRequestContext) {
  const response = await request.post('/api/v1/auth/login', {
    data: {
      deviceId: 'p4-acceptance',
      password: process.env.SEED_ADMIN_PASSWORD,
      tenantCode: 'PLATFORM',
      username: 'platform-admin',
    },
    headers: { 'X-Correlation-Id': randomUUID() },
  });
  const result = await body(response);
  expect(response.ok(), JSON.stringify(result)).toBe(true);
  return String(result.accessToken);
}

test.beforeAll(async () => {
  await prisma.partner.upsert({
    create: {
      code: 'P4-E2E-CARRIER',
      createdBy: administratorId,
      id: partnerId,
      legalName: 'P4 验收承运商',
      status: 'ACTIVE',
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: partnerId },
  });
  await prisma.contract.upsert({
    create: {
      approvalInstanceId: randomUUID(),
      approvedAt: new Date('2029-01-01T00:00:00.000Z'),
      approvedBy: administratorId,
      code: 'P4-E2E-LINEHAUL',
      contractType: 'TRANSPORT',
      createdBy: administratorId,
      currency: 'CNY',
      effectiveFrom: new Date('2029-01-01T00:00:00.000Z'),
      effectiveUntil: new Date('2040-01-01T00:00:00.000Z'),
      id: contractId,
      name: 'P4 费率历史验收合同',
      partnerId,
      partnerSnapshot: { code: 'P4-E2E-CARRIER' },
      status: 'ACTIVE',
      tenantId,
      terms: { organizationRef: tenantId, priority: 100 },
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: contractId },
  });
  await prisma.rateCard.upsert({
    create: {
      code: 'P4-E2E-RATE',
      contractId,
      createdBy: administratorId,
      id: rateCardId,
      name: 'P4 历史费率卡',
      serviceType: 'LINEHAUL',
      tenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: rateCardId },
  });
  await prisma.rateVersion.upsert({
    create: {
      baseRate: '10',
      createdBy: administratorId,
      currency: 'CNY',
      dimensionHash: '4'.repeat(64),
      dimensions: { route: 'SHA-SUZ' },
      effectiveFrom: new Date('2029-01-01T00:00:00.000Z'),
      effectiveUntil: new Date('2040-01-01T00:00:00.000Z'),
      id: historicalRateId,
      pricing: {
        basis: 'BASE_QUANTITY',
        priority: 100,
        rounding: { mode: 'HALF_UP', scale: 2 },
        unitRate: '10',
      },
      publishedAt: new Date('2029-01-01T00:00:00.000Z'),
      rateCardId,
      status: 'PUBLISHED',
      tenantId,
      updatedBy: administratorId,
      versionNumber: 1,
    },
    update: { updatedBy: administratorId },
    where: { id: historicalRateId },
  });
});

test.afterAll(async () => prisma.$disconnect());

test('scenario 6 keeps the historical voucher and explains a new rate calculation version', async ({
  request,
}) => {
  const token = await login(request);
  const fact = await post(request, token, '/api/v1/billing/facts', {
    aggregateRef: 'SHIP-P4-E2E-001',
    businessRef: 'SHIP-P4-E2E-001',
    chargeType: 'TRANSPORT_LINEHAUL',
    currency: 'CNY',
    dimensions: { route: 'SHA-SUZ' },
    eventId: `event-${randomUUID()}`,
    occurredAt,
    organizationRef: tenantId,
    partyRef: partnerId,
    quantityBase: '2',
    quantityBaseUom: 'TON',
    quantityOriginal: '2',
    quantityUom: 'TON',
    routeRef: 'SHA-SUZ',
    serviceType: 'LINEHAUL',
    sourceDomain: 'TMS',
    sourceEventType: 'shipment.delivered.v1',
    sourceSnapshot: { shipmentNo: 'SHIP-P4-E2E-001' },
  });
  expect(fact.selectedRateVersionId).toBe(historicalRateId);
  const firstCalculation = await post(
    request,
    token,
    '/api/v1/billing/calculations',
    {
      chargeFactId: fact.chargeFactId,
      direction: 'PAYABLE',
      tax: { mode: 'EXCLUSIVE', rate: '0' },
    },
  );
  expect(firstCalculation).toMatchObject({
    calculationVersion: 1,
    totalAmount: '20',
  });
  const voucher = await post(request, token, '/api/v1/billing/vouchers', {
    approvalThreshold: '1000',
    businessType: 'TRANSPORT_LINEHAUL',
    calculationIds: [firstCalculation.calculationId],
    direction: 'PAYABLE',
    partnerRef: partnerId,
    periodFrom: '2030-07-01',
    periodTo: '2030-07-31',
  });
  const calculatedVoucher = await post(
    request,
    token,
    `/api/v1/billing/vouchers/${String(voucher.voucherId)}/calculate`,
    { expectedVersion: voucher.version },
  );
  const approvedVoucher = await post(
    request,
    token,
    `/api/v1/billing/vouchers/${String(voucher.voucherId)}/validate`,
    { expectedVersion: calculatedVoucher.version },
  );
  expect(approvedVoucher).toMatchObject({ status: 'APPROVED' });

  const retired = await post(
    request,
    token,
    `/api/v1/mdm/rate-versions/${historicalRateId}/RETIRED`,
    { expectedVersion: 1 },
  );
  expect(retired.status).toBe('RETIRED');
  const newRate = await post(request, token, '/api/v1/mdm/rate-versions', {
    baseRate: '15',
    currency: 'CNY',
    dimensions: { route: 'SHA-SUZ' },
    effectiveFrom: '2029-01-01T00:00:00.000Z',
    effectiveUntil: '2040-01-01T00:00:00.000Z',
    pricing: {
      basis: 'BASE_QUANTITY',
      priority: 200,
      rounding: { mode: 'HALF_UP', scale: 2 },
      unitRate: '15',
    },
    rateCardId,
  });
  expect(newRate).toMatchObject({ status: 'DRAFT', versionNumber: 2 });
  await post(
    request,
    token,
    `/api/v1/mdm/rate-versions/${String(newRate.rateVersionId)}/PUBLISHED`,
    { expectedVersion: newRate.version },
  );
  const correction = await post(
    request,
    token,
    `/api/v1/billing/facts/${String(fact.chargeFactId)}/corrections`,
    {
      corrected: {
        dimensions: { rateReview: 'P4-E2E', route: 'SHA-SUZ' },
      },
      reason: '费率变更后按治理流程追加更正并重新匹配',
    },
  );
  expect(correction.selectedRateVersionId).toBe(newRate.rateVersionId);
  const recomputed = await post(
    request,
    token,
    '/api/v1/billing/calculations',
    {
      chargeFactId: fact.chargeFactId,
      direction: 'PAYABLE',
      reason: 'P4 场景⑥费率重算',
      tax: { mode: 'EXCLUSIVE', rate: '0' },
    },
  );
  expect(recomputed).toMatchObject({
    calculationVersion: 2,
    totalAmount: '30',
  });

  const [storedVoucher, storedFirst, traces] = await Promise.all([
    prisma.settlementVoucher.findUniqueOrThrow({
      where: { id: String(voucher.voucherId) },
    }),
    prisma.billingCalculation.findUniqueOrThrow({
      where: { id: String(firstCalculation.calculationId) },
    }),
    prisma.calculationTrace.findMany({
      orderBy: { createdAt: 'asc' },
      where: {
        tenantId,
        calculationId: {
          in: [
            String(firstCalculation.calculationId),
            String(recomputed.calculationId),
          ],
        },
      },
    }),
  ]);
  expect(storedVoucher.status).toBe('APPROVED');
  expect(storedVoucher.totalAmount.toString()).toBe('20');
  expect(storedFirst.totalAmount.toString()).toBe('20');
  expect(traces).toHaveLength(2);
  expect(
    traces.map((trace) => ({
      output: (trace.outputSnapshot as JsonObject).totalAmount,
      rateVersion: (trace.rateVersionSnapshot as JsonObject).versionNumber,
      unitRate: (trace.expressionSnapshot as JsonObject).unitRate,
    })),
  ).toEqual([
    { output: '20', rateVersion: 1, unitRate: '10' },
    { output: '30', rateVersion: 2, unitRate: '15' },
  ]);
});

test('four daily reconciliation tasks run through real HTTP and open governed cases', async ({
  request,
}) => {
  const token = await login(request);
  const bootstrapped = await post(
    request,
    token,
    '/api/v1/control/reconciliations/schedules/bootstrap',
  );
  expect(bootstrapped.scheduleCount).toBe(4);
  const types: readonly ControlReconciliationType[] = [
    'ORDER_FULFILLMENT',
    'INVENTORY_MOVEMENT',
    'SHIPMENT_POD',
    'BILLING_VOUCHER',
  ];
  for (const type of types) {
    for (const [suffix, sourceMetrics, targetMetrics] of [
      [
        'MATCH',
        { count: 1, status: 'COMPLETED' },
        { count: 1, status: 'COMPLETED' },
      ],
      [
        'DIFF',
        { count: 2, status: 'COMPLETED' },
        { count: 1, status: 'PENDING' },
      ],
    ] as const) {
      const businessRef = `${type}-${suffix}`;
      for (const [side, metrics, domain] of [
        ['SOURCE', sourceMetrics, 'SOURCE_DOMAIN'],
        ['TARGET', targetMetrics, 'TARGET_DOMAIN'],
      ] as const)
        await post(
          request,
          token,
          '/api/v1/control/reconciliations/events/consume',
          {
            aggregateId: randomUUID(),
            aggregateType: `${type}.${side}`,
            aggregateVersion: 1,
            eventId: randomUUID(),
            eventType: `${side === 'SOURCE' ? 'oms' : 'wms'}.reconciliation-observed.v1`,
            occurredAt,
            payload: {
              businessRef,
              reconciliation: {
                businessRef,
                metrics,
                side,
                sourceDomain: domain,
                sourceVersion: 1,
                type,
              },
            },
            schemaVersion: 1,
            traceId: 'p4-e2e-reconciliation',
          },
        );
    }
    const triggerRef = `p4-e2e-daily-${type}`;
    const run = await post(
      request,
      token,
      '/api/v1/control/reconciliations/runs',
      {
        periodEnd: '2030-07-11T00:00:00.000Z',
        periodStart: '2030-07-10T00:00:00.000Z',
        triggerRef,
        type,
      },
    );
    expect(run).toMatchObject({
      differenceCount: 1,
      matchedCount: 1,
      status: 'COMPLETED',
    });
    expect(
      await post(request, token, '/api/v1/control/reconciliations/runs', {
        periodEnd: '2030-07-11T00:00:00.000Z',
        periodStart: '2030-07-10T00:00:00.000Z',
        triggerRef,
        type,
      }),
    ).toMatchObject({ duplicate: true, status: 'COMPLETED' });
  }
  const workbench = await get(
    request,
    token,
    '/api/v1/control/reconciliations/workbench',
  );
  expect(workbench.schedules).toHaveLength(4);
  expect(workbench.runs).toHaveLength(4);
  expect(workbench.cases).toHaveLength(4);
  expect(
    (workbench.cases as JsonObject[]).every(({ status }) => status === 'OPEN'),
  ).toBe(true);
});
