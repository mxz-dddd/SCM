import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('audit database immutability', () => {
  afterAll(() => prisma.$disconnect());

  it('captures change history and rejects audit mutations', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const resourceId = randomUUID();
    const auditLog = await prisma.platformAuditLog.create({
      data: {
        action: 'test.resource.change',
        after: { password: 'test-only-after', state: 'ACTIVE' },
        before: { password: 'test-only-before', state: 'DRAFT' },
        businessRef: `TEST-${Date.now()}`,
        category: 'BUSINESS_CHANGE',
        correlationId: randomUUID(),
        createdBy: actorId,
        deviceId: 'database-test',
        outcome: 'SUCCESS',
        resourceId,
        resourceType: 'TestResource',
        tenantId,
        updatedBy: actorId,
      },
    });

    const history = await prisma.changeHistory.findUnique({
      where: { auditLogId: auditLog.id },
    });
    expect(history?.changedFields).toEqual(['password', 'state']);
    expect(history?.correlationId).toBe(auditLog.correlationId);

    await expect(
      prisma.platformAuditLog.update({
        data: { action: 'tampered' },
        where: { id: auditLog.id },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.platformAuditLog.delete({ where: { id: auditLog.id } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.changeHistory.delete({ where: { id: history!.id } }),
    ).rejects.toThrow(/immutable/);
  });
});
