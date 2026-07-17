import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { IdempotencyService } from './idempotency.service';
import { JobService } from './job.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('job lease concurrency and log immutability', () => {
  afterAll(() => prisma.$disconnect());

  it('allows only one run to acquire a definition with concurrency one', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const definition = await prisma.jobDefinition.create({
      data: {
        code: `JOB_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
        createdBy: actorId,
        handler: 'REPORT',
        name: 'Lease competition',
        runAt: new Date(),
        tenantId,
        triggerType: 'ONCE',
        updatedBy: actorId,
      },
    });
    const runs = await Promise.all(
      [randomUUID(), randomUUID()].map((id) =>
        prisma.jobRun.create({
          data: {
            backoffSeconds: 1,
            createdBy: actorId,
            definitionVersion: 1,
            handler: 'REPORT',
            id,
            jobDefinitionId: definition.id,
            maxAttempts: 1,
            payload: {},
            scheduledAt: new Date(Date.now() - 1000),
            tenantId,
            timeoutSeconds: 60,
            triggerType: 'ONCE',
            updatedBy: actorId,
          },
        }),
      ),
    );
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'database-test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const service = new JobService(
      new IdempotencyService(prisma as never),
      { enqueue } as never,
      prisma as never,
    );
    try {
      const settled = await Promise.allSettled(
        runs.map((run, index) =>
          service.claim(
            run.id,
            {
              expectedVersion: 1,
              leaseOwner: `worker-${index}`,
              leaseSeconds: 60,
            },
            context,
            {
              correlationId: randomUUID(),
              idempotencyKey: randomUUID(),
              ipAddress: '127.0.0.1',
            },
          ),
        ),
      );
      expect(
        settled.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        settled.filter(({ status }) => status === 'rejected'),
      ).toHaveLength(1);
      expect(
        await prisma.jobRun.count({
          where: { jobDefinitionId: definition.id, status: 'RUNNING' },
        }),
      ).toBe(1);

      const replayKey = randomUUID();
      const first = await service.trigger(
        definition.id,
        { payload: { report: 'daily' }, triggerRef: 'event-1' },
        context,
        {
          correlationId: randomUUID(),
          idempotencyKey: replayKey,
          ipAddress: '127.0.0.1',
        },
      );
      const replay = await service.trigger(
        definition.id,
        { payload: { report: 'daily' }, triggerRef: 'event-1' },
        context,
        {
          correlationId: randomUUID(),
          idempotencyKey: replayKey,
          ipAddress: '127.0.0.1',
        },
      );
      expect(replay.jobRunId).toBe(first.jobRunId);
      expect(
        await prisma.jobRun.count({
          where: { tenantId, triggerRef: 'event-1' },
        }),
      ).toBe(1);
      await expect(
        service.trigger(
          definition.id,
          { payload: { report: 'changed' }, triggerRef: 'event-1' },
          context,
          {
            correlationId: randomUUID(),
            idempotencyKey: replayKey,
            ipAddress: '127.0.0.1',
          },
        ),
      ).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        statusCode: 409,
      });
      expect(enqueue).toHaveBeenCalledTimes(2);

      const log = await prisma.jobLog.findFirstOrThrow({ where: { tenantId } });
      await expect(
        prisma.jobLog.update({
          data: { message: 'tampered' },
          where: { id: log.id },
        }),
      ).rejects.toThrow(/immutable/);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."job_log" DISABLE TRIGGER job_log_immutable',
      );
      await prisma.jobLog.deleteMany({ where: { tenantId } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."job_log" ENABLE TRIGGER job_log_immutable',
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."audit_log" DISABLE TRIGGER audit_log_immutable',
      );
      await prisma.platformAuditLog.deleteMany({ where: { tenantId } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."audit_log" ENABLE TRIGGER audit_log_immutable',
      );
      await prisma.platformOutbox.deleteMany({ where: { tenantId } });
      await prisma.idempotencyRecord.deleteMany({ where: { tenantId } });
      await prisma.jobRun.deleteMany({ where: { tenantId } });
      await prisma.jobDefinition.deleteMany({ where: { tenantId } });
    }
  });
});
