import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { AttachmentReferenceFacade } from '../platform/public/attachment-reference.facade';
import { businessNumber } from '../platform/public/numbering.facade';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

@Injectable()
export class DeliveryReverseService {
  constructor(
    @Inject(AttachmentReferenceFacade)
    private readonly attachments: AttachmentReferenceFacade,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async workbench(context: TenantContext) {
    const query = {
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: 300,
      where: { tenantId: context.tenantId },
    };
    const [
      confirmations,
      variances,
      pods,
      reviews,
      claims,
      deductions,
      returns,
      shipments,
      shipmentItems,
    ] = await Promise.all([
      this.prisma.deliveryConfirmation.findMany(query),
      this.prisma.deliveryVariance.findMany(query),
      this.prisma.proofOfDelivery.findMany(query),
      this.prisma.podReview.findMany(query),
      this.prisma.claimCase.findMany(query),
      this.prisma.deductionFact.findMany(query),
      this.prisma.returnTransportOrder.findMany(query),
      this.prisma.shipment.findMany({
        ...query,
        where: {
          status: { in: ['TRACKING', 'DELIVERED', 'POD'] },
          tenantId: context.tenantId,
        },
      }),
      this.prisma.shipmentItem.findMany(query),
    ]);
    return toHttpJson({
      claims,
      confirmations,
      deductions,
      pods,
      returns,
      reviews,
      shipmentItems,
      shipments,
      variances,
    });
  }

  confirmDelivery(
    shipmentId: string,
    input: {
      arrivedAt: string;
      deliveryLocationSnapshot: Readonly<Record<string, unknown>>;
      expectedShipmentVersion: number;
      lines: readonly {
        damagedQuantityBase: string;
        deliveredQuantityBase: string;
        evidenceSnapshot: Readonly<Record<string, unknown>>;
        reason: string;
        refusedQuantityBase: string;
        shipmentItemId: string;
      }[];
      recipientName: string;
      recipientSnapshot: Readonly<Record<string, unknown>>;
      signatureSnapshot: Readonly<Record<string, unknown>>;
      signedAt: string;
      unloadingCompletedAt: string;
      unloadingStartedAt: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    const arrivedAt = this.date(input.arrivedAt);
    const unloadingStartedAt = this.date(input.unloadingStartedAt);
    const unloadingCompletedAt = this.date(input.unloadingCompletedAt);
    const signedAt = this.date(input.signedAt);
    if (
      !input.recipientName?.trim() ||
      !(
        arrivedAt <= unloadingStartedAt &&
        unloadingStartedAt <= unloadingCompletedAt &&
        unloadingCompletedAt <= signedAt
      )
    )
      this.invalid('Recipient and monotonic delivery times are required');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${shipmentId}:delivery`);
      const [shipment, items] = await Promise.all([
        tx.shipment.findFirst({
          where: {
            id: shipmentId,
            status: 'TRACKING',
            tenantId: context.tenantId,
            version: input.expectedShipmentVersion,
          },
        }),
        tx.shipmentItem.findMany({
          orderBy: { id: 'asc' },
          where: { shipmentId, tenantId: context.tenantId },
        }),
      ]);
      if (!shipment) throw this.conflict('TMS_DELIVERY_SHIPMENT_CONFLICT');
      if (
        !items.length ||
        input.lines.length !== items.length ||
        new Set(input.lines.map(({ shipmentItemId }) => shipmentItemId))
          .size !== items.length ||
        items.some(
          ({ id }) =>
            !input.lines.some(({ shipmentItemId }) => shipmentItemId === id),
        )
      )
        this.invalid('Every shipment item must be confirmed exactly once');
      const summaries: Record<string, unknown>[] = [];
      const varianceInputs: {
        damaged: Prisma.Decimal;
        delivered: Prisma.Decimal;
        difference: Prisma.Decimal;
        evidence: Readonly<Record<string, unknown>>;
        expected: Prisma.Decimal;
        itemId: string;
        reason: string;
        refused: Prisma.Decimal;
        type: 'SHORTAGE' | 'OVERAGE' | 'DAMAGE' | 'REFUSAL';
        uom: string;
      }[] = [];
      for (const item of items) {
        const line = input.lines.find(
          ({ shipmentItemId }) => shipmentItemId === item.id,
        )!;
        const delivered = this.nonNegative(line.deliveredQuantityBase);
        const refused = this.nonNegative(line.refusedQuantityBase);
        const damaged = this.nonNegative(line.damagedQuantityBase);
        if (damaged.greaterThan(delivered))
          this.invalid('Damaged quantity cannot exceed delivered quantity');
        const accounted = delivered.plus(refused);
        const difference = item.quantityBase.minus(accounted);
        summaries.push({
          accounted: accounted.toString(),
          damaged: damaged.toString(),
          delivered: delivered.toString(),
          expected: item.quantityBase.toString(),
          refused: refused.toString(),
          shipmentItemId: item.id,
        });
        const common = {
          damaged,
          delivered,
          difference,
          evidence: line.evidenceSnapshot,
          expected: item.quantityBase,
          itemId: item.id,
          reason: line.reason?.trim() || 'Delivery quantity variance',
          refused,
          uom: item.quantityBaseUom,
        };
        if (!difference.isZero())
          varianceInputs.push({
            ...common,
            type: difference.isPositive() ? 'SHORTAGE' : 'OVERAGE',
          });
        if (damaged.greaterThan(0))
          varianceInputs.push({ ...common, type: 'DAMAGE' });
        if (refused.greaterThan(0))
          varianceInputs.push({ ...common, type: 'REFUSAL' });
      }
      const id = randomUUID();
      const confirmation = await tx.deliveryConfirmation.create({
        data: {
          arrivedAt,
          confirmationNo: await businessNumber(
            this.prisma,
            'TMS_DELIVERY_CONFIRMATION',
            context,
            metadata,
            `delivery-confirmation:${shipmentId}`,
          ),
          createdBy: context.accountId,
          deliveryLocationSnapshot: json(input.deliveryLocationSnapshot),
          hasVariance: varianceInputs.length > 0,
          id,
          itemSummary: json(summaries),
          recipientName: input.recipientName.trim(),
          recipientSnapshot: json(input.recipientSnapshot),
          shipmentId,
          signatureSnapshot: json(input.signatureSnapshot),
          signedAt,
          tenantId: context.tenantId,
          unloadingCompletedAt,
          unloadingStartedAt,
          updatedBy: context.accountId,
        },
      });
      const varianceIds: string[] = [];
      for (const variance of varianceInputs) {
        const row = await tx.deliveryVariance.create({
          data: {
            baseUom: variance.uom,
            createdBy: context.accountId,
            damagedQuantityBase: variance.damaged,
            deliveredQuantityBase: variance.delivered,
            deliveryConfirmationId: confirmation.id,
            differenceQuantityBase: variance.difference,
            evidenceSnapshot: json(variance.evidence),
            expectedQuantityBase: variance.expected,
            reason: variance.reason,
            refusedQuantityBase: variance.refused,
            shipmentId,
            shipmentItemId: variance.itemId,
            tenantId: context.tenantId,
            type: variance.type,
            updatedBy: context.accountId,
          },
        });
        varianceIds.push(row.id);
      }
      const changed = await tx.shipment.update({
        data: {
          status: 'DELIVERED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: shipmentId },
      });
      const sourceRefs = await this.shipmentSources(
        tx,
        shipmentId,
        context.tenantId,
      );
      await this.emit(
        tx,
        changed.id,
        changed.version,
        'shipment.delivered.v1',
        context,
        metadata,
        {
          deliveredAt: signedAt,
          deliveryConfirmationId: confirmation.id,
          podRef: null,
          shipmentId,
          sourceRefs,
          varianceIds,
        },
        'Shipment',
      );
      if (varianceIds.length)
        await this.emit(
          tx,
          confirmation.id,
          confirmation.version,
          'shipment.delivery-variance.v1',
          context,
          metadata,
          { shipmentId, targetDomains: ['OMS', 'WMS'], varianceIds },
          'DeliveryConfirmation',
        );
      return {
        deliveryConfirmationId: confirmation.id,
        shipmentStatus: changed.status,
        shipmentVersion: changed.version,
        varianceIds,
        version: confirmation.version,
      };
    });
  }

  async submitPod(
    shipmentId: string,
    input: {
      fileObjectIds: readonly string[];
      notes?: string;
      pageCount: number;
      signatureSnapshot: Readonly<Record<string, unknown>>;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    if (!Number.isInteger(input.pageCount) || input.pageCount < 1)
      this.invalid('POD page count must be positive');
    const files = await this.attachments.inspectAvailable(
      input.fileObjectIds,
      context,
    );
    return this.prisma.$transaction(async (tx) => {
      const [shipment, confirmation] = await Promise.all([
        tx.shipment.findFirst({
          where: {
            id: shipmentId,
            status: 'DELIVERED',
            tenantId: context.tenantId,
          },
        }),
        tx.deliveryConfirmation.findUnique({
          where: {
            tenantId_shipmentId: { shipmentId, tenantId: context.tenantId },
          },
        }),
      ]);
      if (!shipment || !confirmation)
        throw new AppError(
          'TMS_POD_DELIVERY_REQUIRED',
          'Delivered shipment and confirmation are required',
          409,
        );
      const id = randomUUID();
      const pod = await tx.proofOfDelivery.create({
        data: {
          createdBy: context.accountId,
          deliveryConfirmationId: confirmation.id,
          fileReferences: json(files),
          id,
          notes: input.notes?.trim() ?? null,
          pageCount: input.pageCount,
          podNo: await businessNumber(
            this.prisma,
            'TMS_PROOF_OF_DELIVERY',
            context,
            metadata,
            `proof-of-delivery:${shipmentId}`,
          ),
          shipmentId,
          signatureSnapshot: json(input.signatureSnapshot),
          submittedBy: context.accountId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await tx.podReview.create({
        data: {
          checkSnapshot: json({
            fileCount: files.length,
            pageCount: input.pageCount,
          }),
          createdBy: context.accountId,
          decision: 'SUBMIT',
          fromStatus: 'UPLOADED',
          proofOfDeliveryId: pod.id,
          reason: 'POD metadata submitted',
          reviewedBy: context.accountId,
          tenantId: context.tenantId,
          toStatus: 'UPLOADED',
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        pod.id,
        pod.version,
        'shipment.pod-uploaded.v1',
        context,
        metadata,
        {
          fileObjectIds: files.map(({ id: fileId }) => fileId),
          podId: pod.id,
          shipmentId,
        },
        'ProofOfDelivery',
      );
      return { podId: pod.id, status: pod.status, version: pod.version };
    });
  }

  reviewPod(
    id: string,
    input: {
      checkSnapshot: {
        clarityConfirmed?: boolean;
        signatureConfirmed?: boolean;
        signedTimeConfirmed?: boolean;
        varianceAcknowledged?: boolean;
      };
      decision: 'START' | 'CONFIRM' | 'RETURN' | 'DISPUTE';
      expectedVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'podId');
    if (!input.reason?.trim()) this.invalid('POD review reason is required');
    return this.prisma.$transaction(async (tx) => {
      const pod = await tx.proofOfDelivery.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!pod || pod.version !== input.expectedVersion)
        throw this.conflict('TMS_POD_VERSION_CONFLICT');
      const next =
        input.decision === 'START' && pod.status === 'UPLOADED'
          ? 'REVIEWING'
          : input.decision === 'CONFIRM' && pod.status === 'REVIEWING'
            ? 'CONFIRMED'
            : input.decision === 'RETURN' && pod.status === 'REVIEWING'
              ? 'RETURNED'
              : input.decision === 'DISPUTE' && pod.status === 'REVIEWING'
                ? 'DISPUTED'
                : null;
      if (!next)
        throw new AppError(
          'TMS_POD_TRANSITION_INVALID',
          `Cannot ${input.decision} from ${pod.status}`,
          409,
        );
      if (
        next === 'CONFIRMED' &&
        ![
          input.checkSnapshot.clarityConfirmed,
          input.checkSnapshot.signatureConfirmed,
          input.checkSnapshot.signedTimeConfirmed,
          input.checkSnapshot.varianceAcknowledged,
        ].every((value) => value === true)
      )
        throw new AppError(
          'TMS_POD_CONFIRM_CHECK_FAILED',
          'Signature, signed time, clarity and variance checks are required',
          409,
        );
      const now = new Date();
      const changed = await tx.proofOfDelivery.update({
        data: {
          confirmedAt: next === 'CONFIRMED' ? now : pod.confirmedAt,
          disputedAt: next === 'DISPUTED' ? now : pod.disputedAt,
          returnedAt: next === 'RETURNED' ? now : pod.returnedAt,
          reviewingAt: next === 'REVIEWING' ? now : pod.reviewingAt,
          status: next,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const review = await tx.podReview.create({
        data: {
          checkSnapshot: json(input.checkSnapshot),
          createdBy: context.accountId,
          decision: input.decision,
          fromStatus: pod.status,
          proofOfDeliveryId: id,
          reason: input.reason.trim(),
          reviewedBy: context.accountId,
          tenantId: context.tenantId,
          toStatus: next,
          updatedBy: context.accountId,
        },
      });
      if (next === 'CONFIRMED') {
        const shipment = await tx.shipment.findFirst({
          where: {
            id: pod.shipmentId,
            status: 'DELIVERED',
            tenantId: context.tenantId,
          },
        });
        if (!shipment)
          throw new AppError(
            'TMS_POD_SHIPMENT_STATE_INVALID',
            'Delivered shipment is required before POD confirmation',
            409,
          );
        const updated = await tx.shipment.update({
          data: {
            status: 'POD',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: shipment.id },
        });
        const confirmation = await tx.deliveryConfirmation.findUniqueOrThrow({
          where: { id: pod.deliveryConfirmationId },
        });
        const sourceRefs = await this.shipmentSources(
          tx,
          shipment.id,
          context.tenantId,
        );
        await this.emit(
          tx,
          updated.id,
          updated.version,
          'shipment.delivered.v1',
          context,
          metadata,
          {
            deliveredAt: confirmation.signedAt,
            podRef: pod.id,
            shipmentId: shipment.id,
            sourceRefs,
            variance: confirmation.hasVariance,
          },
          'Shipment',
        );
      }
      await this.emit(
        tx,
        changed.id,
        changed.version,
        `shipment.pod-${next.toLowerCase()}.v1`,
        context,
        metadata,
        {
          podId: id,
          reviewId: review.id,
          shipmentId: pod.shipmentId,
          sourceRefs: await this.shipmentSources(
            tx,
            pod.shipmentId,
            context.tenantId,
          ),
          status: next,
        },
        'ProofOfDelivery',
      );
      return {
        podId: id,
        reviewId: review.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async supplementPod(
    id: string,
    input: {
      expectedVersion: number;
      fileObjectIds: readonly string[];
      notes?: string;
      pageCount: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'podId');
    const files = await this.attachments.inspectAvailable(
      input.fileObjectIds,
      context,
    );
    return this.prisma.$transaction(async (tx) => {
      const pod = await tx.proofOfDelivery.findFirst({
        where: {
          id,
          status: 'RETURNED',
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (!pod) throw this.conflict('TMS_POD_SUPPLEMENT_CONFLICT');
      const existing = Array.isArray(pod.fileReferences)
        ? pod.fileReferences
        : [];
      const merged = [...existing, ...files].filter(
        (file, index, rows) =>
          rows.findIndex(
            (candidate) =>
              (candidate as { id?: string }).id ===
              (file as { id?: string }).id,
          ) === index,
      );
      const changed = await tx.proofOfDelivery.update({
        data: {
          fileReferences: json(merged),
          notes: input.notes?.trim() ?? pod.notes,
          pageCount: input.pageCount,
          returnedAt: null,
          reviewingAt: null,
          status: 'UPLOADED',
          submittedAt: new Date(),
          submittedBy: context.accountId,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const review = await tx.podReview.create({
        data: {
          checkSnapshot: json({
            addedFiles: files.map(({ id: fileId }) => fileId),
          }),
          createdBy: context.accountId,
          decision: 'SUPPLEMENT',
          fromStatus: 'RETURNED',
          proofOfDeliveryId: id,
          reason: input.notes?.trim() || 'Supplemented POD files',
          reviewedBy: context.accountId,
          tenantId: context.tenantId,
          toStatus: 'UPLOADED',
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        changed.id,
        changed.version,
        'shipment.pod-supplemented.v1',
        context,
        metadata,
        { podId: id, reviewId: review.id, shipmentId: pod.shipmentId },
        'ProofOfDelivery',
      );
      return { podId: id, status: changed.status, version: changed.version };
    });
  }

  async createClaim(
    shipmentId: string,
    input: {
      claimedAmount: string;
      claimantRef: string;
      currency: string;
      deliveryVarianceId: string;
      evidenceFileObjectIds: readonly string[];
      liabilitySnapshot: Readonly<Record<string, unknown>>;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    this.uuid(input.deliveryVarianceId, 'deliveryVarianceId');
    const amount = this.positive(input.claimedAmount);
    const currency = input.currency?.trim().toUpperCase();
    if (!input.claimantRef?.trim() || !/^[A-Z]{3}$/.test(currency))
      this.invalid('Claimant and ISO currency are required');
    const evidence = await this.attachments.inspectAvailable(
      input.evidenceFileObjectIds,
      context,
    );
    return this.prisma.$transaction(async (tx) => {
      const variance = await tx.deliveryVariance.findFirst({
        where: {
          id: input.deliveryVarianceId,
          shipmentId,
          status: 'PENDING',
          tenantId: context.tenantId,
          type: { in: ['DAMAGE', 'SHORTAGE', 'REFUSAL'] },
        },
      });
      if (!variance)
        throw new AppError(
          'TMS_CLAIM_VARIANCE_INVALID',
          'Pending damage, shortage or refusal variance is required',
          409,
        );
      const id = randomUUID();
      const claim = await tx.claimCase.create({
        data: {
          claimNo: await businessNumber(
            this.prisma,
            'TMS_CLAIM_CASE',
            context,
            metadata,
            `claim:${shipmentId}:${input.deliveryVarianceId}`,
          ),
          claimedAmount: amount,
          claimantRef: input.claimantRef.trim(),
          createdBy: context.accountId,
          currency,
          deliveryVarianceId: variance.id,
          evidenceReferences: json(evidence),
          id,
          liabilitySnapshot: json(input.liabilitySnapshot),
          shipmentId,
          tenantId: context.tenantId,
          type:
            variance.type === 'DAMAGE'
              ? 'DAMAGE'
              : variance.type === 'REFUSAL'
                ? 'REFUSAL'
                : 'SHORTAGE',
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        claim.id,
        claim.version,
        'shipment.claim-opened.v1',
        context,
        metadata,
        { claimId: claim.id, shipmentId, varianceId: variance.id },
        'ClaimCase',
      );
      return {
        claimId: claim.id,
        status: claim.status,
        version: claim.version,
      };
    });
  }

  transitionClaim(
    id: string,
    input: {
      action:
        'NEGOTIATE' | 'SUBMIT' | 'APPROVE' | 'REJECT' | 'SETTLE' | 'CLOSE';
      approvalReference?: string;
      approvedAmount?: string;
      expectedVersion: number;
      negotiationSnapshot: Readonly<Record<string, unknown>>;
      responsiblePartyRef?: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'claimId');
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.claimCase.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!claim || claim.version !== input.expectedVersion)
        throw this.conflict('TMS_CLAIM_VERSION_CONFLICT');
      const transitions: Record<string, Record<string, string>> = {
        OPEN: { NEGOTIATE: 'NEGOTIATING', SUBMIT: 'PENDING_APPROVAL' },
        NEGOTIATING: { SUBMIT: 'PENDING_APPROVAL' },
        PENDING_APPROVAL: { APPROVE: 'APPROVED', REJECT: 'REJECTED' },
        APPROVED: { SETTLE: 'SETTLED' },
        SETTLED: { CLOSE: 'CLOSED' },
      };
      const next = transitions[claim.status]?.[input.action] as
        | 'NEGOTIATING'
        | 'PENDING_APPROVAL'
        | 'APPROVED'
        | 'REJECTED'
        | 'SETTLED'
        | 'CLOSED'
        | undefined;
      if (!next)
        throw new AppError(
          'TMS_CLAIM_TRANSITION_INVALID',
          `Cannot ${input.action} from ${claim.status}`,
          409,
        );
      const approvedAmount = input.approvedAmount
        ? this.nonNegative(input.approvedAmount)
        : claim.approvedAmount;
      if (
        next === 'APPROVED' &&
        (!approvedAmount ||
          approvedAmount.greaterThan(claim.claimedAmount) ||
          !input.responsiblePartyRef?.trim() ||
          !input.approvalReference?.trim())
      )
        this.invalid(
          'Approval amount, responsible party and approval reference are required',
        );
      const now = new Date();
      const changed = await tx.claimCase.update({
        data: {
          approvalReference:
            input.approvalReference?.trim() ?? claim.approvalReference,
          approvedAmount,
          approvedAt: next === 'APPROVED' ? now : claim.approvedAt,
          closedAt: next === 'CLOSED' ? now : claim.closedAt,
          negotiationSnapshot: json(input.negotiationSnapshot),
          responsiblePartyRef:
            input.responsiblePartyRef?.trim() ?? claim.responsiblePartyRef,
          settledAt: next === 'SETTLED' ? now : claim.settledAt,
          status: next,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      let deductionFactId: string | undefined;
      if (next === 'APPROVED') {
        const deduction = await tx.deductionFact.create({
          data: {
            amount: approvedAmount!,
            basisSnapshot: json({
              approvalReference: changed.approvalReference,
              claimVersion: changed.version,
              liability: changed.liabilitySnapshot,
            }),
            claimCaseId: id,
            createdBy: context.accountId,
            currency: claim.currency,
            responsiblePartyRef: changed.responsiblePartyRef!,
            shipmentId: claim.shipmentId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        deductionFactId = deduction.id;
      }
      await this.emit(
        tx,
        changed.id,
        changed.version,
        `shipment.claim-${next.toLowerCase()}.v1`,
        context,
        metadata,
        {
          claimId: id,
          deductionFactId: deductionFactId ?? null,
          shipmentId: claim.shipmentId,
          status: next,
        },
        'ClaimCase',
      );
      return {
        claimId: id,
        deductionFactId,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  createReturn(
    shipmentId: string,
    input: {
      deliveryVarianceId?: string;
      deliveryWindowTo: string;
      itemSnapshot: readonly Readonly<Record<string, unknown>>[];
      pickupWindowFrom: string;
      reason: string;
      type:
        'REFUSAL' | 'RETURNABLE_CONTAINER' | 'RETURN_GOODS' | 'POD_ORIGINAL';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    if (input.deliveryVarianceId)
      this.uuid(input.deliveryVarianceId, 'deliveryVarianceId');
    const pickup = this.date(input.pickupWindowFrom);
    const delivery = this.date(input.deliveryWindowTo);
    if (
      !input.reason?.trim() ||
      !input.itemSnapshot.length ||
      delivery <= pickup
    )
      this.invalid('Return items, reason and ordered windows are required');
    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: {
          id: shipmentId,
          status: { in: ['DELIVERED', 'POD'] },
          tenantId: context.tenantId,
        },
      });
      if (!shipment)
        throw new AppError(
          'TMS_RETURN_SHIPMENT_INVALID',
          'Delivered or POD shipment is required',
          409,
        );
      if (
        input.deliveryVarianceId &&
        !(await tx.deliveryVariance.count({
          where: {
            id: input.deliveryVarianceId,
            shipmentId,
            tenantId: context.tenantId,
          },
        }))
      )
        throw new AppError(
          'TMS_RETURN_VARIANCE_INVALID',
          'Variance does not belong to shipment',
          409,
        );
      const id = randomUUID();
      const order = await tx.transportOrder.create({
        data: {
          carrierRequirementSnapshot: {},
          chargeResponsibilitySnapshot: json({
            reason: input.reason,
            source: 'RETURN',
          }),
          createdBy: context.accountId,
          deliveryWindowFrom: delivery,
          deliveryWindowTo: new Date(delivery.getTime() + 2 * 3_600_000),
          destinationAddressSnapshot: json(shipment.originSnapshot),
          orderNo: await businessNumber(
            this.prisma,
            'TMS_RETURN_TRANSPORT_ORDER',
            context,
            metadata,
            `return-transport-order:${shipmentId}:${input.type}`,
          ),
          originAddressSnapshot: json(shipment.destinationSnapshot),
          packagingSnapshot: json({ items: input.itemSnapshot }),
          pickupWindowFrom: pickup,
          pickupWindowTo: new Date(pickup.getTime() + 2 * 3_600_000),
          prohibitedGoodsSnapshot: {},
          serviceLevel: 'RETURN',
          sourceRef: `${shipmentId}:${input.type}:${id}`,
          sourceSnapshot: json({
            originalShipmentId: shipmentId,
            returnType: input.type,
          }),
          sourceType: 'TMS_RETURN',
          tenantId: context.tenantId,
          type: 'RETURN',
          updatedBy: context.accountId,
          vehicleRequirementSnapshot: json(shipment.requirementSnapshot),
          volume: shipment.totalVolumeBase,
          volumeBase: shipment.totalVolumeBase,
          volumeUom: 'M3',
          weight: shipment.totalWeightBase,
          weightBase: shipment.totalWeightBase,
          weightUom: 'KG',
        },
      });
      const result = await tx.returnTransportOrder.create({
        data: {
          createdBy: context.accountId,
          deliveryVarianceId: input.deliveryVarianceId ?? null,
          id,
          itemSnapshot: json(input.itemSnapshot),
          originalShipmentId: shipmentId,
          reason: input.reason.trim(),
          relationshipSnapshot: json({
            originalShipmentNo: shipment.shipmentNo,
            transportOrderNo: order.orderNo,
          }),
          returnNo: await businessNumber(
            this.prisma,
            'TMS_RETURN_ORDER',
            context,
            metadata,
            `return-order:${shipmentId}:${input.type}`,
          ),
          tenantId: context.tenantId,
          transportOrderId: order.id,
          type: input.type,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        result.id,
        result.version,
        'shipment.return-requested.v1',
        context,
        metadata,
        {
          originalShipmentId: shipmentId,
          returnTransportOrderId: result.id,
          transportOrderId: order.id,
          type: input.type,
        },
        'ReturnTransportOrder',
      );
      return {
        returnTransportOrderId: result.id,
        status: result.status,
        transportOrderId: order.id,
        transportOrderStatus: order.status,
        version: result.version,
      };
    });
  }

  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
  private async shipmentSources(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    tenantId: string,
  ) {
    const items = await tx.shipmentItem.findMany({
      distinct: ['transportOrderId'],
      select: { transportOrderId: true },
      where: { shipmentId, tenantId },
    });
    if (!items.length) return [];
    const orders = await tx.transportOrder.findMany({
      select: { orderNo: true, sourceRef: true },
      where: {
        id: { in: items.map(({ transportOrderId }) => transportOrderId) },
        tenantId,
      },
    });
    return orders.map((order) => ({
      sourceRef: order.sourceRef,
      transportOrderNo: order.orderNo,
    }));
  }
  private nonNegative(value: unknown) {
    const result = this.decimal(value);
    if (result.isNegative()) this.invalid('Quantity cannot be negative');
    return result;
  }
  private positive(value: unknown) {
    const result = this.decimal(value);
    if (!result.isPositive()) this.invalid('Amount must be positive');
    return result;
  }
  private decimal(value: unknown) {
    try {
      const result = new Prisma.Decimal(String(value));
      if (!result.isFinite()) throw new Error();
      return result;
    } catch {
      this.invalid('Decimal value is invalid');
    }
  }
  private date(value: string) {
    const result = new Date(value);
    if (!value || Number.isNaN(result.getTime()))
      this.invalid('Date is invalid');
    return result;
  }
  private uuid(value: string, field: string) {
    if (!isUuid(value)) this.invalid(`${field} is invalid`);
  }
  private invalid(message: string): never {
    throw new AppError('TMS_DELIVERY_INPUT_INVALID', message, 400);
  }
  private conflict(code: string) {
    return new AppError(code, 'Resource version or state changed', 409, {
      retryable: true,
    });
  }
  private async emit(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: Prisma.InputJsonObject,
    aggregateType = 'Shipment',
  ) {
    await Promise.all([
      tx.platformAuditLog.create({
        data: {
          action: eventName,
          after: payload,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: id,
          resourceType: aggregateType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType,
          aggregateVersion: version,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          partitionKey: id,
          payload: { ...payload, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
}
