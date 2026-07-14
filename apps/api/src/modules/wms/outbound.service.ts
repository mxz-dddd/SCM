import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  PickMode,
  Prisma,
  type ShortageResolutionType,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import type { CommandMetadata } from '../platform/tenant.service';
import { InventoryService } from './inventory.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const decimal = (value: unknown, fallback = '0') => {
  try {
    return new Prisma.Decimal(String(value ?? fallback));
  } catch {
    return new Prisma.Decimal(fallback);
  }
};

export interface CreateOutboundInput {
  readonly carrierMode?: string;
  readonly customerId?: string;
  readonly destinationSnapshot: Readonly<Record<string, unknown>>;
  readonly lines: readonly {
    readonly allocationConstraints?: Readonly<Record<string, unknown>>;
    readonly baseUom: string;
    readonly lineNo: number;
    readonly originalUom: string;
    readonly productId: string;
    readonly quantityBase: string;
    readonly quantityOriginal: string;
  }[];
  readonly ownerId: string;
  readonly routeCode?: string;
  readonly serviceLevel: string;
  readonly sourceRef: string;
  readonly sourceSnapshot?: Readonly<Record<string, unknown>>;
  readonly temperatureZone?: string;
  readonly type: 'SALES' | 'TRANSFER' | 'RETURN_VENDOR';
  readonly warehouseId: string;
  readonly cutoffAt: string;
}

@Injectable()
export class OutboundService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MdmReferenceService) private readonly mdm: MdmReferenceService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  async createOutbound(
    input: CreateOutboundInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.warehouseId, 'warehouseId');
    this.uuid(input.ownerId, 'ownerId');
    if (input.customerId) this.uuid(input.customerId, 'customerId');
    const cutoffAt = new Date(input.cutoffAt);
    if (
      !input.sourceRef?.trim() ||
      !input.serviceLevel?.trim() ||
      !Object.keys(input.destinationSnapshot ?? {}).length ||
      !input.lines?.length ||
      Number.isNaN(cutoffAt.getTime())
    )
      throw new AppError(
        'OUTBOUND_INPUT_INVALID',
        'Source, destination, service level, cutoff and lines are required',
        400,
      );
    if (
      new Set(input.lines.map(({ lineNo }) => lineNo)).size !==
      input.lines.length
    )
      throw new AppError(
        'OUTBOUND_LINE_DUPLICATE',
        'Line numbers must be unique',
        400,
      );
    for (const line of input.lines) {
      this.uuid(line.productId, 'productId');
      this.quantity(line);
      if (!Number.isInteger(line.lineNo) || line.lineNo < 1)
        throw new AppError(
          'OUTBOUND_LINE_INVALID',
          'Line number is invalid',
          400,
        );
    }
    const references = await this.mdm.resolveOrderReferences(
      {
        ...(input.customerId ? { customerId: input.customerId } : {}),
        lines: input.lines.map(({ productId }) => ({ productId })),
      },
      context,
    );
    if (
      references.products.length !==
        new Set(input.lines.map(({ productId }) => productId)).size ||
      (input.customerId && !references.customer)
    )
      throw new AppError(
        'OUTBOUND_REFERENCE_INVALID',
        'Active products and customer are required',
        400,
      );
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.outboundOrder.create({
        data: {
          carrierMode: input.carrierMode?.trim() ?? null,
          createdBy: context.accountId,
          customerId: input.customerId ?? null,
          cutoffAt,
          destinationSnapshot: json(input.destinationSnapshot),
          id,
          outboundNo: `OUT-${Date.now()}-${id.slice(0, 6)}`,
          ownerId: input.ownerId,
          routeCode: input.routeCode?.trim() ?? null,
          serviceLevel: input.serviceLevel.trim(),
          sourceRef: input.sourceRef.trim(),
          sourceSnapshot: json(input.sourceSnapshot),
          temperatureZone: input.temperatureZone?.trim() ?? null,
          tenantId: context.tenantId,
          type: input.type,
          updatedBy: context.accountId,
          warehouseId: input.warehouseId,
        },
      });
      for (const line of input.lines) {
        const product = references.products.find(
          ({ id }) => id === line.productId,
        )!;
        await tx.outboundLine.create({
          data: {
            allocationConstraints: json(line.allocationConstraints),
            baseUom: line.baseUom.trim().toUpperCase(),
            createdBy: context.accountId,
            lineNo: line.lineNo,
            originalUom: line.originalUom.trim().toUpperCase(),
            outboundOrderId: id,
            productId: line.productId,
            productSnapshot: json(product),
            quantityBase: line.quantityBase,
            quantityOriginal: line.quantityOriginal,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      await this.emit(
        tx,
        id,
        'OutboundOrder',
        order.version,
        'outbound.created.v1',
        context,
        metadata,
        { outboundId: id, sourceRef: order.sourceRef },
      );
      return { outboundId: id, status: order.status, version: order.version };
    });
  }

  async releaseOutbound(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'outboundId');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.outboundOrder.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !row ||
        row.status !== 'DRAFT' ||
        row.version !== input.expectedVersion
      )
        throw this.conflict('OUTBOUND_ORDER_CONFLICT');
      if (row.cutoffAt <= new Date())
        throw new AppError(
          'OUTBOUND_CUTOFF_EXPIRED',
          'Outbound cutoff has expired',
          409,
        );
      const changed = await tx.outboundOrder.update({
        data: {
          releasedAt: new Date(),
          status: 'RELEASED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        id,
        'OutboundOrder',
        changed.version,
        'outbound.released.v1',
        context,
        metadata,
        { outboundId: id },
      );
      return { status: changed.status, version: changed.version };
    });
  }

  async saveWaveTemplate(
    input: {
      capacitySnapshot: Readonly<Record<string, unknown>>;
      criteria: Readonly<Record<string, unknown>>;
      name: string;
      strategy: Readonly<Record<string, unknown>>;
      warehouseId: string;
      workloadFactors: Readonly<Record<string, unknown>>;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.warehouseId, 'warehouseId');
    if (!input.name?.trim())
      throw new AppError(
        'WAVE_TEMPLATE_INVALID',
        'Template name is required',
        400,
      );
    const locations = await this.mdm.listWarehouseLocations(
      input.warehouseId,
      context,
    );
    if (!locations.length)
      throw new AppError(
        'WAVE_WAREHOUSE_INVALID',
        'Active warehouse is required',
        400,
      );
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.waveTemplate.create({
        data: {
          capacitySnapshot: json(input.capacitySnapshot),
          createdBy: context.accountId,
          criteria: json(input.criteria),
          id,
          name: input.name.trim(),
          strategy: json(input.strategy),
          templateNo: `WVT-${Date.now()}-${id.slice(0, 6)}`,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          warehouseId: input.warehouseId,
          workloadFactors: json(input.workloadFactors),
        },
      });
      await this.emit(
        tx,
        id,
        'WaveTemplate',
        row.version,
        'outbound.wave-template-created.v1',
        context,
        metadata,
        { templateId: id },
      );
      return { templateId: id, version: row.version };
    });
  }

  async simulateWave(id: string, context: TenantContext) {
    this.uuid(id, 'templateId');
    const template = await this.prisma.waveTemplate.findFirst({
      where: { id, status: 'ACTIVE', tenantId: context.tenantId },
    });
    if (!template)
      throw new AppError(
        'WAVE_TEMPLATE_NOT_FOUND',
        'Wave template was not found',
        404,
      );
    const orders = await this.prisma.outboundOrder.findMany({
      orderBy: [{ cutoffAt: 'asc' }, { id: 'asc' }],
      where: {
        status: 'RELEASED',
        tenantId: context.tenantId,
        warehouseId: template.warehouseId,
      },
    });
    const lines = await this.prisma.outboundLine.findMany({
      where: {
        outboundOrderId: { in: orders.map(({ id }) => id) },
        tenantId: context.tenantId,
      },
    });
    const criteria = record(template.criteria);
    const productIds = Array.isArray(criteria.productIds)
      ? new Set(
          criteria.productIds.filter(
            (item): item is string => typeof item === 'string',
          ),
        )
      : null;
    const candidates = orders.filter((order) => {
      const orderLines = lines.filter(
        ({ outboundOrderId }) => outboundOrderId === order.id,
      );
      return (
        (!text(criteria.customerId) ||
          order.customerId === criteria.customerId) &&
        (!text(criteria.carrierMode) ||
          order.carrierMode === criteria.carrierMode) &&
        (!text(criteria.routeCode) || order.routeCode === criteria.routeCode) &&
        (!text(criteria.temperatureZone) ||
          order.temperatureZone === criteria.temperatureZone) &&
        (!text(criteria.orderType) || order.type === criteria.orderType) &&
        (!productIds ||
          orderLines.some(({ productId }) => productIds.has(productId)))
      );
    });
    const selectedLines = lines.filter(({ outboundOrderId }) =>
      candidates.some(({ id }) => id === outboundOrderId),
    );
    const factors = record(template.workloadFactors);
    const quantityBase = selectedLines.reduce(
      (sum, line) => sum.add(line.quantityBase),
      new Prisma.Decimal(0),
    );
    const workload = decimal(factors.perOrder, '1')
      .mul(candidates.length)
      .add(decimal(factors.perLine, '1').mul(selectedLines.length))
      .add(decimal(factors.perBase).mul(quantityBase));
    return {
      candidateIds: candidates.map(({ id }) => id),
      lineCount: selectedLines.length,
      orderCount: candidates.length,
      quantityBase: quantityBase.toString(),
      simulatedAt: new Date(),
      workload: workload.toString(),
    };
  }

  async createWave(
    input: {
      cutoffAt: string;
      orderIds?: readonly string[];
      templateId: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.templateId, 'templateId');
    for (const orderId of input.orderIds ?? [])
      this.uuid(orderId, 'outboundId');
    const cutoffAt = new Date(input.cutoffAt);
    if (Number.isNaN(cutoffAt.getTime()))
      throw new AppError('WAVE_CUTOFF_INVALID', 'Wave cutoff is invalid', 400);
    const template = await this.prisma.waveTemplate.findFirst({
      where: {
        id: input.templateId,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    if (!template)
      throw new AppError(
        'WAVE_TEMPLATE_NOT_FOUND',
        'Wave template was not found',
        404,
      );
    const simulation = await this.simulateWave(input.templateId, context);
    const orderIds = [
      ...(input.orderIds?.length ? input.orderIds : simulation.candidateIds),
    ];
    if (!orderIds.length)
      throw new AppError(
        'WAVE_SCOPE_EMPTY',
        'Wave contains no outbound orders',
        409,
      );
    const orders = await this.prisma.outboundOrder.findMany({
      where: {
        id: { in: orderIds },
        status: 'RELEASED',
        tenantId: context.tenantId,
        warehouseId: template.warehouseId,
      },
    });
    if (orders.length !== new Set(orderIds).size)
      throw this.conflict('WAVE_ORDER_STATE_CONFLICT');
    const lines = await this.prisma.outboundLine.findMany({
      where: { outboundOrderId: { in: orderIds }, tenantId: context.tenantId },
    });
    const capacity = record(template.capacitySnapshot);
    const totalBase = lines.reduce(
      (sum, line) => sum.add(line.quantityBase),
      new Prisma.Decimal(0),
    );
    if (
      (capacity.maxOrders && orders.length > Number(capacity.maxOrders)) ||
      (capacity.maxLines && lines.length > Number(capacity.maxLines)) ||
      (capacity.maxQuantityBase &&
        totalBase.greaterThan(String(capacity.maxQuantityBase)))
    )
      throw new AppError(
        'WAVE_CAPACITY_EXCEEDED',
        'Wave workload exceeds template capacity',
        409,
      );
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const wave = await tx.wavePlan.create({
        data: {
          capacitySnapshot: json(template.capacitySnapshot),
          createdBy: context.accountId,
          cutoffAt,
          id,
          simulationSnapshot: json({ ...simulation, candidateIds: orderIds }),
          templateId: template.id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          warehouseId: template.warehouseId,
          waveNo: `WAV-${Date.now()}-${id.slice(0, 6)}`,
          workloadSnapshot: json({
            lineCount: lines.length,
            orderCount: orders.length,
            quantityBase: totalBase.toString(),
            workload: simulation.workload,
          }),
        },
      });
      for (const order of orders)
        await tx.waveOrder.create({
          data: {
            createdBy: context.accountId,
            outboundOrderId: order.id,
            selectionSnapshot: json({
              cutoffAt: order.cutoffAt,
              sourceRef: order.sourceRef,
              templateVersion: template.version,
            }),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            waveId: id,
          },
        });
      await this.emit(
        tx,
        id,
        'WavePlan',
        wave.version,
        'outbound.wave-created.v1',
        context,
        metadata,
        { orderIds, waveId: id },
      );
      return { status: wave.status, version: wave.version, waveId: id };
    });
  }

  async transitionWave(
    id: string,
    input: {
      expectedVersion: number;
      targetStatus: 'PLANNED' | 'RELEASED' | 'COMPLETED';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'waveId');
    return this.prisma.$transaction(async (tx) => {
      const wave = await tx.wavePlan.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!wave || wave.version !== input.expectedVersion)
        throw this.conflict('WAVE_PLAN_CONFLICT');
      const allowed =
        (wave.status === 'DRAFT' && input.targetStatus === 'PLANNED') ||
        (wave.status === 'PLANNED' && input.targetStatus === 'RELEASED') ||
        (wave.status === 'RELEASED' && input.targetStatus === 'COMPLETED');
      if (!allowed)
        throw new AppError(
          'WAVE_TRANSITION_INVALID',
          `Wave transition ${wave.status} -> ${input.targetStatus} is not allowed`,
          409,
        );
      const memberships = await tx.waveOrder.findMany({
        where: { waveId: id, tenantId: context.tenantId },
      });
      if (input.targetStatus === 'PLANNED') {
        for (const member of memberships) {
          const claimed = await tx.outboundOrder.updateMany({
            data: {
              status: 'WAVED',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: {
              id: member.outboundOrderId,
              status: 'RELEASED',
              tenantId: context.tenantId,
            },
          });
          if (claimed.count !== 1)
            throw this.conflict('WAVE_ORDER_STATE_CONFLICT');
        }
      }
      if (input.targetStatus === 'RELEASED')
        await this.allocateWave(tx, wave, memberships, context, metadata);
      if (
        input.targetStatus === 'COMPLETED' &&
        (await tx.outboundShortageCase.count({
          where: { status: 'OPEN', tenantId: context.tenantId, waveId: id },
        }))
      )
        throw new AppError(
          'WAVE_SHORTAGE_OPEN',
          'Every shortage must be resolved before wave completion',
          409,
        );
      const changed = await tx.wavePlan.update({
        data: {
          completedAt:
            input.targetStatus === 'COMPLETED' ? new Date() : wave.completedAt,
          plannedAt:
            input.targetStatus === 'PLANNED' ? new Date() : wave.plannedAt,
          releasedAt:
            input.targetStatus === 'RELEASED' ? new Date() : wave.releasedAt,
          status: input.targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        id,
        'WavePlan',
        changed.version,
        `outbound.wave-${input.targetStatus.toLowerCase()}.v1`,
        context,
        metadata,
        { from: wave.status, to: changed.status, waveId: id },
      );
      return { status: changed.status, version: changed.version };
    });
  }

  async resolveShortage(
    id: string,
    input: {
      expectedVersion: number;
      resolutionSnapshot: Readonly<Record<string, unknown>>;
      type: ShortageResolutionType;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'shortageCaseId');
    if (!Object.keys(input.resolutionSnapshot ?? {}).length)
      throw new AppError(
        'SHORTAGE_RESOLUTION_REQUIRED',
        'Resolution detail is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const shortage = await tx.outboundShortageCase.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !shortage ||
        shortage.status !== 'OPEN' ||
        shortage.version !== input.expectedVersion
      )
        throw this.conflict('OUTBOUND_SHORTAGE_CONFLICT');
      const eventRef = randomUUID();
      const changed = await tx.outboundShortageCase.update({
        data: {
          resolutionSnapshot: json(input.resolutionSnapshot),
          resolutionType: input.type,
          resolvedAt: new Date(),
          status: 'RESOLVED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await tx.outboundReallocation.create({
        data: {
          createdBy: context.accountId,
          omsEventRef: eventRef,
          resolutionSnapshot: json(input.resolutionSnapshot),
          shortageCaseId: id,
          tenantId: context.tenantId,
          type: input.type,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        id,
        'OutboundShortageCase',
        changed.version,
        'outbound.shortage-resolved.v1',
        context,
        metadata,
        {
          omsEventRef: eventRef,
          outboundId: shortage.outboundOrderId,
          shortageCaseId: id,
          type: input.type,
        },
      );
      return { status: changed.status, version: changed.version };
    });
  }

  async workbench(context: TenantContext) {
    const [orders, templates, waves, allocations, shortages] =
      await Promise.all([
        this.prisma.outboundOrder.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.waveTemplate.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.wavePlan.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.outboundAllocation.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 200,
          where: { tenantId: context.tenantId },
        }),
        this.prisma.outboundShortageCase.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 100,
          where: { tenantId: context.tenantId },
        }),
      ]);
    return {
      allocations,
      orders,
      shortages,
      snapshotAt: new Date(),
      templates,
      waves,
    };
  }

  private async allocateWave(
    tx: Prisma.TransactionClient,
    wave: { id: string; templateId: string; warehouseId: string },
    memberships: readonly { outboundOrderId: string }[],
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const template = await tx.waveTemplate.findFirstOrThrow({
      where: { id: wave.templateId, tenantId: context.tenantId },
    });
    const strategy = record(template.strategy);
    for (const member of memberships) {
      const order = await tx.outboundOrder.findFirstOrThrow({
        where: { id: member.outboundOrderId, tenantId: context.tenantId },
      });
      const lines = await tx.outboundLine.findMany({
        orderBy: { lineNo: 'asc' },
        where: { outboundOrderId: order.id, tenantId: context.tenantId },
      });
      let orderShort = false;
      for (const line of lines) {
        let remaining = line.quantityBase;
        const balances = await tx.inventoryBalance.findMany({
          where: {
            availableBase: { gt: 0 },
            ownerId: order.ownerId,
            productId: line.productId,
            status: 'AVAILABLE',
            tenantId: context.tenantId,
            warehouseId: order.warehouseId,
          },
        });
        const frozen = new Set(
          (
            await tx.inventoryCountFreeze.findMany({
              select: { balanceId: true },
              where: {
                balanceId: { in: balances.map(({ id }) => id) },
                status: 'ACTIVE',
                tenantId: context.tenantId,
              },
            })
          ).map(({ balanceId }) => balanceId),
        );
        const constraints = record(line.allocationConstraints);
        const filtered = balances.filter(
          (balance) =>
            !frozen.has(balance.id) &&
            (!text(constraints.inventoryLotId) ||
              balance.inventoryLotId === constraints.inventoryLotId),
        );
        const lots = await tx.inventoryLot.findMany({
          where: {
            id: {
              in: filtered.flatMap(({ inventoryLotId }) =>
                inventoryLotId ? [inventoryLotId] : [],
              ),
            },
            tenantId: context.tenantId,
          },
        });
        const lotById = new Map(lots.map((lot) => [lot.id, lot]));
        filtered.sort((left, right) => {
          if (
            strategy.wholeHandlingUnitFirst !== false &&
            Boolean(left.handlingUnitId) !== Boolean(right.handlingUnitId)
          )
            return left.handlingUnitId ? -1 : 1;
          if (strategy.issueMethod === 'FEFO') {
            const le = left.inventoryLotId
              ? lotById.get(left.inventoryLotId)?.expiryDate?.getTime()
              : undefined;
            const re = right.inventoryLotId
              ? lotById.get(right.inventoryLotId)?.expiryDate?.getTime()
              : undefined;
            if (le !== re)
              return (
                (le ?? Number.MAX_SAFE_INTEGER) -
                (re ?? Number.MAX_SAFE_INTEGER)
              );
          }
          if (
            strategy.minimumSplits !== false &&
            !left.availableBase.equals(right.availableBase)
          )
            return right.availableBase.comparedTo(left.availableBase);
          return (
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.id.localeCompare(right.id)
          );
        });
        const rankedIds = filtered.map(({ id }) => id);
        let allocated = new Prisma.Decimal(0);
        for (const candidate of filtered) {
          if (!remaining.greaterThan(0)) break;
          const current = await tx.inventoryBalance.findUniqueOrThrow({
            where: { id: candidate.id },
          });
          const quantityBase = Prisma.Decimal.min(
            remaining,
            current.availableBase,
          );
          if (!quantityBase.greaterThan(0)) continue;
          const quantityOriginal = quantityBase
            .mul(current.onHandOriginal)
            .div(current.onHandBase);
          try {
            const reservation = await this.inventory.reserveForOutbound(
              tx,
              current.id,
              {
                businessSnapshot: {
                  outboundId: order.id,
                  outboundLineId: line.id,
                  strategy,
                },
                expectedVersion: current.version,
                quantityBase: quantityBase.toString(),
                quantityOriginal: quantityOriginal.toString(),
                sourceRef: wave.id,
              },
              context,
              metadata,
            );
            await tx.outboundAllocation.create({
              data: {
                balanceId: current.id,
                createdBy: context.accountId,
                outboundLineId: line.id,
                outboundOrderId: order.id,
                quantityBase,
                quantityOriginal,
                reservationId: reservation.reservationId,
                strategyTrace: json({
                  chosenBalanceId: current.id,
                  excludedFrozenBalanceIds: [...frozen],
                  rankedCandidateIds: rankedIds,
                  strategy,
                  templateId: template.id,
                  templateVersion: template.version,
                }),
                tenantId: context.tenantId,
                updatedBy: context.accountId,
                waveId: wave.id,
              },
            });
            allocated = allocated.add(quantityBase);
            remaining = remaining.sub(quantityBase);
          } catch (error) {
            if (
              !(error instanceof AppError) ||
              error.code !== 'INVENTORY_RESERVATION_CONFLICT'
            )
              throw error;
          }
        }
        const ratio = line.quantityOriginal.div(line.quantityBase);
        await tx.outboundLine.update({
          data: {
            allocatedBase: allocated,
            allocatedOriginal: allocated.mul(ratio),
            shortageBase: remaining,
            shortageOriginal: remaining.mul(ratio),
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: line.id },
        });
        if (remaining.greaterThan(0)) {
          orderShort = true;
          const caseId = randomUUID();
          await tx.outboundShortageCase.create({
            data: {
              allocatedBase: allocated,
              caseNo: `SHT-${Date.now()}-${caseId.slice(0, 6)}`,
              createdBy: context.accountId,
              id: caseId,
              optionsSnapshot: json({
                allowed: [
                  'WAIT_INBOUND',
                  'TRIGGER_REPLENISHMENT',
                  'SUBSTITUTE_LOT',
                  'CHANGE_WAREHOUSE',
                  'SPLIT_ORDER',
                  'SHORT_SHIP',
                ],
                excludedFrozenBalanceIds: [...frozen],
              }),
              outboundLineId: line.id,
              outboundOrderId: order.id,
              requestedBase: line.quantityBase,
              shortageBase: remaining,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
              waveId: wave.id,
            },
          });
        }
      }
      await tx.outboundOrder.update({
        data: {
          status: orderShort ? 'WAVED' : 'ALLOCATED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: order.id },
      });
    }
    await this.generatePickTasks(tx, wave, strategy, context);
  }

  private async generatePickTasks(
    tx: Prisma.TransactionClient,
    wave: { id: string; warehouseId: string },
    strategy: Record<string, unknown>,
    context: TenantContext,
  ) {
    const requestedMode = text(strategy.pickMode)?.toUpperCase() ?? 'ORDER';
    if (!Object.values(PickMode).includes(requestedMode as PickMode))
      throw new AppError(
        'PICK_MODE_INVALID',
        `Unsupported pick mode ${requestedMode}`,
        400,
      );
    const mode = requestedMode as PickMode;
    const allocations = await tx.outboundAllocation.findMany({
      where: { tenantId: context.tenantId, waveId: wave.id },
    });
    if (!allocations.length) return;
    const [balances, orders, lines, locations] = await Promise.all([
      tx.inventoryBalance.findMany({
        where: {
          id: { in: allocations.map(({ balanceId }) => balanceId) },
          tenantId: context.tenantId,
        },
      }),
      tx.outboundOrder.findMany({
        where: {
          id: { in: allocations.map(({ outboundOrderId }) => outboundOrderId) },
          tenantId: context.tenantId,
        },
      }),
      tx.outboundLine.findMany({
        where: {
          id: { in: allocations.map(({ outboundLineId }) => outboundLineId) },
          tenantId: context.tenantId,
        },
      }),
      this.mdm.listWarehouseLocations(wave.warehouseId, context),
    ]);
    const balanceById = new Map(balances.map((row) => [row.id, row]));
    const orderById = new Map(orders.map((row) => [row.id, row]));
    const lineById = new Map(lines.map((row) => [row.id, row]));
    const locationById = new Map(locations.map((row) => [row.id, row]));
    const groups = new Map<string, typeof allocations>();
    for (const allocation of allocations) {
      const order = orderById.get(allocation.outboundOrderId)!;
      const balance = balanceById.get(allocation.balanceId)!;
      const temperature = order.temperatureZone ?? 'UNSPECIFIED';
      const grouping =
        mode === 'ORDER' || mode === 'EACH'
          ? order.id
          : mode === 'ZONE'
            ? balance.locationId
            : mode === 'FULL_CASE'
              ? (balance.handlingUnitId ?? allocation.id)
              : 'combined';
      const key = `${temperature}:${grouping}`;
      groups.set(key, [...(groups.get(key) ?? []), allocation]);
    }
    let sequence = 0;
    for (const grouped of groups.values()) {
      sequence += 1;
      const firstOrder = orderById.get(grouped[0]!.outboundOrderId)!;
      const taskId = randomUUID();
      const ordered = [...grouped].sort((left, right) => {
        const leftLocation = locationById.get(
          balanceById.get(left.balanceId)!.locationId,
        );
        const rightLocation = locationById.get(
          balanceById.get(right.balanceId)!.locationId,
        );
        return (
          (leftLocation?.sequence ?? Number.MAX_SAFE_INTEGER) -
            (rightLocation?.sequence ?? Number.MAX_SAFE_INTEGER) ||
          (leftLocation?.code ?? '').localeCompare(rightLocation?.code ?? '') ||
          left.id.localeCompare(right.id)
        );
      });
      await tx.pickTask.create({
        data: {
          createdBy: context.accountId,
          id: taskId,
          mode,
          outboundOrderId:
            new Set(grouped.map(({ outboundOrderId }) => outboundOrderId))
              .size === 1
              ? firstOrder.id
              : null,
          taskNo: `PCK-${Date.now()}-${sequence}-${taskId.slice(0, 6)}`,
          temperatureZone: firstOrder.temperatureZone,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          waveId: wave.id,
          workload: grouped.reduce(
            (sum, row) => sum.add(row.quantityBase),
            new Prisma.Decimal(0),
          ),
        },
      });
      for (const allocation of ordered) {
        const balance = balanceById.get(allocation.balanceId)!;
        const line = lineById.get(allocation.outboundLineId)!;
        await tx.pickTaskLine.create({
          data: {
            allocationId: allocation.id,
            balanceId: balance.id,
            createdBy: context.accountId,
            handlingUnitId: balance.handlingUnitId,
            inventoryLotId: balance.inventoryLotId,
            outboundLineId: line.id,
            outboundOrderId: allocation.outboundOrderId,
            productId: line.productId,
            requiredBase: allocation.quantityBase,
            serialNumberId: balance.serialNumberId,
            sourceLocationId: balance.locationId,
            taskId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      await tx.pickRouteVersion.create({
        data: {
          createdBy: context.accountId,
          inputSnapshot: json({
            aisleDirection: 'FORWARD',
            congestion: {},
            mode,
            source: 'WAVE_RELEASE',
          }),
          routeSnapshot: json({
            stops: ordered.map((allocation, index) => {
              const balance = balanceById.get(allocation.balanceId)!;
              const location = locationById.get(balance.locationId);
              return {
                allocationId: allocation.id,
                locationCode: location?.code,
                locationId: balance.locationId,
                sequence: index + 1,
              };
            }),
          }),
          routeVersion: 1,
          taskId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
    }
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
        'WMS_QUANTITY_INVALID',
        'Quantities must be positive decimals',
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

  private async emit(
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
