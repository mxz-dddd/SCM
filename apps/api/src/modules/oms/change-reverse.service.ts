import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type BackorderDisposition,
  type RmaResolution,
  type RmaStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { businessNumber } from '../platform/public/numbering.facade';
import type { CommandMetadata } from '../platform/tenant.service';

export interface CreateOrderChangeInput {
  readonly expectedVersion: number;
  readonly deliveryAddressId?: string;
  readonly deliveryAddressSnapshot?: Readonly<Record<string, unknown>>;
  readonly lineChanges?: readonly {
    readonly lineId: string;
    readonly quantityBase: string;
    readonly quantityOriginal: string;
  }[];
  readonly requestedFrom?: string;
  readonly requestedUntil?: string;
  readonly serviceLevel?: string;
}
export interface ConfirmChangeInput {
  readonly accepted: boolean;
  readonly domain: string;
  readonly reason?: string;
}
export interface CancelOrderInput {
  readonly expectedVersion: number;
  readonly reason: string;
}
export interface ProgressInput {
  readonly allocatedBase: string;
  readonly cancelledBase: string;
  readonly deliveredBase: string;
  readonly promisedBase: string;
  readonly shippedBase: string;
  readonly sourceVersion: number;
  readonly shortageDisposition?: BackorderDisposition;
  readonly shortageReason?: string;
}
export interface ProposeSubstitutionInput {
  readonly compatibility: Readonly<Record<string, unknown>>;
  readonly currency?: string;
  readonly partnerId: string;
  readonly priceDelta?: string;
  readonly quantityBase: string;
  readonly quantityOriginal: string;
  readonly replacementProductId: string;
  readonly respondBy: string;
  readonly timeoutPolicy: 'WAIT' | 'CANCEL';
}
export interface DecideSubstitutionInput {
  readonly accepted: boolean;
  readonly partnerId: string;
  readonly reason?: string;
}
export interface ExpireSubstitutionsInput {
  readonly limit?: number;
  readonly now?: string;
}
export interface CreateRmaInput {
  readonly lines: readonly {
    readonly itemCondition: string;
    readonly quantityBase: string;
    readonly quantityOriginal: string;
    readonly sourceOrderLineId: string;
  }[];
  readonly partnerId: string;
  readonly reason: string;
  readonly returnBy: string;
}
export interface TransitionRmaInput {
  readonly expectedVersion: number;
  readonly resolution?: RmaResolution;
  readonly targetStatus: RmaStatus;
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
function quantity(value: string, field: string, positive = false) {
  try {
    const result = new Prisma.Decimal(value);
    if (
      !result.isFinite() ||
      result.isNegative() ||
      (positive && result.isZero())
    )
      throw new Error();
    return result;
  } catch {
    throw new AppError('ORDER_QUANTITY_INVALID', `${field} is invalid`, 400);
  }
}
function instant(value: string | undefined, field: string) {
  if (!value) return null;
  const result = new Date(value);
  if (Number.isNaN(result.valueOf()))
    throw new AppError('ORDER_DATE_INVALID', `${field} is invalid`, 400);
  return result;
}

@Injectable()
export class ChangeReverseService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createChange(
    orderId: string,
    input: CreateOrderChangeInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId, 'ORDER_NOT_FOUND');
    const order = await this.order(orderId, context);
    if (!['OPEN', 'APPROVED', 'ALLOCATED', 'RELEASED'].includes(order.status))
      throw new AppError(
        'ORDER_CHANGE_STATE_INVALID',
        'Order state does not allow a change',
        409,
      );
    if (order.version !== input.expectedVersion) throw this.conflict();
    if (
      !input.deliveryAddressId &&
      !input.requestedFrom &&
      !input.requestedUntil &&
      !input.serviceLevel &&
      !input.lineChanges?.length
    )
      throw new AppError(
        'ORDER_CHANGE_EMPTY',
        'At least one change is required',
        400,
      );
    if (input.deliveryAddressId && !isUuid(input.deliveryAddressId))
      throw new AppError(
        'ORDER_CHANGE_INVALID',
        'deliveryAddressId is invalid',
        400,
      );
    const ids = (input.lineChanges ?? []).map(({ lineId }) => lineId);
    const lines = await this.prisma.businessOrderLine.findMany({
      where: {
        id: { in: ids },
        orderId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    if (lines.length !== ids.length)
      throw new AppError(
        'ORDER_CHANGE_LINE_INVALID',
        'Order change line was not found',
        400,
      );
    for (const change of input.lineChanges ?? []) {
      quantity(change.quantityBase, 'quantityBase', true);
      quantity(change.quantityOriginal, 'quantityOriginal', true);
      const progress = await this.prisma.orderLineProgress.findUnique({
        where: {
          tenantId_orderLineId: {
            orderLineId: change.lineId,
            tenantId: context.tenantId,
          },
        },
      });
      if (progress?.shippedBase.greaterThan(0))
        throw new AppError(
          'ORDER_CHANGE_IRREVERSIBLE',
          'Shipped quantity cannot be changed',
          409,
        );
    }
    const domains = new Set<string>(['BILLING']);
    if (ids.length)
      domains.add(
        ['ALLOCATED', 'RELEASED'].includes(order.status) ? 'WMS' : 'INVENTORY',
      );
    if (
      input.deliveryAddressId ||
      input.requestedFrom ||
      input.requestedUntil ||
      input.serviceLevel
    )
      domains.add(order.status === 'RELEASED' ? 'TMS' : 'PLANNING');
    const impact = {
      domains: [...domains],
      orderStatus: order.status,
      reservations: order.status === 'ALLOCATED',
      shipments: order.status === 'RELEASED',
    };
    return this.prisma.$transaction(async (tx) => {
      const change = await tx.orderChange.create({
        data: {
          businessOrderId: orderId,
          createdBy: context.accountId,
          id: randomUUID(),
          impactAssessment: json(impact),
          orderVersion: order.version,
          requestedChanges: json(input),
          requiredDomains: [...domains],
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      for (const domain of domains)
        await tx.changeDomainConfirmation.create({
          data: {
            createdBy: context.accountId,
            domain,
            id: randomUUID(),
            orderChangeId: change.id,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      await this.record(
        tx,
        change.id,
        'OrderChange',
        change.version,
        'order.change-requested.v1',
        context,
        metadata,
        { changeId: change.id, orderId, requiredDomains: [...domains] },
      );
      return {
        changeId: change.id,
        impact,
        status: change.status,
        version: change.version,
      };
    });
  }

  async confirmChange(
    changeId: string,
    input: ConfirmChangeInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(changeId, 'ORDER_CHANGE_NOT_FOUND');
    const domain = input.domain.trim().toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      const change = await tx.orderChange.findFirst({
        where: {
          id: changeId,
          status: 'PENDING_CONFIRMATIONS',
          tenantId: context.tenantId,
        },
      });
      if (!change)
        throw new AppError(
          'ORDER_CHANGE_NOT_PENDING',
          'Pending order change was not found',
          404,
        );
      const confirmation = await tx.changeDomainConfirmation.findUnique({
        where: {
          tenantId_orderChangeId_domain: {
            domain,
            orderChangeId: changeId,
            tenantId: context.tenantId,
          },
        },
      });
      if (!confirmation || confirmation.status !== 'PENDING')
        throw new AppError(
          'ORDER_CHANGE_CONFIRMATION_INVALID',
          'Domain confirmation is not pending',
          409,
        );
      await tx.changeDomainConfirmation.update({
        data: {
          confirmedAt: new Date(),
          reason: input.reason?.trim() ?? null,
          status: input.accepted ? 'ACCEPTED' : 'REJECTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: confirmation.id },
      });
      if (!input.accepted) {
        const rejected = await tx.orderChange.update({
          data: {
            failureReason: input.reason?.trim() ?? `${domain} rejected`,
            status: 'REJECTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: change.id },
        });
        await this.record(
          tx,
          change.id,
          'OrderChange',
          rejected.version,
          'order.change-rejected.v1',
          context,
          metadata,
          { changeId, domain },
        );
        return { changeId, status: rejected.status, version: rejected.version };
      }
      const pending = await tx.changeDomainConfirmation.count({
        where: {
          orderChangeId: changeId,
          status: 'PENDING',
          tenantId: context.tenantId,
        },
      });
      if (pending)
        return {
          changeId,
          pending,
          status: change.status,
          version: change.version,
        };
      return this.applyChange(tx, change, context, metadata);
    });
  }

  async cancel(
    orderId: string,
    input: CancelOrderInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId, 'ORDER_NOT_FOUND');
    if (!input.reason?.trim())
      throw new AppError(
        'ORDER_CANCEL_REASON_REQUIRED',
        'Cancellation reason is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.businessOrder.findFirst({
        where: { id: orderId, tenantId: context.tenantId },
      });
      if (!order)
        throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
      if (order.version !== input.expectedVersion) throw this.conflict();
      if (!['OPEN', 'APPROVED', 'ALLOCATED', 'RELEASED'].includes(order.status))
        throw new AppError(
          'ORDER_CANCEL_STATE_INVALID',
          'Order cannot be cancelled in this state',
          409,
        );
      if (
        order.status === 'RELEASED' &&
        (await tx.fulfillmentOrder.count({
          where: {
            businessOrderId: orderId,
            status: { in: ['EXECUTING', 'COMPLETED'] },
            tenantId: context.tenantId,
          },
        }))
      )
        throw new AppError(
          'ORDER_CANCEL_IRREVERSIBLE',
          'Execution is irreversible; create RMA or compensation',
          409,
        );
      const allocations = await tx.orderAllocation.findMany({
        where: {
          businessOrderId: orderId,
          status: 'RESERVED',
          tenantId: context.tenantId,
        },
      });
      for (const allocation of allocations) {
        if (allocation.projectionId)
          await tx.inventoryAvailabilityProjection.update({
            data: {
              allocated: { decrement: allocation.quantityBase },
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: allocation.projectionId },
          });
        await tx.orderAllocation.update({
          data: {
            releasedAt: new Date(),
            status: 'RELEASED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: allocation.id },
        });
      }
      if (order.status === 'RELEASED') {
        await tx.fulfillmentOrder.updateMany({
          data: {
            status: 'CANCELLED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            businessOrderId: orderId,
            status: { in: ['DRAFT', 'RELEASED', 'ACCEPTED'] },
            tenantId: context.tenantId,
          },
        });
        await tx.shipmentRequest.updateMany({
          data: {
            status: 'CANCELLED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            businessOrderId: orderId,
            status: { in: ['OPEN', 'SUBMITTED', 'ACCEPTED'] },
            tenantId: context.tenantId,
          },
        });
      }
      const changed = await tx.businessOrder.update({
        data: {
          status: 'CANCELLED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: orderId },
      });
      await this.record(
        tx,
        orderId,
        'BusinessOrder',
        changed.version,
        'order.cancelled.v1',
        context,
        metadata,
        { orderId, previousStatus: order.status, reason: input.reason },
      );
      if (order.status === 'RELEASED')
        await this.record(
          tx,
          orderId,
          'BusinessOrder',
          changed.version,
          'order.execution-cancel-requested.v1',
          context,
          metadata,
          { orderId, reason: input.reason },
        );
      return { orderId, status: changed.status, version: changed.version };
    });
  }

  async progress(
    orderId: string,
    lineId: string,
    input: ProgressInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId, 'ORDER_NOT_FOUND');
    this.uuid(lineId, 'ORDER_LINE_NOT_FOUND');
    const line = await this.prisma.businessOrderLine.findFirst({
      where: {
        id: lineId,
        orderId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    if (!line?.quantityBase || !line.baseUom)
      throw new AppError(
        'ORDER_LINE_NOT_FOUND',
        'Order line was not found',
        404,
      );
    const lineQuantityBase = line.quantityBase;
    const lineBaseUom = line.baseUom;
    const values = {
      allocatedBase: quantity(input.allocatedBase, 'allocatedBase'),
      cancelledBase: quantity(input.cancelledBase, 'cancelledBase'),
      deliveredBase: quantity(input.deliveredBase, 'deliveredBase'),
      promisedBase: quantity(input.promisedBase, 'promisedBase'),
      shippedBase: quantity(input.shippedBase, 'shippedBase'),
    };
    if (
      !Number.isInteger(input.sourceVersion) ||
      input.sourceVersion < 1 ||
      values.deliveredBase.greaterThan(values.shippedBase) ||
      values.shippedBase.greaterThan(values.allocatedBase) ||
      values.allocatedBase.greaterThan(values.promisedBase) ||
      values.promisedBase
        .add(values.cancelledBase)
        .greaterThan(line.quantityBase)
    )
      throw new AppError(
        'ORDER_PROGRESS_CONSERVATION_VIOLATION',
        'Order line progress violates quantity conservation',
        409,
      );
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.orderLineProgress.findUnique({
        where: {
          tenantId_orderLineId: {
            orderLineId: lineId,
            tenantId: context.tenantId,
          },
        },
      });
      if (current && current.sourceVersion >= input.sourceVersion)
        return {
          applied: false,
          sourceVersion: current.sourceVersion,
          version: current.version,
        };
      const row = current
        ? await tx.orderLineProgress.update({
            data: {
              ...values,
              sourceVersion: input.sourceVersion,
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: current.id },
          })
        : await tx.orderLineProgress.create({
            data: {
              ...values,
              baseUom: lineBaseUom,
              businessOrderId: orderId,
              createdBy: context.accountId,
              id: randomUUID(),
              orderLineId: lineId,
              sourceVersion: input.sourceVersion,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
      const shortage = lineQuantityBase
        .sub(values.promisedBase)
        .sub(values.cancelledBase);
      const open = await tx.backorder.findFirst({
        where: {
          orderLineId: lineId,
          status: 'OPEN',
          tenantId: context.tenantId,
        },
      });
      if (shortage.lessThanOrEqualTo(0) && open)
        await tx.backorder.update({
          data: {
            resolvedAt: new Date(),
            status: 'RESOLVED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: open.id },
        });
      else if (shortage.greaterThan(0)) {
        if (open)
          await tx.backorder.update({
            data: {
              disposition: input.shortageDisposition ?? open.disposition,
              quantityBase: shortage,
              reason: input.shortageReason?.trim() ?? open.reason,
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: open.id },
          });
        else
          await tx.backorder.create({
            data: {
              baseUom: lineBaseUom,
              businessOrderId: orderId,
              createdBy: context.accountId,
              disposition: input.shortageDisposition ?? 'WAIT',
              id: randomUUID(),
              orderLineId: lineId,
              quantityBase: shortage,
              reason: input.shortageReason?.trim() ?? 'UNPROMISED_QUANTITY',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
      }
      await this.record(
        tx,
        row.id,
        'OrderLineProgress',
        row.version,
        'order.line-progressed.v1',
        context,
        metadata,
        { lineId, orderId, sourceVersion: row.sourceVersion },
      );
      return {
        applied: true,
        progressId: row.id,
        shortageBase: shortage.toString(),
        sourceVersion: row.sourceVersion,
        version: row.version,
      };
    });
  }

  async proposeSubstitution(
    orderId: string,
    lineId: string,
    input: ProposeSubstitutionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId, 'ORDER_NOT_FOUND');
    this.uuid(lineId, 'ORDER_LINE_NOT_FOUND');
    this.uuid(input.partnerId, 'SUBSTITUTION_INPUT_INVALID');
    this.uuid(input.replacementProductId, 'SUBSTITUTION_INPUT_INVALID');
    const order = await this.prisma.businessOrder.findFirst({
      where: {
        id: orderId,
        customerId: input.partnerId,
        tenantId: context.tenantId,
      },
    });
    const line = await this.prisma.businessOrderLine.findFirst({
      where: {
        id: lineId,
        orderId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    if (
      !order ||
      !line?.productId ||
      !line.quantityBase ||
      !line.quantityOriginal ||
      !line.baseUom ||
      !line.originalUom
    )
      throw new AppError(
        'SUBSTITUTION_SCOPE_INVALID',
        'Order line or partner scope is invalid',
        403,
      );
    const lineBaseUom = line.baseUom;
    const lineOriginalUom = line.originalUom;
    const lineProductId = line.productId;
    const lineQuantityBase = line.quantityBase;
    const base = quantity(input.quantityBase, 'quantityBase', true);
    const original = quantity(input.quantityOriginal, 'quantityOriginal', true);
    if (
      lineProductId === input.replacementProductId ||
      base.greaterThan(lineQuantityBase)
    )
      throw new AppError(
        'SUBSTITUTION_INPUT_INVALID',
        'Substitution product or quantity is invalid',
        400,
      );
    const respondBy = instant(input.respondBy, 'respondBy')!;
    if (respondBy <= new Date())
      throw new AppError(
        'SUBSTITUTION_EXPIRED',
        'Response deadline has passed',
        409,
      );
    const delta =
      input.priceDelta === undefined
        ? null
        : quantity(input.priceDelta, 'priceDelta');
    if ((delta === null) !== (input.currency === undefined))
      throw new AppError(
        'SUBSTITUTION_MONEY_INVALID',
        'Price delta requires currency',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.substitutionProposal.create({
        data: {
          baseUom: lineBaseUom,
          businessOrderId: orderId,
          compatibilitySnapshot: json(input.compatibility),
          createdBy: context.accountId,
          currency: input.currency?.trim().toUpperCase() ?? null,
          id: randomUUID(),
          orderLineId: lineId,
          originalProductId: lineProductId,
          originalUom: lineOriginalUom,
          partnerId: input.partnerId,
          priceDelta: delta,
          quantityBase: base,
          quantityOriginal: original,
          replacementProductId: input.replacementProductId,
          respondBy,
          tenantId: context.tenantId,
          timeoutPolicy: input.timeoutPolicy,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        row.id,
        'SubstitutionProposal',
        row.version,
        'order.substitution-proposed.v1',
        context,
        metadata,
        { orderId, proposalId: row.id },
      );
      return { proposalId: row.id, status: row.status, version: row.version };
    });
  }

  async decideSubstitution(
    id: string,
    input: DecideSubstitutionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'SUBSTITUTION_NOT_FOUND');
    this.uuid(input.partnerId, 'ORDER_PARTNER_SCOPE_DENIED');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.substitutionProposal.findFirst({
        where: { id, status: 'PENDING', tenantId: context.tenantId },
      });
      if (!row)
        throw new AppError(
          'SUBSTITUTION_NOT_PENDING',
          'Pending substitution was not found',
          404,
        );
      if (row.partnerId !== input.partnerId)
        throw new AppError(
          'ORDER_PARTNER_SCOPE_DENIED',
          'Partner cannot decide substitution',
          403,
        );
      if (row.respondBy <= new Date())
        throw new AppError(
          'SUBSTITUTION_EXPIRED',
          'Substitution response deadline passed',
          409,
        );
      const changed = await tx.substitutionProposal.update({
        data: {
          decidedAt: new Date(),
          decisionReason: input.reason?.trim() ?? null,
          status: input.accepted ? 'CONFIRMED' : 'REJECTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: row.id },
      });
      await this.record(
        tx,
        row.id,
        'SubstitutionProposal',
        changed.version,
        'order.substitution-decided.v1',
        context,
        metadata,
        {
          accepted: input.accepted,
          orderId: row.businessOrderId,
          proposalId: row.id,
        },
      );
      return { status: changed.status, version: changed.version };
    });
  }

  async expireSubstitutions(
    input: ExpireSubstitutionsInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const now = instant(input.now, 'now') ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.substitutionProposal.findMany({
        orderBy: { respondBy: 'asc' },
        take: limit,
        where: {
          respondBy: { lte: now },
          status: 'PENDING',
          tenantId: context.tenantId,
        },
      });
      let cancelled = 0;
      for (const row of rows) {
        await tx.substitutionProposal.update({
          data: {
            decidedAt: now,
            decisionReason: 'RESPONSE_DEADLINE_EXPIRED',
            status: 'EXPIRED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: row.id },
        });
        if (row.timeoutPolicy === 'CANCEL') {
          const result = await tx.backorder.updateMany({
            data: {
              resolvedAt: now,
              status: 'CANCELLED',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: {
              orderLineId: row.orderLineId,
              status: 'OPEN',
              tenantId: context.tenantId,
            },
          });
          cancelled += result.count;
        }
        await this.record(
          tx,
          row.id,
          'SubstitutionProposal',
          row.version + 1,
          'order.substitution-expired.v1',
          context,
          metadata,
          {
            orderId: row.businessOrderId,
            proposalId: row.id,
            timeoutPolicy: row.timeoutPolicy,
          },
        );
      }
      return { cancelled, expired: rows.length };
    });
  }

  async createRma(
    orderId: string,
    input: CreateRmaInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId, 'ORDER_NOT_FOUND');
    this.uuid(input.partnerId, 'ORDER_PARTNER_SCOPE_DENIED');
    const order = await this.order(orderId, context);
    if (order.customerId !== input.partnerId)
      throw new AppError(
        'ORDER_PARTNER_SCOPE_DENIED',
        'Partner cannot request return',
        403,
      );
    if (!input.lines.length || !input.reason.trim())
      throw new AppError(
        'RMA_INPUT_INVALID',
        'RMA lines and reason are required',
        400,
      );
    const returnBy = instant(input.returnBy, 'returnBy')!;
    if (returnBy <= new Date())
      throw new AppError(
        'RMA_WINDOW_EXPIRED',
        'Return window has expired',
        409,
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${context.tenantId}:rma:${orderId}`}))`;
      const lines = await tx.businessOrderLine.findMany({
        where: {
          id: { in: input.lines.map((x) => x.sourceOrderLineId) },
          orderId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      const existing = await tx.returnMerchandiseAuthorization.findMany({
        select: { id: true },
        where: {
          businessOrderId: orderId,
          status: { not: 'REJECTED' },
          tenantId: context.tenantId,
        },
      });
      for (const item of input.lines) {
        const line = lines.find((x) => x.id === item.sourceOrderLineId);
        if (!line?.productId || !line.baseUom || !line.originalUom)
          throw new AppError(
            'RMA_LINE_INVALID',
            'RMA source line is invalid',
            400,
          );
        const progress = await tx.orderLineProgress.findUnique({
          where: {
            tenantId_orderLineId: {
              orderLineId: line.id,
              tenantId: context.tenantId,
            },
          },
        });
        const prior = await tx.rmaLine.aggregate({
          _sum: { quantityBase: true },
          where: {
            rmaId: { in: existing.map((x) => x.id) },
            sourceOrderLineId: line.id,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        if (
          (prior._sum.quantityBase ?? new Prisma.Decimal(0))
            .add(quantity(item.quantityBase, 'quantityBase', true))
            .greaterThan(progress?.deliveredBase ?? 0)
        )
          throw new AppError(
            'RMA_QUANTITY_EXCEEDED',
            'Return quantity exceeds delivered quantity',
            409,
          );
      }
      const id = randomUUID();
      const rma = await tx.returnMerchandiseAuthorization.create({
        data: {
          businessOrderId: orderId,
          createdBy: context.accountId,
          id,
          partnerId: input.partnerId,
          reason: input.reason.trim(),
          returnBy,
          rmaNo: await businessNumber(
            this.prisma,
            'OMS_RETURN_MERCHANDISE_AUTHORIZATION',
            context,
            metadata,
            `rma:${orderId}:${order.version}`,
          ),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      for (const [index, item] of input.lines.entries()) {
        const line = lines.find((x) => x.id === item.sourceOrderLineId)!;
        await tx.rmaLine.create({
          data: {
            baseUom: line.baseUom!,
            createdBy: context.accountId,
            id: randomUUID(),
            itemCondition: item.itemCondition.trim(),
            lineNo: index + 1,
            originalUom: line.originalUom!,
            productId: line.productId!,
            quantityBase: quantity(item.quantityBase, 'quantityBase', true),
            quantityOriginal: quantity(
              item.quantityOriginal,
              'quantityOriginal',
              true,
            ),
            rmaId: rma.id,
            sourceOrderLineId: line.id,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      await this.record(
        tx,
        rma.id,
        'RMA',
        rma.version,
        'rma.requested.v1',
        context,
        metadata,
        { orderId, rmaId: rma.id },
      );
      return { rmaId: rma.id, status: rma.status, version: rma.version };
    });
  }

  async transitionRma(
    id: string,
    input: TransitionRmaInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'RMA_NOT_FOUND');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.returnMerchandiseAuthorization.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row) throw new AppError('RMA_NOT_FOUND', 'RMA was not found', 404);
      if (row.version !== input.expectedVersion) throw this.conflict();
      const allowed =
        (row.status === 'REQUESTED' &&
          ['AUTHORIZED', 'REJECTED'].includes(input.targetStatus)) ||
        (row.status === 'AUTHORIZED' && input.targetStatus === 'RECEIVED') ||
        (row.status === 'RECEIVED' && input.targetStatus === 'RESOLVED') ||
        (row.status === 'RESOLVED' && input.targetStatus === 'CLOSED');
      if (!allowed)
        throw new AppError(
          'RMA_TRANSITION_INVALID',
          `RMA transition ${row.status} -> ${input.targetStatus} is not allowed`,
          409,
        );
      if (input.targetStatus === 'RESOLVED' && !input.resolution)
        throw new AppError(
          'RMA_RESOLUTION_REQUIRED',
          'Resolution is required',
          400,
        );
      const reverseId =
        input.targetStatus === 'AUTHORIZED'
          ? randomUUID()
          : row.reverseShipmentRequestId;
      const changed = await tx.returnMerchandiseAuthorization.update({
        data: {
          closedAt: input.targetStatus === 'CLOSED' ? new Date() : row.closedAt,
          resolution: input.resolution ?? row.resolution,
          resolvedAt:
            input.targetStatus === 'RESOLVED' ? new Date() : row.resolvedAt,
          reverseShipmentRequestId: reverseId,
          status: input.targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: row.id },
      });
      await this.record(
        tx,
        row.id,
        'RMA',
        changed.version,
        `rma.${input.targetStatus.toLowerCase()}.v1`,
        context,
        metadata,
        {
          orderId: row.businessOrderId,
          reverseShipmentRequestId: reverseId,
          rmaId: row.id,
        },
      );
      return {
        reverseShipmentRequestId: reverseId,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  private async applyChange(
    tx: Prisma.TransactionClient,
    change: {
      id: string;
      businessOrderId: string;
      orderVersion: number;
      requestedChanges: Prisma.JsonValue;
      version: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const input = change.requestedChanges as unknown as CreateOrderChangeInput;
    const order = await tx.businessOrder.findFirst({
      where: { id: change.businessOrderId, tenantId: context.tenantId },
    });
    if (!order || order.version !== change.orderVersion) throw this.conflict();
    for (const lineChange of input.lineChanges ?? [])
      await tx.businessOrderLine.update({
        data: {
          quantityBase: quantity(lineChange.quantityBase, 'quantityBase', true),
          quantityOriginal: quantity(
            lineChange.quantityOriginal,
            'quantityOriginal',
            true,
          ),
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: lineChange.lineId },
      });
    const changed = await tx.businessOrder.update({
      data: {
        ...(input.deliveryAddressId
          ? {
              deliveryAddressId: input.deliveryAddressId,
              deliveryAddressSnapshot: json(input.deliveryAddressSnapshot),
            }
          : {}),
        ...(input.requestedFrom
          ? { requestedFrom: instant(input.requestedFrom, 'requestedFrom') }
          : {}),
        ...(input.requestedUntil
          ? { requestedUntil: instant(input.requestedUntil, 'requestedUntil') }
          : {}),
        ...(input.serviceLevel
          ? {
              extensions: {
                ...((order.extensions as Record<string, unknown>) ?? {}),
                serviceLevel: input.serviceLevel,
              },
            }
          : {}),
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: order.id },
    });
    const applied = await tx.orderChange.update({
      data: {
        appliedOrderVersion: changed.version,
        status: 'APPLIED',
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: { id: change.id },
    });
    await Promise.all([
      tx.orderVersion.create({
        data: {
          businessOrderId: order.id,
          changeReason: 'ORDER_CHANGE_APPLIED',
          createdBy: context.accountId,
          id: randomUUID(),
          snapshot: json({ changes: input, order: changed }),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          versionNumber: changed.version,
        },
      }),
      tx.changeSet.create({
        data: {
          businessOrderId: order.id,
          changes: json(input),
          createdBy: context.accountId,
          fromVersion: order.version,
          id: randomUUID(),
          source: order.channel,
          tenantId: context.tenantId,
          toVersion: changed.version,
          updatedBy: context.accountId,
        },
      }),
    ]);
    await this.record(
      tx,
      change.id,
      'OrderChange',
      applied.version,
      'order.change-applied.v1',
      context,
      metadata,
      { changeId: change.id, orderId: order.id, orderVersion: changed.version },
    );
    return {
      changeId: change.id,
      orderVersion: changed.version,
      status: applied.status,
      version: applied.version,
    };
  }
  private async order(id: string, context: TenantContext) {
    const row = await this.prisma.businessOrder.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!row) throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
    return row;
  }
  private uuid(id: string, code: string) {
    if (!isUuid(id)) throw new AppError(code, 'Resource was not found', 404);
  }
  private conflict() {
    return new AppError(
      'ORDER_VERSION_CONFLICT',
      'Resource changed; refresh and retry',
      409,
      { retryable: true },
    );
  }
  private async record(
    tx: Prisma.TransactionClient,
    id: string,
    type: string,
    version: number,
    event: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      tx.platformAuditLog.create({
        data: {
          action: event,
          after: payload,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: id,
          resourceType: type,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType: type,
          aggregateVersion: version,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName: event,
          partitionKey: id,
          payload: { ...payload, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
}
