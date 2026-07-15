import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { businessNumber } from '../platform/public/numbering.facade';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

interface StopInput {
  locationSnapshot: Readonly<Record<string, unknown>>;
  serviceMinutes: number;
  stopRef: string;
  stopType: string;
  windowFrom: string;
  windowTo: string;
}
interface RouteInput {
  constraintSnapshot: Readonly<Record<string, unknown>>;
  distanceMatrix: Readonly<Record<string, number>>;
  lockedStopRefs?: readonly string[];
  objectiveWeights: readonly Readonly<Record<string, number>>[];
  parentScenarioId?: string;
  speedKph: number;
  stops: readonly StopInput[];
}

@Injectable()
export class LoadRouteService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async workbench(context: TenantContext) {
    const [
      loadPlans,
      metrics,
      routePlans,
      stops,
      scenarios,
      shipments,
      shipmentItems,
      transportLegs,
      equipmentSelections,
    ] = await Promise.all([
      this.prisma.loadPlan.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.utilizationMetric.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.routePlan.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.routeStop.findMany({
        orderBy: [{ routePlanId: 'asc' }, { sequence: 'asc' }],
        take: 300,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.optimizationScenario.findMany({
        orderBy: [{ routePlanId: 'asc' }, { score: 'desc' }],
        take: 300,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.shipment.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.shipmentItem.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 300,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.transportLeg.findMany({
        orderBy: [{ shipmentId: 'asc' }, { sequence: 'asc' }],
        take: 300,
        where: { tenantId: context.tenantId },
      }),
      this.prisma.equipmentSelection.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 300,
        where: { tenantId: context.tenantId },
      }),
    ]);
    return toHttpJson({
      equipmentSelections,
      loadPlans,
      metrics,
      routePlans,
      scenarios,
      shipmentItems,
      shipments,
      stops,
      transportLegs,
    });
  }

  createLoadPlan(
    input: {
      equipmentSelectionId: string;
      layoutSnapshot: Readonly<Record<string, unknown>>;
      shipmentId: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.shipmentId, 'shipmentId');
    this.uuid(input.equipmentSelectionId, 'equipmentSelectionId');
    return this.prisma.$transaction(async (tx) => {
      const [shipment, equipment, items] = await Promise.all([
        tx.shipment.findFirst({
          where: { id: input.shipmentId, tenantId: context.tenantId },
        }),
        tx.equipmentSelection.findFirst({
          where: { id: input.equipmentSelectionId, tenantId: context.tenantId },
        }),
        tx.shipmentItem.findMany({
          where: { shipmentId: input.shipmentId, tenantId: context.tenantId },
        }),
      ]);
      if (!shipment || !equipment || !items.length)
        throw new AppError(
          'TMS_LOAD_REFERENCES_INVALID',
          'Shipment, equipment and items are required',
          400,
        );
      const equipmentLeg = await tx.transportLeg.findFirst({
        where: {
          id: equipment.transportLegId,
          shipmentId: shipment.id,
          tenantId: context.tenantId,
        },
      });
      if (!equipmentLeg)
        throw new AppError(
          'TMS_LOAD_EQUIPMENT_SHIPMENT_MISMATCH',
          'Equipment selection does not belong to the shipment',
          409,
        );
      const id = randomUUID();
      const plan = await tx.loadPlan.create({
        data: {
          createdBy: context.accountId,
          equipmentSelectionId: equipment.id,
          id,
          layoutSnapshot: json(input.layoutSnapshot),
          loadPlanNo: await businessNumber(
            this.prisma,
            'TMS_LOAD_PLAN',
            context,
            metadata,
            `load-plan:${shipment.id}`,
          ),
          shipmentId: shipment.id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await tx.loadAssignment.createMany({
        data: items.map((item, index) => ({
          adjustmentType: 'INITIAL',
          assignmentNo: 1,
          createdBy: context.accountId,
          loadPlanId: plan.id,
          position: json({ column: index + 1, deck: 1, zone: 'MAIN' }),
          shipmentItemId: item.id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          validation: json({ compatible: true }),
        })),
      });
      const metric = await this.metric(
        tx,
        plan.id,
        shipment,
        equipment,
        1,
        context,
      );
      await this.emit(
        tx,
        plan.id,
        plan.version,
        'tms.load-plan-created.v1',
        context,
        metadata,
        {
          loadPlanId: plan.id,
          shipmentId: shipment.id,
          utilizationMetricId: metric.id,
        },
      );
      return {
        compatible: metric.compatible,
        loadPlanId: plan.id,
        status: plan.status,
        version: plan.version,
      };
    });
  }

  adjustLoad(
    planId: string,
    input: {
      expectedVersion: number;
      position: Readonly<Record<string, unknown>>;
      shipmentItemId: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(planId, 'loadPlanId');
    this.uuid(input.shipmentItemId, 'shipmentItemId');
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.loadPlan.findFirst({
        where: { id: planId, tenantId: context.tenantId },
      });
      if (
        !plan ||
        plan.status !== 'DRAFT' ||
        plan.version !== input.expectedVersion
      )
        throw this.conflict('TMS_LOAD_PLAN_CONFLICT');
      const [shipment, equipment, item, latest] = await Promise.all([
        tx.shipment.findUniqueOrThrow({ where: { id: plan.shipmentId } }),
        tx.equipmentSelection.findUniqueOrThrow({
          where: { id: plan.equipmentSelectionId },
        }),
        tx.shipmentItem.findFirst({
          where: {
            id: input.shipmentItemId,
            shipmentId: plan.shipmentId,
            tenantId: context.tenantId,
          },
        }),
        tx.loadAssignment.aggregate({
          _max: { assignmentNo: true },
          where: {
            loadPlanId: plan.id,
            shipmentItemId: input.shipmentItemId,
            tenantId: context.tenantId,
          },
        }),
      ]);
      if (!item)
        throw new AppError(
          'TMS_LOAD_ITEM_INVALID',
          'Shipment item does not belong to load plan',
          400,
        );
      const reasons: string[] = [];
      const position = record(input.position);
      const snapshot = record(item.itemSnapshot);
      if (
        snapshot.dangerousGoods === true &&
        position.dangerousAllowed !== true
      )
        reasons.push('DANGEROUS_POSITION_INCOMPATIBLE');
      if (
        snapshot.temperatureZone &&
        position.temperatureZone !== snapshot.temperatureZone
      )
        reasons.push('TEMPERATURE_ZONE_INCOMPATIBLE');
      if (reasons.length)
        throw new AppError(
          'TMS_LOAD_ADJUSTMENT_INCOMPATIBLE',
          'Manual load adjustment violates hard constraints',
          409,
          {
            fieldErrors: reasons.map((message) => ({
              field: 'position',
              message,
            })),
          },
        );
      const assignment = await tx.loadAssignment.create({
        data: {
          adjustmentRef: metadata.correlationId,
          adjustmentType: 'MANUAL_DRAG',
          assignmentNo: (latest._max.assignmentNo ?? 0) + 1,
          createdBy: context.accountId,
          loadPlanId: plan.id,
          position: json(input.position),
          shipmentItemId: item.id,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          validation: json({ compatible: true, revalidated: true }),
        },
      });
      const changed = await tx.loadPlan.update({
        data: {
          layoutSnapshot: json({
            ...record(plan.layoutSnapshot),
            lastAdjustmentId: assignment.id,
          }),
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: plan.id },
      });
      const metric = await this.metric(
        tx,
        plan.id,
        shipment,
        equipment,
        changed.version,
        context,
      );
      await this.emit(
        tx,
        plan.id,
        changed.version,
        'tms.load-plan-adjusted.v1',
        context,
        metadata,
        {
          assignmentId: assignment.id,
          loadPlanId: plan.id,
          utilizationMetricId: metric.id,
        },
      );
      return {
        compatible: metric.compatible,
        loadPlanId: plan.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  transitionLoad(
    planId: string,
    input: { expectedVersion: number; targetStatus: 'VALIDATED' | 'PUBLISHED' },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(planId, 'loadPlanId');
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.loadPlan.findFirst({
        where: { id: planId, tenantId: context.tenantId },
      });
      const allowed =
        input.targetStatus === 'VALIDATED'
          ? plan?.status === 'DRAFT'
          : plan?.status === 'VALIDATED';
      if (!plan || !allowed || plan.version !== input.expectedVersion)
        throw this.conflict('TMS_LOAD_PLAN_CONFLICT');
      const metric = await tx.utilizationMetric.findFirst({
        orderBy: { calculationNo: 'desc' },
        where: { loadPlanId: plan.id, tenantId: context.tenantId },
      });
      if (!metric?.compatible)
        throw new AppError(
          'TMS_LOAD_PLAN_INCOMPATIBLE',
          'Compatible utilization is required',
          409,
        );
      const now = new Date();
      const changed = await tx.loadPlan.update({
        data: {
          ...(input.targetStatus === 'VALIDATED'
            ? { validatedAt: now }
            : { publishedAt: now }),
          status: input.targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: plan.id },
      });
      await this.emit(
        tx,
        plan.id,
        changed.version,
        `tms.load-plan-${input.targetStatus.toLowerCase()}.v1`,
        context,
        metadata,
        { loadPlanId: plan.id },
      );
      return {
        loadPlanId: plan.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  optimizeRoute(
    shipmentId: string,
    input: RouteInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    if (
      input.stops.length < 2 ||
      !input.objectiveWeights.length ||
      !Number.isFinite(input.speedKph) ||
      input.speedKph <= 0
    )
      this.invalid(
        'At least two stops, speed and objective weights are required',
      );
    const parsed = input.stops.map((stop) => {
      const from = this.date(stop.windowFrom);
      const to = this.date(stop.windowTo);
      if (
        !stop.stopRef?.trim() ||
        !stop.stopType?.trim() ||
        !Number.isInteger(stop.serviceMinutes) ||
        stop.serviceMinutes < 0 ||
        from > to ||
        !Object.keys(stop.locationSnapshot ?? {}).length
      )
        this.invalid(
          'Stop reference, location, window or service time is invalid',
        );
      return { ...stop, from, to };
    });
    if (new Set(parsed.map(({ stopRef }) => stopRef)).size !== parsed.length)
      this.invalid('Stop references must be unique');
    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: { id: shipmentId, tenantId: context.tenantId },
      });
      if (!shipment)
        throw new AppError(
          'TMS_ROUTE_SHIPMENT_INVALID',
          'Shipment not found',
          404,
        );
      let parent: { stopSequence: Prisma.JsonValue } | null = null;
      if (input.parentScenarioId)
        parent = await tx.optimizationScenario.findFirst({
          select: { stopSequence: true },
          where: { id: input.parentScenarioId, tenantId: context.tenantId },
        });
      if (input.parentScenarioId && !parent)
        throw new AppError(
          'TMS_ROUTE_PARENT_SCENARIO_INVALID',
          'Parent optimization scenario was not found',
          404,
        );
      const locked = input.lockedStopRefs ?? [];
      const base = parsed.map(({ stopRef }) => stopRef);
      const candidates = [
        base,
        [...parsed]
          .sort((a, b) => a.from.getTime() - b.from.getTime())
          .map(({ stopRef }) => stopRef),
        [base[0]!, ...base.slice(1, -1).reverse(), base.at(-1)!],
      ];
      const unique = candidates
        .filter(
          (sequence, index) =>
            candidates.findIndex(
              (other) => other.join('|') === sequence.join('|'),
            ) === index,
        )
        .filter((sequence) =>
          this.locksPreserved(sequence, locked, parent?.stopSequence),
        );
      if (!unique.length)
        throw new AppError(
          'TMS_ROUTE_LOCK_CONFLICT',
          'Locked stops cannot be moved',
          409,
        );
      const routeId = randomUUID();
      const route = await tx.routePlan.create({
        data: {
          constraintSnapshot: json(input.constraintSnapshot),
          createdBy: context.accountId,
          id: routeId,
          inputSnapshot: json(input),
          routePlanNo: await businessNumber(
            this.prisma,
            'TMS_ROUTE_PLAN',
            context,
            metadata,
            `route-plan:${shipmentId}`,
          ),
          shipmentId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      let scenarioNo = 0;
      for (const weights of input.objectiveWeights)
        for (const sequence of unique) {
          const scored = this.score(
            sequence,
            parsed,
            input.distanceMatrix,
            input.speedKph,
            record(input.constraintSnapshot),
            weights,
          );
          if (!scored.valid) continue;
          scenarioNo += 1;
          await tx.optimizationScenario.create({
            data: {
              constraintResults: json(scored.constraints),
              createdBy: context.accountId,
              explanation: json({
                formula: 'weighted normalized objectives',
                schedule: scored.schedule,
              }),
              lockedStopRefs: json(locked),
              objectiveWeights: json(weights),
              parentScenarioId: input.parentScenarioId ?? null,
              routePlanId: route.id,
              scenarioNo,
              score: scored.score,
              scoreBreakdown: json(scored.breakdown),
              stopSequence: json(sequence),
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
        }
      if (!scenarioNo)
        throw new AppError(
          'TMS_ROUTE_NO_FEASIBLE_SCENARIO',
          'No route satisfies time windows and driver hours',
          409,
        );
      const optimized = await tx.routePlan.update({
        data: {
          optimizedAt: new Date(),
          status: 'OPTIMIZED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: route.id },
      });
      await this.emit(
        tx,
        route.id,
        optimized.version,
        'tms.route-optimized.v1',
        context,
        metadata,
        { routePlanId: route.id, scenarioCount: scenarioNo, shipmentId },
      );
      return {
        routePlanId: route.id,
        scenarioCount: scenarioNo,
        status: optimized.status,
        version: optimized.version,
      };
    });
  }

  selectScenario(
    routeId: string,
    scenarioId: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(routeId, 'routePlanId');
    this.uuid(scenarioId, 'scenarioId');
    return this.prisma.$transaction(async (tx) => {
      const [route, scenario] = await Promise.all([
        tx.routePlan.findFirst({
          where: { id: routeId, tenantId: context.tenantId },
        }),
        tx.optimizationScenario.findFirst({
          where: {
            id: scenarioId,
            routePlanId: routeId,
            status: 'PROPOSED',
            tenantId: context.tenantId,
          },
        }),
      ]);
      if (
        !route ||
        route.status !== 'OPTIMIZED' ||
        route.version !== input.expectedVersion ||
        !scenario
      )
        throw this.conflict('TMS_ROUTE_PLAN_CONFLICT');
      const inputSnapshot = record(route.inputSnapshot);
      const stops = Array.isArray(inputSnapshot.stops)
        ? inputSnapshot.stops.map(record)
        : [];
      const explanation = record(scenario.explanation);
      const schedule = Array.isArray(explanation.schedule)
        ? explanation.schedule.map(record)
        : [];
      await tx.routeStop.createMany({
        data: schedule.map((entry, index) => {
          const source =
            stops.find((stop) => stop.stopRef === entry.stopRef) ?? {};
          return {
            createdBy: context.accountId,
            locationSnapshot: json(source.locationSnapshot),
            locked: (scenario.lockedStopRefs as string[]).includes(
              String(entry.stopRef),
            ),
            plannedArrival: new Date(String(entry.arrival)),
            plannedDeparture: new Date(String(entry.departure)),
            routePlanId: route.id,
            sequence: index + 1,
            serviceMinutes: Number(source.serviceMinutes ?? 0),
            stopRef: String(entry.stopRef),
            stopType: String(source.stopType ?? 'WAYPOINT'),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            windowFrom: new Date(String(source.windowFrom)),
            windowTo: new Date(String(source.windowTo)),
          };
        }),
      });
      await Promise.all([
        tx.optimizationScenario.update({
          data: {
            status: 'SELECTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: scenario.id },
        }),
        tx.optimizationScenario.updateMany({
          data: {
            status: 'REJECTED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            id: { not: scenario.id },
            routePlanId: route.id,
            status: 'PROPOSED',
          },
        }),
      ]);
      const changed = await tx.routePlan.update({
        data: {
          selectedAt: new Date(),
          selectedScenarioId: scenario.id,
          status: 'SELECTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: route.id },
      });
      await this.emit(
        tx,
        route.id,
        changed.version,
        'tms.route-selected.v1',
        context,
        metadata,
        { routePlanId: route.id, scenarioId: scenario.id },
      );
      return {
        routePlanId: route.id,
        scenarioId: scenario.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  private async metric(
    tx: Prisma.TransactionClient,
    planId: string,
    shipment: {
      totalPallets: Prisma.Decimal;
      totalVolumeBase: Prisma.Decimal;
      totalWeightBase: Prisma.Decimal;
      requirementSnapshot: Prisma.JsonValue;
    },
    equipment: {
      capacityPallets: Prisma.Decimal;
      capacityVolumeBase: Prisma.Decimal;
      capacityWeightBase: Prisma.Decimal;
      compatible: boolean;
    },
    calculationNo: number,
    context: TenantContext,
  ) {
    const ratios = {
      pallet: equipment.capacityPallets.isZero()
        ? new Prisma.Decimal(0)
        : shipment.totalPallets.mul(100).div(equipment.capacityPallets),
      volume: shipment.totalVolumeBase
        .mul(100)
        .div(equipment.capacityVolumeBase),
      weight: shipment.totalWeightBase
        .mul(100)
        .div(equipment.capacityWeightBase),
    };
    const reasons = [
      ...(equipment.compatible ? [] : ['EQUIPMENT_INCOMPATIBLE']),
      ...(ratios.weight.greaterThan(100) ? ['WEIGHT_OVERLOAD'] : []),
      ...(ratios.volume.greaterThan(100) ? ['VOLUME_OVERLOAD'] : []),
      ...(ratios.pallet.greaterThan(100) ? ['PALLET_OVERLOAD'] : []),
    ];
    return tx.utilizationMetric.create({
      data: {
        calculationNo,
        calculationTrace: json({ capacity: equipment, required: shipment }),
        compatible: reasons.length === 0,
        createdBy: context.accountId,
        exclusionReasons: json(reasons),
        loadPlanId: planId,
        palletUtilization: ratios.pallet,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
        valueUtilization: new Prisma.Decimal(
          String(record(shipment.requirementSnapshot).valueUtilization ?? 0),
        ),
        volumeUtilization: ratios.volume,
        weightUtilization: ratios.weight,
      },
    });
  }
  private score(
    sequence: string[],
    stops: Array<StopInput & { from: Date; to: Date }>,
    matrix: Readonly<Record<string, number>>,
    speed: number,
    constraints: Record<string, unknown>,
    weights: Readonly<Record<string, number>>,
  ) {
    let current = new Date(String(constraints.shiftStart ?? stops[0]!.from));
    let distance = 0;
    let late = 0;
    const schedule = [];
    for (const [index, ref] of sequence.entries()) {
      const stop = stops.find((candidate) => candidate.stopRef === ref)!;
      if (index) {
        const leg = Number(matrix[`${sequence[index - 1]}|${ref}`] ?? 0);
        distance += leg;
        current = new Date(current.getTime() + (leg / speed) * 3_600_000);
      }
      if (current < stop.from) current = new Date(stop.from);
      if (current > stop.to)
        late += (current.getTime() - stop.to.getTime()) / 60000;
      const arrival = new Date(current);
      current = new Date(current.getTime() + stop.serviceMinutes * 60000);
      schedule.push({
        arrival: arrival.toISOString(),
        departure: current.toISOString(),
        stopRef: ref,
      });
    }
    const shiftEnd = constraints.shiftEnd
      ? new Date(String(constraints.shiftEnd))
      : undefined;
    const valid = late === 0 && (!shiftEnd || current <= shiftEnd);
    const cost = distance * Number(constraints.costPerKm ?? 1);
    const score =
      100000 -
      distance * Number(weights.distance ?? 0) -
      cost * Number(weights.cost ?? 0) -
      late * Number(weights.onTime ?? 0) -
      Number(weights.vehicles ?? 0);
    return {
      breakdown: { cost, distance, lateMinutes: late, vehicles: 1 },
      constraints: {
        driverHoursPassed: !shiftEnd || current <= shiftEnd,
        timeWindowsPassed: late === 0,
      },
      schedule,
      score: new Prisma.Decimal(score.toFixed(6)),
      valid,
    };
  }
  private locksPreserved(
    sequence: string[],
    locked: readonly string[],
    parent: Prisma.JsonValue | undefined,
  ) {
    if (!parent || !Array.isArray(parent)) return true;
    return locked.every(
      (ref) => sequence.indexOf(ref) === parent.map(String).indexOf(ref),
    );
  }
  private date(value: string) {
    const result = new Date(value);
    if (!value || Number.isNaN(result.getTime()))
      this.invalid('Date is invalid');
    return result;
  }
  private uuid(value: string, field: string) {
    if (!isUuid(value)) this.invalid(`${field} is invalid`);
  }
  private invalid(message: string): never {
    throw new AppError('TMS_LOAD_ROUTE_INPUT_INVALID', message, 400);
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
          resourceType: 'TransportOptimization',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType: 'TransportOptimization',
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
