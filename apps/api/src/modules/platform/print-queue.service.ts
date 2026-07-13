import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class PrintQueueService implements OnModuleDestroy {
  private readonly queue = new Queue('scm-print', {
    connection: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  });

  async enqueue(printJobId: string, tenantId: string): Promise<void> {
    await this.queue.add('PRINT_JOB', { printJobId, tenantId }, {
      attempts: 3,
      backoff: { delay: 1000, type: 'exponential' },
      jobId: printJobId,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
