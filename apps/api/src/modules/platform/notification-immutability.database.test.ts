import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('notification delivery fact immutability', () => {
  afterAll(() => prisma.$disconnect());

  it('rejects mutation and deletion of delivery attempts', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const attempt = await prisma.deliveryAttempt.create({
      data: {
        attemptNumber: 1,
        channel: 'IN_APP',
        createdBy: actorId,
        deliveredAt: new Date(),
        notificationId: randomUUID(),
        providerMessageId: `test:${randomUUID()}`,
        status: 'DELIVERED',
        tenantId,
        updatedBy: actorId,
      },
    });
    try {
      await expect(
        prisma.deliveryAttempt.update({
          data: { errorCode: 'tampered' },
          where: { id: attempt.id },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        prisma.deliveryAttempt.delete({ where: { id: attempt.id } }),
      ).rejects.toThrow(/immutable/);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."delivery_attempt" DISABLE TRIGGER delivery_attempt_immutable',
      );
      await prisma.deliveryAttempt.delete({ where: { id: attempt.id } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."delivery_attempt" ENABLE TRIGGER delivery_attempt_immutable',
      );
    }
  });
});
