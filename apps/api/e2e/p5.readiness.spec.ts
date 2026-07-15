import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const tenantId = '10000000-0000-4000-8000-000000000100';
const administratorId = '10000000-0000-4000-8000-000000000101';
const foreignTenantId = '50000000-0000-4000-8000-000000000100';
const foreignBackupId = '50000000-0000-4000-8000-000000000101';
const pickTaskId = '50000000-0000-4000-8000-000000000201';
const pickLineId = '50000000-0000-4000-8000-000000000202';
const locationId = '50000000-0000-4000-8000-000000000203';
const productId = '50000000-0000-4000-8000-000000000204';
const rfSamples = 50;

type JsonObject = Record<string, unknown>;
interface TimingSummary {
  readonly maximumMs: number;
  readonly p95Ms: number;
  readonly samples: number;
}

function headers(
  token: string,
  idempotencyKey?: string,
  requestedTenantId = tenantId,
) {
  return {
    Authorization: `Bearer ${token}`,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    'X-Correlation-Id': randomUUID(),
    'X-Tenant-Id': requestedTenantId,
  };
}

async function responseBody(
  response: Awaited<ReturnType<APIRequestContext['post']>>,
) {
  return (await response.json()) as JsonObject;
}

async function login(request: APIRequestContext) {
  const response = await request.post('/api/v1/auth/login', {
    data: {
      deviceId: 'p5-readiness',
      password: process.env.SEED_ADMIN_PASSWORD,
      tenantCode: 'PLATFORM',
      username: 'platform-admin',
    },
    headers: { 'X-Correlation-Id': randomUUID() },
  });
  const result = await responseBody(response);
  expect(response.ok(), JSON.stringify(result)).toBe(true);
  return String(result.accessToken);
}

async function measure(
  samples: number,
  concurrency: number,
  action: (index: number) => Promise<void>,
): Promise<TimingSummary> {
  const durations: number[] = [];
  for (let offset = 0; offset < samples; offset += concurrency) {
    const batch = Array.from(
      { length: Math.min(concurrency, samples - offset) },
      (_, index) => offset + index,
    );
    await Promise.all(
      batch.map(async (index) => {
        const startedAt = performance.now();
        await action(index);
        durations.push(performance.now() - startedAt);
      }),
    );
  }
  durations.sort((left, right) => left - right);
  return {
    maximumMs: Number(durations.at(-1)?.toFixed(2)),
    p95Ms: Number(
      durations[Math.ceil(durations.length * 0.95) - 1]!.toFixed(2),
    ),
    samples: durations.length,
  };
}

test.beforeAll(async () => {
  await prisma.opsBackupSet.upsert({
    create: {
      backupNo: 'P5-FOREIGN-BACKUP',
      createdBy: administratorId,
      environment: 'acceptance',
      id: foreignBackupId,
      policySnapshot: { scope: 'foreign-tenant-isolation' },
      targetRpoMinutes: 15,
      targetRtoMinutes: 60,
      tenantId: foreignTenantId,
      updatedBy: administratorId,
    },
    update: { updatedBy: administratorId },
    where: { id: foreignBackupId },
  });
  await prisma.pickTask.upsert({
    create: {
      containerCode: 'P5-RF-CONTAINER',
      createdBy: administratorId,
      id: pickTaskId,
      mode: 'EACH',
      startedAt: new Date(),
      status: 'IN_PROGRESS',
      taskNo: 'P5-RF-PERFORMANCE',
      tenantId,
      updatedBy: administratorId,
      waveId: randomUUID(),
    },
    update: {
      containerCode: 'P5-RF-CONTAINER',
      status: 'IN_PROGRESS',
      updatedBy: administratorId,
    },
    where: { id: pickTaskId },
  });
  await prisma.pickTaskLine.upsert({
    create: {
      allocationId: randomUUID(),
      balanceId: randomUUID(),
      createdBy: administratorId,
      id: pickLineId,
      outboundLineId: randomUUID(),
      outboundOrderId: randomUUID(),
      pickedBase: 0,
      productId,
      requiredBase: rfSamples,
      shortBase: 0,
      sourceLocationId: locationId,
      taskId: pickTaskId,
      tenantId,
      updatedBy: administratorId,
    },
    update: {
      pickedBase: 0,
      requiredBase: rfSamples,
      shortBase: 0,
      updatedBy: administratorId,
    },
    where: { id: pickLineId },
  });
});

test.afterAll(async () => prisma.$disconnect());

test('production latency budgets hold for list, command and RF confirmation', async ({
  request,
}) => {
  const token = await login(request);

  for (let index = 0; index < 3; index += 1) {
    const warmup = await request.get('/api/v1/platform/operations/workbench', {
      headers: headers(token),
    });
    expect(warmup.ok()).toBe(true);
  }

  const list = await measure(100, 10, async () => {
    const response = await request.get(
      '/api/v1/platform/operations/workbench',
      { headers: headers(token) },
    );
    expect(response.ok()).toBe(true);
  });
  const command = await measure(100, 10, async (index) => {
    const response = await request.post('/api/v1/platform/operations/signals', {
      data: {
        dimensions: { gate: 'P5-07', sample: index },
        domain: 'PLATFORM',
        signal: 'p5.readiness.command_latency',
        traceId: randomUUID(),
        unit: 'ms',
        value: index,
      },
      headers: headers(token, randomUUID()),
    });
    const result = await responseBody(response);
    expect(response.ok(), JSON.stringify(result)).toBe(true);
  });
  const rf = await measure(rfSamples, 1, async (index) => {
    const response = await request.post(
      `/api/v1/wms/pick-tasks/${pickTaskId}/scans`,
      {
        data: {
          deviceId: 'P5-RF-DEVICE',
          deviceSequence: String(index + 1),
          productId,
          quantityBase: '1',
          scannedAt: new Date().toISOString(),
          sourceLocationId: locationId,
          targetContainerCode: 'P5-RF-CONTAINER',
          taskLineId: pickLineId,
        },
        headers: headers(token, randomUUID()),
      },
    );
    const result = await responseBody(response);
    expect(response.ok(), JSON.stringify(result)).toBe(true);
    expect(result.outcome).toBe('ACCEPTED');
  });

  expect(list.p95Ms, JSON.stringify(list)).toBeLessThan(2_000);
  expect(command.p95Ms, JSON.stringify(command)).toBeLessThan(1_500);
  expect(rf.p95Ms, JSON.stringify(rf)).toBeLessThan(800);
  console.log(`P5_READINESS_METRICS=${JSON.stringify({ command, list, rf })}`);
});

test('cross-tenant header and resource references are denied', async ({
  request,
}) => {
  const token = await login(request);
  const mismatched = await request.get(
    '/api/v1/platform/operations/workbench',
    { headers: headers(token, undefined, foreignTenantId) },
  );
  expect(mismatched.status()).toBe(403);
  expect(await responseBody(mismatched)).toMatchObject({
    code: 'TENANT_CONTEXT_MISMATCH',
  });

  const transition = await request.post(
    `/api/v1/platform/operations/backups/${foreignBackupId}/transition`,
    {
      data: { expectedVersion: 1, status: 'RUNNING' },
      headers: headers(token, randomUUID()),
    },
  );
  expect(transition.status()).toBe(404);
  const foreignBackup = await prisma.opsBackupSet.findUniqueOrThrow({
    where: { id: foreignBackupId },
  });
  expect(foreignBackup).toMatchObject({ status: 'PLANNED', version: 1 });
});

test('dead-letter replay is state-safe and idempotent', async ({ request }) => {
  const token = await login(request);
  const event = await prisma.platformOutbox.create({
    data: {
      aggregateId: randomUUID(),
      aggregateType: 'P5ReadinessProbe',
      aggregateVersion: 1,
      attemptCount: 8,
      correlationId: randomUUID(),
      createdBy: administratorId,
      deadLetteredAt: new Date(),
      eventName: 'platform.readiness-probe.v1',
      lastError: 'P5 readiness replay probe',
      payload: { gate: 'P5-07' },
      status: 'DEAD_LETTER',
      tenantId,
      updatedBy: administratorId,
    },
  });
  const key = randomUUID();
  const replay = async (expectedVersion: number) =>
    request.post(`/api/v1/platform/events/outbox/${event.id}/replay`, {
      data: { expectedVersion },
      headers: headers(token, key),
    });

  const first = await replay(1);
  const firstBody = await responseBody(first);
  expect(first.ok(), JSON.stringify(firstBody)).toBe(true);
  expect(firstBody).toMatchObject({ status: 'PENDING', version: 2 });

  const repeated = await replay(1);
  expect(repeated.ok()).toBe(true);
  expect(await responseBody(repeated)).toEqual(firstBody);
  expect(
    await prisma.platformOutbox.findUniqueOrThrow({ where: { id: event.id } }),
  ).toMatchObject({ status: 'PENDING', version: 2 });

  const conflict = await replay(2);
  expect(conflict.status()).toBe(409);
  expect(await responseBody(conflict)).toMatchObject({
    code: 'IDEMPOTENCY_KEY_CONFLICT',
  });
});
