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
      locationId?: string;
      ownerId?: string;
      page?: number;
      pageSize?: number;
      productId?: string;
      status?: InventoryStockStatus;
      warehouseId?: string;
    },
    context: TenantContext,
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const where = {
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
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
