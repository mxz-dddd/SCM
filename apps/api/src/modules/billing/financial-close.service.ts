import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import type { CommandMetadata } from '../platform/tenant.service';

type InvoiceSource = {
  amount: Prisma.Decimal;
  sourceRef: string;
  sourceSnapshot: Record<string, unknown>;
  sourceType: 'ADJUSTMENT' | 'STATEMENT_LINE';
  taxComponent: boolean;
};

export type CreateBillingInvoiceInput = {
  attachmentRefs?: readonly string[];
  invoiceDate: string;
  invoiceNo: string;
  invoicePartyRef: string;
  lines: readonly {
    amount: string;
    sourceRef: string;
    sourceType: 'ADJUSTMENT' | 'STATEMENT_LINE';
  }[];
  statementId: string;
};

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

@Injectable()
export class FinancialCloseService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createInvoice(
    raw: CreateBillingInvoiceInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const input = this.normalizeInvoice(raw);
    return this.prisma.$transaction(async (tx) => {
      const statement = await tx.reconciliationStatement.findFirst({
        where: {
          id: input.statementId,
          status: 'RECONCILED',
          tenantId: context.tenantId,
        },
      });
      if (!statement)
        this.conflict(
          'BILLING_INVOICE_STATEMENT_INVALID',
          'A reconciled statement is required for invoicing',
        );
      await this.ensureOpen(tx, input.invoiceDate, context.tenantId);
      const sources = await this.invoiceSources(
        tx,
        statement.id,
        input.lines,
        context.tenantId,
      );
      const invoice = await this.persistInvoice(
        tx,
        {
          attachmentRefs: input.attachmentRefs,
          direction: statement.direction,
          invoiceDate: input.invoiceDate,
          invoiceNo: input.invoiceNo,
          invoicePartyRef: input.invoicePartyRef,
          kind: 'STANDARD',
          statementId: statement.id,
        },
        sources,
        context,
      );
      const invoicedVoucherIds = await this.maybeMarkInvoiced(
        tx,
        statement.id,
        context,
        metadata,
      );
      await this.emit(
        tx,
        'BillingInvoice',
        invoice.id,
        invoice.version,
        'billing.invoice.issued.v1',
        context,
        metadata,
        {
          invoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          statementId: statement.id,
          totalAmount: invoice.totalAmount.toString(),
        },
      );
      return toHttpJson({
        invoiceId: invoice.id,
        invoicedVoucherIds,
        kind: invoice.kind,
        status: invoice.status,
        totalAmount: invoice.totalAmount,
        version: invoice.version,
      });
    });
  }

  async createCreditNote(
    originalInvoiceId: string,
    raw: {
      attachmentRefs?: readonly string[];
      invoiceDate: string;
      invoiceNo: string;
      lines: readonly { amount: string; originalInvoiceLineId: string }[];
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(originalInvoiceId, 'originalInvoiceId');
    const invoiceDate = this.date(raw.invoiceDate, 'invoiceDate');
    const invoiceNo = this.required(raw.invoiceNo, 'invoiceNo', 200);
    const reason = this.required(raw.reason, 'reason', 2000);
    const attachmentRefs = this.references(raw.attachmentRefs ?? []);
    if (!raw.lines?.length)
      throw new AppError(
        'BILLING_INVOICE_INPUT_INVALID',
        'Credit note lines are required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:invoice:${originalInvoiceId}`}, 0))`;
      const original = await tx.billingInvoice.findFirst({
        where: {
          id: originalInvoiceId,
          kind: 'STANDARD',
          status: { in: ['ISSUED', 'PARTIALLY_REVERSED'] },
          tenantId: context.tenantId,
        },
      });
      if (!original)
        this.conflict(
          'BILLING_CREDIT_ORIGINAL_INVALID',
          'An active standard invoice is required for red reversal',
        );
      await this.ensureOpen(tx, invoiceDate, context.tenantId);
      const originalIds = raw.lines.map(({ originalInvoiceLineId }) => {
        this.uuid(originalInvoiceLineId, 'originalInvoiceLineId');
        return originalInvoiceLineId;
      });
      if (new Set(originalIds).size !== originalIds.length)
        throw new AppError(
          'BILLING_INVOICE_INPUT_INVALID',
          'Credit note lines must be unique',
          400,
        );
      const originalLines = await tx.billingInvoiceLine.findMany({
        where: {
          id: { in: originalIds },
          invoiceId: original.id,
          tenantId: context.tenantId,
        },
      });
      if (originalLines.length !== raw.lines.length)
        this.conflict(
          'BILLING_CREDIT_LINE_INVALID',
          'Every credit line must belong to the original invoice',
        );
      const credits = await tx.billingInvoiceLine.findMany({
        where: {
          originalInvoiceLineId: { in: originalIds },
          tenantId: context.tenantId,
        },
      });
      const sources: InvoiceSource[] = raw.lines.map((line) => {
        const amount = this.positive(line.amount, 'line.amount');
        const originalLine = originalLines.find(
          ({ id }) => id === line.originalInvoiceLineId,
        )!;
        const credited = credits
          .filter(
            ({ originalInvoiceLineId: id }) =>
              id === originalLine.id,
          )
          .reduce(
            (sum, item) => sum.plus(item.amount.abs()),
            new Prisma.Decimal(0),
          );
        if (credited.plus(amount).gt(originalLine.amount.abs()))
          this.conflict(
            'BILLING_CREDIT_AMOUNT_EXCEEDED',
            'Cumulative red reversal cannot exceed the original invoice line',
          );
        return {
          amount: originalLine.amount.isPositive()
            ? amount.negated()
            : amount,
          sourceRef: originalLine.sourceRef,
          sourceSnapshot: {
            originalInvoiceId: original.id,
            originalInvoiceLineId: originalLine.id,
            reason,
          },
          sourceType: originalLine.sourceType,
          taxComponent: originalLine.taxComponent,
        };
      });
      const credit = await this.persistInvoice(
        tx,
        {
          attachmentRefs,
          direction: original.direction,
          invoiceDate,
          invoiceNo,
          invoicePartyRef: original.invoicePartyRef,
          kind: 'CREDIT_NOTE',
          originalInvoiceId: original.id,
          statementId: original.statementId,
        },
        sources,
        context,
        originalIds,
      );
      const reversedAmount = original.reversedAmount.plus(
        credit.totalAmount.abs(),
      );
      const changedOriginal = await tx.billingInvoice.update({
        data: {
          reversedAmount,
          status: reversedAmount.eq(original.totalAmount.abs())
            ? 'REVERSED'
            : 'PARTIALLY_REVERSED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: original.id },
      });
      await this.emit(
        tx,
        'BillingInvoice',
        credit.id,
        credit.version,
        'billing.invoice.credit-note-issued.v1',
        context,
        metadata,
        {
          creditNoteId: credit.id,
          originalInvoiceId: original.id,
          originalStatus: changedOriginal.status,
          totalAmount: credit.totalAmount.toString(),
        },
      );
      return toHttpJson({
        creditNoteId: credit.id,
        originalInvoiceStatus: changedOriginal.status,
        status: credit.status,
        totalAmount: credit.totalAmount,
        version: credit.version,
      });
    });
  }

  async registerPayment(
    raw: {
      amount: string;
      counterpartyRef: string;
      currency: string;
      direction: 'PAYABLE' | 'RECEIVABLE';
      externalRef: string;
      paymentType: 'FEE' | 'NORMAL' | 'REFUND' | 'UNMATCHED';
      source: 'ERP' | 'MANUAL';
      sourceSnapshot?: Record<string, unknown>;
      transactionDate: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const amount = this.positive(raw.amount, 'amount');
    const transactionDate = this.date(raw.transactionDate, 'transactionDate');
    const currency = this.currency(raw.currency);
    if (
      !['PAYABLE', 'RECEIVABLE'].includes(raw.direction) ||
      !['FEE', 'NORMAL', 'REFUND', 'UNMATCHED'].includes(raw.paymentType) ||
      !['ERP', 'MANUAL'].includes(raw.source)
    )
      throw new AppError(
        'BILLING_PAYMENT_INPUT_INVALID',
        'Payment direction, type or source is invalid',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      await this.ensureOpen(tx, transactionDate, context.tenantId);
      const signed = ['FEE', 'REFUND'].includes(raw.paymentType)
        ? amount.negated()
        : amount;
      const payment = await tx.billingPayment.create({
        data: {
          amount: signed,
          counterpartyRef: this.required(
            raw.counterpartyRef,
            'counterpartyRef',
            200,
          ),
          createdBy: context.accountId,
          currency,
          direction: raw.direction,
          externalRef: this.required(raw.externalRef, 'externalRef', 200),
          paymentNo: `PAY-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8).toUpperCase()}`,
          paymentType: raw.paymentType,
          source: raw.source,
          sourceSnapshot: json(raw.sourceSnapshot),
          tenantId: context.tenantId,
          transactionDate,
          unallocatedAmount: signed,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        'BillingPayment',
        payment.id,
        payment.version,
        'billing.payment.registered.v1',
        context,
        metadata,
        {
          amount: signed.toString(),
          externalRef: payment.externalRef,
          paymentId: payment.id,
          paymentType: payment.paymentType,
        },
      );
      return toHttpJson({
        paymentId: payment.id,
        paymentNo: payment.paymentNo,
        status: payment.status,
        unallocatedAmount: payment.unallocatedAmount,
        version: payment.version,
      });
    });
  }

  async allocatePayment(
    id: string,
    raw: {
      allocations: readonly {
        amount: string;
        feeAmount?: string;
        targetRef: string;
        targetType: 'INVOICE' | 'VOUCHER';
      }[];
      expectedVersion: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'paymentId');
    if (!raw.allocations?.length)
      throw new AppError(
        'BILLING_PAYMENT_INPUT_INVALID',
        'At least one settlement allocation is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:payment:${id}`}, 0))`;
      const payment = await tx.billingPayment.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !payment ||
        payment.version !== raw.expectedVersion ||
        payment.status === 'ALLOCATED' ||
        ['FEE', 'UNMATCHED'].includes(payment.paymentType)
      )
        this.conflict(
          'BILLING_PAYMENT_STATE_INVALID',
          'A matching allocatable payment version is required',
        );
      await this.ensureOpen(tx, payment.transactionDate, context.tenantId);
      const sign = payment.amount.isNegative() ? -1 : 1;
      const normalized = raw.allocations.map((allocation) => {
        this.uuid(allocation.targetRef, 'targetRef');
        if (!['INVOICE', 'VOUCHER'].includes(allocation.targetType))
          throw new AppError(
            'BILLING_PAYMENT_INPUT_INVALID',
            'Settlement target type is invalid',
            400,
          );
        const amount = this.positive(allocation.amount, 'allocation.amount');
        const feeAmount = allocation.feeAmount
          ? this.positive(allocation.feeAmount, 'allocation.feeAmount')
          : new Prisma.Decimal(0);
        return {
          amount: sign < 0 ? amount.negated() : amount,
          feeAmount,
          targetRef: allocation.targetRef,
          targetType: allocation.targetType,
        };
      });
      const requested = normalized.reduce(
        (sum, allocation) =>
          sum.plus(allocation.amount.abs()).plus(allocation.feeAmount),
        new Prisma.Decimal(0),
      );
      if (requested.gt(payment.unallocatedAmount.abs()))
        this.conflict(
          'BILLING_PAYMENT_AMOUNT_EXCEEDED',
          'Settlement allocations and fees exceed the unallocated payment',
        );
      const existingCount = await tx.billingSettlementAllocation.count({
        where: { paymentId: id, tenantId: context.tenantId },
      });
      for (const [index, allocation] of normalized.entries()) {
        const target = await this.settlementTarget(
          tx,
          allocation.targetType,
          allocation.targetRef,
          context.tenantId,
        );
        if (
          target.currency !== payment.currency ||
          target.direction !== payment.direction
        )
          this.conflict(
            'BILLING_PAYMENT_TARGET_INVALID',
            'Payment and settlement target direction/currency must match',
          );
        const previous = await tx.billingSettlementAllocation.aggregate({
          _sum: { amount: true },
          where: {
            targetRef: allocation.targetRef,
            targetType: allocation.targetType,
            tenantId: context.tenantId,
          },
        });
        const next = new Prisma.Decimal(previous._sum.amount ?? 0).plus(
          allocation.amount,
        );
        if (
          (target.amount.isPositive() &&
            (next.isNegative() || next.gt(target.amount))) ||
          (target.amount.isNegative() &&
            (next.isPositive() || next.lt(target.amount)))
        )
          this.conflict(
            'BILLING_SETTLEMENT_AMOUNT_EXCEEDED',
            'Net settlement cannot cross or exceed the target amount',
          );
        await tx.billingSettlementAllocation.create({
          data: {
            amount: allocation.amount,
            createdBy: context.accountId,
            currency: payment.currency,
            feeAmount: allocation.feeAmount,
            lineNo: existingCount + index + 1,
            paymentId: id,
            targetRef: allocation.targetRef,
            targetSnapshot: json(target.snapshot),
            targetType: allocation.targetType,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      const allocatedDelta = normalized.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0),
      );
      const feeDelta = normalized.reduce(
        (sum, item) => sum.plus(item.feeAmount),
        new Prisma.Decimal(0),
      );
      const remainingMagnitude = payment.unallocatedAmount
        .abs()
        .minus(requested);
      const unallocatedAmount = sign < 0
        ? remainingMagnitude.negated()
        : remainingMagnitude;
      const changed = await tx.billingPayment.update({
        data: {
          allocatedAmount: payment.allocatedAmount.plus(allocatedDelta),
          feeAmount: payment.feeAmount.plus(feeDelta),
          status: remainingMagnitude.isZero()
            ? 'ALLOCATED'
            : 'PARTIALLY_ALLOCATED',
          unallocatedAmount,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const paidVoucherIds = await this.markPaidTargets(
        tx,
        normalized,
        context,
        metadata,
      );
      await this.emit(
        tx,
        'BillingPayment',
        id,
        changed.version,
        'billing.payment.allocated.v1',
        context,
        metadata,
        { paymentId: id, paidVoucherIds, status: changed.status },
      );
      return toHttpJson({
        paymentId: id,
        paidVoucherIds,
        status: changed.status,
        unallocatedAmount: changed.unallocatedAmount,
        version: changed.version,
      });
    });
  }

  async createPeriod(
    raw: { periodFrom: string; periodKey: string; periodTo: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const periodFrom = this.date(raw.periodFrom, 'periodFrom');
    const periodTo = this.date(raw.periodTo, 'periodTo');
    if (periodTo < periodFrom)
      throw new AppError(
        'BILLING_PERIOD_INPUT_INVALID',
        'Accounting period range is invalid',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const overlap = await tx.billingAccountingPeriod.findFirst({
        where: {
          periodFrom: { lte: periodTo },
          periodTo: { gte: periodFrom },
          tenantId: context.tenantId,
        },
      });
      if (overlap)
        this.conflict(
          'BILLING_PERIOD_OVERLAP',
          'Accounting periods cannot overlap',
        );
      const period = await tx.billingAccountingPeriod.create({
        data: {
          createdBy: context.accountId,
          periodFrom,
          periodKey: this.required(raw.periodKey, 'periodKey', 20),
          periodTo,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.periodHistory(tx, period.id, 1, null, 'OPEN', 'CREATE', context, {});
      await this.emit(
        tx,
        'BillingAccountingPeriod',
        period.id,
        period.version,
        'billing.period.opened.v1',
        context,
        metadata,
        { periodId: period.id, periodKey: period.periodKey },
      );
      return {
        periodId: period.id,
        status: period.status,
        version: period.version,
      };
    });
  }

  startPeriodClose(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.transitionPeriod(
      id,
      input.expectedVersion,
      ['OPEN', 'REOPENED'],
      'CLOSING',
      'START_CLOSE',
      context,
      metadata,
    );
  }

  async closePeriod(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'periodId');
    return this.prisma.$transaction(async (tx) => {
      const period = await this.lockPeriod(tx, id, context.tenantId);
      if (period.status !== 'CLOSING' || period.version !== input.expectedVersion)
        this.periodConflict('close', period.status, period.version);
      const checks = await this.closeChecks(tx, period, context.tenantId);
      const errors = Object.entries(checks)
        .filter(([, value]) => value > 0)
        .map(([key]) => key);
      const attempt =
        (await tx.billingPeriodCloseCheck.count({
          where: { periodId: id, tenantId: context.tenantId },
        })) + 1;
      await tx.billingPeriodCloseCheck.create({
        data: {
          attempt,
          checkSnapshot: json(checks),
          createdBy: context.accountId,
          errorSnapshot: json(errors),
          passed: errors.length === 0,
          periodId: id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      if (errors.length)
        return {
          closed: false,
          errors,
          periodId: id,
          status: period.status,
          version: period.version,
        };
      const changed = await tx.billingAccountingPeriod.update({
        data: {
          closedAt: new Date(),
          closedBy: context.accountId,
          status: 'CLOSED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const paid = await tx.settlementVoucher.findMany({
        where: {
          periodTo: { gte: period.periodFrom, lte: period.periodTo },
          status: 'PAID',
          tenantId: context.tenantId,
        },
      });
      for (const voucher of paid)
        await this.advanceVoucher(
          tx,
          voucher,
          'PAID',
          'CLOSED',
          'PERIOD_CLOSE',
          { periodId: id },
          context,
          metadata,
        );
      await this.periodHistory(
        tx,
        id,
        changed.version,
        'CLOSING',
        'CLOSED',
        'CLOSE',
        context,
        { checkAttempt: attempt, closedVoucherIds: paid.map(({ id: value }) => value) },
      );
      await this.emit(
        tx,
        'BillingAccountingPeriod',
        id,
        changed.version,
        'billing.period.closed.v1',
        context,
        metadata,
        { periodId: id, periodKey: period.periodKey },
      );
      return {
        closed: true,
        closedVoucherIds: paid.map(({ id: value }) => value),
        periodId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async reopenPeriod(
    id: string,
    raw: { expectedVersion: number; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'periodId');
    const reason = this.required(raw.reason, 'reason', 2000);
    return this.prisma.$transaction(async (tx) => {
      const period = await this.lockPeriod(tx, id, context.tenantId);
      if (period.status !== 'CLOSED' || period.version !== raw.expectedVersion)
        this.periodConflict('reopen', period.status, period.version);
      const changed = await tx.billingAccountingPeriod.update({
        data: {
          reopenedAt: new Date(),
          reopenedBy: context.accountId,
          reopenReason: reason,
          status: 'REOPENED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.periodHistory(
        tx,
        id,
        changed.version,
        'CLOSED',
        'REOPENED',
        'REOPEN',
        context,
        { reason },
      );
      await this.emit(
        tx,
        'BillingAccountingPeriod',
        id,
        changed.version,
        'billing.period.reopened.v1',
        context,
        metadata,
        { periodId: id, reason },
      );
      return { periodId: id, status: changed.status, version: changed.version };
    });
  }

  async generateReport(
    raw: {
      currency: string;
      dimensionType: 'ORDER' | 'PARTNER' | 'ROUTE' | 'SERVICE' | 'WAREHOUSE';
      periodFrom: string;
      periodTo: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const periodFrom = this.date(raw.periodFrom, 'periodFrom');
    const periodTo = this.date(raw.periodTo, 'periodTo');
    const currency = this.currency(raw.currency);
    if (
      periodTo < periodFrom ||
      !['ORDER', 'PARTNER', 'ROUTE', 'SERVICE', 'WAREHOUSE'].includes(
        raw.dimensionType,
      )
    )
      throw new AppError(
        'BILLING_REPORT_INPUT_INVALID',
        'Report period or dimension is invalid',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const vouchers = await tx.settlementVoucher.findMany({
        where: {
          currency,
          periodTo: { gte: periodFrom, lte: periodTo },
          status: {
            in: ['APPROVED', 'CLOSED', 'INVOICED', 'PAID', 'RECONCILED'],
          },
          tenantId: context.tenantId,
        },
      });
      const lines = await tx.billingVoucherLine.findMany({
        where: {
          tenantId: context.tenantId,
          voucherId: { in: vouchers.map(({ id }) => id) },
        },
      });
      const calculations = await tx.billingCalculation.findMany({
        where: {
          id: { in: [...new Set(lines.map(({ calculationId }) => calculationId))] },
          tenantId: context.tenantId,
        },
      });
      const facts = await tx.chargeFact.findMany({
        where: {
          id: { in: calculations.map(({ chargeFactId }) => chargeFactId) },
          tenantId: context.tenantId,
        },
      });
      const voucherById = new Map(vouchers.map((voucher) => [voucher.id, voucher]));
      const calculationById = new Map(
        calculations.map((calculation) => [calculation.id, calculation]),
      );
      const factById = new Map(facts.map((fact) => [fact.id, fact]));
      const groups = new Map<
        string,
        {
          accrual: Prisma.Decimal;
          adjustment: Prisma.Decimal;
          cost: Prisma.Decimal;
          lines: typeof lines;
          paid: Prisma.Decimal;
          revenue: Prisma.Decimal;
        }
      >();
      for (const line of lines) {
        const voucher = voucherById.get(line.voucherId)!;
        const calculation = calculationById.get(line.calculationId)!;
        const fact = factById.get(calculation.chargeFactId)!;
        const dimensionRef = this.dimensionRef(
          raw.dimensionType,
          voucher,
          calculation,
          fact,
        );
        const group = groups.get(dimensionRef) ?? {
          accrual: new Prisma.Decimal(0),
          adjustment: new Prisma.Decimal(0),
          cost: new Prisma.Decimal(0),
          lines: [],
          paid: new Prisma.Decimal(0),
          revenue: new Prisma.Decimal(0),
        };
        if (voucher.direction === 'RECEIVABLE')
          group.revenue = group.revenue.plus(line.amount);
        else group.cost = group.cost.plus(line.amount);
        group.lines.push(line);
        groups.set(dimensionRef, group);
      }
      const reportKey = `${raw.dimensionType}:${periodFrom.toISOString().slice(0, 10)}:${periodTo.toISOString().slice(0, 10)}:${currency}`;
      const reportVersion =
        (await tx.billingSettlementReport.count({
          where: { reportKey, tenantId: context.tenantId },
        })) + 1;
      const adjustments = await tx.billingAdjustmentVoucher.findMany({
        where: {
          currency,
          sourceVoucherId: { in: vouchers.map(({ id }) => id) },
          status: 'POSTED',
          tenantId: context.tenantId,
        },
      });
      const accruals = await tx.billingAccrualVoucher.findMany({
        where: {
          accountingDate: { gte: periodFrom, lte: periodTo },
          currency,
          status: 'POSTED',
          tenantId: context.tenantId,
        },
      });
      const statementLines = await tx.reconciliationStatementLine.findMany({
        where: {
          tenantId: context.tenantId,
          voucherId: { in: vouchers.map(({ id }) => id) },
        },
      });
      const invoices = await tx.billingInvoice.findMany({
        where: {
          statementId: {
            in: [...new Set(statementLines.map(({ statementId }) => statementId))],
          },
          tenantId: context.tenantId,
        },
      });
      const allocations = await tx.billingSettlementAllocation.findMany({
        where: {
          currency,
          OR: [
            {
              targetRef: { in: vouchers.map(({ id }) => id) },
              targetType: 'VOUCHER',
            },
            {
              targetRef: { in: invoices.map(({ id }) => id) },
              targetType: 'INVOICE',
            },
          ],
          tenantId: context.tenantId,
        },
      });
      const emptyGroup = () => ({
        accrual: new Prisma.Decimal(0),
        adjustment: new Prisma.Decimal(0),
        cost: new Prisma.Decimal(0),
        lines: [] as typeof lines,
        paid: new Prisma.Decimal(0),
        revenue: new Prisma.Decimal(0),
      });
      const dimensionForVoucher = (voucherId: string) => {
        const line = lines.find(({ voucherId: id }) => id === voucherId);
        if (!line) return 'UNSPECIFIED';
        const voucher = voucherById.get(voucherId)!;
        const calculation = calculationById.get(line.calculationId)!;
        const fact = factById.get(calculation.chargeFactId)!;
        return this.dimensionRef(raw.dimensionType, voucher, calculation, fact);
      };
      for (const adjustment of adjustments) {
        const ref = dimensionForVoucher(adjustment.sourceVoucherId);
        const group = groups.get(ref) ?? emptyGroup();
        group.adjustment = group.adjustment.plus(
          adjustment.direction === 'INCREASE'
            ? adjustment.amount
            : adjustment.amount.negated(),
        );
        groups.set(ref, group);
      }
      for (const accrual of accruals) {
        const calculation = calculationById.get(accrual.calculationId);
        const fact = calculation ? factById.get(calculation.chargeFactId) : undefined;
        const ref =
          calculation && fact
            ? this.dimensionRef(
                raw.dimensionType,
                { partnerRef: fact.partyRef },
                calculation,
                fact,
              )
            : 'UNSPECIFIED';
        const group = groups.get(ref) ?? emptyGroup();
        group.accrual = group.accrual.plus(accrual.amount);
        groups.set(ref, group);
      }
      const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const allocation of allocations) {
        let voucherId = allocation.targetRef;
        if (allocation.targetType === 'INVOICE') {
          const invoice = invoiceById.get(allocation.targetRef);
          voucherId =
            statementLines.find(
              ({ statementId }) => statementId === invoice?.statementId,
            )?.voucherId ?? '';
        }
        const ref = dimensionForVoucher(voucherId);
        const group = groups.get(ref) ?? emptyGroup();
        group.paid = group.paid.plus(allocation.amount);
        groups.set(ref, group);
      }
      const revenue = [...groups.values()].reduce(
        (sum, group) => sum.plus(group.revenue),
        new Prisma.Decimal(0),
      );
      const cost = [...groups.values()].reduce(
        (sum, group) => sum.plus(group.cost),
        new Prisma.Decimal(0),
      );
      const adjustmentAmount = [...groups.values()].reduce(
        (sum, group) => sum.plus(group.adjustment),
        new Prisma.Decimal(0),
      );
      const accrualAmount = [...groups.values()].reduce(
        (sum, group) => sum.plus(group.accrual),
        new Prisma.Decimal(0),
      );
      const paidAmount = [...groups.values()].reduce(
        (sum, group) => sum.plus(group.paid),
        new Prisma.Decimal(0),
      );
      const report = await tx.billingSettlementReport.create({
        data: {
          accrualAmount,
          adjustmentAmount,
          costAmount: cost,
          createdBy: context.accountId,
          currency,
          dimensionType: raw.dimensionType,
          inputSnapshot: json({
            calculationIds: calculations.map(({ id }) => id),
            voucherIds: vouchers.map(({ id }) => id),
          }),
          marginAmount: revenue.minus(cost).plus(adjustmentAmount),
          paidAmount,
          periodFrom,
          periodTo,
          reportKey,
          reportVersion,
          revenueAmount: revenue,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      for (const [dimensionRef, group] of groups) {
        const metric = await tx.billingSettlementMetric.create({
          data: {
            accrualAmount: group.accrual,
            adjustmentAmount: group.adjustment,
            costAmount: group.cost,
            createdBy: context.accountId,
            currency,
            dimensionRef,
            dimensionSnapshot: json({ dimensionRef, dimensionType: raw.dimensionType }),
            marginAmount: group.revenue
              .minus(group.cost)
              .plus(group.adjustment),
            paidAmount: group.paid,
            reportId: report.id,
            revenueAmount: group.revenue,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        for (const line of group.lines)
          await tx.billingSettlementMetricTrace.create({
            data: {
              amount: line.amount,
              calculationId: line.calculationId,
              calculationSourceRef: line.sourceLineRef,
              calculationSourceType: line.sourceType,
              createdBy: context.accountId,
              direction: voucherById.get(line.voucherId)!.direction,
              metricId: metric.id,
              tenantId: context.tenantId,
              traceSnapshot: json({
                sourceSnapshot: line.sourceSnapshot,
                voucherNo: voucherById.get(line.voucherId)!.voucherNo,
              }),
              updatedBy: context.accountId,
              voucherId: line.voucherId,
              voucherLineId: line.id,
            },
          });
      }
      await this.emit(
        tx,
        'BillingSettlementReport',
        report.id,
        report.reportVersion,
        'billing.settlement-report.generated.v1',
        context,
        metadata,
        { reportId: report.id, reportVersion, traceCount: lines.length },
      );
      return toHttpJson({
        marginAmount: report.marginAmount,
        metricCount: groups.size,
        reportId: report.id,
        reportVersion,
        traceCount: lines.length,
      });
    });
  }

  private async invoiceSources(
    tx: Prisma.TransactionClient,
    statementId: string,
    lines: readonly {
      amount: Prisma.Decimal;
      sourceRef: string;
      sourceType: 'ADJUSTMENT' | 'STATEMENT_LINE';
    }[],
    tenantId: string,
  ): Promise<InvoiceSource[]> {
    const result: InvoiceSource[] = [];
    for (const line of lines) {
      let available: Prisma.Decimal;
      let taxComponent = false;
      let snapshot: Record<string, unknown>;
      if (line.sourceType === 'STATEMENT_LINE') {
        const source = await tx.reconciliationStatementLine.findFirst({
          where: { id: line.sourceRef, statementId, tenantId },
        });
        if (!source)
          this.conflict(
            'BILLING_INVOICE_SOURCE_INVALID',
            'Invoice statement line must belong to the reconciled statement',
          );
        available = source.amount;
        taxComponent = source.taxComponent;
        snapshot = { businessRef: source.businessRef, voucherId: source.voucherId };
      } else {
        const source = await tx.billingAdjustmentVoucher.findFirst({
          where: { id: line.sourceRef, statementId, status: 'POSTED', tenantId },
        });
        if (!source)
          this.conflict(
            'BILLING_INVOICE_SOURCE_INVALID',
            'Invoice adjustment must be posted and belong to the statement',
          );
        available =
          source.direction === 'INCREASE'
            ? source.amount
            : source.amount.negated();
        snapshot = { adjustmentNo: source.adjustmentNo, direction: source.direction };
      }
      const previous = await tx.billingInvoiceLine.aggregate({
        _sum: { amount: true },
        where: {
          sourceRef: line.sourceRef,
          sourceType: line.sourceType,
          tenantId,
        },
      });
      const signed = available.isNegative()
        ? line.amount.negated()
        : line.amount;
      const next = new Prisma.Decimal(previous._sum.amount ?? 0).plus(signed);
      if (
        (available.isPositive() && (next.isNegative() || next.gt(available))) ||
        (available.isNegative() && (next.isPositive() || next.lt(available)))
      )
        this.conflict(
          'BILLING_INVOICE_AMOUNT_EXCEEDED',
          'Cumulative invoice amount cannot exceed the source amount',
        );
      result.push({
        amount: signed,
        sourceRef: line.sourceRef,
        sourceSnapshot: snapshot,
        sourceType: line.sourceType,
        taxComponent,
      });
    }
    return result;
  }

  private async persistInvoice(
    tx: Prisma.TransactionClient,
    input: {
      attachmentRefs: readonly string[];
      direction: 'PAYABLE' | 'RECEIVABLE';
      invoiceDate: Date;
      invoiceNo: string;
      invoicePartyRef: string;
      kind: 'CREDIT_NOTE' | 'STANDARD';
      originalInvoiceId?: string;
      statementId: string;
    },
    sources: readonly InvoiceSource[],
    context: TenantContext,
    originalLineIds?: readonly string[],
  ) {
    const subtotal = sources
      .filter(({ taxComponent }) => !taxComponent)
      .reduce((sum, source) => sum.plus(source.amount), new Prisma.Decimal(0));
    const tax = sources
      .filter(({ taxComponent }) => taxComponent)
      .reduce((sum, source) => sum.plus(source.amount), new Prisma.Decimal(0));
    const total = subtotal.plus(tax);
    if (total.isZero())
      throw new AppError(
        'BILLING_INVOICE_INPUT_INVALID',
        'Invoice total cannot be zero',
        400,
      );
    const statement = await tx.reconciliationStatement.findUniqueOrThrow({
      where: { id: input.statementId },
    });
    const invoice = await tx.billingInvoice.create({
      data: {
        attachmentSnapshot: json({ attachmentRefs: input.attachmentRefs }),
        createdBy: context.accountId,
        currency: statement.currency,
        direction: input.direction,
        invoiceDate: input.invoiceDate,
        invoiceNo: input.invoiceNo,
        invoicePartyRef: input.invoicePartyRef,
        kind: input.kind,
        ...(input.originalInvoiceId
          ? { originalInvoiceId: input.originalInvoiceId }
          : {}),
        sourceSnapshot: json({ statementNo: statement.statementNo }),
        statementId: statement.id,
        subtotalAmount: subtotal,
        taxAmount: tax,
        tenantId: context.tenantId,
        totalAmount: total,
        updatedBy: context.accountId,
      },
    });
    for (const [index, source] of sources.entries())
      await tx.billingInvoiceLine.create({
        data: {
          amount: source.amount,
          createdBy: context.accountId,
          currency: statement.currency,
          invoiceId: invoice.id,
          lineNo: index + 1,
          ...(originalLineIds?.[index]
            ? { originalInvoiceLineId: originalLineIds[index] }
            : {}),
          sourceRef: source.sourceRef,
          sourceSnapshot: json(source.sourceSnapshot),
          sourceType: source.sourceType,
          taxComponent: source.taxComponent,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
    return invoice;
  }

  private async maybeMarkInvoiced(
    tx: Prisma.TransactionClient,
    statementId: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const statementLines = await tx.reconciliationStatementLine.findMany({
      where: { statementId, tenantId: context.tenantId },
    });
    const adjustments = await tx.billingAdjustmentVoucher.findMany({
      where: { statementId, status: 'POSTED', tenantId: context.tenantId },
    });
    const required = [
      ...statementLines.map((line) => ({
        amount: line.amount,
        ref: line.id,
        type: 'STATEMENT_LINE' as const,
      })),
      ...adjustments.map((adjustment) => ({
        amount:
          adjustment.direction === 'INCREASE'
            ? adjustment.amount
            : adjustment.amount.negated(),
        ref: adjustment.id,
        type: 'ADJUSTMENT' as const,
      })),
    ];
    for (const source of required) {
      const standardLines = await tx.billingInvoiceLine.findMany({
        where: {
          sourceRef: source.ref,
          sourceType: source.type,
          tenantId: context.tenantId,
        },
      });
      const standardInvoiceIds = new Set(
        (
          await tx.billingInvoice.findMany({
            select: { id: true },
            where: {
              id: { in: standardLines.map(({ invoiceId }) => invoiceId) },
              kind: 'STANDARD',
              tenantId: context.tenantId,
            },
          })
        ).map(({ id }) => id),
      );
      const standardTotal = standardLines
        .filter(({ invoiceId }) => standardInvoiceIds.has(invoiceId))
        .reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0));
      if (!standardTotal.eq(source.amount)) return [];
    }
    const voucherIds = [
      ...new Set(statementLines.map(({ voucherId }) => voucherId)),
    ];
    const changedIds: string[] = [];
    for (const voucherId of voucherIds) {
      const voucher = await tx.settlementVoucher.findFirst({
        where: { id: voucherId, tenantId: context.tenantId },
      });
      if (voucher?.status === 'RECONCILED') {
        await this.advanceVoucher(
          tx,
          voucher,
          'RECONCILED',
          'INVOICED',
          'INVOICE_COMPLETE',
          { statementId },
          context,
          metadata,
        );
        changedIds.push(voucherId);
      }
    }
    return changedIds;
  }

  private async settlementTarget(
    tx: Prisma.TransactionClient,
    type: 'INVOICE' | 'VOUCHER',
    id: string,
    tenantId: string,
  ) {
    if (type === 'INVOICE') {
      const invoice = await tx.billingInvoice.findFirst({ where: { id, tenantId } });
      if (!invoice)
        this.conflict('BILLING_SETTLEMENT_TARGET_NOT_FOUND', 'Invoice was not found');
      return {
        amount: invoice.totalAmount,
        currency: invoice.currency,
        direction: invoice.direction,
        snapshot: { invoiceNo: invoice.invoiceNo, kind: invoice.kind },
      };
    }
    const voucher = await tx.settlementVoucher.findFirst({
      where: { id, status: { in: ['INVOICED', 'PAID'] }, tenantId },
    });
    if (!voucher)
      this.conflict(
        'BILLING_SETTLEMENT_TARGET_NOT_FOUND',
        'Invoiced voucher was not found',
      );
    return {
      amount: voucher.totalAmount,
      currency: voucher.currency,
      direction: voucher.direction,
      snapshot: { voucherNo: voucher.voucherNo, status: voucher.status },
    };
  }

  private async markPaidTargets(
    tx: Prisma.TransactionClient,
    allocations: readonly {
      targetRef: string;
      targetType: 'INVOICE' | 'VOUCHER';
    }[],
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const voucherIds = new Set<string>();
    for (const allocation of allocations) {
      if (allocation.targetType === 'VOUCHER') voucherIds.add(allocation.targetRef);
      else {
        const invoice = await tx.billingInvoice.findUniqueOrThrow({
          where: { id: allocation.targetRef },
        });
        const invoiceAllocated = await tx.billingSettlementAllocation.aggregate({
          _sum: { amount: true },
          where: {
            targetRef: invoice.id,
            targetType: 'INVOICE',
            tenantId: context.tenantId,
          },
        });
        if (new Prisma.Decimal(invoiceAllocated._sum.amount ?? 0).eq(invoice.totalAmount)) {
          const lines = await tx.reconciliationStatementLine.findMany({
            where: { statementId: invoice.statementId, tenantId: context.tenantId },
          });
          for (const line of lines) voucherIds.add(line.voucherId);
        }
      }
    }
    const paidIds: string[] = [];
    for (const voucherId of voucherIds) {
      const voucher = await tx.settlementVoucher.findFirst({
        where: { id: voucherId, tenantId: context.tenantId },
      });
      if (!voucher || voucher.status !== 'INVOICED') continue;
      const direct = await tx.billingSettlementAllocation.aggregate({
        _sum: { amount: true },
        where: {
          targetRef: voucherId,
          targetType: 'VOUCHER',
          tenantId: context.tenantId,
        },
      });
      const directPaid = new Prisma.Decimal(direct._sum.amount ?? 0).eq(
        voucher.totalAmount,
      );
      const statementLines = await tx.reconciliationStatementLine.findMany({
        where: { voucherId, tenantId: context.tenantId },
      });
      const statementIds = [
        ...new Set(statementLines.map(({ statementId }) => statementId)),
      ];
      const invoices = await tx.billingInvoice.findMany({
        where: { statementId: { in: statementIds }, tenantId: context.tenantId },
      });
      let invoicesPaid = invoices.length > 0;
      for (const invoice of invoices) {
        const allocated = await tx.billingSettlementAllocation.aggregate({
          _sum: { amount: true },
          where: {
            targetRef: invoice.id,
            targetType: 'INVOICE',
            tenantId: context.tenantId,
          },
        });
        if (!new Prisma.Decimal(allocated._sum.amount ?? 0).eq(invoice.totalAmount))
          invoicesPaid = false;
      }
      if (directPaid || invoicesPaid) {
        await this.advanceVoucher(
          tx,
          voucher,
          'INVOICED',
          'PAID',
          'SETTLEMENT_COMPLETE',
          {},
          context,
          metadata,
        );
        paidIds.push(voucher.id);
      }
    }
    return paidIds;
  }

  private async closeChecks(
    tx: Prisma.TransactionClient,
    period: { periodFrom: Date; periodTo: Date },
    tenantId: string,
  ) {
    const vouchers = await tx.settlementVoucher.findMany({
      where: {
        periodTo: { gte: period.periodFrom, lte: period.periodTo },
        tenantId,
      },
    });
    const statements = await tx.reconciliationStatement.findMany({
      where: {
        periodTo: { gte: period.periodFrom, lte: period.periodTo },
        tenantId,
      },
    });
    const pendingVoucherApprovals = await tx.voucherApprovalTask.count({
      where: {
        status: 'PENDING',
        tenantId,
        voucherId: { in: vouchers.map(({ id }) => id) },
      },
    });
    const adjustments = await tx.billingAdjustmentVoucher.findMany({
      where: {
        sourceVoucherId: { in: vouchers.map(({ id }) => id) },
        tenantId,
      },
    });
    const pendingAdjustmentApprovals = await tx.billingAdjustmentApprovalTask.count({
      where: {
        adjustmentId: { in: adjustments.map(({ id }) => id) },
        status: 'PENDING',
        tenantId,
      },
    });
    const openDisputes = await tx.reconciliationDispute.count({
      where: {
        statementId: { in: statements.map(({ id }) => id) },
        status: { in: ['ACCEPTED', 'EVIDENCE_REQUESTED', 'OPEN'] },
        tenantId,
      },
    });
    const uninvoiced = vouchers.filter(({ status }) =>
      ['APPROVED', 'RECONCILED'].includes(status),
    ).length;
    const voucherLines = await tx.billingVoucherLine.findMany({
      where: { tenantId, voucherId: { in: vouchers.map(({ id }) => id) } },
    });
    const fx = await tx.fxConversion.findMany({
      select: { calculationId: true },
      where: {
        calculationId: { in: voucherLines.map(({ calculationId }) => calculationId) },
        tenantId,
      },
    });
    const missingFx = new Set(voucherLines.map(({ calculationId }) => calculationId)).size -
      new Set(fx.map(({ calculationId }) => calculationId)).size;
    return {
      missingFx,
      openDisputes,
      pendingApprovals: pendingVoucherApprovals + pendingAdjustmentApprovals,
      uninvoiced,
    };
  }

  private transitionPeriod(
    id: string,
    expectedVersion: number,
    from: Array<'OPEN' | 'REOPENED'>,
    to: 'CLOSING',
    command: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'periodId');
    return this.prisma.$transaction(async (tx) => {
      const period = await this.lockPeriod(tx, id, context.tenantId);
      if (!from.includes(period.status as 'OPEN' | 'REOPENED') || period.version !== expectedVersion)
        this.periodConflict(command.toLowerCase(), period.status, period.version);
      const changed = await tx.billingAccountingPeriod.update({
        data: {
          closingStartedAt: new Date(),
          closingStartedBy: context.accountId,
          status: to,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.periodHistory(
        tx,
        id,
        changed.version,
        period.status,
        to,
        command,
        context,
        {},
      );
      await this.emit(
        tx,
        'BillingAccountingPeriod',
        id,
        changed.version,
        'billing.period.closing-started.v1',
        context,
        metadata,
        { periodId: id },
      );
      return { periodId: id, status: changed.status, version: changed.version };
    });
  }

  private async advanceVoucher(
    tx: Prisma.TransactionClient,
    voucher: { id: string; status: string; version: number },
    from: 'INVOICED' | 'PAID' | 'RECONCILED',
    to: 'CLOSED' | 'INVOICED' | 'PAID',
    command: string,
    snapshot: Record<string, unknown>,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (voucher.status !== from) return;
    const changed = await tx.settlementVoucher.update({
      data: {
        status: to,
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: voucher.id },
    });
    const sequence =
      (await tx.voucherStatusHistory.count({
        where: { tenantId: context.tenantId, voucherId: voucher.id },
      })) + 1;
    await tx.voucherStatusHistory.create({
      data: {
        command,
        createdBy: context.accountId,
        decisionSnapshot: json(snapshot),
        fromStatus: from,
        sequence,
        tenantId: context.tenantId,
        toStatus: to,
        updatedBy: context.accountId,
        voucherId: voucher.id,
      },
    });
    await this.emit(
      tx,
      'SettlementVoucher',
      voucher.id,
      changed.version,
      `billing.voucher.${to.toLowerCase()}.v1`,
      context,
      metadata,
      { voucherId: voucher.id },
    );
  }

  private async ensureOpen(
    tx: Prisma.TransactionClient,
    date: Date,
    tenantId: string,
  ) {
    const closed = await tx.billingAccountingPeriod.findFirst({
      where: {
        periodFrom: { lte: date },
        periodTo: { gte: date },
        status: 'CLOSED',
        tenantId,
      },
    });
    if (closed)
      this.conflict(
        'BILLING_PERIOD_CLOSED',
        `Accounting period ${closed.periodKey} is closed`,
      );
  }

  private async lockPeriod(
    tx: Prisma.TransactionClient,
    id: string,
    tenantId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:period:${id}`}, 0))`;
    const period = await tx.billingAccountingPeriod.findFirst({
      where: { id, tenantId },
    });
    if (!period)
      throw new AppError(
        'BILLING_PERIOD_NOT_FOUND',
        'Accounting period was not found',
        404,
      );
    return period;
  }

  private periodHistory(
    tx: Prisma.TransactionClient,
    periodId: string,
    sequence: number,
    fromStatus: 'CLOSED' | 'CLOSING' | 'OPEN' | 'REOPENED' | null,
    toStatus: 'CLOSED' | 'CLOSING' | 'OPEN' | 'REOPENED',
    command: string,
    context: TenantContext,
    snapshot: Record<string, unknown>,
  ) {
    return tx.billingPeriodStatusHistory.create({
      data: {
        command,
        createdBy: context.accountId,
        ...(fromStatus ? { fromStatus } : {}),
        periodId,
        sequence,
        snapshot: json(snapshot),
        tenantId: context.tenantId,
        toStatus,
        updatedBy: context.accountId,
      },
    });
  }

  private dimensionRef(
    dimension: string,
    voucher: { partnerRef: string },
    calculation: { businessRef: string },
    fact: { dimensions: Prisma.JsonValue; serviceType: string },
  ) {
    if (dimension === 'PARTNER') return voucher.partnerRef;
    if (dimension === 'ORDER') return calculation.businessRef;
    if (dimension === 'SERVICE') return fact.serviceType;
    const dimensions =
      fact.dimensions && typeof fact.dimensions === 'object' && !Array.isArray(fact.dimensions)
        ? (fact.dimensions as Record<string, unknown>)
        : {};
    const value = dimension === 'WAREHOUSE' ? dimensions.warehouseRef : dimensions.routeRef;
    return typeof value === 'string' && value ? value : 'UNSPECIFIED';
  }

  private normalizeInvoice(input: CreateBillingInvoiceInput) {
    this.uuid(input.statementId, 'statementId');
    if (!input.lines?.length)
      throw new AppError(
        'BILLING_INVOICE_INPUT_INVALID',
        'Invoice lines are required',
        400,
      );
    const lines = input.lines.map((line) => {
      this.uuid(line.sourceRef, 'sourceRef');
      if (!['ADJUSTMENT', 'STATEMENT_LINE'].includes(line.sourceType))
        throw new AppError(
          'BILLING_INVOICE_INPUT_INVALID',
          'Invoice source type is invalid',
          400,
        );
      return {
        amount: this.positive(line.amount, 'line.amount'),
        sourceRef: line.sourceRef,
        sourceType: line.sourceType,
      };
    });
    if (new Set(lines.map((line) => `${line.sourceType}:${line.sourceRef}`)).size !== lines.length)
      throw new AppError(
        'BILLING_INVOICE_INPUT_INVALID',
        'Invoice sources must be unique within one invoice',
        400,
      );
    return {
      attachmentRefs: this.references(input.attachmentRefs ?? []),
      invoiceDate: this.date(input.invoiceDate, 'invoiceDate'),
      invoiceNo: this.required(input.invoiceNo, 'invoiceNo', 200),
      invoicePartyRef: this.required(input.invoicePartyRef, 'invoicePartyRef', 200),
      lines,
      statementId: input.statementId,
    };
  }

  private references(values: readonly string[]) {
    const refs = [...new Set(values.map((value) => value.trim()))];
    if (refs.length !== values.length || refs.length > 20 || refs.some((ref) => !ref || ref.length > 500))
      throw new AppError(
        'BILLING_INVOICE_INPUT_INVALID',
        'Attachment references are invalid or duplicated',
        400,
      );
    return refs;
  }

  private emit(
    tx: Prisma.TransactionClient,
    aggregateType: string,
    id: string,
    version: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: Record<string, unknown>,
  ) {
    return tx.platformOutbox.create({
      data: {
        aggregateId: id,
        aggregateType,
        aggregateVersion: version,
        correlationId: metadata.correlationId,
        createdBy: context.accountId,
        eventName,
        payload: json(payload),
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
  }

  private positive(value: string, field: string) {
    const result = this.decimal(value, field);
    if (result.lte(0))
      throw new AppError(
        'BILLING_FINANCE_INPUT_INVALID',
        `${field} must be positive`,
        400,
      );
    return result;
  }

  private decimal(value: string, field: string) {
    try {
      const result = new Prisma.Decimal(value);
      if (!result.isFinite()) throw new Error('not finite');
      return result;
    } catch {
      throw new AppError(
        'BILLING_FINANCE_INPUT_INVALID',
        `${field} is invalid`,
        400,
      );
    }
  }

  private currency(value: string) {
    const result = value?.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(result))
      throw new AppError(
        'BILLING_FINANCE_INPUT_INVALID',
        'currency is invalid',
        400,
      );
    return result;
  }

  private date(value: string | Date, field: string) {
    const result = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(result.getTime()))
      throw new AppError(
        'BILLING_FINANCE_INPUT_INVALID',
        `${field} is invalid`,
        400,
      );
    return result;
  }

  private required(value: string, field: string, maximum: number) {
    const result = value?.trim();
    if (!result || result.length > maximum)
      throw new AppError(
        'BILLING_FINANCE_INPUT_INVALID',
        `${field} is required or too long`,
        400,
      );
    return result;
  }

  private uuid(value: string, field: string) {
    if (!isUuid(value))
      throw new AppError(
        'BILLING_FINANCE_INPUT_INVALID',
        `${field} is invalid`,
        400,
      );
  }

  private periodConflict(command: string, status: string, version: number): never {
    this.conflict(
      'BILLING_PERIOD_TRANSITION_INVALID',
      `Cannot ${command} from ${status} at version ${version}`,
    );
  }

  private conflict(code: string, message: string): never {
    throw new AppError(code, message, 409);
  }
}
