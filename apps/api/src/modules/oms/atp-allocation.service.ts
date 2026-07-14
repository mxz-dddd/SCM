import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type AllocationStatus,
  type BusinessOrderLine,
  type InventoryAvailabilityProjection,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { RuleEvaluationFacade } from '../platform/public/rule-evaluation.facade';
import type { CommandMetadata } from '../platform/tenant.service';

export interface ProjectAvailabilityInput {
  readonly allocated?: string;
  readonly baseUom: string;
  readonly batchNo?: string;
  readonly expectedInbound?: string;
  readonly hold?: string;
  readonly inTransit?: string;
  readonly onHand: string;
  readonly ownerId: string;
  readonly productId: string;
  readonly promiseDate?: string;
  readonly safetyStock?: string;
  readonly snapshotAt: string;
  readonly sourceVersion: number;
  readonly uncertainty?: string;
  readonly warehouseId: string;
}

export interface PromiseAvailabilityInput {
  readonly baseUom: string;
  readonly ownerId: string;
  readonly productId: string;
  readonly quantity: string;
}

export interface AllocateOrderInput {
  readonly expectedVersion: number;
  readonly ownerId: string;
  readonly ruleSetCode: string;
}

export interface ReleaseAllocationInput {
  readonly expectedVersion: number;
}

type AllocationEvaluation = Awaited<
  ReturnType<RuleEvaluationFacade['evaluateAllocation']>
>;
interface EvaluatedLine {
  readonly hardExclusions: readonly {
    candidateId: string;
    reason: string;
    ruleId: string;
  }[];
  readonly line: BusinessOrderLine;
  readonly projections: readonly InventoryAvailabilityProjection[];
  readonly result: AllocationEvaluation;
}

function quantity(value: string | undefined, field: string, positive = false) {
  try {
    const result = new Prisma.Decimal(value ?? '0');
    if (
      !result.isFinite() ||
      result.isNegative() ||
      (positive && result.isZero())
    )
      throw new Error();
    return result;
  } catch {
    throw new AppError(
      'ATP_QUANTITY_INVALID',
      `${field} must be a valid ${positive ? 'positive' : 'non-negative'} decimal`,
      400,
    );
  }
}

function uuid(value: string, field: string) {
  if (!isUuid(value))
    throw new AppError('ATP_INPUT_INVALID', `${field} is invalid`, 400);
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class AtpAllocationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RuleEvaluationFacade) private readonly rules: RuleEvaluationFacade,
  ) {}

  async project(
    input: ProjectAvailabilityInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    for (const [field, value] of [
      ['warehouseId', input.warehouseId],
      ['ownerId', input.ownerId],
      ['productId', input.productId],
    ] as const)
      uuid(value, field);
    if (
      !Number.isInteger(input.sourceVersion) ||
      input.sourceVersion < 1 ||
      !input.baseUom?.trim()
    )
      throw new AppError(
        'ATP_INPUT_INVALID',
        'sourceVersion and baseUom are required',
        400,
      );
    const snapshotAt = new Date(input.snapshotAt);
    const promiseDate = input.promiseDate ? new Date(input.promiseDate) : null;
    if (
      Number.isNaN(snapshotAt.valueOf()) ||
      (promiseDate && Number.isNaN(promiseDate.valueOf()))
    )
      throw new AppError(
        'ATP_INPUT_INVALID',
        'snapshotAt or promiseDate is invalid',
        400,
      );
    const values = {
      allocated: quantity(input.allocated, 'allocated'),
      expectedInbound: quantity(input.expectedInbound, 'expectedInbound'),
      hold: quantity(input.hold, 'hold'),
      inTransit: quantity(input.inTransit, 'inTransit'),
      onHand: quantity(input.onHand, 'onHand'),
      safetyStock: quantity(input.safetyStock, 'safetyStock'),
    };
    if (values.allocated.add(values.hold).greaterThan(values.onHand))
      throw new AppError(
        'ATP_PROJECTION_INVALID',
        'allocated plus hold cannot exceed onHand',
        409,
      );
    return this.prisma.$transaction(async (transaction) => {
      const natural = {
        tenantId: context.tenantId,
        warehouseId: input.warehouseId,
        ownerId: input.ownerId,
        productId: input.productId,
        batchNo: input.batchNo?.trim() ?? '',
      };
      const current =
        await transaction.inventoryAvailabilityProjection.findUnique({
          where: { tenantId_warehouseId_ownerId_productId_batchNo: natural },
        });
      if (current && current.sourceVersion >= input.sourceVersion)
        return {
          applied: false,
          projectionId: current.id,
          sourceVersion: current.sourceVersion,
          version: current.version,
        };
      const projection = current
        ? await transaction.inventoryAvailabilityProjection.update({
            data: {
              ...values,
              baseUom: input.baseUom.trim().toUpperCase(),
              promiseDate,
              snapshotAt,
              sourceVersion: input.sourceVersion,
              uncertainty:
                input.uncertainty?.trim().toUpperCase() ?? 'CONFIRMED',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: current.id },
          })
        : await transaction.inventoryAvailabilityProjection.create({
            data: {
              ...natural,
              ...values,
              baseUom: input.baseUom.trim().toUpperCase(),
              createdBy: context.accountId,
              id: randomUUID(),
              promiseDate,
              snapshotAt,
              sourceVersion: input.sourceVersion,
              uncertainty:
                input.uncertainty?.trim().toUpperCase() ?? 'CONFIRMED',
              updatedBy: context.accountId,
            },
          });
      await this.record(
        transaction,
        projection.id,
        'InventoryAvailabilityProjection',
        projection.version,
        'oms.availability-projected.v1',
        context,
        metadata,
        {
          productId: projection.productId,
          sourceVersion: projection.sourceVersion,
          warehouseId: projection.warehouseId,
        },
      );
      return {
        applied: true,
        projectionId: projection.id,
        sourceVersion: projection.sourceVersion,
        version: projection.version,
      };
    });
  }

  async list(productId: string, ownerId: string, context: TenantContext) {
    uuid(productId, 'productId');
    uuid(ownerId, 'ownerId');
    const items = await this.prisma.inventoryAvailabilityProjection.findMany({
      orderBy: [{ snapshotAt: 'desc' }, { warehouseId: 'asc' }],
      where: {
        ownerId,
        productId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    return {
      items: items.map((row) => this.availability(row)),
      snapshotAt: items.reduce<Date | null>(
        (latest, row) =>
          !latest || row.snapshotAt > latest ? row.snapshotAt : latest,
        null,
      ),
    };
  }

  async promise(
    input: PromiseAvailabilityInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    uuid(input.productId, 'productId');
    uuid(input.ownerId, 'ownerId');
    const requested = quantity(input.quantity, 'quantity', true);
    const rows = await this.prisma.inventoryAvailabilityProjection.findMany({
      where: {
        ownerId: input.ownerId,
        productId: input.productId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const components = rows.map((row) => this.availability(row));
    const availableNow = rows.reduce(
      (sum, row) =>
        sum.add(
          Prisma.Decimal.max(
            row.onHand.sub(row.allocated).sub(row.hold).sub(row.safetyStock),
            0,
          ),
        ),
      new Prisma.Decimal(0),
    );
    const projected = rows.reduce(
      (sum, row) =>
        sum.add(
          Prisma.Decimal.max(
            row.onHand
              .sub(row.allocated)
              .sub(row.hold)
              .add(row.inTransit)
              .add(row.expectedInbound)
              .sub(row.safetyStock),
            0,
          ),
        ),
      new Prisma.Decimal(0),
    );
    const snapshotAt = rows.reduce(
      (latest, row) => (row.snapshotAt > latest ? row.snapshotAt : latest),
      new Date(0),
    );
    const promiseDate = availableNow.greaterThanOrEqualTo(requested)
      ? new Date()
      : (rows
          .filter(
            (row) =>
              row.promiseDate && projected.greaterThanOrEqualTo(requested),
          )
          .map((row) => row.promiseDate!)
          .sort((a, b) => a.valueOf() - b.valueOf())[0] ?? null);
    const uncertainty =
      rows.length === 0
        ? 'NO_DATA'
        : rows.some((row) => row.uncertainty !== 'CONFIRMED')
          ? 'ESTIMATED'
          : projected.lessThan(requested)
            ? 'SHORTAGE'
            : 'CONFIRMED';
    const result = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.availabilityPromise.create({
        data: {
          availableNow,
          baseUom: input.baseUom.trim().toUpperCase(),
          componentSnapshot: json(components),
          createdBy: context.accountId,
          id: randomUUID(),
          ownerId: input.ownerId,
          productId: input.productId,
          projectedAvailable: projected,
          promiseDate,
          requestedQuantity: requested,
          snapshotAt,
          tenantId: context.tenantId,
          uncertainty,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        transaction,
        created.id,
        'AvailabilityPromise',
        created.version,
        'oms.availability-promised.v1',
        context,
        metadata,
        {
          availableNow: availableNow.toString(),
          productId: input.productId,
          projectedAvailable: projected.toString(),
          snapshotAt: snapshotAt.toISOString(),
          uncertainty,
        },
      );
      return created;
    });
    return { ...result, components };
  }

  async allocate(
    orderId: string,
    input: AllocateOrderInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    uuid(orderId, 'orderId');
    uuid(input.ownerId, 'ownerId');
    if (!input.ruleSetCode?.trim())
      throw new AppError(
        'ALLOCATION_RULE_REQUIRED',
        'ruleSetCode is required',
        400,
      );
    const order = await this.prisma.businessOrder.findFirst({
      where: { id: orderId, tenantId: context.tenantId },
    });
    if (!order)
      throw new AppError('ORDER_NOT_FOUND', 'Order was not found', 404);
    if (order.status !== 'APPROVED')
      throw new AppError(
        'ORDER_ALLOCATION_STATE_INVALID',
        'Only approved orders can be allocated',
        409,
      );
    if (order.version !== input.expectedVersion)
      throw new AppError(
        'ORDER_VERSION_CONFLICT',
        'Order changed; refresh and retry',
        409,
        { retryable: true },
      );
    if (
      await this.prisma.orderHold.count({
        where: {
          businessOrderId: orderId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      })
    )
      throw new AppError(
        'ORDER_ALLOCATION_HELD',
        'Held orders cannot be allocated',
        409,
      );
    const lines = await this.prisma.businessOrderLine.findMany({
      orderBy: { lineNo: 'asc' },
      where: { orderId, status: 'ACTIVE', tenantId: context.tenantId },
    });
    if (
      !lines.length ||
      lines.some(
        (line) =>
          !line.productId ||
          !line.quantityBase ||
          !line.quantityOriginal ||
          !line.baseUom ||
          !line.originalUom,
      )
    )
      throw new AppError(
        'ORDER_ALLOCATION_LINES_INVALID',
        'All active lines require product and dual quantity',
        409,
      );
    const evaluated: EvaluatedLine[] = [];
    for (const line of lines) {
      const projections =
        await this.prisma.inventoryAvailabilityProjection.findMany({
          where: {
            ownerId: input.ownerId,
            productId: line.productId!,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
      const needed = line.quantityBase!;
      const hardExclusions = projections
        .filter((row) =>
          row.onHand
            .sub(row.allocated)
            .sub(row.hold)
            .sub(row.safetyStock)
            .lessThan(needed),
        )
        .map((row) => ({
          candidateId: row.id,
          reason: 'INSUFFICIENT_AVAILABLE',
          ruleId: 'HARD_CAPACITY',
        }));
      const eligible = projections
        .filter(
          (row) =>
            !hardExclusions.some(({ candidateId }) => candidateId === row.id),
        )
        .map((row) => ({
          available: Number(
            row.onHand.sub(row.allocated).sub(row.hold).sub(row.safetyStock),
          ),
          id: row.id,
          promiseDate: row.promiseDate?.toISOString() ?? null,
          uncertainty: row.uncertainty,
          warehouseId: row.warehouseId,
        }));
      const result = await this.rules.evaluateAllocation(
        {
          candidates: eligible,
          facts: {
            expedited: order.expedited,
            orderPriority: order.priority,
            productId: line.productId,
            quantityBase: Number(needed),
            requestedUntil: order.requestedUntil?.toISOString() ?? null,
          },
          ruleSetCode: input.ruleSetCode,
        },
        context,
        {
          ...metadata,
          idempotencyKey: `${metadata.idempotencyKey ?? metadata.correlationId}:line:${line.id}`,
        },
      );
      evaluated.push({ hardExclusions, line, projections, result });
    }
    return this.prisma.$transaction(
      async (transaction) => {
        const current = await transaction.businessOrder.findFirst({
          where: { id: orderId, tenantId: context.tenantId },
        });
        if (
          !current ||
          current.status !== 'APPROVED' ||
          current.version !== input.expectedVersion
        )
          throw new AppError(
            'ORDER_VERSION_CONFLICT',
            'Order changed during allocation',
            409,
            { retryable: true },
          );
        const allocations: {
          id: string;
          projectionId: string | null;
          quantity: Prisma.Decimal;
          status: AllocationStatus;
        }[] = [];
        let failed = false;
        for (const item of evaluated) {
          const selectedId = item.result.decision.selectedCandidateId;
          const decision = await transaction.sourcingDecision.create({
            data: {
              businessOrderId: orderId,
              candidates: json(item.result.decision.candidates),
              createdBy: context.accountId,
              evaluationTraceId: item.result.evaluationTraceId,
              exclusions: json([
                ...item.hardExclusions,
                ...item.result.exclusions,
              ]),
              id: randomUUID(),
              inputSnapshot: json({
                lineId: item.line.id,
                quantityBase: item.line.quantityBase?.toString(),
              }),
              orderVersion: current.version,
              ruleSetCode: item.result.ruleSetCode,
              ruleSetVersionNumber: item.result.ruleSetVersionNumber,
              selectedCandidateId: selectedId,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          const projection = item.projections.find(
            ({ id }) => id === selectedId,
          );
          const allocationId = randomUUID();
          await transaction.orderAllocation.create({
            data: {
              baseUom: item.line.baseUom!,
              batchNo: projection?.batchNo ?? '',
              businessOrderId: orderId,
              createdBy: context.accountId,
              decisionId: decision.id,
              id: allocationId,
              orderLineId: item.line.id,
              originalUom: item.line.originalUom!,
              ownerId: input.ownerId,
              productId: item.line.productId!,
              projectionId: projection?.id ?? null,
              quantityBase: item.line.quantityBase!,
              quantityOriginal: item.line.quantityOriginal!,
              reservationKey: `${orderId}:${item.line.id}:${current.version}`,
              status: 'PROPOSED',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
              warehouseId: projection?.warehouseId ?? null,
            },
          });
          if (!projection || failed) {
            const failureCode = failed
              ? 'ALLOCATION_ROLLED_BACK'
              : 'NO_ELIGIBLE_CANDIDATE';
            await transaction.orderAllocation.update({
              data: {
                failureCode,
                status: 'FAILED',
                updatedBy: context.accountId,
                version: { increment: 1 },
              },
              where: { id: allocationId },
            });
            allocations.push({
              id: allocationId,
              projectionId: projection?.id ?? null,
              quantity: item.line.quantityBase!,
              status: 'FAILED',
            });
            failed = true;
            continue;
          }
          const changed = await transaction.$executeRaw(
            Prisma.sql`UPDATE "oms"."inventory_availability_projection" SET "allocated"="allocated"+${item.line.quantityBase!}, "version"="version"+1, "updated_at"=CURRENT_TIMESTAMP, "updated_by"=${context.accountId}::uuid WHERE "id"=${projection.id}::uuid AND "tenant_id"=${context.tenantId}::uuid AND "status"='ACTIVE' AND ("on_hand"-"allocated"-"hold"-"safety_stock") >= ${item.line.quantityBase!}`,
          );
          const status: AllocationStatus =
            changed === 1 ? 'RESERVED' : 'FAILED';
          await transaction.orderAllocation.update({
            data: {
              failureCode:
                status === 'FAILED' ? 'CONCURRENT_CAPACITY_EXHAUSTED' : null,
              reservedAt: status === 'RESERVED' ? new Date() : null,
              status,
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: allocationId },
          });
          allocations.push({
            id: allocationId,
            projectionId: projection.id,
            quantity: item.line.quantityBase!,
            status,
          });
          if (status === 'FAILED') failed = true;
        }
        if (failed) {
          for (const reserved of allocations.filter(
            (
              allocation,
            ): allocation is typeof allocation & { projectionId: string } =>
              allocation.status === 'RESERVED' &&
              allocation.projectionId !== null,
          )) {
            await transaction.inventoryAvailabilityProjection.update({
              data: {
                allocated: { decrement: reserved.quantity },
                updatedBy: context.accountId,
                version: { increment: 1 },
              },
              where: { id: reserved.projectionId },
            });
            await transaction.orderAllocation.update({
              data: {
                failureCode: 'ALLOCATION_ROLLED_BACK',
                reservedAt: null,
                status: 'FAILED',
                updatedBy: context.accountId,
                version: { increment: 1 },
              },
              where: { id: reserved.id },
            });
          }
          await this.record(
            transaction,
            orderId,
            'BusinessOrder',
            current.version,
            'order.allocation-failed.v1',
            context,
            metadata,
            { allocationIds: allocations.map(({ id }) => id) },
          );
          return {
            allocationIds: allocations.map(({ id }) => id),
            status: 'FAILED',
            version: current.version,
          };
        }
        const changedOrder = await transaction.businessOrder.update({
          data: {
            status: 'ALLOCATED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: orderId },
        });
        await this.record(
          transaction,
          orderId,
          'BusinessOrder',
          changedOrder.version,
          'order.allocated.v1',
          context,
          metadata,
          { allocationIds: allocations.map(({ id }) => id) },
        );
        for (const allocation of allocations)
          await this.record(
            transaction,
            allocation.id,
            'OrderAllocation',
            1,
            'inventory.reservation-requested.v1',
            context,
            metadata,
            { allocationId: allocation.id, orderId },
          );
        return {
          allocationIds: allocations.map(({ id }) => id),
          status: changedOrder.status,
          version: changedOrder.version,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async release(
    allocationId: string,
    input: ReleaseAllocationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    uuid(allocationId, 'allocationId');
    return this.prisma.$transaction(async (transaction) => {
      const allocation = await transaction.orderAllocation.findFirst({
        where: { id: allocationId, tenantId: context.tenantId },
      });
      if (!allocation)
        throw new AppError(
          'ALLOCATION_NOT_FOUND',
          'Allocation was not found',
          404,
        );
      if (allocation.status !== 'RESERVED')
        throw new AppError(
          'ALLOCATION_TRANSITION_INVALID',
          `Allocation ${allocation.status} cannot be released`,
          409,
        );
      if (!allocation.projectionId)
        throw new AppError(
          'ALLOCATION_PROJECTION_MISSING',
          'Reserved allocation has no availability projection',
          409,
        );
      if (allocation.version !== input.expectedVersion)
        throw new AppError(
          'ALLOCATION_VERSION_CONFLICT',
          'Allocation changed; refresh and retry',
          409,
        );
      await transaction.inventoryAvailabilityProjection.update({
        data: {
          allocated: { decrement: allocation.quantityBase },
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: allocation.projectionId },
      });
      const released = await transaction.orderAllocation.update({
        data: {
          releasedAt: new Date(),
          status: 'RELEASED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: allocation.id },
      });
      const remaining = await transaction.orderAllocation.count({
        where: {
          businessOrderId: allocation.businessOrderId,
          status: 'RESERVED',
          tenantId: context.tenantId,
        },
      });
      if (!remaining)
        await transaction.businessOrder.updateMany({
          data: {
            status: 'APPROVED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            id: allocation.businessOrderId,
            status: 'ALLOCATED',
            tenantId: context.tenantId,
          },
        });
      await this.record(
        transaction,
        allocation.id,
        'OrderAllocation',
        released.version,
        'inventory.reservation-release-requested.v1',
        context,
        metadata,
        { allocationId, orderId: allocation.businessOrderId },
      );
      return {
        allocationId,
        status: released.status,
        version: released.version,
      };
    });
  }

  private availability(row: {
    allocated: Prisma.Decimal;
    expectedInbound: Prisma.Decimal;
    hold: Prisma.Decimal;
    inTransit: Prisma.Decimal;
    onHand: Prisma.Decimal;
    safetyStock: Prisma.Decimal;
    [key: string]: unknown;
  }) {
    return {
      ...row,
      availableNow: Prisma.Decimal.max(
        row.onHand.sub(row.allocated).sub(row.hold).sub(row.safetyStock),
        0,
      ).toString(),
      projectedAvailable: Prisma.Decimal.max(
        row.onHand
          .sub(row.allocated)
          .sub(row.hold)
          .add(row.inTransit)
          .add(row.expectedInbound)
          .sub(row.safetyStock),
        0,
      ).toString(),
    };
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
