import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type CapacityReservationStatus,
  type CapacitySourceType,
  type PlanApprovalDecision,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
interface ReserveInput {
  capacityPoolId: string;
  expectedPoolVersion: number;
  expiresAt: string;
  shipmentId: string;
}
interface TenderInput {
  carrierSnapshot: Readonly<Record<string, unknown>>;
  currency: string;
  expiresAt: string;
  priceAmount: string;
  requirementSnapshot: Readonly<Record<string, unknown>>;
}

@Injectable()
export class CapacityTenderService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async workbench(context: TenantContext) {
    const query = {
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: 200,
      where: { tenantId: context.tenantId },
    };
    const [
      capacityPools,
      reservations,
      approvals,
      tenders,
      quoteRequests,
      bids,
      awards,
      retenderCases,
      subcontracts,
      shipments,
      plans,
    ] = await Promise.all([
      this.prisma.capacityPool.findMany(query),
      this.prisma.capacityReservation.findMany(query),
      this.prisma.transportPlanApproval.findMany(query),
      this.prisma.carrierTender.findMany(query),
      this.prisma.quoteRequest.findMany(query),
      this.prisma.carrierBid.findMany(query),
      this.prisma.awardDecision.findMany(query),
      this.prisma.retenderCase.findMany(query),
      this.prisma.subcontractAssignment.findMany(query),
      this.prisma.shipment.findMany(query),
      this.prisma.consolidationPlan.findMany(query),
    ]);
    return toHttpJson({
      approvals,
      awards,
      bids,
      capacityPools,
      plans,
      quoteRequests,
      reservations,
      retenderCases,
      shipments,
      subcontracts,
      tenders,
    });
  }

  createCapacityPool(
    input: {
      calendarSnapshot: Readonly<Record<string, unknown>>;
      carrierRef: string;
      carrierSnapshot: Readonly<Record<string, unknown>>;
      qualificationSnapshot: Readonly<Record<string, unknown>>;
      regionCode: string;
      serviceDate: string;
      sourceType: CapacitySourceType;
      totalPallets: string;
      totalVolumeBase: string;
      totalWeightBase: string;
      vehicleType: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !input.carrierRef?.trim() ||
      !input.regionCode?.trim() ||
      !input.vehicleType?.trim() ||
      !['OWN_FLEET', 'CONTRACT', 'TEMPORARY'].includes(input.sourceType)
    )
      this.invalid('Capacity carrier, region, vehicle and source are required');
    const serviceDate = new Date(`${input.serviceDate}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate) ||
      Number.isNaN(serviceDate.getTime())
    )
      this.invalid('Service date is invalid');
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const pool = await tx.capacityPool.create({
        data: {
          calendarSnapshot: json(input.calendarSnapshot),
          carrierRef: input.carrierRef.trim(),
          carrierSnapshot: json(input.carrierSnapshot),
          createdBy: context.accountId,
          id,
          poolNo: `CAP-${Date.now()}-${id.slice(0, 6)}`,
          qualificationSnapshot: json(input.qualificationSnapshot),
          regionCode: input.regionCode.trim().toUpperCase(),
          serviceDate,
          sourceType: input.sourceType,
          tenantId: context.tenantId,
          totalPallets: this.nonNegative(input.totalPallets),
          totalVolumeBase: this.positive(input.totalVolumeBase),
          totalWeightBase: this.positive(input.totalWeightBase),
          updatedBy: context.accountId,
          vehicleType: input.vehicleType.trim().toUpperCase(),
        },
      });
      await this.emit(
        tx,
        pool.id,
        pool.version,
        'tms.capacity-pool-created.v1',
        context,
        metadata,
        { capacityPoolId: pool.id, carrierRef: pool.carrierRef },
      );
      return {
        capacityPoolId: pool.id,
        status: pool.status,
        version: pool.version,
      };
    });
  }

  reserveCapacity(
    input: ReserveInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await this.reserve(tx, input, context);
      await this.emit(
        tx,
        reservation.id,
        reservation.version,
        'tms.capacity-reserved.v1',
        context,
        metadata,
        {
          capacityPoolId: reservation.capacityPoolId,
          capacityReservationId: reservation.id,
          shipmentId: reservation.shipmentId,
        },
      );
      return {
        capacityReservationId: reservation.id,
        status: reservation.status,
        version: reservation.version,
      };
    });
  }

  releaseCapacity(
    id: string,
    input: { expectedVersion: number; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'capacityReservationId');
    if (!input.reason?.trim()) this.invalid('Release reason is required');
    return this.prisma.$transaction(async (tx) => {
      const reservation = await this.release(
        tx,
        id,
        input.expectedVersion,
        input.reason,
        context,
      );
      await this.emit(
        tx,
        reservation.id,
        reservation.version,
        'tms.capacity-released.v1',
        context,
        metadata,
        { capacityReservationId: reservation.id, reason: input.reason },
      );
      return {
        capacityReservationId: reservation.id,
        status: reservation.status,
        version: reservation.version,
      };
    });
  }

  async expireReservations(context: TenantContext, metadata: CommandMetadata) {
    const expired = await this.prisma.capacityReservation.findMany({
      orderBy: { expiresAt: 'asc' },
      take: 200,
      where: {
        expiresAt: { lte: new Date() },
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    let expiredCount = 0;
    for (const reservation of expired) {
      try {
        const changed = await this.prisma.$transaction(async (tx) => {
          const activeTender = await tx.carrierTender.count({
            where: {
              capacityReservationId: reservation.id,
              status: { in: ['SENT', 'QUESTIONED', 'ACCEPTED'] },
              tenantId: context.tenantId,
            },
          });
          if (activeTender) return false;
          const released = await this.release(
            tx,
            reservation.id,
            reservation.version,
            'CAPACITY_RESERVATION_EXPIRED',
            context,
            false,
            'EXPIRED',
          );
          await this.emit(
            tx,
            released.id,
            released.version,
            'tms.capacity-reservation-expired.v1',
            context,
            metadata,
            {
              capacityPoolId: released.capacityPoolId,
              capacityReservationId: released.id,
              shipmentId: released.shipmentId,
            },
          );
          return true;
        });
        if (changed) expiredCount += 1;
      } catch (caught) {
        if (!(caught instanceof AppError) || caught.statusCode !== 409)
          throw caught;
      }
    }
    return { expiredCount, scannedCount: expired.length };
  }

  approvePlan(
    planId: string,
    input: {
      costAmount: string;
      currency: string;
      decision: PlanApprovalDecision;
      expectedVersion: number;
      qualificationSnapshot: Readonly<Record<string, unknown>>;
      reason: string;
      reservations?: readonly ReserveInput[];
      riskSnapshot: Readonly<Record<string, unknown>>;
      variancePercentage: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(planId, 'consolidationPlanId');
    if (!input.reason?.trim()) this.invalid('Approval reason is required');
    const cost = this.nonNegative(input.costAmount);
    const variance = this.decimal(input.variancePercentage);
    const currency = this.currency(input.currency);
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.consolidationPlan.findFirst({
        where: { id: planId, tenantId: context.tenantId },
      });
      if (
        !plan ||
        plan.status !== 'PUBLISHED' ||
        plan.version !== input.expectedVersion
      )
        throw this.conflict('TMS_PLAN_APPROVAL_CONFLICT');
      const shipments = await tx.shipment.findMany({
        where: {
          consolidationPlanId: plan.id,
          status: 'PLANNED',
          tenantId: context.tenantId,
        },
      });
      if (!shipments.length)
        throw new AppError(
          'TMS_PLAN_SHIPMENTS_INVALID',
          'Published plan has no planned shipments',
          409,
        );
      if (input.decision === 'APPROVE') {
        if (
          record(input.riskSnapshot).overloaded === true ||
          record(input.qualificationSnapshot).qualified !== true
        )
          throw new AppError(
            'TMS_PLAN_APPROVAL_RISK_BLOCKED',
            'Overload or qualification risk blocks approval',
            409,
          );
        const reservations = input.reservations ?? [];
        if (
          reservations.length !== shipments.length ||
          new Set(reservations.map(({ shipmentId }) => shipmentId)).size !==
            shipments.length
        )
          throw new AppError(
            'TMS_PLAN_CAPACITY_REQUIRED',
            'Every shipment requires one capacity reservation',
            409,
          );
        for (const reserveInput of reservations)
          if (!shipments.some(({ id }) => id === reserveInput.shipmentId))
            throw new AppError(
              'TMS_PLAN_CAPACITY_MISMATCH',
              'Capacity reservation shipment is outside the plan',
              409,
            );
          else await this.reserve(tx, reserveInput, context, ['PLANNED']);
      }
      const approval = await tx.transportPlanApproval.create({
        data: {
          consolidationPlanId: plan.id,
          costAmount: cost,
          createdBy: context.accountId,
          currency,
          decidedBy: context.accountId,
          decision: input.decision,
          planVersion: plan.version,
          qualificationSnapshot: json(input.qualificationSnapshot),
          reason: input.reason.trim(),
          riskSnapshot: json(input.riskSnapshot),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          variancePercentage: variance,
        },
      });
      const target = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const changed = await tx.consolidationPlan.update({
        data: {
          status: target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: plan.id },
      });
      await tx.shipment.updateMany({
        data: {
          status: target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          consolidationPlanId: plan.id,
          status: 'PLANNED',
          tenantId: context.tenantId,
        },
      });
      await this.emit(
        tx,
        plan.id,
        changed.version,
        `tms.transport-plan-${target.toLowerCase()}.v1`,
        context,
        metadata,
        {
          approvalId: approval.id,
          consolidationPlanId: plan.id,
          decision: input.decision,
        },
      );
      return {
        approvalId: approval.id,
        consolidationPlanId: plan.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  createTender(
    shipmentId: string,
    reservationId: string,
    input: TenderInput & { previousTenderId?: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    this.uuid(reservationId, 'capacityReservationId');
    return this.prisma.$transaction(async (tx) => {
      const result = await this.tender(
        tx,
        shipmentId,
        reservationId,
        input,
        context,
      );
      await this.emit(
        tx,
        shipmentId,
        result.shipmentVersion,
        'shipment.tendered.v1',
        context,
        metadata,
        {
          carrier: result.tender.carrierRef,
          expiresAt: result.tender.expiresAt.toISOString(),
          price: {
            amount: result.tender.priceAmount.toString(),
            currency: result.tender.currency,
          },
          shipmentId,
          tenderId: result.tender.id,
        },
      );
      return {
        carrierTenderId: result.tender.id,
        shipmentStatus: 'TENDERED' as const,
        status: result.tender.status,
        version: result.tender.version,
      };
    });
  }

  respondTender(
    id: string,
    input: {
      decision: 'ACCEPT' | 'REJECT' | 'QUESTION';
      expectedVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'carrierTenderId');
    if (!input.reason?.trim())
      this.invalid('Tender response reason is required');
    return this.prisma.$transaction(async (tx) => {
      const tender = await tx.carrierTender.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !tender ||
        !['SENT', 'QUESTIONED'].includes(tender.status) ||
        tender.version !== input.expectedVersion
      )
        throw this.conflict('TMS_TENDER_CONFLICT');
      if (tender.expiresAt <= new Date())
        throw new AppError(
          'TMS_TENDER_EXPIRED',
          'Tender response window expired',
          409,
        );
      const target =
        input.decision === 'ACCEPT'
          ? 'ACCEPTED'
          : input.decision === 'REJECT'
            ? 'REJECTED'
            : 'QUESTIONED';
      const changed = await tx.carrierTender.update({
        data: {
          respondedAt: new Date(),
          responseReason: input.reason.trim(),
          status: target,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: tender.id },
      });
      let shipmentStatus: 'TENDERED' | 'ACCEPTED' | 'APPROVED' = 'TENDERED';
      if (target === 'ACCEPTED') {
        const consumed = await tx.capacityReservation.updateMany({
          data: {
            consumedAt: new Date(),
            status: 'CONSUMED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            id: tender.capacityReservationId,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        if (!consumed.count)
          throw this.conflict('TMS_CAPACITY_RESERVATION_CONFLICT');
        await tx.shipment.updateMany({
          data: {
            status: 'ACCEPTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            id: tender.shipmentId,
            status: 'TENDERED',
            tenantId: context.tenantId,
          },
        });
        shipmentStatus = 'ACCEPTED';
      } else if (target === 'REJECTED') {
        await this.release(
          tx,
          tender.capacityReservationId,
          undefined,
          `TENDER_${target}`,
          context,
          true,
        );
        await tx.shipment.updateMany({
          data: {
            status: 'APPROVED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            id: tender.shipmentId,
            status: 'TENDERED',
            tenantId: context.tenantId,
          },
        });
        shipmentStatus = 'APPROVED';
        await tx.retenderCase.create({
          data: {
            createdBy: context.accountId,
            currency: tender.currency,
            originalPriceAmount: tender.priceAmount,
            originalTenderId: tender.id,
            reason: input.reason.trim(),
            reasonCode: 'CARRIER_REJECTED',
            shipmentId: tender.shipmentId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      await this.emit(
        tx,
        tender.shipmentId,
        changed.version,
        `tms.tender-${target.toLowerCase()}.v1`,
        context,
        metadata,
        { carrierTenderId: tender.id, shipmentId: tender.shipmentId },
      );
      return {
        carrierTenderId: tender.id,
        shipmentStatus,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  revokeTender(
    id: string,
    input: { expectedVersion: number; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'carrierTenderId');
    if (!input.reason?.trim()) this.invalid('Revoke reason is required');
    return this.prisma.$transaction(async (tx) => {
      const tender = await tx.carrierTender.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !tender ||
        !['SENT', 'QUESTIONED', 'ACCEPTED'].includes(tender.status) ||
        tender.version !== input.expectedVersion
      )
        throw this.conflict('TMS_TENDER_REVOKE_CONFLICT');
      const changed = await tx.carrierTender.update({
        data: {
          revokeReason: input.reason.trim(),
          revokedAt: new Date(),
          status: 'REVOKED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: tender.id },
      });
      await this.release(
        tx,
        tender.capacityReservationId,
        undefined,
        'TENDER_REVOKED',
        context,
        true,
      );
      await tx.shipment.updateMany({
        data: {
          status: 'APPROVED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          id: tender.shipmentId,
          status: { in: ['TENDERED', 'ACCEPTED'] },
          tenantId: context.tenantId,
        },
      });
      await tx.retenderCase.create({
        data: {
          createdBy: context.accountId,
          currency: tender.currency,
          originalPriceAmount: tender.priceAmount,
          originalTenderId: tender.id,
          reason: input.reason.trim(),
          reasonCode: 'EXPLICIT_REVOKE',
          shipmentId: tender.shipmentId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        tender.shipmentId,
        changed.version,
        'tms.tender-revoked.v1',
        context,
        metadata,
        { carrierTenderId: tender.id, shipmentId: tender.shipmentId },
      );
      return {
        carrierTenderId: tender.id,
        shipmentStatus: 'APPROVED' as const,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async expireTenders(context: TenantContext, metadata: CommandMetadata) {
    const expired = await this.prisma.carrierTender.findMany({
      orderBy: { expiresAt: 'asc' },
      take: 200,
      where: {
        expiresAt: { lte: new Date() },
        status: { in: ['SENT', 'QUESTIONED'] },
        tenantId: context.tenantId,
      },
    });
    let expiredCount = 0;
    for (const tender of expired) {
      const changed = await this.prisma.$transaction(async (tx) => {
        const update = await tx.carrierTender.updateMany({
          data: {
            respondedAt: new Date(),
            responseReason: 'TENDER_RESPONSE_TIMEOUT',
            status: 'EXPIRED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            id: tender.id,
            status: { in: ['SENT', 'QUESTIONED'] },
            tenantId: context.tenantId,
            version: tender.version,
          },
        });
        if (!update.count) return false;
        await this.release(
          tx,
          tender.capacityReservationId,
          undefined,
          'TENDER_EXPIRED',
          context,
          true,
        );
        await tx.shipment.updateMany({
          data: {
            status: 'APPROVED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            id: tender.shipmentId,
            status: 'TENDERED',
            tenantId: context.tenantId,
          },
        });
        const retenderCase = await tx.retenderCase.create({
          data: {
            createdBy: context.accountId,
            currency: tender.currency,
            originalPriceAmount: tender.priceAmount,
            originalTenderId: tender.id,
            reason: 'Tender response window expired',
            reasonCode: 'TENDER_EXPIRED',
            shipmentId: tender.shipmentId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.emit(
          tx,
          tender.shipmentId,
          tender.version + 1,
          'tms.tender-expired.v1',
          context,
          metadata,
          {
            carrierTenderId: tender.id,
            retenderCaseId: retenderCase.id,
            shipmentId: tender.shipmentId,
          },
        );
        return true;
      });
      if (changed) expiredCount += 1;
    }
    return { expiredCount, scannedCount: expired.length };
  }

  createQuoteRequest(
    shipmentId: string,
    input: {
      candidateCarriers: readonly string[];
      deadlineAt: string;
      requestType: 'QUOTE' | 'BID';
      requirementSnapshot: Readonly<Record<string, unknown>>;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    const deadlineAt = this.date(input.deadlineAt);
    if (deadlineAt <= new Date() || !input.candidateCarriers.length)
      this.invalid('Future deadline and candidate carriers are required');
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: {
          id: shipmentId,
          status: 'APPROVED',
          tenantId: context.tenantId,
        },
      });
      if (!shipment)
        throw new AppError(
          'TMS_QUOTE_SHIPMENT_INVALID',
          'Approved shipment is required',
          409,
        );
      const request = await tx.quoteRequest.create({
        data: {
          candidateCarriers: json([
            ...new Set(
              input.candidateCarriers
                .map((value) => value.trim())
                .filter(Boolean),
            ),
          ]),
          createdBy: context.accountId,
          deadlineAt,
          id,
          requestNo: `RFQ-${Date.now()}-${id.slice(0, 6)}`,
          requestType: input.requestType,
          requirementSnapshot: json(input.requirementSnapshot),
          shipmentId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        shipmentId,
        request.version,
        'tms.quote-requested.v1',
        context,
        metadata,
        { quoteRequestId: request.id, shipmentId },
      );
      return {
        quoteRequestId: request.id,
        status: request.status,
        version: request.version,
      };
    });
  }

  submitBid(
    requestId: string,
    input: {
      carrierRef: string;
      carrierSnapshot: Readonly<Record<string, unknown>>;
      conditions: Readonly<Record<string, unknown>>;
      currency: string;
      priceAmount: string;
      promisedAt: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(requestId, 'quoteRequestId');
    const promisedAt = this.date(input.promisedAt);
    const price = this.nonNegative(input.priceAmount);
    const currency = this.currency(input.currency);
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.quoteRequest.findFirst({
        where: { id: requestId, status: 'OPEN', tenantId: context.tenantId },
      });
      if (!request || request.deadlineAt <= new Date())
        throw new AppError('TMS_QUOTE_CLOSED', 'Quote request is closed', 409);
      const candidates = Array.isArray(request.candidateCarriers)
        ? request.candidateCarriers.map(String)
        : [];
      if (!candidates.includes(input.carrierRef))
        throw new AppError(
          'TMS_BID_CARRIER_NOT_INVITED',
          'Carrier is not invited',
          403,
        );
      const bid = await tx.carrierBid.create({
        data: {
          carrierRef: input.carrierRef,
          carrierSnapshot: json(input.carrierSnapshot),
          conditions: json(input.conditions),
          createdBy: context.accountId,
          currency,
          priceAmount: price,
          promisedAt,
          quoteRequestId: request.id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        request.shipmentId,
        bid.version,
        'tms.carrier-bid-submitted.v1',
        context,
        metadata,
        { carrierBidId: bid.id, quoteRequestId: request.id },
      );
      return { carrierBidId: bid.id, status: bid.status, version: bid.version };
    });
  }

  recommendAward(
    requestId: string,
    input: {
      expectedVersion: number;
      priceWeight: number;
      serviceWeight: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(requestId, 'quoteRequestId');
    if (
      ![input.priceWeight, input.serviceWeight].every(
        (value) => Number.isFinite(value) && value >= 0,
      ) ||
      input.priceWeight + input.serviceWeight <= 0
    )
      this.invalid('Award weights are invalid');
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.quoteRequest.findFirst({
        where: { id: requestId, tenantId: context.tenantId },
      });
      if (
        !request ||
        request.status !== 'OPEN' ||
        request.version !== input.expectedVersion
      )
        throw this.conflict('TMS_QUOTE_CONFLICT');
      const bids = await tx.carrierBid.findMany({
        where: {
          quoteRequestId: request.id,
          status: 'SUBMITTED',
          tenantId: context.tenantId,
        },
      });
      if (!bids.length)
        throw new AppError('TMS_AWARD_NO_BIDS', 'No submitted bids', 409);
      const minPrice = Prisma.Decimal.min(
        ...bids.map(({ priceAmount }) => priceAmount),
      );
      const now = Date.now();
      const scored = bids
        .map((bid) => {
          const priceScore = minPrice.div(bid.priceAmount).mul(100);
          const hours = Math.max(
            0,
            (bid.promisedAt.getTime() - now) / 3_600_000,
          );
          const serviceScore = new Prisma.Decimal(Math.max(0, 100 - hours));
          const score = priceScore
            .mul(input.priceWeight)
            .add(serviceScore.mul(input.serviceWeight))
            .div(input.priceWeight + input.serviceWeight);
          return { bid, priceScore, score, serviceScore };
        })
        .sort((a, b) => b.score.comparedTo(a.score));
      for (const row of scored)
        await tx.carrierBid.update({
          data: {
            score: row.score,
            scoreBreakdown: json({
              priceScore: row.priceScore.toString(),
              serviceScore: row.serviceScore.toString(),
              weights: input,
            }),
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: row.bid.id },
        });
      const decision = await tx.awardDecision.create({
        data: {
          carrierBidId: scored[0]!.bid.id,
          createdBy: context.accountId,
          quoteRequestId: request.id,
          reason: 'RULE_RECOMMENDED_BEST_SCORE',
          recommendationSnapshot: json({
            candidates: scored.map(({ bid, score }) => ({
              bidId: bid.id,
              score: score.toString(),
            })),
            weights: input,
          }),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const closed = await tx.quoteRequest.update({
        data: {
          closedAt: new Date(),
          status: 'CLOSED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: request.id },
      });
      await this.emit(
        tx,
        request.shipmentId,
        closed.version,
        'tms.award-recommended.v1',
        context,
        metadata,
        {
          awardDecisionId: decision.id,
          carrierBidId: decision.carrierBidId,
          quoteRequestId: request.id,
        },
      );
      return {
        awardDecisionId: decision.id,
        carrierBidId: decision.carrierBidId,
        status: decision.status,
        version: decision.version,
      };
    });
  }

  decideAward(
    id: string,
    input: {
      capacityPoolId?: string;
      decision: 'APPROVE' | 'REJECT';
      expectedPoolVersion?: number;
      expectedVersion: number;
      expiresAt?: string;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'awardDecisionId');
    if (!input.reason?.trim())
      this.invalid('Award decision reason is required');
    return this.prisma.$transaction(async (tx) => {
      const decision = await tx.awardDecision.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !decision ||
        decision.status !== 'PROPOSED' ||
        decision.version !== input.expectedVersion
      )
        throw this.conflict('TMS_AWARD_CONFLICT');
      const request = await tx.quoteRequest.findUniqueOrThrow({
        where: { id: decision.quoteRequestId },
      });
      const bid = await tx.carrierBid.findUniqueOrThrow({
        where: { id: decision.carrierBidId },
      });
      if (input.decision === 'REJECT') {
        const rejected = await tx.awardDecision.update({
          data: {
            decidedAt: new Date(),
            decidedBy: context.accountId,
            reason: input.reason.trim(),
            status: 'REJECTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await this.emit(
          tx,
          request.shipmentId,
          rejected.version,
          'tms.award-rejected.v1',
          context,
          metadata,
          { awardDecisionId: id },
        );
        return {
          awardDecisionId: id,
          status: rejected.status,
          version: rejected.version,
        };
      }
      if (
        !input.capacityPoolId ||
        input.expectedPoolVersion === undefined ||
        !input.expiresAt
      )
        this.invalid(
          'Approved award requires capacity pool, version and expiry',
        );
      const reservation = await this.reserve(
        tx,
        {
          capacityPoolId: input.capacityPoolId,
          expectedPoolVersion: input.expectedPoolVersion,
          expiresAt: input.expiresAt,
          shipmentId: request.shipmentId,
        },
        context,
      );
      const result = await this.tender(
        tx,
        request.shipmentId,
        reservation.id,
        {
          carrierSnapshot: record(bid.carrierSnapshot),
          currency: bid.currency,
          expiresAt: input.expiresAt,
          priceAmount: bid.priceAmount.toString(),
          requirementSnapshot: record(request.requirementSnapshot),
        },
        context,
      );
      const approved = await tx.awardDecision.update({
        data: {
          capacityReservationId: reservation.id,
          decidedAt: new Date(),
          decidedBy: context.accountId,
          reason: input.reason.trim(),
          status: 'APPROVED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await Promise.all([
        tx.quoteRequest.update({
          data: {
            status: 'AWARDED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: request.id },
        }),
        tx.carrierBid.update({
          data: {
            status: 'AWARDED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: bid.id },
        }),
        tx.carrierBid.updateMany({
          data: {
            status: 'REJECTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            id: { not: bid.id },
            quoteRequestId: request.id,
            status: 'SUBMITTED',
          },
        }),
      ]);
      await this.emit(
        tx,
        request.shipmentId,
        approved.version,
        'shipment.tendered.v1',
        context,
        metadata,
        {
          awardDecisionId: approved.id,
          carrier: bid.carrierRef,
          shipmentId: request.shipmentId,
          tenderId: result.tender.id,
        },
      );
      return {
        awardDecisionId: id,
        carrierTenderId: result.tender.id,
        status: approved.status,
        version: approved.version,
      };
    });
  }

  retender(
    caseId: string,
    input: ReserveInput & TenderInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(caseId, 'retenderCaseId');
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.retenderCase.findFirst({
        where: { id: caseId, status: 'OPEN', tenantId: context.tenantId },
      });
      if (!target) throw this.conflict('TMS_RETENDER_CASE_CONFLICT');
      if (input.shipmentId !== target.shipmentId)
        throw new AppError(
          'TMS_RETENDER_SHIPMENT_MISMATCH',
          'Replacement shipment must match the retender case',
          409,
        );
      const reservation = await this.reserve(tx, input, context);
      const result = await this.tender(
        tx,
        target.shipmentId,
        reservation.id,
        { ...input, previousTenderId: target.originalTenderId },
        context,
      );
      const price = this.nonNegative(input.priceAmount);
      const changed = await tx.retenderCase.update({
        data: {
          escalationRequired: price
            .sub(target.originalPriceAmount)
            .abs()
            .greaterThan(target.originalPriceAmount.mul('0.2')),
          priceDifference: price.sub(target.originalPriceAmount),
          replacementPriceAmount: price,
          replacementTenderId: result.tender.id,
          resolvedAt: new Date(),
          status: 'RESOLVED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: target.id },
      });
      await this.emit(
        tx,
        target.shipmentId,
        changed.version,
        'tms.shipment-retendered.v1',
        context,
        metadata,
        {
          replacementTenderId: result.tender.id,
          retenderCaseId: target.id,
          shipmentId: target.shipmentId,
        },
      );
      return {
        carrierTenderId: result.tender.id,
        retenderCaseId: target.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  createSubcontract(
    shipmentId: string,
    input: {
      actualCarrierRef: string;
      complianceSnapshot: Readonly<Record<string, unknown>>;
      downstreamCarrierRef: string;
      feeLayerSnapshot: Readonly<Record<string, unknown>>;
      parentTenderId: string;
      responsibilityChain: readonly Readonly<Record<string, unknown>>[];
      upstreamCarrierRef: string;
      visibilityScope: Readonly<Record<string, unknown>>;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    this.uuid(input.parentTenderId, 'parentTenderId');
    if (
      input.upstreamCarrierRef === input.downstreamCarrierRef ||
      record(input.complianceSnapshot).qualified !== true ||
      input.responsibilityChain.length < 2
    )
      this.invalid('Qualified distinct subcontract chain is required');
    return this.prisma.$transaction(async (tx) => {
      const tender = await tx.carrierTender.findFirst({
        where: {
          id: input.parentTenderId,
          shipmentId,
          status: 'ACCEPTED',
          tenantId: context.tenantId,
        },
      });
      if (!tender || tender.carrierRef !== input.upstreamCarrierRef)
        throw new AppError(
          'TMS_SUBCONTRACT_PARENT_INVALID',
          'Accepted upstream tender is required',
          409,
        );
      const row = await tx.subcontractAssignment.create({
        data: {
          actualCarrierRef: input.actualCarrierRef,
          complianceSnapshot: json(input.complianceSnapshot),
          createdBy: context.accountId,
          downstreamCarrierRef: input.downstreamCarrierRef,
          feeLayerSnapshot: json(input.feeLayerSnapshot),
          parentTenderId: tender.id,
          responsibilityChain: json(input.responsibilityChain),
          shipmentId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          upstreamCarrierRef: input.upstreamCarrierRef,
          visibilityScope: json(input.visibilityScope),
        },
      });
      await this.emit(
        tx,
        shipmentId,
        row.version,
        'tms.subcontract-proposed.v1',
        context,
        metadata,
        { shipmentId, subcontractAssignmentId: row.id },
      );
      return {
        status: row.status,
        subcontractAssignmentId: row.id,
        version: row.version,
      };
    });
  }

  respondSubcontract(
    id: string,
    input: {
      decision: 'ACCEPT' | 'REJECT';
      expectedVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'subcontractAssignmentId');
    if (!input.reason?.trim())
      this.invalid('Subcontract response reason is required');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.subcontractAssignment.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !row ||
        row.status !== 'PROPOSED' ||
        row.version !== input.expectedVersion
      )
        throw this.conflict('TMS_SUBCONTRACT_CONFLICT');
      const status = input.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
      const changed = await tx.subcontractAssignment.update({
        data: {
          respondedAt: new Date(),
          responseReason: input.reason.trim(),
          status,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        row.shipmentId,
        changed.version,
        `tms.subcontract-${status.toLowerCase()}.v1`,
        context,
        metadata,
        { shipmentId: row.shipmentId, subcontractAssignmentId: row.id },
      );
      return {
        status: changed.status,
        subcontractAssignmentId: row.id,
        version: changed.version,
      };
    });
  }

  private async reserve(
    tx: Prisma.TransactionClient,
    input: ReserveInput,
    context: TenantContext,
    allowedShipmentStatuses: readonly ('APPROVED' | 'PLANNED')[] = ['APPROVED'],
  ) {
    this.uuid(input.capacityPoolId, 'capacityPoolId');
    this.uuid(input.shipmentId, 'shipmentId');
    const expiresAt = this.date(input.expiresAt);
    if (expiresAt <= new Date())
      this.invalid('Capacity reservation expiry must be in the future');
    const shipment = await tx.shipment.findFirst({
      where: {
        id: input.shipmentId,
        status: { in: [...allowedShipmentStatuses] },
        tenantId: context.tenantId,
      },
    });
    if (!shipment)
      throw new AppError(
        'TMS_CAPACITY_SHIPMENT_INVALID',
        'Shipment state does not allow capacity reservation',
        409,
      );
    const updated = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`UPDATE "tms"."capacity_pool" SET "reserved_weight_base"="reserved_weight_base"+${shipment.totalWeightBase},"reserved_volume_base"="reserved_volume_base"+${shipment.totalVolumeBase},"reserved_pallets"="reserved_pallets"+${shipment.totalPallets},"version"="version"+1,"updated_at"=CURRENT_TIMESTAMP,"updated_by"=${context.accountId}::uuid WHERE "id"=${input.capacityPoolId}::uuid AND "tenant_id"=${context.tenantId}::uuid AND "status"='ACTIVE' AND "version"=${input.expectedPoolVersion} AND "reserved_weight_base"+${shipment.totalWeightBase}<="total_weight_base" AND "reserved_volume_base"+${shipment.totalVolumeBase}<="total_volume_base" AND "reserved_pallets"+${shipment.totalPallets}<="total_pallets" RETURNING "id"`,
    );
    if (!updated.length)
      throw new AppError(
        'TMS_CAPACITY_INSUFFICIENT',
        'Capacity is unavailable or version changed',
        409,
        { retryable: true },
      );
    const id = randomUUID();
    return tx.capacityReservation.create({
      data: {
        capacityPoolId: input.capacityPoolId,
        createdBy: context.accountId,
        expiresAt,
        id,
        pallets: shipment.totalPallets,
        reservationNo: `CR-${Date.now()}-${id.slice(0, 6)}`,
        shipmentId: shipment.id,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
        volumeBase: shipment.totalVolumeBase,
        weightBase: shipment.totalWeightBase,
      },
    });
  }

  private async release(
    tx: Prisma.TransactionClient,
    id: string,
    expectedVersion: number | undefined,
    reason: string,
    context: TenantContext,
    allowActiveTender = false,
    targetStatus: CapacityReservationStatus = 'RELEASED',
  ) {
    const reservation = await tx.capacityReservation.findFirst({
      where: {
        id,
        status: { in: ['ACTIVE', 'CONSUMED'] },
        tenantId: context.tenantId,
        ...(expectedVersion === undefined ? {} : { version: expectedVersion }),
      },
    });
    if (!reservation) throw this.conflict('TMS_CAPACITY_RESERVATION_CONFLICT');
    const claimed = await tx.capacityReservation.updateMany({
      data: {
        releasedAt: new Date(),
        releaseReason: reason.trim(),
        status: targetStatus,
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: {
        id: reservation.id,
        status: { in: ['ACTIVE', 'CONSUMED'] },
        tenantId: context.tenantId,
        version: reservation.version,
      },
    });
    if (!claimed.count)
      throw this.conflict('TMS_CAPACITY_RESERVATION_CONFLICT');
    if (!allowActiveTender) {
      const activeTender = await tx.carrierTender.count({
        where: {
          capacityReservationId: reservation.id,
          status: { in: ['SENT', 'QUESTIONED', 'ACCEPTED'] },
          tenantId: context.tenantId,
        },
      });
      if (activeTender)
        throw new AppError(
          'TMS_TENDER_REVOKE_REQUIRED',
          'Active tender must be revoked before capacity is released',
          409,
        );
    }
    await tx.capacityPool.update({
      data: {
        reservedPallets: { decrement: reservation.pallets },
        reservedVolumeBase: { decrement: reservation.volumeBase },
        reservedWeightBase: { decrement: reservation.weightBase },
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: reservation.capacityPoolId },
    });
    return tx.capacityReservation.findUniqueOrThrow({
      where: { id: reservation.id },
    });
  }

  private async tender(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    reservationId: string,
    input: TenderInput & { previousTenderId?: string },
    context: TenantContext,
  ) {
    const expiresAt = this.date(input.expiresAt);
    if (expiresAt <= new Date())
      this.invalid('Tender expiry must be in the future');
    const price = this.nonNegative(input.priceAmount);
    const currency = this.currency(input.currency);
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "tms"."capacity_reservation" WHERE "id"=${reservationId}::uuid AND "tenant_id"=${context.tenantId}::uuid FOR UPDATE`,
    );
    const [shipment, reservation] = await Promise.all([
      tx.shipment.findFirst({
        where: {
          id: shipmentId,
          status: 'APPROVED',
          tenantId: context.tenantId,
        },
      }),
      tx.capacityReservation.findFirst({
        where: {
          id: reservationId,
          shipmentId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      }),
    ]);
    if (!shipment || !reservation)
      throw new AppError(
        'TMS_TENDER_REFERENCES_INVALID',
        'Approved shipment and active capacity reservation are required',
        409,
      );
    if (expiresAt > reservation.expiresAt)
      throw new AppError(
        'TMS_TENDER_EXPIRY_INVALID',
        'Tender expiry cannot exceed capacity reservation expiry',
        409,
      );
    const pool = await tx.capacityPool.findUniqueOrThrow({
      where: { id: reservation.capacityPoolId },
    });
    const carrierRef = String(
      record(input.carrierSnapshot).carrierRef ?? pool.carrierRef,
    );
    if (carrierRef !== pool.carrierRef)
      throw new AppError(
        'TMS_TENDER_CARRIER_CAPACITY_MISMATCH',
        'Tender carrier must own reserved capacity',
        409,
      );
    const id = randomUUID();
    const tender = await tx.carrierTender.create({
      data: {
        capacityReservationId: reservation.id,
        carrierRef,
        carrierSnapshot: json(input.carrierSnapshot),
        createdBy: context.accountId,
        currency,
        expiresAt,
        id,
        previousTenderId: input.previousTenderId ?? null,
        priceAmount: price,
        requirementSnapshot: json(input.requirementSnapshot),
        shipmentId,
        tenantId: context.tenantId,
        tenderNo: `CT-${Date.now()}-${id.slice(0, 6)}`,
        updatedBy: context.accountId,
      },
    });
    const changed = await tx.shipment.update({
      data: {
        status: 'TENDERED',
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: shipment.id },
    });
    return { shipmentVersion: changed.version, tender };
  }

  private decimal(value: unknown) {
    try {
      const result = new Prisma.Decimal(String(value ?? ''));
      if (!result.isFinite()) throw new Error();
      return result;
    } catch {
      this.invalid('Value must be a decimal');
    }
  }
  private nonNegative(value: unknown) {
    const result = this.decimal(value);
    if (result.isNegative()) this.invalid('Value must be non-negative');
    return result;
  }
  private positive(value: unknown) {
    const result = this.decimal(value);
    if (!result.greaterThan(0)) this.invalid('Value must be positive');
    return result;
  }
  private currency(value: string) {
    const result = value?.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(result)) this.invalid('Currency must be ISO 4217');
    return result;
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
    throw new AppError('TMS_CAPACITY_TENDER_INPUT_INVALID', message, 400);
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
          resourceType: 'TransportCapacityTender',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType: 'TransportCapacityTender',
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
