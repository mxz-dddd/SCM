import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type JobRunStatus, type JobTriggerType } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import { JobQueueService } from './job-queue.service';
import type { CommandMetadata } from './tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;

export interface SaveJobDefinitionInput {
  readonly backoffSeconds?: number;
  readonly code: string;
  readonly concurrencyLimit?: number;
  readonly cronExpression?: string;
  readonly defaultPayload?: JsonObject;
  readonly eventName?: string;
  readonly expectedVersion?: number;
  readonly handler: string;
  readonly jobDefinitionId?: string;
  readonly maxAttempts?: number;
  readonly name: string;
  readonly runAt?: string;
  readonly status?: 'ACTIVE' | 'PAUSED';
  readonly timeoutSeconds?: number;
  readonly triggerType: JobTriggerType;
}

export interface TriggerJobInput {
  readonly payload?: JsonObject;
  readonly scheduledAt?: string;
  readonly triggerRef?: string;
}

export interface LeaseJobInput {
  readonly expectedVersion: number;
  readonly leaseOwner: string;
  readonly leaseSeconds?: number;
}

export interface ProgressJobInput {
  readonly expectedVersion: number;
  readonly leaseOwner: string;
  readonly message?: string;
  readonly progress: number;
}

export interface CompleteJobInput {
  readonly expectedVersion: number;
  readonly failureCode?: string;
  readonly leaseOwner: string;
  readonly result?: JsonObject;
  readonly resultFileObjectId?: string;
  readonly success: boolean;
  readonly timedOut?: boolean;
}

export interface CancelJobInput {
  readonly expectedVersion: number;
  readonly reason: string;
}

export interface HeartbeatJobInput {
  readonly expectedVersion: number;
  readonly leaseOwner: string;
  readonly leaseSeconds?: number;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{2,99}$/;
const EVENT_PATTERN = /^[a-z][a-z0-9.-]{2,149}\.v\d+$/;
const HANDLERS = new Set([
  'EXPORT',
  'IMPORT',
  'NOTIFICATION_RETRY',
  'RECONCILIATION',
  'REPORT',
  'SYSTEM_CLEANUP',
]);
const TERMINAL: readonly JobRunStatus[] = [
  'CANCELLED',
  'FAILED',
  'SUCCEEDED',
  'TIMED_OUT',
];

export function assertJobTransition(
  current: JobRunStatus,
  target: JobRunStatus,
): void {
  const allowed =
    (current === 'QUEUED' && ['RUNNING', 'CANCELLED'].includes(target)) ||
    (current === 'RUNNING' &&
      ['CANCEL_REQUESTED', 'FAILED', 'QUEUED', 'SUCCEEDED', 'TIMED_OUT'].includes(
        target,
      )) ||
    (current === 'CANCEL_REQUESTED' && target === 'CANCELLED');
  if (!allowed || TERMINAL.includes(current)) {
    throw new AppError(
      'JOB_TRANSITION_INVALID',
      `Job run transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

function parseDate(value: string | undefined, field: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError('JOB_DATE_INVALID', `${field} is invalid`, 400);
  }
  return parsed;
}

function validCron(value: string): boolean {
  const fields = value.trim().split(/\s+/);
  return (
    fields.length === 5 &&
    fields.every((field) => /^[0-9*/?,-]+$/.test(field))
  );
}

@Injectable()
export class JobService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(JobQueueService) private readonly queue: JobQueueService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  listDefinitions(context: TenantContext) {
    return this.prisma.jobDefinition.findMany({
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: 300,
      where: { tenantId: context.tenantId },
    });
  }

  listRuns(context: TenantContext, status?: string) {
    if (
      status &&
      ![
        'CANCELLED',
        'CANCEL_REQUESTED',
        'FAILED',
        'QUEUED',
        'RUNNING',
        'SUCCEEDED',
        'TIMED_OUT',
      ].includes(status)
    ) {
      throw new AppError('JOB_RUN_STATUS_INVALID', 'Job run status is invalid', 400);
    }
    return this.prisma.jobRun.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 300,
      where: { ...(status ? { status: status as never } : {}), tenantId: context.tenantId },
    });
  }

  listLogs(jobRunId: string, context: TenantContext) {
    return this.prisma.jobLog.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 2000,
      where: { jobRunId, tenantId: context.tenantId },
    });
  }

  async saveDefinition(
    input: SaveJobDefinitionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.code?.trim().toUpperCase();
    const handler = input.handler?.trim().toUpperCase();
    const runAt = parseDate(input.runAt, 'runAt');
    const concurrencyLimit = input.concurrencyLimit ?? 1;
    const timeoutSeconds = input.timeoutSeconds ?? 300;
    const maxAttempts = input.maxAttempts ?? 3;
    const backoffSeconds = input.backoffSeconds ?? 30;
    if (
      !CODE_PATTERN.test(code) ||
      !HANDLERS.has(handler) ||
      !input.name?.trim() ||
      !['ONCE', 'CRON', 'EVENT'].includes(input.triggerType) ||
      (input.triggerType === 'ONCE' && !runAt) ||
      (input.triggerType === 'CRON' &&
        (!input.cronExpression || !validCron(input.cronExpression))) ||
      (input.triggerType === 'EVENT' &&
        (!input.eventName || !EVENT_PATTERN.test(input.eventName))) ||
      !Number.isInteger(concurrencyLimit) ||
      concurrencyLimit < 1 ||
      concurrencyLimit > 100 ||
      !Number.isInteger(timeoutSeconds) ||
      timeoutSeconds < 1 ||
      timeoutSeconds > 86_400 ||
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 20 ||
      !Number.isInteger(backoffSeconds) ||
      backoffSeconds < 1 ||
      backoffSeconds > 86_400 ||
      (input.jobDefinitionId !== undefined && !isUuid(input.jobDefinitionId))
    ) {
      throw new AppError('JOB_DEFINITION_INVALID', 'Job definition input is invalid', 400);
    }
    const result = await this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: input.jobDefinitionId ? 200 : 201,
        scope: 'platform.job-definition.save.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const existing = input.jobDefinitionId
          ? await transaction.jobDefinition.findFirst({
              where: { id: input.jobDefinitionId, tenantId: context.tenantId },
            })
          : null;
        if (input.jobDefinitionId && !existing) {
          throw new AppError('JOB_DEFINITION_NOT_FOUND', 'Job definition was not found', 404);
        }
        if (existing && existing.version !== input.expectedVersion) {
          throw this.versionConflict();
        }
        if (existing && existing.code !== code) {
          throw new AppError('JOB_DEFINITION_CODE_IMMUTABLE', 'Job definition code cannot change', 409);
        }
        const definition = existing
          ? await transaction.jobDefinition.update({
              data: {
                backoffSeconds,
                concurrencyLimit,
                cronExpression:
                  input.triggerType === 'CRON'
                    ? input.cronExpression!.trim()
                    : null,
                defaultPayload: (input.defaultPayload ?? {}) as Prisma.InputJsonObject,
                eventName:
                  input.triggerType === 'EVENT' ? input.eventName!.trim() : null,
                handler,
                maxAttempts,
                name: input.name.trim(),
                runAt: input.triggerType === 'ONCE' ? runAt : null,
                status: input.status ?? existing.status,
                timeoutSeconds,
                triggerType: input.triggerType,
                updatedBy: context.accountId,
                version: { increment: 1 },
              },
              where: { id: existing.id },
            })
          : await transaction.jobDefinition.create({
              data: {
                backoffSeconds,
                code,
                concurrencyLimit,
                cronExpression:
                  input.triggerType === 'CRON'
                    ? input.cronExpression!.trim()
                    : null,
                createdBy: context.accountId,
                defaultPayload: (input.defaultPayload ?? {}) as Prisma.InputJsonObject,
                eventName:
                  input.triggerType === 'EVENT' ? input.eventName!.trim() : null,
                handler,
                id: randomUUID(),
                maxAttempts,
                name: input.name.trim(),
                runAt: input.triggerType === 'ONCE' ? runAt : null,
                status: input.status ?? 'ACTIVE',
                tenantId: context.tenantId,
                timeoutSeconds,
                triggerType: input.triggerType,
                updatedBy: context.accountId,
              },
            });
        await this.record(
          transaction,
          definition.id,
          definition.version,
          existing ? 'job-definition.updated' : 'job-definition.created',
          'platform.job-definition-saved.v1',
          context,
          metadata,
          {
            code,
            handler,
            status: definition.status,
            triggerType: definition.triggerType,
          },
        );
        return {
          cronExpression: definition.cronExpression,
          jobDefinitionId: definition.id,
          runAt: definition.runAt?.toISOString() ?? null,
          status: definition.status,
          triggerType: definition.triggerType,
          version: definition.version,
        };
      },
    );
    await this.queue.scheduleDefinition({
      cronExpression: result.cronExpression,
      jobDefinitionId: result.jobDefinitionId,
      runAt: result.runAt ? new Date(result.runAt) : null,
      status: result.status,
      tenantId: context.tenantId,
      triggerType: result.triggerType,
      version: result.version,
    });
    return result;
  }

  async getRun(jobRunId: string, context: TenantContext) {
    const run = await this.prisma.jobRun.findFirst({
      where: { id: jobRunId, tenantId: context.tenantId },
    });
    if (!run) throw new AppError('JOB_RUN_NOT_FOUND', 'Job run was not found', 404);
    return run;
  }

  async triggerEvent(
    eventName: string,
    input: TriggerJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!EVENT_PATTERN.test(eventName)) {
      throw new AppError('JOB_EVENT_INVALID', 'Event name is invalid', 400);
    }
    const definitions = await this.prisma.jobDefinition.findMany({
      orderBy: { id: 'asc' },
      where: {
        eventName,
        status: 'ACTIVE',
        tenantId: context.tenantId,
        triggerType: 'EVENT',
      },
    });
    const runs = [];
    const eventKey = metadata.idempotencyKey
      ? createHash('sha256').update(metadata.idempotencyKey).digest('hex')
      : undefined;
    for (const definition of definitions) {
      runs.push(
        await this.trigger(definition.id, input, context, {
          ...metadata,
          idempotencyKey: eventKey ? `${eventKey}:${definition.id}` : undefined,
        }),
      );
    }
    return { accepted: true, eventName, runs };
  }

  async trigger(
    jobDefinitionId: string,
    input: TriggerJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const scheduledAt = parseDate(input.scheduledAt, 'scheduledAt') ?? new Date();
    const result = await this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { jobDefinitionId, ...input },
        responseCode: 202,
        scope: 'platform.job-run.trigger.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const definition = await transaction.jobDefinition.findFirst({
          where: { id: jobDefinitionId, tenantId: context.tenantId },
        });
        if (!definition) throw new AppError('JOB_DEFINITION_NOT_FOUND', 'Job definition was not found', 404);
        if (definition.status !== 'ACTIVE') {
          throw new AppError('JOB_DEFINITION_PAUSED', 'Job definition is paused', 409);
        }
        const jobRunId = randomUUID();
        const payload = {
          ...(definition.defaultPayload as JsonObject),
          ...(input.payload ?? {}),
        };
        await transaction.jobRun.create({
          data: {
            backoffSeconds: definition.backoffSeconds,
            createdBy: context.accountId,
            definitionVersion: definition.version,
            handler: definition.handler,
            id: jobRunId,
            jobDefinitionId: definition.id,
            maxAttempts: definition.maxAttempts,
            payload: payload as Prisma.InputJsonObject,
            scheduledAt,
            tenantId: context.tenantId,
            timeoutSeconds: definition.timeoutSeconds,
            triggerRef: input.triggerRef?.trim() || null,
            triggerType: definition.triggerType,
            updatedBy: context.accountId,
          },
        });
        await this.log(transaction, jobRunId, 'INFO', 'Job run queued', {}, context);
        await this.record(
          transaction,
          jobRunId,
          1,
          'job-run.queued',
          'platform.job-run-queued.v1',
          context,
          metadata,
          { handler: definition.handler, scheduledAt: scheduledAt.toISOString(), status: 'QUEUED' },
        );
        return {
          accepted: true,
          backoffSeconds: definition.backoffSeconds,
          handler: definition.handler,
          jobRunId,
          maxAttempts: definition.maxAttempts,
          scheduledAt: scheduledAt.toISOString(),
          status: 'QUEUED',
          version: 1,
        };
      },
    );
    await this.queue.enqueue({
      backoffSeconds: result.backoffSeconds,
      handler: result.handler,
      jobRunId: result.jobRunId,
      maxAttempts: result.maxAttempts,
      scheduledAt: new Date(result.scheduledAt),
      tenantId: context.tenantId,
    });
    return result;
  }

  claim(
    jobRunId: string,
    input: LeaseJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const leaseSeconds = input.leaseSeconds ?? 60;
    if (
      !isUuid(jobRunId) ||
      !input.leaseOwner?.trim() ||
      input.leaseOwner.length > 200 ||
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 10 ||
      leaseSeconds > 3600
    ) {
      throw new AppError('JOB_LEASE_INVALID', 'Job lease input is invalid', 400);
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { jobRunId, ...input },
        responseCode: 200,
        scope: 'platform.job-run.claim.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const run = await transaction.jobRun.findFirst({
          where: { id: jobRunId, tenantId: context.tenantId },
        });
        if (!run) throw new AppError('JOB_RUN_NOT_FOUND', 'Job run was not found', 404);
        const staleLease =
          run.status === 'RUNNING' &&
          run.leaseExpiresAt !== null &&
          run.leaseExpiresAt <= new Date();
        if (
          (run.status !== 'QUEUED' && !staleLease) ||
          run.version !== input.expectedVersion
        ) {
          throw this.versionConflict();
        }
        if (run.status === 'QUEUED' && run.scheduledAt > new Date()) {
          throw new AppError('JOB_RUN_NOT_READY', 'Job run is not scheduled yet', 409, {
            retryable: true,
          });
        }
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${context.tenantId}:${run.jobDefinitionId}`}))`;
        const definition = await transaction.jobDefinition.findFirst({
          where: { id: run.jobDefinitionId, tenantId: context.tenantId },
        });
        const running = await transaction.jobRun.count({
          where: {
            id: { not: run.id },
            jobDefinitionId: run.jobDefinitionId,
            status: { in: ['RUNNING', 'CANCEL_REQUESTED'] },
            tenantId: context.tenantId,
          },
        });
        if (!definition || running >= definition.concurrencyLimit) {
          throw new AppError('JOB_CONCURRENCY_LIMIT', 'Job concurrency limit is reached', 409, {
            retryable: true,
          });
        }
        if (run.status === 'QUEUED') assertJobTransition(run.status, 'RUNNING');
        const now = new Date();
        const changed = await transaction.jobRun.updateMany({
          data: {
            attempt: { increment: 1 },
            heartbeatAt: now,
            leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000),
            leaseOwner: input.leaseOwner.trim(),
            startedAt: run.startedAt ?? now,
            status: 'RUNNING',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: run.id, status: run.status, version: run.version },
        });
        if (changed.count !== 1) throw this.versionConflict();
        await this.log(
          transaction,
          run.id,
          'INFO',
          staleLease ? 'Expired job lease recovered' : 'Job lease acquired',
          { leaseOwner: input.leaseOwner },
          context,
        );
        await this.record(
          transaction,
          run.id,
          run.version + 1,
          staleLease ? 'job-run.lease-recovered' : 'job-run.started',
          staleLease
            ? 'platform.job-run-lease-recovered.v1'
            : 'platform.job-run-started.v1',
          context,
          metadata,
          { attempt: run.attempt + 1, status: 'RUNNING' },
          { status: run.status },
        );
        return {
          attempt: run.attempt + 1,
          jobRunId: run.id,
          leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
          payload: run.payload,
          status: 'RUNNING',
          timeoutSeconds: run.timeoutSeconds,
          version: run.version + 1,
        };
      },
    );
  }

  progress(
    jobRunId: string,
    input: ProgressJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !Number.isInteger(input.progress) ||
      input.progress < 0 ||
      input.progress > 100 ||
      !input.leaseOwner?.trim() ||
      (input.message?.length ?? 0) > 1000
    ) {
      throw new AppError('JOB_PROGRESS_INVALID', 'Job progress input is invalid', 400);
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { jobRunId, ...input },
        responseCode: 200,
        scope: 'platform.job-run.progress.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const run = await this.findRun(transaction, jobRunId, context);
        this.assertLease(run, input.leaseOwner, input.expectedVersion);
        if (input.progress < run.progress) {
          throw new AppError('JOB_PROGRESS_REGRESSION', 'Job progress cannot decrease', 409);
        }
        await transaction.jobRun.update({
          data: {
            heartbeatAt: new Date(),
            progress: input.progress,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: run.id },
        });
        if (input.message) {
          await this.log(transaction, run.id, 'INFO', input.message, { progress: input.progress }, context);
        }
        return { jobRunId: run.id, progress: input.progress, status: run.status, version: run.version + 1 };
      },
    );
  }

  heartbeat(
    jobRunId: string,
    input: HeartbeatJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const leaseSeconds = input.leaseSeconds ?? 60;
    if (
      !input.leaseOwner?.trim() ||
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 10 ||
      leaseSeconds > 3600
    ) {
      throw new AppError('JOB_HEARTBEAT_INVALID', 'Job heartbeat input is invalid', 400);
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { jobRunId, ...input },
        responseCode: 200,
        scope: 'platform.job-run.heartbeat.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const run = await this.findRun(transaction, jobRunId, context);
        this.assertLease(run, input.leaseOwner, input.expectedVersion);
        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
        await transaction.jobRun.update({
          data: {
            heartbeatAt: now,
            leaseExpiresAt,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: run.id },
        });
        return {
          jobRunId: run.id,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          status: run.status,
          version: run.version + 1,
        };
      },
    );
  }

  complete(
    jobRunId: string,
    input: CompleteJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !input.leaseOwner?.trim() ||
      (input.failureCode !== undefined && !CODE_PATTERN.test(input.failureCode)) ||
      (input.resultFileObjectId !== undefined && !isUuid(input.resultFileObjectId))
    ) {
      throw new AppError('JOB_RESULT_INVALID', 'Job result input is invalid', 400);
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { jobRunId, ...input },
        responseCode: 200,
        scope: 'platform.job-run.complete.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const run = await this.findRun(transaction, jobRunId, context);
        this.assertLease(run, input.leaseOwner, input.expectedVersion);
        if (run.status === 'CANCEL_REQUESTED') {
          assertJobTransition(run.status, 'CANCELLED');
          return this.finishRun(
            transaction,
            run,
            'CANCELLED',
            input,
            context,
            metadata,
          );
        }
        if (input.resultFileObjectId) {
          const file = await transaction.fileObject.findFirst({
            where: {
              id: input.resultFileObjectId,
              status: 'AVAILABLE',
              tenantId: context.tenantId,
            },
          });
          if (!file) {
            throw new AppError('JOB_RESULT_FILE_UNAVAILABLE', 'Result file is unavailable', 409);
          }
        }
        if (input.success) {
          assertJobTransition(run.status, 'SUCCEEDED');
          return this.finishRun(
            transaction,
            run,
            'SUCCEEDED',
            input,
            context,
            metadata,
          );
        }
        const terminalTarget = input.timedOut ? 'TIMED_OUT' : 'FAILED';
        if (run.attempt < run.maxAttempts) {
          assertJobTransition(run.status, 'QUEUED');
          const delaySeconds = run.backoffSeconds * 2 ** Math.max(0, run.attempt - 1);
          await transaction.jobRun.update({
            data: {
              failureCode: input.failureCode ?? 'JOB_ATTEMPT_FAILED',
              leaseExpiresAt: null,
              leaseOwner: null,
              scheduledAt: new Date(Date.now() + delaySeconds * 1000),
              status: 'QUEUED',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: run.id },
          });
          await this.log(
            transaction,
            run.id,
            'WARNING',
            'Job attempt failed; retry scheduled',
            { attempt: run.attempt, delaySeconds },
            context,
          );
          await this.record(
            transaction,
            run.id,
            run.version + 1,
            'job-run.retry-scheduled',
            'platform.job-run-retry-scheduled.v1',
            context,
            metadata,
            { attempt: run.attempt, delaySeconds, status: 'QUEUED' },
            { status: run.status },
          );
          return {
            jobRunId: run.id,
            retryScheduled: true,
            status: 'QUEUED',
            version: run.version + 1,
          };
        }
        assertJobTransition(run.status, terminalTarget);
        return this.finishRun(
          transaction,
          run,
          terminalTarget,
          input,
          context,
          metadata,
        );
      },
    );
  }

  cancel(
    jobRunId: string,
    input: CancelJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!input.reason?.trim() || input.reason.length > 500) {
      throw new AppError('JOB_CANCEL_INVALID', 'Cancellation reason is required', 400);
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { jobRunId, ...input },
        responseCode: 200,
        scope: 'platform.job-run.cancel.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const run = await this.findRun(transaction, jobRunId, context);
        if (run.version !== input.expectedVersion) throw this.versionConflict();
        const target = run.status === 'QUEUED' ? 'CANCELLED' : 'CANCEL_REQUESTED';
        assertJobTransition(run.status, target);
        await transaction.jobRun.update({
          data: {
            cancellationReason: input.reason.trim(),
            ...(target === 'CANCELLED' ? { completedAt: new Date() } : {}),
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: run.id },
        });
        await this.log(transaction, run.id, 'WARNING', 'Job cancellation requested', {}, context);
        await this.record(
          transaction,
          run.id,
          run.version + 1,
          'job-run.cancelled',
          `platform.job-run-${target.toLowerCase().replace('_', '-')}.v1`,
          context,
          metadata,
          { reason: input.reason, status: target },
          { status: run.status },
        );
        return { jobRunId: run.id, status: target, version: run.version + 1 };
      },
    );
  }

  private async finishRun(
    transaction: Prisma.TransactionClient,
    run: Awaited<ReturnType<JobService['findRun']>>,
    target: 'CANCELLED' | 'FAILED' | 'SUCCEEDED' | 'TIMED_OUT',
    input: CompleteJobInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    await transaction.jobRun.update({
      data: {
        completedAt: new Date(),
        failureCode:
          target === 'SUCCEEDED'
            ? null
            : (input.failureCode ?? `JOB_${target}`),
        leaseExpiresAt: null,
        leaseOwner: null,
        progress: target === 'SUCCEEDED' ? 100 : run.progress,
        result: (input.result ?? {}) as Prisma.InputJsonObject,
        resultFileObjectId: input.resultFileObjectId ?? null,
        status: target,
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: run.id },
    });
    await this.log(
      transaction,
      run.id,
      target === 'SUCCEEDED' ? 'INFO' : 'ERROR',
      `Job run ${target.toLowerCase()}`,
      { failureCode: input.failureCode ?? null },
      context,
    );
    await this.record(
      transaction,
      run.id,
      run.version + 1,
      `job-run.${target.toLowerCase()}`,
      `platform.job-run-${target.toLowerCase()}.v1`,
      context,
      metadata,
      { progress: target === 'SUCCEEDED' ? 100 : run.progress, status: target },
      { status: run.status },
    );
    return {
      jobRunId: run.id,
      resultFileObjectId: input.resultFileObjectId ?? null,
      status: target,
      version: run.version + 1,
    };
  }

  private async findRun(
    transaction: Prisma.TransactionClient,
    id: string,
    context: TenantContext,
  ) {
    const run = await transaction.jobRun.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!run) throw new AppError('JOB_RUN_NOT_FOUND', 'Job run was not found', 404);
    return run;
  }

  private assertLease(
    run: { leaseExpiresAt: Date | null; leaseOwner: string | null; status: JobRunStatus; version: number },
    leaseOwner: string,
    expectedVersion: number,
  ) {
    if (
      !['RUNNING', 'CANCEL_REQUESTED'].includes(run.status) ||
      run.version !== expectedVersion ||
      run.leaseOwner !== leaseOwner ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt <= new Date()
    ) {
      throw new AppError('JOB_LEASE_LOST', 'Job lease is invalid or expired', 409, {
        retryable: true,
      });
    }
  }

  private log(
    transaction: Prisma.TransactionClient,
    jobRunId: string,
    level: 'ERROR' | 'INFO' | 'WARNING',
    message: string,
    details: Prisma.InputJsonObject,
    context: TenantContext,
  ) {
    return transaction.jobLog.create({
      data: {
        createdBy: context.accountId,
        details,
        jobRunId,
        level,
        message,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
  }

  private async record(
    transaction: Prisma.TransactionClient,
    aggregateId: string,
    aggregateVersion: number,
    action: string,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    after: Prisma.InputJsonObject,
    before?: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      transaction.platformAuditLog.create({
        data: {
          action,
          after,
          ...(before ? { before } : {}),
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: aggregateId,
          resourceType: 'JobRun',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      transaction.platformOutbox.create({
        data: {
          aggregateId,
          aggregateType: 'JobRun',
          aggregateVersion,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          payload: { jobRunId: aggregateId, tenantId: context.tenantId, version: aggregateVersion },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }

  private versionConflict() {
    return new AppError(
      'JOB_VERSION_CONFLICT',
      'Job definition or run version changed; refresh and retry',
      409,
      { retryable: true },
    );
  }
}
