import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { FinancialCloseService } from './financial-close.service';
import { SettlementVoucherService } from './settlement-voucher.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('Billing invoice, payment, period close and margin report', () => {
  afterAll(() => prisma.$disconnect());

  it('prevents over-invoicing, settles partial cash flows and closes audited periods', async () => {
    const tenantId = randomUUID();
    const financeId = randomUUID();
    const supervisorId = randomUUID();
    const partnerRef = randomUUID();
    const contractRef = randomUUID();
    const context = (accountId: string): TenantContext => ({
      accountId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'billing-financial-close-database-test',
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
    const service = new FinancialCloseService(prisma as never);
    const voucherService = new SettlementVoucherService(prisma as never);
    const occurredAt = new Date('2032-01-15T08:00:00.000Z');
    const fact = await prisma.chargeFact.create({
      data: {
        aggregateRef: 'SHIP-FINANCE-1',
        businessRef: 'ORDER-FINANCE-1',
        chargeType: 'TRANSPORT_LINEHAUL',
        contentHash: 'b'.repeat(64),
        createdBy: financeId,
        currency: 'CNY',
        dimensions: {
          routeRef: 'ROUTE-SHA-SUZ',
          warehouseRef: 'WH-SHA-01',
        },
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
        updatedBy: financeId,
      },
    });
    const match = await prisma.rateMatch.create({
      data: {
        baseRate: '100',
        chargeFactId: fact.id,
        contractRef,
        createdBy: financeId,
        currency: 'CNY',
        factOccurredAt: occurredAt,
        matchKey: `FINANCE:${randomUUID()}`,
        rateCardRef: randomUUID(),
        rateVersionNumber: 1,
        rateVersionRef: randomUUID(),
        status: 'MATCHED',
        tenantId,
        updatedBy: financeId,
      },
    });
    const calculation = await prisma.billingCalculation.create({
      data: {
        accessorialAmount: '0',
        businessRef: fact.businessRef,
        calculationNo: `CAL-FINANCE-${randomUUID()}`,
        calculationVersion: 1,
        chargeFactId: fact.id,
        chargeType: fact.chargeType,
        createdBy: financeId,
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
        updatedBy: financeId,
      },
    });
    await prisma.fxConversion.create({
      data: {
        calculationId: calculation.id,
        createdBy: financeId,
        exchangeRate: '1',
        rateDate: occurredAt,
        roundingDifference: '0',
        roundingMode: 'HALF_UP',
        roundingScale: 2,
        sourceAmount: '106',
        sourceCurrency: 'CNY',
        sourceName: 'IDENTITY',
        targetAmount: '106',
        targetCurrency: 'CNY',
        tenantId,
        unroundedTargetAmount: '106',
        updatedBy: financeId,
      },
    });
    const voucher = await prisma.settlementVoucher.create({
      data: {
        approvalThreshold: '1000',
        approvedAt: occurredAt,
        approvedBy: supervisorId,
        businessType: fact.chargeType,
        contractSnapshot: [{ contractRef }],
        createdBy: financeId,
        currency: 'CNY',
        direction: 'PAYABLE',
        partnerRef,
        periodFrom: new Date('2032-01-01T00:00:00.000Z'),
        periodTo: new Date('2032-01-31T00:00:00.000Z'),
        status: 'RECONCILED',
        subtotalAmount: '100',
        taxAmount: '6',
        tenantId,
        totalAmount: '106',
        updatedBy: financeId,
        version: 5,
        voucherNo: `AP-FINANCE-${randomUUID()}`,
      },
    });
    const voucherBase = await prisma.billingVoucherLine.create({
      data: {
        amount: '100',
        calculationId: calculation.id,
        createdBy: financeId,
        currency: 'CNY',
        lineNo: 1,
        sourceLineRef: randomUUID(),
        sourceSnapshot: { lineType: 'BASE' },
        sourceType: 'CALCULATION_LINE',
        tenantId,
        updatedBy: financeId,
        voucherId: voucher.id,
      },
    });
    const voucherTax = await prisma.billingVoucherLine.create({
      data: {
        amount: '6',
        calculationId: calculation.id,
        createdBy: financeId,
        currency: 'CNY',
        lineNo: 2,
        sourceLineRef: randomUUID(),
        sourceSnapshot: { lineType: 'TAX' },
        sourceType: 'TAX_DETAIL',
        taxComponent: true,
        tenantId,
        updatedBy: financeId,
        voucherId: voucher.id,
      },
    });
    const statement = await prisma.reconciliationStatement.create({
      data: {
        contractRef,
        createdBy: financeId,
        currency: 'CNY',
        direction: 'PAYABLE',
        lineCount: 2,
        partnerRef,
        partnerSnapshot: { partnerRef },
        periodFrom: new Date('2032-01-01T00:00:00.000Z'),
        periodTo: new Date('2032-01-31T00:00:00.000Z'),
        reconciledAt: occurredAt,
        reconciledBy: financeId,
        statementNo: `REC-FINANCE-${randomUUID()}`,
        status: 'RECONCILED',
        subtotalAmount: '100',
        taxAmount: '6',
        tenantId,
        totalAmount: '106',
        updatedBy: financeId,
        version: 3,
        voucherCount: 1,
      },
    });
    const statementBase = await prisma.reconciliationStatementLine.create({
      data: {
        amount: '100',
        businessRef: fact.businessRef,
        businessSnapshot: { calculationId: calculation.id },
        createdBy: financeId,
        currency: 'CNY',
        lineNo: 1,
        sourceLineRef: voucherBase.sourceLineRef,
        sourceType: voucherBase.sourceType,
        statementId: statement.id,
        tenantId,
        updatedBy: financeId,
        voucherId: voucher.id,
        voucherLineId: voucherBase.id,
        voucherSnapshot: { voucherNo: voucher.voucherNo },
      },
    });
    const statementTax = await prisma.reconciliationStatementLine.create({
      data: {
        amount: '6',
        businessRef: fact.businessRef,
        businessSnapshot: { calculationId: calculation.id },
        createdBy: financeId,
        currency: 'CNY',
        lineNo: 2,
        sourceLineRef: voucherTax.sourceLineRef,
        sourceType: voucherTax.sourceType,
        statementId: statement.id,
        taxComponent: true,
        tenantId,
        updatedBy: financeId,
        voucherId: voucher.id,
        voucherLineId: voucherTax.id,
        voucherSnapshot: { voucherNo: voucher.voucherNo },
      },
    });
    const period = await service.createPeriod(
      {
        periodFrom: '2032-01-01',
        periodKey: '2032-01',
        periodTo: '2032-01-31',
      },
      context(supervisorId),
      metadata(),
    );
    expect(period).toMatchObject({ status: 'OPEN', version: 1 });

    const invoice1 = await service.createInvoice(
      {
        attachmentRefs: ['attachment://finance/invoice-1'],
        invoiceDate: '2032-01-20',
        invoiceNo: `INV-${randomUUID()}`,
        invoicePartyRef: partnerRef,
        lines: [
          {
            amount: '60',
            sourceRef: statementBase.id,
            sourceType: 'STATEMENT_LINE',
          },
        ],
        statementId: statement.id,
      },
      context(financeId),
      metadata(),
    );
    expect(invoice1).toMatchObject({
      invoicedVoucherIds: [],
      status: 'ISSUED',
      totalAmount: '60',
    });
    const invoice2 = await service.createInvoice(
      {
        invoiceDate: '2032-01-21',
        invoiceNo: `INV-${randomUUID()}`,
        invoicePartyRef: partnerRef,
        lines: [
          {
            amount: '40',
            sourceRef: statementBase.id,
            sourceType: 'STATEMENT_LINE',
          },
          {
            amount: '6',
            sourceRef: statementTax.id,
            sourceType: 'STATEMENT_LINE',
          },
        ],
        statementId: statement.id,
      },
      context(financeId),
      metadata(),
    );
    expect(invoice2).toMatchObject({
      invoicedVoucherIds: [voucher.id],
      totalAmount: '46',
    });
    expect(
      await prisma.settlementVoucher.findUniqueOrThrow({ where: { id: voucher.id } }),
    ).toMatchObject({ status: 'INVOICED', version: 6 });
    await expect(
      service.createInvoice(
        {
          invoiceDate: '2032-01-22',
          invoiceNo: `INV-${randomUUID()}`,
          invoicePartyRef: partnerRef,
          lines: [
            {
              amount: '1',
              sourceRef: statementBase.id,
              sourceType: 'STATEMENT_LINE',
            },
          ],
          statementId: statement.id,
        },
        context(financeId),
        metadata(),
      ),
    ).rejects.toMatchObject({ code: 'BILLING_INVOICE_AMOUNT_EXCEEDED' });

    const originalLine = await prisma.billingInvoiceLine.findFirstOrThrow({
      where: { invoiceId: invoice1.invoiceId },
    });
    const credit = await service.createCreditNote(
      invoice1.invoiceId,
      {
        invoiceDate: '2032-01-23',
        invoiceNo: `CN-${randomUUID()}`,
        lines: [{ amount: '10', originalInvoiceLineId: originalLine.id }],
        reason: 'Partial red reversal',
      },
      context(financeId),
      metadata(),
    );
    expect(credit).toMatchObject({
      originalInvoiceStatus: 'PARTIALLY_REVERSED',
      totalAmount: '-10',
    });
    await expect(
      service.createCreditNote(
        invoice1.invoiceId,
        {
          invoiceDate: '2032-01-24',
          invoiceNo: `CN-${randomUUID()}`,
          lines: [{ amount: '51', originalInvoiceLineId: originalLine.id }],
          reason: 'Over reversal must fail',
        },
        context(financeId),
        metadata(),
      ),
    ).rejects.toMatchObject({ code: 'BILLING_CREDIT_AMOUNT_EXCEEDED' });

    const payment1 = await service.registerPayment(
      {
        amount: '62',
        counterpartyRef: partnerRef,
        currency: 'CNY',
        direction: 'PAYABLE',
        externalRef: `ERP-PAY-${randomUUID()}`,
        paymentType: 'NORMAL',
        source: 'ERP',
        transactionDate: '2032-01-25',
      },
      context(financeId),
      metadata(),
    );
    const partial = await service.allocatePayment(
      payment1.paymentId,
      {
        allocations: [
          {
            amount: '30',
            feeAmount: '2',
            targetRef: invoice1.invoiceId,
            targetType: 'INVOICE',
          },
        ],
        expectedVersion: 1,
      },
      context(financeId),
      metadata(),
    );
    expect(partial).toMatchObject({
      status: 'PARTIALLY_ALLOCATED',
      unallocatedAmount: '30',
      version: 2,
    });
    expect(
      await service.allocatePayment(
        payment1.paymentId,
        {
          allocations: [
            {
              amount: '30',
              targetRef: invoice1.invoiceId,
              targetType: 'INVOICE',
            },
          ],
          expectedVersion: 2,
        },
        context(financeId),
        metadata(),
      ),
    ).toMatchObject({ status: 'ALLOCATED', unallocatedAmount: '0' });
    const payment2 = await service.registerPayment(
      {
        amount: '46',
        counterpartyRef: partnerRef,
        currency: 'CNY',
        direction: 'PAYABLE',
        externalRef: `ERP-PAY-${randomUUID()}`,
        paymentType: 'NORMAL',
        source: 'ERP',
        transactionDate: '2032-01-26',
      },
      context(financeId),
      metadata(),
    );
    await service.allocatePayment(
      payment2.paymentId,
      {
        allocations: [
          {
            amount: '46',
            targetRef: invoice2.invoiceId,
            targetType: 'INVOICE',
          },
        ],
        expectedVersion: 1,
      },
      context(financeId),
      metadata(),
    );
    const refund = await service.registerPayment(
      {
        amount: '10',
        counterpartyRef: partnerRef,
        currency: 'CNY',
        direction: 'PAYABLE',
        externalRef: `ERP-REFUND-${randomUUID()}`,
        paymentType: 'REFUND',
        source: 'ERP',
        transactionDate: '2032-01-27',
      },
      context(financeId),
      metadata(),
    );
    const refunded = await service.allocatePayment(
      refund.paymentId,
      {
        allocations: [
          {
            amount: '10',
            targetRef: credit.creditNoteId,
            targetType: 'INVOICE',
          },
        ],
        expectedVersion: 1,
      },
      context(financeId),
      metadata(),
    );
    expect(refunded).toMatchObject({ paidVoucherIds: [voucher.id] });
    expect(
      await prisma.settlementVoucher.findUniqueOrThrow({ where: { id: voucher.id } }),
    ).toMatchObject({ status: 'PAID', version: 7 });
    const unmatched = await service.registerPayment(
      {
        amount: '5',
        counterpartyRef: partnerRef,
        currency: 'CNY',
        direction: 'PAYABLE',
        externalRef: `ERP-UNMATCHED-${randomUUID()}`,
        paymentType: 'UNMATCHED',
        source: 'ERP',
        transactionDate: '2032-01-28',
      },
      context(financeId),
      metadata(),
    );
    await expect(
      service.allocatePayment(
        unmatched.paymentId,
        {
          allocations: [
            {
              amount: '5',
              targetRef: invoice2.invoiceId,
              targetType: 'INVOICE',
            },
          ],
          expectedVersion: 1,
        },
        context(financeId),
        metadata(),
      ),
    ).rejects.toMatchObject({ code: 'BILLING_PAYMENT_STATE_INVALID' });

    const report1 = await service.generateReport(
      {
        currency: 'CNY',
        dimensionType: 'ORDER',
        periodFrom: '2032-01-01',
        periodTo: '2032-01-31',
      },
      context(financeId),
      metadata(),
    );
    expect(report1).toMatchObject({
      marginAmount: '-106',
      metricCount: 1,
      reportVersion: 1,
      traceCount: 2,
    });
    expect(
      await service.generateReport(
        {
          currency: 'CNY',
          dimensionType: 'ORDER',
          periodFrom: '2032-01-01',
          periodTo: '2032-01-31',
        },
        context(financeId),
        metadata(),
      ),
    ).toMatchObject({ reportVersion: 2, traceCount: 2 });
    const closing = await service.startPeriodClose(
      period.periodId,
      { expectedVersion: 1 },
      context(supervisorId),
      metadata(),
    );
    expect(closing).toMatchObject({ status: 'CLOSING', version: 2 });
    const closed = await service.closePeriod(
      period.periodId,
      { expectedVersion: 2 },
      context(supervisorId),
      metadata(),
    );
    expect(closed).toMatchObject({
      closed: true,
      closedVoucherIds: [voucher.id],
      status: 'CLOSED',
      version: 3,
    });
    expect(
      await prisma.settlementVoucher.findUniqueOrThrow({ where: { id: voucher.id } }),
    ).toMatchObject({ status: 'CLOSED', version: 8 });
    await expect(
      service.registerPayment(
        {
          amount: '1',
          counterpartyRef: partnerRef,
          currency: 'CNY',
          direction: 'PAYABLE',
          externalRef: `CLOSED-${randomUUID()}`,
          paymentType: 'NORMAL',
          source: 'MANUAL',
          transactionDate: '2032-01-29',
        },
        context(financeId),
        metadata(),
      ),
    ).rejects.toMatchObject({ code: 'BILLING_PERIOD_CLOSED' });
    await expect(
      voucherService.createDraft(
        {
          approvalThreshold: '1000',
          businessType: fact.chargeType,
          calculationIds: [calculation.id],
          direction: 'PAYABLE',
          partnerRef,
          periodFrom: '2032-01-01',
          periodTo: '2032-01-31',
        },
        context(financeId),
        metadata(),
      ),
    ).rejects.toMatchObject({ code: 'BILLING_PERIOD_CLOSED' });
    const reopened = await service.reopenPeriod(
      period.periodId,
      { expectedVersion: 3, reason: 'Approved late ERP posting' },
      context(supervisorId),
      metadata(),
    );
    expect(reopened).toMatchObject({ status: 'REOPENED', version: 4 });
    expect(
      await service.registerPayment(
        {
          amount: '1',
          counterpartyRef: partnerRef,
          currency: 'CNY',
          direction: 'PAYABLE',
          externalRef: `REOPENED-${randomUUID()}`,
          paymentType: 'UNMATCHED',
          source: 'MANUAL',
          transactionDate: '2032-01-29',
        },
        context(financeId),
        metadata(),
      ),
    ).toMatchObject({ status: 'UNMATCHED' });

    const dirtyVoucher = await prisma.settlementVoucher.create({
      data: {
        approvalThreshold: '1000',
        businessType: fact.chargeType,
        contractSnapshot: [{ contractRef }],
        createdBy: financeId,
        currency: 'CNY',
        direction: 'PAYABLE',
        partnerRef,
        periodFrom: new Date('2032-02-01T00:00:00.000Z'),
        periodTo: new Date('2032-02-29T00:00:00.000Z'),
        status: 'APPROVED',
        subtotalAmount: '1',
        taxAmount: '0',
        tenantId,
        totalAmount: '1',
        updatedBy: financeId,
        voucherNo: `AP-DIRTY-${randomUUID()}`,
      },
    });
    expect(dirtyVoucher.status).toBe('APPROVED');
    const dirtyPeriod = await service.createPeriod(
      {
        periodFrom: '2032-02-01',
        periodKey: '2032-02',
        periodTo: '2032-02-29',
      },
      context(supervisorId),
      metadata(),
    );
    await service.startPeriodClose(
      dirtyPeriod.periodId,
      { expectedVersion: 1 },
      context(supervisorId),
      metadata(),
    );
    expect(
      await service.closePeriod(
        dirtyPeriod.periodId,
        { expectedVersion: 2 },
        context(supervisorId),
        metadata(),
      ),
    ).toMatchObject({
      closed: false,
      errors: expect.arrayContaining(['uninvoiced']),
      status: 'CLOSING',
    });

    await expect(
      prisma.billingInvoiceLine.update({
        data: { amount: '1' },
        where: { id: originalLine.id },
      }),
    ).rejects.toThrow(/immutable/i);
    const allocation = await prisma.billingSettlementAllocation.findFirstOrThrow({
      where: { paymentId: payment1.paymentId },
    });
    await expect(
      prisma.billingSettlementAllocation.delete({ where: { id: allocation.id } }),
    ).rejects.toThrow(/immutable/i);
    const trace = await prisma.billingSettlementMetricTrace.findFirstOrThrow({
      where: { tenantId },
    });
    await expect(
      prisma.billingSettlementMetricTrace.update({
        data: { amount: '1' },
        where: { id: trace.id },
      }),
    ).rejects.toThrow(/immutable/i);
    expect(
      await prisma.platformOutbox.count({ where: { tenantId } }),
    ).toBeGreaterThanOrEqual(20);
  });
});
