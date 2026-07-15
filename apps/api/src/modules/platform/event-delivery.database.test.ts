import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { EventService } from './event.service';
import { IdempotencyService } from './idempotency.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();
let tenantId: string | undefined;

databaseDescribe('V2 persistent event delivery', () => {
  afterAll(() => prisma.$disconnect());

  afterEach(async () => {
    if (!tenantId) return;
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "platform"."event_delivery" DISABLE TRIGGER event_delivery_terminal_immutable',
    );
    await prisma.eventDelivery.deleteMany({ where: { tenantId } });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "platform"."event_delivery" ENABLE TRIGGER event_delivery_terminal_immutable',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "platform"."audit_log" DISABLE TRIGGER audit_log_immutable',
    );
    await prisma.platformAuditLog.deleteMany({ where: { tenantId } });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "platform"."audit_log" ENABLE TRIGGER audit_log_immutable',
    );
    await prisma.idempotencyRecord.deleteMany({ where: { tenantId } });
    await prisma.platformOutbox.deleteMany({ where: { tenantId } });
    tenantId = undefined;
  });

  function fixture() {
    tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'event-delivery-database-test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    return {
      actorId,
      context,
      metadata: (key = randomUUID()) => ({
        correlationId: randomUUID(),
        idempotencyKey: key,
        ipAddress: '127.0.0.1',
      }),
      service: new EventService(
        new IdempotencyService(prisma as never),
        prisma as never,
      ),
      tenantId,
    };
  }

  async function createSource(
    actorId: string,
    currentTenantId: string,
    input: {
      aggregateId?: string;
      aggregateVersion: number;
      createdAt: Date;
      eventName?: string;
      occurredAt: Date;
      partitionKey: string;
      status?: 'PROCESSING' | 'PUBLISHED';
    },
  ) {
    return prisma.platformOutbox.create({
      data: {
        aggregateId: input.aggregateId ?? randomUUID(),
        aggregateType: 'Order',
        aggregateVersion: input.aggregateVersion,
        correlationId: randomUUID(),
        createdAt: input.createdAt,
        createdBy: actorId,
        eventName: input.eventName ?? 'order.updated.v1',
        leaseExpiresAt:
          input.status === 'PROCESSING' ? new Date(Date.now() + 60_000) : null,
        leaseOwner: input.status === 'PROCESSING' ? 'relay-test' : null,
        occurredAt: input.occurredAt,
        partitionKey: input.partitionKey,
        payload: { orderVersion: input.aggregateVersion },
        publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
        status: input.status ?? 'PUBLISHED',
        tenantId: currentTenantId,
        traceId: randomUUID(),
        updatedBy: actorId,
      },
    });
  }

  async function createDelivery(
    actorId: string,
    currentTenantId: string,
    source: Awaited<ReturnType<typeof createSource>>,
    input: {
      consumer?: string;
      maxAttempts?: number;
      partitionKey?: string;
      required?: boolean;
    } = {},
  ) {
    return prisma.eventDelivery.create({
      data: {
        aggregateId: source.aggregateId,
        aggregateType: source.aggregateType,
        aggregateVersion: source.aggregateVersion,
        availableAt: new Date(Date.now() - 1_000),
        consumer: input.consumer ?? 'oms.order-timeline.v1',
        createdBy: actorId,
        endpoint: '/api/v1/oms/timeline-events/consume',
        eventId: source.id,
        maxAttempts: input.maxAttempts ?? 8,
        mode: 'EVERY_EVENT',
        partitionKey: input.partitionKey ?? source.partitionKey!,
        required: input.required ?? true,
        sourceEventCreatedAt: source.createdAt,
        sourceOccurredAt: source.occurredAt,
        tenantId: currentTenantId,
        updatedBy: actorId,
      },
    });
  }

  it('fans out once and keeps subscriber completion states independent', async () => {
    const {
      actorId,
      context,
      metadata,
      service,
      tenantId: currentTenantId,
    } = fixture();
    const source = await createSource(actorId, currentTenantId, {
      aggregateVersion: 1,
      createdAt: new Date('2026-07-16T01:00:00.000Z'),
      eventName: 'order.created.v1',
      occurredAt: new Date('2026-07-16T01:00:00.000Z'),
      partitionKey: `Order:${randomUUID()}`,
      status: 'PROCESSING',
    });
    const key = randomUUID();
    const first = await service.publish(
      source.id,
      {
        expectedVersion: source.version,
        leaseOwner: 'relay-test',
      },
      context,
      metadata(key),
    );
    const replay = await service.publish(
      source.id,
      {
        expectedVersion: source.version,
        leaseOwner: 'relay-test',
      },
      context,
      metadata(key),
    );
    expect(replay).toEqual(first);
    expect(first.deliveryCount).toBeGreaterThan(1);
    expect(
      await prisma.eventDelivery.count({
        where: { eventId: source.id, tenantId: currentTenantId },
      }),
    ).toBe(first.deliveryCount);

    const claimed = await service.claimDeliveries(
      { leaseOwner: 'delivery-fanout', limit: 100 },
      context,
      metadata(),
    );
    const [successful, failed] = claimed.deliveries;
    expect(successful).toBeDefined();
    expect(failed).toBeDefined();
    await service.completeDelivery(
      successful!.id,
      {
        expectedVersion: successful!.version,
        leaseOwner: 'delivery-fanout',
        responseSnapshot: { handled: true },
      },
      context,
      metadata(),
    );
    await service.failDelivery(
      failed!.id,
      {
        error: 'consumer unavailable',
        expectedVersion: failed!.version,
        leaseOwner: 'delivery-fanout',
      },
      context,
      metadata(),
    );
    const states = await prisma.eventDelivery.findMany({
      where: { id: { in: [successful!.id, failed!.id] } },
    });
    expect(states.map(({ status }) => status).sort()).toEqual([
      'FAILED',
      'PROCESSED',
    ]);
  });

  it('claims source order under concurrency and blocks later work per partition', async () => {
    const {
      actorId,
      context,
      metadata,
      service,
      tenantId: currentTenantId,
    } = fixture();
    const aggregateId = randomUUID();
    const partition = `Order:${aggregateId}`;
    const v3 = await createSource(actorId, currentTenantId, {
      aggregateId,
      aggregateVersion: 3,
      createdAt: new Date('2026-07-16T01:00:00.000Z'),
      occurredAt: new Date('2026-07-16T03:00:00.000Z'),
      partitionKey: partition,
    });
    await createDelivery(actorId, currentTenantId, v3);
    const v2 = await createSource(actorId, currentTenantId, {
      aggregateId,
      aggregateVersion: 2,
      createdAt: new Date('2026-07-16T02:00:00.000Z'),
      occurredAt: new Date('2026-07-16T02:00:00.000Z'),
      partitionKey: partition,
    });
    const v2Delivery = await createDelivery(actorId, currentTenantId, v2);
    const parallel = await createSource(actorId, currentTenantId, {
      aggregateVersion: 1,
      createdAt: new Date('2026-07-16T02:30:00.000Z'),
      occurredAt: new Date('2026-07-16T02:30:00.000Z'),
      partitionKey: `Order:${randomUUID()}`,
    });
    const parallelDelivery = await createDelivery(
      actorId,
      currentTenantId,
      parallel,
    );

    const claims = await Promise.all([
      service.claimDeliveries(
        { leaseOwner: 'delivery-a', limit: 20 },
        context,
        metadata(),
      ),
      service.claimDeliveries(
        { leaseOwner: 'delivery-b', limit: 20 },
        context,
        metadata(),
      ),
    ]);
    const all = claims.flatMap(({ deliveries }) => deliveries);
    expect(all.map(({ id }) => id)).toContain(v2Delivery.id);
    expect(all.map(({ id }) => id)).toContain(parallelDelivery.id);
    expect(all.map(({ eventId }) => eventId)).not.toContain(v3.id);
    expect(new Set(all.map(({ id }) => id)).size).toBe(2);

    const v2Claim = all.find(({ id }) => id === v2Delivery.id)!;
    const v2Owner = claims.find(({ deliveries }) =>
      deliveries.some(({ id }) => id === v2Delivery.id),
    )!.leaseOwner;
    await service.failDelivery(
      v2Claim.id,
      {
        error: 'retry later',
        expectedVersion: v2Claim.version,
        leaseOwner: v2Owner,
      },
      context,
      metadata(),
    );
    const blocked = await service.claimDeliveries(
      { leaseOwner: 'delivery-blocked', limit: 20 },
      context,
      metadata(),
    );
    expect(blocked.deliveries.map(({ eventId }) => eventId)).not.toContain(
      v3.id,
    );

    await prisma.eventDelivery.update({
      data: { availableAt: new Date(Date.now() - 1_000) },
      where: { id: v2Delivery.id },
    });
    const retry = await service.claimDeliveries(
      { leaseOwner: 'delivery-retry', limit: 20 },
      context,
      metadata(),
    );
    const retriedV2 = retry.deliveries.find(({ id }) => id === v2Delivery.id)!;
    await service.completeDelivery(
      retriedV2.id,
      {
        expectedVersion: retriedV2.version,
        leaseOwner: 'delivery-retry',
      },
      context,
      metadata(),
    );
    const released = await service.claimDeliveries(
      { leaseOwner: 'delivery-v3', limit: 20 },
      context,
      metadata(),
    );
    expect(released.deliveries.map(({ eventId }) => eventId)).toContain(v3.id);
  });

  it('replays only the dead subscriber and preserves successful side effects', async () => {
    const {
      actorId,
      context,
      metadata,
      service,
      tenantId: currentTenantId,
    } = fixture();
    const source = await createSource(actorId, currentTenantId, {
      aggregateVersion: 1,
      createdAt: new Date('2026-07-16T01:00:00.000Z'),
      occurredAt: new Date('2026-07-16T01:00:00.000Z'),
      partitionKey: `Order:${randomUUID()}`,
    });
    const successful = await createDelivery(actorId, currentTenantId, source);
    const dead = await createDelivery(actorId, currentTenantId, source, {
      consumer: 'billing.charge-fact.v1',
      maxAttempts: 1,
      required: true,
    });
    const claim = await service.claimDeliveries(
      { leaseOwner: 'delivery-dead', limit: 20 },
      context,
      metadata(),
    );
    const successfulClaim = claim.deliveries.find(
      ({ id }) => id === successful.id,
    )!;
    const deadClaim = claim.deliveries.find(({ id }) => id === dead.id)!;
    await service.completeDelivery(
      successfulClaim.id,
      {
        expectedVersion: successfulClaim.version,
        leaseOwner: 'delivery-dead',
      },
      context,
      metadata(),
    );
    const deadResult = await service.failDelivery(
      deadClaim.id,
      {
        error: 'permanent consumer failure',
        expectedVersion: deadClaim.version,
        leaseOwner: 'delivery-dead',
      },
      context,
      metadata(),
    );
    expect(deadResult.status).toBe('DEAD_LETTER');
    await service.replayDelivery(
      dead.id,
      deadResult.version,
      context,
      metadata(),
    );
    const replay = await service.claimDeliveries(
      { leaseOwner: 'delivery-replay', limit: 20 },
      context,
      metadata(),
    );
    expect(replay.deliveries.map(({ id }) => id)).toContain(dead.id);
    expect(replay.deliveries.map(({ id }) => id)).not.toContain(successful.id);
    expect(
      await prisma.eventDelivery.findUniqueOrThrow({
        where: { id: successful.id },
      }),
    ).toMatchObject({ status: 'PROCESSED' });
  });
});
