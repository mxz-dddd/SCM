import { Worker } from 'bullmq';
import { getRedisConnection } from './connection';
import { processSystemJob } from './job-runner';

const worker = new Worker(
  'scm-system',
  async (job) => processSystemJob(job),
  { connection: getRedisConnection() },
);

worker.on('failed', (job, error) => {
  console.error('worker.job.failed', {
    jobId: job?.id,
    message: error.message,
  });
});

async function shutdown() {
  await worker.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
