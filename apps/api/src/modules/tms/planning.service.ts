import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type TransportMode } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { businessNumber } from '../platform/public/numbering.facade';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const record = (value: unknown): Readonly<Record<string, unknown>> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};

export interface BuildPlanInput {
  readonly expectedBatchVersion: number;
  readonly policySnapshot: Readonly<Record<string, unknown>>;
  readonly shipments: readonly {
    readonly deliveryWindowTo: string;
    readonly destinationSnapshot: Readonly<Record<string, unknown>>;
    readonly items: readonly {
      readonly allocationRatio: string;
      readonly itemSnapshot: Readonly<Record<string, unknown>>;
      readonly quantity: string;
      readonly quantityBase: string;
      readonly quantityBaseUom: string;
      readonly quantityUom: string;
      readonly sourceLineRef: string;
      readonly transportOrderId: string;
      readonly volumeBase: string;
      readonly weightBase: string;
    }[];
    readonly legs: readonly {
      readonly carrierRef?: string;
      readonly carrierSnapshot?: Readonly<Record<string, unknown>>;
      readonly destinationSnapshot: Readonly<Record<string, unknown>>;
      readonly equipment: {
        readonly capacityPallets: string;
        readonly capacityVolumeBase: string;
        readonly capacityWeightBase: string;
        readonly equipmentSnapshot: Readonly<Record<string, unknown>>;
        readonly equipmentType: string;
      };
      readonly mode: TransportMode;
      readonly originNodeSnapshot: Readonly<Record<string, unknown>>;
      readonly plannedEndAt: string;
      readonly plannedStartAt: string;
      readonly sequence: number;
      readonly slaSnapshot: Readonly<Record<string, unknown>>;
    }[];
    readonly mode: TransportMode;
    readonly modeDecision: {
      readonly candidates: readonly Readonly<Record<string, unknown>>[];
      readonly explanation: Readonly<Record<string, unknown>>;
      readonly ruleVersion: string;
    };
    readonly originSnapshot: Readonly<Record<string, unknown>>;
    readonly pickupWindowFrom: string;
    readonly requirementSnapshot: Readonly<Record<string, unknown>>;
    readonly temperatureMax?: string;
    readonly temperatureMin?: string;
    readonly totalPallets: string;
    readonly totalVolumeBase: string;
    readonly totalWeightBase: string;
  }[];
}

@Injectable()
export class PlanningService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async workbench(context: TenantContext) {
    const [batches, plans, shipments, legs, locks, orders] = await Promise.all([
      this.prisma.planningBatch.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.consolidationPlan.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.shipment.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.transportLeg.findMany({
        orderBy: [{ shipmentId: 'asc' }, { sequence: 'asc' }],
        take: 300,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.planningLock.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.transportOrder.findMany({
        orderBy: [
          { priority: 'asc' },
          { pickupWindowFrom: 'asc' },
          { id: 'asc' },
        ],
        take: 300,
        where: { status: 'PLANNED', tenantId: context.tenantId },
      }),
    ]);
    const activeByOrder = new Map(
      locks
        .filter(({ status }) => status === 'ACTIVE')
        .map((lock) => [lock.transportOrderId, lock]),
    );
    return toHttpJson({
      batches,
      legs,
      locks,
      orders: orders.map((order) => ({
        ...order,
        poolStatus: activeByOrder.has(order.id) ? 'LOCKED' : 'UNPLANNED',
        planningLock: activeByOrder.get(order.id) ?? null,
      })),
      plans,
      shipments,
      snapshotAt: new Date(),
    });
  }

  createBatch(
    input: {
      criteria?: Readonly<Record<string, unknown>>;
      customerRef?: string;
      mode?: TransportMode;
      planningDate: string;
      priorityFrom?: number;
      priorityTo?: number;
      regionCode: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const planningDate = new Date(`${input.planningDate}T00:00:00.000Z`);
    const priorityFrom = input.priorityFrom ?? 1;
    const priorityTo = input.priorityTo ?? 999;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.planningDate) ||
      Number.isNaN(planningDate.getTime()) ||
      !input.regionCode?.trim() ||
      !Number.isInteger(priorityFrom) ||
      !Number.isInteger(priorityTo) ||
      priorityFrom < 1 ||
      priorityTo < priorityFrom
    )
      this.invalid('Planning date, region and priority interval are invalid');
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.planningBatch.create({
        data: {
          batchNo: await businessNumber(
            this.prisma,
            'TMS_PLANNING_BATCH',
            context,
            metadata,
            'planning-batch',
          ),
          createdBy: context.accountId,
          criteria: json(input.criteria),
          customerRef: input.customerRef?.trim() || null,
          id,
          mode: input.mode ?? null,
          planningDate,
          priorityFrom,
          priorityTo,
          regionCode: input.regionCode.trim().toUpperCase(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        id,
        batch.version,
        'tms.planning-batch-created.v1',
        context,
        metadata,
        {
          batchNo: batch.batchNo,
          planningBatchId: id,
        },
      );
      return {
        planningBatchId: id,
        status: batch.status,
        version: batch.version,
      };
    });
  }

  async claimOrder(
    batchId: string,
    orderId: string,
    input: { expectedBatchVersion: number; expiresAt: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(batchId, 'planningBatchId');
    this.uuid(orderId, 'transportOrderId');
    const expiresAt = this.date(input.expiresAt, 'expiresAt');
    if (expiresAt <= new Date())
      this.invalid('Planning lock must expire in the future');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.planningLock.updateMany({
          data: {
            releasedAt: new Date(),
            releaseReason: 'EXPIRED',
            status: 'EXPIRED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            expiresAt: { lte: new Date() },
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        const batch = await tx.planningBatch.findFirst({
          where: { id: batchId, tenantId: context.tenantId },
        });
        if (
          !batch ||
          batch.version !== input.expectedBatchVersion ||
          !['DRAFT', 'PLANNING'].includes(batch.status)
        )
          throw this.conflict('TMS_PLANNING_BATCH_CONFLICT');
        const order = await tx.transportOrder.findFirst({
          where: { id: orderId, status: 'PLANNED', tenantId: context.tenantId },
        });
        if (!order)
          throw new AppError(
            'TMS_PLANNING_ORDER_INELIGIBLE',
            'Order is not eligible for planning',
            409,
          );
        if (
          order.priority < batch.priorityFrom ||
          order.priority > batch.priorityTo
        )
          throw new AppError(
            'TMS_PLANNING_ORDER_FILTER_MISMATCH',
            'Order priority is outside batch criteria',
            409,
          );
        const lock = await tx.planningLock.create({
          data: {
            createdBy: context.accountId,
            expiresAt,
            plannerId: context.accountId,
            planningBatchId: batch.id,
            tenantId: context.tenantId,
            transportOrderId: order.id,
            updatedBy: context.accountId,
          },
        });
        const changed =
          batch.status === 'DRAFT'
            ? await tx.planningBatch.update({
                data: {
                  status: 'PLANNING',
                  updatedBy: context.accountId,
                  version: { increment: 1 },
                },
                where: { id: batch.id },
              })
            : batch;
        await this.emit(
          tx,
          batch.id,
          changed.version,
          'tms.planning-order-claimed.v1',
          context,
          metadata,
          {
            planningBatchId: batch.id,
            planningLockId: lock.id,
            transportOrderId: order.id,
          },
        );
        return {
          batchStatus: changed.status,
          batchVersion: changed.version,
          planningLockId: lock.id,
          status: lock.status,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new AppError(
          'TMS_PLANNING_ORDER_ALREADY_LOCKED',
          'Order is already locked by another planner',
          409,
          {
            retryable: true,
          },
        );
      throw error;
    }
  }

  releaseLock(
    lockId: string,
    input: { expectedVersion: number; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(lockId, 'planningLockId');
    if (!input.reason?.trim()) this.invalid('Release reason is required');
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.planningLock.findFirst({
        where: { id: lockId, tenantId: context.tenantId },
      });
      if (
        !lock ||
        lock.status !== 'ACTIVE' ||
        lock.version !== input.expectedVersion
      )
        throw this.conflict('TMS_PLANNING_LOCK_CONFLICT');
      const changed = await tx.planningLock.update({
        data: {
          releasedAt: new Date(),
          releaseReason: input.reason.trim(),
          status: 'RELEASED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: lock.id },
      });
      await this.emit(
        tx,
        lock.planningBatchId,
        changed.version,
        'tms.planning-order-released.v1',
        context,
        metadata,
        {
          planningBatchId: lock.planningBatchId,
          planningLockId: lock.id,
          transportOrderId: lock.transportOrderId,
        },
      );
      return {
        planningLockId: lock.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  buildPlan(
    batchId: string,
    input: BuildPlanInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(batchId, 'planningBatchId');
    if (
      !input.shipments.length ||
      !Object.keys(input.policySnapshot ?? {}).length
    )
      this.invalid('Planning policy and at least one shipment are required');
    const parsed = input.shipments.map((shipment, index) =>
      this.parseShipment(shipment, index),
    );
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.planningBatch.findFirst({
        where: { id: batchId, tenantId: context.tenantId },
      });
      if (
        !batch ||
        batch.status !== 'PLANNING' ||
        batch.version !== input.expectedBatchVersion
      )
        throw this.conflict('TMS_PLANNING_BATCH_CONFLICT');
      const orderIds = [
        ...new Set(
          parsed.flatMap(({ items }) =>
            items.map(({ transportOrderId }) => transportOrderId),
          ),
        ),
      ];
      const [orders, locks] = await Promise.all([
        tx.transportOrder.findMany({
          where: {
            id: { in: orderIds },
            status: 'PLANNED',
            tenantId: context.tenantId,
          },
        }),
        tx.planningLock.findMany({
          where: {
            planningBatchId: batch.id,
            status: 'ACTIVE',
            tenantId: context.tenantId,
            transportOrderId: { in: orderIds },
          },
        }),
      ]);
      if (orders.length !== orderIds.length || locks.length !== orderIds.length)
        throw new AppError(
          'TMS_PLANNING_LOCK_REQUIRED',
          'Every planned order requires an active batch lock',
          409,
        );
      const planId = randomUUID();
      const plan = await tx.consolidationPlan.create({
        data: {
          createdBy: context.accountId,
          id: planId,
          planningBatchId: batch.id,
          planNo: await businessNumber(
            this.prisma,
            'TMS_CONSOLIDATION_PLAN',
            context,
            metadata,
            'consolidation-plan',
          ),
          policySnapshot: json(input.policySnapshot),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const shipmentIds: string[] = [];
      for (const shipmentInput of parsed) {
        const shipmentId = randomUUID();
        shipmentIds.push(shipmentId);
        const shipment = await tx.shipment.create({
          data: {
            consolidationPlanId: plan.id,
            createdBy: context.accountId,
            deliveryWindowTo: shipmentInput.deliveryWindowTo,
            destinationSnapshot: json(shipmentInput.destinationSnapshot),
            id: shipmentId,
            mode: shipmentInput.mode,
            originSnapshot: json(shipmentInput.originSnapshot),
            pickupWindowFrom: shipmentInput.pickupWindowFrom,
            requirementSnapshot: json(shipmentInput.requirementSnapshot),
            shipmentNo: await businessNumber(
              this.prisma,
              'TMS_SHIPMENT',
              context,
              metadata,
              `shipment:${shipmentIds.length}`,
            ),
            temperatureMax: shipmentInput.temperatureMax,
            temperatureMin: shipmentInput.temperatureMin,
            tenantId: context.tenantId,
            totalPallets: shipmentInput.totalPallets,
            totalVolumeBase: shipmentInput.totalVolumeBase,
            totalWeightBase: shipmentInput.totalWeightBase,
            updatedBy: context.accountId,
          },
        });
        await tx.modeDecision.create({
          data: {
            candidates: json(shipmentInput.modeDecision.candidates),
            createdBy: context.accountId,
            explanation: json(shipmentInput.modeDecision.explanation),
            ruleVersion: shipmentInput.modeDecision.ruleVersion.trim(),
            selectedMode: shipment.mode,
            shipmentId: shipment.id,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await tx.shipmentItem.createMany({
          data: shipmentInput.items.map((item) => ({
            allocationRatio: item.allocationRatio,
            createdBy: context.accountId,
            itemSnapshot: json(item.itemSnapshot),
            quantity: item.quantity,
            quantityBase: item.quantityBase,
            quantityBaseUom: item.quantityBaseUom.trim().toUpperCase(),
            quantityUom: item.quantityUom.trim().toUpperCase(),
            shipmentId: shipment.id,
            sourceLineRef: item.sourceLineRef.trim(),
            tenantId: context.tenantId,
            transportOrderId: item.transportOrderId,
            updatedBy: context.accountId,
            volumeBase: item.volumeBase,
            weightBase: item.weightBase,
          })),
        });
        for (const legInput of shipmentInput.legs) {
          const leg = await tx.transportLeg.create({
            data: {
              carrierRef: legInput.carrierRef?.trim() || null,
              carrierSnapshot: json(legInput.carrierSnapshot),
              createdBy: context.accountId,
              destinationSnapshot: json(legInput.destinationSnapshot),
              mode: legInput.mode,
              originNodeSnapshot: json(legInput.originNodeSnapshot),
              plannedEndAt: legInput.plannedEndAt,
              plannedStartAt: legInput.plannedStartAt,
              sequence: legInput.sequence,
              shipmentId: shipment.id,
              slaSnapshot: json(legInput.slaSnapshot),
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          const exclusions = this.equipmentExclusions(
            shipmentInput,
            legInput.equipment,
          );
          await tx.equipmentSelection.create({
            data: {
              capacityPallets: legInput.equipment.capacityPallets,
              capacityVolumeBase: legInput.equipment.capacityVolumeBase,
              capacityWeightBase: legInput.equipment.capacityWeightBase,
              compatible: exclusions.length === 0,
              createdBy: context.accountId,
              equipmentSnapshot: json(legInput.equipment.equipmentSnapshot),
              equipmentType: legInput.equipment.equipmentType
                .trim()
                .toUpperCase(),
              exclusionReasons: json(exclusions),
              requiredPallets: shipmentInput.totalPallets,
              requiredVolumeBase: shipmentInput.totalVolumeBase,
              requiredWeightBase: shipmentInput.totalWeightBase,
              requirementSnapshot: json(shipmentInput.requirementSnapshot),
              tenantId: context.tenantId,
              transportLegId: leg.id,
              updatedBy: context.accountId,
            },
          });
        }
      }
      await this.emit(
        tx,
        plan.id,
        plan.version,
        'tms.consolidation-plan-built.v1',
        context,
        metadata,
        {
          consolidationPlanId: plan.id,
          planningBatchId: batch.id,
          shipmentIds,
        },
      );
      return {
        consolidationPlanId: plan.id,
        shipmentIds,
        status: plan.status,
        version: plan.version,
      };
    });
  }

  validatePlan(
    planId: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(planId, 'consolidationPlanId');
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.consolidationPlan.findFirst({
        where: { id: planId, tenantId: context.tenantId },
      });
      if (
        !plan ||
        plan.status !== 'DRAFT' ||
        plan.version !== input.expectedVersion
      )
        throw this.conflict('TMS_CONSOLIDATION_PLAN_CONFLICT');
      await this.assertPlanValid(tx, plan.id, context.tenantId);
      const changed = await tx.consolidationPlan.update({
        data: {
          status: 'VALIDATED',
          updatedBy: context.accountId,
          validatedAt: new Date(),
          version: { increment: 1 },
        },
        where: { id: plan.id },
      });
      await this.emit(
        tx,
        plan.id,
        changed.version,
        'tms.consolidation-plan-validated.v1',
        context,
        metadata,
        {
          consolidationPlanId: plan.id,
          planningBatchId: plan.planningBatchId,
        },
      );
      return {
        consolidationPlanId: plan.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  publishPlan(
    planId: string,
    input: { expectedBatchVersion: number; expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(planId, 'consolidationPlanId');
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.consolidationPlan.findFirst({
        where: { id: planId, tenantId: context.tenantId },
      });
      if (
        !plan ||
        plan.status !== 'VALIDATED' ||
        plan.version !== input.expectedVersion
      )
        throw this.conflict('TMS_CONSOLIDATION_PLAN_CONFLICT');
      const batch = await tx.planningBatch.findFirst({
        where: { id: plan.planningBatchId, tenantId: context.tenantId },
      });
      if (
        !batch ||
        batch.status !== 'PLANNING' ||
        batch.version !== input.expectedBatchVersion
      )
        throw this.conflict('TMS_PLANNING_BATCH_CONFLICT');
      await this.assertPlanValid(tx, plan.id, context.tenantId);
      const publishedAt = new Date();
      const [changed, changedBatch] = await Promise.all([
        tx.consolidationPlan.update({
          data: {
            publishedAt,
            status: 'PUBLISHED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: plan.id },
        }),
        tx.planningBatch.update({
          data: {
            plannedAt: publishedAt,
            status: 'PLANNED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: batch.id },
        }),
        tx.planningLock.updateMany({
          data: {
            releasedAt: publishedAt,
            releaseReason: 'PLAN_PUBLISHED',
            status: 'RELEASED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            planningBatchId: batch.id,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        }),
      ]);
      await this.emit(
        tx,
        plan.id,
        changed.version,
        'tms.consolidation-plan-published.v1',
        context,
        metadata,
        {
          consolidationPlanId: plan.id,
          planningBatchId: batch.id,
        },
      );
      return {
        batchStatus: changedBatch.status,
        batchVersion: changedBatch.version,
        consolidationPlanId: plan.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  private parseShipment(
    input: BuildPlanInput['shipments'][number],
    index: number,
  ) {
    if (
      !input.items.length ||
      !input.legs.length ||
      !Object.keys(input.originSnapshot ?? {}).length ||
      !Object.keys(input.destinationSnapshot ?? {}).length
    )
      this.invalid(`Shipment ${index + 1} requires items, legs and endpoints`);
    if (
      !input.modeDecision.ruleVersion?.trim() ||
      !input.modeDecision.candidates.length
    )
      this.invalid(`Shipment ${index + 1} requires an explained mode decision`);
    const pickupWindowFrom = this.date(
      input.pickupWindowFrom,
      'pickupWindowFrom',
    );
    const deliveryWindowTo = this.date(
      input.deliveryWindowTo,
      'deliveryWindowTo',
    );
    if (pickupWindowFrom >= deliveryWindowTo)
      this.invalid('Shipment time window is invalid');
    const totalWeightBase = this.positive(
      input.totalWeightBase,
      'totalWeightBase',
    );
    const totalVolumeBase = this.positive(
      input.totalVolumeBase,
      'totalVolumeBase',
    );
    const totalPallets = this.nonNegative(input.totalPallets, 'totalPallets');
    const temperatureMin =
      input.temperatureMin === undefined
        ? null
        : this.decimal(input.temperatureMin, 'temperatureMin');
    const temperatureMax =
      input.temperatureMax === undefined
        ? null
        : this.decimal(input.temperatureMax, 'temperatureMax');
    if (
      (temperatureMin === null) !== (temperatureMax === null) ||
      (temperatureMin &&
        temperatureMax &&
        temperatureMin.greaterThan(temperatureMax))
    )
      this.invalid('Shipment temperature range is invalid');
    const items = input.items.map((item) => {
      this.uuid(item.transportOrderId, 'transportOrderId');
      if (
        !item.sourceLineRef?.trim() ||
        !item.quantityUom?.trim() ||
        !item.quantityBaseUom?.trim()
      )
        this.invalid('Shipment item references and units are required');
      return {
        ...item,
        allocationRatio: this.ratio(item.allocationRatio),
        quantity: this.positive(item.quantity, 'quantity'),
        quantityBase: this.positive(item.quantityBase, 'quantityBase'),
        volumeBase: this.positive(item.volumeBase, 'volumeBase'),
        weightBase: this.positive(item.weightBase, 'weightBase'),
      };
    });
    const legs = [...input.legs]
      .sort((left, right) => left.sequence - right.sequence)
      .map((leg, legIndex) => {
        if (
          leg.sequence !== legIndex + 1 ||
          !Object.keys(leg.slaSnapshot ?? {}).length
        )
          this.invalid('Leg sequence must be contiguous and SLA is required');
        const plannedStartAt = this.date(leg.plannedStartAt, 'plannedStartAt');
        const plannedEndAt = this.date(leg.plannedEndAt, 'plannedEndAt');
        if (plannedStartAt >= plannedEndAt)
          this.invalid('Leg time interval is invalid');
        if (
          legIndex &&
          plannedStartAt <
            this.date(input.legs[legIndex - 1]!.plannedEndAt, 'plannedEndAt')
        )
          this.invalid('Leg milestone times must be monotonic');
        if (!leg.equipment.equipmentType?.trim())
          this.invalid('Equipment type is required');
        return {
          ...leg,
          equipment: {
            ...leg.equipment,
            capacityPallets: this.nonNegative(
              leg.equipment.capacityPallets,
              'capacityPallets',
            ),
            capacityVolumeBase: this.positive(
              leg.equipment.capacityVolumeBase,
              'capacityVolumeBase',
            ),
            capacityWeightBase: this.positive(
              leg.equipment.capacityWeightBase,
              'capacityWeightBase',
            ),
          },
          plannedEndAt,
          plannedStartAt,
        };
      });
    return {
      ...input,
      deliveryWindowTo,
      items,
      legs,
      pickupWindowFrom,
      temperatureMax,
      temperatureMin,
      totalPallets,
      totalVolumeBase,
      totalWeightBase,
    };
  }

  private equipmentExclusions(
    shipment: ReturnType<PlanningService['parseShipment']>,
    equipment: ReturnType<
      PlanningService['parseShipment']
    >['legs'][number]['equipment'],
  ) {
    const reasons: string[] = [];
    if (shipment.totalWeightBase.greaterThan(equipment.capacityWeightBase))
      reasons.push('WEIGHT_OVERLOAD');
    if (shipment.totalVolumeBase.greaterThan(equipment.capacityVolumeBase))
      reasons.push('VOLUME_OVERLOAD');
    if (shipment.totalPallets.greaterThan(equipment.capacityPallets))
      reasons.push('PALLET_OVERLOAD');
    const snapshot = record(equipment.equipmentSnapshot);
    if (
      shipment.temperatureMin !== null &&
      snapshot.temperatureControlled !== true
    )
      reasons.push('TEMPERATURE_INCOMPATIBLE');
    if (
      record(shipment.requirementSnapshot).dangerousGoods === true &&
      snapshot.dangerousGoodsCapable !== true
    )
      reasons.push('DANGEROUS_GOODS_INCOMPATIBLE');
    const requiredLoading = record(shipment.requirementSnapshot).loadingMethod;
    const supported = Array.isArray(snapshot.loadingMethods)
      ? snapshot.loadingMethods.map(String)
      : [];
    if (requiredLoading && !supported.includes(String(requiredLoading)))
      reasons.push('LOADING_METHOD_INCOMPATIBLE');
    return reasons;
  }

  private async assertPlanValid(
    tx: Prisma.TransactionClient,
    planId: string,
    tenantId: string,
  ) {
    const shipments = await tx.shipment.findMany({
      where: { consolidationPlanId: planId, tenantId },
    });
    if (!shipments.length)
      throw new AppError('TMS_PLAN_EMPTY', 'Plan has no shipments', 409);
    const shipmentIds = shipments.map(({ id }) => id);
    const [items, legs] = await Promise.all([
      tx.shipmentItem.findMany({
        where: { shipmentId: { in: shipmentIds }, tenantId },
      }),
      tx.transportLeg.findMany({
        orderBy: { sequence: 'asc' },
        where: { shipmentId: { in: shipmentIds }, tenantId },
      }),
    ]);
    const equipment = await tx.equipmentSelection.findMany({
      where: { tenantId, transportLegId: { in: legs.map(({ id }) => id) } },
    });
    for (const shipment of shipments) {
      const shipmentItems = items.filter(
        ({ shipmentId }) => shipmentId === shipment.id,
      );
      const shipmentLegs = legs.filter(
        ({ shipmentId }) => shipmentId === shipment.id,
      );
      if (!shipmentItems.length || !shipmentLegs.length)
        throw new AppError(
          'TMS_PLAN_STRUCTURE_INVALID',
          'Every shipment requires items and legs',
          409,
        );
      const weight = Prisma.Decimal.sum(
        ...shipmentItems.map(({ weightBase }) => weightBase),
      );
      const volume = Prisma.Decimal.sum(
        ...shipmentItems.map(({ volumeBase }) => volumeBase),
      );
      if (
        !weight.equals(shipment.totalWeightBase) ||
        !volume.equals(shipment.totalVolumeBase)
      )
        throw new AppError(
          'TMS_SHIPMENT_TOTAL_MISMATCH',
          'Shipment item totals do not match shipment totals',
          409,
        );
      for (const [index, leg] of shipmentLegs.entries()) {
        if (
          leg.sequence !== index + 1 ||
          (index && leg.plannedStartAt < shipmentLegs[index - 1]!.plannedEndAt)
        )
          throw new AppError(
            'TMS_LEG_SEQUENCE_INVALID',
            'Leg sequence or milestone time is invalid',
            409,
          );
        const selected = equipment
          .filter(({ transportLegId }) => transportLegId === leg.id)
          .at(-1);
        if (!selected?.compatible)
          throw new AppError(
            'TMS_EQUIPMENT_INCOMPATIBLE',
            'Compatible equipment is required before publish',
            409,
          );
      }
    }
    const orderIds = [
      ...new Set(items.map(({ transportOrderId }) => transportOrderId)),
    ];
    const orders = await tx.transportOrder.findMany({
      where: { id: { in: orderIds }, tenantId },
    });
    for (const order of orders) {
      const mapped = items.filter(
        ({ transportOrderId }) => transportOrderId === order.id,
      );
      const ratio = Prisma.Decimal.sum(
        ...mapped.map(({ allocationRatio }) => allocationRatio),
      );
      const weight = Prisma.Decimal.sum(
        ...mapped.map(({ weightBase }) => weightBase),
      );
      const volume = Prisma.Decimal.sum(
        ...mapped.map(({ volumeBase }) => volumeBase),
      );
      if (
        !ratio.equals(1) ||
        !weight.equals(order.weightBase) ||
        !volume.equals(order.volumeBase)
      )
        throw new AppError(
          'TMS_ORDER_ALLOCATION_NOT_CONSERVED',
          'Order split mapping must conserve ratio, weight and volume',
          409,
        );
    }
  }

  private date(value: string, field: string) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime()))
      this.invalid(`${field} is invalid`);
    return date;
  }
  private decimal(value: unknown, field: string) {
    try {
      const result = new Prisma.Decimal(String(value ?? ''));
      if (!result.isFinite()) throw new Error();
      return result;
    } catch {
      this.invalid(`${field} must be a decimal`);
    }
  }
  private nonNegative(value: unknown, field: string) {
    const result = this.decimal(value, field);
    if (result.isNegative()) this.invalid(`${field} must be non-negative`);
    return result;
  }
  private positive(value: unknown, field: string) {
    const result = this.decimal(value, field);
    if (!result.greaterThan(0)) this.invalid(`${field} must be positive`);
    return result;
  }
  private ratio(value: unknown) {
    const result = this.positive(value, 'allocationRatio');
    if (result.greaterThan(1))
      this.invalid('allocationRatio cannot exceed one');
    return result;
  }
  private uuid(value: string, field: string) {
    if (!isUuid(value)) this.invalid(`${field} is invalid`);
  }
  private invalid(message: string): never {
    throw new AppError('TMS_PLANNING_INPUT_INVALID', message, 400);
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
          resourceType: 'TransportPlanning',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType: 'TransportPlanning',
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
