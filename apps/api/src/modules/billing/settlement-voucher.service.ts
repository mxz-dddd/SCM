import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { businessNumber } from '../platform/public/numbering.facade';
import type { CommandMetadata } from '../platform/tenant.service';

type Direction = 'PAYABLE' | 'RECEIVABLE';
type VoucherStatus =
  | 'APPROVED'
  | 'CALCULATED'
  | 'CLOSED'
  | 'DRAFT'
  | 'INVOICED'
  | 'PAID'
  | 'RECONCILED'
  | 'VALIDATED'
  | 'VOIDED';

export type CreateSettlementVoucherInput = {
  approvalThreshold: string;
  businessType: string;
  calculationIds: readonly string[];
  direction: Direction;
  manualAdjustment?: boolean;
  adjustmentReason?: string;
  partnerRef: string;
  periodFrom: string;
  periodTo: string;
};

type PostingSource = {
  amount: Prisma.Decimal;
  calculationId: string;
  sourceLineRef: string;
  sourceSnapshot: Record<string, unknown>;
  sourceType: 'ACCESSORIAL' | 'CALCULATION_LINE' | 'TAX_DETAIL';
  taxComponent: boolean;
};

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

@Injectable()
export class SettlementVoucherService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createDraft(
    raw: CreateSettlementVoucherInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const input = this.normalizeDraft(raw);
    return this.prisma.$transaction(async (tx) => {
      const calculations = await tx.billingCalculation.findMany({
        where: {
          id: { in: input.calculationIds },
          tenantId: context.tenantId,
        },
      });
      if (calculations.length !== input.calculationIds.length)
        this.conflict(
          'BILLING_VOUCHER_CALCULATION_INVALID',
          'Every selected calculation must exist exactly once',
        );
      if (
        calculations.some(
          (item) =>
            item.direction !== input.direction ||
            item.status !== 'CALCULATED' ||
            item.chargeType !== input.businessType,
        ) ||
        new Set(
          calculations.map(({ settlementCurrency }) => settlementCurrency),
        ).size !== 1
      )
        this.conflict(
          'BILLING_VOUCHER_CALCULATION_INVALID',
          'Calculations must be calculated and share direction, business type and currency',
        );
      const facts = await tx.chargeFact.findMany({
        where: {
          id: { in: calculations.map(({ chargeFactId }) => chargeFactId) },
          tenantId: context.tenantId,
        },
      });
      const from = this.date(input.periodFrom, 'periodFrom');
      const to = this.endOfDay(input.periodTo, 'periodTo');
      await this.ensurePeriodOpen(tx, from, to, context.tenantId);
      if (
        facts.length !== calculations.length ||
        facts.some(
          (fact) =>
            fact.partyRef !== input.partnerRef ||
            fact.occurredAt < from ||
            fact.occurredAt > to,
        )
      )
        this.conflict(
          'BILLING_VOUCHER_SCOPE_INVALID',
          'Calculations must belong to the partner and fact occurrence period',
        );
      const voucher = await tx.settlementVoucher.create({
        data: {
          ...(input.adjustmentReason
            ? { adjustmentReason: input.adjustmentReason }
            : {}),
          approvalThreshold: input.approvalThreshold,
          businessType: input.businessType,
          createdBy: context.accountId,
          currency: calculations[0]!.settlementCurrency,
          direction: input.direction,
          manualAdjustment: input.manualAdjustment,
          partnerRef: input.partnerRef,
          periodFrom: from,
          periodTo: this.date(input.periodTo, 'periodTo'),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          voucherNo: await businessNumber(
            this.prisma,
            input.direction === 'PAYABLE'
              ? 'BILLING_AP_VOUCHER'
              : 'BILLING_AR_VOUCHER',
            context,
            metadata,
            `settlement-voucher:${input.direction}:${input.partnerRef}:${from.toISOString()}:${input.periodTo}`,
          ),
        },
      });
      for (const calculation of calculations)
        await tx.voucherCalculationSelection.create({
          data: {
            calculationId: calculation.id,
            calculationSnapshot: json(calculation),
            createdBy: context.accountId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            voucherId: voucher.id,
          },
        });
      await this.history(tx, voucher.id, 1, null, 'DRAFT', 'CREATE', context, {
        calculationIds: input.calculationIds,
      });
      await this.emit(
        tx,
        voucher.id,
        voucher.version,
        'billing.voucher.draft-created.v1',
        context,
        metadata,
        { direction: voucher.direction, voucherId: voucher.id },
      );
      return toHttpJson({
        status: voucher.status,
        version: voucher.version,
        voucherId: voucher.id,
        voucherNo: voucher.voucherNo,
      });
    });
  }

  calculate(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'voucherId');
    return this.prisma.$transaction(async (tx) => {
      const voucher = await this.lockVoucher(tx, id, context.tenantId);
      await this.ensurePeriodOpen(
        tx,
        voucher.periodFrom,
        voucher.periodTo,
        context.tenantId,
      );
      this.requireState(voucher, 'DRAFT', input.expectedVersion, 'CALCULATE');
      const selections = await tx.voucherCalculationSelection.findMany({
        where: { tenantId: context.tenantId, voucherId: id },
      });
      const calculations = await tx.billingCalculation.findMany({
        where: {
          id: { in: selections.map(({ calculationId }) => calculationId) },
          tenantId: context.tenantId,
        },
      });
      const sources: PostingSource[] = [];
      for (const calculation of calculations)
        sources.push(
          ...(await this.postingSources(tx, calculation, context.tenantId)),
        );
      try {
        for (const [index, source] of sources.entries())
          await tx.billingVoucherLine.create({
            data: {
              amount: source.amount,
              calculationId: source.calculationId,
              createdBy: context.accountId,
              currency: voucher.currency,
              lineNo: index + 1,
              sourceLineRef: source.sourceLineRef,
              sourceSnapshot: json(source.sourceSnapshot),
              sourceType: source.sourceType,
              taxComponent: source.taxComponent,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
              voucherId: id,
            },
          });
      } catch (error) {
        if (isPrismaErrorCode(error, 'P2002'))
          this.conflict(
            'BILLING_CALCULATION_LINE_ALREADY_VOUCHERED',
            'A calculation line already belongs to an effective voucher',
          );
        throw error;
      }
      const subtotal = sources
        .filter(({ taxComponent }) => !taxComponent)
        .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
      const tax = sources
        .filter(({ taxComponent }) => taxComponent)
        .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
      const total = subtotal.plus(tax);
      const contracts = await tx.rateMatch.findMany({
        select: {
          chargeFactId: true,
          contractRef: true,
          rateVersionNumber: true,
          rateVersionRef: true,
        },
        where: {
          id: { in: calculations.map(({ rateMatchId }) => rateMatchId) },
          tenantId: context.tenantId,
        },
      });
      const changed = await tx.settlementVoucher.update({
        data: {
          contractSnapshot: json(contracts),
          status: 'CALCULATED',
          subtotalAmount: subtotal,
          taxAmount: tax,
          totalAmount: total,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.history(
        tx,
        id,
        2,
        'DRAFT',
        'CALCULATED',
        'CALCULATE',
        context,
        { lineCount: sources.length, totalAmount: total.toString() },
      );
      await this.emit(
        tx,
        id,
        changed.version,
        'billing.voucher.calculated.v1',
        context,
        metadata,
        { amount: total.toString(), voucherId: id },
      );
      return toHttpJson({
        lineCount: sources.length,
        status: changed.status,
        totalAmount: total.toString(),
        version: changed.version,
        voucherId: id,
      });
    });
  }

  validate(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'voucherId');
    return this.prisma.$transaction(async (tx) => {
      const voucher = await this.lockVoucher(tx, id, context.tenantId);
      await this.ensurePeriodOpen(
        tx,
        voucher.periodFrom,
        voucher.periodTo,
        context.tenantId,
      );
      this.requireState(
        voucher,
        'CALCULATED',
        input.expectedVersion,
        'VALIDATE',
      );
      const [selections, lines, previousValidations] = await Promise.all([
        tx.voucherCalculationSelection.findMany({
          where: { tenantId: context.tenantId, voucherId: id },
        }),
        tx.billingVoucherLine.findMany({
          where: { tenantId: context.tenantId, voucherId: id },
        }),
        tx.voucherValidation.count({
          where: { tenantId: context.tenantId, voucherId: id },
        }),
      ]);
      const calculations = await tx.billingCalculation.findMany({
        where: {
          id: { in: selections.map(({ calculationId }) => calculationId) },
          tenantId: context.tenantId,
        },
      });
      const facts = await tx.chargeFact.findMany({
        where: {
          id: { in: calculations.map(({ chargeFactId }) => chargeFactId) },
          tenantId: context.tenantId,
        },
      });
      const taxes = await tx.taxDetail.findMany({
        where: {
          calculationId: { in: calculations.map(({ id: itemId }) => itemId) },
          tenantId: context.tenantId,
        },
      });
      const matches = await tx.rateMatch.findMany({
        where: {
          id: { in: calculations.map(({ rateMatchId }) => rateMatchId) },
          tenantId: context.tenantId,
        },
      });
      const lineTotal = lines.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0),
      );
      const checks = {
        amountMatchesLines: lineTotal.eq(voucher.totalAmount),
        businessStateValid:
          calculations.length === selections.length &&
          calculations.every(
            (item) =>
              item.status === 'CALCULATED' &&
              item.direction === voucher.direction &&
              item.settlementCurrency === voucher.currency,
          ) &&
          facts.length === calculations.length &&
          facts.every(
            (fact) =>
              fact.status === 'ACTIVE' &&
              fact.occurredAt >= voucher.periodFrom &&
              fact.occurredAt <= this.endOfDay(voucher.periodTo),
          ),
        contractComplete:
          matches.length === calculations.length &&
          matches.every(({ contractRef }) => Boolean(contractRef)),
        noDuplicateSources:
          new Set(
            lines.map(
              ({ sourceType, sourceLineRef }) =>
                `${sourceType}:${sourceLineRef}`,
            ),
          ).size === lines.length,
        taxComplete:
          taxes.length === calculations.length &&
          taxes.every(
            ({ taxAmount, taxRate }) =>
              !taxAmount.isNegative() &&
              !taxRate.isNegative() &&
              taxRate.lte(100),
          ),
      };
      const errors = Object.entries(checks)
        .filter(([key, passed]) => !passed && key !== 'contractComplete')
        .map(([key]) => key);
      const approvalReasons = [
        ...(!checks.contractComplete ? ['NO_CONTRACT'] : []),
        ...(voucher.totalAmount.gt(voucher.approvalThreshold)
          ? ['AMOUNT_OVER_THRESHOLD']
          : []),
        ...(voucher.manualAdjustment ? ['MANUAL_ADJUSTMENT'] : []),
      ];
      const validation = await tx.voucherValidation.create({
        data: {
          approvalReasonSnapshot: json(approvalReasons),
          approvalRequired: approvalReasons.length > 0,
          checkSnapshot: json(checks),
          createdBy: context.accountId,
          errorSnapshot: json(errors),
          passed: errors.length === 0,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          validationNo: previousValidations + 1,
          voucherId: id,
        },
      });
      if (errors.length) {
        await this.emit(
          tx,
          id,
          voucher.version,
          'billing.voucher.validation-failed.v1',
          context,
          metadata,
          { errors, validationId: validation.id, voucherId: id },
        );
        return {
          errors,
          status: voucher.status,
          validationId: validation.id,
          version: voucher.version,
          voucherId: id,
        };
      }
      const validated = await tx.settlementVoucher.update({
        data: {
          status: 'VALIDATED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.history(
        tx,
        id,
        3,
        'CALCULATED',
        'VALIDATED',
        'VALIDATE',
        context,
        { approvalReasons, validationId: validation.id },
      );
      if (approvalReasons.length) {
        const attempt =
          (await tx.voucherApprovalTask.count({
            where: { tenantId: context.tenantId, voucherId: id },
          })) + 1;
        const task = await tx.voucherApprovalTask.create({
          data: {
            attempt,
            candidateRole: 'BILLING_VOUCHER_APPROVER',
            createdBy: context.accountId,
            routeReasonSnapshot: json(approvalReasons),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            voucherId: id,
          },
        });
        await this.emit(
          tx,
          id,
          validated.version,
          'billing.voucher.approval-requested.v1',
          context,
          metadata,
          { approvalTaskId: task.id, reasons: approvalReasons, voucherId: id },
        );
        return {
          approvalRequired: true,
          approvalTaskId: task.id,
          status: validated.status,
          validationId: validation.id,
          version: validated.version,
          voucherId: id,
        };
      }
      return this.approveVoucher(
        tx,
        validated,
        'AUTO_APPROVE',
        context,
        metadata,
      );
    });
  }

  decideApproval(
    id: string,
    input: {
      decision: 'APPROVE' | 'REJECT';
      expectedTaskVersion: number;
      expectedVoucherVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'approvalTaskId');
    const reason = this.required(input.reason, 'reason', 1000);
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.voucherApprovalTask.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!task || task.status !== 'PENDING')
        this.conflict(
          'BILLING_APPROVAL_STATE_INVALID',
          'A pending voucher approval task is required',
        );
      if (task.version !== input.expectedTaskVersion)
        this.conflict(
          'BILLING_APPROVAL_VERSION_CONFLICT',
          'Approval task version conflicts',
        );
      const voucher = await this.lockVoucher(
        tx,
        task.voucherId,
        context.tenantId,
      );
      await this.ensurePeriodOpen(
        tx,
        voucher.periodFrom,
        voucher.periodTo,
        context.tenantId,
      );
      this.requireState(
        voucher,
        'VALIDATED',
        input.expectedVoucherVersion,
        'APPROVE',
      );
      if (voucher.createdBy === context.accountId)
        throw new AppError(
          'BILLING_MAKER_CHECKER_REQUIRED',
          'Voucher creator cannot approve the same voucher',
          403,
        );
      const decided = await tx.voucherApprovalTask.update({
        data: {
          decidedAt: new Date(),
          decidedBy: context.accountId,
          decisionReason: reason,
          status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      if (input.decision === 'REJECT') {
        await this.emit(
          tx,
          voucher.id,
          voucher.version,
          'billing.voucher.approval-rejected.v1',
          context,
          metadata,
          { approvalTaskId: id, reason, voucherId: voucher.id },
        );
        return {
          approvalStatus: decided.status,
          status: voucher.status,
          version: voucher.version,
          voucherId: voucher.id,
        };
      }
      return this.approveVoucher(
        tx,
        voucher,
        'MANUAL_APPROVE',
        context,
        metadata,
        id,
      );
    });
  }

  createAccrual(
    calculationId: string,
    input: { accountingDate: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(calculationId, 'calculationId');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:accrual:${calculationId}`}, 0))`;
      const existing = await tx.billingAccrualVoucher.findFirst({
        where: { calculationId, tenantId: context.tenantId },
      });
      if (existing)
        return {
          accrualVoucherId: existing.id,
          replayed: true,
          status: existing.status,
          version: existing.version,
        };
      const calculation = await tx.billingCalculation.findFirst({
        where: {
          direction: 'PAYABLE',
          id: calculationId,
          status: 'CALCULATED',
          tenantId: context.tenantId,
        },
      });
      if (!calculation)
        this.conflict(
          'BILLING_ACCRUAL_CALCULATION_INVALID',
          'A calculated payable is required for accrual',
        );
      const sources = await this.postingSources(
        tx,
        calculation,
        context.tenantId,
      );
      const accountingDate = this.date(input.accountingDate, 'accountingDate');
      await this.ensurePeriodOpen(
        tx,
        accountingDate,
        accountingDate,
        context.tenantId,
      );
      const accrual = await tx.billingAccrualVoucher.create({
        data: {
          accountingDate,
          accrualNo: await businessNumber(
            this.prisma,
            'BILLING_ACCRUAL',
            context,
            metadata,
            `billing-accrual:${calculationId}`,
          ),
          amount: calculation.totalAmount,
          basisSnapshot: json({
            businessRef: calculation.businessRef,
            calculationId,
            calculationVersion: calculation.calculationVersion,
          }),
          calculationId,
          createdBy: context.accountId,
          currency: calculation.settlementCurrency,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      for (const [index, source] of sources.entries())
        await tx.billingAccrualLine.create({
          data: {
            accrualVoucherId: accrual.id,
            amount: source.amount,
            createdBy: context.accountId,
            currency: calculation.settlementCurrency,
            lineNo: index + 1,
            sourceLineRef: source.sourceLineRef,
            sourceSnapshot: json(source.sourceSnapshot),
            sourceType: source.sourceType,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      await this.emit(
        tx,
        accrual.id,
        accrual.version,
        'billing.accrual.draft-created.v1',
        context,
        metadata,
        { accrualVoucherId: accrual.id, calculationId },
      );
      return {
        accrualVoucherId: accrual.id,
        replayed: false,
        status: accrual.status,
        version: accrual.version,
      };
    });
  }

  postAccrual(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'accrualVoucherId');
    return this.prisma.$transaction(async (tx) => {
      const accrual = await tx.billingAccrualVoucher.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !accrual ||
        accrual.status !== 'DRAFT' ||
        accrual.version !== input.expectedVersion
      )
        this.conflict(
          'BILLING_ACCRUAL_STATE_INVALID',
          'A matching draft accrual version is required',
        );
      await this.ensurePeriodOpen(
        tx,
        accrual.accountingDate,
        accrual.accountingDate,
        context.tenantId,
      );
      const changed = await tx.billingAccrualVoucher.update({
        data: {
          postedAt: new Date(),
          status: 'POSTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        id,
        changed.version,
        'billing.accrual.posted.v1',
        context,
        metadata,
        { accrualVoucherId: id, calculationId: changed.calculationId },
      );
      return {
        accrualVoucherId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  private async approveVoucher(
    tx: Prisma.TransactionClient,
    voucher: {
      id: string;
      version: number;
      status: VoucherStatus;
      totalAmount: Prisma.Decimal;
      currency: string;
    },
    command: string,
    context: TenantContext,
    metadata: CommandMetadata,
    approvalTaskId?: string,
  ) {
    const changed = await tx.settlementVoucher.update({
      data: {
        approvedAt: new Date(),
        approvedBy: context.accountId,
        status: 'APPROVED',
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: voucher.id },
    });
    const histories = await tx.voucherStatusHistory.count({
      where: { tenantId: context.tenantId, voucherId: voucher.id },
    });
    await this.history(
      tx,
      voucher.id,
      histories + 1,
      'VALIDATED',
      'APPROVED',
      command,
      context,
      { approvalTaskId },
    );
    const reversalIds = await this.reverseAccruals(
      tx,
      changed.id,
      context,
      metadata,
    );
    await this.emit(
      tx,
      changed.id,
      changed.version,
      'billing.voucher.approved.v1',
      context,
      metadata,
      {
        amount: changed.totalAmount.toString(),
        currency: changed.currency,
        direction: changed.direction,
        reversalIds,
        voucherId: changed.id,
      },
    );
    return {
      approvalRequired: false,
      reversalIds,
      status: changed.status,
      version: changed.version,
      voucherId: changed.id,
    };
  }

  private async reverseAccruals(
    tx: Prisma.TransactionClient,
    voucherId: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const actualLines = await tx.billingVoucherLine.findMany({
      orderBy: { lineNo: 'asc' },
      where: { tenantId: context.tenantId, voucherId },
    });
    const calculations = await tx.billingCalculation.findMany({
      where: {
        id: { in: actualLines.map(({ calculationId }) => calculationId) },
        tenantId: context.tenantId,
      },
    });
    const businessRefs = new Set(
      calculations.map(({ businessRef }) => businessRef),
    );
    const posted = await tx.billingAccrualVoucher.findMany({
      where: { status: 'POSTED', tenantId: context.tenantId },
    });
    const accrualCalculations = await tx.billingCalculation.findMany({
      where: {
        id: { in: posted.map(({ calculationId }) => calculationId) },
        tenantId: context.tenantId,
      },
    });
    const businessByCalculation = new Map(
      accrualCalculations.map((item) => [item.id, item.businessRef]),
    );
    const eligible = posted.filter((item) =>
      businessRefs.has(businessByCalculation.get(item.calculationId) ?? ''),
    );
    const reversalIds: string[] = [];
    for (const accrual of eligible) {
      const existing = await tx.billingReversalVoucher.findFirst({
        where: {
          accrualVoucherId: accrual.id,
          actualVoucherId: voucherId,
          tenantId: context.tenantId,
        },
      });
      if (existing) {
        reversalIds.push(existing.id);
        continue;
      }
      const accrualLines = await tx.billingAccrualLine.findMany({
        orderBy: { lineNo: 'asc' },
        where: { accrualVoucherId: accrual.id, tenantId: context.tenantId },
      });
      const matchingActual = actualLines.filter((line) =>
        calculations.some(
          (calculation) =>
            calculation.id === line.calculationId &&
            calculation.businessRef ===
              businessByCalculation.get(accrual.calculationId),
        ),
      );
      if (!matchingActual.length) continue;
      const actualTotal = matchingActual.reduce(
        (sum, line) => sum.plus(line.amount),
        new Prisma.Decimal(0),
      );
      const reversal = await tx.billingReversalVoucher.create({
        data: {
          accrualVoucherId: accrual.id,
          actualVoucherId: voucherId,
          createdBy: context.accountId,
          currency: accrual.currency,
          differenceAmount: actualTotal.minus(accrual.amount),
          reversalAmount: accrual.amount.negated(),
          reversalNo: await businessNumber(
            this.prisma,
            'BILLING_REVERSAL',
            context,
            metadata,
            `billing-reversal:${accrual.id}:${voucherId}`,
          ),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      let allocated = new Prisma.Decimal(0);
      for (const [index, accrualLine] of accrualLines.entries()) {
        const isLast = index === accrualLines.length - 1;
        const actualAmount = isLast
          ? actualTotal.minus(allocated)
          : actualTotal
              .times(accrualLine.amount)
              .div(accrual.amount)
              .toDecimalPlaces(6);
        allocated = allocated.plus(actualAmount);
        const actualLine =
          matchingActual.find(
            (line) =>
              line.sourceType === accrualLine.sourceType &&
              line.sourceLineRef === accrualLine.sourceLineRef,
          ) ?? matchingActual[Math.min(index, matchingActual.length - 1)]!;
        await tx.billingReversalLine.create({
          data: {
            accrualAmount: accrualLine.amount,
            accrualLineId: accrualLine.id,
            actualAmount,
            actualVoucherLineId: actualLine.id,
            createdBy: context.accountId,
            currency: accrual.currency,
            differenceAmount: actualAmount.minus(accrualLine.amount),
            lineNo: index + 1,
            linkSnapshot: json({
              actualSourceLineRef: actualLine.sourceLineRef,
              accrualSourceLineRef: accrualLine.sourceLineRef,
            }),
            reversalVoucherId: reversal.id,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      await tx.billingAccrualVoucher.update({
        data: {
          reversedAt: new Date(),
          status: 'REVERSED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: accrual.id },
      });
      reversalIds.push(reversal.id);
    }
    return reversalIds;
  }

  private async postingSources(
    tx: Prisma.TransactionClient,
    calculation: {
      accessorialAmount: Prisma.Decimal;
      id: string;
      settlementCurrency: string;
      subtotalAmount: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
    },
    tenantId: string,
  ): Promise<PostingSource[]> {
    const [baseLines, accessorials, tax, fx] = await Promise.all([
      tx.billingCalculationLine.findMany({
        orderBy: { lineNo: 'asc' },
        where: { calculationId: calculation.id, tenantId },
      }),
      tx.accessorialCharge.findMany({
        orderBy: { lineNo: 'asc' },
        where: { calculationId: calculation.id, tenantId },
      }),
      tx.taxDetail.findFirst({
        where: { calculationId: calculation.id, tenantId },
      }),
      tx.fxConversion.findFirst({
        where: { calculationId: calculation.id, tenantId },
      }),
    ]);
    if (!baseLines.length || !tax || !fx)
      this.conflict(
        'BILLING_VOUCHER_CALCULATION_INCOMPLETE',
        'Calculation lines, tax and FX detail are required',
      );
    const round = (value: Prisma.Decimal) =>
      value.toDecimalPlaces(
        fx.roundingScale,
        this.roundingMode(fx.roundingMode),
      );
    const base: PostingSource[] = baseLines.map((line) => ({
      amount: round(line.roundedAmount.times(fx.exchangeRate)),
      calculationId: calculation.id,
      sourceLineRef: line.id,
      sourceSnapshot: {
        lineType: line.lineType,
        sourceAmount: line.roundedAmount.toString(),
      },
      sourceType: 'CALCULATION_LINE' as const,
      taxComponent: false,
    }));
    this.adjustLast(base, calculation.subtotalAmount);
    const extras: PostingSource[] = accessorials.map((line) => ({
      amount: round(line.amount.times(fx.exchangeRate)),
      calculationId: calculation.id,
      sourceLineRef: line.id,
      sourceSnapshot: {
        code: line.code,
        sourceAmount: line.amount.toString(),
      },
      sourceType: 'ACCESSORIAL' as const,
      taxComponent: false,
    }));
    this.adjustLast(extras, calculation.accessorialAmount);
    const charges = [...base, ...extras];
    if (tax.taxMode === 'INCLUSIVE') {
      const last = charges.at(-1)!;
      last.amount = last.amount.minus(calculation.taxAmount);
      last.sourceSnapshot = {
        ...last.sourceSnapshot,
        inclusiveTaxReclassification: calculation.taxAmount.toString(),
      };
    }
    const taxSource: PostingSource = {
      amount: calculation.taxAmount,
      calculationId: calculation.id,
      sourceLineRef: tax.id,
      sourceSnapshot: {
        sourceTaxAmount: tax.taxAmount.toString(),
        taxMode: tax.taxMode,
        taxRate: tax.taxRate.toString(),
      },
      sourceType: 'TAX_DETAIL',
      taxComponent: true,
    };
    const result = [...charges, taxSource];
    const total = result.reduce(
      (sum, item) => sum.plus(item.amount),
      new Prisma.Decimal(0),
    );
    if (!total.eq(calculation.totalAmount))
      this.conflict(
        'BILLING_VOUCHER_AMOUNT_INVALID',
        'Posting lines do not reconcile to the calculation total',
      );
    return result;
  }

  private adjustLast(
    sources: Array<{
      amount: Prisma.Decimal;
      sourceSnapshot: Record<string, unknown>;
    }>,
    target: Prisma.Decimal,
  ) {
    if (!sources.length) {
      if (!target.isZero())
        this.conflict(
          'BILLING_VOUCHER_AMOUNT_INVALID',
          'Calculation component detail is missing',
        );
      return;
    }
    const sum = sources.reduce(
      (total, item) => total.plus(item.amount),
      new Prisma.Decimal(0),
    );
    const difference = target.minus(sum);
    const last = sources.at(-1)!;
    last.amount = last.amount.plus(difference);
    last.sourceSnapshot = {
      ...last.sourceSnapshot,
      allocationRoundingDifference: difference.toString(),
    };
  }

  private roundingMode(mode: string) {
    const values: Record<string, Prisma.Decimal.Rounding> = {
      CEIL: Prisma.Decimal.ROUND_CEIL,
      FLOOR: Prisma.Decimal.ROUND_FLOOR,
      HALF_EVEN: Prisma.Decimal.ROUND_HALF_EVEN,
      HALF_UP: Prisma.Decimal.ROUND_HALF_UP,
    };
    return values[mode] ?? Prisma.Decimal.ROUND_HALF_UP;
  }

  private normalizeDraft(input: CreateSettlementVoucherInput) {
    const calculationIds = [...new Set(input.calculationIds ?? [])];
    if (
      !calculationIds.length ||
      calculationIds.length !== input.calculationIds?.length ||
      calculationIds.some((id) => !isUuid(id)) ||
      !isUuid(input.partnerRef) ||
      !['PAYABLE', 'RECEIVABLE'].includes(input.direction)
    )
      throw new AppError(
        'BILLING_VOUCHER_INPUT_INVALID',
        'Voucher selection, direction or partner is invalid',
        400,
      );
    const threshold = this.decimal(
      input.approvalThreshold,
      'approvalThreshold',
    );
    if (threshold.isNegative())
      throw new AppError(
        'BILLING_VOUCHER_INPUT_INVALID',
        'approvalThreshold cannot be negative',
        400,
      );
    const adjustmentReason = input.manualAdjustment
      ? this.required(input.adjustmentReason ?? '', 'adjustmentReason', 1000)
      : undefined;
    const businessType = this.required(
      input.businessType,
      'businessType',
      100,
    ).toUpperCase();
    const from = this.date(input.periodFrom, 'periodFrom');
    const to = this.date(input.periodTo, 'periodTo');
    if (to < from)
      throw new AppError(
        'BILLING_VOUCHER_INPUT_INVALID',
        'Voucher period is invalid',
        400,
      );
    return {
      adjustmentReason,
      approvalThreshold: threshold,
      businessType,
      calculationIds,
      direction: input.direction as Direction,
      manualAdjustment: Boolean(input.manualAdjustment),
      partnerRef: input.partnerRef,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
    };
  }

  private async lockVoucher(
    tx: Prisma.TransactionClient,
    id: string,
    tenantId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:voucher:${id}`}, 0))`;
    const voucher = await tx.settlementVoucher.findFirst({
      where: { id, tenantId },
    });
    if (!voucher)
      throw new AppError(
        'BILLING_VOUCHER_NOT_FOUND',
        'Settlement voucher was not found',
        404,
      );
    return voucher;
  }

  private async ensurePeriodOpen(
    tx: Prisma.TransactionClient,
    from: Date,
    to: Date,
    tenantId: string,
  ) {
    const closed = await tx.billingAccountingPeriod.findFirst({
      where: {
        periodFrom: { lte: to },
        periodTo: { gte: from },
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

  private requireState(
    voucher: { status: VoucherStatus; version: number },
    expectedStatus: VoucherStatus,
    expectedVersion: number,
    command: string,
  ) {
    if (
      voucher.status !== expectedStatus ||
      voucher.version !== expectedVersion
    )
      this.conflict(
        'BILLING_VOUCHER_TRANSITION_INVALID',
        `Cannot ${command} from ${voucher.status} at version ${voucher.version}`,
      );
  }

  private history(
    tx: Prisma.TransactionClient,
    voucherId: string,
    sequence: number,
    fromStatus: VoucherStatus | null,
    toStatus: VoucherStatus,
    command: string,
    context: TenantContext,
    snapshot: Record<string, unknown>,
  ) {
    return tx.voucherStatusHistory.create({
      data: {
        command,
        createdBy: context.accountId,
        decisionSnapshot: json(snapshot),
        ...(fromStatus ? { fromStatus } : {}),
        sequence,
        tenantId: context.tenantId,
        toStatus,
        updatedBy: context.accountId,
        voucherId,
      },
    });
  }

  private emit(
    tx: Prisma.TransactionClient,
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
        aggregateType: 'SettlementVoucher',
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

  private decimal(value: string, field: string) {
    try {
      const result = new Prisma.Decimal(value);
      if (!result.isFinite()) throw new Error('not finite');
      return result;
    } catch {
      throw new AppError(
        'BILLING_VOUCHER_INPUT_INVALID',
        `${field} is invalid`,
        400,
      );
    }
  }

  private date(value: string | Date, field = 'date') {
    const result = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(result.getTime()))
      throw new AppError(
        'BILLING_VOUCHER_INPUT_INVALID',
        `${field} is invalid`,
        400,
      );
    return result;
  }

  private endOfDay(value: string | Date, field = 'date') {
    const date = this.date(value, field);
    return new Date(date.getTime() + 86_399_999);
  }

  private required(value: string, field: string, maximum: number) {
    const result = value?.trim();
    if (!result || result.length > maximum)
      throw new AppError(
        'BILLING_VOUCHER_INPUT_INVALID',
        `${field} is required or too long`,
        400,
      );
    return result;
  }

  private uuid(value: string, field: string) {
    if (!isUuid(value))
      throw new AppError(
        'BILLING_VOUCHER_INPUT_INVALID',
        `${field} is invalid`,
        400,
      );
  }

  private conflict(code: string, message: string): never {
    throw new AppError(code, message, 409);
  }
}
