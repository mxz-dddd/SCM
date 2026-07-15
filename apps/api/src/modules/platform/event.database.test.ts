import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { EventService, type BusinessEventInput } from './event.service';
import { IdempotencyService } from './idempotency.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe(
  'outbox ordering, relay leases and inbox deduplication',
  () => {
    afterAll(() => prisma.$disconnect());

    it('claims one version per aggregate and consumes each event once', async () => {
      const tenantId = randomUUID();
      const actorId = randomUUID();
      const aggregateId = randomUUID();
      const otherAggregateId = randomUUID();
      const context: TenantContext = {
        accountId: actorId,
        accountKind: 'TENANT_ADMIN',
        deviceId: 'event-database-test',
        organizationIds: [],
        permissionVersion: 1,
        tenantId,
        tokenId: randomUUID(),
      };
      const metadata = (key = randomUUID()) => ({
        correlationId: randomUUID(),
        idempotencyKey: key,
        ipAddress: '127.0.0.1',
      });
      const service = new EventService(
        new IdempotencyService(prisma as never),
        prisma as never,
      );
      const createOutbox = (
        id: string,
        targetAggregateId: string,
        version: number,
        maxAttempts = 8,
      ) =>
        prisma.platformOutbox.create({
          data: {
            aggregateId: targetAggregateId,
            aggregateType: 'Order',
            aggregateVersion: version,
            availableAt: new Date(Date.now() - 1_000),
            correlationId: randomUUID(),
            createdBy: actorId,
            eventName: version === 1 ? 'order.created.v1' : 'order.released.v1',
            id,
            maxAttempts,
            payload: { orderId: targetAggregateId },
            tenantId,
            updatedBy: actorId,
          },
        });
      const event1Id = randomUUID();
      const event2Id = randomUUID();
      const otherEventId = randomUUID();
      await createOutbox(event1Id, aggregateId, 1);
      await createOutbox(event2Id, aggregateId, 2);
      await createOutbox(otherEventId, otherAggregateId, 1);

      try {
        const claims = await Promise.all([
          service.claim(
            { leaseOwner: 'relay-a', limit: 20 },
            context,
            metadata(),
          ),
          service.claim(
            { leaseOwner: 'relay-b', limit: 20 },
            context,
            metadata(),
          ),
        ]);
        const claimed = claims.flatMap(({ events }) => events);
        expect(new Set(claimed.map(({ eventId }) => eventId)).size).toBe(2);
        expect(claimed.map(({ eventId }) => eventId)).toContain(event1Id);
        expect(claimed.map(({ eventId }) => eventId)).toContain(otherEventId);
        expect(claimed.map(({ eventId }) => eventId)).not.toContain(event2Id);

        const first = claimed.find(({ eventId }) => eventId === event1Id)!;
        const firstLeaseOwner = claims.find(({ events }) =>
          events.some(({ eventId }) => eventId === event1Id),
        )!.leaseOwner;
        await service.acknowledge(
          first.eventId,
          { expectedVersion: first.version, leaseOwner: firstLeaseOwner },
          context,
          metadata(),
        );
        const next = await service.claim(
          { leaseOwner: 'relay-next', limit: 20 },
          context,
          metadata(),
        );
        expect(next.events.map(({ eventId }) => eventId)).toContain(event2Id);

        const businessEvent: BusinessEventInput = {
          aggregateId,
          aggregateType: 'Order',
          aggregateVersion: 1,
          eventId: event1Id,
          eventType: 'order.created.v1',
          occurredAt: new Date().toISOString(),
          payload: { orderId: aggregateId },
          schemaVersion: 1,
          traceId: randomUUID(),
        };
        const handler = vi.fn().mockResolvedValue({ projected: true });
        const consumed = await service.consume(
          {
            consumer: 'control.projection.v1',
            event: businessEvent,
            mode: 'LATEST_STATE',
          },
          context,
          metadata(),
          handler,
        );
        const replay = await service.consume(
          {
            consumer: 'control.projection.v1',
            event: businessEvent,
            mode: 'LATEST_STATE',
          },
          context,
          metadata(),
          handler,
        );
        expect(consumed.status).toBe('PROCESSED');
        expect(replay).toMatchObject({ duplicate: true, status: 'PROCESSED' });
        expect(handler).toHaveBeenCalledTimes(1);
        await expect(
          service.consume(
            {
              consumer: 'control.projection.v1',
              event: { ...businessEvent, payload: { orderId: 'changed' } },
              mode: 'LATEST_STATE',
            },
            context,
            metadata(),
            handler,
          ),
        ).rejects.toMatchObject({
          code: 'EVENT_REPLAY_CONFLICT',
          statusCode: 409,
        });

        const retryEvent: BusinessEventInput = {
          ...businessEvent,
          aggregateVersion: 2,
          eventId: randomUUID(),
          eventType: 'order.released.v1',
        };
        const failedHandler = vi
          .fn()
          .mockRejectedValueOnce(new Error('projection unavailable'))
          .mockResolvedValueOnce({ projected: true });
        await expect(
          service.consume(
            {
              consumer: 'control.projection.v1',
              event: retryEvent,
              mode: 'LATEST_STATE',
            },
            context,
            metadata(),
            failedHandler,
          ),
        ).rejects.toMatchObject({
          code: 'EVENT_HANDLER_FAILED',
          statusCode: 500,
        });
        const retried = await service.consume(
          {
            consumer: 'control.projection.v1',
            event: retryEvent,
            mode: 'LATEST_STATE',
          },
          context,
          metadata(),
          failedHandler,
        );
        expect(retried.status).toBe('PROCESSED');
        expect(failedHandler).toHaveBeenCalledTimes(2);

        const stale = await service.consume(
          {
            consumer: 'control.projection.v1',
            event: { ...businessEvent, eventId: randomUUID() },
            mode: 'LATEST_STATE',
          },
          context,
          metadata(),
          handler,
        );
        expect(stale.status).toBe('IGNORED');
        expect(handler).toHaveBeenCalledTimes(1);

        const everyEventHandler = vi.fn().mockResolvedValue({ appended: true });
        const everyEventOne = {
          ...businessEvent,
          eventId: randomUUID(),
        };
        const everyEventTwo = {
          ...businessEvent,
          eventId: randomUUID(),
          eventType: 'order.updated.v1',
        };
        await service.consume(
          {
            consumer: 'oms.order-timeline.v1',
            event: everyEventOne,
            mode: 'EVERY_EVENT',
          },
          context,
          metadata(),
          everyEventHandler,
        );
        await service.consume(
          {
            consumer: 'oms.order-timeline.v1',
            event: everyEventTwo,
            mode: 'EVERY_EVENT',
          },
          context,
          metadata(),
          everyEventHandler,
        );
        expect(everyEventHandler).toHaveBeenCalledTimes(2);

        const deadEventId = randomUUID();
        await createOutbox(deadEventId, randomUUID(), 1, 1);
        const deadClaim = await service.claim(
          { leaseOwner: 'relay-dead', limit: 20 },
          context,
          metadata(),
        );
        const dead = deadClaim.events.find(
          ({ eventId }) => eventId === deadEventId,
        )!;
        const failed = await service.fail(
          dead.eventId,
          {
            error: 'broker down',
            expectedVersion: dead.version,
            leaseOwner: 'relay-dead',
          },
          context,
          metadata(),
        );
        expect(failed.status).toBe('DEAD_LETTER');
        const restored = await service.replay(
          dead.eventId,
          failed.version,
          context,
          metadata(),
        );
        expect(restored.status).toBe('PENDING');
      } finally {
        await prisma.eventDelivery.deleteMany({ where: { tenantId } });
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."event_inbox" DISABLE TRIGGER event_inbox_terminal_immutable',
        );
        await prisma.eventInbox.deleteMany({ where: { tenantId } });
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."event_inbox" ENABLE TRIGGER event_inbox_terminal_immutable',
        );
        await prisma.consumerCheckpoint.deleteMany({ where: { tenantId } });
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."audit_log" DISABLE TRIGGER audit_log_immutable',
        );
        await prisma.platformAuditLog.deleteMany({ where: { tenantId } });
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."audit_log" ENABLE TRIGGER audit_log_immutable',
        );
        await prisma.idempotencyRecord.deleteMany({ where: { tenantId } });
        await prisma.platformOutbox.deleteMany({ where: { tenantId } });
      }
    });
  },
);
