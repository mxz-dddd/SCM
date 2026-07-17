import { Worker } from 'bullmq';
import { getRedisConnection } from './connection';
import { startWorkerHealthServer } from './health-server';
import { runEventDeliveriesOnce } from './event-delivery';
import { HttpWorkerApi, processSystemJob } from './job-runner';
import { runRelayOnce } from './outbox-relay';
import { processPrintJob } from './print-runner';
import { TenantSupervisor } from './tenant-supervisor';
import { deliverWebhooksOnce } from './webhook-delivery';

const token = process.env.WORKER_CONTROL_TOKEN;
const actorId = process.env.WORKER_ACTOR_ID;
if (!token || token.length < 32)
  throw new Error('WORKER_CONTROL_TOKEN must contain at least 32 characters');
if (
  !actorId ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    actorId,
  )
)
  throw new Error('WORKER_ACTOR_ID must be a UUID');

const api = new HttpWorkerApi();
const supervisor = new TenantSupervisor(
  api,
  Number(process.env.WORKER_TENANT_CONCURRENCY ?? 4),
);
const healthServer = startWorkerHealthServer(() => supervisor.health());
const worker = new Worker('scm-system', (job) => processSystemJob(job, api), {
  connection: getRedisConnection(),
});
const printWorker = new Worker(
  'scm-print',
  (job) => processPrintJob(job, api),
  { connection: getRedisConnection(), concurrency: 4 },
);
const owner = (operation: string, tenantId: string) =>
  `${operation}:${process.pid}:${tenantId}`;
const timers: ReturnType<typeof setInterval>[] = [];
let stopping = false;

const interval = (name: string, fallback: number, minimum: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > 3_600_000)
    throw new Error(`${name} must be between ${minimum} and 3600000`);
  return value;
};

const periodic = (milliseconds: number, task: () => Promise<unknown>) => {
  const run = () => {
    if (stopping) return;
    void task().catch((error: unknown) =>
      console.error('worker.loop.failed', {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  };
  run();
  const timer = setInterval(run, milliseconds);
  timers.push(timer);
};

periodic(
  interval('WORKER_TENANT_REFRESH_INTERVAL_MS', 30_000, 500),
  async () => {
    await supervisor.refresh();
    console.info('worker.health', supervisor.health());
  },
);
periodic(interval('WORKER_RELAY_INTERVAL_MS', 1_000, 100), () =>
  supervisor.run('relay', (tenantId) =>
    runRelayOnce(tenantId, owner('relay', tenantId), api),
  ),
);
periodic(interval('WORKER_EVENT_DELIVERY_INTERVAL_MS', 500, 100), () =>
  supervisor.run('event-delivery', (tenantId) =>
    runEventDeliveriesOnce(tenantId, owner('delivery', tenantId), api),
  ),
);
periodic(interval('WORKER_WEBHOOK_INTERVAL_MS', 2_000, 100), () =>
  supervisor.run('webhook', (tenantId) =>
    deliverWebhooksOnce(tenantId, owner('webhook', tenantId), api),
  ),
);

worker.on('failed', (job, error) => {
  console.error('worker.job.failed', {
    jobId: job?.id,
    message: error.message,
    tenantId: job?.data?.tenantId,
  });
});

async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const timer of timers) clearInterval(timer);
  await supervisor.shutdown();
  await Promise.all([
    healthServer.close(),
    printWorker.close(),
    worker.close(),
  ]);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
