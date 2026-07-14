import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type InventoryMovementType,
  type InventoryStockStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import type { CommandMetadata } from '../platform/tenant.service';

export interface InventoryDimensions {
  readonly handlingUnitId?: string;
  readonly inventoryLotId?: string;
  readonly locationId: string;
  readonly ownerId: string;
  readonly productId: string;
  readonly serialNumberId?: string;
  readonly status: InventoryStockStatus;
  readonly warehouseId: string;
}
export interface PostInventoryInput extends InventoryDimensions {
  readonly baseUom: string;
  readonly businessRef: string;
  readonly businessType: string;
  readonly originalUom: string;
  readonly quantityBase: string;
  readonly quantityOriginal: string;
}
export interface InventoryQuantityInput {
  readonly expectedVersion: number;
  readonly quantityBase: string;
  readonly quantityOriginal: string;
}
export interface TransitionInventoryInput extends InventoryQuantityInput {
  readonly approvalReference?: string;
  readonly reason: string;
  readonly targetStatus: InventoryStockStatus;
}
export interface CreateHoldInput extends InventoryQuantityInput {
  readonly reason: string;
  readonly requiresApproval?: boolean;
  readonly scopeRef?: string;
  readonly scopeSnapshot?: Readonly<Record<string, unknown>>;
  readonly scopeType: 'ORDER' | 'LOT' | 'LPN' | 'LOCATION' | 'QUANTITY';
}
export interface CreateReservationInput extends InventoryQuantityInput {
  readonly businessSnapshot?: Readonly<Record<string, unknown>>;
  readonly expiresAt?: string;
  readonly sourceRef: string;
  readonly sourceType: 'ORDER' | 'WAVE';
}
export interface TransferInventoryInput extends InventoryQuantityInput {
  readonly reason: string;
  readonly targetLocationId: string;
}
export interface OwnershipTransferInput extends InventoryQuantityInput {
  readonly approvalReference: string;
  readonly chargeFactSnapshot?: Readonly<Record<string, unknown>>;
  readonly contractReference: string;
  readonly reason: string;
  readonly targetOwnerId: string;
}
export interface CreateCountInput {
  readonly balanceIds?: readonly string[];
  readonly blind?: boolean;
  readonly criteriaSnapshot?: Readonly<Record<string, unknown>>;
  readonly freezeInventory?: boolean;
  readonly ownerId?: string;
  readonly type: 'CYCLE' | 'FULL';
  readonly warehouseId: string;
}
export interface ApplyAdjustmentInput extends InventoryQuantityInput {
  readonly adjustmentId: string;
  readonly direction: 'INCREASE' | 'DECREASE';
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const dimensionSnapshot = (balance: {
  handlingUnitId: string | null;
  inventoryLotId: string | null;
  locationId: string;
  ownerId: string;
  productId: string;
  serialNumberId: string | null;
  status: InventoryStockStatus;
  warehouseId: string;
}) => ({
  handlingUnitId: balance.handlingUnitId,
  inventoryLotId: balance.inventoryLotId,
  locationId: balance.locationId,
  ownerId: balance.ownerId,
  productId: balance.productId,
  serialNumberId: balance.serialNumberId,
  status: balance.status,
  warehouseId: balance.warehouseId,
});
const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)]),
    );
  return value;
};

@Injectable()
export class InventoryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MdmReferenceService) private readonly mdm: MdmReferenceService,
  ) {}

  async list(
    query: {
      handlingUnitId?: string;
      inventoryLotId?: string;
      locationId?: string;
      ownerId?: string;
      page?: number;
      pageSize?: number;
      productId?: string;
      serialNumberId?: string;
      status?: InventoryStockStatus;
      warehouseId?: string;
    },
    context: TenantContext,
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const where = {
      ...(query.handlingUnitId ? { handlingUnitId: query.handlingUnitId } : {}),
      ...(query.inventoryLotId ? { inventoryLotId: query.inventoryLotId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.serialNumberId ? { serialNumberId: query.serialNumberId } : {}),
      ...(query.status ? { status: query.status } : {}),
      tenantId: context.tenantId,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      this.prisma.inventoryBalance.count({ where }),
    ]);
    return { items, page, pageSize, snapshotAt: new Date(), total };
  }

  async trace(id: string, context: TenantContext) {
    this.uuid(id, 'balanceId');
    const balance = await this.prisma.inventoryBalance.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!balance)
      throw new AppError(
        'INVENTORY_BALANCE_NOT_FOUND',
        'Inventory balance was not found',
        404,
      );
    const [movements, holds, reservations, statusChanges] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        orderBy: { chainSequence: 'asc' },
        where: { balanceId: id, tenantId: context.tenantId },
      }),
      this.prisma.inventoryHold.findMany({
        orderBy: { createdAt: 'asc' },
        where: { balanceId: id, tenantId: context.tenantId },
      }),
      this.prisma.inventoryReservation.findMany({
        orderBy: { createdAt: 'asc' },
        where: { balanceId: id, tenantId: context.tenantId },
      }),
      this.prisma.inventoryStatusChange.findMany({
        orderBy: { createdAt: 'asc' },
        where: {
          OR: [{ sourceBalanceId: id }, { targetBalanceId: id }],
          tenantId: context.tenantId,
        },
      }),
    ]);
    let previousHash: string | null = null;
    const chainValid = movements.every((movement) => {
      const valid =
        movement.previousHash === previousHash &&
        movement.movementHash === this.movementHash(movement);
      previousHash = movement.movementHash;
      return valid;
    });
    return {
      balance,
      chainValid,
      holds,
      movements,
      reservations,
      statusChanges,
    };
  }

  async receive(
    input: PostInventoryInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.dimensions(input);
    const locations = await this.mdm.listWarehouseLocations(
      input.warehouseId,
      context,
    );
    const [productExists] = await Promise.all([
      this.mdm.scanObjectExists('PRODUCT', input.productId, context),
    ]);
    if (!productExists || !locations.some(({ id }) => id === input.locationId))
      throw new AppError(
        'INVENTORY_REFERENCE_INVALID',
        'Active product and warehouse location are required',
        400,
      );
    const quantity = this.quantity(input);
    return this.prisma.$transaction((tx) =>
      this.postToBalance(tx, input, quantity, 'RECEIPT', context, metadata),
    );
  }

  async postPutaway(
    tx: Prisma.TransactionClient,
    input: PostInventoryInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.dimensions(input);
    return this.postToBalance(
      tx,
      input,
      this.quantity(input),
      'PUTAWAY',
      context,
      metadata,
    );
  }

  async transitionStatus(
    id: string,
    input: TransitionInventoryInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'balanceId');
    if (!input.reason?.trim())
      throw new AppError(
        'INVENTORY_STATUS_REASON_REQUIRED',
        'Status transition reason is required',
        400,
      );
    const quantity = this.quantity(input);
    return this.prisma.$transaction(async (tx) => {
      await this.lockBalance(tx, id, context.tenantId);
      const source = await tx.inventoryBalance.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!source || source.version !== input.expectedVersion)
        throw this.conflict('INVENTORY_BALANCE_CONFLICT');
      const transitions: Record<InventoryStockStatus, InventoryStockStatus[]> =
        {
          AVAILABLE: ['HOLD', 'DAMAGED', 'EXPIRED', 'PENDING_DISPOSITION'],
          DAMAGED: ['PENDING_DISPOSITION'],
          EXPIRED: ['PENDING_DISPOSITION'],
          HOLD: ['AVAILABLE', 'DAMAGED', 'EXPIRED', 'PENDING_DISPOSITION'],
          PENDING_DISPOSITION: ['AVAILABLE', 'HOLD'],
          PENDING_INSPECTION: ['AVAILABLE', 'HOLD'],
        };
      if (!transitions[source.status].includes(input.targetStatus))
        throw new AppError(
          'INVENTORY_STATUS_TRANSITION_INVALID',
          `Inventory transition ${source.status} -> ${input.targetStatus} is not allowed`,
          409,
        );
      if (
        ['PENDING_DISPOSITION', 'EXPIRED', 'DAMAGED'].includes(source.status) &&
        input.targetStatus === 'AVAILABLE' &&
        !input.approvalReference?.trim()
      )
        throw new AppError(
          'INVENTORY_STATUS_APPROVAL_REQUIRED',
          'Approval is required to release controlled inventory',
          403,
        );
      if (
        source.allocatedBase.greaterThan(0) ||
        (source.status === 'AVAILABLE' && source.holdBase.greaterThan(0)) ||
        quantity.base.greaterThan(source.onHandBase) ||
        quantity.original.greaterThan(source.onHandOriginal) ||
        !this.sameRatio(
          quantity.original,
          quantity.base,
          source.onHandOriginal,
          source.onHandBase,
        )
      )
        throw new AppError(
          'INVENTORY_STATUS_QUANTITY_INVALID',
          'Allocated, held or insufficient quantity cannot change status',
          409,
        );
      const sourceAvailability = source.status === 'AVAILABLE';
      const changed = await tx.inventoryBalance.updateMany({
        data: {
          availableBase: sourceAvailability
            ? { decrement: quantity.base }
            : source.availableBase,
          availableOriginal: sourceAvailability
            ? { decrement: quantity.original }
            : source.availableOriginal,
          holdBase: sourceAvailability
            ? source.holdBase
            : { decrement: quantity.base },
          holdOriginal: sourceAvailability
            ? source.holdOriginal
            : { decrement: quantity.original },
          onHandBase: { decrement: quantity.base },
          onHandOriginal: { decrement: quantity.original },
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          id,
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (changed.count !== 1)
        throw this.conflict('INVENTORY_BALANCE_CONFLICT');
      const targetInput: PostInventoryInput = {
        baseUom: source.baseUom,
        businessRef: `STATUS-${id}`,
        businessType: 'INVENTORY_STATUS',
        ...(source.handlingUnitId
          ? { handlingUnitId: source.handlingUnitId }
          : {}),
        ...(source.inventoryLotId
          ? { inventoryLotId: source.inventoryLotId }
          : {}),
        locationId: source.locationId,
        originalUom: source.originalUom,
        ownerId: source.ownerId,
        productId: source.productId,
        quantityBase: quantity.base.toString(),
        quantityOriginal: quantity.original.toString(),
        ...(source.serialNumberId
          ? { serialNumberId: source.serialNumberId }
          : {}),
        status: input.targetStatus,
        warehouseId: source.warehouseId,
      };
      const target = await this.postToBalance(
        tx,
        targetInput,
        quantity,
        'STATUS_CHANGE',
        context,
        metadata,
        dimensionSnapshot(source),
      );
      const movement = await tx.inventoryMovement.findUniqueOrThrow({
        where: { id: target.movementId },
      });
      const changeId = randomUUID();
      await tx.inventoryStatusChange.create({
        data: {
          approvalReference: input.approvalReference?.trim() ?? null,
          changeNo: `ISC-${Date.now()}-${changeId.slice(0, 6)}`,
          createdBy: context.accountId,
          fromStatus: source.status,
          id: changeId,
          movementId: movement.id,
          quantityBase: quantity.base,
          quantityOriginal: quantity.original,
          reason: input.reason.trim(),
          sourceBalanceId: source.id,
          targetBalanceId: target.balanceId,
          tenantId: context.tenantId,
          toStatus: input.targetStatus,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        changeId,
        'InventoryStatusChange',
        1,
        'inventory.status-changed.v1',
        context,
        metadata,
        {
          balanceKey: dimensionSnapshot(source),
          from: source.status,
          quantityBase: quantity.base.toString(),
          sourceBalanceId: source.id,
          targetBalanceId: target.balanceId,
          to: input.targetStatus,
        },
      );
      return { changeId, sourceVersion: source.version + 1, ...target };
    });
  }

  async hold(
    id: string,
    input: CreateHoldInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'balanceId');
    if (!input.reason?.trim())
      throw new AppError(
        'INVENTORY_HOLD_REASON_REQUIRED',
        'Hold reason is required',
        400,
      );
    const quantity = this.quantity(input);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { base_uom: string; original_uom: string; version: number }[]
      >`
        UPDATE wms.inventory_balance
        SET available_original = available_original - ${quantity.original},
            available_base = available_base - ${quantity.base},
            hold_original = hold_original + ${quantity.original},
            hold_base = hold_base + ${quantity.base},
            updated_at = CURRENT_TIMESTAMP,
            updated_by = ${context.accountId}::uuid,
            version = version + 1
        WHERE id = ${id}::uuid
          AND tenant_id = ${context.tenantId}::uuid
          AND status = 'AVAILABLE'::wms."InventoryStockStatus"
          AND version = ${input.expectedVersion}
          AND available_original >= ${quantity.original}
          AND available_base >= ${quantity.base}
          AND ${quantity.original} * on_hand_base = ${quantity.base} * on_hand_original
        RETURNING original_uom, base_uom, version
      `;
      if (!rows.length) throw this.conflict('INVENTORY_HOLD_CONFLICT');
      const holdId = randomUUID();
      const row = await tx.inventoryHold.create({
        data: {
          balanceId: id,
          createdBy: context.accountId,
          holdNo: `HLD-${Date.now()}-${holdId.slice(0, 6)}`,
          id: holdId,
          quantityBase: quantity.base,
          quantityOriginal: quantity.original,
          reason: input.reason.trim(),
          requiresApproval: input.requiresApproval ?? false,
          scopeRef: input.scopeRef?.trim() ?? null,
          scopeSnapshot: json(input.scopeSnapshot),
          scopeType: input.scopeType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const movement = await this.appendMovement(
        tx,
        id,
        'HOLD',
        quantity,
        rows[0]!.original_uom,
        rows[0]!.base_uom,
        'INVENTORY_HOLD',
        holdId,
        context,
        metadata,
      );
      await this.record(
        tx,
        holdId,
        'InventoryHold',
        row.version,
        'inventory.held.v1',
        context,
        metadata,
        {
          balanceId: id,
          holdId,
          movementId: movement.id,
          quantityBase: quantity.base.toString(),
        },
      );
      return {
        balanceVersion: rows[0]!.version,
        holdId,
        status: row.status,
        version: row.version,
      };
    });
  }

  async releaseHold(
    id: string,
    input: {
      approvalReference?: string;
      expectedBalanceVersion: number;
      expectedVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'holdId');
    if (!input.reason?.trim())
      throw new AppError(
        'INVENTORY_HOLD_RELEASE_REASON_REQUIRED',
        'Release reason is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.inventoryHold.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !hold ||
        hold.status !== 'ACTIVE' ||
        hold.version !== input.expectedVersion
      )
        throw this.conflict('INVENTORY_HOLD_CONFLICT');
      if (hold.requiresApproval && !input.approvalReference?.trim())
        throw new AppError(
          'INVENTORY_HOLD_APPROVAL_REQUIRED',
          'Approval is required to release this hold',
          403,
        );
      const rows = await tx.$queryRaw<
        { base_uom: string; original_uom: string; version: number }[]
      >`
        UPDATE wms.inventory_balance
        SET available_original = available_original + ${hold.quantityOriginal},
            available_base = available_base + ${hold.quantityBase},
            hold_original = hold_original - ${hold.quantityOriginal},
            hold_base = hold_base - ${hold.quantityBase},
            updated_at = CURRENT_TIMESTAMP,
            updated_by = ${context.accountId}::uuid,
            version = version + 1
        WHERE id = ${hold.balanceId}::uuid
          AND tenant_id = ${context.tenantId}::uuid
          AND version = ${input.expectedBalanceVersion}
          AND hold_original >= ${hold.quantityOriginal}
          AND hold_base >= ${hold.quantityBase}
        RETURNING original_uom, base_uom, version
      `;
      if (!rows.length) throw this.conflict('INVENTORY_HOLD_CONFLICT');
      const changed = await tx.inventoryHold.updateMany({
        data: {
          approvalReference: input.approvalReference?.trim() ?? null,
          releasedAt: new Date(),
          releaseReason: input.reason.trim(),
          status: 'RELEASED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id, status: 'ACTIVE', version: input.expectedVersion },
      });
      if (changed.count !== 1) throw this.conflict('INVENTORY_HOLD_CONFLICT');
      await this.appendMovement(
        tx,
        hold.balanceId,
        'RELEASE_HOLD',
        { base: hold.quantityBase, original: hold.quantityOriginal },
        rows[0]!.original_uom,
        rows[0]!.base_uom,
        'INVENTORY_HOLD',
        id,
        context,
        metadata,
      );
      await this.record(
        tx,
        id,
        'InventoryHold',
        hold.version + 1,
        'inventory.hold-released.v1',
        context,
        metadata,
        { balanceId: hold.balanceId, holdId: id },
      );
      return {
        balanceVersion: rows[0]!.version,
        status: 'RELEASED',
        version: hold.version + 1,
      };
    });
  }

  async reserve(
    id: string,
    input: CreateReservationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'balanceId');
    if (!input.sourceRef?.trim())
      throw new AppError(
        'INVENTORY_RESERVATION_SOURCE_REQUIRED',
        'Reservation source is required',
        400,
      );
    const quantity = this.quantity(input);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (
      expiresAt &&
      (Number.isNaN(expiresAt.valueOf()) || expiresAt <= new Date())
    )
      throw new AppError(
        'INVENTORY_RESERVATION_EXPIRY_INVALID',
        'Reservation expiry must be in the future',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { base_uom: string; original_uom: string; version: number }[]
      >`
        UPDATE wms.inventory_balance
        SET available_original = available_original - ${quantity.original},
            available_base = available_base - ${quantity.base},
            allocated_original = allocated_original + ${quantity.original},
            allocated_base = allocated_base + ${quantity.base},
            updated_at = CURRENT_TIMESTAMP,
            updated_by = ${context.accountId}::uuid,
            version = version + 1
        WHERE id = ${id}::uuid
          AND tenant_id = ${context.tenantId}::uuid
          AND status = 'AVAILABLE'::wms."InventoryStockStatus"
          AND version = ${input.expectedVersion}
          AND available_original >= ${quantity.original}
          AND available_base >= ${quantity.base}
          AND ${quantity.original} * on_hand_base = ${quantity.base} * on_hand_original
        RETURNING original_uom, base_uom, version
      `;
      if (!rows.length) throw this.conflict('INVENTORY_RESERVATION_CONFLICT');
      const reservationId = randomUUID();
      const reservation = await tx.inventoryReservation.create({
        data: {
          balanceId: id,
          createdBy: context.accountId,
          expiresAt,
          id: reservationId,
          quantityBase: quantity.base,
          quantityOriginal: quantity.original,
          reservationNo: `RSV-${Date.now()}-${reservationId.slice(0, 6)}`,
          sourceRef: input.sourceRef.trim(),
          sourceType: input.sourceType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await tx.allocationDetail.create({
        data: {
          balanceId: id,
          businessSnapshot: json(input.businessSnapshot),
          createdBy: context.accountId,
          quantityBase: quantity.base,
          quantityOriginal: quantity.original,
          reservationId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const movement = await this.appendMovement(
        tx,
        id,
        'RESERVE',
        quantity,
        rows[0]!.original_uom,
        rows[0]!.base_uom,
        input.sourceType,
        input.sourceRef,
        context,
        metadata,
      );
      await this.record(
        tx,
        reservationId,
        'InventoryReservation',
        reservation.version,
        'inventory.reserved.v1',
        context,
        metadata,
        {
          balanceId: id,
          movementId: movement.id,
          quantityBase: quantity.base.toString(),
          reservationId,
          sourceRef: reservation.sourceRef,
        },
      );
      return {
        balanceVersion: rows[0]!.version,
        reservationId,
        status: reservation.status,
        version: reservation.version,
      };
    });
  }

  async releaseReservation(
    id: string,
    input: {
      expectedBalanceVersion: number;
      expectedVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'reservationId');
    if (!input.reason?.trim())
      throw new AppError(
        'INVENTORY_RESERVATION_RELEASE_REASON_REQUIRED',
        'Release reason is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.inventoryReservation.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !reservation ||
        reservation.status !== 'RESERVED' ||
        reservation.version !== input.expectedVersion
      )
        throw this.conflict('INVENTORY_RESERVATION_CONFLICT');
      const rows = await tx.$queryRaw<
        { base_uom: string; original_uom: string; version: number }[]
      >`
        UPDATE wms.inventory_balance
        SET available_original = available_original + ${reservation.quantityOriginal},
            available_base = available_base + ${reservation.quantityBase},
            allocated_original = allocated_original - ${reservation.quantityOriginal},
            allocated_base = allocated_base - ${reservation.quantityBase},
            updated_at = CURRENT_TIMESTAMP,
            updated_by = ${context.accountId}::uuid,
            version = version + 1
        WHERE id = ${reservation.balanceId}::uuid
          AND tenant_id = ${context.tenantId}::uuid
          AND version = ${input.expectedBalanceVersion}
          AND allocated_original >= ${reservation.quantityOriginal}
          AND allocated_base >= ${reservation.quantityBase}
        RETURNING original_uom, base_uom, version
      `;
      if (!rows.length) throw this.conflict('INVENTORY_RESERVATION_CONFLICT');
      const changed = await tx.inventoryReservation.updateMany({
        data: {
          releasedAt: new Date(),
          releaseReason: input.reason.trim(),
          status: 'RELEASED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id, status: 'RESERVED', version: input.expectedVersion },
      });
      if (changed.count !== 1)
        throw this.conflict('INVENTORY_RESERVATION_CONFLICT');
      await this.appendMovement(
        tx,
        reservation.balanceId,
        'RELEASE_RESERVATION',
        {
          base: reservation.quantityBase,
          original: reservation.quantityOriginal,
        },
        rows[0]!.original_uom,
        rows[0]!.base_uom,
        reservation.sourceType,
        reservation.sourceRef,
        context,
        metadata,
      );
      await this.record(
        tx,
        id,
        'InventoryReservation',
        reservation.version + 1,
        'inventory.reservation-released.v1',
        context,
        metadata,
        { balanceId: reservation.balanceId, reservationId: id },
      );
      return {
        balanceVersion: rows[0]!.version,
        status: 'RELEASED',
        version: reservation.version + 1,
      };
    });
  }

  async reserveForOutbound(
    tx: Prisma.TransactionClient,
    id: string,
    input: {
      businessSnapshot: Readonly<Record<string, unknown>>;
      expectedVersion: number;
      quantityBase: string;
      quantityOriginal: string;
      sourceRef: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'balanceId');
    const quantity = this.quantity(input);
    const rows = await tx.$queryRaw<
      { base_uom: string; original_uom: string; version: number }[]
    >`
      UPDATE wms.inventory_balance
      SET available_original = available_original - ${quantity.original},
          available_base = available_base - ${quantity.base},
          allocated_original = allocated_original + ${quantity.original},
          allocated_base = allocated_base + ${quantity.base},
          updated_at = CURRENT_TIMESTAMP,
          updated_by = ${context.accountId}::uuid,
          version = version + 1
      WHERE id = ${id}::uuid
        AND tenant_id = ${context.tenantId}::uuid
        AND status = 'AVAILABLE'::wms."InventoryStockStatus"
        AND version = ${input.expectedVersion}
        AND available_original >= ${quantity.original}
        AND available_base >= ${quantity.base}
        AND ${quantity.original} * on_hand_base = ${quantity.base} * on_hand_original
      RETURNING original_uom, base_uom, version
    `;
    if (!rows.length) throw this.conflict('INVENTORY_RESERVATION_CONFLICT');
    const reservationId = randomUUID();
    const reservation = await tx.inventoryReservation.create({
      data: {
        balanceId: id,
        createdBy: context.accountId,
        id: reservationId,
        quantityBase: quantity.base,
        quantityOriginal: quantity.original,
        reservationNo: `RSV-${Date.now()}-${reservationId.slice(0, 6)}`,
        sourceRef: input.sourceRef,
        sourceType: 'WAVE',
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    await tx.allocationDetail.create({
      data: {
        balanceId: id,
        businessSnapshot: json(input.businessSnapshot),
        createdBy: context.accountId,
        quantityBase: quantity.base,
        quantityOriginal: quantity.original,
        reservationId,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    const movement = await this.appendMovement(
      tx,
      id,
      'RESERVE',
      quantity,
      rows[0]!.original_uom,
      rows[0]!.base_uom,
      'WAVE',
      input.sourceRef,
      context,
      metadata,
    );
    await this.record(
      tx,
      reservationId,
      'InventoryReservation',
      reservation.version,
      'inventory.reserved.v1',
      context,
      metadata,
      {
        balanceId: id,
        movementId: movement.id,
        quantityBase: quantity.base.toString(),
        reservationId,
        sourceRef: input.sourceRef,
      },
    );
    return {
      balanceVersion: rows[0]!.version,
      reservationId,
      version: reservation.version,
    };
  }

  async transfer(
    id: string,
    input: TransferInventoryInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'balanceId');
    this.uuid(input.targetLocationId, 'targetLocationId');
    if (!input.reason?.trim())
      throw new AppError(
        'INVENTORY_TRANSFER_REASON_REQUIRED',
        'Transfer reason is required',
        400,
      );
    const quantity = this.quantity(input);
    const transferId = randomUUID();
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockKey(
        tx,
        `capacity:${context.tenantId}:${input.targetLocationId}`,
      );
      await this.lockBalance(tx, id, context.tenantId);
      const source = await tx.inventoryBalance.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !source ||
        source.status !== 'AVAILABLE' ||
        source.version !== input.expectedVersion ||
        source.locationId === input.targetLocationId ||
        quantity.base.greaterThan(source.availableBase) ||
        quantity.original.greaterThan(source.availableOriginal) ||
        !this.sameRatio(
          quantity.original,
          quantity.base,
          source.onHandOriginal,
          source.onHandBase,
        )
      )
        throw this.conflict('INVENTORY_TRANSFER_CONFLICT');
      const capacity = await this.capacityCheck(
        tx,
        source,
        input.targetLocationId,
        quantity.base,
        'INVENTORY_TRANSFER',
        transferId,
        context,
      );
      if (!capacity.allowed) {
        await tx.capacityCheck.create({
          data: {
            allowed: false,
            businessRef: transferId,
            businessType: 'INVENTORY_TRANSFER',
            constraintSnapshot: json(capacity.snapshot),
            createdBy: context.accountId,
            exclusionReasons: capacity.exclusions,
            locationId: input.targetLocationId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        return { exclusions: capacity.exclusions, rejected: true as const };
      }
      const changed = await tx.inventoryBalance.updateMany({
        data: {
          availableBase: { decrement: quantity.base },
          availableOriginal: { decrement: quantity.original },
          onHandBase: { decrement: quantity.base },
          onHandOriginal: { decrement: quantity.original },
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          availableBase: { gte: quantity.base },
          availableOriginal: { gte: quantity.original },
          id,
          status: 'AVAILABLE',
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (changed.count !== 1)
        throw this.conflict('INVENTORY_TRANSFER_CONFLICT');
      const target = await this.postToBalance(
        tx,
        {
          baseUom: source.baseUom,
          businessRef: transferId,
          businessType: 'INVENTORY_TRANSFER',
          ...(source.handlingUnitId
            ? { handlingUnitId: source.handlingUnitId }
            : {}),
          ...(source.inventoryLotId
            ? { inventoryLotId: source.inventoryLotId }
            : {}),
          locationId: input.targetLocationId,
          originalUom: source.originalUom,
          ownerId: source.ownerId,
          productId: source.productId,
          quantityBase: quantity.base.toString(),
          quantityOriginal: quantity.original.toString(),
          ...(source.serialNumberId
            ? { serialNumberId: source.serialNumberId }
            : {}),
          status: source.status,
          warehouseId: source.warehouseId,
        },
        quantity,
        'TRANSFER',
        context,
        metadata,
        dimensionSnapshot(source),
      );
      await tx.capacityCheck.create({
        data: {
          allowed: true,
          businessRef: transferId,
          businessType: 'INVENTORY_TRANSFER',
          constraintSnapshot: json(capacity.snapshot),
          createdBy: context.accountId,
          exclusionReasons: [],
          locationId: input.targetLocationId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const task = await tx.inventoryTransferTask.create({
        data: {
          createdBy: context.accountId,
          id: transferId,
          movementId: target.movementId,
          quantityBase: quantity.base,
          quantityOriginal: quantity.original,
          reason: input.reason.trim(),
          sourceBalanceId: source.id,
          sourceLocationId: source.locationId,
          targetBalanceId: target.balanceId,
          targetLocationId: input.targetLocationId,
          taskNo: `TRF-${Date.now()}-${transferId.slice(0, 6)}`,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        transferId,
        'InventoryTransferTask',
        task.version,
        'inventory.transferred.v1',
        context,
        metadata,
        {
          movementId: target.movementId,
          quantityBase: quantity.base.toString(),
          sourceBalanceId: source.id,
          targetBalanceId: target.balanceId,
          transferId,
        },
      );
      return {
        rejected: false as const,
        sourceVersion: source.version + 1,
        targetBalanceId: target.balanceId,
        targetVersion: target.version,
        transferId,
      };
    });
    if (result.rejected)
      throw new AppError(
        'INVENTORY_LOCATION_CONSTRAINT_FAILED',
        result.exclusions.join(', '),
        409,
      );
    return result;
  }

  async applyApprovedAdjustment(
    tx: Prisma.TransactionClient,
    id: string,
    input: ApplyAdjustmentInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'balanceId');
    this.uuid(input.adjustmentId, 'adjustmentId');
    const quantity = this.quantity(input);
    await this.lockBalance(tx, id, context.tenantId);
    const balance = await tx.inventoryBalance.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (
      !balance ||
      balance.status !== 'AVAILABLE' ||
      balance.version !== input.expectedVersion ||
      !this.sameRatio(
        quantity.original,
        quantity.base,
        balance.onHandOriginal,
        balance.onHandBase,
      ) ||
      (input.direction === 'DECREASE' &&
        (balance.allocatedBase.greaterThan(0) ||
          balance.holdBase.greaterThan(0) ||
          quantity.base.greaterThan(balance.availableBase) ||
          quantity.original.greaterThan(balance.availableOriginal)))
    )
      throw this.conflict('INVENTORY_ADJUSTMENT_CONFLICT');
    const increase = input.direction === 'INCREASE';
    const changed = await tx.inventoryBalance.updateMany({
      data: {
        availableBase: increase
          ? { increment: quantity.base }
          : { decrement: quantity.base },
        availableOriginal: increase
          ? { increment: quantity.original }
          : { decrement: quantity.original },
        onHandBase: increase
          ? { increment: quantity.base }
          : { decrement: quantity.base },
        onHandOriginal: increase
          ? { increment: quantity.original }
          : { decrement: quantity.original },
        updatedBy: context.accountId,
        version: { increment: 1 },
      },
      where: {
        ...(increase
          ? {}
          : {
              availableBase: { gte: quantity.base },
              availableOriginal: { gte: quantity.original },
            }),
        id,
        status: 'AVAILABLE',
        tenantId: context.tenantId,
        version: input.expectedVersion,
      },
    });
    if (changed.count !== 1)
      throw this.conflict('INVENTORY_ADJUSTMENT_CONFLICT');
    const movement = await this.appendMovement(
      tx,
      id,
      'ADJUSTMENT',
      quantity,
      balance.originalUom,
      balance.baseUom,
      'INVENTORY_ADJUSTMENT',
      input.adjustmentId,
      context,
      metadata,
      increase ? {} : dimensionSnapshot(balance),
      increase ? dimensionSnapshot(balance) : {},
    );
    await this.record(
      tx,
      id,
      'InventoryBalance',
      balance.version + 1,
      'inventory.changed.v1',
      context,
      metadata,
      {
        adjustmentId: input.adjustmentId,
        balanceKey: dimensionSnapshot(balance),
        deltaBase: `${increase ? '' : '-'}${quantity.base.toString()}`,
        movementType: 'ADJUSTMENT',
      },
    );
    return { movementId: movement.id, version: balance.version + 1 };
  }

  async transferOwnership(
    id: string,
    input: OwnershipTransferInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'balanceId');
    this.uuid(input.targetOwnerId, 'targetOwnerId');
    if (
      !input.reason?.trim() ||
      !input.contractReference?.trim() ||
      !input.approvalReference?.trim()
    )
      throw new AppError(
        'OWNERSHIP_TRANSFER_AUTHORIZATION_REQUIRED',
        'Contract, approval and reason are required',
        403,
      );
    const quantity = this.quantity(input);
    return this.prisma.$transaction(async (tx) => {
      await this.lockBalance(tx, id, context.tenantId);
      const source = await tx.inventoryBalance.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !source ||
        source.status !== 'AVAILABLE' ||
        source.version !== input.expectedVersion ||
        source.ownerId === input.targetOwnerId ||
        source.allocatedBase.greaterThan(0) ||
        source.holdBase.greaterThan(0) ||
        quantity.base.greaterThan(source.availableBase) ||
        quantity.original.greaterThan(source.availableOriginal) ||
        !this.sameRatio(
          quantity.original,
          quantity.base,
          source.onHandOriginal,
          source.onHandBase,
        )
      )
        throw this.conflict('OWNERSHIP_TRANSFER_CONFLICT');
      const changed = await tx.inventoryBalance.updateMany({
        data: {
          availableBase: { decrement: quantity.base },
          availableOriginal: { decrement: quantity.original },
          onHandBase: { decrement: quantity.base },
          onHandOriginal: { decrement: quantity.original },
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          id,
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (changed.count !== 1)
        throw this.conflict('OWNERSHIP_TRANSFER_CONFLICT');
      const transferId = randomUUID();
      const outbound = await this.appendMovement(
        tx,
        source.id,
        'OWNERSHIP_OUT',
        quantity,
        source.originalUom,
        source.baseUom,
        'OWNERSHIP_TRANSFER',
        transferId,
        context,
        metadata,
        dimensionSnapshot(source),
        {},
      );
      const target = await this.postToBalance(
        tx,
        {
          baseUom: source.baseUom,
          businessRef: transferId,
          businessType: 'OWNERSHIP_TRANSFER',
          ...(source.handlingUnitId
            ? { handlingUnitId: source.handlingUnitId }
            : {}),
          ...(source.inventoryLotId
            ? { inventoryLotId: source.inventoryLotId }
            : {}),
          locationId: source.locationId,
          originalUom: source.originalUom,
          ownerId: input.targetOwnerId,
          productId: source.productId,
          quantityBase: quantity.base.toString(),
          quantityOriginal: quantity.original.toString(),
          ...(source.serialNumberId
            ? { serialNumberId: source.serialNumberId }
            : {}),
          status: source.status,
          warehouseId: source.warehouseId,
        },
        quantity,
        'OWNERSHIP_IN',
        context,
        metadata,
        dimensionSnapshot(source),
      );
      const row = await tx.ownershipTransfer.create({
        data: {
          approvalReference: input.approvalReference.trim(),
          chargeFactSnapshot: json({
            chargeType: 'OWNERSHIP_TRANSFER',
            quantityBase: quantity.base.toString(),
            ...(input.chargeFactSnapshot ?? {}),
          }),
          contractReference: input.contractReference.trim(),
          createdBy: context.accountId,
          fromOwnerId: source.ownerId,
          id: transferId,
          inboundMovementId: target.movementId,
          outboundMovementId: outbound.id,
          quantityBase: quantity.base,
          quantityOriginal: quantity.original,
          reason: input.reason.trim(),
          sourceBalanceId: source.id,
          targetBalanceId: target.balanceId,
          tenantId: context.tenantId,
          toOwnerId: input.targetOwnerId,
          transferNo: `OWN-${Date.now()}-${transferId.slice(0, 6)}`,
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        transferId,
        'OwnershipTransfer',
        row.version,
        'inventory.ownership-transferred.v1',
        context,
        metadata,
        {
          fromOwnerId: source.ownerId,
          inboundMovementId: target.movementId,
          outboundMovementId: outbound.id,
          quantityBase: quantity.base.toString(),
          toOwnerId: input.targetOwnerId,
          transferId,
        },
      );
      return {
        sourceVersion: source.version + 1,
        targetBalanceId: target.balanceId,
        targetVersion: target.version,
        transferId,
      };
    });
  }

  async createCount(
    input: CreateCountInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.warehouseId, 'warehouseId');
    if (input.ownerId) this.uuid(input.ownerId, 'ownerId');
    for (const id of input.balanceIds ?? []) this.uuid(id, 'balanceId');
    if (input.type === 'CYCLE' && !input.balanceIds?.length)
      throw new AppError(
        'INVENTORY_COUNT_CRITERIA_REQUIRED',
        'Cycle count requires selected balances',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const balances = await tx.inventoryBalance.findMany({
        orderBy: [{ locationId: 'asc' }, { id: 'asc' }],
        where: {
          ...(input.balanceIds?.length
            ? { id: { in: [...input.balanceIds] } }
            : {}),
          onHandBase: { gt: 0 },
          ...(input.ownerId ? { ownerId: input.ownerId } : {}),
          tenantId: context.tenantId,
          warehouseId: input.warehouseId,
        },
      });
      if (!balances.length)
        throw new AppError(
          'INVENTORY_COUNT_SCOPE_EMPTY',
          'Count scope contains no inventory',
          409,
        );
      const countId = randomUUID();
      const order = await tx.inventoryCountOrder.create({
        data: {
          blind: input.blind ?? true,
          countNo: `CNT-${Date.now()}-${countId.slice(0, 6)}`,
          createdBy: context.accountId,
          criteriaSnapshot: json({
            balanceIds: input.balanceIds ?? [],
            ...(input.criteriaSnapshot ?? {}),
          }),
          freezeInventory: input.freezeInventory ?? input.type === 'FULL',
          id: countId,
          ownerId: input.ownerId ?? null,
          tenantId: context.tenantId,
          type: input.type,
          updatedBy: context.accountId,
          warehouseId: input.warehouseId,
        },
      });
      for (const balance of balances) {
        await this.lockBalance(tx, balance.id, context.tenantId);
        const line = await tx.inventoryCountLine.create({
          data: {
            balanceId: balance.id,
            countOrderId: countId,
            createdBy: context.accountId,
            dimensionSnapshot: json(dimensionSnapshot(balance)),
            expectedQuantityBase: balance.onHandBase,
            expectedQuantityOriginal: balance.onHandOriginal,
            locationId: balance.locationId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        if (order.freezeInventory && balance.availableBase.greaterThan(0)) {
          const current = await tx.inventoryBalance.findUniqueOrThrow({
            where: { id: balance.id },
          });
          const changed = await tx.inventoryBalance.updateMany({
            data: {
              availableBase: 0,
              availableOriginal: 0,
              holdBase: { increment: current.availableBase },
              holdOriginal: { increment: current.availableOriginal },
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: balance.id, version: current.version },
          });
          if (changed.count !== 1)
            throw this.conflict('INVENTORY_COUNT_FREEZE_CONFLICT');
          const holdId = randomUUID();
          await tx.inventoryHold.create({
            data: {
              balanceId: balance.id,
              createdBy: context.accountId,
              holdNo: `CNT-HLD-${Date.now()}-${holdId.slice(0, 6)}`,
              id: holdId,
              quantityBase: current.availableBase,
              quantityOriginal: current.availableOriginal,
              reason: `Count ${order.countNo}`,
              requiresApproval: false,
              scopeRef: order.countNo,
              scopeSnapshot: json({ countOrderId: countId }),
              scopeType: 'LOCATION',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await tx.inventoryCountFreeze.create({
            data: {
              balanceId: balance.id,
              countLineId: line.id,
              countOrderId: countId,
              createdBy: context.accountId,
              frozenBase: current.availableBase,
              frozenOriginal: current.availableOriginal,
              holdId,
              locationId: balance.locationId,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
        }
      }
      await this.record(
        tx,
        countId,
        'InventoryCountOrder',
        order.version,
        'inventory.count-planned.v1',
        context,
        metadata,
        { countId, lineCount: balances.length, type: order.type },
      );
      return {
        countId,
        frozen: order.freezeInventory,
        lineCount: balances.length,
        status: order.status,
        version: order.version,
      };
    });
  }

  async getCount(id: string, context: TenantContext) {
    this.uuid(id, 'countId');
    const order = await this.prisma.inventoryCountOrder.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!order)
      throw new AppError(
        'INVENTORY_COUNT_NOT_FOUND',
        'Count was not found',
        404,
      );
    const [lines, freezes] = await Promise.all([
      this.prisma.inventoryCountLine.findMany({
        orderBy: [{ locationId: 'asc' }, { createdAt: 'asc' }],
        where: { countOrderId: id, tenantId: context.tenantId },
      }),
      this.prisma.inventoryCountFreeze.findMany({
        orderBy: { createdAt: 'asc' },
        where: { countOrderId: id, tenantId: context.tenantId },
      }),
    ]);
    return { freezes, lines, order };
  }

  async countLine(
    id: string,
    input: InventoryQuantityInput & { reason?: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'countLineId');
    const quantity = this.nonNegativeQuantity(input);
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.inventoryCountLine.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!line || line.version !== input.expectedVersion)
        throw this.conflict('INVENTORY_COUNT_LINE_CONFLICT');
      if (
        !this.sameRatio(
          quantity.original,
          quantity.base,
          line.expectedQuantityOriginal,
          line.expectedQuantityBase,
        )
      )
        throw new AppError(
          'INVENTORY_COUNT_UOM_RATIO_INVALID',
          'Count quantity must preserve the balance unit ratio',
          400,
        );
      const order = await tx.inventoryCountOrder.findFirstOrThrow({
        where: { id: line.countOrderId, tenantId: context.tenantId },
      });
      if (order.status !== 'COUNTING')
        throw new AppError(
          'INVENTORY_COUNT_STATE_INVALID',
          'Count order must be counting',
          409,
        );
      const first = line.status === 'OPEN';
      const recount = ['COUNTED', 'RECOUNTED'].includes(line.status);
      if (!first && !recount)
        throw this.conflict('INVENTORY_COUNT_LINE_CONFLICT');
      const changed = await tx.inventoryCountLine.update({
        data: first
          ? {
              firstCountBase: quantity.base,
              firstCountOriginal: quantity.original,
              status: 'COUNTED',
              updatedBy: context.accountId,
              varianceReason: input.reason?.trim() ?? null,
              version: { increment: 1 },
            }
          : {
              recountBase: quantity.base,
              recountOriginal: quantity.original,
              status: 'RECOUNTED',
              updatedBy: context.accountId,
              varianceReason: input.reason?.trim() ?? line.varianceReason,
              version: { increment: 1 },
            },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'InventoryCountLine',
        changed.version,
        first ? 'inventory.counted.v1' : 'inventory.recounted.v1',
        context,
        metadata,
        {
          countId: order.id,
          countLineId: id,
          quantityBase: quantity.base.toString(),
        },
      );
      return { status: changed.status, version: changed.version };
    });
  }

  async approveCountLine(
    id: string,
    input: InventoryQuantityInput & {
      approvalReference: string;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'countLineId');
    if (!input.approvalReference?.trim() || !input.reason?.trim())
      throw new AppError(
        'INVENTORY_COUNT_APPROVAL_REQUIRED',
        'Approval and variance reason are required',
        403,
      );
    const quantity = this.nonNegativeQuantity(input);
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.inventoryCountLine.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      const order = line
        ? await tx.inventoryCountOrder.findFirst({
            where: { id: line.countOrderId, tenantId: context.tenantId },
          })
        : null;
      if (
        !line ||
        !order ||
        order.status !== 'REVIEWING' ||
        !['COUNTED', 'RECOUNTED'].includes(line.status) ||
        line.version !== input.expectedVersion
      )
        throw this.conflict('INVENTORY_COUNT_LINE_CONFLICT');
      if (
        !this.sameRatio(
          quantity.original,
          quantity.base,
          line.expectedQuantityOriginal,
          line.expectedQuantityBase,
        )
      )
        throw new AppError(
          'INVENTORY_COUNT_UOM_RATIO_INVALID',
          'Approved quantity must preserve the balance unit ratio',
          400,
        );
      const changed = await tx.inventoryCountLine.update({
        data: {
          approvalReference: input.approvalReference.trim(),
          approvedQuantityBase: quantity.base,
          approvedQuantityOriginal: quantity.original,
          status: 'APPROVED',
          updatedBy: context.accountId,
          varianceReason: input.reason.trim(),
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.record(
        tx,
        id,
        'InventoryCountLine',
        changed.version,
        'inventory.count-variance-approved.v1',
        context,
        metadata,
        { countId: order.id, countLineId: id },
      );
      return { status: changed.status, version: changed.version };
    });
  }

  async transitionCount(
    id: string,
    input: {
      expectedVersion: number;
      targetStatus: 'COUNTING' | 'REVIEWING' | 'POSTED' | 'CLOSED';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'countId');
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.inventoryCountOrder.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!order || order.version !== input.expectedVersion)
        throw this.conflict('INVENTORY_COUNT_CONFLICT');
      const allowed =
        (order.status === 'PLANNED' && input.targetStatus === 'COUNTING') ||
        (order.status === 'COUNTING' && input.targetStatus === 'REVIEWING') ||
        (order.status === 'REVIEWING' && input.targetStatus === 'POSTED') ||
        (order.status === 'POSTED' && input.targetStatus === 'CLOSED');
      if (!allowed)
        throw new AppError(
          'INVENTORY_COUNT_TRANSITION_INVALID',
          `Count transition ${order.status} -> ${input.targetStatus} is not allowed`,
          409,
        );
      const lines = await tx.inventoryCountLine.findMany({
        where: { countOrderId: id, tenantId: context.tenantId },
      });
      if (
        input.targetStatus === 'REVIEWING' &&
        lines.some(({ status }) => status === 'OPEN')
      )
        throw new AppError(
          'INVENTORY_COUNT_LINES_INCOMPLETE',
          'Every line requires a first count',
          409,
        );
      if (
        input.targetStatus === 'POSTED' &&
        lines.some((line) => {
          const counted = line.recountBase ?? line.firstCountBase;
          return (
            counted === null ||
            (!counted.equals(line.expectedQuantityBase) &&
              line.status !== 'APPROVED')
          );
        })
      )
        throw new AppError(
          'INVENTORY_COUNT_VARIANCE_UNAPPROVED',
          'Every variance requires recount or approval',
          409,
        );
      if (input.targetStatus === 'CLOSED') {
        const activeFreezes = await tx.inventoryCountFreeze.count({
          where: {
            countOrderId: id,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        if (activeFreezes)
          throw new AppError(
            'INVENTORY_COUNT_FREEZE_ACTIVE',
            'Every count segment must be released before close',
            409,
          );
      }
      const changed = await tx.inventoryCountOrder.update({
        data: {
          closedAt:
            input.targetStatus === 'CLOSED' ? new Date() : order.closedAt,
          postedAt:
            input.targetStatus === 'POSTED' ? new Date() : order.postedAt,
          reviewedAt:
            input.targetStatus === 'REVIEWING' ? new Date() : order.reviewedAt,
          startedAt:
            input.targetStatus === 'COUNTING' ? new Date() : order.startedAt,
          status: input.targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      if (input.targetStatus === 'POSTED')
        await tx.inventoryCountLine.updateMany({
          data: {
            status: 'POSTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { countOrderId: id, tenantId: context.tenantId },
        });
      await this.record(
        tx,
        id,
        'InventoryCountOrder',
        changed.version,
        'inventory.count-transitioned.v1',
        context,
        metadata,
        { countId: id, from: order.status, to: input.targetStatus },
      );
      return { status: changed.status, version: changed.version };
    });
  }

  async releaseCountSegment(
    id: string,
    input: { locationId: string; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'countId');
    this.uuid(input.locationId, 'locationId');
    if (!input.reason?.trim())
      throw new AppError(
        'INVENTORY_COUNT_RELEASE_REASON_REQUIRED',
        'Segment release reason is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.inventoryCountOrder.findFirst({
        where: { id, status: 'POSTED', tenantId: context.tenantId },
      });
      if (!order)
        throw new AppError(
          'INVENTORY_COUNT_STATE_INVALID',
          'Only posted count can release segments',
          409,
        );
      const freezes = await tx.inventoryCountFreeze.findMany({
        orderBy: { balanceId: 'asc' },
        where: {
          countOrderId: id,
          locationId: input.locationId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      if (!freezes.length)
        throw new AppError(
          'INVENTORY_COUNT_SEGMENT_NOT_FROZEN',
          'No active freeze exists for this segment',
          404,
        );
      for (const freeze of freezes) {
        await this.lockBalance(tx, freeze.balanceId, context.tenantId);
        const balance = await tx.inventoryBalance.findUniqueOrThrow({
          where: { id: freeze.balanceId },
        });
        const changed = await tx.inventoryBalance.updateMany({
          data: {
            availableBase: { increment: freeze.frozenBase },
            availableOriginal: { increment: freeze.frozenOriginal },
            holdBase: { decrement: freeze.frozenBase },
            holdOriginal: { decrement: freeze.frozenOriginal },
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            holdBase: { gte: freeze.frozenBase },
            holdOriginal: { gte: freeze.frozenOriginal },
            id: balance.id,
            version: balance.version,
          },
        });
        if (changed.count !== 1)
          throw this.conflict('INVENTORY_COUNT_FREEZE_CONFLICT');
        await tx.inventoryHold.update({
          data: {
            releasedAt: new Date(),
            releaseReason: input.reason.trim(),
            status: 'RELEASED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: freeze.holdId },
        });
        await tx.inventoryCountFreeze.update({
          data: {
            releasedAt: new Date(),
            status: 'RELEASED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: freeze.id },
        });
      }
      await this.record(
        tx,
        id,
        'InventoryCountOrder',
        order.version,
        'inventory.count-segment-released.v1',
        context,
        metadata,
        { countId: id, locationId: input.locationId },
      );
      return { locationId: input.locationId, releasedCount: freezes.length };
    });
  }

  private async capacityCheck(
    tx: Prisma.TransactionClient,
    source: {
      handlingUnitId: string | null;
      inventoryLotId: string | null;
      ownerId: string;
      productId: string;
      warehouseId: string;
    },
    targetLocationId: string,
    incomingQuantityBase: Prisma.Decimal,
    businessType: string,
    businessRef: string,
    context: TenantContext,
  ) {
    const [locations, targetBalances] = await Promise.all([
      this.mdm.listWarehouseLocations(source.warehouseId, context),
      tx.inventoryBalance.findMany({
        where: {
          locationId: targetLocationId,
          onHandBase: { gt: 0 },
          tenantId: context.tenantId,
        },
      }),
    ]);
    const references = await this.mdm.resolveOrderReferences(
      {
        lines: [
          ...new Set([
            source.productId,
            ...targetBalances.map(({ productId }) => productId),
          ]),
        ].map((productId) => ({ productId })),
      },
      context,
    );
    const target = locations.find(({ id }) => id === targetLocationId);
    const product = references.products[0];
    const exclusions: string[] = [];
    if (!target || target.type !== 'LOCATION')
      exclusions.push('TARGET_NOT_STORAGE');
    if (!product) exclusions.push('PRODUCT_NOT_ACTIVE');
    if (
      target &&
      product?.temperatureZone &&
      target.temperatureZone &&
      product.temperatureZone !== target.temperatureZone
    )
      exclusions.push('TEMPERATURE_INCOMPATIBLE');
    if (target && product?.hazardous && !target.hazardousAllowed)
      exclusions.push('HAZARDOUS_NOT_ALLOWED');
    const mixing = (target?.mixingRules ?? {}) as Record<string, unknown>;
    if (
      mixing.allowMixedOwners === false &&
      targetBalances.some(({ ownerId }) => ownerId !== source.ownerId)
    )
      exclusions.push('MIXED_OWNER_NOT_ALLOWED');
    if (
      mixing.allowMixedProducts === false &&
      targetBalances.some(({ productId }) => productId !== source.productId)
    )
      exclusions.push('MIXED_PRODUCT_NOT_ALLOWED');
    if (
      mixing.allowMixedLots === false &&
      targetBalances.some(
        ({ inventoryLotId }) => inventoryLotId !== source.inventoryLotId,
      )
    )
      exclusions.push('MIXED_LOT_NOT_ALLOWED');
    const currentQuantity = targetBalances.reduce(
      (total, balance) => total.add(balance.onHandBase),
      new Prisma.Decimal(0),
    );
    const decimalRule = (value: unknown) => {
      try {
        return value === undefined || value === null
          ? null
          : new Prisma.Decimal(String(value));
      } catch {
        return null;
      }
    };
    const maxQuantity = decimalRule(mixing.maxQuantityBase);
    if (
      maxQuantity &&
      currentQuantity.add(incomingQuantityBase).greaterThan(maxQuantity)
    )
      exclusions.push('QUANTITY_CAPACITY_EXCEEDED');
    const metric = (
      reference: (typeof references.products)[number] | undefined,
      names: readonly string[],
    ) => {
      const snapshot = (reference?.versionSnapshot ?? {}) as Record<
        string,
        unknown
      >;
      for (const name of names) {
        const value = decimalRule(snapshot[name]);
        if (value) return value;
      }
      return null;
    };
    const capacityUsage = (names: readonly string[]) =>
      targetBalances.reduce((total, balance) => {
        const reference = references.products.find(
          ({ id }) => id === balance.productId,
        );
        const perBase = metric(reference, names);
        return perBase ? total.add(perBase.mul(balance.onHandBase)) : total;
      }, new Prisma.Decimal(0));
    const sourceReference = references.products.find(
      ({ id }) => id === source.productId,
    );
    const sourceWeight = metric(sourceReference, [
      'weightPerBase',
      'unitWeight',
      'grossWeight',
    ]);
    const sourceVolume = metric(sourceReference, [
      'volumePerBase',
      'unitVolume',
      'volume',
    ]);
    const projectedWeight = capacityUsage([
      'weightPerBase',
      'unitWeight',
      'grossWeight',
    ]).add(sourceWeight?.mul(incomingQuantityBase) ?? 0);
    const projectedVolume = capacityUsage([
      'volumePerBase',
      'unitVolume',
      'volume',
    ]).add(sourceVolume?.mul(incomingQuantityBase) ?? 0);
    if (
      target?.maxWeight !== null &&
      target?.maxWeight !== undefined &&
      projectedWeight.greaterThan(target.maxWeight)
    )
      exclusions.push('WEIGHT_CAPACITY_EXCEEDED');
    if (
      target?.maxVolume !== null &&
      target?.maxVolume !== undefined &&
      projectedVolume.greaterThan(target.maxVolume)
    )
      exclusions.push('VOLUME_CAPACITY_EXCEEDED');
    const currentUnits = new Set(
      targetBalances.flatMap(({ handlingUnitId }) =>
        handlingUnitId ? [handlingUnitId] : [],
      ),
    );
    if (
      target?.palletCapacity !== null &&
      target?.palletCapacity !== undefined &&
      source.handlingUnitId &&
      !currentUnits.has(source.handlingUnitId) &&
      new Prisma.Decimal(currentUnits.size + 1).greaterThan(
        target.palletCapacity,
      )
    )
      exclusions.push('PALLET_CAPACITY_EXCEEDED');
    return {
      allowed: exclusions.length === 0,
      exclusions,
      snapshot: {
        businessRef,
        businessType,
        currentHandlingUnitCount: currentUnits.size,
        currentQuantityBase: currentQuantity.toString(),
        incomingQuantityBase: incomingQuantityBase.toString(),
        mixingRules: target?.mixingRules ?? {},
        palletCapacity: target?.palletCapacity ?? null,
        product,
        projectedVolume: projectedVolume.toString(),
        projectedWeight: projectedWeight.toString(),
        target,
      },
    };
  }

  private nonNegativeQuantity(input: {
    quantityBase: string;
    quantityOriginal: string;
  }) {
    try {
      const base = new Prisma.Decimal(input.quantityBase);
      const original = new Prisma.Decimal(input.quantityOriginal);
      if (
        !base.isFinite() ||
        !original.isFinite() ||
        base.isNegative() ||
        original.isNegative()
      )
        throw new Error();
      return { base, original };
    } catch {
      throw new AppError(
        'INVENTORY_QUANTITY_INVALID',
        'Count quantity must be non-negative decimal values',
        400,
      );
    }
  }

  private async postToBalance(
    tx: Prisma.TransactionClient,
    input: PostInventoryInput,
    quantity: { base: Prisma.Decimal; original: Prisma.Decimal },
    movementType: InventoryMovementType,
    context: TenantContext,
    metadata: CommandMetadata,
    fromDimensions: Prisma.InputJsonObject = {},
  ) {
    const key = [
      context.tenantId,
      input.warehouseId,
      input.locationId,
      input.ownerId,
      input.productId,
      input.inventoryLotId ?? '-',
      input.serialNumberId ?? '-',
      input.handlingUnitId ?? '-',
      input.status,
    ].join(':');
    await tx.$queryRaw`
      SELECT 1::int AS locked
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS lock
    `;
    let balance = await tx.inventoryBalance.findFirst({
      where: {
        handlingUnitId: input.handlingUnitId ?? null,
        inventoryLotId: input.inventoryLotId ?? null,
        locationId: input.locationId,
        ownerId: input.ownerId,
        productId: input.productId,
        serialNumberId: input.serialNumberId ?? null,
        status: input.status,
        tenantId: context.tenantId,
        warehouseId: input.warehouseId,
      },
    });
    const available = input.status === 'AVAILABLE';
    if (!balance)
      balance = await tx.inventoryBalance.create({
        data: {
          availableBase: available ? quantity.base : 0,
          availableOriginal: available ? quantity.original : 0,
          baseUom: input.baseUom.trim().toUpperCase(),
          createdBy: context.accountId,
          handlingUnitId: input.handlingUnitId ?? null,
          holdBase: available ? 0 : quantity.base,
          holdOriginal: available ? 0 : quantity.original,
          inventoryLotId: input.inventoryLotId ?? null,
          locationId: input.locationId,
          onHandBase: quantity.base,
          onHandOriginal: quantity.original,
          originalUom: input.originalUom.trim().toUpperCase(),
          ownerId: input.ownerId,
          productId: input.productId,
          serialNumberId: input.serialNumberId ?? null,
          status: input.status,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          warehouseId: input.warehouseId,
        },
      });
    else {
      if (
        balance.originalUom !== input.originalUom.trim().toUpperCase() ||
        balance.baseUom !== input.baseUom.trim().toUpperCase() ||
        !this.sameRatio(
          quantity.original,
          quantity.base,
          balance.onHandOriginal,
          balance.onHandBase,
        )
      )
        throw new AppError(
          'INVENTORY_UOM_CONFLICT',
          'Inventory dimension uses different units',
          409,
        );
      balance = await tx.inventoryBalance.update({
        data: {
          availableBase: available
            ? { increment: quantity.base }
            : balance.availableBase,
          availableOriginal: available
            ? { increment: quantity.original }
            : balance.availableOriginal,
          holdBase: available ? balance.holdBase : { increment: quantity.base },
          holdOriginal: available
            ? balance.holdOriginal
            : { increment: quantity.original },
          onHandBase: { increment: quantity.base },
          onHandOriginal: { increment: quantity.original },
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: balance.id },
      });
    }
    const movement = await this.appendMovement(
      tx,
      balance.id,
      movementType,
      quantity,
      balance.originalUom,
      balance.baseUom,
      input.businessType,
      input.businessRef,
      context,
      metadata,
      fromDimensions,
      dimensionSnapshot(balance),
    );
    await this.record(
      tx,
      balance.id,
      'InventoryBalance',
      balance.version,
      'inventory.changed.v1',
      context,
      metadata,
      {
        balanceKey: dimensionSnapshot(balance),
        businessRef: input.businessRef,
        delta: {
          quantityBase: quantity.base.toString(),
          quantityOriginal: quantity.original.toString(),
        },
        movementId: movement.id,
        movementType,
      },
    );
    return {
      balanceId: balance.id,
      movementId: movement.id,
      status: balance.status,
      version: balance.version,
    };
  }

  private async appendMovement(
    tx: Prisma.TransactionClient,
    balanceId: string,
    type: InventoryMovementType,
    quantity: { base: Prisma.Decimal; original: Prisma.Decimal },
    originalUom: string,
    baseUom: string,
    businessType: string,
    businessRef: string,
    context: TenantContext,
    metadata: CommandMetadata,
    fromDimensions: Prisma.InputJsonObject = {},
    toDimensions: Prisma.InputJsonObject = {},
  ) {
    const previous = await tx.inventoryMovement.findFirst({
      orderBy: { chainSequence: 'desc' },
      where: { balanceId, tenantId: context.tenantId },
    });
    const id = randomUUID();
    const data = {
      balanceId,
      baseUom,
      businessRef: businessRef.trim(),
      businessType: businessType.trim().toUpperCase(),
      chainSequence: (previous?.chainSequence ?? 0) + 1,
      fromDimensions: json(fromDimensions),
      id,
      movementNo: `IM-${Date.now()}-${id.slice(0, 6)}`,
      originalUom,
      previousHash: previous?.movementHash ?? null,
      quantityBase: quantity.base,
      quantityOriginal: quantity.original,
      tenantId: context.tenantId,
      toDimensions: json(toDimensions),
      traceId: metadata.correlationId,
      type,
    };
    return tx.inventoryMovement.create({
      data: {
        ...data,
        createdBy: context.accountId,
        movementHash: this.movementHash(data),
        updatedBy: context.accountId,
      },
    });
  }

  private movementHash(movement: {
    balanceId: string;
    baseUom: string;
    businessRef: string;
    businessType: string;
    chainSequence: number;
    fromDimensions: unknown;
    previousHash: string | null;
    quantityBase: Prisma.Decimal;
    quantityOriginal: Prisma.Decimal;
    originalUom: string;
    tenantId: string;
    toDimensions: unknown;
    traceId: string;
    type: InventoryMovementType;
  }) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          balanceId: movement.balanceId,
          baseUom: movement.baseUom,
          businessRef: movement.businessRef,
          businessType: movement.businessType,
          chainSequence: movement.chainSequence,
          fromDimensions: canonicalJson(movement.fromDimensions),
          originalUom: movement.originalUom,
          previousHash: movement.previousHash,
          quantityBase: movement.quantityBase.toString(),
          quantityOriginal: movement.quantityOriginal.toString(),
          tenantId: movement.tenantId,
          toDimensions: canonicalJson(movement.toDimensions),
          traceId: movement.traceId,
          type: movement.type,
        }),
      )
      .digest('hex');
  }

  private quantity(input: { quantityBase: string; quantityOriginal: string }) {
    try {
      const base = new Prisma.Decimal(input.quantityBase);
      const original = new Prisma.Decimal(input.quantityOriginal);
      if (
        !base.isFinite() ||
        !original.isFinite() ||
        !base.greaterThan(0) ||
        !original.greaterThan(0)
      )
        throw new Error();
      return { base, original };
    } catch {
      throw new AppError(
        'INVENTORY_QUANTITY_INVALID',
        'Inventory quantity must be positive decimal values',
        400,
      );
    }
  }

  private sameRatio(
    leftOriginal: Prisma.Decimal,
    leftBase: Prisma.Decimal,
    rightOriginal: Prisma.Decimal,
    rightBase: Prisma.Decimal,
  ) {
    return leftOriginal.mul(rightBase).equals(leftBase.mul(rightOriginal));
  }

  private dimensions(input: InventoryDimensions) {
    for (const [field, value] of Object.entries({
      handlingUnitId: input.handlingUnitId,
      inventoryLotId: input.inventoryLotId,
      locationId: input.locationId,
      ownerId: input.ownerId,
      productId: input.productId,
      serialNumberId: input.serialNumberId,
      warehouseId: input.warehouseId,
    }))
      if (value) this.uuid(value, field);
  }

  private uuid(value: string, field: string) {
    if (!isUuid(value))
      throw new AppError('WMS_INPUT_INVALID', `${field} is invalid`, 400);
  }

  private lockBalance(
    tx: Prisma.TransactionClient,
    id: string,
    tenantId: string,
  ) {
    return tx.$queryRaw`
      SELECT id FROM wms.inventory_balance
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE
    `;
  }

  private async lockKey(tx: Prisma.TransactionClient, key: string) {
    await tx.$queryRaw`
      SELECT 1::int AS locked
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS lock
    `;
  }

  private conflict(code: string) {
    return new AppError(
      code,
      'Inventory changed or quantity is unavailable',
      409,
      {
        retryable: true,
      },
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
