import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('published workflow and approval fact immutability', () => {
  afterAll(() => prisma.$disconnect());

  it('allows draft publication then rejects published content mutation', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const definition = await prisma.workflowDefinition.create({
      data: {
        code: `TEST_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
        createdBy: actorId,
        definition: { nodes: [], startNodeKey: '', transitions: [] },
        name: 'Immutable definition',
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    const published = await prisma.workflowDefinition.update({
      data: { publishedAt: new Date(), status: 'PUBLISHED' },
      where: { id: definition.id },
    });
    try {
      await expect(
        prisma.workflowDefinition.update({
          data: { name: 'tampered' },
          where: { id: published.id },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        prisma.workflowDefinition.delete({ where: { id: published.id } }),
      ).rejects.toThrow(/immutable/);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."workflow_definition" DISABLE TRIGGER workflow_definition_published_immutable',
      );
      await prisma.workflowDefinition.delete({ where: { id: published.id } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."workflow_definition" ENABLE TRIGGER workflow_definition_published_immutable',
      );
    }
  });

  it('rejects mutation and deletion of approval action facts', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const action = await prisma.approvalAction.create({
      data: {
        action: 'APPROVE',
        actorAccountId: actorId,
        createdBy: actorId,
        fromStatus: 'PENDING',
        tenantId,
        toStatus: 'APPROVED',
        updatedBy: actorId,
        workflowInstanceId: randomUUID(),
      },
    });
    try {
      await expect(
        prisma.approvalAction.update({
          data: { comment: 'tampered' },
          where: { id: action.id },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        prisma.approvalAction.delete({ where: { id: action.id } }),
      ).rejects.toThrow(/immutable/);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."approval_action" DISABLE TRIGGER approval_action_immutable',
      );
      await prisma.approvalAction.delete({ where: { id: action.id } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."approval_action" ENABLE TRIGGER approval_action_immutable',
      );
    }
  });
});
