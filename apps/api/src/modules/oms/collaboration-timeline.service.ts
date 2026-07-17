import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type AsnPackageType,
  type CollaborationType,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import type { BusinessEventInput } from '../platform/event.service';
import type { CommandMetadata } from '../platform/tenant.service';

export interface CollaborationInput {
  readonly baseUom?: string;
  readonly comment?: string;
  readonly confirmed?: boolean;
  readonly orderLineId?: string;
  readonly partnerId: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly promiseDate?: string;
  readonly shortageBase?: string;
  readonly shortageOriginal?: string;
  readonly originalUom?: string;
  readonly type: CollaborationType;
}
export interface AsnLineInput {
  readonly baseUom: string;
  readonly batchNo?: string;
  readonly packageNo?: string;
  readonly productId: string;
  readonly quantityBase: string;
  readonly quantityOriginal: string;
  readonly originalUom: string;
  readonly sourceOrderLineId: string;
}
export interface AsnPackageInput {
  readonly packageNo: string;
  readonly parentPackageNo?: string;
  readonly snapshot?: Readonly<Record<string, unknown>>;
  readonly type: AsnPackageType;
}
export interface CreateAsnInput {
  readonly expectedArrival: string;
  readonly expiresAt: string;
  readonly externalAsnNo: string;
  readonly lines: readonly AsnLineInput[];
  readonly packages?: readonly AsnPackageInput[];
  readonly partnerId: string;
  readonly shipmentReference?: string;
  readonly warehouseId: string;
}

const COLLABORATION_TYPES: readonly CollaborationType[] = [
  'CANCEL_REQUEST',
  'CHANGE_REQUEST',
  'CUSTOMER_CONFIRMATION',
  'PROMISE_DATE',
  'SHORTAGE_FEEDBACK',
  'SUPPLIER_ACCEPTANCE',
];
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
function quantity(value: string | undefined, field: string) {
  if (value === undefined) return null;
  try {
    const result = new Prisma.Decimal(value);
    if (!result.isFinite() || result.isNegative()) throw new Error();
    return result;
  } catch {
    throw new AppError(
      'COLLABORATION_QUANTITY_INVALID',
      `${field} is invalid`,
      400,
    );
  }
}
function instant(value: string, field: string) {
  const result = new Date(value);
  if (Number.isNaN(result.valueOf()))
    throw new AppError(
      'COLLABORATION_DATE_INVALID',
      `${field} is invalid`,
      400,
    );
  return result;
}

@Injectable()
export class CollaborationTimelineService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventConsumptionFacade)
    private readonly events: EventConsumptionFacade,
  ) {}

  async collaborate(
    orderId: string,
    input: CollaborationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId, 'ORDER_NOT_FOUND');
    this.uuid(input.partnerId, 'ORDER_PARTNER_SCOPE_DENIED');
    if (!COLLABORATION_TYPES.includes(input.type))
      throw new AppError(
        'COLLABORATION_TYPE_INVALID',
        'Collaboration type is invalid',
        400,
      );
    const order = await this.prisma.businessOrder.findFirst({
      where: { id: orderId, tenantId: context.tenantId },
    });
    if (!order)
      throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
    if (order.customerId !== input.partnerId)
      throw new AppError(
        'ORDER_PARTNER_SCOPE_DENIED',
        'Partner cannot collaborate on this order',
        403,
      );
    if (['DRAFT', 'INVALID', 'REJECTED'].includes(order.status))
      throw new AppError(
        'COLLABORATION_ORDER_STATE_INVALID',
        'Order state does not allow partner collaboration',
        409,
      );
    const orderLine = input.orderLineId
      ? await this.prisma.businessOrderLine.findFirst({
          where: {
            id: input.orderLineId,
            orderId,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        })
      : null;
    if (input.orderLineId && !orderLine)
      throw new AppError(
        'ORDER_LINE_NOT_FOUND',
        'Active order line was not found',
        404,
      );
    const shortageOriginal = quantity(
      input.shortageOriginal,
      'shortageOriginal',
    );
    const shortageBase = quantity(input.shortageBase, 'shortageBase');
    const hasShortage =
      shortageOriginal !== null ||
      shortageBase !== null ||
      input.originalUom !== undefined ||
      input.baseUom !== undefined;
    if (
      hasShortage &&
      (shortageOriginal === null ||
        shortageBase === null ||
        !input.originalUom ||
        !input.baseUom)
    )
      throw new AppError(
        'COLLABORATION_QUANTITY_INVALID',
        'Shortage requires both original and base quantities and units',
        400,
      );
    if (input.type === 'SHORTAGE_FEEDBACK' && !hasShortage)
      throw new AppError(
        'COLLABORATION_QUANTITY_REQUIRED',
        'Shortage feedback requires quantity',
        400,
      );
    if (
      shortageBase &&
      orderLine?.quantityBase &&
      shortageBase.greaterThan(orderLine.quantityBase)
    )
      throw new AppError(
        'COLLABORATION_QUANTITY_EXCEEDED',
        'Shortage cannot exceed order line quantity',
        409,
      );
    const promiseDate = input.promiseDate
      ? instant(input.promiseDate, 'promiseDate')
      : null;
    if (input.type === 'PROMISE_DATE' && !promiseDate)
      throw new AppError(
        'COLLABORATION_PROMISE_REQUIRED',
        'Promise date is required',
        400,
      );
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.partnerCollaboration.create({
        data: {
          baseUom: input.baseUom?.trim().toUpperCase() ?? null,
          businessOrderId: orderId,
          comment: input.comment?.trim() ?? null,
          confirmed: input.confirmed ?? null,
          createdBy: context.accountId,
          id: randomUUID(),
          orderLineId: input.orderLineId ?? null,
          originalUom: input.originalUom?.trim().toUpperCase() ?? null,
          partnerId: input.partnerId,
          payload: json(input.payload ?? input),
          promiseDate,
          shortageBase,
          shortageOriginal,
          tenantId: context.tenantId,
          type: input.type,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        transaction,
        row.id,
        'PartnerCollaboration',
        row.version,
        'order.partner-collaborated.v1',
        context,
        metadata,
        {
          collaborationId: row.id,
          orderId,
          partnerId: input.partnerId,
          type: input.type,
        },
      );
      return {
        collaborationId: row.id,
        orderId,
        type: row.type,
        version: row.version,
      };
    });
  }

  async createAsn(
    orderId: string,
    input: CreateAsnInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId, 'ORDER_NOT_FOUND');
    for (const value of [input.partnerId, input.warehouseId])
      this.uuid(value, 'ASN_INPUT_INVALID');
    if (
      !input.externalAsnNo?.trim() ||
      !input.lines.length ||
      input.lines.length > 1000
    )
      throw new AppError(
        'ASN_INPUT_INVALID',
        'ASN number and lines are required',
        400,
      );
    const expectedArrival = instant(input.expectedArrival, 'expectedArrival');
    const expiresAt = instant(input.expiresAt, 'expiresAt');
    if (
      expectedArrival <= new Date() ||
      expiresAt <= new Date() ||
      expectedArrival > expiresAt
    )
      throw new AppError(
        'ASN_EXPIRED',
        'ASN is expired or arrival is after expiry',
        409,
      );
    const packageNumbers = new Set(
      (input.packages ?? []).map(({ packageNo }) => packageNo.trim()),
    );
    if (
      packageNumbers.size !== (input.packages ?? []).length ||
      (input.packages ?? []).some(
        ({ packageNo, parentPackageNo }) =>
          !packageNo.trim() ||
          parentPackageNo === packageNo ||
          (parentPackageNo && !packageNumbers.has(parentPackageNo)),
      )
    )
      throw new AppError(
        'ASN_PACKAGE_HIERARCHY_INVALID',
        'ASN package hierarchy is invalid',
        400,
      );
    const parents = new Map(
      (input.packages ?? []).map(({ packageNo, parentPackageNo }) => [
        packageNo,
        parentPackageNo,
      ]),
    );
    for (const packageNo of packageNumbers) {
      const visited = new Set<string>();
      let current: string | undefined = packageNo;
      while (current) {
        if (visited.has(current))
          throw new AppError(
            'ASN_PACKAGE_HIERARCHY_INVALID',
            'ASN package hierarchy contains a cycle',
            400,
          );
        visited.add(current);
        current = parents.get(current);
      }
    }
    if (
      input.lines.some(
        ({ packageNo }) => packageNo && !packageNumbers.has(packageNo),
      )
    )
      throw new AppError(
        'ASN_PACKAGE_NOT_FOUND',
        'ASN line package was not declared',
        400,
      );
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${context.tenantId}:asn:${orderId}`}))`;
      const order = await transaction.businessOrder.findFirst({
        where: { id: orderId, tenantId: context.tenantId },
      });
      if (!order)
        throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
      if (order.customerId !== input.partnerId)
        throw new AppError(
          'ORDER_PARTNER_SCOPE_DENIED',
          'Partner cannot submit ASN for this order',
          403,
        );
      if (
        !['APPROVED', 'ALLOCATED', 'RELEASED'].includes(order.status) ||
        !['PURCHASE', 'TRANSFER'].includes(order.type)
      )
        throw new AppError(
          'ASN_ORDER_STATE_INVALID',
          'ASN requires an approved purchase or transfer order',
          409,
        );
      if (
        await transaction.partnerAsn.findUnique({
          where: {
            tenantId_partnerId_externalAsnNo: {
              externalAsnNo: input.externalAsnNo.trim(),
              partnerId: input.partnerId,
              tenantId: context.tenantId,
            },
          },
        })
      )
        throw new AppError(
          'ASN_DUPLICATE',
          'ASN number already exists for this partner',
          409,
        );
      const sourceLines = await transaction.businessOrderLine.findMany({
        where: {
          id: {
            in: input.lines.map(({ sourceOrderLineId }) => sourceOrderLineId),
          },
          orderId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      if (
        sourceLines.length !==
        new Set(input.lines.map(({ sourceOrderLineId }) => sourceOrderLineId))
          .size
      )
        throw new AppError(
          'ASN_ORDER_LINE_INVALID',
          'ASN source line is invalid',
          400,
        );
      for (const inputLine of input.lines) {
        const source = sourceLines.find(
          ({ id }) => id === inputLine.sourceOrderLineId,
        )!;
        const base = quantity(inputLine.quantityBase, 'quantityBase');
        const original = quantity(
          inputLine.quantityOriginal,
          'quantityOriginal',
        );
        if (
          !base?.greaterThan(0) ||
          !original?.greaterThan(0) ||
          source.productId !== inputLine.productId ||
          source.baseUom !== inputLine.baseUom.trim().toUpperCase() ||
          source.originalUom !== inputLine.originalUom.trim().toUpperCase()
        )
          throw new AppError(
            'ASN_ORDER_LINE_INVALID',
            'ASN line does not match order line units or product',
            400,
          );
        const prior = await transaction.partnerAsnLine.aggregate({
          _sum: { quantityBase: true },
          where: {
            sourceOrderLineId: source.id,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        const incomingForLine = input.lines
          .filter(({ sourceOrderLineId }) => sourceOrderLineId === source.id)
          .reduce(
            (sum, line) =>
              sum.add(quantity(line.quantityBase, 'quantityBase')!),
            new Prisma.Decimal(0),
          );
        if (
          !source.quantityBase ||
          (prior._sum.quantityBase ?? new Prisma.Decimal(0))
            .add(incomingForLine)
            .greaterThan(source.quantityBase)
        )
          throw new AppError(
            'ASN_QUANTITY_EXCEEDED',
            'ASN quantity exceeds remaining order quantity',
            409,
          );
      }
      const asn = await transaction.partnerAsn.create({
        data: {
          businessOrderId: orderId,
          createdBy: context.accountId,
          expectedArrival,
          expiresAt,
          externalAsnNo: input.externalAsnNo.trim(),
          id: randomUUID(),
          partnerId: input.partnerId,
          shipmentReference: input.shipmentReference?.trim() ?? null,
          status: 'SUBMITTED',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          warehouseId: input.warehouseId,
        },
      });
      for (const item of input.packages ?? [])
        await transaction.partnerAsnPackage.create({
          data: {
            asnId: asn.id,
            createdBy: context.accountId,
            id: randomUUID(),
            packageNo: item.packageNo.trim(),
            packageSnapshot: json(item.snapshot),
            parentPackageNo: item.parentPackageNo?.trim() ?? null,
            tenantId: context.tenantId,
            type: item.type,
            updatedBy: context.accountId,
          },
        });
      for (const [index, item] of input.lines.entries())
        await transaction.partnerAsnLine.create({
          data: {
            asnId: asn.id,
            baseUom: item.baseUom.trim().toUpperCase(),
            batchNo: item.batchNo?.trim() ?? null,
            createdBy: context.accountId,
            id: randomUUID(),
            lineNo: index + 1,
            originalUom: item.originalUom.trim().toUpperCase(),
            packageNo: item.packageNo?.trim() ?? null,
            productId: item.productId,
            quantityBase: quantity(item.quantityBase, 'quantityBase')!,
            quantityOriginal: quantity(
              item.quantityOriginal,
              'quantityOriginal',
            )!,
            sourceOrderLineId: item.sourceOrderLineId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      const accepted = await transaction.partnerAsn.update({
        data: {
          status: 'ACCEPTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: asn.id },
      });
      await this.record(
        transaction,
        accepted.id,
        'PartnerAsn',
        accepted.version,
        'wms.asn-submitted.v1',
        context,
        metadata,
        { asnId: accepted.id, orderId, warehouseId: input.warehouseId },
      );
      await this.record(
        transaction,
        accepted.id,
        'PartnerAsn',
        accepted.version,
        'ams.appointment-requested.v1',
        context,
        metadata,
        {
          asnId: accepted.id,
          expectedArrival: expectedArrival.toISOString(),
          orderId,
          warehouseId: input.warehouseId,
        },
      );
      return {
        asnId: accepted.id,
        status: accepted.status,
        version: accepted.version,
      };
    });
  }

  consumeTimeline(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.events.consumeOrderTimeline(
      event,
      context,
      metadata,
      async (message, transaction) => {
        const orderId =
          typeof message.payload.orderId === 'string'
            ? message.payload.orderId
            : null;
        if (
          !orderId ||
          !isUuid(orderId) ||
          !(await transaction.businessOrder.findFirst({
            where: { id: orderId, tenantId: context.tenantId },
          }))
        )
          throw new AppError(
            'TIMELINE_ORDER_INVALID',
            'Timeline event does not reference a tenant order',
            400,
          );
        const actorId =
          typeof message.payload.actorId === 'string' &&
          isUuid(message.payload.actorId)
            ? message.payload.actorId
            : null;
        const row = await transaction.orderTimelineProjection.create({
          data: {
            actorId,
            aggregateId: message.aggregateId,
            aggregateType: message.aggregateType,
            aggregateVersion: message.aggregateVersion,
            attachments: json(
              Array.isArray(message.payload.attachments)
                ? message.payload.attachments
                : [],
            ),
            businessOrderId: orderId,
            createdBy: context.accountId,
            eventId: message.eventId,
            eventType: message.eventType,
            fromStatus:
              typeof message.payload.fromStatus === 'string'
                ? message.payload.fromStatus
                : null,
            id: randomUUID(),
            occurredAt: new Date(message.occurredAt),
            payload: json(message.payload),
            sourceDomain: message.eventType.split('.')[0]!.toUpperCase(),
            summary:
              typeof message.payload.summary === 'string'
                ? message.payload.summary.slice(0, 500)
                : message.eventType,
            tenantId: context.tenantId,
            toStatus:
              typeof message.payload.toStatus === 'string'
                ? message.payload.toStatus
                : null,
            traceId: message.traceId,
            updatedBy: context.accountId,
          },
        });
        return { orderId, timelineId: row.id };
      },
    );
  }

  async timeline(
    orderId: string,
    timeZone: string | undefined,
    context: TenantContext,
  ) {
    this.uuid(orderId, 'ORDER_NOT_FOUND');
    try {
      new Intl.DateTimeFormat('zh-CN', { timeZone: timeZone ?? 'UTC' });
    } catch {
      throw new AppError('TIMEZONE_INVALID', 'Timezone is invalid', 400);
    }
    const rows = await this.prisma.orderTimelineProjection.findMany({
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 500,
      where: { businessOrderId: orderId, tenantId: context.tenantId },
    });
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: timeZone ?? 'UTC',
    });
    return {
      items: rows.map((row) => ({
        ...row,
        displayAt: formatter.format(row.occurredAt),
      })),
      timeZone: timeZone ?? 'UTC',
      total: rows.length,
    };
  }

  private uuid(value: string, code: string) {
    if (!isUuid(value)) throw new AppError(code, 'Resource was not found', 404);
  }
  private async record(
    transaction: Prisma.TransactionClient,
    aggregateId: string,
    aggregateType: string,
    aggregateVersion: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      transaction.platformAuditLog.create({
        data: {
          action: eventName,
          after: payload,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: aggregateId,
          resourceType: aggregateType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      transaction.platformOutbox.create({
        data: {
          aggregateId,
          aggregateType,
          aggregateVersion,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          partitionKey: aggregateId,
          payload: { ...payload, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
}
