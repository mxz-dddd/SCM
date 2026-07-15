import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { RateLimitService } from './rate-limit.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('PostgreSQL atomic rate limits', () => {
  afterAll(() => prisma.$disconnect());

  it('allows only one of two concurrent requests at a limit of one', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const limits = new RateLimitService(prisma as never);
    const results = await Promise.allSettled([
      limits.consume({
        actorId,
        limit: 1,
        route: '/api/v1/oms/orders',
        scope: 'API',
        subject: 'same',
        tenantId,
      }),
      limits.consume({
        actorId,
        limit: 1,
        route: '/api/v1/oms/orders',
        scope: 'API',
        subject: 'same',
        tenantId,
      }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    await prisma.platformRateLimitBucket.deleteMany({ where: { tenantId } });
  });
});
