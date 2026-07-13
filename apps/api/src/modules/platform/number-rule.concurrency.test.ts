import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('number rule database concurrency', () => {
  afterAll(() => prisma.$disconnect());

  it('atomically allocates non-overlapping blocks under contention', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const numberRuleId = randomUUID();
    await prisma.numberRule.create({
      data: {
        blockSize: 5,
        businessType: `TEST_${Date.now()}`,
        createdBy: actorId,
        id: numberRuleId,
        organizationRef: '*',
        prefixTemplate: 'T-',
        resetPeriod: 'DAILY',
        sequenceWidth: 8,
        tenantId,
        updatedBy: actorId,
      },
    });

    try {
      const ranges = await Promise.all(
        Array.from({ length: 12 }, async () =>
          prisma.$transaction(async (transaction) => {
            const [allocated] = await transaction.$queryRaw<
              { current_sequence: bigint }[]
            >(Prisma.sql`
              UPDATE "platform"."number_rule"
              SET
                "current_period_key" = '20260714',
                "current_sequence" = CASE
                  WHEN "current_period_key" = '20260714'
                  THEN "current_sequence" + "block_size"::bigint
                  ELSE "block_size"::bigint
                END,
                "updated_at" = CURRENT_TIMESTAMP,
                "updated_by" = ${actorId}::uuid,
                "version" = "version" + 1
              WHERE "id" = ${numberRuleId}::uuid
                AND "tenant_id" = ${tenantId}::uuid
              RETURNING "current_sequence"
            `);
            const end = allocated!.current_sequence;
            const start = end - 4n;
            await transaction.sequenceReservation.create({
              data: {
                createdBy: actorId,
                endValue: end,
                expiresAt: new Date(Date.now() + 60_000),
                numberRuleId,
                periodKey: '20260714',
                reservedBy: actorId,
                startValue: start,
                tenantId,
                updatedBy: actorId,
              },
            });
            return { end, start };
          }),
        ),
      );

      const values = ranges.flatMap(({ end, start }) => {
        const result: bigint[] = [];
        for (let value = start; value <= end; value += 1n) result.push(value);
        return result;
      });
      expect(values).toHaveLength(60);
      expect(new Set(values.map(String))).toHaveLength(60);
      expect([...values].sort((left, right) => Number(left - right))[0]).toBe(
        1n,
      );
      expect(
        [...values].sort((left, right) => Number(left - right)).at(-1),
      ).toBe(60n);
    } finally {
      await prisma.sequenceReservation.deleteMany({ where: { tenantId } });
      await prisma.numberRule.deleteMany({ where: { tenantId } });
    }
  });
});
