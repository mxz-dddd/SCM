import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { SettlementVoucherService } from './settlement-voucher.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('Billing AR/AP voucher, accrual and reversal', () => {
  afterAll(() => prisma.$disconnect());

  it('enforces voucher transitions, unique posting, approval routing and linked accrual reversal', async () => {
    const tenantId = randomUUID();
    const creatorId = randomUUID();
    const approverId = randomUUID();
    const partnerRef = randomUUID();
    const occurredAt = new Date('2030-06-15T08:00:00.000Z');
    const context = (accountId: string): TenantContext => ({
      accountId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'billing-voucher-database-test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    });
    const metadata = () => ({
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      ipAddress: '127.0.0.1',
    });
    const service = new SettlementVoucherService(prisma as never);
    const fact = await prisma.chargeFact.create({
      data: {
        aggregateRef: 'SHIP-VOUCHER-1',
        businessRef: 'SHIP-VOUCHER-1',
        chargeType: 'TRANSPORT_LINEHAUL',
        contentHash: 'e'.repeat(64),
        createdBy: creatorId,
        currency: 'CNY',
        dimensions: {},
        eventId: `event-${randomUUID()}`,
        occurredAt,
        partyRef: partnerRef,
        quantityBase: '1',
        quantityBaseUom: 'EA',
        quantityOriginal: '1',
        quantityUom: 'EA',
        serviceType: 'LINEHAUL',
        sourceDomain: 'TMS',
        sourceEventType: 'shipment.delivered.v1',
        sourceSnapshot: {},
        tenantId,
        updatedBy: creatorId,
      },
    });

    async function calculation(
      calculationVersion: number,
      totalAmount: string,
      contract = true,
      sourceFact = fact,
    ) {
      const taxAmount = '6';
      const accessorialAmount = '10';
      const subtotalAmount = String(
        Number(totalAmount) - Number(taxAmount) - Number(accessorialAmount),
      );
      const match = await prisma.rateMatch.create({
        data: {
          baseRate: '1',
          chargeFactId: sourceFact.id,
          ...(contract ? { contractRef: randomUUID() } : {}),
          createdBy: creatorId,
          currency: 'CNY',
          factOccurredAt: occurredAt,
          matchKey: `VOUCHER-TEST:${randomUUID()}`,
          rateCardRef: randomUUID(),
          rateVersionNumber: 1,
          rateVersionRef: randomUUID(),
          status: 'MATCHED',
          tenantId,
          updatedBy: creatorId,
        },
      });
      const row = await prisma.billingCalculation.create({
        data: {
          accessorialAmount,
          businessRef: sourceFact.businessRef,
          calculationNo: `CAL-VOUCHER-${randomUUID()}`,
          calculationVersion,
          chargeFactId: sourceFact.id,
          chargeType: sourceFact.chargeType,
          createdBy: creatorId,
          direction: 'PAYABLE',
          rateMatchId: match.id,
          rateVersionNumber: 1,
          rateVersionRef: match.rateVersionRef!,
          settlementCurrency: 'CNY',
          sourceCurrency: 'CNY',
          subtotalAmount,
          taxAmount,
          tenantId,
          totalAmount,
          updatedBy: creatorId,
        },
      });
      await prisma.billingCalculationLine.create({
        data: {
          basisQuantity: '1',
          basisType: 'BASE_QUANTITY',
          basisUom: 'EA',
          calculationId: row.id,
          createdBy: creatorId,
          currency: 'CNY',
          expressionSnapshot: {},
          lineNo: 1,
          lineType: 'BASE',
          rateAmount: subtotalAmount,
          roundedAmount: subtotalAmount,
          roundingDifference: '0',
          tenantId,
          tierSnapshot: {},
          unroundedAmount: subtotalAmount,
          updatedBy: creatorId,
        },
      });
      await prisma.accessorialCharge.create({
        data: {
          amount: accessorialAmount,
          basisSnapshot: {},
          calculationId: row.id,
          chargeType: 'FUEL',
          code: 'FUEL',
          conditionSnapshot: {},
          createdBy: creatorId,
          currency: 'CNY',
          lineNo: 1,
          method: 'FIXED',
          roundingDifference: '0',
          tenantId,
          unroundedAmount: accessorialAmount,
          updatedBy: creatorId,
        },
      });
      await prisma.taxDetail.create({
        data: {
          calculationId: row.id,
          createdBy: creatorId,
          currency: 'CNY',
          roundingSnapshot: {},
          taxAmount,
          taxableAmount: String(Number(totalAmount) - Number(taxAmount)),
          taxMode: 'EXCLUSIVE',
          taxRate: '6',
          tenantId,
          totalWithTax: totalAmount,
          updatedBy: creatorId,
        },
      });
      await prisma.fxConversion.create({
        data: {
          calculationId: row.id,
          createdBy: creatorId,
          exchangeRate: '1',
          rateDate: occurredAt,
          roundingDifference: '0',
          roundingMode: 'HALF_UP',
          roundingScale: 2,
          sourceAmount: totalAmount,
          sourceCurrency: 'CNY',
          sourceName: 'IDENTITY',
          targetAmount: totalAmount,
          targetCurrency: 'CNY',
          tenantId,
          unroundedTargetAmount: totalAmount,
          updatedBy: creatorId,
        },
      });
      return row;
    }

    const accruedCalculation = await calculation(1, '116');
    const actualCalculation = await calculation(2, '120');
    const accrual = await service.createAccrual(
      accruedCalculation.id,
      { accountingDate: '2030-06-30' },
      context(creatorId),
      metadata(),
    );
    expect(accrual).toMatchObject({ replayed: false, status: 'DRAFT' });
    expect(
      await service.createAccrual(
        accruedCalculation.id,
        { accountingDate: '2030-06-30' },
        context(creatorId),
        metadata(),
      ),
    ).toMatchObject({
      accrualVoucherId: accrual.accrualVoucherId,
      replayed: true,
    });
    const posted = await service.postAccrual(
      accrual.accrualVoucherId,
      { expectedVersion: 1 },
      context(creatorId),
      metadata(),
    );
    expect(posted).toMatchObject({ status: 'POSTED', version: 2 });
    await expect(
      service.postAccrual(
        accrual.accrualVoucherId,
        { expectedVersion: 2 },
        context(creatorId),
        metadata(),
      ),
    ).rejects.toMatchObject({ code: 'BILLING_ACCRUAL_STATE_INVALID' });

    const draft = await service.createDraft(
      {
        approvalThreshold: '50',
        businessType: 'TRANSPORT_LINEHAUL',
        calculationIds: [actualCalculation.id],
        direction: 'PAYABLE',
        partnerRef,
        periodFrom: '2030-06-01',
        periodTo: '2030-06-30',
      },
      context(creatorId),
      metadata(),
    );
    expect(draft).toMatchObject({ status: 'DRAFT', version: 1 });
    await expect(
      service.validate(
        draft.voucherId,
        { expectedVersion: 1 },
        context(creatorId),
        metadata(),
      ),
    ).rejects.toMatchObject({ code: 'BILLING_VOUCHER_TRANSITION_INVALID' });
    const calculated = await service.calculate(
      draft.voucherId,
      { expectedVersion: 1 },
      context(creatorId),
      metadata(),
    );
    expect(calculated).toMatchObject({
      lineCount: 3,
      status: 'CALCULATED',
      totalAmount: '120',
      version: 2,
    });
    const validated = await service.validate(
      draft.voucherId,
      { expectedVersion: 2 },
      context(creatorId),
      metadata(),
    );
    expect(validated).toMatchObject({
      approvalRequired: true,
      status: 'VALIDATED',
      version: 3,
    });
    if (!('approvalTaskId' in validated) || !validated.approvalTaskId)
      throw new Error('Expected a routed approval task');
    const approval = await prisma.voucherApprovalTask.findUniqueOrThrow({
      where: { id: validated.approvalTaskId },
    });
    expect(approval.routeReasonSnapshot).toEqual(['AMOUNT_OVER_THRESHOLD']);
    await expect(
      service.decideApproval(
        approval.id,
        {
          decision: 'APPROVE',
          expectedTaskVersion: 1,
          expectedVoucherVersion: 3,
          reason: '制单人尝试自批',
        },
        context(creatorId),
        metadata(),
      ),
    ).rejects.toMatchObject({
      code: 'BILLING_MAKER_CHECKER_REQUIRED',
      statusCode: 403,
    });
    const approved = await service.decideApproval(
      approval.id,
      {
        decision: 'APPROVE',
        expectedTaskVersion: 1,
        expectedVoucherVersion: 3,
        reason: '金额、合同及税额复核通过',
      },
      context(approverId),
      metadata(),
    );
    expect(approved).toMatchObject({
      status: 'APPROVED',
      version: 4,
    });
    if (!('reversalIds' in approved))
      throw new Error('Expected approved voucher reversal links');
    expect(approved.reversalIds).toHaveLength(1);
    const reversalId = approved.reversalIds[0];
    if (!reversalId) throw new Error('Expected one reversal voucher');
    const reversal = await prisma.billingReversalVoucher.findUniqueOrThrow({
      where: { id: reversalId },
    });
    expect(reversal.reversalAmount.toString()).toBe('-116');
    expect(reversal.differenceAmount.toString()).toBe('4');
    expect(
      await prisma.billingAccrualVoucher.findUniqueOrThrow({
        where: { id: accrual.accrualVoucherId },
      }),
    ).toMatchObject({ status: 'REVERSED', version: 3 });
    expect(
      await prisma.voucherStatusHistory.findMany({
        orderBy: { sequence: 'asc' },
        where: { voucherId: draft.voucherId },
      }),
    ).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'DRAFT' }),
      expect.objectContaining({
        fromStatus: 'DRAFT',
        toStatus: 'CALCULATED',
      }),
      expect.objectContaining({
        fromStatus: 'CALCULATED',
        toStatus: 'VALIDATED',
      }),
      expect.objectContaining({
        fromStatus: 'VALIDATED',
        toStatus: 'APPROVED',
      }),
    ]);

    const duplicate = await service.createDraft(
      {
        approvalThreshold: '9999',
        businessType: 'TRANSPORT_LINEHAUL',
        calculationIds: [actualCalculation.id],
        direction: 'PAYABLE',
        partnerRef,
        periodFrom: '2030-06-01',
        periodTo: '2030-06-30',
      },
      context(creatorId),
      metadata(),
    );
    await expect(
      service.calculate(
        duplicate.voucherId,
        { expectedVersion: 1 },
        context(creatorId),
        metadata(),
      ),
    ).rejects.toMatchObject({
      code: 'BILLING_CALCULATION_LINE_ALREADY_VOUCHERED',
      statusCode: 409,
    });

    const noContractFact = await prisma.chargeFact.create({
      data: {
        ...{
          aggregateRef: 'SHIP-VOUCHER-NO-CONTRACT',
          businessRef: 'SHIP-VOUCHER-NO-CONTRACT',
          chargeType: 'TRANSPORT_LINEHAUL',
          contentHash: 'f'.repeat(64),
          createdBy: creatorId,
          currency: 'CNY',
          dimensions: {},
          eventId: `event-${randomUUID()}`,
          occurredAt,
          partyRef: partnerRef,
          quantityBase: '1',
          quantityBaseUom: 'EA',
          quantityOriginal: '1',
          quantityUom: 'EA',
          serviceType: 'LINEHAUL',
          sourceDomain: 'TMS',
          sourceEventType: 'shipment.delivered.v1',
          sourceSnapshot: {},
          tenantId,
          updatedBy: creatorId,
        },
      },
    });
    const noContractCalculation = await calculation(
      1,
      '20',
      false,
      noContractFact,
    );
    const noContractDraft = await service.createDraft(
      {
        approvalThreshold: '9999',
        businessType: 'TRANSPORT_LINEHAUL',
        calculationIds: [noContractCalculation.id],
        direction: 'PAYABLE',
        partnerRef,
        periodFrom: '2030-06-01',
        periodTo: '2030-06-30',
      },
      context(creatorId),
      metadata(),
    );
    await service.calculate(
      noContractDraft.voucherId,
      { expectedVersion: 1 },
      context(creatorId),
      metadata(),
    );
    const routed = await service.validate(
      noContractDraft.voucherId,
      { expectedVersion: 2 },
      context(creatorId),
      metadata(),
    );
    expect(routed).toMatchObject({ approvalRequired: true });
    if (!('approvalTaskId' in routed) || !routed.approvalTaskId)
      throw new Error('Expected no-contract approval routing');
    const noContractApproval =
      await prisma.voucherApprovalTask.findUniqueOrThrow({
        where: { id: routed.approvalTaskId },
      });
    expect(noContractApproval.routeReasonSnapshot).toEqual(['NO_CONTRACT']);
    expect(
      await service.decideApproval(
        noContractApproval.id,
        {
          decision: 'REJECT',
          expectedTaskVersion: 1,
          expectedVoucherVersion: 3,
          reason: '无合同费用证据不足',
        },
        context(approverId),
        metadata(),
      ),
    ).toMatchObject({
      approvalStatus: 'REJECTED',
      status: 'VALIDATED',
    });

    await expect(
      prisma.billingVoucherLine.update({
        data: { amount: '1' },
        where: {
          id: (
            await prisma.billingVoucherLine.findFirstOrThrow({
              where: { voucherId: draft.voucherId },
            })
          ).id,
        },
      }),
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.billingReversalVoucher.delete({ where: { id: reversal.id } }),
    ).rejects.toThrow(/immutable/i);
    expect(
      await prisma.platformOutbox.count({
        where: { aggregateType: 'SettlementVoucher', tenantId },
      }),
    ).toBeGreaterThanOrEqual(10);
  });
});
