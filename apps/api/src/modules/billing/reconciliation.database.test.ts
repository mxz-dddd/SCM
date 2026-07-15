import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { ReconciliationService } from './reconciliation.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('Billing reconciliation, disputes and adjustments', () => {
  afterAll(() => prisma.$disconnect());

  it('preserves statement versions and posts balanced approved adjustments', async () => {
    const tenantId = randomUUID();
    const creatorId = randomUUID();
    const approverId = randomUUID();
    const partnerRef = randomUUID();
    const contractRef = randomUUID();
    const context = (accountId: string): TenantContext => ({
      accountId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'billing-reconciliation-database-test',
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
    const service = new ReconciliationService(prisma as never);
    const occurredAt = new Date('2031-03-15T08:00:00.000Z');
    const fact = await prisma.chargeFact.create({
      data: {
        aggregateRef: 'SHIP-RECONCILIATION-1',
        businessRef: 'ORDER-RECONCILIATION-1',
        chargeType: 'TRANSPORT_LINEHAUL',
        contentHash: 'a'.repeat(64),
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
    const match = await prisma.rateMatch.create({
      data: {
        baseRate: '100',
        chargeFactId: fact.id,
        contractRef,
        createdBy: creatorId,
        currency: 'CNY',
        factOccurredAt: occurredAt,
        matchKey: `RECONCILIATION:${randomUUID()}`,
        rateCardRef: randomUUID(),
        rateVersionNumber: 1,
        rateVersionRef: randomUUID(),
        status: 'MATCHED',
        tenantId,
        updatedBy: creatorId,
      },
    });
    const calculation = await prisma.billingCalculation.create({
      data: {
        accessorialAmount: '0',
        businessRef: fact.businessRef,
        calculationNo: `CAL-REC-${randomUUID()}`,
        calculationVersion: 1,
        chargeFactId: fact.id,
        chargeType: fact.chargeType,
        createdBy: creatorId,
        direction: 'PAYABLE',
        rateMatchId: match.id,
        rateVersionNumber: 1,
        rateVersionRef: match.rateVersionRef!,
        settlementCurrency: 'CNY',
        sourceCurrency: 'CNY',
        subtotalAmount: '100',
        taxAmount: '6',
        tenantId,
        totalAmount: '106',
        updatedBy: creatorId,
      },
    });
    const voucher = await prisma.settlementVoucher.create({
      data: {
        approvalThreshold: '1000',
        approvedAt: occurredAt,
        approvedBy: approverId,
        businessType: fact.chargeType,
        contractSnapshot: [{ contractRef, rateVersionNumber: 1 }],
        createdBy: creatorId,
        currency: 'CNY',
        direction: 'PAYABLE',
        partnerRef,
        periodFrom: new Date('2031-03-01T00:00:00.000Z'),
        periodTo: new Date('2031-03-31T00:00:00.000Z'),
        status: 'APPROVED',
        subtotalAmount: '100',
        taxAmount: '6',
        tenantId,
        totalAmount: '106',
        updatedBy: creatorId,
        version: 4,
        voucherNo: `AP-REC-${randomUUID()}`,
      },
    });
    const baseLine = await prisma.billingVoucherLine.create({
      data: {
        amount: '100',
        calculationId: calculation.id,
        createdBy: creatorId,
        currency: 'CNY',
        lineNo: 1,
        sourceLineRef: randomUUID(),
        sourceSnapshot: { lineType: 'BASE' },
        sourceType: 'CALCULATION_LINE',
        tenantId,
        updatedBy: creatorId,
        voucherId: voucher.id,
      },
    });
    await prisma.billingVoucherLine.create({
      data: {
        amount: '6',
        calculationId: calculation.id,
        createdBy: creatorId,
        currency: 'CNY',
        lineNo: 2,
        sourceLineRef: randomUUID(),
        sourceSnapshot: { lineType: 'TAX' },
        sourceType: 'TAX_DETAIL',
        taxComponent: true,
        tenantId,
        updatedBy: creatorId,
        voucherId: voucher.id,
      },
    });

    const statement = await service.createStatement(
      {
        attachmentRefs: ['attachment://reconciliation/supporting-detail'],
        contractRef,
        partnerSnapshot: { displayName: 'Test Carrier' },
        periodFrom: '2031-03-01',
        periodTo: '2031-03-31',
        voucherIds: [voucher.id],
      },
      context(creatorId),
      metadata(),
    );
    expect(statement).toMatchObject({
      lineCount: 2,
      status: 'DRAFT',
      totalAmount: '106',
      version: 1,
    });
    await expect(
      service.createStatement(
        {
          contractRef,
          periodFrom: '2031-03-01',
          periodTo: '2031-03-31',
          voucherIds: [voucher.id],
        },
        context(creatorId),
        metadata(),
      ),
    ).rejects.toMatchObject({
      code: 'BILLING_VOUCHER_LINE_ALREADY_RECONCILED',
      statusCode: 409,
    });
    await expect(
      service.reconcileStatement(
        statement.statementId,
        { expectedVersion: 1 },
        context(creatorId),
        metadata(),
      ),
    ).rejects.toMatchObject({
      code: 'BILLING_RECONCILIATION_TRANSITION_INVALID',
    });
    const published = await service.publishStatement(
      statement.statementId,
      { expectedVersion: 1 },
      context(creatorId),
      metadata(),
    );
    expect(published).toMatchObject({ status: 'PUBLISHED', version: 2 });
    await expect(
      service.publishStatement(
        statement.statementId,
        { expectedVersion: 2 },
        context(creatorId),
        metadata(),
      ),
    ).rejects.toMatchObject({
      code: 'BILLING_RECONCILIATION_TRANSITION_INVALID',
    });
    const statementLine = await prisma.reconciliationStatementLine.findFirstOrThrow({
      where: { statementId: statement.statementId, voucherLineId: baseLine.id },
    });
    const disputed = await service.raiseDispute(
      statement.statementId,
      {
        category: 'RATE',
        description: 'Partner disputes the contracted rate',
        disputedAmount: '12',
        evidenceRefs: ['attachment://reconciliation/rate-sheet'],
        expectedStatementVersion: 2,
        raisedByType: 'PARTNER',
        statementLineId: statementLine.id,
      },
      context(creatorId),
      metadata(),
    );
    expect(disputed).toMatchObject({
      disputeStatus: 'OPEN',
      statementStatus: 'DISPUTED',
      statementVersion: 3,
    });
    const evidenceRequested = await service.respondDispute(
      disputed.disputeId,
      {
        action: 'REQUEST_EVIDENCE',
        expectedVersion: 1,
        message: 'Please provide the signed rate sheet',
      },
      context(approverId),
      metadata(),
    );
    expect(evidenceRequested).toMatchObject({
      status: 'EVIDENCE_REQUESTED',
      version: 2,
    });
    const evidenceSubmitted = await service.respondDispute(
      disputed.disputeId,
      {
        action: 'SUBMIT_EVIDENCE',
        evidenceRefs: ['attachment://reconciliation/signed-rate-sheet'],
        expectedVersion: 2,
        message: 'Signed rate sheet attached',
      },
      context(creatorId),
      metadata(),
    );
    expect(evidenceSubmitted).toMatchObject({ status: 'OPEN', version: 3 });
    const accepted = await service.respondDispute(
      disputed.disputeId,
      {
        action: 'ACCEPT',
        expectedVersion: 3,
        message: 'Rate difference accepted',
      },
      context(approverId),
      metadata(),
    );
    expect(accepted).toMatchObject({ status: 'ACCEPTED', version: 4 });
    const missingDispute = await service.raiseDispute(
      statement.statementId,
      {
        category: 'MISSING',
        description: 'Partner reports a missing service line',
        disputedAmount: '2',
        expectedStatementVersion: 3,
        raisedByType: 'PARTNER',
      },
      context(creatorId),
      metadata(),
    );
    expect(missingDispute).toMatchObject({
      disputeStatus: 'OPEN',
      statementStatus: 'DISPUTED',
      statementVersion: 3,
    });
    expect(
      await service.respondDispute(
        missingDispute.disputeId,
        {
          action: 'REJECT',
          expectedVersion: 1,
          message: 'The referenced service was outside this contract period',
        },
        context(approverId),
        metadata(),
      ),
    ).toMatchObject({ status: 'REJECTED', version: 2 });
    await expect(
      service.reconcileStatement(
        statement.statementId,
        { expectedVersion: 3 },
        context(creatorId),
        metadata(),
      ),
    ).rejects.toMatchObject({ code: 'BILLING_RECONCILIATION_DISPUTES_OPEN' });

    await expect(
      service.createAdjustment(
        {
          adjustmentType: 'ADJUSTMENT',
          allocations: [
            { amount: '11', targetRef: 'ORDER-1', targetType: 'ORDER' },
          ],
          amount: '12',
          direction: 'DECREASE',
          disputeId: disputed.disputeId,
          reason: 'Unbalanced adjustment must fail',
          sourceVoucherId: voucher.id,
          statementId: statement.statementId,
        },
        context(creatorId),
        metadata(),
      ),
    ).rejects.toMatchObject({
      code: 'BILLING_ADJUSTMENT_ALLOCATION_UNBALANCED',
      statusCode: 400,
    });
    const adjustment = await service.createAdjustment(
      {
        adjustmentType: 'ADJUSTMENT',
        allocations: [
          { amount: '7', targetRef: 'ORDER-1', targetType: 'ORDER' },
          {
            amount: '5',
            targetRef: 'COST-CENTER-LOGISTICS',
            targetType: 'COST_CENTER',
          },
        ],
        amount: '12',
        direction: 'DECREASE',
        disputeId: disputed.disputeId,
        reason: 'Accepted rate difference',
        sourceVoucherId: voucher.id,
        statementId: statement.statementId,
      },
      context(creatorId),
      metadata(),
    );
    expect(adjustment).toMatchObject({ status: 'DRAFT', version: 1 });
    const submitted = await service.submitAdjustment(
      adjustment.adjustmentId,
      { expectedVersion: 1 },
      context(creatorId),
      metadata(),
    );
    expect(submitted).toMatchObject({ status: 'PENDING_APPROVAL', version: 2 });
    await expect(
      service.decideAdjustment(
        submitted.approvalTaskId,
        {
          decision: 'APPROVE',
          expectedAdjustmentVersion: 2,
          expectedTaskVersion: 1,
          reason: 'Creator attempts self approval',
        },
        context(creatorId),
        metadata(),
      ),
    ).rejects.toMatchObject({
      code: 'BILLING_ADJUSTMENT_MAKER_CHECKER_REQUIRED',
      statusCode: 403,
    });
    const approved = await service.decideAdjustment(
      submitted.approvalTaskId,
      {
        decision: 'APPROVE',
        expectedAdjustmentVersion: 2,
        expectedTaskVersion: 1,
        reason: 'Allocation and source voucher checked',
      },
      context(approverId),
      metadata(),
    );
    expect(approved).toMatchObject({ status: 'APPROVED', version: 3 });
    const posted = await service.postAdjustment(
      adjustment.adjustmentId,
      { expectedVersion: 3 },
      context(creatorId),
      metadata(),
    );
    expect(posted).toMatchObject({ status: 'POSTED', version: 4 });
    expect(
      await prisma.reconciliationDispute.findUniqueOrThrow({
        where: { id: disputed.disputeId },
      }),
    ).toMatchObject({ status: 'ADJUSTED', version: 5 });
    expect(
      await prisma.reconciliationStatement.findUniqueOrThrow({
        where: { id: statement.statementId },
      }),
    ).toMatchObject({ status: 'ADJUSTED', version: 4 });
    const reconciled = await service.reconcileStatement(
      statement.statementId,
      { expectedVersion: 4 },
      context(creatorId),
      metadata(),
    );
    expect(reconciled).toMatchObject({ status: 'RECONCILED', version: 5 });
    expect(
      await prisma.settlementVoucher.findUniqueOrThrow({ where: { id: voucher.id } }),
    ).toMatchObject({ status: 'RECONCILED', version: 5 });
    expect(
      await prisma.reconciliationStatementVersion.findMany({
        orderBy: { versionNo: 'asc' },
        where: { statementId: statement.statementId },
      }),
    ).toEqual([
      expect.objectContaining({ statementStatus: 'DRAFT', versionNo: 1 }),
      expect.objectContaining({ statementStatus: 'PUBLISHED', versionNo: 2 }),
      expect.objectContaining({ statementStatus: 'DISPUTED', versionNo: 3 }),
      expect.objectContaining({ statementStatus: 'ADJUSTED', versionNo: 4 }),
      expect.objectContaining({ statementStatus: 'RECONCILED', versionNo: 5 }),
    ]);
    expect(
      await prisma.billingAdjustmentStatusHistory.findMany({
        orderBy: { sequence: 'asc' },
        where: { adjustmentId: adjustment.adjustmentId },
      }),
    ).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'DRAFT' }),
      expect.objectContaining({
        fromStatus: 'DRAFT',
        toStatus: 'PENDING_APPROVAL',
      }),
      expect.objectContaining({
        fromStatus: 'PENDING_APPROVAL',
        toStatus: 'APPROVED',
      }),
      expect.objectContaining({ fromStatus: 'APPROVED', toStatus: 'POSTED' }),
    ]);

    const directVoucher = await prisma.settlementVoucher.create({
      data: {
        approvalThreshold: '1000',
        approvedAt: occurredAt,
        approvedBy: approverId,
        businessType: fact.chargeType,
        contractSnapshot: [{ contractRef, rateVersionNumber: 1 }],
        createdBy: creatorId,
        currency: 'CNY',
        direction: 'PAYABLE',
        partnerRef,
        periodFrom: new Date('2031-03-01T00:00:00.000Z'),
        periodTo: new Date('2031-03-31T00:00:00.000Z'),
        status: 'APPROVED',
        subtotalAmount: '5',
        taxAmount: '0',
        tenantId,
        totalAmount: '5',
        updatedBy: creatorId,
        version: 4,
        voucherNo: `AP-REC-DIRECT-${randomUUID()}`,
      },
    });
    await prisma.billingVoucherLine.create({
      data: {
        amount: '5',
        calculationId: calculation.id,
        createdBy: creatorId,
        currency: 'CNY',
        lineNo: 1,
        sourceLineRef: randomUUID(),
        sourceSnapshot: { lineType: 'BASE' },
        sourceType: 'CALCULATION_LINE',
        tenantId,
        updatedBy: creatorId,
        voucherId: directVoucher.id,
      },
    });
    const directStatement = await service.createStatement(
      {
        contractRef,
        periodFrom: '2031-03-01',
        periodTo: '2031-03-31',
        voucherIds: [directVoucher.id],
      },
      context(creatorId),
      metadata(),
    );
    await service.publishStatement(
      directStatement.statementId,
      { expectedVersion: 1 },
      context(creatorId),
      metadata(),
    );
    expect(
      await service.reconcileStatement(
        directStatement.statementId,
        { expectedVersion: 2 },
        context(creatorId),
        metadata(),
      ),
    ).toMatchObject({ status: 'RECONCILED', version: 3 });

    const rejectedAdjustment = await service.createAdjustment(
      {
        adjustmentType: 'CLAIM_DEDUCTION',
        allocations: [
          { amount: '3', targetRef: 'ORDER-CLAIM-1', targetType: 'ORDER' },
        ],
        amount: '3',
        direction: 'DECREASE',
        reason: 'Claim deduction pending independent approval',
        sourceVoucherId: voucher.id,
      },
      context(creatorId),
      metadata(),
    );
    const rejectedSubmission = await service.submitAdjustment(
      rejectedAdjustment.adjustmentId,
      { expectedVersion: 1 },
      context(creatorId),
      metadata(),
    );
    expect(
      await service.decideAdjustment(
        rejectedSubmission.approvalTaskId,
        {
          decision: 'REJECT',
          expectedAdjustmentVersion: 2,
          expectedTaskVersion: 1,
          reason: 'Claim evidence is incomplete',
        },
        context(approverId),
        metadata(),
      ),
    ).toMatchObject({ status: 'REJECTED', version: 3 });

    await expect(
      prisma.reconciliationStatementLine.update({
        data: { amount: '1' },
        where: { id: statementLine.id },
      }),
    ).rejects.toThrow(/immutable/i);
    const allocation = await prisma.billingAllocationDetail.findFirstOrThrow({
      where: { adjustmentId: adjustment.adjustmentId },
    });
    await expect(
      prisma.billingAllocationDetail.update({
        data: { amount: '1' },
        where: { id: allocation.id },
      }),
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.billingAdjustmentVoucher.update({
        data: { reason: 'overwrite posted history' },
        where: { id: adjustment.adjustmentId },
      }),
    ).rejects.toThrow(/immutable/i);
    expect(
      await prisma.platformOutbox.count({ where: { tenantId } }),
    ).toBeGreaterThanOrEqual(12);
  });
});
