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

type StatementStatus =
  | 'ADJUSTED'
  | 'DISPUTED'
  | 'DRAFT'
  | 'PUBLISHED'
  | 'RECONCILED';
type DisputeStatus =
  | 'ACCEPTED'
  | 'ADJUSTED'
  | 'EVIDENCE_REQUESTED'
  | 'OPEN'
  | 'REJECTED';
type AdjustmentStatus =
  | 'APPROVED'
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'POSTED'
  | 'REJECTED';

export type CreateReconciliationStatementInput = {
  attachmentRefs?: readonly string[];
  contractRef: string;
  partnerSnapshot?: Record<string, unknown>;
  periodFrom: string;
  periodTo: string;
  voucherIds: readonly string[];
};

export type CreateBillingAdjustmentInput = {
  adjustmentType: 'ADJUSTMENT' | 'CLAIM_DEDUCTION';
  allocations: readonly {
    amount: string;
    targetRef: string;
    targetSnapshot?: Record<string, unknown>;
    targetType: 'COST_CENTER' | 'ORDER';
  }[];
  amount: string;
  direction: 'DECREASE' | 'INCREASE';
  disputeId?: string;
  reason: string;
  sourceVoucherId: string;
  statementId?: string;
};

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

@Injectable()
export class ReconciliationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createStatement(
    raw: CreateReconciliationStatementInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const input = this.normalizeStatement(raw);
    return this.prisma.$transaction(async (tx) => {
      await this.ensurePeriodOpen(
        tx,
        input.periodFrom,
        input.periodTo,
        context.tenantId,
      );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:statement:${[...input.voucherIds].sort().join(':')}`}, 0))`;
      const vouchers = await tx.settlementVoucher.findMany({
        where: {
          id: { in: input.voucherIds },
          status: 'APPROVED',
          tenantId: context.tenantId,
        },
      });
      if (
        vouchers.length !== input.voucherIds.length ||
        new Set(vouchers.map(({ direction }) => direction)).size !== 1 ||
        new Set(vouchers.map(({ partnerRef }) => partnerRef)).size !== 1 ||
        new Set(vouchers.map(({ currency }) => currency)).size !== 1 ||
        vouchers.some(
          (voucher) =>
            voucher.periodFrom < input.periodFrom ||
            voucher.periodTo > input.periodTo ||
            !this.contractRefs(voucher.contractSnapshot).includes(
              input.contractRef,
            ),
        )
      )
        this.conflict(
          'BILLING_RECONCILIATION_SCOPE_INVALID',
          'Approved vouchers must share partner, direction, currency, period and contract',
        );
      const lines = await tx.billingVoucherLine.findMany({
        orderBy: [{ voucherId: 'asc' }, { lineNo: 'asc' }],
        where: {
          tenantId: context.tenantId,
          voucherId: { in: input.voucherIds },
        },
      });
      if (!lines.length)
        this.conflict(
          'BILLING_RECONCILIATION_LINES_REQUIRED',
          'At least one voucher line is required',
        );
      for (const voucher of vouchers) {
        const voucherLines = lines.filter(
          ({ voucherId }) => voucherId === voucher.id,
        );
        const voucherSubtotal = voucherLines
          .filter(({ taxComponent }) => !taxComponent)
          .reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0));
        const voucherTax = voucherLines
          .filter(({ taxComponent }) => taxComponent)
          .reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0));
        if (
          !voucherLines.length ||
          !voucherSubtotal.eq(voucher.subtotalAmount) ||
          !voucherTax.eq(voucher.taxAmount) ||
          !voucherSubtotal.plus(voucherTax).eq(voucher.totalAmount)
        )
          this.conflict(
            'BILLING_RECONCILIATION_VOUCHER_AMOUNT_INVALID',
            'Every voucher amount must equal its immutable posting lines',
          );
      }
      const calculations = await tx.billingCalculation.findMany({
        where: {
          id: { in: [...new Set(lines.map(({ calculationId }) => calculationId))] },
          tenantId: context.tenantId,
        },
      });
      const calculationById = new Map(
        calculations.map((calculation) => [calculation.id, calculation]),
      );
      const subtotal = lines
        .filter(({ taxComponent }) => !taxComponent)
        .reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0));
      const tax = lines
        .filter(({ taxComponent }) => taxComponent)
        .reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0));
      const total = subtotal.plus(tax);
      let statement;
      try {
        statement = await tx.reconciliationStatement.create({
          data: {
            contractRef: input.contractRef,
            createdBy: context.accountId,
            currency: vouchers[0]!.currency,
            direction: vouchers[0]!.direction,
            lineCount: lines.length,
            partnerRef: vouchers[0]!.partnerRef,
            partnerSnapshot: json({
              partnerRef: vouchers[0]!.partnerRef,
              ...input.partnerSnapshot,
            }),
            periodFrom: input.periodFrom,
            periodTo: input.periodTo,
            statementNo: await businessNumber(this.prisma, 'BILLING_RECONCILIATION_STATEMENT', context, metadata, `reconciliation-statement:${input.contractRef}:${input.periodFrom}:${input.periodTo}`),
            subtotalAmount: subtotal,
            taxAmount: tax,
            tenantId: context.tenantId,
            totalAmount: total,
            updatedBy: context.accountId,
            voucherCount: vouchers.length,
          },
        });
        const voucherById = new Map(vouchers.map((voucher) => [voucher.id, voucher]));
        for (const [index, line] of lines.entries()) {
          const calculation = calculationById.get(line.calculationId);
          if (!calculation)
            this.conflict(
              'BILLING_RECONCILIATION_CALCULATION_MISSING',
              'Voucher line calculation snapshot is unavailable',
            );
          await tx.reconciliationStatementLine.create({
            data: {
              amount: line.amount,
              businessRef: calculation.businessRef,
              businessSnapshot: json({
                businessRef: calculation.businessRef,
                calculationId: calculation.id,
                calculationVersion: calculation.calculationVersion,
              }),
              createdBy: context.accountId,
              currency: line.currency,
              lineNo: index + 1,
              sourceLineRef: line.sourceLineRef,
              sourceType: line.sourceType,
              statementId: statement.id,
              taxComponent: line.taxComponent,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
              voucherId: line.voucherId,
              voucherLineId: line.id,
              voucherSnapshot: json(voucherById.get(line.voucherId)),
            },
          });
        }
      } catch (error) {
        if (isPrismaErrorCode(error, 'P2002'))
          this.conflict(
            'BILLING_VOUCHER_LINE_ALREADY_RECONCILED',
            'A voucher line already belongs to a reconciliation statement',
          );
        throw error;
      }
      for (const attachmentRef of input.attachmentRefs)
        await tx.reconciliationStatementAttachment.create({
          data: {
            attachmentRef,
            attachmentSnapshot: json({ attachmentRef }),
            createdBy: context.accountId,
            statementId: statement.id,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      await this.statementVersion(tx, statement, 1, 'CREATE', context);
      await this.emit(
        tx,
        'ReconciliationStatement',
        statement.id,
        statement.version,
        'billing.reconciliation.draft-created.v1',
        context,
        metadata,
        { statementId: statement.id, voucherIds: input.voucherIds },
      );
      return toHttpJson({
        lineCount: statement.lineCount,
        statementId: statement.id,
        statementNo: statement.statementNo,
        status: statement.status,
        totalAmount: statement.totalAmount,
        version: statement.version,
      });
    });
  }

  publishStatement(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.transitionStatement(
      id,
      input.expectedVersion,
      ['DRAFT'],
      'PUBLISHED',
      'PUBLISH',
      context,
      metadata,
    );
  }

  async reconcileStatement(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'statementId');
    return this.prisma.$transaction(async (tx) => {
      const statement = await this.lockStatement(tx, id, context.tenantId);
      await this.ensurePeriodOpen(
        tx,
        statement.periodFrom,
        statement.periodTo,
        context.tenantId,
      );
      if (
        !['PUBLISHED', 'DISPUTED', 'ADJUSTED'].includes(statement.status) ||
        statement.version !== input.expectedVersion
      )
        this.transitionConflict('reconcile', statement.status, statement.version);
      const unresolved = await tx.reconciliationDispute.count({
        where: {
          statementId: id,
          status: { in: ['OPEN', 'EVIDENCE_REQUESTED', 'ACCEPTED'] },
          tenantId: context.tenantId,
        },
      });
      if (unresolved)
        this.conflict(
          'BILLING_RECONCILIATION_DISPUTES_OPEN',
          'All disputes must be rejected or adjusted before reconciliation',
        );
      const changed = await tx.reconciliationStatement.update({
        data: {
          reconciledAt: new Date(),
          reconciledBy: context.accountId,
          status: 'RECONCILED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const statementLines = await tx.reconciliationStatementLine.findMany({
        select: { voucherId: true },
        where: { statementId: id, tenantId: context.tenantId },
      });
      for (const voucherId of [
        ...new Set(statementLines.map(({ voucherId: value }) => value)),
      ]) {
        const voucher = await tx.settlementVoucher.findFirst({
          where: { id: voucherId, tenantId: context.tenantId },
        });
        if (!voucher || voucher.status !== 'APPROVED')
          this.conflict(
            'BILLING_RECONCILIATION_VOUCHER_STATE_INVALID',
            'Every source voucher must remain approved until reconciliation',
          );
        const changedVoucher = await tx.settlementVoucher.update({
          data: {
            status: 'RECONCILED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: voucherId },
        });
        const sequence =
          (await tx.voucherStatusHistory.count({
            where: { tenantId: context.tenantId, voucherId },
          })) + 1;
        await tx.voucherStatusHistory.create({
          data: {
            command: 'RECONCILE',
            createdBy: context.accountId,
            decisionSnapshot: json({ statementId: id }),
            fromStatus: 'APPROVED',
            sequence,
            tenantId: context.tenantId,
            toStatus: 'RECONCILED',
            updatedBy: context.accountId,
            voucherId,
          },
        });
        await this.emit(
          tx,
          'SettlementVoucher',
          voucherId,
          changedVoucher.version,
          'billing.voucher.reconciled.v1',
          context,
          metadata,
          { statementId: id, voucherId },
        );
      }
      await this.statementVersion(
        tx,
        changed,
        changed.version,
        'RECONCILE',
        context,
      );
      await this.emit(
        tx,
        'ReconciliationStatement',
        id,
        changed.version,
        'billing.reconciliation.reconciled.v1',
        context,
        metadata,
        { statementId: id },
      );
      return {
        statementId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async raiseDispute(
    statementId: string,
    raw: {
      category: 'DUPLICATE' | 'MISSING' | 'QUANTITY' | 'RATE' | 'SERVICE' | 'TAX';
      description: string;
      disputedAmount: string;
      evidenceRefs?: readonly string[];
      expectedStatementVersion: number;
      raisedByType: 'FINANCE' | 'PARTNER';
      statementLineId?: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(statementId, 'statementId');
    const input = this.normalizeDispute(raw);
    return this.prisma.$transaction(async (tx) => {
      const statement = await this.lockStatement(
        tx,
        statementId,
        context.tenantId,
      );
      await this.ensurePeriodOpen(
        tx,
        statement.periodFrom,
        statement.periodTo,
        context.tenantId,
      );
      if (
        !['PUBLISHED', 'DISPUTED'].includes(statement.status) ||
        statement.version !== input.expectedStatementVersion
      )
        this.transitionConflict('dispute', statement.status, statement.version);
      if (input.statementLineId) {
        const line = await tx.reconciliationStatementLine.findFirst({
          where: {
            id: input.statementLineId,
            statementId,
            tenantId: context.tenantId,
          },
        });
        if (!line)
          this.conflict(
            'BILLING_RECONCILIATION_LINE_INVALID',
            'Disputed line must belong to the statement',
          );
      } else if (input.category !== 'MISSING')
        throw new AppError(
          'BILLING_RECONCILIATION_INPUT_INVALID',
          'Only missing-line disputes may omit statementLineId',
          400,
        );
      const dispute = await tx.reconciliationDispute.create({
        data: {
          category: input.category,
          createdBy: context.accountId,
          currency: statement.currency,
          description: input.description,
          disputeNo: await businessNumber(this.prisma, 'BILLING_DISPUTE', context, metadata, `billing-dispute:${statementId}:${input.statementLineId ?? 'missing'}:${input.category}`),
          disputedAmount: input.disputedAmount,
          raisedByType: input.raisedByType,
          statementId,
          ...(input.statementLineId
            ? { statementLineId: input.statementLineId }
            : {}),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.communication(
        tx,
        dispute.id,
        1,
        'RAISED',
        input.raisedByType,
        input.description,
        input.evidenceRefs,
        context,
      );
      let changed = statement;
      if (statement.status === 'PUBLISHED') {
        changed = await tx.reconciliationStatement.update({
          data: {
            status: 'DISPUTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: statementId },
        });
        await this.statementVersion(
          tx,
          changed,
          changed.version,
          'DISPUTE_RAISED',
          context,
        );
      }
      await this.emit(
        tx,
        'ReconciliationDispute',
        dispute.id,
        dispute.version,
        'billing.reconciliation.dispute-raised.v1',
        context,
        metadata,
        { category: dispute.category, disputeId: dispute.id, statementId },
      );
      return toHttpJson({
        disputeId: dispute.id,
        disputeStatus: dispute.status,
        statementId,
        statementStatus: changed.status,
        statementVersion: changed.version,
      });
    });
  }

  async respondDispute(
    id: string,
    raw: {
      action: 'ACCEPT' | 'REJECT' | 'REQUEST_EVIDENCE' | 'SUBMIT_EVIDENCE';
      evidenceRefs?: readonly string[];
      expectedVersion: number;
      message: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'disputeId');
    const message = this.required(raw.message, 'message', 2000);
    const evidenceRefs = this.references(raw.evidenceRefs ?? [], 'evidenceRefs');
    const transitions: Record<string, Partial<Record<typeof raw.action, DisputeStatus>>> = {
      EVIDENCE_REQUESTED: {
        ACCEPT: 'ACCEPTED',
        REJECT: 'REJECTED',
        SUBMIT_EVIDENCE: 'OPEN',
      },
      OPEN: {
        ACCEPT: 'ACCEPTED',
        REJECT: 'REJECTED',
        REQUEST_EVIDENCE: 'EVIDENCE_REQUESTED',
      },
    };
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:dispute:${id}`}, 0))`;
      const dispute = await tx.reconciliationDispute.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!dispute)
        throw new AppError(
          'BILLING_RECONCILIATION_DISPUTE_NOT_FOUND',
          'Reconciliation dispute was not found',
          404,
        );
      const statement = await tx.reconciliationStatement.findUniqueOrThrow({
        where: { id: dispute.statementId },
      });
      await this.ensurePeriodOpen(
        tx,
        statement.periodFrom,
        statement.periodTo,
        context.tenantId,
      );
      const next = transitions[dispute.status]?.[raw.action];
      if (!next || dispute.version !== raw.expectedVersion)
        this.conflict(
          'BILLING_RECONCILIATION_DISPUTE_TRANSITION_INVALID',
          `Cannot ${raw.action} from ${dispute.status} at version ${dispute.version}`,
        );
      if (raw.action === 'SUBMIT_EVIDENCE' && !evidenceRefs.length)
        throw new AppError(
          'BILLING_RECONCILIATION_INPUT_INVALID',
          'Submitting evidence requires at least one evidence reference',
          400,
        );
      const changed = await tx.reconciliationDispute.update({
        data: {
          ...(next === 'ACCEPTED' || next === 'REJECTED'
            ? {
                resolutionNote: message,
                resolvedAt: new Date(),
                resolvedBy: context.accountId,
              }
            : {}),
          status: next,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const sequence =
        (await tx.reconciliationCommunication.count({
          where: { disputeId: id, tenantId: context.tenantId },
        })) + 1;
      await this.communication(
        tx,
        id,
        sequence,
        raw.action,
        raw.action === 'SUBMIT_EVIDENCE' ? 'PARTNER' : 'FINANCE',
        message,
        evidenceRefs,
        context,
      );
      await this.emit(
        tx,
        'ReconciliationDispute',
        id,
        changed.version,
        `billing.reconciliation.dispute-${raw.action.toLowerCase().replace('_', '-')}.v1`,
        context,
        metadata,
        { disputeId: id, statementId: dispute.statementId, status: changed.status },
      );
      return {
        disputeId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async createAdjustment(
    raw: CreateBillingAdjustmentInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const input = this.normalizeAdjustment(raw);
    return this.prisma.$transaction(async (tx) => {
      const voucher = await tx.settlementVoucher.findFirst({
        where: {
          id: input.sourceVoucherId,
          status: { in: ['APPROVED', 'RECONCILED'] },
          tenantId: context.tenantId,
        },
      });
      if (!voucher)
        this.conflict(
          'BILLING_ADJUSTMENT_SOURCE_INVALID',
          'An approved or reconciled source voucher is required',
        );
      await this.ensurePeriodOpen(
        tx,
        voucher.periodFrom,
        voucher.periodTo,
        context.tenantId,
      );
      let dispute:
        | { id: string; statementId: string; statementLineId: string | null }
        | null = null;
      if (input.disputeId) {
        dispute = await tx.reconciliationDispute.findFirst({
          select: { id: true, statementId: true, statementLineId: true },
          where: {
            id: input.disputeId,
            status: 'ACCEPTED',
            tenantId: context.tenantId,
          },
        });
        if (!dispute || dispute.statementId !== input.statementId)
          this.conflict(
            'BILLING_ADJUSTMENT_DISPUTE_INVALID',
            'Adjustment dispute must be accepted and belong to the statement',
          );
        if (dispute.statementLineId) {
          const line = await tx.reconciliationStatementLine.findFirst({
            where: {
              id: dispute.statementLineId,
              tenantId: context.tenantId,
              voucherId: voucher.id,
            },
          });
          if (!line)
            this.conflict(
              'BILLING_ADJUSTMENT_SOURCE_INVALID',
              'Adjustment source voucher must own the disputed line',
            );
        }
      }
      const adjustment = await tx.billingAdjustmentVoucher.create({
        data: {
          adjustmentNo: await businessNumber(this.prisma, 'BILLING_RECONCILIATION_ADJUSTMENT', context, metadata, `reconciliation-adjustment:${voucher.id}:${input.disputeId ?? 'manual'}:${input.adjustmentType}`),
          adjustmentType: input.adjustmentType,
          amount: input.amount,
          createdBy: context.accountId,
          currency: voucher.currency,
          direction: input.direction,
          ...(input.disputeId ? { disputeId: input.disputeId } : {}),
          reason: input.reason,
          sourceSnapshot: json({
            sourceTotalAmount: voucher.totalAmount.toString(),
            sourceVoucherNo: voucher.voucherNo,
            sourceVoucherStatus: voucher.status,
          }),
          sourceVoucherId: voucher.id,
          ...(input.statementId ? { statementId: input.statementId } : {}),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      for (const [index, allocation] of input.allocations.entries())
        await tx.billingAllocationDetail.create({
          data: {
            adjustmentId: adjustment.id,
            amount: allocation.amount,
            createdBy: context.accountId,
            currency: voucher.currency,
            lineNo: index + 1,
            targetRef: allocation.targetRef,
            targetSnapshot: json(allocation.targetSnapshot),
            targetType: allocation.targetType,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      await this.adjustmentHistory(tx, adjustment.id, 1, null, 'DRAFT', 'CREATE', context, {
        allocationCount: input.allocations.length,
      });
      await this.emit(
        tx,
        'BillingAdjustmentVoucher',
        adjustment.id,
        adjustment.version,
        'billing.adjustment.draft-created.v1',
        context,
        metadata,
        { adjustmentId: adjustment.id, sourceVoucherId: voucher.id },
      );
      return toHttpJson({
        adjustmentId: adjustment.id,
        adjustmentNo: adjustment.adjustmentNo,
        amount: adjustment.amount,
        status: adjustment.status,
        version: adjustment.version,
      });
    });
  }

  async submitAdjustment(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'adjustmentId');
    return this.prisma.$transaction(async (tx) => {
      const adjustment = await this.lockAdjustment(tx, id, context.tenantId);
      await this.ensureAdjustmentPeriodOpen(
        tx,
        adjustment.sourceVoucherId,
        context.tenantId,
      );
      this.requireAdjustment(adjustment, 'DRAFT', input.expectedVersion, 'submit');
      const changed = await tx.billingAdjustmentVoucher.update({
        data: {
          status: 'PENDING_APPROVAL',
          submittedAt: new Date(),
          submittedBy: context.accountId,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const task = await tx.billingAdjustmentApprovalTask.create({
        data: {
          adjustmentId: id,
          candidateRole: 'BILLING_ADJUSTMENT_APPROVER',
          createdBy: context.accountId,
          routeSnapshot: json({
            adjustmentType: adjustment.adjustmentType,
            amount: adjustment.amount.toString(),
            direction: adjustment.direction,
          }),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.adjustmentHistory(
        tx,
        id,
        2,
        'DRAFT',
        'PENDING_APPROVAL',
        'SUBMIT',
        context,
        { approvalTaskId: task.id },
      );
      await this.emit(
        tx,
        'BillingAdjustmentVoucher',
        id,
        changed.version,
        'billing.adjustment.approval-requested.v1',
        context,
        metadata,
        { adjustmentId: id, approvalTaskId: task.id },
      );
      return {
        adjustmentId: id,
        approvalTaskId: task.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async decideAdjustment(
    id: string,
    input: {
      decision: 'APPROVE' | 'REJECT';
      expectedAdjustmentVersion: number;
      expectedTaskVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'approvalTaskId');
    const reason = this.required(input.reason, 'reason', 2000);
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.billingAdjustmentApprovalTask.findFirst({
        where: { id, status: 'PENDING', tenantId: context.tenantId },
      });
      if (!task || task.version !== input.expectedTaskVersion)
        this.conflict(
          'BILLING_ADJUSTMENT_APPROVAL_STATE_INVALID',
          'A matching pending adjustment approval is required',
        );
      const adjustment = await this.lockAdjustment(
        tx,
        task.adjustmentId,
        context.tenantId,
      );
      await this.ensureAdjustmentPeriodOpen(
        tx,
        adjustment.sourceVoucherId,
        context.tenantId,
      );
      this.requireAdjustment(
        adjustment,
        'PENDING_APPROVAL',
        input.expectedAdjustmentVersion,
        'approve',
      );
      if (adjustment.createdBy === context.accountId)
        throw new AppError(
          'BILLING_ADJUSTMENT_MAKER_CHECKER_REQUIRED',
          'Adjustment creator cannot approve the same adjustment',
          403,
        );
      const approved = input.decision === 'APPROVE';
      await tx.billingAdjustmentApprovalTask.update({
        data: {
          decidedAt: new Date(),
          decidedBy: context.accountId,
          decisionReason: reason,
          status: approved ? 'APPROVED' : 'REJECTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const changed = await tx.billingAdjustmentVoucher.update({
        data: {
          ...(approved
            ? { approvedAt: new Date(), approvedBy: context.accountId }
            : { rejectedAt: new Date(), rejectedBy: context.accountId }),
          status: approved ? 'APPROVED' : 'REJECTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: adjustment.id },
      });
      await this.adjustmentHistory(
        tx,
        adjustment.id,
        3,
        'PENDING_APPROVAL',
        approved ? 'APPROVED' : 'REJECTED',
        approved ? 'APPROVE' : 'REJECT',
        context,
        { approvalTaskId: id, reason },
      );
      await this.emit(
        tx,
        'BillingAdjustmentVoucher',
        adjustment.id,
        changed.version,
        approved
          ? 'billing.adjustment.approved.v1'
          : 'billing.adjustment.rejected.v1',
        context,
        metadata,
        { adjustmentId: adjustment.id, approvalTaskId: id, reason },
      );
      return {
        adjustmentId: adjustment.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async postAdjustment(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'adjustmentId');
    return this.prisma.$transaction(async (tx) => {
      const adjustment = await this.lockAdjustment(tx, id, context.tenantId);
      await this.ensureAdjustmentPeriodOpen(
        tx,
        adjustment.sourceVoucherId,
        context.tenantId,
      );
      this.requireAdjustment(adjustment, 'APPROVED', input.expectedVersion, 'post');
      const allocations = await tx.billingAllocationDetail.findMany({
        where: { adjustmentId: id, tenantId: context.tenantId },
      });
      const allocated = allocations.reduce(
        (sum, allocation) => sum.plus(allocation.amount),
        new Prisma.Decimal(0),
      );
      if (!allocated.eq(adjustment.amount))
        this.conflict(
          'BILLING_ADJUSTMENT_ALLOCATION_UNBALANCED',
          'Allocation amount must equal adjustment amount',
        );
      const changed = await tx.billingAdjustmentVoucher.update({
        data: {
          postedAt: new Date(),
          postedBy: context.accountId,
          status: 'POSTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.adjustmentHistory(
        tx,
        id,
        4,
        'APPROVED',
        'POSTED',
        'POST',
        context,
        { allocatedAmount: allocated.toString() },
      );
      if (adjustment.disputeId && adjustment.statementId) {
        const dispute = await tx.reconciliationDispute.findFirst({
          where: {
            id: adjustment.disputeId,
            status: 'ACCEPTED',
            tenantId: context.tenantId,
          },
        });
        if (!dispute)
          this.conflict(
            'BILLING_ADJUSTMENT_DISPUTE_STATE_INVALID',
            'Linked dispute must remain accepted until adjustment posting',
          );
        await tx.reconciliationDispute.update({
          data: {
            resolutionNote: `Adjusted by ${adjustment.adjustmentNo}`,
            status: 'ADJUSTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: dispute.id },
        });
        const sequence =
          (await tx.reconciliationCommunication.count({
            where: { disputeId: dispute.id, tenantId: context.tenantId },
          })) + 1;
        await this.communication(
          tx,
          dispute.id,
          sequence,
          'ADJUSTMENT_POSTED',
          'FINANCE',
          `Adjustment ${adjustment.adjustmentNo} posted`,
          [],
          context,
        );
        const statement = await this.lockStatement(
          tx,
          adjustment.statementId,
          context.tenantId,
        );
        if (statement.status === 'DISPUTED') {
          const adjusted = await tx.reconciliationStatement.update({
            data: {
              status: 'ADJUSTED',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: statement.id },
          });
          await this.statementVersion(
            tx,
            adjusted,
            adjusted.version,
            'ADJUSTMENT_POSTED',
            context,
          );
        }
      }
      await this.emit(
        tx,
        'BillingAdjustmentVoucher',
        id,
        changed.version,
        'billing.adjustment.posted.v1',
        context,
        metadata,
        {
          adjustmentId: id,
          amount: changed.amount.toString(),
          direction: changed.direction,
          sourceVoucherId: changed.sourceVoucherId,
        },
      );
      return {
        adjustmentId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  private transitionStatement(
    id: string,
    expectedVersion: number,
    from: StatementStatus[],
    to: StatementStatus,
    command: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'statementId');
    return this.prisma.$transaction(async (tx) => {
      const statement = await this.lockStatement(tx, id, context.tenantId);
      await this.ensurePeriodOpen(
        tx,
        statement.periodFrom,
        statement.periodTo,
        context.tenantId,
      );
      if (!from.includes(statement.status) || statement.version !== expectedVersion)
        this.transitionConflict(command.toLowerCase(), statement.status, statement.version);
      const changed = await tx.reconciliationStatement.update({
        data: {
          ...(to === 'PUBLISHED'
            ? { publishedAt: new Date(), publishedBy: context.accountId }
            : {}),
          status: to,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.statementVersion(tx, changed, changed.version, command, context);
      await this.emit(
        tx,
        'ReconciliationStatement',
        id,
        changed.version,
        `billing.reconciliation.${to.toLowerCase()}.v1`,
        context,
        metadata,
        { statementId: id },
      );
      return { statementId: id, status: changed.status, version: changed.version };
    });
  }

  private normalizeStatement(input: CreateReconciliationStatementInput) {
    const voucherIds = [...new Set(input.voucherIds ?? [])];
    if (
      !voucherIds.length ||
      voucherIds.length !== input.voucherIds?.length ||
      voucherIds.some((id) => !isUuid(id))
    )
      throw new AppError(
        'BILLING_RECONCILIATION_INPUT_INVALID',
        'voucherIds must be a non-empty unique UUID list',
        400,
      );
    const periodFrom = this.date(input.periodFrom, 'periodFrom');
    const periodTo = this.date(input.periodTo, 'periodTo');
    if (periodTo < periodFrom)
      throw new AppError(
        'BILLING_RECONCILIATION_INPUT_INVALID',
        'Statement period is invalid',
        400,
      );
    return {
      attachmentRefs: this.references(input.attachmentRefs ?? [], 'attachmentRefs'),
      contractRef: this.required(input.contractRef, 'contractRef', 200),
      partnerSnapshot: input.partnerSnapshot ?? {},
      periodFrom,
      periodTo,
      voucherIds,
    };
  }

  private normalizeDispute(input: {
    category: string;
    description: string;
    disputedAmount: string;
    evidenceRefs?: readonly string[];
    expectedStatementVersion: number;
    raisedByType: string;
    statementLineId?: string;
  }) {
    const categories = ['DUPLICATE', 'MISSING', 'QUANTITY', 'RATE', 'SERVICE', 'TAX'];
    if (!categories.includes(input.category) || !['FINANCE', 'PARTNER'].includes(input.raisedByType))
      throw new AppError(
        'BILLING_RECONCILIATION_INPUT_INVALID',
        'Dispute category or actor type is invalid',
        400,
      );
    if (input.statementLineId) this.uuid(input.statementLineId, 'statementLineId');
    const disputedAmount = this.decimal(input.disputedAmount, 'disputedAmount');
    if (disputedAmount.lte(0))
      throw new AppError(
        'BILLING_RECONCILIATION_INPUT_INVALID',
        'disputedAmount must be positive',
        400,
      );
    return {
      category: input.category as
        | 'DUPLICATE'
        | 'MISSING'
        | 'QUANTITY'
        | 'RATE'
        | 'SERVICE'
        | 'TAX',
      description: this.required(input.description, 'description', 2000),
      disputedAmount,
      evidenceRefs: this.references(input.evidenceRefs ?? [], 'evidenceRefs'),
      expectedStatementVersion: input.expectedStatementVersion,
      raisedByType: input.raisedByType as 'FINANCE' | 'PARTNER',
      statementLineId: input.statementLineId,
    };
  }

  private normalizeAdjustment(input: CreateBillingAdjustmentInput) {
    this.uuid(input.sourceVoucherId, 'sourceVoucherId');
    if (input.statementId) this.uuid(input.statementId, 'statementId');
    if (input.disputeId) this.uuid(input.disputeId, 'disputeId');
    if (Boolean(input.statementId) !== Boolean(input.disputeId))
      throw new AppError(
        'BILLING_ADJUSTMENT_INPUT_INVALID',
        'statementId and disputeId must be supplied together',
        400,
      );
    if (
      !['ADJUSTMENT', 'CLAIM_DEDUCTION'].includes(input.adjustmentType) ||
      !['DECREASE', 'INCREASE'].includes(input.direction) ||
      !input.allocations?.length
    )
      throw new AppError(
        'BILLING_ADJUSTMENT_INPUT_INVALID',
        'Adjustment type, direction and allocations are required',
        400,
      );
    const amount = this.decimal(input.amount, 'amount');
    if (amount.lte(0))
      throw new AppError(
        'BILLING_ADJUSTMENT_INPUT_INVALID',
        'Adjustment amount must be positive',
        400,
      );
    const allocations = input.allocations.map((allocation) => {
      if (!['COST_CENTER', 'ORDER'].includes(allocation.targetType))
        throw new AppError(
          'BILLING_ADJUSTMENT_INPUT_INVALID',
          'Allocation target type is invalid',
          400,
        );
      const allocationAmount = this.decimal(allocation.amount, 'allocation.amount');
      if (allocationAmount.lte(0))
        throw new AppError(
          'BILLING_ADJUSTMENT_INPUT_INVALID',
          'Allocation amount must be positive',
          400,
        );
      return {
        amount: allocationAmount,
        targetRef: this.required(allocation.targetRef, 'allocation.targetRef', 200),
        targetSnapshot: allocation.targetSnapshot ?? {},
        targetType: allocation.targetType,
      };
    });
    const allocationTotal = allocations.reduce(
      (sum, allocation) => sum.plus(allocation.amount),
      new Prisma.Decimal(0),
    );
    if (!allocationTotal.eq(amount))
      throw new AppError(
        'BILLING_ADJUSTMENT_ALLOCATION_UNBALANCED',
        'Allocation amount must equal adjustment amount',
        400,
      );
    return {
      adjustmentType: input.adjustmentType,
      allocations,
      amount,
      direction: input.direction,
      disputeId: input.disputeId,
      reason: this.required(input.reason, 'reason', 2000),
      sourceVoucherId: input.sourceVoucherId,
      statementId: input.statementId,
    };
  }

  private async lockStatement(
    tx: Prisma.TransactionClient,
    id: string,
    tenantId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:statement:${id}`}, 0))`;
    const statement = await tx.reconciliationStatement.findFirst({
      where: { id, tenantId },
    });
    if (!statement)
      throw new AppError(
        'BILLING_RECONCILIATION_NOT_FOUND',
        'Reconciliation statement was not found',
        404,
      );
    return statement;
  }

  private async lockAdjustment(
    tx: Prisma.TransactionClient,
    id: string,
    tenantId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:adjustment:${id}`}, 0))`;
    const adjustment = await tx.billingAdjustmentVoucher.findFirst({
      where: { id, tenantId },
    });
    if (!adjustment)
      throw new AppError(
        'BILLING_ADJUSTMENT_NOT_FOUND',
        'Billing adjustment was not found',
        404,
      );
    return adjustment;
  }

  private async ensureAdjustmentPeriodOpen(
    tx: Prisma.TransactionClient,
    voucherId: string,
    tenantId: string,
  ) {
    const voucher = await tx.settlementVoucher.findFirst({
      where: { id: voucherId, tenantId },
    });
    if (!voucher)
      this.conflict(
        'BILLING_ADJUSTMENT_SOURCE_INVALID',
        'Adjustment source voucher was not found',
      );
    await this.ensurePeriodOpen(
      tx,
      voucher.periodFrom,
      voucher.periodTo,
      tenantId,
    );
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

  private requireAdjustment(
    adjustment: { status: AdjustmentStatus; version: number },
    status: AdjustmentStatus,
    version: number,
    command: string,
  ) {
    if (adjustment.status !== status || adjustment.version !== version)
      this.conflict(
        'BILLING_ADJUSTMENT_TRANSITION_INVALID',
        `Cannot ${command} from ${adjustment.status} at version ${adjustment.version}`,
      );
  }

  private statementVersion(
    tx: Prisma.TransactionClient,
    statement: {
      contractRef: string;
      currency: string;
      id: string;
      lineCount: number;
      status: StatementStatus;
      totalAmount: Prisma.Decimal;
      version: number;
      voucherCount: number;
    },
    versionNo: number,
    reason: string,
    context: TenantContext,
  ) {
    return tx.reconciliationStatementVersion.create({
      data: {
        createdBy: context.accountId,
        reason,
        snapshot: json({
          contractRef: statement.contractRef,
          currency: statement.currency,
          lineCount: statement.lineCount,
          status: statement.status,
          totalAmount: statement.totalAmount.toString(),
          voucherCount: statement.voucherCount,
        }),
        statementId: statement.id,
        statementStatus: statement.status,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
        versionNo,
      },
    });
  }

  private communication(
    tx: Prisma.TransactionClient,
    disputeId: string,
    sequence: number,
    action: string,
    actorType: string,
    message: string,
    evidenceRefs: readonly string[],
    context: TenantContext,
  ) {
    return tx.reconciliationCommunication.create({
      data: {
        action,
        actorType,
        createdBy: context.accountId,
        disputeId,
        evidenceSnapshot: json({ evidenceRefs }),
        message,
        sequence,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
  }

  private adjustmentHistory(
    tx: Prisma.TransactionClient,
    adjustmentId: string,
    sequence: number,
    fromStatus: AdjustmentStatus | null,
    toStatus: AdjustmentStatus,
    command: string,
    context: TenantContext,
    snapshot: Record<string, unknown>,
  ) {
    return tx.billingAdjustmentStatusHistory.create({
      data: {
        adjustmentId,
        command,
        createdBy: context.accountId,
        ...(fromStatus ? { fromStatus } : {}),
        sequence,
        snapshot: json(snapshot),
        tenantId: context.tenantId,
        toStatus,
        updatedBy: context.accountId,
      },
    });
  }

  private contractRefs(snapshot: Prisma.JsonValue) {
    if (!Array.isArray(snapshot)) return [];
    return snapshot.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const ref = (item as Record<string, unknown>).contractRef;
      return typeof ref === 'string' ? [ref] : [];
    });
  }

  private references(values: readonly string[], field: string) {
    const refs = [...new Set(values.map((value) => value.trim()))];
    if (refs.length !== values.length || refs.length > 20 || refs.some((ref) => !ref || ref.length > 500))
      throw new AppError(
        'BILLING_RECONCILIATION_INPUT_INVALID',
        `${field} contains invalid or duplicate references`,
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

  private transitionConflict(command: string, status: string, version: number): never {
    this.conflict(
      'BILLING_RECONCILIATION_TRANSITION_INVALID',
      `Cannot ${command} from ${status} at version ${version}`,
    );
  }

  private decimal(value: string, field: string) {
    try {
      const result = new Prisma.Decimal(value);
      if (!result.isFinite()) throw new Error('not finite');
      return result;
    } catch {
      throw new AppError(
        'BILLING_RECONCILIATION_INPUT_INVALID',
        `${field} is invalid`,
        400,
      );
    }
  }

  private date(value: string, field: string) {
    const result = new Date(value);
    if (Number.isNaN(result.getTime()))
      throw new AppError(
        'BILLING_RECONCILIATION_INPUT_INVALID',
        `${field} is invalid`,
        400,
      );
    return result;
  }

  private required(value: string, field: string, maximum: number) {
    const result = value?.trim();
    if (!result || result.length > maximum)
      throw new AppError(
        'BILLING_RECONCILIATION_INPUT_INVALID',
        `${field} is required or too long`,
        400,
      );
    return result;
  }

  private uuid(value: string, field: string) {
    if (!isUuid(value))
      throw new AppError(
        'BILLING_RECONCILIATION_INPUT_INVALID',
        `${field} is invalid`,
        400,
      );
  }

  private conflict(code: string, message: string): never {
    throw new AppError(code, message, 409);
  }
}
