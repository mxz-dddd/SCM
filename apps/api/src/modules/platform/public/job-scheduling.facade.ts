import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { JobService } from '../job.service';
import type { CommandMetadata } from '../tenant.service';

export interface DailyReconciliationSchedule {
  readonly code: string;
  readonly name: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AiOptimizationJobInput {
  readonly aggregateId: string;
  readonly kind: 'LOAD' | 'NETWORK' | 'ROUTE';
}

export interface OpsOperationJobInput {
  readonly aggregateId: string;
  readonly kind: 'ARCHIVE' | 'DR_DRILL' | 'PRIVACY' | 'TENANT_MIGRATION';
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

  async enqueueAiOptimization(
    input: AiOptimizationJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = 'CONTROL.AI.OPTIMIZATION';
    const current = await this.jobs.listDefinitions(context);
    const definition = current.find((item) => item.code === code);
    let definitionId = definition?.id;
    if (
      !definition ||
      definition.handler !== 'AI_OPTIMIZATION' ||
      definition.triggerType !== 'EVENT' ||
      definition.eventName !== 'control.ai-optimization-requested.v1' ||
      definition.status !== 'ACTIVE'
    ) {
      try {
        const saved = await this.jobs.saveDefinition(
          {
            backoffSeconds: 10,
            code,
            concurrencyLimit: 4,
            defaultPayload: {},
            eventName: 'control.ai-optimization-requested.v1',
            ...(definition
              ? {
                  expectedVersion: definition.version,
                  jobDefinitionId: definition.id,
                }
              : {}),
            handler: 'AI_OPTIMIZATION',
            maxAttempts: 3,
            name: '控制塔 AI 优化任务',
            status: 'ACTIVE',
            timeoutSeconds: 120,
            triggerType: 'EVENT',
          },
          context,
          {
            ...metadata,
            idempotencyKey: `${metadata.idempotencyKey ?? metadata.correlationId}:ai-definition`,
          },
        );
        definitionId = saved.jobDefinitionId;
      } catch (error) {
        const raced = (await this.jobs.listDefinitions(context)).find(
          (item) =>
            item.code === code &&
            item.handler === 'AI_OPTIMIZATION' &&
            item.triggerType === 'EVENT' &&
            item.eventName === 'control.ai-optimization-requested.v1' &&
            item.status === 'ACTIVE',
        );
        if (!raced) throw error;
        definitionId = raced.id;
      }
    }
    if (!definitionId)
      throw new Error('AI optimization job definition was not created');
    return this.jobs.trigger(
      definitionId,
      {
        payload: { aggregateId: input.aggregateId, kind: input.kind },
        triggerRef: `${input.kind}:${input.aggregateId}`,
      },
      context,
      {
        ...metadata,
        idempotencyKey: `${metadata.idempotencyKey ?? metadata.correlationId}:ai-run`,
      },
    );
  }

  async enqueueOpsOperation(
    input: OpsOperationJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = 'PLATFORM.OPS.OPERATION';
    const current = await this.jobs.listDefinitions(context);
    const definition = current.find((item) => item.code === code);
    let definitionId = definition?.id;
    if (
      !definition ||
      definition.handler !== 'OPS_OPERATION' ||
      definition.triggerType !== 'EVENT' ||
      definition.eventName !== 'platform.ops-operation-requested.v1' ||
      definition.status !== 'ACTIVE'
    ) {
      try {
        const saved = await this.jobs.saveDefinition(
          {
            backoffSeconds: 30,
            code,
            concurrencyLimit: 2,
            defaultPayload: {},
            eventName: 'platform.ops-operation-requested.v1',
            ...(definition
              ? {
                  expectedVersion: definition.version,
                  jobDefinitionId: definition.id,
                }
              : {}),
            handler: 'OPS_OPERATION',
            maxAttempts: 3,
            name: '平台运维异步任务',
            status: 'ACTIVE',
            timeoutSeconds: 1800,
            triggerType: 'EVENT',
          },
          context,
          {
            ...metadata,
            idempotencyKey: `${metadata.idempotencyKey ?? metadata.correlationId}:ops-definition`,
          },
        );
        definitionId = saved.jobDefinitionId;
      } catch (error) {
        const raced = (await this.jobs.listDefinitions(context)).find(
          (item) =>
            item.code === code &&
            item.handler === 'OPS_OPERATION' &&
            item.status === 'ACTIVE',
        );
        if (!raced) throw error;
        definitionId = raced.id;
      }
    }
    if (!definitionId)
      throw new Error('OPS operation job definition was not created');
    return this.jobs.trigger(
      definitionId,
      {
        payload: { aggregateId: input.aggregateId, kind: input.kind },
        triggerRef: `${input.kind}:${input.aggregateId}`,
      },
      context,
      {
        ...metadata,
        idempotencyKey: `${metadata.idempotencyKey ?? metadata.correlationId}:ops-run`,
      },
    );
  }
}
