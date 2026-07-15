import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type OutboxStatus } from '@prisma/client';
import {
  subscriptionForConsumer,
  type ConsumerMode,
  type TenantContext,
} from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import {
  hashIdempotencyRequest,
  IdempotencyService,
} from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;

export interface ClaimEventsInput {
  readonly leaseOwner: string;
  readonly leaseSeconds?: number;
  readonly limit?: number;
}

export interface EventLeaseInput {
  readonly error?: string;
  readonly expectedVersion: number;
  readonly leaseOwner: string;
}

export interface BusinessEventInput {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateVersion: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly payload: JsonObject;
  readonly schemaVersion: number;
  readonly traceId: string;
}

export interface ConsumeEventInput {
  readonly consumer: string;
  readonly event: BusinessEventInput;
  readonly mode: ConsumerMode;
}

interface OutboxRow {
  aggregate_id: string;
  aggregate_type: string;
  aggregate_version: number;
  attempt_count: number;
  event_name: string;
  id: string;
  occurred_at: Date;
  partition_key: string;
  payload: Prisma.JsonValue;
  schema_version: number;
  tenant_id: string;
  trace_id: string;
  version: number;
}

const CODE_PATTERN = /^[a-z][a-z0-9.-]{2,149}\.v\d+$/;
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{2,149}$/;
const OUTBOX_TERMINAL: readonly OutboxStatus[] = ['DEAD_LETTER', 'PUBLISHED'];

export function assertOutboxTransition(
  current: OutboxStatus,
  target: OutboxStatus,
): void {
  const allowed =
    (['FAILED', 'PENDING', 'PROCESSING'].includes(current) &&
      target === 'PROCESSING') ||
    (current === 'PROCESSING' &&
      ['DEAD_LETTER', 'FAILED', 'PUBLISHED'].includes(target)) ||
    (current === 'DEAD_LETTER' && target === 'PENDING');
  if (
    !allowed ||
    (OUTBOX_TERMINAL.includes(current) && current !== 'DEAD_LETTER')
  ) {
    throw new AppError(
      'EVENT_TRANSITION_INVALID',
      `Outbox transition ${current} -> ${target} is not allowed`,
      409,
    );
  }
}

function validateBusinessEvent(event: BusinessEventInput): void {
  const occurredAt = new Date(event.occurredAt);
  if (
    !isUuid(event.eventId) ||
    !isUuid(event.aggregateId) ||
    !NAME_PATTERN.test(event.aggregateType) ||
    !CODE_PATTERN.test(event.eventType) ||
    !Number.isInteger(event.aggregateVersion) ||
    event.aggregateVersion < 1 ||
    !Number.isInteger(event.schemaVersion) ||
    event.schemaVersion < 1 ||
    !event.traceId?.trim() ||
    event.traceId.length > 100 ||
    Number.isNaN(occurredAt.getTime()) ||
    !event.payload ||
    Array.isArray(event.payload)
  ) {
    throw new AppError(
      'BUSINESS_EVENT_INVALID',
      'Business event envelope is invalid',
      400,
    );
  }
}

@Injectable()
export class EventService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  listOutbox(context: TenantContext, status?: string) {
    const allowed: readonly OutboxStatus[] = [
      'DEAD_LETTER',
      'FAILED',
      'PENDING',
      'PROCESSING',
      'PUBLISHED',
    ];
    if (status && !allowed.includes(status as OutboxStatus)) {
      throw new AppError(
        'EVENT_STATUS_INVALID',
        'Outbox status is invalid',
        400,
      );
    }
    return this.prisma.platformOutbox.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 300,
      where: {
        ...(status ? { status: status as OutboxStatus } : {}),
        tenantId: context.tenantId,
      },
    });
  }

  listInbox(context: TenantContext, consumer?: string) {
    return this.prisma.eventInbox.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 300,
      where: { ...(consumer ? { consumer } : {}), tenantId: context.tenantId },
    });
  }

  claim(
    input: ClaimEventsInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const leaseSeconds = input.leaseSeconds ?? 60;
    const limit = input.limit ?? 20;
    if (
      !input.leaseOwner?.trim() ||
      input.leaseOwner.length > 200 ||
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 10 ||
      leaseSeconds > 3600 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new AppError(
        'EVENT_LEASE_INVALID',
        'Outbox lease input is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 200,
        scope: 'platform.event-relay.claim.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const rows = await transaction.$queryRaw<OutboxRow[]>`
          WITH candidates AS (
            SELECT current.id
            FROM "platform"."outbox" current
            WHERE current.tenant_id = ${context.tenantId}::uuid
              AND current.status IN ('PENDING', 'FAILED', 'PROCESSING')
              AND current.available_at <= CURRENT_TIMESTAMP
              AND (current.status <> 'PROCESSING' OR current.lease_expires_at <= CURRENT_TIMESTAMP)
              AND NOT EXISTS (
                SELECT 1
                FROM "platform"."outbox" earlier
                WHERE earlier.tenant_id = current.tenant_id
                  AND earlier.partition_key = current.partition_key
                  AND (
                    earlier.aggregate_version < current.aggregate_version
                    OR (
                      earlier.aggregate_version = current.aggregate_version
                      AND (
                        earlier.created_at < current.created_at
                        OR (earlier.created_at = current.created_at AND earlier.id < current.id)
                      )
                    )
                  )
                  AND earlier.status <> 'PUBLISHED'
              )
            ORDER BY current.created_at ASC, current.id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ${limit}
          )
          UPDATE "platform"."outbox" target
          SET status = 'PROCESSING',
              attempt_count = target.attempt_count + 1,
              lease_owner = ${input.leaseOwner.trim()},
              lease_expires_at = CURRENT_TIMESTAMP + make_interval(secs => ${leaseSeconds}),
              updated_at = CURRENT_TIMESTAMP,
              updated_by = ${context.accountId}::uuid,
              version = target.version + 1
          FROM candidates
          WHERE target.id = candidates.id
          RETURNING target.id, target.tenant_id, target.event_name,
            target.aggregate_type, target.aggregate_id, target.aggregate_version,
            target.payload, target.trace_id, target.schema_version,
            target.occurred_at, target.partition_key, target.attempt_count,
            target.version
        `;
        return {
          events: rows.map((row) => ({
            aggregateId: row.aggregate_id,
            aggregateType: row.aggregate_type,
            aggregateVersion: row.aggregate_version,
            attemptCount: row.attempt_count,
            eventId: row.id,
            eventType: row.event_name,
            occurredAt: row.occurred_at.toISOString(),
            partitionKey: row.partition_key,
            payload: row.payload,
            schemaVersion: row.schema_version,
            tenantId: row.tenant_id,
            traceId: row.trace_id,
            version: row.version,
          })),
          leaseOwner: input.leaseOwner.trim(),
        };
      },
    );
  }

  acknowledge(
    eventId: string,
    input: EventLeaseInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.finishLease('PUBLISHED', eventId, input, context, metadata);
  }

  fail(
    eventId: string,
    input: EventLeaseInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!input.error?.trim() || input.error.length > 1000) {
      throw new AppError(
        'EVENT_FAILURE_INVALID',
        'Relay failure reason is required',
        400,
      );
    }
    return this.finishLease('FAILED', eventId, input, context, metadata);
  }

  replay(
    eventId: string,
    expectedVersion: number,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!isUuid(eventId) || !Number.isInteger(expectedVersion)) {
      throw new AppError(
        'EVENT_REPLAY_INVALID',
        'Dead-letter replay input is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { eventId, expectedVersion },
        responseCode: 200,
        scope: 'platform.event.replay.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const event = await transaction.platformOutbox.findFirst({
          where: { id: eventId, tenantId: context.tenantId },
        });
        if (!event)
          throw new AppError(
            'BUSINESS_EVENT_NOT_FOUND',
            'Business event was not found',
            404,
          );
        if (
          event.version !== expectedVersion ||
          event.status !== 'DEAD_LETTER'
        ) {
          throw this.versionConflict();
        }
        assertOutboxTransition(event.status, 'PENDING');
        const updated = await transaction.platformOutbox.update({
          data: {
            attemptCount: 0,
            availableAt: new Date(),
            deadLetteredAt: null,
            lastError: null,
            leaseExpiresAt: null,
            leaseOwner: null,
            status: 'PENDING',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: event.id },
        });
        await this.audit(
          transaction,
          event.id,
          'event.dead-letter.replayed',
          context,
          metadata,
          {
            eventType: event.eventName,
            status: updated.status,
          },
        );
        return {
          eventId: event.id,
          status: updated.status,
          version: updated.version,
        };
      },
    );
  }

  async consume(
    input: ConsumeEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
    handler: (
      event: BusinessEventInput,
      transaction: Prisma.TransactionClient,
    ) => Promise<JsonObject>,
  ) {
    validateBusinessEvent(input.event);
    const subscription = subscriptionForConsumer(input.consumer);
    if (
      !NAME_PATTERN.test(input.consumer) ||
      !subscription ||
      subscription.mode !== input.mode ||
      !metadata.idempotencyKey?.trim()
    ) {
      throw new AppError(
        'EVENT_CONSUMER_INVALID',
        'Registered consumer, matching mode and Idempotency-Key are required',
        400,
      );
    }
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${context.tenantId}:${input.consumer}:${input.event.aggregateType}:${input.event.aggregateId}`}))`;
        const existing = await transaction.eventInbox.findUnique({
          where: {
            tenantId_consumer_eventId: {
              consumer: input.consumer,
              eventId: input.event.eventId,
              tenantId: context.tenantId,
            },
          },
        });
        let retryInbox = null;
        if (existing) {
          if (
            existing.eventType !== input.event.eventType ||
            existing.aggregateId !== input.event.aggregateId ||
            existing.aggregateVersion !== input.event.aggregateVersion ||
            hashIdempotencyRequest(existing.payload) !==
              hashIdempotencyRequest(input.event.payload)
          ) {
            throw new AppError(
              'EVENT_REPLAY_CONFLICT',
              'Event ID was replayed with different content',
              409,
            );
          }
          if (existing.status !== 'FAILED') {
            return {
              duplicate: true,
              eventId: input.event.eventId,
              inboxId: existing.id,
              status: existing.status,
            };
          }
          retryInbox = await transaction.eventInbox.update({
            data: {
              failureCode: null,
              status: 'PROCESSING',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: existing.id },
          });
        }
        const checkpoint = await transaction.consumerCheckpoint.findUnique({
          where: {
            tenantId_consumer_aggregateType_aggregateId: {
              aggregateId: input.event.aggregateId,
              aggregateType: input.event.aggregateType,
              consumer: input.consumer,
              tenantId: context.tenantId,
            },
          },
        });
        const ignored = Boolean(
          input.mode === 'LATEST_STATE' &&
          checkpoint &&
          checkpoint.lastVersion >= input.event.aggregateVersion,
        );
        const inbox =
          retryInbox ??
          (await transaction.eventInbox.create({
            data: {
              aggregateId: input.event.aggregateId,
              aggregateType: input.event.aggregateType,
              aggregateVersion: input.event.aggregateVersion,
              consumer: input.consumer,
              createdBy: context.accountId,
              eventId: input.event.eventId,
              eventType: input.event.eventType,
              payload: input.event.payload as Prisma.InputJsonObject,
              schemaVersion: input.event.schemaVersion,
              status: ignored ? 'IGNORED' : 'PROCESSING',
              tenantId: context.tenantId,
              traceId: input.event.traceId,
              updatedBy: context.accountId,
            },
          }));
        if (ignored) {
          return {
            duplicate: false,
            eventId: input.event.eventId,
            inboxId: inbox.id,
            status: 'IGNORED' as const,
          };
        }
        const result = await handler(input.event, transaction);
        if (
          !checkpoint ||
          checkpoint.lastVersion <= input.event.aggregateVersion
        ) {
          await transaction.consumerCheckpoint.upsert({
            create: {
              aggregateId: input.event.aggregateId,
              aggregateType: input.event.aggregateType,
              consumer: input.consumer,
              createdBy: context.accountId,
              lastEventId: input.event.eventId,
              lastVersion: input.event.aggregateVersion,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
            update: {
              lastEventId: input.event.eventId,
              lastVersion: input.event.aggregateVersion,
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: {
              tenantId_consumer_aggregateType_aggregateId: {
                aggregateId: input.event.aggregateId,
                aggregateType: input.event.aggregateType,
                consumer: input.consumer,
                tenantId: context.tenantId,
              },
            },
          });
        }
        const processed = await transaction.eventInbox.update({
          data: {
            processedAt: new Date(),
            result: result as Prisma.InputJsonObject,
            status: 'PROCESSED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: inbox.id },
        });
        return {
          duplicate: false,
          eventId: input.event.eventId,
          inboxId: inbox.id,
          status: processed.status,
        };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      await this.prisma.eventInbox.upsert({
        create: {
          aggregateId: input.event.aggregateId,
          aggregateType: input.event.aggregateType,
          aggregateVersion: input.event.aggregateVersion,
          consumer: input.consumer,
          createdBy: context.accountId,
          eventId: input.event.eventId,
          eventType: input.event.eventType,
          failureCode: 'EVENT_HANDLER_FAILED',
          payload: input.event.payload as Prisma.InputJsonObject,
          schemaVersion: input.event.schemaVersion,
          status: 'FAILED',
          tenantId: context.tenantId,
          traceId: input.event.traceId,
          updatedBy: context.accountId,
        },
        update: {
          failureCode: 'EVENT_HANDLER_FAILED',
          status: 'FAILED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          tenantId_consumer_eventId: {
            consumer: input.consumer,
            eventId: input.event.eventId,
            tenantId: context.tenantId,
          },
        },
      });
      throw new AppError('EVENT_HANDLER_FAILED', 'Event consumer failed', 500, {
        retryable: true,
      });
    }
  }

  rejectDiagnosticConsume(input: ConsumeEventInput): never {
    const subscription = subscriptionForConsumer(input.consumer);
    if (!subscription || subscription.mode !== input.mode) {
      throw new AppError(
        'EVENT_CONSUMER_UNREGISTERED',
        'Consumer is not registered with the requested mode',
        400,
      );
    }
    throw new AppError(
      'EVENT_DIAGNOSTIC_HANDLER_REQUIRED',
      `Consumer ${input.consumer} must be invoked through ${subscription.endpoint}`,
      409,
    );
  }

  private finishLease(
    requestedTarget: 'FAILED' | 'PUBLISHED',
    eventId: string,
    input: EventLeaseInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!isUuid(eventId) || !input.leaseOwner?.trim()) {
      throw new AppError(
        'EVENT_LEASE_INVALID',
        'Event lease input is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { eventId, requestedTarget, ...input },
        responseCode: 200,
        scope: `platform.event-relay.${requestedTarget.toLowerCase()}.v1`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const event = await transaction.platformOutbox.findFirst({
          where: { id: eventId, tenantId: context.tenantId },
        });
        if (
          !event ||
          event.status !== 'PROCESSING' ||
          event.version !== input.expectedVersion ||
          event.leaseOwner !== input.leaseOwner ||
          !event.leaseExpiresAt ||
          event.leaseExpiresAt <= new Date()
        ) {
          throw this.versionConflict();
        }
        const target =
          requestedTarget === 'FAILED' &&
          event.attemptCount >= event.maxAttempts
            ? 'DEAD_LETTER'
            : requestedTarget;
        assertOutboxTransition(event.status, target);
        const delaySeconds = Math.min(
          3600,
          2 ** Math.max(0, event.attemptCount - 1),
        );
        const updated = await transaction.platformOutbox.update({
          data: {
            availableAt:
              target === 'FAILED'
                ? new Date(Date.now() + delaySeconds * 1000)
                : event.availableAt,
            deadLetteredAt: target === 'DEAD_LETTER' ? new Date() : null,
            lastError:
              requestedTarget === 'FAILED' ? input.error!.trim() : null,
            leaseExpiresAt: null,
            leaseOwner: null,
            publishedAt: target === 'PUBLISHED' ? new Date() : null,
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: event.id },
        });
        return {
          eventId: event.id,
          retryAt:
            target === 'FAILED' ? updated.availableAt.toISOString() : null,
          status: updated.status,
          version: updated.version,
        };
      },
    );
  }

  private audit(
    transaction: Prisma.TransactionClient,
    resourceId: string,
    action: string,
    context: TenantContext,
    metadata: CommandMetadata,
    after: Prisma.InputJsonObject,
  ) {
    return transaction.platformAuditLog.create({
      data: {
        action,
        after,
        correlationId: metadata.correlationId,
        createdBy: context.accountId,
        deviceId: context.deviceId,
        ipAddress: metadata.ipAddress ?? null,
        resourceId,
        resourceType: 'BusinessEvent',
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
  }

  private versionConflict() {
    return new AppError(
      'EVENT_LEASE_LOST',
      'Event lease or version is no longer valid',
      409,
      {
        retryable: true,
      },
    );
  }
}
