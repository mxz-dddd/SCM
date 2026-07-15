import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { RateMatchingFacade } from '../mdm/public/rate-matching.facade';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import type { BusinessEventInput } from '../platform/event.service';
import type { CommandMetadata } from '../platform/tenant.service';

type FactValues = {
  amount?: string;
  currency: string;
  dimensions: Readonly<Record<string, unknown>>;
  occurredAt: string;
  organizationRef?: string;
  partyRef: string;
  quantityBase: string;
  quantityBaseUom: string;
  quantityOriginal: string;
  quantityUom: string;
  routeRef?: string;
  serviceType: string;
};

export type ReceiveChargeFactInput = FactValues & {
  aggregateRef: string;
  businessRef: string;
  chargeType: string;
  eventId: string;
  sourceDomain: 'AMS' | 'TMS' | 'WMS';
  sourceEventType: string;
  sourceSnapshot: Readonly<Record<string, unknown>>;
};

export type CorrectChargeFactInput = {
  corrected: Partial<FactValues>;
  reason: string;
};

type NormalizedFact = Omit<ReceiveChargeFactInput, 'amount'> & {
  amount?: string;
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
};

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

const hash = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

@Injectable()
export class ChargeFactRateService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateMatchingFacade) private readonly rates: RateMatchingFacade,
    @Inject(EventConsumptionFacade)
    private readonly events: EventConsumptionFacade,
  ) {}

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const [
      facts,
      corrections,
      matches,
      traces,
      exceptions,
      calculations,
      calculationLines,
      accessorialCharges,
      taxDetails,
      fxConversions,
      calculationTraces,
      vouchers,
      voucherLines,
      voucherValidations,
      voucherHistories,
      voucherApprovals,
      accrualVouchers,
      accrualLines,
      reversalVouchers,
      reversalLines,
      reconciliationStatements,
      reconciliationLines,
      reconciliationAttachments,
      reconciliationVersions,
      reconciliationDisputes,
      reconciliationCommunications,
      adjustmentVouchers,
      allocationDetails,
      adjustmentApprovals,
      adjustmentHistories,
      invoices,
      invoiceLines,
      payments,
      settlementAllocations,
      accountingPeriods,
      periodCloseChecks,
      periodHistories,
      settlementReports,
      settlementMetrics,
      settlementMetricTraces,
    ] = await Promise.all([
      this.prisma.chargeFact.findMany({
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.factCorrection.findMany({
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.rateMatch.findMany({
        orderBy: [{ matchedAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.matchTrace.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.rateMatchException.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingCalculation.findMany({
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingCalculationLine.findMany({
        orderBy: [{ createdAt: 'desc' }, { lineNo: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.accessorialCharge.findMany({
        orderBy: [{ createdAt: 'desc' }, { lineNo: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.taxDetail.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.fxConversion.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.calculationTrace.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.settlementVoucher.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingVoucherLine.findMany({
        orderBy: [{ createdAt: 'desc' }, { lineNo: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.voucherValidation.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.voucherStatusHistory.findMany({
        orderBy: [{ createdAt: 'desc' }, { sequence: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.voucherApprovalTask.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingAccrualVoucher.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingAccrualLine.findMany({
        orderBy: [{ createdAt: 'desc' }, { lineNo: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.billingReversalVoucher.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingReversalLine.findMany({
        orderBy: [{ createdAt: 'desc' }, { lineNo: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.reconciliationStatement.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.reconciliationStatementLine.findMany({
        orderBy: [{ createdAt: 'desc' }, { lineNo: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.reconciliationStatementAttachment.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.reconciliationStatementVersion.findMany({
        orderBy: [{ createdAt: 'desc' }, { versionNo: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.reconciliationDispute.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.reconciliationCommunication.findMany({
        orderBy: [{ createdAt: 'desc' }, { sequence: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.billingAdjustmentVoucher.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingAllocationDetail.findMany({
        orderBy: [{ createdAt: 'desc' }, { lineNo: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.billingAdjustmentApprovalTask.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingAdjustmentStatusHistory.findMany({
        orderBy: [{ createdAt: 'desc' }, { sequence: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.billingInvoice.findMany({
        orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingInvoiceLine.findMany({
        orderBy: [{ createdAt: 'desc' }, { lineNo: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.billingPayment.findMany({
        orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingSettlementAllocation.findMany({
        orderBy: [{ createdAt: 'desc' }, { lineNo: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.billingAccountingPeriod.findMany({
        orderBy: [{ periodFrom: 'desc' }, { id: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingPeriodCloseCheck.findMany({
        orderBy: [{ createdAt: 'desc' }, { attempt: 'asc' }],
        take: 200,
        where,
      }),
      this.prisma.billingPeriodStatusHistory.findMany({
        orderBy: [{ createdAt: 'desc' }, { sequence: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.billingSettlementReport.findMany({
        orderBy: [{ createdAt: 'desc' }, { reportVersion: 'desc' }],
        take: 200,
        where,
      }),
      this.prisma.billingSettlementMetric.findMany({
        orderBy: [{ createdAt: 'desc' }, { dimensionRef: 'asc' }],
        take: 500,
        where,
      }),
      this.prisma.billingSettlementMetricTrace.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 1000,
        where,
      }),
    ]);
    return toHttpJson({
      accessorialCharges,
      accountingPeriods,
      adjustmentApprovals,
      adjustmentHistories,
      adjustmentVouchers,
      allocationDetails,
      accrualLines,
      accrualVouchers,
      calculationLines,
      calculations,
      calculationTraces,
      corrections,
      exceptions,
      facts,
      fxConversions,
      invoiceLines,
      invoices,
      matches,
      payments,
      periodCloseChecks,
      periodHistories,
      reconciliationAttachments,
      reconciliationCommunications,
      reconciliationDisputes,
      reconciliationLines,
      reconciliationStatements,
      reconciliationVersions,
      reversalLines,
      reversalVouchers,
      settlementAllocations,
      settlementMetricTraces,
      settlementMetrics,
      settlementReports,
      taxDetails,
      traces,
      voucherApprovals,
      voucherHistories,
      voucherLines,
      voucherValidations,
      vouchers,
    });
  }

  receive(
    input: ReceiveChargeFactInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const normalized = this.normalize(input);
    const contentHash = this.contentHash(normalized);
    return this.prisma.$transaction((tx) =>
      this.receiveInTransaction(tx, normalized, contentHash, context, metadata),
    );
  }

  consume(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.events.consumeBillingFact(
      event,
      context,
      metadata,
      async (message, tx) => {
        const normalized = this.normalize(this.fromEvent(message));
        return this.receiveInTransaction(
          tx,
          normalized,
          this.contentHash(normalized),
          context,
          metadata,
        );
      },
    );
  }

  private async receiveInTransaction(
    tx: Prisma.TransactionClient,
    normalized: NormalizedFact,
    contentHash: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    await this.lock(tx, `${context.tenantId}:event:${normalized.eventId}`);
    await this.lock(
      tx,
      `${context.tenantId}:fact:${normalized.businessRef}:${normalized.chargeType}`,
    );
    const existing = await tx.chargeFact.findFirst({
      where: {
        OR: [
          { eventId: normalized.eventId },
          {
            businessRef: normalized.businessRef,
            chargeType: normalized.chargeType,
          },
        ],
        tenantId: context.tenantId,
      },
    });
    if (existing) {
      if (existing.contentHash !== contentHash)
        throw new AppError(
          'BILLING_CHARGE_FACT_CONFLICT',
          'The event or business charge key already contains different fact content',
          409,
          { businessRef: normalized.businessRef },
        );
      return this.resultFor(tx, existing.id, `FACT:${existing.id}`, true);
    }
    const matching = await this.rates.matchForBilling(
      this.matchingInput(normalized),
      context,
    );
    const fact = await tx.chargeFact.create({
      data: {
        aggregateRef: normalized.aggregateRef,
        ...(normalized.amount ? { amount: normalized.amount } : {}),
        businessRef: normalized.businessRef,
        chargeType: normalized.chargeType,
        contentHash,
        createdBy: context.accountId,
        currency: normalized.currency,
        dimensions: json(normalized.dimensions),
        eventId: normalized.eventId,
        occurredAt: new Date(normalized.occurredAt),
        ...(normalized.organizationRef
          ? { organizationRef: normalized.organizationRef }
          : {}),
        partyRef: normalized.partyRef,
        quantityBase: normalized.quantityBase,
        quantityBaseUom: normalized.quantityBaseUom,
        quantityOriginal: normalized.quantityOriginal,
        quantityUom: normalized.quantityUom,
        ...(normalized.routeRef ? { routeRef: normalized.routeRef } : {}),
        serviceType: normalized.serviceType,
        sourceDomain: normalized.sourceDomain,
        sourceEventType: normalized.sourceEventType,
        sourceSnapshot: json(normalized.sourceSnapshot),
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    const match = await this.persistMatch(
      tx,
      fact.id,
      undefined,
      `FACT:${fact.id}`,
      normalized,
      matching,
      context,
    );
    await this.emit(
      tx,
      fact.id,
      fact.version,
      'billing.charge-fact-received.v1',
      context,
      metadata,
      {
        businessRef: fact.businessRef,
        chargeFactId: fact.id,
        chargeType: fact.chargeType,
        eventId: fact.eventId,
        matchStatus: match.status,
        occurredAt: fact.occurredAt.toISOString(),
      },
    );
    return {
      chargeFactId: fact.id,
      duplicate: false,
      exceptionId: match.exceptionId,
      matchStatus: match.status,
      rateMatchId: match.id,
      selectedRateVersionId: match.rateVersionRef,
      status: fact.status,
      version: fact.version,
    };
  }

  correct(
    id: string,
    input: CorrectChargeFactInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!isUuid(id))
      throw new AppError(
        'BILLING_CHARGE_FACT_NOT_FOUND',
        'Charge fact was not found',
        404,
      );
    const reason = this.required(input.reason, 'reason', 1000);
    if (!Object.keys(object(input.corrected)).length)
      throw new AppError(
        'BILLING_FACT_CORRECTION_INVALID',
        'At least one corrected field is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:correction:${id}`);
      const fact = await tx.chargeFact.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!fact)
        throw new AppError(
          'BILLING_CHARGE_FACT_NOT_FOUND',
          'Charge fact was not found',
          404,
        );
      const closedPeriod = await tx.billingAccountingPeriod.findFirst({
        where: {
          periodFrom: { lte: fact.occurredAt },
          periodTo: { gte: fact.occurredAt },
          status: 'CLOSED',
          tenantId: context.tenantId,
        },
      });
      if (closedPeriod)
        throw new AppError(
          'BILLING_PERIOD_CLOSED',
          `Accounting period ${closedPeriod.periodKey} is closed`,
          409,
        );
      const latest = await tx.factCorrection.findFirst({
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        where: { chargeFactId: id, tenantId: context.tenantId },
      });
      const current = latest
        ? (object(latest.correctedSnapshot) as NormalizedFact)
        : this.fromRow(fact);
      const normalized = this.normalize({
        ...current,
        ...input.corrected,
        dimensions: input.corrected.dimensions ?? current.dimensions,
        sourceSnapshot: current.sourceSnapshot,
      });
      const contentHash = this.contentHash(normalized);
      const duplicate = await tx.factCorrection.findFirst({
        where: { chargeFactId: id, contentHash, tenantId: context.tenantId },
      });
      if (duplicate)
        return this.resultFor(
          tx,
          fact.id,
          `CORRECTION:${duplicate.id}`,
          true,
          duplicate.id,
        );
      const matching = await this.rates.matchForBilling(
        this.matchingInput(normalized),
        context,
      );
      const correction = await tx.factCorrection.create({
        data: {
          chargeFactId: id,
          contentHash,
          correctedSnapshot: json(normalized),
          correctionNo: `COR-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8).toUpperCase()}`,
          createdBy: context.accountId,
          previousHash: latest?.contentHash ?? fact.contentHash,
          reason,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const match = await this.persistMatch(
        tx,
        fact.id,
        correction.id,
        `CORRECTION:${correction.id}`,
        normalized,
        matching,
        context,
      );
      await this.emit(
        tx,
        fact.id,
        fact.version,
        'billing.charge-fact-corrected.v1',
        context,
        metadata,
        {
          businessRef: fact.businessRef,
          chargeFactId: fact.id,
          chargeType: fact.chargeType,
          correctionId: correction.id,
          matchStatus: match.status,
          originalContentHash: fact.contentHash,
        },
      );
      return {
        chargeFactId: fact.id,
        correctionId: correction.id,
        duplicate: false,
        exceptionId: match.exceptionId,
        matchStatus: match.status,
        originalContentHash: fact.contentHash,
        rateMatchId: match.id,
        selectedRateVersionId: match.rateVersionRef,
        status: correction.status,
        version: correction.version,
      };
    });
  }

  private async persistMatch(
    tx: Prisma.TransactionClient,
    chargeFactId: string,
    factCorrectionId: string | undefined,
    matchKey: string,
    fact: NormalizedFact,
    matching: Awaited<ReturnType<RateMatchingFacade['matchForBilling']>>,
    context: TenantContext,
  ) {
    const selected = matching.selected;
    const row = await tx.rateMatch.create({
      data: {
        ...(selected ? { baseRate: selected.baseRate } : {}),
        chargeFactId,
        ...(selected ? { contractRef: selected.contractId } : {}),
        createdBy: context.accountId,
        currency: fact.currency,
        ...(factCorrectionId ? { factCorrectionId } : {}),
        factOccurredAt: new Date(fact.occurredAt),
        matchKey,
        ...(selected ? { priority: selected.priority } : {}),
        ...(selected ? { rateCardRef: selected.rateCardId } : {}),
        ...(selected ? { rateVersionNumber: selected.versionNumber } : {}),
        ...(selected ? { rateVersionRef: selected.rateVersionId } : {}),
        status: selected ? 'MATCHED' : 'UNMATCHED',
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    await tx.matchTrace.create({
      data: {
        candidateSnapshot: json(matching.candidates),
        createdBy: context.accountId,
        decisionSnapshot: json(
          selected
            ? {
                rule: 'HIGHEST_PRIORITY_THEN_LATEST_VERSION',
                selected,
              }
            : { reason: 'NO_MATCHING_RATE' },
        ),
        inputSnapshot: json(this.matchingInput(fact)),
        rateMatchId: row.id,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    const exception = selected
      ? undefined
      : await tx.rateMatchException.create({
          data: {
            candidateSnapshot: json(matching.candidates),
            chargeFactId,
            code: 'BILLING_RATE_NOT_FOUND',
            createdBy: context.accountId,
            rateMatchId: row.id,
            reason:
              'No published contract rate matched the fact occurrence time and dimensions',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
    return { ...row, exceptionId: exception?.id };
  }

  private async resultFor(
    tx: Prisma.TransactionClient,
    chargeFactId: string,
    matchKey: string,
    duplicate: boolean,
    correctionId?: string,
  ) {
    const match = await tx.rateMatch.findFirst({
      where: {
        matchKey,
        tenantId: (
          await tx.chargeFact.findUniqueOrThrow({ where: { id: chargeFactId } })
        ).tenantId,
      },
    });
    const exception = match
      ? await tx.rateMatchException.findFirst({
          where: { rateMatchId: match.id },
        })
      : null;
    return {
      chargeFactId,
      ...(correctionId ? { correctionId } : {}),
      duplicate,
      exceptionId: exception?.id,
      matchStatus: match?.status,
      rateMatchId: match?.id,
      selectedRateVersionId: match?.rateVersionRef,
      status: 'ACTIVE',
      version: 1,
    };
  }

  private normalize(input: ReceiveChargeFactInput): NormalizedFact {
    const sourceDomain = input.sourceDomain?.trim().toUpperCase();
    if (!['AMS', 'TMS', 'WMS'].includes(sourceDomain))
      throw new AppError(
        'BILLING_CHARGE_FACT_INVALID',
        'sourceDomain is invalid',
        400,
      );
    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime()))
      throw new AppError(
        'BILLING_CHARGE_FACT_INVALID',
        'occurredAt is invalid',
        400,
      );
    if (
      !isUuid(input.partyRef) ||
      (input.organizationRef && !isUuid(input.organizationRef))
    )
      throw new AppError(
        'BILLING_CHARGE_FACT_INVALID',
        'partyRef or organizationRef is invalid',
        400,
      );
    const currency = this.required(input.currency, 'currency', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency))
      throw new AppError(
        'BILLING_CHARGE_FACT_INVALID',
        'currency is invalid',
        400,
      );
    const quantityOriginal = this.decimal(
      input.quantityOriginal,
      'quantityOriginal',
    );
    const quantityBase = this.decimal(input.quantityBase, 'quantityBase');
    const amount =
      input.amount === undefined
        ? undefined
        : this.decimal(input.amount, 'amount');
    if (
      quantityOriginal.isNegative() ||
      quantityBase.isNegative() ||
      amount?.isNegative()
    )
      throw new AppError(
        'BILLING_CHARGE_FACT_INVALID',
        'Fact quantity and amount cannot be negative',
        400,
      );
    return {
      aggregateRef: this.required(input.aggregateRef, 'aggregateRef', 200),
      ...(amount ? { amount: amount.toString() } : {}),
      businessRef: this.required(input.businessRef, 'businessRef', 200),
      chargeType: this.required(
        input.chargeType,
        'chargeType',
        100,
      ).toUpperCase(),
      currency,
      dimensions: object(input.dimensions),
      eventId: this.required(input.eventId, 'eventId', 200),
      occurredAt: occurredAt.toISOString(),
      ...(input.organizationRef
        ? { organizationRef: input.organizationRef }
        : {}),
      partyRef: input.partyRef,
      quantityBase: quantityBase.toString(),
      quantityBaseUom: this.required(
        input.quantityBaseUom,
        'quantityBaseUom',
        20,
      ).toUpperCase(),
      quantityOriginal: quantityOriginal.toString(),
      quantityUom: this.required(
        input.quantityUom,
        'quantityUom',
        20,
      ).toUpperCase(),
      ...(input.routeRef
        ? { routeRef: this.required(input.routeRef, 'routeRef', 200) }
        : {}),
      serviceType: this.required(
        input.serviceType,
        'serviceType',
        100,
      ).toUpperCase(),
      sourceDomain: sourceDomain as 'AMS' | 'TMS' | 'WMS',
      sourceEventType: this.required(
        input.sourceEventType,
        'sourceEventType',
        150,
      ),
      sourceSnapshot: object(input.sourceSnapshot),
    };
  }

  private fromRow(row: {
    aggregateRef: string;
    amount: Prisma.Decimal | null;
    businessRef: string;
    chargeType: string;
    currency: string;
    dimensions: Prisma.JsonValue;
    eventId: string;
    occurredAt: Date;
    organizationRef: string | null;
    partyRef: string;
    quantityBase: Prisma.Decimal;
    quantityBaseUom: string;
    quantityOriginal: Prisma.Decimal;
    quantityUom: string;
    routeRef: string | null;
    serviceType: string;
    sourceDomain: string;
    sourceEventType: string;
    sourceSnapshot: Prisma.JsonValue;
  }): NormalizedFact {
    return this.normalize({
      aggregateRef: row.aggregateRef,
      ...(row.amount ? { amount: row.amount.toString() } : {}),
      businessRef: row.businessRef,
      chargeType: row.chargeType,
      currency: row.currency,
      dimensions: object(row.dimensions),
      eventId: row.eventId,
      occurredAt: row.occurredAt.toISOString(),
      ...(row.organizationRef ? { organizationRef: row.organizationRef } : {}),
      partyRef: row.partyRef,
      quantityBase: row.quantityBase.toString(),
      quantityBaseUom: row.quantityBaseUom,
      quantityOriginal: row.quantityOriginal.toString(),
      quantityUom: row.quantityUom,
      ...(row.routeRef ? { routeRef: row.routeRef } : {}),
      serviceType: row.serviceType,
      sourceDomain: row.sourceDomain as 'AMS' | 'TMS' | 'WMS',
      sourceEventType: row.sourceEventType,
      sourceSnapshot: object(row.sourceSnapshot),
    });
  }

  private fromEvent(event: BusinessEventInput): ReceiveChargeFactInput {
    const envelope = object(event.payload);
    const payload = object(envelope.chargeFact ?? envelope);
    const sourceDomain = event.eventType.split('.')[0]!.toUpperCase();
    const amount = text(payload.amount);
    const organizationRef = text(payload.organizationRef);
    const routeRef = text(payload.routeRef);
    return {
      aggregateRef: event.aggregateId,
      ...(amount ? { amount } : {}),
      businessRef: text(payload.businessRef),
      chargeType: text(payload.chargeType),
      currency: text(payload.currency),
      dimensions: object(payload.dimensions),
      eventId: event.eventId,
      occurredAt: text(payload.occurredAt) || event.occurredAt,
      ...(organizationRef ? { organizationRef } : {}),
      partyRef: text(payload.partyRef),
      quantityBase: text(payload.quantityBase),
      quantityBaseUom: text(payload.quantityBaseUom),
      quantityOriginal: text(payload.quantityOriginal),
      quantityUom: text(payload.quantityUom),
      ...(routeRef ? { routeRef } : {}),
      serviceType: text(payload.serviceType),
      sourceDomain: sourceDomain as 'AMS' | 'TMS' | 'WMS',
      sourceEventType: event.eventType,
      sourceSnapshot: payload,
    };
  }

  private contentHash(fact: NormalizedFact): string {
    const content = Object.fromEntries(
      Object.entries(fact).filter(([key]) => key !== 'eventId'),
    );
    return hash(content);
  }

  private matchingInput(fact: NormalizedFact) {
    return {
      currency: fact.currency,
      dimensions: fact.dimensions,
      occurredAt: new Date(fact.occurredAt),
      ...(fact.organizationRef
        ? { organizationRef: fact.organizationRef }
        : {}),
      partyRef: fact.partyRef,
      ...(fact.routeRef ? { routeRef: fact.routeRef } : {}),
      serviceType: fact.serviceType,
    };
  }

  private decimal(value: string, field: string): Prisma.Decimal {
    try {
      const result = new Prisma.Decimal(value);
      if (!result.isFinite()) throw new Error('not finite');
      return result;
    } catch {
      throw new AppError(
        'BILLING_CHARGE_FACT_INVALID',
        `${field} is invalid`,
        400,
      );
    }
  }

  private required(value: string, field: string, maximum: number): string {
    const result = value?.trim();
    if (!result || result.length > maximum)
      throw new AppError(
        'BILLING_CHARGE_FACT_INVALID',
        `${field} is required or too long`,
        400,
      );
    return result;
  }

  private lock(tx: Prisma.TransactionClient, key: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private emit(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: Prisma.InputJsonObject,
  ) {
    return tx.platformOutbox.create({
      data: {
        aggregateId: id,
        aggregateType: 'ChargeFact',
        aggregateVersion: version,
        correlationId: metadata.correlationId,
        createdBy: context.accountId,
        eventName,
        payload,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
  }
}
