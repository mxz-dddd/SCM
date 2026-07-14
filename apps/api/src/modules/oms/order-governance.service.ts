import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type BusinessOrder, type OrderStatus } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import type { CommandMetadata } from '../platform/tenant.service';

export interface ReviewOrderInput {
  readonly approvalInstanceId?: string;
  readonly autoApproveLimit?: string;
  readonly creditAvailable?: string;
  readonly expectedVersion: number;
  readonly prohibited?: boolean;
  readonly riskFlags?: readonly string[];
}

export interface ReviewDecisionInput {
  readonly approvalInstanceId: string;
  readonly approved: boolean;
  readonly expectedVersion: number;
}

export interface MergeOrdersInput {
  readonly members: readonly { readonly expectedVersion: number; readonly orderId: string }[];
}

export interface SplitOrderInput {
  readonly allocations: readonly {
    readonly amount?: string;
    readonly childBusinessRef: string;
    readonly quantityBase: string;
    readonly quantityOriginal: string;
    readonly sourceLineId: string;
  }[];
  readonly expectedVersion: number;
}

export interface SetPriorityInput {
  readonly expectedVersion: number;
  readonly expedited?: boolean;
  readonly factors?: Readonly<Record<string, unknown>>;
  readonly lineId?: string;
  readonly priority: number;
  readonly ruleVersion: string;
  readonly vip?: boolean;
}

export interface PlaceHoldInput {
  readonly expectedVersion: number;
  readonly holdType: string;
  readonly lineId?: string;
  readonly reason: string;
}

export interface ReleaseHoldInput {
  readonly expectedVersion: number;
  readonly reason: string;
}

export function assertReviewTransition(current: OrderStatus, target: OrderStatus): void {
  const allowed =
    (current === 'OPEN' && ['APPROVED', 'REJECTED', 'HOLD'].includes(target)) ||
    (current === 'APPROVED' && target === 'HOLD') ||
    (current === 'HOLD' && ['OPEN', 'APPROVED', 'REJECTED'].includes(target));
  if (!allowed)
    throw new AppError(
      'ORDER_TRANSITION_INVALID',
      `Order transition ${current} -> ${target} is not allowed`,
      409,
    );
}

function decimal(value: string | undefined, field: string, allowZero = true) {
  if (value === undefined) return null;
  try {
    const parsed = new Prisma.Decimal(value);
    if (!parsed.isFinite() || parsed.isNegative() || (!allowZero && parsed.isZero()))
      throw new Error('range');
    return parsed;
  } catch {
    throw new AppError('ORDER_DECIMAL_INVALID', `${field} must be a valid decimal`, 400);
  }
}

function required(value: string, field: string, max: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max)
    throw new AppError('ORDER_INPUT_INVALID', `${field} is required`, 400);
  return normalized;
}

function json(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonObject;
}

@Injectable()
export class OrderGovernanceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async review(
    orderId: string,
    input: ReviewOrderInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId);
    const limit = decimal(input.autoApproveLimit ?? '10000', 'autoApproveLimit')!;
    const credit = decimal(input.creditAvailable, 'creditAvailable');
    if (input.approvalInstanceId && !isUuid(input.approvalInstanceId))
      throw new AppError('APPROVAL_INSTANCE_INVALID', 'Approval instance is invalid', 400);
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.order(transaction, orderId, context);
      this.expected(order.version, input.expectedVersion);
      if (order.status !== 'OPEN')
        throw new AppError('ORDER_REVIEW_STATE_INVALID', 'Only open orders can be reviewed', 409);
      const findings: { code: string; message: string }[] = [];
      if (order.totalAmount?.greaterThan(limit))
        findings.push({ code: 'AMOUNT_LIMIT', message: 'Order amount exceeds auto approval limit' });
      if (credit && order.totalAmount?.greaterThan(credit))
        findings.push({ code: 'CREDIT_LIMIT', message: 'Order amount exceeds available credit' });
      if (input.prohibited)
        findings.push({ code: 'PROHIBITED', message: 'Order contains a prohibited category or route' });
      for (const flag of input.riskFlags ?? [])
        findings.push({ code: 'RISK_FLAG', message: required(flag, 'riskFlags', 300) });
      if (findings.length && !input.approvalInstanceId)
        throw new AppError(
          'ORDER_APPROVAL_INSTANCE_REQUIRED',
          'Risk findings require a workflow approval instance',
          409,
        );
      const target: OrderStatus = findings.length ? 'HOLD' : 'APPROVED';
      assertReviewTransition(order.status, target);
      const changed = await transaction.businessOrder.update({
        data: { status: target, updatedBy: context.accountId, version: { increment: 1 } },
        where: { id: order.id },
      });
      const review = await transaction.orderReview.create({
        data: {
          approvalInstanceId: input.approvalInstanceId ?? null,
          businessOrderId: order.id,
          createdBy: context.accountId,
          decidedAt: findings.length ? null : new Date(),
          decidedBy: findings.length ? null : context.accountId,
          findings: JSON.parse(JSON.stringify(findings)) as Prisma.InputJsonArray,
          id: randomUUID(),
          inputSnapshot: json(input),
          orderVersion: order.version,
          status: findings.length ? 'PENDING_APPROVAL' : 'AUTO_APPROVED',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      if (findings.length)
        await transaction.orderHold.create({
          data: {
            businessOrderId: order.id,
            createdBy: context.accountId,
            holdType: 'MANUAL_REVIEW',
            id: randomUUID(),
            previousOrderStatus: order.status,
            reason: `Pending review ${review.id}`,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      await this.versionAndRecord(
        transaction,
        order,
        changed,
        `order.review-${review.status.toLowerCase()}.v1`,
        context,
        metadata,
        { findings, reviewId: review.id, status: target },
      );
      return {
        findings,
        orderId,
        reviewId: review.id,
        reviewStatus: review.status,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async decideReview(
    reviewId: string,
    input: ReviewDecisionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(reviewId);
    this.uuid(input.approvalInstanceId);
    return this.prisma.$transaction(async (transaction) => {
      const review = await transaction.orderReview.findFirst({
        where: { id: reviewId, status: 'PENDING_APPROVAL', tenantId: context.tenantId },
      });
      if (!review)
        throw new AppError('ORDER_REVIEW_NOT_PENDING', 'Pending order review was not found', 404);
      if (review.approvalInstanceId !== input.approvalInstanceId)
        throw new AppError('ORDER_REVIEW_APPROVAL_MISMATCH', 'Approval instance does not match', 409);
      const order = await this.order(transaction, review.businessOrderId, context);
      this.expected(order.version, input.expectedVersion);
      const target: OrderStatus = input.approved ? 'APPROVED' : 'REJECTED';
      assertReviewTransition(order.status, target);
      const changed = await transaction.businessOrder.update({
        data: { status: target, updatedBy: context.accountId, version: { increment: 1 } },
        where: { id: order.id },
      });
      await transaction.orderReview.update({
        data: {
          decidedAt: new Date(),
          decidedBy: context.accountId,
          status: input.approved ? 'APPROVED' : 'REJECTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: review.id },
      });
      await transaction.orderHold.updateMany({
        data: {
          releaseReason: 'Review decision completed',
          releasedAt: new Date(),
          releasedBy: context.accountId,
          status: 'RELEASED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          businessOrderId: order.id,
          holdType: 'MANUAL_REVIEW',
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      await this.versionAndRecord(
        transaction,
        order,
        changed,
        input.approved ? 'order.approved.v1' : 'order.rejected.v1',
        context,
        metadata,
        { reviewId, status: target },
      );
      return { orderId: order.id, reviewId, status: changed.status, version: changed.version };
    });
  }

  async merge(
    input: MergeOrdersInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (input.members.length < 2 || new Set(input.members.map(({ orderId }) => orderId)).size !== input.members.length)
      throw new AppError('ORDER_MERGE_MEMBERS_INVALID', 'At least two unique orders are required', 400);
    for (const member of input.members) this.uuid(member.orderId);
    return this.prisma.$transaction(async (transaction) => {
      const orders = await transaction.businessOrder.findMany({
        orderBy: { id: 'asc' },
        where: { id: { in: input.members.map(({ orderId }) => orderId) }, tenantId: context.tenantId },
      });
      if (orders.length !== input.members.length)
        throw new AppError('ORDER_MERGE_MEMBER_NOT_FOUND', 'A merge order was not found', 404);
      for (const order of orders) {
        const expected = input.members.find(({ orderId }) => orderId === order.id)!.expectedVersion;
        this.expected(order.version, expected);
        if (!['OPEN', 'APPROVED'].includes(order.status))
          throw new AppError('ORDER_MERGE_STATE_INVALID', 'Only open or approved orders can merge', 409);
      }
      const first = orders[0]!;
      if (
        !first.customerId ||
        !first.deliveryAddressId ||
        orders.some(
          (order) =>
            order.customerId !== first.customerId ||
            order.deliveryAddressId !== first.deliveryAddressId ||
            order.currency !== first.currency,
        )
      )
        throw new AppError(
          'ORDER_MERGE_DIMENSION_MISMATCH',
          'Merge orders must share customer, address and currency',
          409,
        );
      const lines = await transaction.businessOrderLine.findMany({
        orderBy: [{ orderId: 'asc' }, { lineNo: 'asc' }],
        where: {
          orderId: { in: orders.map(({ id }) => id) },
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      const aggregateAmount = orders.reduce(
        (sum, order) => sum.add(order.totalAmount ?? 0),
        new Prisma.Decimal(0),
      );
      const group = await transaction.orderMergeGroup.create({
        data: {
          addressId: first.deliveryAddressId,
          aggregateAmount: first.currency ? aggregateAmount : null,
          allocationSnapshot: json({ orderIds: orders.map(({ id }) => id) }),
          code: `MRG-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`,
          createdBy: context.accountId,
          currency: first.currency,
          customerId: first.customerId,
          id: randomUUID(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      for (const order of orders) {
        const memberLines = lines.filter(({ orderId }) => orderId === order.id);
        await transaction.orderMergeMember.create({
          data: {
            amountAllocation: order.totalAmount,
            businessOrderId: order.id,
            createdBy: context.accountId,
            id: randomUUID(),
            mergeGroupId: group.id,
            orderSnapshot: json(order),
            orderVersion: order.version,
            quantityAllocation: json({
              lines: memberLines.map(({ baseUom, lineNo, productId, quantityBase }) => ({
                baseUom,
                lineNo,
                productId,
                quantityBase: quantityBase?.toString() ?? null,
              })),
            }),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      await this.record(
        transaction,
        first,
        'order.merge-group-created.v1',
        context,
        metadata,
        { mergeGroupId: group.id, orderIds: orders.map(({ id }) => id) },
      );
      return {
        aggregateAmount: first.currency ? aggregateAmount.toString() : null,
        currency: first.currency,
        mergeGroupId: group.id,
        memberCount: orders.length,
      };
    });
  }

  async split(
    orderId: string,
    input: SplitOrderInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId);
    if (input.allocations.length < 2)
      throw new AppError('ORDER_SPLIT_ALLOCATIONS_INVALID', 'At least two split allocations are required', 400);
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.order(transaction, orderId, context);
      this.expected(order.version, input.expectedVersion);
      if (!['OPEN', 'APPROVED'].includes(order.status))
        throw new AppError('ORDER_SPLIT_STATE_INVALID', 'Only open or approved orders can split', 409);
      const lines = await transaction.businessOrderLine.findMany({
        where: { orderId, status: 'ACTIVE', tenantId: context.tenantId },
      });
      const lineIds = new Set(input.allocations.map(({ sourceLineId }) => sourceLineId));
      if (lineIds.size !== lines.length || lines.some(({ id }) => !lineIds.has(id)))
        throw new AppError('ORDER_SPLIT_LINES_INCOMPLETE', 'Every active source line must be allocated', 409);
      for (const line of lines) {
        const allocations = input.allocations.filter(({ sourceLineId }) => sourceLineId === line.id);
        if (!line.quantityOriginal || !line.quantityBase || !line.originalUom || !line.baseUom)
          throw new AppError('ORDER_SPLIT_LINE_INVALID', 'Source line quantities are incomplete', 409);
        const original = allocations.reduce(
          (sum, allocation) => sum.add(decimal(allocation.quantityOriginal, 'quantityOriginal', false)!),
          new Prisma.Decimal(0),
        );
        const base = allocations.reduce(
          (sum, allocation) => sum.add(decimal(allocation.quantityBase, 'quantityBase', false)!),
          new Prisma.Decimal(0),
        );
        if (!original.equals(line.quantityOriginal) || !base.equals(line.quantityBase))
          throw new AppError('ORDER_SPLIT_QUANTITY_MISMATCH', 'Split quantities must equal source quantities', 409);
      }
      const amounts = input.allocations.map(({ amount }) => decimal(amount, 'amount'));
      if (order.totalAmount) {
        if (amounts.some((amount) => amount === null))
          throw new AppError('ORDER_SPLIT_AMOUNT_REQUIRED', 'Every split requires an amount allocation', 409);
        let total = new Prisma.Decimal(0);
        for (const amount of amounts) total = total.add(amount!);
        if (!total.equals(order.totalAmount))
          throw new AppError('ORDER_SPLIT_AMOUNT_MISMATCH', 'Split amounts must equal order amount', 409);
      }
      const splitGroupId = randomUUID();
      for (const [index, allocation] of input.allocations.entries()) {
        const line = lines.find(({ id }) => id === allocation.sourceLineId)!;
        await transaction.orderSplitRelation.create({
          data: {
            amountAllocation: amounts[index] ?? null,
            baseUom: line.baseUom!,
            childBusinessRef: required(allocation.childBusinessRef, 'childBusinessRef', 200),
            createdBy: context.accountId,
            currency: order.totalAmount ? order.currency : null,
            id: randomUUID(),
            originalUom: line.originalUom!,
            quantityBase: decimal(allocation.quantityBase, 'quantityBase', false)!,
            quantityOriginal: decimal(allocation.quantityOriginal, 'quantityOriginal', false)!,
            sourceLineId: line.id,
            sourceOrderId: order.id,
            sourceOrderVersion: order.version,
            splitGroupId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      await this.record(transaction, order, 'order.split-created.v1', context, metadata, {
        allocations: input.allocations.length,
        splitGroupId,
      });
      return { allocationCount: input.allocations.length, orderId, splitGroupId };
    });
  }

  async setPriority(
    orderId: string,
    input: SetPriorityInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId);
    if (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 100)
      throw new AppError('ORDER_PRIORITY_INVALID', 'Priority must be between 1 and 100', 400);
    if (input.lineId) this.uuid(input.lineId);
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.order(transaction, orderId, context);
      this.expected(order.version, input.expectedVersion);
      if (!['OPEN', 'APPROVED', 'HOLD'].includes(order.status))
        throw new AppError('ORDER_PRIORITY_STATE_INVALID', 'Order priority cannot change in this state', 409);
      const line = input.lineId
        ? await transaction.businessOrderLine.findFirst({
            where: { id: input.lineId, orderId, status: 'ACTIVE', tenantId: context.tenantId },
          })
        : null;
      if (input.lineId && !line)
        throw new AppError('ORDER_LINE_NOT_FOUND', 'Active order line was not found', 404);
      const previousPriority = line?.priority ?? order.priority;
      const changed = await transaction.businessOrder.update({
        data: {
          ...(line ? {} : { expedited: input.expedited ?? order.expedited, priority: input.priority, vip: input.vip ?? order.vip }),
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: order.id },
      });
      if (line)
        await transaction.businessOrderLine.update({
          data: { priority: input.priority, updatedBy: context.accountId, version: { increment: 1 } },
          where: { id: line.id },
        });
      const eligible = line?.quantityBase?.minus(line.executedQuantityBase) ?? null;
      const decision = await transaction.priorityDecision.create({
        data: {
          baseUom: line?.baseUom ?? null,
          businessOrderId: order.id,
          createdBy: context.accountId,
          factors: json({ expedited: input.expedited, vip: input.vip, ...input.factors }),
          id: randomUUID(),
          orderLineId: line?.id ?? null,
          previousPriority,
          priority: input.priority,
          reallocationEligibleQuantity: eligible,
          ruleVersion: required(input.ruleVersion, 'ruleVersion', 100),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.versionAndRecord(
        transaction,
        order,
        changed,
        'order.priority-changed.v1',
        context,
        metadata,
        {
          decisionId: decision.id,
          executedQuantityPreserved: line?.executedQuantityBase.toString() ?? null,
          priority: input.priority,
          reallocationEligibleQuantity: eligible?.toString() ?? null,
        },
      );
      return {
        decisionId: decision.id,
        orderId,
        priority: input.priority,
        reallocationEligibleQuantity: eligible?.toString() ?? null,
        version: changed.version,
      };
    });
  }

  async hold(
    orderId: string,
    input: PlaceHoldInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(orderId);
    if (input.lineId) this.uuid(input.lineId);
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.order(transaction, orderId, context);
      this.expected(order.version, input.expectedVersion);
      if (!['OPEN', 'APPROVED', 'HOLD'].includes(order.status))
        throw new AppError('ORDER_HOLD_STATE_INVALID', 'Order cannot be held in this state', 409);
      if (input.lineId && !(await transaction.businessOrderLine.findFirst({ where: { id: input.lineId, orderId, status: 'ACTIVE', tenantId: context.tenantId } })))
        throw new AppError('ORDER_LINE_NOT_FOUND', 'Active order line was not found', 404);
      const previous = order.status === 'HOLD'
        ? (await transaction.orderHold.findFirst({ orderBy: { createdAt: 'asc' }, where: { businessOrderId: orderId, orderLineId: null, status: 'ACTIVE', tenantId: context.tenantId } }))?.previousOrderStatus ?? 'OPEN'
        : order.status;
      if (!input.lineId && order.status !== 'HOLD') assertReviewTransition(order.status, 'HOLD');
      const changed = await transaction.businessOrder.update({
        data: {
          ...(input.lineId ? {} : { status: 'HOLD' as const }),
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: order.id },
      });
      const hold = await transaction.orderHold.create({
        data: {
          businessOrderId: orderId,
          createdBy: context.accountId,
          holdType: required(input.holdType, 'holdType', 100).toUpperCase(),
          id: randomUUID(),
          orderLineId: input.lineId ?? null,
          previousOrderStatus: previous,
          reason: required(input.reason, 'reason', 1000),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.versionAndRecord(transaction, order, changed, 'order.held.v1', context, metadata, {
        holdId: hold.id,
        lineId: hold.orderLineId,
        status: changed.status,
      });
      return { holdId: hold.id, orderId, status: changed.status, version: changed.version };
    });
  }

  async releaseHold(
    holdId: string,
    input: ReleaseHoldInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(holdId);
    return this.prisma.$transaction(async (transaction) => {
      const hold = await transaction.orderHold.findFirst({
        where: { id: holdId, status: 'ACTIVE', tenantId: context.tenantId },
      });
      if (!hold) throw new AppError('ORDER_HOLD_NOT_ACTIVE', 'Active order hold was not found', 404);
      const order = await this.order(transaction, hold.businessOrderId, context);
      this.expected(order.version, input.expectedVersion);
      let target = order.status;
      if (!hold.orderLineId) {
        const remaining = await transaction.orderHold.count({
          where: {
            businessOrderId: order.id,
            id: { not: hold.id },
            orderLineId: null,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        if (!remaining) {
          target = hold.previousOrderStatus;
          assertReviewTransition(order.status, target);
        }
      }
      const changed = await transaction.businessOrder.update({
        data: { status: target, updatedBy: context.accountId, version: { increment: 1 } },
        where: { id: order.id },
      });
      await transaction.orderHold.update({
        data: {
          releaseReason: required(input.reason, 'reason', 1000),
          releasedAt: new Date(),
          releasedBy: context.accountId,
          status: 'RELEASED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: hold.id },
      });
      await this.versionAndRecord(
        transaction,
        order,
        changed,
        'order.hold-released.v1',
        context,
        metadata,
        { holdId, status: target },
      );
      return { holdId, orderId: order.id, status: changed.status, version: changed.version };
    });
  }

  private async versionAndRecord(
    transaction: Prisma.TransactionClient,
    before: BusinessOrder,
    after: BusinessOrder,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    details: Prisma.InputJsonObject,
  ) {
    const lines = await transaction.businessOrderLine.findMany({
      orderBy: { lineNo: 'asc' },
      where: { orderId: after.id, status: 'ACTIVE', tenantId: context.tenantId },
    });
    await Promise.all([
      transaction.orderVersion.create({
        data: {
          businessOrderId: after.id,
          changeReason: eventName.toUpperCase().replaceAll('.', '_'),
          createdBy: context.accountId,
          id: randomUUID(),
          snapshot: json({ lines, order: after }),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          versionNumber: after.version,
        },
      }),
      transaction.changeSet.create({
        data: {
          businessOrderId: after.id,
          changes: json({ details, status: { from: before.status, to: after.status } }),
          createdBy: context.accountId,
          fromVersion: before.version,
          id: randomUUID(),
          source: before.channel,
          tenantId: context.tenantId,
          toVersion: after.version,
          updatedBy: context.accountId,
        },
      }),
    ]);
    await this.record(transaction, after, eventName, context, metadata, details);
  }

  private async record(
    transaction: Prisma.TransactionClient,
    order: { readonly id: string; readonly orderNo: string; readonly version: number },
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    after: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      transaction.platformAuditLog.create({
        data: {
          action: eventName,
          after,
          businessRef: order.orderNo,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: order.id,
          resourceType: 'BusinessOrder',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      transaction.platformOutbox.create({
        data: {
          aggregateId: order.id,
          aggregateType: 'BusinessOrder',
          aggregateVersion: order.version,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          partitionKey: order.id,
          payload: { orderId: order.id, orderNo: order.orderNo, ...after },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }

  private async order(
    transaction: Prisma.TransactionClient,
    orderId: string,
    context: TenantContext,
  ) {
    const order = await transaction.businessOrder.findFirst({
      where: { id: orderId, tenantId: context.tenantId },
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
    return order;
  }

  private expected(actual: number, expected: number) {
    if (!Number.isInteger(expected) || actual !== expected)
      throw new AppError('ORDER_VERSION_CONFLICT', 'Order changed; refresh and retry', 409, {
        retryable: true,
      });
  }

  private uuid(id: string) {
    if (!isUuid(id)) throw new AppError('ORDER_NOT_FOUND', 'Resource was not found', 404);
  }
}
