import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type TransportOrderStatus,
  type TransportOrderType,
  type TransportReviewDecision,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { businessNumber } from '../platform/public/numbering.facade';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export interface ReceiveTransportOrderInput {
  readonly carrierRequirementSnapshot?: Readonly<Record<string, unknown>>;
  readonly chargeResponsibilitySnapshot: Readonly<Record<string, unknown>>;
  readonly customerRef?: string;
  readonly customerSnapshot?: Readonly<Record<string, unknown>>;
  readonly deliveryWindowFrom: string;
  readonly deliveryWindowTo: string;
  readonly destinationAddressRef?: string;
  readonly destinationAddressSnapshot: Readonly<Record<string, unknown>>;
  readonly externalOrderNo?: string;
  readonly originAddressRef?: string;
  readonly originAddressSnapshot: Readonly<Record<string, unknown>>;
  readonly packagingSnapshot: Readonly<Record<string, unknown>>;
  readonly pickupWindowFrom: string;
  readonly pickupWindowTo: string;
  readonly priority?: number;
  readonly prohibitedGoodsSnapshot?: Readonly<Record<string, unknown>>;
  readonly serviceLevel: string;
  readonly sourceRef: string;
  readonly sourceSnapshot: Readonly<Record<string, unknown>>;
  readonly sourceType: string;
  readonly sourceVersion?: string;
  readonly temperatureMax?: string;
  readonly temperatureMin?: string;
  readonly temperatureUom?: string;
  readonly type: TransportOrderType;
  readonly vehicleRequirementSnapshot?: Readonly<Record<string, unknown>>;
  readonly volume: string;
  readonly volumeBase: string;
  readonly volumeBaseUom?: string;
  readonly volumeUom: string;
  readonly weight: string;
  readonly weightBase: string;
  readonly weightBaseUom?: string;
  readonly weightUom: string;
}

export interface ReviewTransportOrderInput {
  readonly addressConfirmed: boolean;
  readonly carrierQualified: boolean;
  readonly chargeResponsibilityConfirmed: boolean;
  readonly decision: TransportReviewDecision;
  readonly expectedVersion: number;
  readonly prohibitedGoodsDetected: boolean;
  readonly reason: string;
  readonly timeWindowFeasible: boolean;
  readonly vehicleCompatible: boolean;
}

const reviewTransitions: Readonly<
  Record<
    'OPEN' | 'FROZEN' | 'RETURNED',
    Partial<Record<TransportReviewDecision, TransportOrderStatus>>
  >
> = {
  FROZEN: { APPROVE: 'PLANNED', RETURN: 'RETURNED' },
  OPEN: { APPROVE: 'PLANNED', FREEZE: 'FROZEN', RETURN: 'RETURNED' },
  RETURNED: { APPROVE: 'PLANNED', FREEZE: 'FROZEN' },
};

@Injectable()
export class TransportOrderService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findBySource(
    sourceType: string,
    sourceRef: string,
    sourceVersion: string,
    context: TenantContext,
  ) {
    return this.prisma.transportOrder.findUnique({
      where: {
        tenantId_sourceType_sourceRef_sourceVersion: {
          sourceRef,
          sourceType,
          sourceVersion,
          tenantId: context.tenantId,
        },
      },
    });
  }

  async list(
    input: {
      page?: string;
      pageSize?: string;
      query?: string;
      status?: string;
      type?: string;
    },
    context: TenantContext,
  ) {
    const page = this.page(input.page, 1);
    const pageSize = this.page(input.pageSize, 50, 300);
    const status = input.status?.trim().toUpperCase();
    const type = input.type?.trim().toUpperCase();
    const where: Prisma.TransportOrderWhereInput = {
      tenantId: context.tenantId,
      ...(status ? { status: status as TransportOrderStatus } : {}),
      ...(type ? { type: type as TransportOrderType } : {}),
      ...(input.query?.trim()
        ? {
            OR: [
              {
                orderNo: { contains: input.query.trim(), mode: 'insensitive' },
              },
              {
                externalOrderNo: {
                  contains: input.query.trim(),
                  mode: 'insensitive',
                },
              },
              {
                sourceRef: {
                  contains: input.query.trim(),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.transportOrder.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      this.prisma.transportOrder.count({ where }),
    ]);
    return toHttpJson({ items, page, pageSize, total });
  }

  async get(id: string, context: TenantContext) {
    this.uuid(id, 'transportOrderId');
    const order = await this.prisma.transportOrder.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!order)
      throw new AppError(
        'TMS_TRANSPORT_ORDER_NOT_FOUND',
        'Transport order not found',
        404,
      );
    const approvals = await this.prisma.transportOrderApproval.findMany({
      orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
      where: { tenantId: context.tenantId, transportOrderId: id },
    });
    return toHttpJson({ approvals, order });
  }

  receive(
    input: ReceiveTransportOrderInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const parsed = this.validateReceive(input);
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.transportOrder.findFirst({
        select: { id: true },
        where: {
          sourceRef: input.sourceRef.trim(),
          sourceType: input.sourceType.trim().toUpperCase(),
          sourceVersion: input.sourceVersion?.trim() || '1',
          tenantId: context.tenantId,
        },
      });
      if (duplicate)
        throw new AppError(
          'TMS_TRANSPORT_SOURCE_DUPLICATE',
          'Source transport request version already exists',
          409,
        );
      const order = await tx.transportOrder.create({
        data: {
          carrierRequirementSnapshot: json(input.carrierRequirementSnapshot),
          chargeResponsibilitySnapshot: json(
            input.chargeResponsibilitySnapshot,
          ),
          createdBy: context.accountId,
          customerRef: input.customerRef?.trim() || null,
          customerSnapshot: json(input.customerSnapshot),
          deliveryWindowFrom: parsed.deliveryWindowFrom,
          deliveryWindowTo: parsed.deliveryWindowTo,
          destinationAddressRef: input.destinationAddressRef?.trim() || null,
          destinationAddressSnapshot: json(input.destinationAddressSnapshot),
          externalOrderNo: input.externalOrderNo?.trim() || null,
          id,
          orderNo: await businessNumber(
            this.prisma,
            'TMS_TRANSPORT_ORDER',
            context,
            metadata,
            `transport-order:${input.sourceType}:${input.sourceRef}:${input.sourceVersion ?? '1'}`,
          ),
          originAddressRef: input.originAddressRef?.trim() || null,
          originAddressSnapshot: json(input.originAddressSnapshot),
          packagingSnapshot: json(input.packagingSnapshot),
          pickupWindowFrom: parsed.pickupWindowFrom,
          pickupWindowTo: parsed.pickupWindowTo,
          priority: input.priority ?? 100,
          prohibitedGoodsSnapshot: json(input.prohibitedGoodsSnapshot),
          serviceLevel: input.serviceLevel.trim().toUpperCase(),
          sourceRef: input.sourceRef.trim(),
          sourceSnapshot: json(input.sourceSnapshot),
          sourceType: input.sourceType.trim().toUpperCase(),
          sourceVersion: input.sourceVersion?.trim() || '1',
          temperatureMax: parsed.temperatureMax,
          temperatureMin: parsed.temperatureMin,
          temperatureUom: input.temperatureUom?.trim().toUpperCase() || null,
          tenantId: context.tenantId,
          type: input.type,
          updatedBy: context.accountId,
          vehicleRequirementSnapshot: json(input.vehicleRequirementSnapshot),
          volume: parsed.volume,
          volumeBase: parsed.volumeBase,
          volumeBaseUom: input.volumeBaseUom?.trim().toUpperCase() || 'M3',
          volumeUom: input.volumeUom.trim().toUpperCase(),
          weight: parsed.weight,
          weightBase: parsed.weightBase,
          weightBaseUom: input.weightBaseUom?.trim().toUpperCase() || 'KG',
          weightUom: input.weightUom.trim().toUpperCase(),
        },
      });
      await this.emit(
        tx,
        order.id,
        order.version,
        'tms.transport-order-received.v1',
        context,
        metadata,
        {
          orderNo: order.orderNo,
          sourceRef: order.sourceRef,
          transportOrderId: order.id,
          type: order.type,
        },
      );
      return {
        status: order.status,
        transportOrderId: order.id,
        version: order.version,
      };
    });
  }

  review(
    id: string,
    input: ReviewTransportOrderInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'transportOrderId');
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)
      this.invalid('Expected version is invalid');
    if (!input.reason?.trim()) this.invalid('Review reason is required');
    const findings = this.reviewFindings(input);
    if (input.decision === 'APPROVE' && findings.length)
      throw new AppError(
        'TMS_TRANSPORT_REVIEW_FAILED',
        'Transport order cannot be approved while review findings remain',
        409,
        { fieldErrors: [{ field: 'decision', message: findings.join(',') }] },
      );
    if (input.decision !== 'APPROVE' && !findings.length)
      this.invalid('Freeze or return requires at least one review finding');

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.transportOrder.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!order)
        throw new AppError(
          'TMS_TRANSPORT_ORDER_NOT_FOUND',
          'Transport order not found',
          404,
        );
      if (order.version !== input.expectedVersion)
        throw this.conflict('TMS_TRANSPORT_VERSION_CONFLICT');
      const transitions =
        reviewTransitions[order.status as keyof typeof reviewTransitions];
      const targetStatus = transitions?.[input.decision];
      if (!targetStatus)
        throw this.conflict('TMS_TRANSPORT_REVIEW_TRANSITION_INVALID');

      const approval = await tx.transportOrderApproval.create({
        data: {
          createdBy: context.accountId,
          decidedBy: context.accountId,
          decision: input.decision,
          findings: json(findings),
          inputSnapshot: json(input),
          orderVersion: order.version,
          reason: input.reason.trim(),
          tenantId: context.tenantId,
          transportOrderId: order.id,
          updatedBy: context.accountId,
        },
      });
      const changed = await tx.transportOrder.update({
        data: {
          reviewedAt: approval.decidedAt,
          reviewedBy: context.accountId,
          status: targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: order.id },
      });
      const suffix =
        targetStatus === 'PLANNED' ? 'planned' : targetStatus.toLowerCase();
      await this.emit(
        tx,
        order.id,
        changed.version,
        `tms.transport-order-${suffix}.v1`,
        context,
        metadata,
        {
          approvalId: approval.id,
          decision: approval.decision,
          findings,
          fromStatus: order.status,
          toStatus: changed.status,
          transportOrderId: order.id,
        },
      );
      return {
        approvalId: approval.id,
        findings,
        status: changed.status,
        transportOrderId: order.id,
        version: changed.version,
      };
    });
  }

  private validateReceive(input: ReceiveTransportOrderInput) {
    if (
      !['SALES', 'PURCHASE', 'TRANSFER', 'STANDALONE', 'RETURN'].includes(
        input.type,
      )
    )
      this.invalid('Transport order type is invalid');
    if (
      !input.sourceType?.trim() ||
      !input.sourceRef?.trim() ||
      !input.serviceLevel?.trim()
    )
      this.invalid('Source and service level are required');
    if (
      !isRecord(input.sourceSnapshot) ||
      !Object.keys(input.sourceSnapshot).length
    )
      this.invalid('Source snapshot is required');
    this.address(input.originAddressSnapshot, 'originAddressSnapshot');
    this.address(
      input.destinationAddressSnapshot,
      'destinationAddressSnapshot',
    );
    if (
      !isRecord(input.packagingSnapshot) ||
      !Object.keys(input.packagingSnapshot).length
    )
      this.invalid('Packaging snapshot is required');
    if (
      !isRecord(input.chargeResponsibilitySnapshot) ||
      !Object.keys(input.chargeResponsibilitySnapshot).length
    )
      this.invalid('Charge responsibility snapshot is required');
    if (!Number.isInteger(input.priority ?? 100) || (input.priority ?? 100) < 1)
      this.invalid('Priority must be a positive integer');

    const pickupWindowFrom = this.date(
      input.pickupWindowFrom,
      'pickupWindowFrom',
    );
    const pickupWindowTo = this.date(input.pickupWindowTo, 'pickupWindowTo');
    const deliveryWindowFrom = this.date(
      input.deliveryWindowFrom,
      'deliveryWindowFrom',
    );
    const deliveryWindowTo = this.date(
      input.deliveryWindowTo,
      'deliveryWindowTo',
    );
    if (
      pickupWindowFrom >= pickupWindowTo ||
      deliveryWindowFrom >= deliveryWindowTo
    )
      this.invalid('Pickup and delivery windows must have a positive duration');
    if (pickupWindowFrom > deliveryWindowTo)
      this.invalid('Pickup cannot start after the delivery window closes');

    if (!input.weightUom?.trim() || !input.volumeUom?.trim())
      this.invalid('Weight and volume units are required');
    const weight = this.positive(input.weight, 'weight');
    const weightBase = this.positive(input.weightBase, 'weightBase');
    const volume = this.positive(input.volume, 'volume');
    const volumeBase = this.positive(input.volumeBase, 'volumeBase');
    const hasTemperature = [
      input.temperatureMin,
      input.temperatureMax,
      input.temperatureUom,
    ].some((value) => value !== undefined && value !== '');
    let temperatureMin: Prisma.Decimal | null = null;
    let temperatureMax: Prisma.Decimal | null = null;
    if (hasTemperature) {
      if (
        !input.temperatureUom?.trim() ||
        input.temperatureMin === undefined ||
        input.temperatureMax === undefined
      )
        this.invalid('Temperature range requires minimum, maximum and unit');
      temperatureMin = this.decimal(input.temperatureMin, 'temperatureMin');
      temperatureMax = this.decimal(input.temperatureMax, 'temperatureMax');
      if (temperatureMin.greaterThan(temperatureMax))
        this.invalid('Temperature minimum cannot exceed maximum');
    }
    return {
      deliveryWindowFrom,
      deliveryWindowTo,
      pickupWindowFrom,
      pickupWindowTo,
      temperatureMax,
      temperatureMin,
      volume,
      volumeBase,
      weight,
      weightBase,
    };
  }

  private reviewFindings(input: ReviewTransportOrderInput) {
    const findings: string[] = [];
    if (!input.addressConfirmed) findings.push('ADDRESS_UNCONFIRMED');
    if (input.prohibitedGoodsDetected) findings.push('PROHIBITED_GOODS');
    if (!input.vehicleCompatible) findings.push('VEHICLE_INCOMPATIBLE');
    if (!input.carrierQualified) findings.push('CARRIER_UNQUALIFIED');
    if (!input.timeWindowFeasible) findings.push('TIME_WINDOW_INFEASIBLE');
    if (!input.chargeResponsibilityConfirmed)
      findings.push('CHARGE_RESPONSIBILITY_UNCONFIRMED');
    return findings;
  }

  private address(value: unknown, field: string) {
    if (!isRecord(value)) this.invalid(`${field} must be an object`);
    const countryCode = String(value.countryCode ?? '').trim();
    const line = String(
      value.line1 ?? value.address ?? value.rawText ?? '',
    ).trim();
    if (!countryCode || !line)
      this.invalid(`${field} requires countryCode and address text`);
  }

  private date(value: string, field: string) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime()))
      this.invalid(`${field} is invalid`);
    return date;
  }

  private decimal(value: unknown, field: string) {
    try {
      const decimal = new Prisma.Decimal(String(value ?? ''));
      if (!decimal.isFinite()) throw new Error();
      return decimal;
    } catch {
      this.invalid(`${field} must be a decimal`);
    }
  }

  private positive(value: unknown, field: string) {
    const decimal = this.decimal(value, field);
    if (!decimal.greaterThan(0)) this.invalid(`${field} must be positive`);
    return decimal;
  }

  private page(
    value: string | undefined,
    fallback: number,
    max = Number.MAX_SAFE_INTEGER,
  ) {
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max)
      this.invalid('Pagination parameters are invalid');
    return parsed;
  }

  private uuid(value: string, field: string) {
    if (!isUuid(value)) this.invalid(`${field} is invalid`);
  }

  private invalid(message: string): never {
    throw new AppError('TMS_TRANSPORT_INPUT_INVALID', message, 400);
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
          resourceType: 'TransportOrder',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType: 'TransportOrder',
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
