import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('published rules and evaluation trace immutability', () => {
  afterAll(() => prisma.$disconnect());

  it('prevents mutation of a published rule set and its definitions', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const ruleSet = await prisma.ruleSet.create({
      data: {
        code: `TEST_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
        createdBy: actorId,
        name: 'Immutable rules',
        scenario: 'ALLOCATION',
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    const rule = await prisma.ruleDefinition.create({
      data: {
        code: 'RULE_ONE',
        conditions: [],
        createdBy: actorId,
        name: 'Rule one',
        priority: 1,
        result: { effect: 'DECIDE', values: {} },
        ruleSetId: ruleSet.id,
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.ruleSet.update({
      data: { publishedAt: new Date(), status: 'PUBLISHED' },
      where: { id: ruleSet.id },
    });
    try {
      await expect(
        prisma.ruleSet.update({
          data: { name: 'tampered' },
          where: { id: ruleSet.id },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        prisma.ruleDefinition.update({
          data: { priority: 999 },
          where: { id: rule.id },
        }),
      ).rejects.toThrow(/immutable/);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."rule_definition" DISABLE TRIGGER rule_definition_published_immutable',
      );
      await prisma.ruleDefinition.delete({ where: { id: rule.id } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."rule_definition" ENABLE TRIGGER rule_definition_published_immutable',
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."rule_set" DISABLE TRIGGER rule_set_published_immutable',
      );
      await prisma.ruleSet.delete({ where: { id: ruleSet.id } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."rule_set" ENABLE TRIGGER rule_set_published_immutable',
      );
    }
  });

  it('prevents evaluation trace mutation and deletion', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const trace = await prisma.evaluationTrace.create({
      data: {
        candidateSnapshot: [],
        correlationId: randomUUID(),
        createdBy: actorId,
        decision: {},
        evaluatedRules: [],
        exclusions: [],
        inputSnapshot: {},
        matchedRuleIds: [],
        mode: 'SIMULATION',
        outcome: 'NO_MATCH',
        ruleSetCode: 'TEST_RULES',
        ruleSetId: randomUUID(),
        ruleSetVersionNumber: 1,
        scenario: 'ALLOCATION',
        tenantId,
        updatedBy: actorId,
      },
    });
    try {
      await expect(
        prisma.evaluationTrace.update({
          data: { outcome: 'MATCHED' },
          where: { id: trace.id },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        prisma.evaluationTrace.delete({ where: { id: trace.id } }),
      ).rejects.toThrow(/immutable/);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."evaluation_trace" DISABLE TRIGGER evaluation_trace_immutable',
      );
      await prisma.evaluationTrace.delete({ where: { id: trace.id } });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "platform"."evaluation_trace" ENABLE TRIGGER evaluation_trace_immutable',
      );
    }
  });
});
