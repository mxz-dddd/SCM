import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('data exchange receipt and search query immutability', () => {
  afterAll(() => prisma.$disconnect());

  it('rejects mutation and deletion of executed search queries', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const query = await prisma.searchQuery.create({
      data: {
        accountId: actorId,
        createdBy: actorId,
        criteria: {},
        queryText: 'immutable',
        resultCount: 0,
        tenantId,
        updatedBy: actorId,
      },
    });
    try {
      await expect(
        prisma.searchQuery.update({
          data: { resultCount: 99 },
          where: { id: query.id },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        prisma.searchQuery.delete({ where: { id: query.id } }),
      ).rejects.toThrow(/immutable/);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."search_query" DISABLE TRIGGER search_query_immutable',
      );
      await prisma.searchQuery.delete({ where: { id: query.id } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."search_query" ENABLE TRIGGER search_query_immutable',
      );
    }
  });
});
