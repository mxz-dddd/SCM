import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type InventoryIssueMethod } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import type { CommandMetadata } from '../platform/tenant.service';
import { InventoryService } from './inventory.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export interface CreateAdjustmentInput {
  readonly attachmentRefs: readonly string[];
  readonly balanceId: string;
  readonly financialImpact: Readonly<Record<string, unknown>>;
  readonly quantityBase: string;
  readonly quantityOriginal: string;
  readonly reason: string;
  readonly reasonCode: string;
  readonly type: 'GAIN' | 'LOSS' | 'DAMAGE' | 'DATA_FIX';
}

export interface SaveReplenishmentPolicyInput {
  readonly demandSnapshot?: Readonly<Record<string, unknown>>;
  readonly issueMethod?: InventoryIssueMethod;
  readonly leadTimeDays?: number;
  readonly maximumBase: string;
  readonly minimumBase: string;
  readonly ownerId?: string;
  readonly pickLocationId: string;
  readonly productId: string;
  readonly warehouseId: string;
}

@Injectable()
export class InventoryGovernanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MdmReferenceService) private readonly mdm: MdmReferenceService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  async createAdjustment(
    input: CreateAdjustmentInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.balanceId, 'balanceId');
    const quantity = this.positiveQuantity(input);
    if (
      !input.reasonCode?.trim() ||
      !input.reason?.trim() ||
      !input.attachmentRefs?.length ||
      !object(input.financialImpact)
    )
      throw new AppError(
        'INVENTORY_ADJUSTMENT_EVIDENCE_REQUIRED',
        'Reason code, reason, attachment and financial impact are required',
        400,
      );
    const balance = await this.prisma.inventoryBalance.findFirst({
      where: { id: input.balanceId, tenantId: context.tenantId },
    });
    if (!balance)
      throw new AppError(
        'INVENTORY_BALANCE_NOT_FOUND',
        'Inventory balance was not found',
        404,
      );
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.inventoryAdjustmentOrder.create({
        data: {
          adjustmentNo: `ADJ-${Date.now()}-${id.slice(0, 6)}`,
          attachmentRefs: [...input.attachmentRefs],
          balanceId: input.balanceId,
          createdBy: context.accountId,
          financialImpact: json(input.financialImpact),
          id,
          quantityBase: quantity.base,
          quantityOriginal: quantity.original,
          reason: input.reason.trim(),
          reasonCode: input.reasonCode.trim().toUpperCase(),
          tenantId: context.tenantId,
          type: input.type,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        id,
        'InventoryAdjustmentOrder',
        row.version,
        'inventory.adjustment-created.v1',
        context,
        metadata,
        { adjustmentId: id, balanceId: input.balanceId, type: input.type },
      );
      return { adjustmentId: id, status: row.status, version: row.version };
    });
  }

  async transitionAdjustment(
    id: string,
    input: {
      approvalReference?: string;
      direction?: 'INCREASE' | 'DECREASE';
      expectedBalanceVersion?: number;
      expectedVersion: number;
      targetStatus: 'PENDING_APPROVAL' | 'APPROVED' | 'POSTED' | 'REJECTED';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'adjustmentId');
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.inventoryAdjustmentOrder.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!order || order.version !== input.expectedVersion)
        throw this.conflict('INVENTORY_ADJUSTMENT_CONFLICT');
      const allowed =
        (order.status === 'DRAFT' &&
          input.targetStatus === 'PENDING_APPROVAL') ||
        (order.status === 'PENDING_APPROVAL' &&
          ['APPROVED', 'REJECTED'].includes(input.targetStatus)) ||
        (order.status === 'APPROVED' && input.targetStatus === 'POSTED');
      if (!allowed)
        throw new AppError(
          'INVENTORY_ADJUSTMENT_TRANSITION_INVALID',
          `Adjustment transition ${order.status} -> ${input.targetStatus} is not allowed`,
          409,
        );
      if (input.targetStatus === 'APPROVED' && !input.approvalReference?.trim())
        throw new AppError(
          'INVENTORY_ADJUSTMENT_APPROVAL_REQUIRED',
          'Approval reference is required',
          403,
        );
      let movementId: string | null = order.movementId;
      if (input.targetStatus === 'POSTED') {
        if (input.expectedBalanceVersion === undefined)
          throw new AppError(
            'INVENTORY_BALANCE_VERSION_REQUIRED',
            'Balance version is required to post adjustment',
            400,
          );
        const direction =
          order.type === 'GAIN'
            ? 'INCREASE'
            : order.type === 'DATA_FIX'
              ? input.direction
              : 'DECREASE';
        if (!direction)
          throw new AppError(
            'INVENTORY_ADJUSTMENT_DIRECTION_REQUIRED',
            'Data repair adjustment requires a direction',
            400,
          );
        const applied = await this.inventory.applyApprovedAdjustment(
          tx,
          order.balanceId,
          {
            adjustmentId: id,
            direction,
            expectedVersion: input.expectedBalanceVersion,
            quantityBase: order.quantityBase.toString(),
            quantityOriginal: order.quantityOriginal.toString(),
          },
          context,
          metadata,
        );
        movementId = applied.movementId;
      }
      const changed = await tx.inventoryAdjustmentOrder.update({
        data: {
          approvalReference:
            input.targetStatus === 'APPROVED'
              ? input.approvalReference!.trim()
              : order.approvalReference,
          movementId,
          postedAt:
            input.targetStatus === 'POSTED' ? new Date() : order.postedAt,
          status: input.targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'InventoryAdjustmentOrder',
        changed.version,
        input.targetStatus === 'POSTED'
          ? 'inventory.adjustment-posted.v1'
          : 'inventory.adjustment-transitioned.v1',
        context,
        metadata,
        {
          adjustmentId: id,
          from: order.status,
          movementId,
          to: changed.status,
        },
      );
      return {
        adjustmentId: id,
        movementId,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async saveReplenishmentPolicy(
    input: SaveReplenishmentPolicyInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    for (const [field, value] of Object.entries({
      ownerId: input.ownerId,
      pickLocationId: input.pickLocationId,
      productId: input.productId,
      warehouseId: input.warehouseId,
    }))
      if (value) this.uuid(value, field);
    const minimum = this.nonNegative(input.minimumBase, 'minimumBase');
    const maximum = this.positive(input.maximumBase, 'maximumBase');
    if (
      !maximum.greaterThan(minimum) ||
      !Number.isInteger(input.leadTimeDays ?? 0) ||
      (input.leadTimeDays ?? 0) < 0
    )
      throw new AppError(
        'REPLENISHMENT_POLICY_INVALID',
        'Maximum must exceed minimum and lead time must be non-negative',
        400,
      );
    const [productExists, locations] = await Promise.all([
      this.mdm.scanObjectExists('PRODUCT', input.productId, context),
      this.mdm.listWarehouseLocations(input.warehouseId, context),
    ]);
    if (
      !productExists ||
      !locations.some(
        ({ id, type }) => id === input.pickLocationId && type === 'LOCATION',
      )
    )
      throw new AppError(
        'REPLENISHMENT_REFERENCE_INVALID',
        'Active product and pick location are required',
        400,
      );
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.replenishmentPolicy.create({
        data: {
          createdBy: context.accountId,
          demandSnapshot: json(input.demandSnapshot),
          id,
          issueMethod: input.issueMethod ?? 'FEFO',
          leadTimeDays: input.leadTimeDays ?? 0,
          maximumBase: maximum,
          minimumBase: minimum,
          ownerId: input.ownerId ?? null,
          pickLocationId: input.pickLocationId,
          policyNo: `RPL-P-${Date.now()}-${id.slice(0, 6)}`,
          productId: input.productId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          warehouseId: input.warehouseId,
        },
      });
      await this.record(
        tx,
        id,
        'ReplenishmentPolicy',
        row.version,
        'inventory.replenishment-policy-created.v1',
        context,
        metadata,
        { policyId: id, productId: input.productId },
      );
      return { policyId: id, version: row.version };
    });
  }

  async planReplenishment(
    id: string,
    input: { expectedVersion: number; waveDemandBase?: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'policyId');
    const demand = this.nonNegative(
      input.waveDemandBase ?? '0',
      'waveDemandBase',
    );
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1::int AS locked
        FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`replenishment:${context.tenantId}:${id}`}, 0))) AS lock
      `;
      const policy = await tx.replenishmentPolicy.findFirst({
        where: { id, status: 'ACTIVE', tenantId: context.tenantId },
      });
      if (!policy || policy.version !== input.expectedVersion)
        throw this.conflict('REPLENISHMENT_POLICY_CONFLICT');
      const open = await tx.replenishmentTask.count({
        where: {
          policyId: id,
          status: { in: ['PLANNED', 'EXECUTING'] },
          tenantId: context.tenantId,
        },
      });
      if (open)
        throw new AppError(
          'REPLENISHMENT_TASK_ALREADY_OPEN',
          'Policy already has an open replenishment task',
          409,
        );
      const targetBalances = await tx.inventoryBalance.findMany({
        where: {
          locationId: policy.pickLocationId,
          ...(policy.ownerId ? { ownerId: policy.ownerId } : {}),
          productId: policy.productId,
          status: 'AVAILABLE',
          tenantId: context.tenantId,
          warehouseId: policy.warehouseId,
        },
      });
      const targetAvailable = targetBalances.reduce(
        (sum, balance) => sum.add(balance.availableBase),
        new Prisma.Decimal(0),
      );
      if (targetAvailable.sub(demand).greaterThan(policy.minimumBase))
        return { requiredBase: '0', taskIds: [] as string[] };
      let required = policy.maximumBase.add(demand).sub(targetAvailable);
      const candidates = await tx.inventoryBalance.findMany({
        where: {
          availableBase: { gt: 0 },
          locationId: { not: policy.pickLocationId },
          ...(policy.ownerId ? { ownerId: policy.ownerId } : {}),
          productId: policy.productId,
          status: 'AVAILABLE',
          tenantId: context.tenantId,
          warehouseId: policy.warehouseId,
        },
      });
      const blocked = new Set(
        (
          await Promise.all([
            tx.inventoryHold.findMany({
              select: { balanceId: true },
              where: {
                balanceId: { in: candidates.map(({ id }) => id) },
                status: 'ACTIVE',
                tenantId: context.tenantId,
              },
            }),
            tx.inventoryCountFreeze.findMany({
              select: { balanceId: true },
              where: {
                balanceId: { in: candidates.map(({ id }) => id) },
                status: 'ACTIVE',
                tenantId: context.tenantId,
              },
            }),
          ])
        ).flatMap((rows) => rows.map(({ balanceId }) => balanceId)),
      );
      const lotIds = candidates.flatMap(({ inventoryLotId }) =>
        inventoryLotId ? [inventoryLotId] : [],
      );
      const lots = await tx.inventoryLot.findMany({
        where: { id: { in: lotIds }, tenantId: context.tenantId },
      });
      const lotById = new Map(lots.map((lot) => [lot.id, lot]));
      const eligible = candidates
        .filter(({ id }) => !blocked.has(id))
        .sort((left, right) => {
          if (policy.issueMethod === 'FEFO') {
            const leftExpiry = left.inventoryLotId
              ? lotById.get(left.inventoryLotId)?.expiryDate?.getTime()
              : undefined;
            const rightExpiry = right.inventoryLotId
              ? lotById.get(right.inventoryLotId)?.expiryDate?.getTime()
              : undefined;
            if (leftExpiry !== rightExpiry)
              return (
                (leftExpiry ?? Number.MAX_SAFE_INTEGER) -
                (rightExpiry ?? Number.MAX_SAFE_INTEGER)
              );
          }
          return (
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.id.localeCompare(right.id)
          );
        });
      const taskIds: string[] = [];
      for (const source of eligible) {
        if (!required.greaterThan(0)) break;
        const quantityBase = Prisma.Decimal.min(required, source.availableBase);
        const quantityOriginal = quantityBase
          .mul(source.onHandOriginal)
          .div(source.onHandBase);
        const taskId = randomUUID();
        const task = await tx.replenishmentTask.create({
          data: {
            createdBy: context.accountId,
            id: taskId,
            issueMethod: policy.issueMethod,
            policyId: policy.id,
            quantityBase,
            quantityOriginal,
            selectionSnapshot: json({
              demandBase: demand.toString(),
              inventoryLotId: source.inventoryLotId,
              lotExpiryDate: source.inventoryLotId
                ? lotById.get(source.inventoryLotId)?.expiryDate
                : null,
              sourceVersion: source.version,
              targetAvailableBase: targetAvailable.toString(),
            }),
            sourceBalanceId: source.id,
            targetLocationId: policy.pickLocationId,
            taskNo: `RPL-${Date.now()}-${taskId.slice(0, 6)}`,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        taskIds.push(taskId);
        required = required.sub(quantityBase);
        await this.record(
          tx,
          taskId,
          'ReplenishmentTask',
          task.version,
          'inventory.replenishment-planned.v1',
          context,
          metadata,
          {
            policyId: policy.id,
            quantityBase: quantityBase.toString(),
            taskId,
          },
        );
      }
      if (required.greaterThan(0))
        throw new AppError(
          'REPLENISHMENT_SOURCE_INSUFFICIENT',
          'Eligible FEFO/FIFO source inventory is insufficient',
          409,
        );
      return {
        requiredBase: policy.maximumBase
          .add(demand)
          .sub(targetAvailable)
          .toString(),
        taskIds,
      };
    });
  }

  async executeReplenishment(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'taskId');
    const claimed = await this.prisma.$transaction(async (tx) => {
      const task = await tx.replenishmentTask.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !task ||
        task.status !== 'PLANNED' ||
        task.version !== input.expectedVersion
      )
        throw this.conflict('REPLENISHMENT_TASK_CONFLICT');
      const source = await tx.inventoryBalance.findFirstOrThrow({
        where: { id: task.sourceBalanceId, tenantId: context.tenantId },
      });
      await tx.replenishmentTask.update({
        data: {
          status: 'EXECUTING',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      return { sourceVersion: source.version, task };
    });
    try {
      const moved = await this.inventory.transfer(
        claimed.task.sourceBalanceId,
        {
          expectedVersion: claimed.sourceVersion,
          quantityBase: claimed.task.quantityBase.toString(),
          quantityOriginal: claimed.task.quantityOriginal.toString(),
          reason: `Automatic replenishment ${claimed.task.taskNo}`,
          targetLocationId: claimed.task.targetLocationId,
        },
        context,
        metadata,
      );
      return this.prisma.$transaction(async (tx) => {
        const changed = await tx.replenishmentTask.update({
          data: {
            completedAt: new Date(),
            status: 'COMPLETED',
            transferId: moved.transferId,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await this.record(
          tx,
          id,
          'ReplenishmentTask',
          changed.version,
          'inventory.replenishment-completed.v1',
          context,
          metadata,
          { taskId: id, transferId: moved.transferId },
        );
        return {
          status: changed.status,
          transferId: moved.transferId,
          version: changed.version,
        };
      });
    } catch (error) {
      await this.prisma.replenishmentTask.updateMany({
        data: {
          failureReason:
            error instanceof Error
              ? error.message.slice(0, 500)
              : 'Unknown failure',
          status: 'FAILED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id, status: 'EXECUTING', tenantId: context.tenantId },
      });
      throw error;
    }
  }

  async runAging(
    input: {
      agedDays?: number;
      asOfDate?: string;
      nearExpiryDays?: number;
      warehouseId: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.warehouseId, 'warehouseId');
    const agedDays = input.agedDays ?? 180;
    const nearExpiryDays = input.nearExpiryDays ?? 30;
    if (agedDays < 1 || nearExpiryDays < 0)
      throw new AppError(
        'INVENTORY_AGING_INPUT_INVALID',
        'Aging thresholds are invalid',
        400,
      );
    const asOf = input.asOfDate ? new Date(input.asOfDate) : new Date();
    if (Number.isNaN(asOf.getTime()))
      throw new AppError(
        'INVENTORY_AGING_INPUT_INVALID',
        'Snapshot date is invalid',
        400,
      );
    const snapshotDate = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
    );
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        onHandBase: { gt: 0 },
        tenantId: context.tenantId,
        warehouseId: input.warehouseId,
      },
    });
    const lots = await this.prisma.inventoryLot.findMany({
      where: {
        id: {
          in: balances.flatMap(({ inventoryLotId }) =>
            inventoryLotId ? [inventoryLotId] : [],
          ),
        },
        tenantId: context.tenantId,
      },
    });
    const lotById = new Map(lots.map((lot) => [lot.id, lot]));
    const day = 86_400_000;
    const rows = balances.map((balance) => {
      const lot = balance.inventoryLotId
        ? lotById.get(balance.inventoryLotId)
        : undefined;
      const origin = lot?.productionDate ?? balance.createdAt;
      const ageDays = Math.max(
        0,
        Math.floor((snapshotDate.getTime() - origin.getTime()) / day),
      );
      const remaining = lot?.expiryDate
        ? Math.ceil((lot.expiryDate.getTime() - snapshotDate.getTime()) / day)
        : null;
      const type =
        remaining !== null && remaining < 0
          ? ('EXPIRED' as const)
          : remaining !== null && remaining <= nearExpiryDays
            ? ('NEAR_EXPIRY' as const)
            : ageDays >= agedDays
              ? ('AGED' as const)
              : null;
      return {
        ageDays,
        balance,
        bucketCode:
          ageDays >= agedDays
            ? `${agedDays}_PLUS`
            : ageDays >= 90
              ? '90_179'
              : ageDays >= 30
                ? '30_89'
                : '0_29',
        lot,
        remaining,
        type,
      };
    });
    const runId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.inventoryAgingSnapshot.createMany({
        data: rows.map(({ ageDays, balance, bucketCode }) => ({
          ageDays,
          balanceId: balance.id,
          bucketCode,
          createdBy: context.accountId,
          inventoryLotId: balance.inventoryLotId,
          quantityBase: balance.onHandBase,
          snapshotDate,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        })),
        skipDuplicates: true,
      });
      let alertsCreated = 0;
      for (const row of rows.filter(({ type }) => type !== null)) {
        const dedupeKey = `${snapshotDate.toISOString().slice(0, 10)}:${row.type}:${row.balance.id}`;
        const exists = await tx.inventoryExpiryAlert.count({
          where: { dedupeKey, tenantId: context.tenantId },
        });
        if (exists) continue;
        const alertId = randomUUID();
        await tx.inventoryExpiryAlert.create({
          data: {
            actionSuggestion:
              row.type === 'EXPIRED'
                ? 'Freeze and dispose inventory'
                : row.type === 'NEAR_EXPIRY'
                  ? 'Prioritize FEFO issue or return'
                  : 'Review promotion or return',
            alertNo: `EXP-${Date.now()}-${alertId.slice(0, 6)}`,
            balanceId: row.balance.id,
            createdBy: context.accountId,
            dedupeKey,
            id: alertId,
            inventoryLotId: row.balance.inventoryLotId,
            severity: row.type === 'EXPIRED' ? 'CRITICAL' : 'WARNING',
            snapshot: json({
              ageDays: row.ageDays,
              expiryDate: row.lot?.expiryDate,
              remainingShelfLifeDays: row.remaining,
            }),
            tenantId: context.tenantId,
            type: row.type!,
            updatedBy: context.accountId,
          },
        });
        alertsCreated += 1;
      }
      await this.record(
        tx,
        runId,
        'InventoryAgingRun',
        1,
        'inventory.aging-evaluated.v1',
        context,
        metadata,
        {
          alertsCreated,
          balanceCount: rows.length,
          snapshotDate: snapshotDate.toISOString(),
        },
      );
      return { alertsCreated, balanceCount: rows.length, runId, snapshotDate };
    });
  }

  async genealogy(
    query: { inventoryLotId?: string; serialNumber?: string },
    context: TenantContext,
  ) {
    if (!query.inventoryLotId && !query.serialNumber)
      throw new AppError(
        'INVENTORY_TRACE_CRITERIA_REQUIRED',
        'Lot or serial number is required',
        400,
      );
    if (query.inventoryLotId) this.uuid(query.inventoryLotId, 'inventoryLotId');
    const serial = query.serialNumber
      ? await this.prisma.serialNumber.findFirst({
          where: {
            serialNumber: query.serialNumber,
            tenantId: context.tenantId,
          },
        })
      : null;
    const lotId = query.inventoryLotId ?? serial?.inventoryLotId ?? undefined;
    const lot = lotId
      ? await this.prisma.inventoryLot.findFirst({
          where: { id: lotId, tenantId: context.tenantId },
        })
      : null;
    if (!lot && !serial)
      throw new AppError(
        'INVENTORY_TRACE_NOT_FOUND',
        'Lot or serial was not found',
        404,
      );
    const receiptLineId = lot?.receiptLineId ?? serial!.receiptLineId;
    const [receipt, inspections, balances, serials] = await Promise.all([
      this.prisma.receiptLine.findFirst({
        where: { id: receiptLineId, tenantId: context.tenantId },
      }),
      this.prisma.qualityInspection.findMany({
        where: {
          ...(lotId ? { inventoryLotId: lotId } : { receiptLineId }),
          tenantId: context.tenantId,
        },
      }),
      this.prisma.inventoryBalance.findMany({
        where: {
          ...(lotId
            ? { inventoryLotId: lotId }
            : { serialNumberId: serial!.id }),
          tenantId: context.tenantId,
        },
      }),
      lotId
        ? this.prisma.serialNumber.findMany({
            where: { inventoryLotId: lotId, tenantId: context.tenantId },
          })
        : Promise.resolve(serial ? [serial] : []),
    ]);
    const movements = await this.prisma.inventoryMovement.findMany({
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      where: {
        balanceId: { in: balances.map(({ id }) => id) },
        tenantId: context.tenantId,
      },
    });
    const nodes = [
      ...(lot
        ? [
            {
              id: lot.id,
              type: 'LOT',
              snapshot: {
                supplierBatchNo: lot.supplierBatchNo,
                productionDate: lot.productionDate,
                expiryDate: lot.expiryDate,
              },
            },
          ]
        : []),
      ...(receipt
        ? [
            {
              id: receipt.id,
              type: 'RECEIPT',
              snapshot: {
                inboundOrderId: receipt.inboundOrderId,
                receivedAt: receipt.receivedAt,
              },
            },
          ]
        : []),
      ...inspections.map((inspection) => ({
        id: inspection.id,
        type: 'QUALITY',
        snapshot: {
          status: inspection.status,
          resultSummary: inspection.resultSummary,
        },
      })),
      ...serials.map((item) => ({
        id: item.id,
        type: 'SERIAL',
        snapshot: { serialNumber: item.serialNumber, status: item.status },
      })),
      ...balances.map((balance) => ({
        id: balance.id,
        type: 'BALANCE',
        snapshot: {
          locationId: balance.locationId,
          onHandBase: balance.onHandBase.toString(),
          status: balance.status,
        },
      })),
      ...movements.map((movement) => ({
        id: movement.id,
        type: 'MOVEMENT',
        snapshot: {
          businessRef: movement.businessRef,
          movementType: movement.type,
          occurredAt: movement.occurredAt,
        },
      })),
    ];
    const rootId = lot?.id ?? serial!.id;
    return {
      edges: nodes
        .filter(({ id }) => id !== rootId)
        .map(({ id, type }) => ({
          from: rootId,
          relation: `HAS_${type}`,
          to: id,
        })),
      nodes,
      recallList: {
        balanceIds: balances
          .filter(({ onHandBase }) => onHandBase.greaterThan(0))
          .map(({ id }) => id),
        serialNumbers: serials.map(({ serialNumber }) => serialNumber),
      },
      snapshotAt: new Date(),
    };
  }

  async reconcile(
    input: {
      erpClosingBase: string;
      ownerId?: string;
      periodEnd: string;
      periodStart: string;
      warehouseId: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.warehouseId, 'warehouseId');
    if (input.ownerId) this.uuid(input.ownerId, 'ownerId');
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    const erpClosing = this.nonNegative(input.erpClosingBase, 'erpClosingBase');
    if (
      Number.isNaN(periodStart.getTime()) ||
      Number.isNaN(periodEnd.getTime()) ||
      periodEnd <= periodStart
    )
      throw new AppError(
        'INVENTORY_RECONCILIATION_PERIOD_INVALID',
        'Reconciliation period is invalid',
        400,
      );
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
        tenantId: context.tenantId,
        warehouseId: input.warehouseId,
      },
    });
    const balanceIds = balances.map(({ id }) => id);
    const movements = await this.prisma.inventoryMovement.findMany({
      where: {
        balanceId: { in: balanceIds },
        occurredAt: { gte: periodStart, lte: periodEnd },
        tenantId: context.tenantId,
      },
    });
    const closing = balances.reduce(
      (sum, balance) => sum.add(balance.onHandBase),
      new Prisma.Decimal(0),
    );
    let receipt = new Prisma.Decimal(0);
    let shipment = new Prisma.Decimal(0);
    let adjustment = new Prisma.Decimal(0);
    let count = new Prisma.Decimal(0);
    for (const movement of movements) {
      if (['RECEIPT', 'PUTAWAY'].includes(movement.type))
        receipt = receipt.add(movement.quantityBase);
      if (movement.type === 'SHIPMENT' || movement.type === 'PICK')
        shipment = shipment.add(movement.quantityBase);
      if (movement.type === 'ADJUSTMENT') {
        const positive =
          Object.keys(object(movement.toDimensions) ?? {}).length > 0;
        const delta = positive
          ? movement.quantityBase
          : movement.quantityBase.negated();
        if (movement.businessType === 'INVENTORY_COUNT')
          count = count.add(delta);
        else adjustment = adjustment.add(delta);
      }
    }
    const opening = closing
      .sub(receipt)
      .add(shipment)
      .sub(adjustment)
      .sub(count);
    const difference = erpClosing.sub(closing);
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.inventoryReconciliation.create({
        data: {
          adjustmentBase: adjustment,
          calculationSnapshot: json({
            balanceIds,
            movementIds: movements.map(({ id }) => id),
            snapshotAt: new Date(),
          }),
          closingBase: closing,
          countBase: count,
          createdBy: context.accountId,
          differenceBase: difference,
          erpClosingBase: erpClosing,
          id,
          openingBase: opening,
          ownerId: input.ownerId ?? null,
          periodEnd,
          periodStart,
          receiptBase: receipt,
          reconciliationNo: `REC-${Date.now()}-${id.slice(0, 6)}`,
          shipmentBase: shipment,
          status: difference.equals(0) ? 'MATCHED' : 'DIFFERENCE_RECORDED',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          warehouseId: input.warehouseId,
        },
      });
      let caseId: string | null = null;
      if (!difference.equals(0)) {
        caseId = randomUUID();
        await tx.inventoryReconciliationCase.create({
          data: {
            actualBase: erpClosing,
            caseNo: `REC-CASE-${Date.now()}-${caseId.slice(0, 6)}`,
            createdBy: context.accountId,
            dedupeKey: `${id}:ERP_CLOSING`,
            description:
              'ERP closing inventory differs from WMS audited closing inventory',
            differenceBase: difference,
            expectedBase: closing,
            id: caseId,
            reconciliationId: id,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      await this.record(
        tx,
        id,
        'InventoryReconciliation',
        row.version,
        'inventory.reconciled.v1',
        context,
        metadata,
        { caseId, differenceBase: difference.toString(), reconciliationId: id },
      );
      return {
        caseId,
        differenceBase: difference.toString(),
        reconciliationId: id,
        status: row.status,
        version: row.version,
      };
    });
  }

  async resolveReconciliationCase(
    id: string,
    input: { expectedVersion: number; resolution: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'caseId');
    if (!input.resolution?.trim())
      throw new AppError(
        'INVENTORY_RECONCILIATION_RESOLUTION_REQUIRED',
        'Resolution is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.inventoryReconciliationCase.updateMany({
        data: {
          resolution: input.resolution.trim(),
          resolvedAt: new Date(),
          status: 'RESOLVED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          id,
          status: 'OPEN',
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (changed.count !== 1)
        throw this.conflict('INVENTORY_RECONCILIATION_CASE_CONFLICT');
      const row = await tx.inventoryReconciliationCase.findUniqueOrThrow({
        where: { id },
      });
      await this.record(
        tx,
        id,
        'InventoryReconciliationCase',
        row.version,
        'inventory.reconciliation-case-resolved.v1',
        context,
        metadata,
        { caseId: id, reconciliationId: row.reconciliationId },
      );
      return { status: row.status, version: row.version };
    });
  }

  async closeReconciliation(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'reconciliationId');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.inventoryReconciliation.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !row ||
        row.version !== input.expectedVersion ||
        !['MATCHED', 'DIFFERENCE_RECORDED'].includes(row.status)
      )
        throw this.conflict('INVENTORY_RECONCILIATION_CONFLICT');
      if (
        await tx.inventoryReconciliationCase.count({
          where: {
            reconciliationId: id,
            status: 'OPEN',
            tenantId: context.tenantId,
          },
        })
      )
        throw new AppError(
          'INVENTORY_RECONCILIATION_CASE_OPEN',
          'Every discrepancy case must be resolved before close',
          409,
        );
      const changed = await tx.inventoryReconciliation.update({
        data: {
          closedAt: new Date(),
          status: 'CLOSED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'InventoryReconciliation',
        changed.version,
        'inventory.reconciliation-closed.v1',
        context,
        metadata,
        { reconciliationId: id },
      );
      return { status: changed.status, version: changed.version };
    });
  }

  async workbench(context: TenantContext) {
    const [adjustments, replenishments, alerts, reconciliations, cases, aging] =
      await Promise.all([
        this.prisma.inventoryAdjustmentOrder.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.replenishmentTask.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.inventoryExpiryAlert.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.inventoryReconciliation.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.inventoryReconciliationCase.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.inventoryAgingSnapshot.findMany({
          orderBy: [{ snapshotDate: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
      ]);
    return {
      adjustments,
      aging,
      alerts,
      cases,
      reconciliations,
      replenishments,
      snapshotAt: new Date(),
    };
  }

  private positiveQuantity(input: {
    quantityBase: string;
    quantityOriginal: string;
  }) {
    return {
      base: this.positive(input.quantityBase, 'quantityBase'),
      original: this.positive(input.quantityOriginal, 'quantityOriginal'),
    };
  }

  private positive(value: string, field: string) {
    try {
      const decimal = new Prisma.Decimal(value);
      if (!decimal.isFinite() || !decimal.greaterThan(0)) throw new Error();
      return decimal;
    } catch {
      throw new AppError(
        'WMS_QUANTITY_INVALID',
        `${field} must be a positive decimal`,
        400,
      );
    }
  }

  private nonNegative(value: string, field: string) {
    try {
      const decimal = new Prisma.Decimal(value);
      if (!decimal.isFinite() || decimal.isNegative()) throw new Error();
      return decimal;
    } catch {
      throw new AppError(
        'WMS_QUANTITY_INVALID',
        `${field} must be a non-negative decimal`,
        400,
      );
    }
  }

  private uuid(value: string, field: string) {
    if (!isUuid(value))
      throw new AppError('WMS_INPUT_INVALID', `${field} is invalid`, 400);
  }

  private conflict(code: string) {
    return new AppError(code, 'Resource version or state changed', 409, {
      retryable: true,
    });
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
