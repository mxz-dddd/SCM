import { Worker } from 'bullmq';
import { getRedisConnection } from './connection';
import { HttpWorkerApi, processSystemJob } from './job-runner';
import {
  BullEventPublisher,
  consumeBusinessEvent,
  runRelayOnce,
} from './outbox-relay';
import { processPrintJob } from './print-runner';
import { deliverWebhooksOnce } from './webhook-delivery';

const worker = new Worker('scm-system', async (job) => processSystemJob(job), {
  connection: getRedisConnection(),
});

const eventWorker = new Worker(
  'scm-events',
  async (job) => consumeBusinessEvent(job),
  { connection: getRedisConnection(), concurrency: 10 },
);

const printWorker = new Worker(
  'scm-print',
  async (job) => processPrintJob(job),
  { connection: getRedisConnection(), concurrency: 4 },
);

const relayApi = new HttpWorkerApi();
const relayPublisher = new BullEventPublisher();
const relayTenantId = process.env.WORKER_TENANT_ID;
const relayOwner = `relay:${process.pid}`;
const webhookOwner = `webhook:${process.pid}`;
let relayRunning = false;
const relayTimer =
  relayTenantId && process.env.WORKER_API_TOKEN
    ? setInterval(() => {
        if (relayRunning) return;
        relayRunning = true;
        void runRelayOnce(relayTenantId, relayOwner, relayApi, relayPublisher)
          .catch((error: unknown) => {
            console.error('worker.outbox-relay.failed', {
              message: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            relayRunning = false;
          });
      }, 1000)
    : undefined;
let webhookRunning = false;
const webhookTimer =
  relayTenantId && process.env.WORKER_API_TOKEN
    ? setInterval(() => {
        if (webhookRunning) return;
        webhookRunning = true;
        void deliverWebhooksOnce(relayTenantId, webhookOwner, relayApi)
          .catch((error: unknown) => {
            console.error('worker.webhook-delivery.failed', {
              message: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            webhookRunning = false;
          });
      }, 2000)
    : undefined;

worker.on('failed', (job, error) => {
  console.error('worker.job.failed', {
    jobId: job?.id,
    message: error.message,
  });
});

async function shutdown() {
  if (relayTimer) clearInterval(relayTimer);
  if (webhookTimer) clearInterval(webhookTimer);
  await relayPublisher.close();
  await eventWorker.close();
  await printWorker.close();
  await worker.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
