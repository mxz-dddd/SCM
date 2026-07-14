import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { RateMatchingFacade } from '../mdm/public/rate-matching.facade';
import { FreightBillingService } from './freight-billing.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe(
  'TMS freight facts, billing and settlement persistence',
  () => {
    afterAll(() => prisma.$disconnect());

    it('keeps immutable facts, diagnoses rates, separates AP/AR and settles after vouchers', async () => {
      const tenantId = randomUUID();
      const actorId = randomUUID();
      const context: TenantContext = {
        accountId: actorId,
        accountKind: 'TENANT_ADMIN',
        deviceId: 'freight-billing-db-test',
        organizationIds: [],
        permissionVersion: 1,
        tenantId,
        tokenId: randomUUID(),
      };
      const command = () => ({
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        ipAddress: '127.0.0.1',
      });
      const now = new Date();
      const batch = await prisma.planningBatch.create({
        data: {
          batchNo: `PB-${randomUUID()}`,
          createdBy: actorId,
          criteria: {},
          plannedAt: now,
          planningDate: now,
          regionCode: 'EAST',
          status: 'PLANNED',
          tenantId,
          updatedBy: actorId,
        },
      });
      const plan = await prisma.consolidationPlan.create({
        data: {
          createdBy: actorId,
          planNo: `CP-${randomUUID()}`,
          planningBatchId: batch.id,
          policySnapshot: {},
          publishedAt: now,
          status: 'APPROVED',
          tenantId,
          updatedBy: actorId,
          validatedAt: now,
        },
      });
      const shipment = await prisma.shipment.create({
        data: {
          consolidationPlanId: plan.id,
          createdBy: actorId,
          deliveryWindowTo: new Date(now.getTime() + 8 * 3_600_000),
          destinationSnapshot: { city: '上海' },
          mode: 'ROAD_FTL',
          originSnapshot: { city: '苏州' },
          pickupWindowFrom: new Date(now.getTime() - 3_600_000),
          requirementSnapshot: {},
          shipmentNo: `SHP-${randomUUID()}`,
          status: 'POD',
          tenantId,
          totalPallets: 2,
          totalVolumeBase: 5,
          totalWeightBase: 500,
          updatedBy: actorId,
        },
      });
      const confirmation = await prisma.deliveryConfirmation.create({
        data: {
          arrivedAt: new Date(now.getTime() - 45 * 60_000),
          confirmationNo: `DCF-${randomUUID()}`,
          createdBy: actorId,
          deliveryLocationSnapshot: { city: '上海' },
          hasVariance: false,
          itemSummary: [],
          recipientName: '客户收货人',
          recipientSnapshot: { role: 'CUSTOMER' },
          shipmentId: shipment.id,
          signatureSnapshot: { signed: true },
          signedAt: now,
          tenantId,
          unloadingCompletedAt: new Date(now.getTime() - 5 * 60_000),
          unloadingStartedAt: new Date(now.getTime() - 35 * 60_000),
          updatedBy: actorId,
        },
      });
      await prisma.proofOfDelivery.create({
        data: {
          confirmedAt: now,
          createdBy: actorId,
          deliveryConfirmationId: confirmation.id,
          fileReferences: [{ fileObjectId: randomUUID() }],
          pageCount: 1,
          podNo: `POD-${randomUUID()}`,
          shipmentId: shipment.id,
          signatureSnapshot: { signed: true },
          status: 'CONFIRMED',
          submittedAt: now,
          submittedBy: actorId,
          reviewingAt: now,
          tenantId,
          updatedBy: actorId,
        },
      });
      const approvalId = randomUUID();
      async function rateSource(
        code: string,
        baseRate: string,
        pricing: Record<string, string>,
      ) {
        const contract = await prisma.contract.create({
          data: {
            approvalInstanceId: approvalId,
            approvedAt: now,
            approvedBy: actorId,
            code: `${code}-${randomUUID().slice(0, 8)}`,
            contractType: 'TRANSPORT',
            createdBy: actorId,
            currency: 'CNY',
            effectiveFrom: new Date(now.getTime() - 86_400_000),
            effectiveUntil: new Date(now.getTime() + 86_400_000),
            name: `${code}运输合同`,
            partnerId: randomUUID(),
            partnerSnapshot: { code },
            status: 'ACTIVE',
            tenantId,
            updatedBy: actorId,
          },
        });
        const card = await prisma.rateCard.create({
          data: {
            code: 'LINEHAUL',
            contractId: contract.id,
            createdBy: actorId,
            name: '干线费率',
            serviceType: 'LINEHAUL',
            tenantId,
            updatedBy: actorId,
          },
        });
        await prisma.rateVersion.create({
          data: {
            baseRate,
            createdBy: actorId,
            currency: 'CNY',
            dimensionHash: code === 'AP' ? 'a'.repeat(64) : 'b'.repeat(64),
            dimensions: { route: 'SHA-SUZ' },
            effectiveFrom: new Date(now.getTime() - 86_400_000),
            effectiveUntil: new Date(now.getTime() + 86_400_000),
            pricing,
            publishedAt: now,
            rateCardId: card.id,
            status: 'PUBLISHED',
            tenantId,
            updatedBy: actorId,
            versionNumber: 1,
          },
        });
        return contract;
      }
      const payableContract = await rateSource('AP', '100', {
        fuelPercent: '10',
        taxRate: '6',
        unitRate: '1',
        waitingFee: '999',
      });
      const receivableContract = await rateSource('AR', '150', {
        fuelPercent: '5',
        markupPercent: '20',
        minimumCharge: '800',
        taxRate: '6',
        unitRate: '1.2',
        waitingFee: '999',
      });
      const alternateCard = await prisma.rateCard.create({
        data: {
          code: 'LINEHAUL-ALT',
          contractId: payableContract.id,
          createdBy: actorId,
          name: '重复匹配测试费率',
          serviceType: 'LINEHAUL',
          tenantId,
          updatedBy: actorId,
        },
      });
      const alternateRate = await prisma.rateVersion.create({
        data: {
          baseRate: '90',
          createdBy: actorId,
          currency: 'CNY',
          dimensionHash: 'c'.repeat(64),
          dimensions: { route: 'SHA-SUZ' },
          effectiveFrom: new Date(now.getTime() - 86_400_000),
          effectiveUntil: new Date(now.getTime() + 86_400_000),
          pricing: { unitRate: '1' },
          publishedAt: now,
          rateCardId: alternateCard.id,
          status: 'PUBLISHED',
          tenantId,
          updatedBy: actorId,
          versionNumber: 1,
        },
      });
      const service = new FreightBillingService(
        prisma as never,
        new RateMatchingFacade(prisma as never),
      );
      const firstFacts = await service.captureFacts(
        shipment.id,
        context,
        command(),
      );
      const replayedFacts = await service.captureFacts(
        shipment.id,
        context,
        command(),
      );
      expect(replayedFacts.factIds).toEqual(firstFacts.factIds);
      expect(
        await prisma.freightChargeFact.count({ where: { tenantId } }),
      ).toBe(10);
      const weight = await prisma.freightChargeFact.findFirstOrThrow({
        where: { factType: 'WEIGHT', shipmentId: shipment.id, tenantId },
      });
      const waiting = await prisma.freightChargeFact.findFirstOrThrow({
        where: { factType: 'WAITING', shipmentId: shipment.id, tenantId },
      });
      expect(waiting.value.toNumber()).toBeGreaterThan(0);
      await expect(
        prisma.freightChargeFact.update({
          data: { value: 1 },
          where: { id: weight.id },
        }),
      ).rejects.toBeDefined();

      const missing = await service.calculate(
        shipment.id,
        {
          contractId: payableContract.id,
          dimensions: { route: 'SHA-SUZ' },
          direction: 'PAYABLE',
          freightChargeFactId: weight.id,
          serviceType: 'UNKNOWN',
        },
        context,
        command(),
      );
      expect(missing).toMatchObject({
        exceptionCode: 'RATE_NOT_FOUND',
        status: 'EXCEPTION',
      });
      await expect(
        service.createStatement(
          'PAYABLE',
          {
            calculationIds: [missing.calculationId],
            contractId: payableContract.id,
            partnerRef: 'CARRIER-1',
            periodFrom: now.toISOString(),
            periodTo: now.toISOString(),
          },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'TMS_STATEMENT_CALCULATION_INVALID' });
      const multiple = await service.calculate(
        shipment.id,
        {
          contractId: payableContract.id,
          dimensions: { route: 'SHA-SUZ' },
          direction: 'PAYABLE',
          freightChargeFactId: weight.id,
          serviceType: 'LINEHAUL',
        },
        context,
        command(),
      );
      expect(multiple).toMatchObject({
        exceptionCode: 'MULTIPLE_RATE_MATCHES',
        status: 'EXCEPTION',
      });
      await prisma.rateVersion.update({
        data: {
          status: 'RETIRED',
          updatedBy: actorId,
          version: { increment: 1 },
        },
        where: { id: alternateRate.id },
      });
      const payable = await service.calculate(
        shipment.id,
        {
          contractId: payableContract.id,
          dimensions: { route: 'SHA-SUZ' },
          direction: 'PAYABLE',
          freightChargeFactId: weight.id,
          serviceType: 'LINEHAUL',
        },
        context,
        command(),
      );
      expect(payable).toMatchObject({
        status: 'CALCULATED',
        totalAmount: '699.6',
      });
      expect(
        await prisma.billingException.findUniqueOrThrow({
          where: {
            tenantId_chargeCalculationId: {
              chargeCalculationId: missing.calculationId,
              tenantId,
            },
          },
        }),
      ).toMatchObject({ status: 'RESOLVED' });
      const receivable = await service.calculate(
        shipment.id,
        {
          contractId: receivableContract.id,
          dimensions: { route: 'SHA-SUZ' },
          direction: 'RECEIVABLE',
          freightChargeFactId: weight.id,
          serviceType: 'LINEHAUL',
        },
        context,
        command(),
      );
      expect(receivable).toMatchObject({
        status: 'CALCULATED',
        totalAmount: '1060',
      });
      expect(Number(receivable.totalAmount)).toBeGreaterThan(
        Number(payable.totalAmount),
      );
      await expect(
        prisma.chargeCalculation.update({
          data: { totalAmount: 1 },
          where: { id: payable.calculationId },
        }),
      ).rejects.toBeDefined();
      const accrual = await service.createAccrual(
        payable.calculationId,
        { accountingDate: now.toISOString() },
        context,
        command(),
      );
      await expect(
        service.createAccrual(
          payable.calculationId,
          { accountingDate: now.toISOString() },
          context,
          command(),
        ),
      ).resolves.toMatchObject({
        accrualVoucherId: accrual.accrualVoucherId,
        replayed: true,
      });
      const period = {
        periodFrom: new Date(now.getTime() - 86_400_000).toISOString(),
        periodTo: new Date(now.getTime() + 86_400_000).toISOString(),
      };
      const carrier = await service.createStatement(
        'PAYABLE',
        {
          calculationIds: [payable.calculationId],
          contractId: payableContract.id,
          partnerRef: 'CARRIER-1',
          ...period,
        },
        context,
        command(),
      );
      const customer = await service.createStatement(
        'RECEIVABLE',
        {
          calculationIds: [receivable.calculationId],
          contractId: receivableContract.id,
          partnerRef: 'CUSTOMER-1',
          pricingSnapshot: { independentFromPayable: true },
          ...period,
        },
        context,
        command(),
      );
      const disputed = await service.transitionStatement(
        'PAYABLE',
        carrier.statementId,
        {
          decision: 'DISPUTE',
          disputeSnapshot: { reason: '等待费争议' },
          expectedVersion: carrier.version,
        },
        context,
        command(),
      );
      await expect(
        service.transitionStatement(
          'PAYABLE',
          carrier.statementId,
          {
            decision: 'CONFIRM',
            disputeSnapshot: {},
            expectedVersion: carrier.version,
          },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'TMS_STATEMENT_VERSION_CONFLICT' });
      const adjusted = await service.transitionStatement(
        'PAYABLE',
        carrier.statementId,
        {
          decision: 'ADJUST',
          disputeSnapshot: { resolution: '核对计费事实，无需改价' },
          expectedVersion: disputed.version,
        },
        context,
        command(),
      );
      const carrierVouchered = await service.transitionStatement(
        'PAYABLE',
        carrier.statementId,
        {
          decision: 'CONFIRM',
          disputeSnapshot: { confirmed: true },
          expectedVersion: adjusted.version,
        },
        context,
        command(),
      );
      const customerVouchered = await service.transitionStatement(
        'RECEIVABLE',
        customer.statementId,
        {
          decision: 'CONFIRM',
          disputeSnapshot: { confirmed: true },
          expectedVersion: customer.version,
        },
        context,
        command(),
      );
      expect(carrierVouchered.voucherId).toBeDefined();
      expect(customerVouchered.voucherId).toBeDefined();
      const line = await prisma.settlementStatementLine.findFirstOrThrow({
        where: { shipmentId: shipment.id, tenantId },
      });
      await expect(
        prisma.settlementStatementLine.update({
          data: { amount: 1 },
          where: { id: line.id },
        }),
      ).rejects.toBeDefined();
      await expect(
        service.settleShipment(
          shipment.id,
          { expectedVersion: shipment.version },
          context,
          command(),
        ),
      ).resolves.toMatchObject({ status: 'SETTLED' });
    });
  },
);
