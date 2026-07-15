import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { JobService } from '../job.service';
import type { CommandMetadata } from '../tenant.service';

export interface DailyReconciliationSchedule {
  readonly code: string;
  readonly name: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

@Injectable()
export class JobSchedulingFacade {
  constructor(@Inject(JobService) private readonly jobs: JobService) {}

  async ensureDailyReconciliations(
    schedules: readonly DailyReconciliationSchedule[],
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const current = await this.jobs.listDefinitions(context);
    const results = [];
    for (const schedule of schedules) {
      const existing = current.find(({ code }) => code === schedule.code);
      if (
        existing &&
        existing.handler === 'RECONCILIATION' &&
        existing.triggerType === 'CRON' &&
        existing.cronExpression === '0 2 * * *' &&
        existing.status === 'ACTIVE' &&
        JSON.stringify(existing.defaultPayload) ===
          JSON.stringify(schedule.payload)
      ) {
        results.push({
          cronExpression: existing.cronExpression,
          jobDefinitionId: existing.id,
          runAt: null,
          status: existing.status,
          triggerType: existing.triggerType,
          version: existing.version,
        });
        continue;
      }
      results.push(
        await this.jobs.saveDefinition(
          {
            backoffSeconds: 60,
            code: schedule.code,
            concurrencyLimit: 1,
            cronExpression: '0 2 * * *',
            defaultPayload: schedule.payload,
            ...(existing
              ? {
                  expectedVersion: existing.version,
                  jobDefinitionId: existing.id,
                }
              : {}),
            handler: 'RECONCILIATION',
            maxAttempts: 3,
            name: schedule.name,
            status: 'ACTIVE',
            timeoutSeconds: 900,
            triggerType: 'CRON',
          },
          context,
          {
            ...metadata,
            idempotencyKey: `${metadata.idempotencyKey ?? metadata.correlationId}:${schedule.code}`,
          },
        ),
      );
    }
    return results;
  }

  async listDailyReconciliations(context: TenantContext) {
    return (await this.jobs.listDefinitions(context)).filter(({ code }) =>
      code.startsWith('CONTROL.DAILY_RECONCILIATION.'),
    );
  }
}
