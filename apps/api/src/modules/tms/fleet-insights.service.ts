import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { FleetAssignmentFacade } from '../mdm/public/fleet-assignment.facade';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const activeExceptionStatuses = [
  'OPEN',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
] as const;

@Injectable()
export class FleetInsightsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FleetAssignmentFacade)
    private readonly fleet: FleetAssignmentFacade,
  ) {}

  async workbench(context: TenantContext) {
    const query = {
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: 300,
      where: { tenantId: context.tenantId },
    };
    const [
      maintenancePlans,
      availabilities,
      operatingFacts,
      telemetry,
      conditionAlerts,
      metrics,
      trackingTokens,
      shipments,
      fleetCandidates,
    ] = await Promise.all([
      this.prisma.maintenancePlan.findMany(query),
      this.prisma.vehicleAvailability.findMany(query),
      this.prisma.vehicleOperatingFact.findMany(query),
      this.prisma.telemetry.findMany(query),
      this.prisma.conditionAlert.findMany(query),
      this.prisma.transportMetric.findMany(query),
      this.prisma.trackingAccessToken.findMany(query),
      this.prisma.shipment.findMany(query),
      this.fleet.listCandidates(context),
    ]);
    return toHttpJson({
      availabilities,
      conditionAlerts,
      maintenancePlans,
      metrics,
      operatingFacts,
      shipments,
      telemetry,
      trackingTokens: trackingTokens.map(({ tokenHash, ...token }) => ({
        ...token,
        tokenProtected: tokenHash.length === 64,
      })),
      vehicles: fleetCandidates.vehicles,
    });
  }

  async scheduleMaintenance(
    input: {
      detailSnapshot: Readonly<Record<string, unknown>>;
      maintenanceType:
        'MAINTENANCE' | 'REPAIR' | 'INSPECTION' | 'ANNUAL_INSPECTION';
      odometer: string;
      plannedFrom: string;
      plannedTo: string;
      reason: string;
      vehicleRef: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const vehicle = await this.fleet.getVehicle(input.vehicleRef, context);
    if (vehicle.status !== 'AVAILABLE')
      throw new AppError(
        'TMS_MAINTENANCE_VEHICLE_INVALID',
        'Only an available vehicle can enter maintenance planning',
        409,
      );
    const plannedFrom = this.date(input.plannedFrom);
    const plannedTo = this.date(input.plannedTo);
    if (
      plannedTo <= plannedFrom ||
      !input.reason?.trim() ||
      !['MAINTENANCE', 'REPAIR', 'INSPECTION', 'ANNUAL_INSPECTION'].includes(
        input.maintenanceType,
      )
    )
      this.invalid('Maintenance schedule or reason is invalid');
    const odometer = this.nonNegative(input.odometer);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(
        tx,
        `${context.tenantId}:${input.vehicleRef}:maintenance`,
      );
      const [overlap, assignment, pools] = await Promise.all([
        tx.vehicleAvailability.count({
          where: {
            status: 'ACTIVE',
            tenantId: context.tenantId,
            unavailableFrom: { lt: plannedTo },
            unavailableTo: { gt: plannedFrom },
            vehicleRef: input.vehicleRef,
          },
        }),
        tx.vehicleAssignment.count({
          where: {
            scheduleFrom: { lt: plannedTo },
            scheduleTo: { gt: plannedFrom },
            status: { in: ['ASSIGNED', 'DISPATCHED'] },
            tenantId: context.tenantId,
            vehicleRef: input.vehicleRef,
          },
        }),
        tx.capacityPool.findMany({
          where: {
            serviceDate: {
              gte: new Date(
                Date.UTC(
                  plannedFrom.getUTCFullYear(),
                  plannedFrom.getUTCMonth(),
                  plannedFrom.getUTCDate(),
                ),
              ),
              lte: new Date(
                Date.UTC(
                  plannedTo.getUTCFullYear(),
                  plannedTo.getUTCMonth(),
                  plannedTo.getUTCDate(),
                ),
              ),
            },
            status: 'ACTIVE',
            tenantId: context.tenantId,
            vehicleRef: input.vehicleRef,
          },
        }),
      ]);
      if (overlap || assignment)
        throw new AppError(
          'TMS_MAINTENANCE_SCHEDULE_CONFLICT',
          'Maintenance overlaps another unavailable window or assignment',
          409,
          { retryable: true },
        );
      const reserved = await tx.capacityReservation.count({
        where: {
          capacityPoolId: { in: pools.map(({ id }) => id) },
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      if (reserved)
        throw new AppError(
          'TMS_MAINTENANCE_CAPACITY_RESERVED',
          'Release vehicle capacity reservations before maintenance',
          409,
        );
      const id = randomUUID();
      const plan = await tx.maintenancePlan.create({
        data: {
          createdBy: context.accountId,
          detailSnapshot: json({
            ...input.detailSnapshot,
            vehicleSnapshot: vehicle,
          }),
          id,
          maintenanceType: input.maintenanceType,
          odometer,
          plannedFrom,
          plannedTo,
          planNo: `MNT-${Date.now()}-${id.slice(0, 6)}`,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          vehicleRef: input.vehicleRef,
        },
      });
      const availability = await tx.vehicleAvailability.create({
        data: {
          affectedPoolIds: pools.map(({ id: poolId }) => poolId),
          createdBy: context.accountId,
          maintenancePlanId: plan.id,
          reason: input.reason.trim(),
          tenantId: context.tenantId,
          unavailableFrom: plannedFrom,
          unavailableTo: plannedTo,
          updatedBy: context.accountId,
          vehicleRef: input.vehicleRef,
        },
      });
      if (pools.length)
        await tx.capacityPool.updateMany({
          data: {
            status: 'INACTIVE',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: { in: pools.map(({ id: poolId }) => poolId) } },
        });
      await this.emit(
        tx,
        plan.id,
        plan.version,
        'fleet.maintenance-planned.v1',
        context,
        metadata,
        {
          affectedCapacityPoolIds: pools.map(({ id: poolId }) => poolId),
          maintenancePlanId: plan.id,
          vehicleAvailabilityId: availability.id,
          vehicleRef: input.vehicleRef,
        },
        'MaintenancePlan',
      );
      return {
        maintenancePlanId: plan.id,
        status: plan.status,
        vehicleAvailabilityId: availability.id,
        version: plan.version,
      };
    });
  }

  transitionMaintenance(
    id: string,
    input: {
      action: 'START' | 'COMPLETE' | 'CANCEL';
      expectedVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'maintenancePlanId');
    if (!input.reason?.trim()) this.invalid('Transition reason is required');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${id}:maintenance-transition`);
      const plan = await tx.maintenancePlan.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!plan || plan.version !== input.expectedVersion)
        throw this.conflict('TMS_MAINTENANCE_VERSION_CONFLICT');
      const next =
        input.action === 'START' && plan.status === 'PLANNED'
          ? 'IN_PROGRESS'
          : input.action === 'COMPLETE' && plan.status === 'IN_PROGRESS'
            ? 'COMPLETED'
            : input.action === 'CANCEL' &&
                ['PLANNED', 'IN_PROGRESS'].includes(plan.status)
              ? 'CANCELLED'
              : null;
      if (!next)
        throw new AppError(
          'TMS_MAINTENANCE_TRANSITION_INVALID',
          `Cannot ${input.action} from ${plan.status}`,
          409,
        );
      const now = new Date();
      const changed = await tx.maintenancePlan.update({
        data: {
          cancelledAt: next === 'CANCELLED' ? now : plan.cancelledAt,
          completedAt: next === 'COMPLETED' ? now : plan.completedAt,
          startedAt: next === 'IN_PROGRESS' ? now : plan.startedAt,
          status: next,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await tx.maintenanceEvent.create({
        data: {
          createdBy: context.accountId,
          fromStatus: plan.status,
          maintenancePlanId: plan.id,
          reason: input.reason.trim(),
          tenantId: context.tenantId,
          toStatus: next,
          updatedBy: context.accountId,
        },
      });
      if (['COMPLETED', 'CANCELLED'].includes(next)) {
        const availability = await tx.vehicleAvailability.findFirstOrThrow({
          where: {
            maintenancePlanId: id,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        await tx.vehicleAvailability.update({
          data: {
            releasedAt: now,
            status: 'RELEASED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: availability.id },
        });
        const poolIds = Array.isArray(availability.affectedPoolIds)
          ? availability.affectedPoolIds.map(String).filter(isUuid)
          : [];
        if (poolIds.length)
          await tx.capacityPool.updateMany({
            data: {
              status: 'ACTIVE',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: {
              id: { in: poolIds },
              status: 'INACTIVE',
              tenantId: context.tenantId,
            },
          });
      }
      await this.emit(
        tx,
        changed.id,
        changed.version,
        `fleet.maintenance-${next.toLowerCase()}.v1`,
        context,
        metadata,
        { maintenancePlanId: id, reason: input.reason.trim() },
        'MaintenancePlan',
      );
      return {
        maintenancePlanId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  async recordOperatingFact(
    input: {
      detailSnapshot: Readonly<Record<string, unknown>>;
      factType: 'ODOMETER' | 'FUEL' | 'MAINTENANCE' | 'REPAIR' | 'INSPECTION';
      occurredAt: string;
      sourceRef: string;
      uom: string;
      value: string;
      vehicleRef: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    await this.fleet.getVehicle(input.vehicleRef, context);
    if (!input.sourceRef?.trim() || !input.uom?.trim())
      this.invalid('Operating fact source and unit are required');
    const existing = await this.prisma.vehicleOperatingFact.findUnique({
      where: {
        tenantId_vehicleRef_factType_sourceRef: {
          factType: input.factType,
          sourceRef: input.sourceRef.trim(),
          tenantId: context.tenantId,
          vehicleRef: input.vehicleRef,
        },
      },
    });
    if (existing)
      return {
        operatingFactId: existing.id,
        replayed: true,
        status: existing.status,
        version: existing.version,
      };
    return this.prisma.$transaction(async (tx) => {
      const id = randomUUID();
      const fact = await tx.vehicleOperatingFact.create({
        data: {
          createdBy: context.accountId,
          detailSnapshot: json(input.detailSnapshot),
          factNo: `VOF-${Date.now()}-${id.slice(0, 6)}`,
          factType: input.factType,
          id,
          occurredAt: this.date(input.occurredAt),
          sourceRef: input.sourceRef.trim(),
          tenantId: context.tenantId,
          uom: input.uom.trim().toUpperCase(),
          updatedBy: context.accountId,
          value: this.nonNegative(input.value),
          vehicleRef: input.vehicleRef,
        },
      });
      await this.emit(
        tx,
        fact.id,
        fact.version,
        'fleet.operating-fact-recorded.v1',
        context,
        metadata,
        { factType: fact.factType, vehicleRef: fact.vehicleRef },
        'VehicleOperatingFact',
      );
      return {
        operatingFactId: fact.id,
        status: fact.status,
        version: fact.version,
      };
    });
  }

  ingestTelemetry(
    shipmentId: string,
    input: {
      deviceRef: string;
      externalMessageId: string;
      metricType: 'TEMPERATURE' | 'HUMIDITY' | 'DOOR' | 'DEVICE_ALERT';
      observedAt: string;
      payloadSnapshot: Readonly<Record<string, unknown>>;
      retentionDays: number;
      thresholdMax?: string;
      thresholdMin?: string;
      uom?: string;
      value?: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    if (
      !input.deviceRef?.trim() ||
      !input.externalMessageId?.trim() ||
      !Number.isInteger(input.retentionDays) ||
      input.retentionDays < 1 ||
      input.retentionDays > 3650
    )
      this.invalid('Telemetry device, message and retention are invalid');
    const observedAt = this.date(input.observedAt);
    const value =
      input.value === undefined ? null : this.decimal(input.value, true);
    if (
      ['TEMPERATURE', 'HUMIDITY'].includes(input.metricType) &&
      (!value || !input.uom?.trim())
    )
      this.invalid('Numeric telemetry requires value and unit');
    const contentHash = this.hash(
      this.canonical({ shipmentId, ...input, observedAt: observedAt.toJSON() }),
    );
    return this.prisma.$transaction(async (tx) => {
      await this.lock(
        tx,
        `${context.tenantId}:${input.deviceRef}:${input.externalMessageId}`,
      );
      const existing = await tx.telemetry.findUnique({
        where: {
          tenantId_deviceRef_externalMessageId: {
            deviceRef: input.deviceRef.trim(),
            externalMessageId: input.externalMessageId.trim(),
            tenantId: context.tenantId,
          },
        },
      });
      if (existing) {
        if (existing.contentHash !== contentHash)
          throw new AppError(
            'TMS_TELEMETRY_REPLAY_CONFLICT',
            'Device message was replayed with different content',
            409,
          );
        return {
          replayed: true,
          status: existing.status,
          telemetryId: existing.id,
          version: existing.version,
        };
      }
      const shipment = await tx.shipment.findFirst({
        where: {
          id: shipmentId,
          status: { in: ['DISPATCHED', 'TRACKING', 'DELIVERED'] },
          tenantId: context.tenantId,
        },
      });
      if (!shipment)
        throw new AppError(
          'TMS_TELEMETRY_SHIPMENT_INVALID',
          'Active transport shipment is required',
          409,
        );
      const telemetry = await tx.telemetry.create({
        data: {
          contentHash,
          createdBy: context.accountId,
          deviceRef: input.deviceRef.trim(),
          externalMessageId: input.externalMessageId.trim(),
          metricType: input.metricType,
          observedAt,
          payloadSnapshot: json(input.payloadSnapshot),
          retentionUntil: new Date(
            observedAt.getTime() + input.retentionDays * 86_400_000,
          ),
          shipmentId,
          tenantId: context.tenantId,
          uom: input.uom?.trim().toUpperCase() ?? null,
          updatedBy: context.accountId,
          value,
        },
      });
      const threshold = this.telemetryThreshold(shipment, input);
      let alertId: string | undefined;
      if (this.exceedsThreshold(input, value, threshold)) {
        const dedupeKey = `IOT:${shipmentId}:${input.metricType}:${input.deviceRef.trim()}`;
        let transportException = await tx.transportException.findFirst({
          where: {
            dedupeKey,
            status: { in: [...activeExceptionStatuses] },
            tenantId: context.tenantId,
          },
        });
        if (!transportException) {
          const exceptionId = randomUUID();
          transportException = await tx.transportException.create({
            data: {
              createdBy: context.accountId,
              dedupeKey,
              detectedAt: observedAt,
              detectedBy: 'SYSTEM',
              evidenceSnapshot: json({
                telemetryId: telemetry.id,
                threshold,
                value: value?.toString() ?? null,
              }),
              exceptionNo: `EXC-${Date.now()}-${exceptionId.slice(0, 6)}`,
              financialHold: true,
              id: exceptionId,
              reassignRequested: false,
              severity:
                input.metricType === 'TEMPERATURE' ? 'CRITICAL' : 'HIGH',
              shipmentId,
              slaDueAt: new Date(observedAt.getTime() + 30 * 60_000),
              tenantId: context.tenantId,
              type:
                input.metricType === 'TEMPERATURE'
                  ? 'TEMPERATURE'
                  : 'COMMUNICATION_LOSS',
              updatedBy: context.accountId,
            },
          });
        }
        const alert = await tx.conditionAlert.create({
          data: {
            alertNo: `CAL-${Date.now()}-${telemetry.id.slice(0, 6)}`,
            alertType: input.metricType,
            createdBy: context.accountId,
            evidenceSnapshot: json({
              payload: input.payloadSnapshot,
              value: value?.toString() ?? null,
            }),
            severity: input.metricType === 'TEMPERATURE' ? 'CRITICAL' : 'HIGH',
            shipmentId,
            telemetryId: telemetry.id,
            tenantId: context.tenantId,
            thresholdSnapshot: json(threshold),
            transportExceptionId: transportException.id,
            updatedBy: context.accountId,
          },
        });
        alertId = alert.id;
      }
      await this.emit(
        tx,
        telemetry.id,
        telemetry.version,
        alertId ? 'telemetry.condition-alerted.v1' : 'telemetry.recorded.v1',
        context,
        metadata,
        { alertId: alertId ?? null, shipmentId, telemetryId: telemetry.id },
        'Telemetry',
      );
      return {
        alertId,
        status: telemetry.status,
        telemetryId: telemetry.id,
        version: telemetry.version,
      };
    });
  }

  transitionAlert(
    id: string,
    input: {
      action: 'ACKNOWLEDGE' | 'RESOLVE';
      expectedVersion: number;
      resolution?: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'conditionAlertId');
    return this.prisma.$transaction(async (tx) => {
      const alert = await tx.conditionAlert.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!alert || alert.version !== input.expectedVersion)
        throw this.conflict('TMS_CONDITION_ALERT_VERSION_CONFLICT');
      const next =
        input.action === 'ACKNOWLEDGE' && alert.status === 'OPEN'
          ? 'ACKNOWLEDGED'
          : input.action === 'RESOLVE' && alert.status === 'ACKNOWLEDGED'
            ? 'RESOLVED'
            : null;
      if (!next || (next === 'RESOLVED' && !input.resolution?.trim()))
        throw new AppError(
          'TMS_CONDITION_ALERT_TRANSITION_INVALID',
          `Cannot ${input.action} from ${alert.status}`,
          409,
        );
      const now = new Date();
      const changed = await tx.conditionAlert.update({
        data: {
          acknowledgedAt: next === 'ACKNOWLEDGED' ? now : alert.acknowledgedAt,
          resolution:
            next === 'RESOLVED' ? input.resolution!.trim() : alert.resolution,
          resolvedAt: next === 'RESOLVED' ? now : alert.resolvedAt,
          status: next,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      if (next === 'ACKNOWLEDGED' && alert.transportExceptionId)
        await tx.transportException.updateMany({
          data: {
            acknowledgedAt: now,
            status: 'ACKNOWLEDGED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            id: alert.transportExceptionId,
            status: 'OPEN',
            tenantId: context.tenantId,
          },
        });
      if (next === 'RESOLVED' && alert.transportExceptionId)
        await tx.transportException.updateMany({
          data: {
            businessVerified: true,
            resolvedAt: now,
            resolutionSummary: input.resolution!.trim(),
            status: 'RESOLVED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            id: alert.transportExceptionId,
            status: { in: [...activeExceptionStatuses] },
            tenantId: context.tenantId,
          },
        });
      await this.emit(
        tx,
        changed.id,
        changed.version,
        `telemetry.condition-${next.toLowerCase()}.v1`,
        context,
        metadata,
        { conditionAlertId: id, shipmentId: alert.shipmentId },
        'ConditionAlert',
      );
      return {
        conditionAlertId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  generateMetrics(
    input: {
      dimensionType: 'CUSTOMER' | 'REGION' | 'ROUTE' | 'CARRIER';
      periodFrom: string;
      periodTo: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const periodFrom = this.date(input.periodFrom);
    const periodTo = this.date(input.periodTo);
    if (periodTo < periodFrom) this.invalid('Metric period is invalid');
    return this.prisma.$transaction(async (tx) => {
      const shipments = await tx.shipment.findMany({
        where: {
          createdAt: { gte: periodFrom, lte: periodTo },
          tenantId: context.tenantId,
        },
      });
      const shipmentIds = shipments.map(({ id }) => id);
      const plans = await tx.consolidationPlan.findMany({
        where: {
          id: {
            in: shipments.map(({ consolidationPlanId }) => consolidationPlanId),
          },
          tenantId: context.tenantId,
        },
      });
      const batches = await tx.planningBatch.findMany({
        where: {
          id: { in: plans.map(({ planningBatchId }) => planningBatchId) },
          tenantId: context.tenantId,
        },
      });
      const [
        milestones,
        tenders,
        loadPlans,
        segments,
        calculations,
        exceptions,
        pods,
        deliveries,
      ] = await Promise.all([
        tx.shipmentMilestone.findMany({
          where: {
            shipmentId: { in: shipmentIds },
            tenantId: context.tenantId,
          },
        }),
        tx.carrierTender.findMany({
          where: {
            shipmentId: { in: shipmentIds },
            tenantId: context.tenantId,
          },
        }),
        tx.loadPlan.findMany({
          where: {
            shipmentId: { in: shipmentIds },
            tenantId: context.tenantId,
          },
        }),
        tx.trackSegment.findMany({
          where: {
            shipmentId: { in: shipmentIds },
            tenantId: context.tenantId,
          },
        }),
        tx.chargeCalculation.findMany({
          where: {
            direction: 'PAYABLE',
            shipmentId: { in: shipmentIds },
            status: 'CALCULATED',
            tenantId: context.tenantId,
          },
        }),
        tx.transportException.findMany({
          where: {
            shipmentId: { in: shipmentIds },
            tenantId: context.tenantId,
          },
        }),
        tx.proofOfDelivery.findMany({
          where: {
            shipmentId: { in: shipmentIds },
            status: 'CONFIRMED',
            tenantId: context.tenantId,
          },
        }),
        tx.deliveryConfirmation.findMany({
          where: {
            shipmentId: { in: shipmentIds },
            tenantId: context.tenantId,
          },
        }),
      ]);
      const utilization = await tx.utilizationMetric.findMany({
        where: {
          loadPlanId: { in: loadPlans.map(({ id }) => id) },
          tenantId: context.tenantId,
        },
      });
      const planById = new Map(plans.map((item) => [item.id, item]));
      const batchById = new Map(batches.map((item) => [item.id, item]));
      const groups = new Map<string, typeof shipments>();
      for (const shipment of shipments) {
        const plan = planById.get(shipment.consolidationPlanId);
        const batch = plan ? batchById.get(plan.planningBatchId) : undefined;
        const origin = record(shipment.originSnapshot);
        const destination = record(shipment.destinationSnapshot);
        const carrier = tenders
          .filter(({ shipmentId }) => shipmentId === shipment.id)
          .sort(
            (a, b) =>
              Number(b.status === 'ACCEPTED') - Number(a.status === 'ACCEPTED'),
          )[0];
        const dimensionValue =
          input.dimensionType === 'CUSTOMER'
            ? (batch?.customerRef ?? 'UNSPECIFIED')
            : input.dimensionType === 'REGION'
              ? (batch?.regionCode ?? 'UNSPECIFIED')
              : input.dimensionType === 'CARRIER'
                ? (carrier?.carrierRef ?? 'UNASSIGNED')
                : `${String(origin.city ?? origin.region ?? 'UNKNOWN')}→${String(destination.city ?? destination.region ?? 'UNKNOWN')}`;
        groups.set(dimensionValue, [
          ...(groups.get(dimensionValue) ?? []),
          shipment,
        ]);
      }
      const runId = randomUUID();
      const metricIds: string[] = [];
      for (const [dimensionValue, members] of groups) {
        const ids = new Set(members.map(({ id }) => id));
        const memberMilestones = milestones.filter(({ shipmentId }) =>
          ids.has(shipmentId),
        );
        const pickup = memberMilestones.filter(({ type }) =>
          type.includes('PICKUP'),
        );
        const delivery = memberMilestones.filter(({ type }) =>
          type.includes('DELIVERY'),
        );
        const memberTenders = tenders.filter(({ shipmentId }) =>
          ids.has(shipmentId),
        );
        const memberLoadPlanIds = new Set(
          loadPlans
            .filter(({ shipmentId }) => ids.has(shipmentId))
            .map(({ id }) => id),
        );
        const memberUtilization = utilization.filter(({ loadPlanId }) =>
          memberLoadPlanIds.has(loadPlanId),
        );
        const latestCosts = new Map<string, (typeof calculations)[number]>();
        for (const calculation of calculations.filter(({ shipmentId }) =>
          ids.has(shipmentId),
        )) {
          const old = latestCosts.get(calculation.shipmentId);
          if (!old || calculation.calculationVersion > old.calculationVersion)
            latestCosts.set(calculation.shipmentId, calculation);
        }
        const podHours = pods
          .filter(({ shipmentId }) => ids.has(shipmentId))
          .flatMap((pod) => {
            const confirmed = deliveries.find(
              ({ shipmentId }) => shipmentId === pod.shipmentId,
            );
            return confirmed && pod.confirmedAt
              ? [
                  (pod.confirmedAt.getTime() - confirmed.signedAt.getTime()) /
                    3_600_000,
                ]
              : [];
          });
        const definitions = [
          ['SHIPMENT_COUNT', members.length, 'COUNT'],
          [
            'ON_TIME_PICKUP_RATE',
            this.rate(
              pickup.filter(
                (item) => item.actualAt && item.actualAt <= item.plannedAt,
              ).length,
              pickup.length,
            ),
            'PERCENT',
          ],
          [
            'ON_TIME_DELIVERY_RATE',
            this.rate(
              delivery.filter(
                (item) => item.actualAt && item.actualAt <= item.plannedAt,
              ).length,
              delivery.length,
            ),
            'PERCENT',
          ],
          [
            'TENDER_REJECTION_RATE',
            this.rate(
              memberTenders.filter(({ status }) => status === 'REJECTED')
                .length,
              memberTenders.length,
            ),
            'PERCENT',
          ],
          [
            'LOAD_UTILIZATION',
            this.average(
              memberUtilization.map((item) =>
                Math.max(
                  item.weightUtilization.toNumber(),
                  item.volumeUtilization.toNumber(),
                  item.palletUtilization.toNumber(),
                ),
              ),
            ),
            'PERCENT',
          ],
          [
            'DISTANCE_KM',
            segments
              .filter(({ shipmentId }) => ids.has(shipmentId))
              .reduce(
                (sum, item) => sum + item.distanceMeters.toNumber() / 1000,
                0,
              ),
            'KM',
          ],
          [
            'PAYABLE_COST',
            [...latestCosts.values()].reduce(
              (sum, item) => sum + item.totalAmount.toNumber(),
              0,
            ),
            'MONEY',
          ],
          [
            'EXCEPTION_COUNT',
            exceptions.filter(({ shipmentId }) => ids.has(shipmentId)).length,
            'COUNT',
          ],
          ['POD_LEAD_HOURS', this.average(podHours), 'HOUR'],
        ] as const;
        for (const [metricCode, value, uom] of definitions) {
          const metric = await tx.transportMetric.create({
            data: {
              calculationTrace: json({
                formula: metricCode,
                shipmentIds: [...ids],
              }),
              createdBy: context.accountId,
              dimensionSnapshot: json({
                dimensionType: input.dimensionType,
                dimensionValue,
              }),
              dimensionType: input.dimensionType,
              dimensionValue,
              metricCode,
              periodFrom,
              periodTo,
              runId,
              tenantId: context.tenantId,
              uom,
              updatedBy: context.accountId,
              value: new Prisma.Decimal(Number.isFinite(value) ? value : 0),
            },
          });
          metricIds.push(metric.id);
        }
      }
      await this.emit(
        tx,
        runId,
        1,
        'transport.metrics-generated.v1',
        context,
        metadata,
        { dimensionType: input.dimensionType, metricIds, runId },
        'TransportMetricRun',
      );
      return { metricIds, runId, status: 'COMPLETED' as const, version: 1 };
    });
  }

  issueTrackingToken(
    shipmentId: string,
    input: {
      allowPod: boolean;
      audienceSnapshot: Readonly<Record<string, unknown>>;
      expiresAt: string;
      maxViews: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    const expiresAt = this.date(input.expiresAt);
    if (
      expiresAt <= new Date() ||
      !Number.isInteger(input.maxViews) ||
      input.maxViews < 1 ||
      input.maxViews > 1000
    )
      this.invalid('Tracking token expiry or view limit is invalid');
    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: {
          id: shipmentId,
          status: { notIn: ['PLANNED', 'APPROVED', 'REJECTED', 'CANCELLED'] },
          tenantId: context.tenantId,
        },
      });
      if (!shipment)
        throw new AppError(
          'TMS_PUBLIC_TRACKING_SHIPMENT_INVALID',
          'Tendered or later shipment is required',
          409,
        );
      const token = `${randomBytes(24).toString('base64url')}.${randomUUID()}`;
      const access = await tx.trackingAccessToken.create({
        data: {
          allowPod: input.allowPod,
          audienceSnapshot: json(input.audienceSnapshot),
          createdBy: context.accountId,
          expiresAt,
          maxViews: input.maxViews,
          shipmentId,
          tenantId: context.tenantId,
          tokenHash: this.hash(token),
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        access.id,
        access.version,
        'tracking.access-issued.v1',
        context,
        metadata,
        {
          expiresAt: expiresAt.toISOString(),
          shipmentId,
          trackingAccessTokenId: access.id,
        },
        'TrackingAccessToken',
      );
      return {
        expiresAt: expiresAt.toISOString(),
        status: access.status,
        token,
        trackingAccessTokenId: access.id,
        version: access.version,
      };
    });
  }

  revokeTrackingToken(
    id: string,
    input: { expectedVersion: number; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'trackingAccessTokenId');
    if (!input.reason?.trim()) this.invalid('Revocation reason is required');
    return this.prisma.$transaction(async (tx) => {
      const access = await tx.trackingAccessToken.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !access ||
        access.status !== 'ACTIVE' ||
        access.version !== input.expectedVersion
      )
        throw this.conflict('TMS_TRACKING_TOKEN_VERSION_CONFLICT');
      const changed = await tx.trackingAccessToken.update({
        data: {
          revokeReason: input.reason.trim(),
          revokedAt: new Date(),
          status: 'REVOKED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        changed.id,
        changed.version,
        'tracking.access-revoked.v1',
        context,
        metadata,
        { shipmentId: access.shipmentId, trackingAccessTokenId: id },
        'TrackingAccessToken',
      );
      return {
        status: changed.status,
        trackingAccessTokenId: id,
        version: changed.version,
      };
    });
  }

  async publicTracking(token: string, ipAddress?: string) {
    if (!token || token.length < 40)
      throw new AppError(
        'TMS_TRACKING_TOKEN_INVALID',
        'Tracking token is invalid',
        404,
      );
    const tokenHash = this.hash(token);
    const access = await this.prisma.$transaction(async (tx) => {
      const matches = await tx.trackingAccessToken.findMany({
        take: 2,
        where: { tokenHash },
      });
      if (matches.length !== 1)
        throw new AppError(
          'TMS_TRACKING_TOKEN_INVALID',
          'Tracking token is invalid',
          404,
        );
      const current = matches[0]!;
      await this.lock(tx, `${current.tenantId}:${current.id}:public-tracking`);
      const now = new Date();
      const claimed = await tx.trackingAccessToken.updateMany({
        data: {
          lastViewedAt: now,
          updatedBy: current.id,
          version: { increment: 1 },
          viewCount: { increment: 1 },
        },
        where: {
          expiresAt: { gt: now },
          id: current.id,
          status: 'ACTIVE',
          viewCount: { lt: current.maxViews },
        },
      });
      if (!claimed.count) {
        if (current.status === 'ACTIVE')
          await tx.trackingAccessToken.update({
            data: {
              status: 'EXPIRED',
              updatedBy: current.id,
              version: { increment: 1 },
            },
            where: { id: current.id },
          });
        throw new AppError(
          'TMS_TRACKING_TOKEN_EXPIRED',
          'Tracking access expired',
          410,
        );
      }
      const changed = await tx.trackingAccessToken.findUniqueOrThrow({
        where: { id: current.id },
      });
      await tx.publicTrackingAccessLog.create({
        data: {
          accessSequence: changed.viewCount,
          createdBy: current.id,
          ipHash: ipAddress ? this.hash(`${current.id}:${ipAddress}`) : null,
          shipmentId: current.shipmentId,
          tenantId: current.tenantId,
          trackingAccessTokenId: current.id,
          updatedBy: current.id,
        },
      });
      return changed;
    });
    const [shipment, milestones, eta, map, exceptions, pod] = await Promise.all(
      [
        this.prisma.shipment.findUniqueOrThrow({
          where: { id: access.shipmentId },
        }),
        this.prisma.shipmentMilestone.findMany({
          orderBy: { sequence: 'asc' },
          where: { shipmentId: access.shipmentId, tenantId: access.tenantId },
        }),
        this.prisma.etaPrediction.findFirst({
          orderBy: { calculatedAt: 'desc' },
          where: {
            shipmentId: access.shipmentId,
            status: 'ACTIVE',
            tenantId: access.tenantId,
          },
        }),
        this.prisma.shipmentMapProjection.findFirst({
          where: { shipmentId: access.shipmentId, tenantId: access.tenantId },
        }),
        this.prisma.transportException.findMany({
          where: {
            shipmentId: access.shipmentId,
            status: { in: [...activeExceptionStatuses] },
            tenantId: access.tenantId,
          },
        }),
        this.prisma.proofOfDelivery.findFirst({
          where: {
            shipmentId: access.shipmentId,
            status: 'CONFIRMED',
            tenantId: access.tenantId,
          },
        }),
      ],
    );
    const position = record(map?.positionSnapshot);
    return toHttpJson({
      destination: this.publicLocation(shipment.destinationSnapshot),
      eta: eta
        ? { confidence: eta.confidence, predictedAt: eta.predictedAt }
        : null,
      exceptions: exceptions.map(({ severity, type }) => ({ severity, type })),
      map:
        position.latitude && position.longitude
          ? {
              latitude: this.blurCoordinate(position.latitude),
              longitude: this.blurCoordinate(position.longitude),
              precision: 'CITY_LEVEL',
              recordedAt: position.recordedAt ?? null,
            }
          : null,
      milestones: milestones.map(
        ({
          actualAt,
          code,
          locationSnapshot,
          plannedAt,
          sequence,
          status,
        }) => ({
          actualAt,
          code,
          location: this.publicLocation(locationSnapshot),
          plannedAt,
          sequence,
          status,
        }),
      ),
      origin: this.publicLocation(shipment.originSnapshot),
      pod: {
        access: access.allowPod && pod ? 'METADATA_ONLY' : 'DENIED',
        confirmed: Boolean(pod),
        pageCount: access.allowPod ? (pod?.pageCount ?? 0) : 0,
      },
      shipmentNo: shipment.shipmentNo,
      status: shipment.status,
      viewLimit: { max: access.maxViews, used: access.viewCount },
    });
  }

  private telemetryThreshold(
    shipment: {
      temperatureMax: Prisma.Decimal | null;
      temperatureMin: Prisma.Decimal | null;
    },
    input: { metricType: string; thresholdMax?: string; thresholdMin?: string },
  ) {
    return {
      maximum:
        input.metricType === 'TEMPERATURE'
          ? (shipment.temperatureMax?.toString() ?? null)
          : (input.thresholdMax ?? null),
      minimum:
        input.metricType === 'TEMPERATURE'
          ? (shipment.temperatureMin?.toString() ?? null)
          : (input.thresholdMin ?? null),
    };
  }
  private exceedsThreshold(
    input: {
      metricType: string;
      payloadSnapshot: Readonly<Record<string, unknown>>;
    },
    value: Prisma.Decimal | null,
    threshold: { maximum: string | null; minimum: string | null },
  ) {
    if (value) {
      if (threshold.minimum && value.lessThan(threshold.minimum)) return true;
      if (threshold.maximum && value.greaterThan(threshold.maximum))
        return true;
    }
    return (
      ['DOOR', 'DEVICE_ALERT'].includes(input.metricType) &&
      (input.payloadSnapshot.alert === true ||
        input.payloadSnapshot.open === true)
    );
  }
  private rate(numerator: number, denominator: number) {
    return denominator ? (numerator / denominator) * 100 : 0;
  }
  private average(values: number[]) {
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  }
  private publicLocation(value: unknown) {
    const location = record(value);
    return {
      city: location.city ?? null,
      countryCode: location.countryCode ?? null,
      region: location.region ?? location.province ?? null,
    };
  }
  private blurCoordinate(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
  }
  private canonical(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonical(item)).join(',')}]`;
    if (value && typeof value === 'object')
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.canonical(item)}`)
        .join(',')}}`;
    return JSON.stringify(value);
  }
  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
  }
  private uuid(value: string, field: string) {
    if (!isUuid(value)) this.invalid(`${field} is invalid`);
  }
  private date(value: string) {
    const result = new Date(value);
    if (!value || Number.isNaN(result.getTime()))
      this.invalid('Date is invalid');
    return result;
  }
  private decimal(value: string, signed = false) {
    try {
      const result = new Prisma.Decimal(value);
      if (!result.isFinite() || (!signed && result.isNegative()))
        throw new Error();
      return result;
    } catch {
      this.invalid('Decimal value is invalid');
    }
  }
  private nonNegative(value: string) {
    return this.decimal(value);
  }
  private invalid(message: string): never {
    throw new AppError('TMS_FLEET_INSIGHTS_INPUT_INVALID', message, 400);
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
    aggregateType: string,
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
          resourceType: aggregateType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType,
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
