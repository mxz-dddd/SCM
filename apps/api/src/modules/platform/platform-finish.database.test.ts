import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CollaborationPrintService } from './collaboration-print.service';
import { FeatureFlagService } from './feature-flag.service';
import { IdempotencyService } from './idempotency.service';
import { LocaleUnitService } from './locale-unit.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe(
  'platform finalization persistence and print concurrency',
  () => {
    afterAll(() => prisma.$disconnect());

    it('preserves versions, visibility, decisions and a single print lease', async () => {
      const tenantId = randomUUID();
      const actorId = randomUUID();
      const context: TenantContext = {
        accountId: actorId,
        accountKind: 'TENANT_ADMIN',
        deviceId: 'database-test',
        organizationIds: [],
        permissionVersion: 1,
        tenantId,
        tokenId: randomUUID(),
      };
      const command = (key = randomUUID()) => ({
        correlationId: randomUUID(),
        idempotencyKey: key,
        ipAddress: '127.0.0.1',
      });
      const idempotency = new IdempotencyService(prisma as never);
      const locale = new LocaleUnitService(idempotency, prisma as never);
      const flags = new FeatureFlagService(idempotency, prisma as never);
      const enqueue = vi.fn().mockResolvedValue(undefined);
      const collaboration = new CollaborationPrintService(
        idempotency,
        { enqueue } as never,
        prisma as never,
      );
      try {
        const localeKey = randomUUID();
        const preference = await locale.saveLocale(
          {
            currency: 'CNY',
            language: 'zh-CN',
            timeZone: 'Asia/Shanghai',
            unitSystem: 'METRIC',
          },
          context,
          command(localeKey),
        );
        const localeReplay = await locale.saveLocale(
          {
            currency: 'CNY',
            language: 'zh-CN',
            timeZone: 'Asia/Shanghai',
            unitSystem: 'METRIC',
          },
          context,
          command(localeKey),
        );
        expect(localeReplay.localePreferenceId).toBe(
          preference.localePreferenceId,
        );
        const conversion = await locale.createConversion(
          {
            code: 'KG_TO_G',
            dimension: 'MASS',
            factor: '1000',
            fromUom: 'KG',
            toUom: 'G',
          },
          context,
          command(),
        );
        await expect(
          locale.convert(
            { amount: '2.5', dimension: 'MASS', fromUom: 'KG', toUom: 'G' },
            context,
          ),
        ).resolves.toMatchObject({
          baseAmount: '2500',
          conversionId: conversion.conversionId,
          originalAmount: '2.5',
        });

        const draft = await flags.save(
          {
            code: 'NEW_FLOW',
            name: 'New flow',
            rules: [
              { enabled: true, id: 'TEN_PERCENT', percentage: 10, priority: 1 },
            ],
          },
          context,
          command(),
        );
        const published = await flags.changeStatus(
          draft.featureFlagId,
          'PUBLISHED',
          { expectedVersion: draft.version },
          context,
          command(),
        );
        const evaluationKey = randomUUID();
        const decision = await flags.evaluate(
          { code: 'NEW_FLOW', subjectKey: 'account-42' },
          context,
          command(evaluationKey),
        );
        const decisionReplay = await flags.evaluate(
          { code: 'NEW_FLOW', subjectKey: 'account-42' },
          context,
          command(evaluationKey),
        );
        expect(decisionReplay.decisionId).toBe(decision.decisionId);
        expect(decision.version).toBe(1);
        await flags.changeStatus(
          draft.featureFlagId,
          'PAUSED',
          { expectedVersion: published.version },
          context,
          command(),
        );

        const businessId = randomUUID();
        const internal = await collaboration.createComment(
          {
            body: 'Internal evidence',
            businessId,
            businessType: 'ORDER',
            visibility: 'INTERNAL',
          },
          context,
          command(),
        );
        await collaboration.createComment(
          {
            body: 'Partner update',
            businessId,
            businessType: 'ORDER',
            visibility: 'EXTERNAL',
          },
          context,
          command(),
        );
        expect(
          await collaboration.listComments('ORDER', businessId, false, context),
        ).toHaveLength(2);
        expect(
          await collaboration.listComments('ORDER', businessId, true, context),
        ).toHaveLength(1);
        const resolved = await collaboration.changeCommentStatus(
          internal.commentId,
          'RESOLVED',
          { expectedVersion: internal.version },
          context,
          command(),
        );
        await collaboration.changeCommentStatus(
          internal.commentId,
          'OPEN',
          { expectedVersion: resolved.version },
          context,
          command(),
        );

        const template = await collaboration.saveTemplate(
          {
            code: 'SHIP_LABEL',
            content: { body: '{{orderNo}}' },
            documentType: 'SHIP_LABEL',
            language: 'zh-CN',
            name: 'Shipping label',
            routeTags: ['LABEL'],
            variables: ['orderNo'],
          },
          context,
          command(),
        );
        await collaboration.changeTemplateStatus(
          template.printTemplateId,
          'PUBLISHED',
          { expectedVersion: template.version },
          context,
          command(),
        );
        const printer = await collaboration.savePrinter(
          {
            code: 'ZEBRA_01',
            endpointRef: 'printer://zebra-01',
            name: 'Zebra 01',
            routeTags: ['LABEL'],
          },
          context,
          command(),
        );
        const printKey = randomUUID();
        const job = await collaboration.createPrintJob(
          {
            businessId,
            documentType: 'SHIP_LABEL',
            labelData: { orderNo: 'SO-1' },
            language: 'zh-CN',
          },
          context,
          command(printKey),
        );
        const replayedJob = await collaboration.createPrintJob(
          {
            businessId,
            documentType: 'SHIP_LABEL',
            labelData: { orderNo: 'SO-1' },
            language: 'zh-CN',
          },
          context,
          command(printKey),
        );
        expect(replayedJob.printJobId).toBe(job.printJobId);
        expect(job.printerId).toBe(printer.printerId);
        const claims = await Promise.allSettled([
          collaboration.claimPrintJob(
            job.printJobId,
            { expectedVersion: job.version, leaseOwner: 'printer-a' },
            context,
            command(),
          ),
          collaboration.claimPrintJob(
            job.printJobId,
            { expectedVersion: job.version, leaseOwner: 'printer-b' },
            context,
            command(),
          ),
        ]);
        expect(
          claims.filter(({ status }) => status === 'fulfilled'),
        ).toHaveLength(1);
        const claimed = claims.find(
          ({ status }) => status === 'fulfilled',
        ) as PromiseFulfilledResult<{ version: number }>;
        const owner =
          claims[0]?.status === 'fulfilled' ? 'printer-a' : 'printer-b';
        await collaboration.completePrintJob(
          job.printJobId,
          {
            expectedVersion: claimed.value.version,
            leaseOwner: owner,
            success: true,
          },
          context,
          command(),
        );
        expect(enqueue).toHaveBeenCalledTimes(2);
      } finally {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."feature_flag_decision" DISABLE TRIGGER feature_flag_decision_immutable',
        );
        await prisma.featureFlagDecision.deleteMany({ where: { tenantId } });
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."feature_flag_decision" ENABLE TRIGGER feature_flag_decision_immutable',
        );
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."feature_flag" DISABLE TRIGGER feature_flag_published_immutable',
        );
        await prisma.featureFlag.deleteMany({ where: { tenantId } });
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."feature_flag" ENABLE TRIGGER feature_flag_published_immutable',
        );
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."print_template" DISABLE TRIGGER print_template_published_immutable',
        );
        await prisma.printTemplate.deleteMany({ where: { tenantId } });
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."print_template" ENABLE TRIGGER print_template_published_immutable',
        );
        await prisma.printJob.deleteMany({ where: { tenantId } });
        await prisma.printer.deleteMany({ where: { tenantId } });
        await prisma.businessComment.deleteMany({ where: { tenantId } });
        await prisma.unitConversion.deleteMany({ where: { tenantId } });
        await prisma.localePreference.deleteMany({ where: { tenantId } });
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."audit_log" DISABLE TRIGGER audit_log_immutable',
        );
        await prisma.platformAuditLog.deleteMany({ where: { tenantId } });
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "platform"."audit_log" ENABLE TRIGGER audit_log_immutable',
        );
        await prisma.platformOutbox.deleteMany({ where: { tenantId } });
        await prisma.idempotencyRecord.deleteMany({ where: { tenantId } });
      }
    });
  },
);
