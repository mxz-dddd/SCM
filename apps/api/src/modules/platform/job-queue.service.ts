import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

export interface EnqueueJobRunInput {
  readonly backoffSeconds: number;
  readonly handler: string;
  readonly jobRunId: string;
  readonly maxAttempts: number;
  readonly scheduledAt: Date;
  readonly tenantId: string;
}

export interface ScheduleJobDefinitionInput {
  readonly cronExpression: string | null;
  readonly jobDefinitionId: string;
  readonly runAt: Date | null;
  readonly status: 'ACTIVE' | 'PAUSED';
  readonly tenantId: string;
  readonly triggerType: 'CRON' | 'EVENT' | 'ONCE';
  readonly version: number;
}

@Injectable()
export class JobQueueService implements OnModuleDestroy {
  private readonly queue = new Queue('scm-system', {
    connection: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  });

  async enqueue(input: EnqueueJobRunInput): Promise<void> {
    await this.queue.add(
      input.handler,
      { jobRunId: input.jobRunId, tenantId: input.tenantId },
      {
        attempts: input.maxAttempts,
        backoff: { delay: input.backoffSeconds * 1000, type: 'exponential' },
        delay: Math.max(0, input.scheduledAt.getTime() - Date.now()),
        jobId: input.jobRunId,
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  async scheduleDefinition(input: ScheduleJobDefinitionInput): Promise<void> {
    const schedulerId = `definition_${input.jobDefinitionId}`;
    await this.queue.removeJobScheduler(schedulerId);
    await this.queue.remove(`${schedulerId}_once`).catch(() => undefined);
    if (input.status !== 'ACTIVE') return;
    const data = {
      jobDefinitionId: input.jobDefinitionId,
      tenantId: input.tenantId,
    };
    if (input.triggerType === 'CRON' && input.cronExpression) {
      await this.queue.upsertJobScheduler(
        schedulerId,
        { pattern: input.cronExpression },
        { data, name: 'SCHEDULE_TRIGGER' },
      );
    }
    if (input.triggerType === 'ONCE' && input.runAt) {
      await this.queue.add('SCHEDULE_TRIGGER', data, {
        delay: Math.max(0, input.runAt.getTime() - Date.now()),
        jobId: `${schedulerId}_once`,
        removeOnComplete: true,
        removeOnFail: 100,
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
