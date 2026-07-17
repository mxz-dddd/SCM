import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { NumberingFacade } from './numbering.facade';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

const context = (tenantId: string, accountId: string): TenantContext => ({
  accountId,
  accountKind: 'TENANT_ADMIN',
  deviceId: 'numbering-test',
  organizationIds: [],
  permissionVersion: 1,
  tenantId,
  tokenId: 'numbering-test-token',
});

const metadata = (key: string) => ({
  correlationId: randomUUID(),
  idempotencyKey: key,
  ipAddress: undefined,
});

const createRule = (
  tenantId: string,
  actorId: string,
  businessType: string,
  organizationRef = '*',
  prefixTemplate = 'NUM-{YYYY}{MM}{DD}-',
  sequenceWidth = 8,
) =>
  prisma.numberRule.create({
    data: {
      blockSize: 100,
      businessType,
      createdBy: actorId,
      organizationRef,
      prefixTemplate,
      resetPeriod: 'DAILY',
      sequenceWidth,
      tenantId,
      updatedBy: actorId,
    },
  });

const cleanup = async (tenantId: string) => {
  await prisma.idempotencyRecord.deleteMany({ where: { tenantId } });
  await prisma.platformOutbox.deleteMany({ where: { tenantId } });
  await prisma.sequenceReservation.deleteMany({ where: { tenantId } });
  await prisma.numberRule.deleteMany({ where: { tenantId } });
};

databaseDescribe('NumberingFacade database contract', () => {
  afterAll(() => prisma.$disconnect());

  it('allocates unique numbers under contention and replays the same key', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const businessType = 'TEST_CONCURRENT_NUMBER';
    await createRule(tenantId, actorId, businessType);
    const facade = new NumberingFacade(prisma as never);
    try {
      const values = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          facade.nextNumber(
            { at: '2026-07-16T08:00:00.000Z', businessType },
            context(tenantId, actorId),
            metadata(`number-${index}`),
          ),
        ),
      );
      expect(new Set(values.map(({ number }) => number))).toHaveLength(40);
      expect(
        values.map(({ sequence }) => Number(sequence)).sort((a, b) => a - b),
      ).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));

      const replayMetadata = metadata('replay-key');
      const first = await facade.nextNumber(
        { at: '2026-07-16T08:00:00.000Z', businessType },
        context(tenantId, actorId),
        replayMetadata,
      );
      const replay = await facade.nextNumber(
        { at: '2026-07-16T08:00:00.000Z', businessType },
        context(tenantId, actorId),
        replayMetadata,
      );
      expect(replay).toEqual(first);
    } finally {
      await cleanup(tenantId);
    }
  });

  it('prefers an organization rule and falls back to the tenant rule', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const organizationRef = randomUUID();
    const businessType = 'TEST_ORGANIZATION_NUMBER';
    await Promise.all([
      createRule(tenantId, actorId, businessType, '*', 'TEN-{YYYY}{MM}{DD}-'),
      createRule(
        tenantId,
        actorId,
        businessType,
        organizationRef,
        'ORG-{YYYY}{MM}{DD}-',
      ),
    ]);
    const facade = new NumberingFacade(prisma as never);
    try {
      const scoped = await facade.nextNumber(
        { businessType, organizationRef },
        context(tenantId, actorId),
        metadata('organization'),
      );
      const fallback = await facade.nextNumber(
        { businessType, organizationRef: randomUUID() },
        context(tenantId, actorId),
        metadata('fallback'),
      );
      expect(scoped.number).toMatch(/^ORG-/);
      expect(fallback.number).toMatch(/^TEN-/);
    } finally {
      await cleanup(tenantId);
    }
  });

  it('fails explicitly for a missing rule and exhausted width', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const facade = new NumberingFacade(prisma as never);
    await expect(
      facade.nextNumber(
        { businessType: 'TEST_MISSING_NUMBER' },
        context(tenantId, actorId),
        metadata('missing'),
      ),
    ).rejects.toMatchObject({ code: 'NUMBER_RULE_NOT_CONFIGURED' });

    const rule = await createRule(
      tenantId,
      actorId,
      'TEST_EXHAUSTED_NUMBER',
      '*',
      'EXH-{YYYY}{MM}{DD}-',
      1,
    );
    await prisma.numberRule.update({
      data: { currentPeriodKey: '20260716', currentSequence: 9n },
      where: { id: rule.id },
    });
    try {
      await expect(
        facade.nextNumber(
          {
            at: '2026-07-16T08:00:00.000Z',
            businessType: 'TEST_EXHAUSTED_NUMBER',
          },
          context(tenantId, actorId),
          metadata('exhausted'),
        ),
      ).rejects.toMatchObject({ code: 'NUMBER_SEQUENCE_EXHAUSTED' });
    } finally {
      await cleanup(tenantId);
    }
  });
});
