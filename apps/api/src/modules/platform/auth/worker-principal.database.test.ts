import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { IdempotencyService } from '../idempotency.service';
import { EventService } from '../event.service';
import { SessionContextService } from './session-context.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();
const tenantIds: string[] = [];
const workerToken = 'database-worker-control-token-at-least-32-characters';
const actorId = '10000000-0000-4000-8000-000000000099';

databaseDescribe('multi-tenant worker principal persistence', () => {
  afterAll(() => prisma.$disconnect());
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "platform"."audit_log" DISABLE TRIGGER audit_log_immutable',
    );
    await prisma.platformAuditLog.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "platform"."audit_log" ENABLE TRIGGER audit_log_immutable',
    );
    await prisma.idempotencyRecord.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await prisma.platformOutbox.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await prisma.tenant.deleteMany({ where: { tenantId: { in: tenantIds } } });
    tenantIds.length = 0;
    vi.unstubAllEnvs();
  });

  it('discovers A/B, excludes suspended C and claims each tenant in isolation', async () => {
    vi.stubEnv('WORKER_CONTROL_TOKEN', workerToken);
    vi.stubEnv('WORKER_ACTOR_ID', actorId);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    tenantIds.push(...ids);
    for (const [index, tenantId] of ids.entries())
      await prisma.tenant.create({
        data: {
          code: `WORKER_${randomUUID().replaceAll('-', '').slice(0, 10)}`,
          createdBy: actorId,
          currency: 'CNY',
          defaultLocale: 'zh-CN',
          id: tenantId,
          isolationMode: 'SHARED_SCHEMA',
          name: `Worker tenant ${index}`,
          status: index === 2 ? 'SUSPENDED' : 'ACTIVE',
          tenantId,
          timezone: 'Asia/Shanghai',
          updatedBy: actorId,
        },
      });
    const sessions = new SessionContextService(prisma as never, {} as never);
    const discovered = await sessions.discoverActiveTenants(
      `Bearer ${workerToken}`,
      { limit: '100' },
    );
    expect(discovered.items.map(({ tenantId }) => tenantId)).toEqual(
      expect.arrayContaining(ids.slice(0, 2)),
    );
    expect(discovered.items.map(({ tenantId }) => tenantId)).not.toContain(
      ids[2],
    );
    const contexts = await Promise.all(
      ids
        .slice(0, 2)
        .map((tenantId) =>
          sessions.authenticate(`Bearer ${workerToken}`, tenantId),
        ),
    );
    for (const [index, context] of contexts.entries())
      await prisma.platformOutbox.create({
        data: {
          aggregateId: randomUUID(),
          aggregateType: 'WorkerIsolationProbe',
          aggregateVersion: 1,
          correlationId: randomUUID(),
          createdBy: actorId,
          eventName: `worker.probe-${index}.v1`,
          partitionKey: `WorkerProbe:${index}`,
          payload: { tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: actorId,
        },
      });
    const events = new EventService(
      new IdempotencyService(prisma as never),
      prisma as never,
    );
    const claims = await Promise.all(
      contexts.map((context, index) =>
        events.claim({ leaseOwner: `worker-${index}`, limit: 10 }, context, {
          correlationId: randomUUID(),
          idempotencyKey: randomUUID(),
          ipAddress: '127.0.0.1',
        }),
      ),
    );
    expect(claims[0]!.events).toHaveLength(1);
    expect(claims[1]!.events).toHaveLength(1);
    expect(claims[0]!.events[0]!.tenantId).toBe(ids[0]);
    expect(claims[1]!.events[0]!.tenantId).toBe(ids[1]);
  });
});
