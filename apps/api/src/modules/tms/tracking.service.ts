import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

interface OfflineCommand {
  commandType:
    | 'NAVIGATION_STARTED'
    | 'CHECK_IN'
    | 'PHOTO'
    | 'SCAN'
    | 'EXCEPTION'
    | 'SIGNATURE'
    | 'MILESTONE';
  deviceSequence: number;
  payload: Readonly<Record<string, unknown>>;
}

@Injectable()
export class TrackingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async workbench(context: TenantContext) {
    const query = {
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: 300,
      where: { tenantId: context.tenantId },
    };
    const [
      plans,
      milestones,
      driverTasks,
      trackingEvents,
      offlineCommands,
      positionPoints,
      trackSegments,
      geofenceEvents,
      etaPredictions,
      shipments,
      assignments,
    ] = await Promise.all([
      this.prisma.milestonePlan.findMany(query),
      this.prisma.shipmentMilestone.findMany(query),
      this.prisma.driverTask.findMany(query),
      this.prisma.trackingEvent.findMany(query),
      this.prisma.driverOfflineCommand.findMany(query),
      this.prisma.positionPoint.findMany(query),
      this.prisma.trackSegment.findMany(query),
      this.prisma.geofenceEvent.findMany(query),
      this.prisma.etaPrediction.findMany(query),
      this.prisma.shipment.findMany(query),
      this.prisma.vehicleAssignment.findMany(query),
    ]);
    return toHttpJson({
      assignments,
      driverTasks,
      etaPredictions,
      geofenceEvents,
      milestones,
      offlineCommands,
      plans,
      positionPoints,
      shipments,
      trackSegments,
      trackingEvents,
    });
  }

  createMilestonePlan(
    shipmentId: string,
    input: {
      milestones: readonly {
        code: string;
        locationSnapshot: Readonly<Record<string, unknown>>;
        mandatory: boolean;
        plannedAt: string;
        requirementSnapshot: Readonly<Record<string, unknown>>;
        type: string;
      }[];
      templateSnapshot: Readonly<Record<string, unknown>>;
      timeZone: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    if (input.milestones.length < 2 || !input.timeZone?.trim())
      this.invalid('At least two milestones and a time zone are required');
    const milestones = input.milestones.map((row, index) => ({
      ...row,
      code: row.code?.trim().toUpperCase(),
      plannedAt: this.date(row.plannedAt),
      sequence: index + 1,
      type: row.type?.trim().toUpperCase(),
    }));
    if (
      milestones.some(
        (row, index) =>
          !row.code ||
          !row.type ||
          (index > 0 && row.plannedAt <= milestones[index - 1]!.plannedAt),
      ) ||
      new Set(milestones.map(({ code }) => code)).size !== milestones.length
    )
      this.invalid(
        'Milestone codes and planned times must be unique and ordered',
      );
    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: {
          id: shipmentId,
          status: { in: ['DISPATCHED', 'TRACKING'] },
          tenantId: context.tenantId,
        },
      });
      if (!shipment)
        throw new AppError(
          'TMS_MILESTONE_SHIPMENT_INVALID',
          'Dispatched or tracking shipment is required',
          409,
        );
      if (
        await tx.milestonePlan.count({
          where: { shipmentId, status: 'ACTIVE', tenantId: context.tenantId },
        })
      )
        throw this.conflict('TMS_MILESTONE_PLAN_EXISTS');
      const id = randomUUID();
      const plan = await tx.milestonePlan.create({
        data: {
          createdBy: context.accountId,
          id,
          planNo: `MP-${Date.now()}-${id.slice(0, 6)}`,
          shipmentId,
          templateSnapshot: json(input.templateSnapshot),
          tenantId: context.tenantId,
          timeZone: input.timeZone.trim(),
          updatedBy: context.accountId,
        },
      });
      for (const row of milestones)
        await tx.shipmentMilestone.create({
          data: {
            code: row.code,
            createdBy: context.accountId,
            locationSnapshot: json(row.locationSnapshot),
            mandatory: row.mandatory,
            milestonePlanId: plan.id,
            plannedAt: row.plannedAt,
            requirementSnapshot: json(row.requirementSnapshot),
            sequence: row.sequence,
            shipmentId,
            tenantId: context.tenantId,
            type: row.type,
            updatedBy: context.accountId,
          },
        });
      await this.emit(
        tx,
        plan.id,
        plan.version,
        'shipment.milestone-plan-created.v1',
        context,
        metadata,
        {
          milestoneCount: milestones.length,
          milestonePlanId: plan.id,
          shipmentId,
        },
        'MilestonePlan',
      );
      return {
        milestonePlanId: plan.id,
        status: plan.status,
        version: plan.version,
      };
    });
  }

  createDriverTask(
    assignmentId: string,
    input: {
      deviceId: string;
      deviceSnapshot: Readonly<Record<string, unknown>>;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(assignmentId, 'vehicleAssignmentId');
    if (!input.deviceId?.trim()) this.invalid('Bound device is required');
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.vehicleAssignment.findFirst({
        where: {
          id: assignmentId,
          status: 'DISPATCHED',
          tenantId: context.tenantId,
        },
      });
      if (!assignment)
        throw new AppError(
          'TMS_DRIVER_TASK_ASSIGNMENT_INVALID',
          'Dispatched assignment is required',
          409,
        );
      const plan = await tx.milestonePlan.findFirst({
        where: {
          shipmentId: assignment.shipmentId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      if (!plan)
        throw new AppError(
          'TMS_DRIVER_TASK_PLAN_REQUIRED',
          'Active milestone plan is required',
          409,
        );
      const id = randomUUID();
      const task = await tx.driverTask.create({
        data: {
          createdBy: context.accountId,
          deviceId: input.deviceId.trim(),
          deviceSnapshot: json(input.deviceSnapshot),
          driverRef: assignment.driverRef,
          id,
          milestonePlanId: plan.id,
          shipmentId: assignment.shipmentId,
          taskNo: `DT-${Date.now()}-${id.slice(0, 6)}`,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          vehicleAssignmentId: assignment.id,
        },
      });
      await this.emit(
        tx,
        task.id,
        task.version,
        'shipment.driver-task-assigned.v1',
        context,
        metadata,
        {
          driverTaskId: task.id,
          driverRef: task.driverRef,
          shipmentId: task.shipmentId,
        },
        'DriverTask',
      );
      return {
        driverTaskId: task.id,
        status: task.status,
        version: task.version,
      };
    });
  }

  acceptTask(
    id: string,
    input: { deviceId: string; expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'driverTaskId');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.driverTask.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !task ||
        task.status !== 'ASSIGNED' ||
        task.version !== input.expectedVersion ||
        task.deviceId !== input.deviceId
      )
        throw this.conflict('TMS_DRIVER_TASK_ACCEPT_CONFLICT');
      const changed = await tx.driverTask.update({
        data: {
          acceptedAt: new Date(),
          status: 'ACCEPTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        changed.id,
        changed.version,
        'shipment.driver-task-accepted.v1',
        context,
        metadata,
        { driverTaskId: id, shipmentId: task.shipmentId },
        'DriverTask',
      );
      return {
        driverTaskId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  syncOffline(
    id: string,
    input: {
      commands: readonly OfflineCommand[];
      deviceId: string;
      expectedVersion: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'driverTaskId');
    if (!input.commands.length) this.invalid('Offline command batch is empty');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.driverTask.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !task ||
        !['ACCEPTED', 'IN_PROGRESS'].includes(task.status) ||
        task.version !== input.expectedVersion ||
        task.deviceId !== input.deviceId
      )
        throw this.conflict('TMS_OFFLINE_TASK_CONFLICT');
      let nextSequence = task.lastOfflineSequence + 1;
      let milestoneSequence = task.currentMilestoneSequence;
      const results: unknown[] = [];
      for (const command of [...input.commands].sort(
        (a, b) => a.deviceSequence - b.deviceSequence,
      )) {
        const hash = this.hash(command);
        const existing = await tx.driverOfflineCommand.findUnique({
          where: {
            tenantId_deviceId_deviceSequence: {
              deviceId: input.deviceId,
              deviceSequence: command.deviceSequence,
              tenantId: context.tenantId,
            },
          },
        });
        if (existing) {
          if (existing.contentHash !== hash)
            throw new AppError(
              'TMS_OFFLINE_SEQUENCE_CONFLICT',
              'Device sequence was reused with different content',
              409,
            );
          results.push(existing.result);
          continue;
        }
        if (command.deviceSequence !== nextSequence)
          throw new AppError(
            'TMS_OFFLINE_SEQUENCE_GAP',
            'Offline commands must be continuous and ordered',
            409,
            { retryable: true },
          );
        const occurredAt = this.date(String(command.payload.occurredAt ?? ''));
        let milestoneId: string | null = null;
        if (command.commandType === 'MILESTONE') {
          milestoneId = String(command.payload.milestoneId ?? '');
          this.uuid(milestoneId, 'milestoneId');
          const milestone = await tx.shipmentMilestone.findFirst({
            where: {
              id: milestoneId,
              milestonePlanId: task.milestonePlanId,
              status: 'PLANNED',
              tenantId: context.tenantId,
            },
          });
          if (!milestone) throw this.conflict('TMS_MILESTONE_STATE_CONFLICT');
          const blocker = await tx.shipmentMilestone.count({
            where: {
              mandatory: true,
              milestonePlanId: task.milestonePlanId,
              sequence: { lt: milestone.sequence },
              status: 'PLANNED',
              tenantId: context.tenantId,
            },
          });
          const previous = await tx.shipmentMilestone.findFirst({
            orderBy: { sequence: 'desc' },
            where: {
              milestonePlanId: task.milestonePlanId,
              sequence: { lt: milestone.sequence },
              status: 'COMPLETED',
              tenantId: context.tenantId,
            },
          });
          if (
            blocker ||
            (previous?.actualAt && occurredAt <= previous.actualAt)
          )
            throw new AppError(
              'TMS_MILESTONE_ORDER_INVALID',
              'Mandatory milestones cannot be skipped and actual times must increase',
              409,
            );
          milestoneSequence = milestone.sequence;
        }
        const eventId = randomUUID();
        const event = await tx.trackingEvent.create({
          data: {
            createdBy: context.accountId,
            deviceId: input.deviceId,
            deviceSequence: command.deviceSequence,
            driverTaskId: task.id,
            eventNo: `TE-${Date.now()}-${eventId.slice(0, 6)}`,
            eventType: command.commandType,
            evidenceSnapshot: json(command.payload.evidenceSnapshot),
            id: eventId,
            locationSnapshot: json(command.payload.locationSnapshot),
            milestoneId,
            occurredAt,
            shipmentId: task.shipmentId,
            source: 'DRIVER_OFFLINE_SYNC',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        if (milestoneId)
          await tx.shipmentMilestone.update({
            data: {
              actualAt: occurredAt,
              actualSource: 'DRIVER',
              status: 'COMPLETED',
              trackingEventId: event.id,
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: milestoneId },
          });
        const result = { eventId: event.id, status: event.status };
        await tx.driverOfflineCommand.create({
          data: {
            commandType: command.commandType,
            contentHash: hash,
            createdBy: context.accountId,
            deviceId: input.deviceId,
            deviceSequence: command.deviceSequence,
            driverTaskId: task.id,
            payload: json(command.payload),
            result: json(result),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        results.push(result);
        nextSequence += 1;
      }
      const lastSequence = nextSequence - 1;
      const changed = await tx.driverTask.update({
        data: {
          currentMilestoneSequence: milestoneSequence,
          lastOfflineSequence: lastSequence,
          startedAt: task.startedAt ?? new Date(),
          status: 'IN_PROGRESS',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: task.id },
      });
      await this.emit(
        tx,
        changed.id,
        changed.version,
        'tracking.event.v1',
        context,
        metadata,
        {
          driverTaskId: task.id,
          shipmentId: task.shipmentId,
          syncedThrough: lastSequence,
        },
        'DriverTask',
      );
      return {
        driverTaskId: task.id,
        results,
        status: changed.status,
        syncedThrough: lastSequence,
        version: changed.version,
      };
    });
  }

  ingestPosition(
    shipmentId: string,
    input: {
      accuracyMeters: string;
      headingDegrees?: string;
      latitude: string;
      longitude: string;
      rawSnapshot: Readonly<Record<string, unknown>>;
      recordedAt: string;
      source: 'GPS' | 'MOBILE' | 'EDI';
      sourceEventId: string;
      speedKph?: string;
      vehicleAssignmentId: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    this.uuid(input.vehicleAssignmentId, 'vehicleAssignmentId');
    const latitude = this.decimal(input.latitude);
    const longitude = this.decimal(input.longitude);
    const accuracy = this.decimal(input.accuracyMeters);
    const recordedAt = this.date(input.recordedAt);
    if (
      !input.sourceEventId?.trim() ||
      latitude.abs().greaterThan(90) ||
      longitude.abs().greaterThan(180) ||
      accuracy.isNegative()
    )
      this.invalid('Position input is invalid');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.positionPoint.findUnique({
        where: {
          tenantId_source_sourceEventId: {
            source: input.source,
            sourceEventId: input.sourceEventId,
            tenantId: context.tenantId,
          },
        },
      });
      if (existing) {
        if (this.hash(existing.rawSnapshot) !== this.hash(input.rawSnapshot))
          throw new AppError(
            'TMS_POSITION_REPLAY_CONFLICT',
            'Source event was reused with different content',
            409,
          );
        return {
          positionPointId: existing.id,
          replayed: true,
          status: existing.status,
          version: existing.version,
        };
      }
      const assignment = await tx.vehicleAssignment.findFirst({
        where: {
          id: input.vehicleAssignmentId,
          shipmentId,
          status: 'DISPATCHED',
          tenantId: context.tenantId,
        },
      });
      if (!assignment)
        throw new AppError(
          'TMS_POSITION_ASSIGNMENT_INVALID',
          'Active dispatched assignment is required',
          409,
        );
      const previous = await tx.positionPoint.findFirst({
        orderBy: { recordedAt: 'desc' },
        where: { shipmentId, status: 'ACCEPTED', tenantId: context.tenantId },
      });
      const distance = previous
        ? this.distance(
            Number(previous.latitude),
            Number(previous.longitude),
            latitude.toNumber(),
            longitude.toNumber(),
          )
        : 0;
      const seconds = previous
        ? (recordedAt.getTime() - previous.recordedAt.getTime()) / 1000
        : 0;
      const calculatedSpeed = seconds > 0 ? (distance / seconds) * 3.6 : 0;
      let rejectionReason: string | null = null;
      if (accuracy.greaterThan(1000)) rejectionReason = 'ACCURACY_TOO_LOW';
      else if (previous && seconds <= 0) rejectionReason = 'NON_MONOTONIC_TIME';
      else if (previous && distance < 5 && seconds < 60)
        rejectionReason = 'DUPLICATE_POINT';
      else if (
        calculatedSpeed > 250 ||
        (input.speedKph && this.decimal(input.speedKph).greaterThan(250))
      )
        rejectionReason = 'POSITION_DRIFT';
      const point = await tx.positionPoint.create({
        data: {
          accuracyMeters: accuracy,
          createdBy: context.accountId,
          headingDegrees: input.headingDegrees
            ? this.decimal(input.headingDegrees)
            : null,
          latitude,
          longitude,
          rawSnapshot: json(input.rawSnapshot),
          recordedAt,
          rejectionReason,
          shipmentId,
          source: input.source,
          sourceEventId: input.sourceEventId.trim(),
          speedKph: input.speedKph ? this.decimal(input.speedKph) : null,
          status: rejectionReason ? 'REJECTED' : 'ACCEPTED',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          vehicleAssignmentId: assignment.id,
        },
      });
      if (!rejectionReason && previous)
        await tx.trackSegment.create({
          data: {
            calculationSnapshot: json({
              formula: 'HAVERSINE',
              calculatedSpeed,
            }),
            createdBy: context.accountId,
            distanceMeters: distance,
            durationSeconds: Math.round(seconds),
            endedAt: recordedAt,
            fromPositionPointId: previous.id,
            shipmentId,
            startedAt: previous.recordedAt,
            tenantId: context.tenantId,
            toPositionPointId: point.id,
            updatedBy: context.accountId,
          },
        });
      if (!rejectionReason)
        await this.evaluateGeofences(tx, point, previous, context);
      await this.emit(
        tx,
        point.id,
        point.version,
        'tracking.position-received.v1',
        context,
        metadata,
        { positionPointId: point.id, shipmentId, status: point.status },
        'PositionPoint',
      );
      return {
        positionPointId: point.id,
        replayed: false,
        status: point.status,
        version: point.version,
      };
    });
  }

  predictEta(
    shipmentId: string,
    input: {
      averageSpeedKph: string;
      milestoneId: string;
      trafficFactor: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    this.uuid(input.milestoneId, 'milestoneId');
    const speed = this.decimal(input.averageSpeedKph);
    const traffic = this.decimal(input.trafficFactor);
    if (!speed.greaterThan(0) || !traffic.greaterThan(0))
      this.invalid('ETA factors must be positive');
    return this.prisma.$transaction(async (tx) => {
      const [point, milestone, previous] = await Promise.all([
        tx.positionPoint.findFirst({
          orderBy: { recordedAt: 'desc' },
          where: { shipmentId, status: 'ACCEPTED', tenantId: context.tenantId },
        }),
        tx.shipmentMilestone.findFirst({
          where: {
            id: input.milestoneId,
            shipmentId,
            status: 'PLANNED',
            tenantId: context.tenantId,
          },
        }),
        tx.etaPrediction.findFirst({
          orderBy: { calculatedAt: 'desc' },
          where: { milestoneId: input.milestoneId, tenantId: context.tenantId },
        }),
      ]);
      if (!point || !milestone)
        throw new AppError(
          'TMS_ETA_INPUT_MISSING',
          'Current position and planned milestone are required',
          409,
        );
      const location = record(milestone.locationSnapshot);
      const distance = this.distance(
        Number(point.latitude),
        Number(point.longitude),
        Number(location.latitude),
        Number(location.longitude),
      );
      if (!Number.isFinite(distance))
        this.invalid('Milestone geofence location is invalid');
      const hours = new Prisma.Decimal(distance)
        .div(1000)
        .div(speed)
        .mul(traffic);
      const predictedAt = new Date(
        point.recordedAt.getTime() + hours.mul(3_600_000).toNumber(),
      );
      const changeMinutes = new Prisma.Decimal(
        (predictedAt.getTime() -
          (previous?.predictedAt ?? milestone.plannedAt).getTime()) /
          60_000,
      );
      const significantChange = changeMinutes.abs().greaterThanOrEqualTo(15);
      const confidence = Prisma.Decimal.max(
        '0.5',
        new Prisma.Decimal(1).sub(point.accuracyMeters.div(2000)),
      );
      const prediction = await tx.etaPrediction.create({
        data: {
          algorithmSnapshot: json({
            formula: 'DISTANCE_SPEED_TRAFFIC_V1',
            speedKph: speed.toString(),
            trafficFactor: traffic.toString(),
          }),
          changeMinutes,
          confidence,
          createdBy: context.accountId,
          inputSnapshot: json({
            distanceMeters: distance,
            positionPointId: point.id,
          }),
          milestoneId: milestone.id,
          predictedAt,
          shipmentId,
          significantChange,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      if (significantChange)
        await this.emit(
          tx,
          prediction.id,
          prediction.version,
          'tracking.eta-changed.v1',
          context,
          metadata,
          {
            confidence: confidence.toString(),
            etaPredictionId: prediction.id,
            milestoneId: milestone.id,
            predictedAt: predictedAt.toISOString(),
            shipmentId,
          },
          'EtaPrediction',
        );
      return {
        confidence: confidence.toString(),
        etaPredictionId: prediction.id,
        predictedAt: predictedAt.toISOString(),
        significantChange,
        version: prediction.version,
      };
    });
  }

  private async evaluateGeofences(
    tx: Prisma.TransactionClient,
    point: {
      id: string;
      latitude: Prisma.Decimal;
      longitude: Prisma.Decimal;
      recordedAt: Date;
      shipmentId: string;
    },
    previous: { latitude: Prisma.Decimal; longitude: Prisma.Decimal } | null,
    context: TenantContext,
  ) {
    const milestones = await tx.shipmentMilestone.findMany({
      where: {
        shipmentId: point.shipmentId,
        status: { in: ['PLANNED', 'COMPLETED'] },
        tenantId: context.tenantId,
      },
    });
    for (const milestone of milestones) {
      const location = record(milestone.locationSnapshot);
      const latitude = Number(location.latitude);
      const longitude = Number(location.longitude);
      const radius = Number(location.radiusMeters ?? 200);
      if (![latitude, longitude, radius].every(Number.isFinite)) continue;
      const inside =
        this.distance(
          point.latitude.toNumber(),
          point.longitude.toNumber(),
          latitude,
          longitude,
        ) <= radius;
      const wasInside = previous
        ? this.distance(
            previous.latitude.toNumber(),
            previous.longitude.toNumber(),
            latitude,
            longitude,
          ) <= radius
        : false;
      if (inside === wasInside) continue;
      const eventType = inside ? 'ENTER' : 'EXIT';
      const driverEvent = await tx.trackingEvent.findFirst({
        orderBy: { occurredAt: 'desc' },
        where: {
          milestoneId: milestone.id,
          occurredAt: {
            gte: new Date(point.recordedAt.getTime() - 10 * 60_000),
            lte: new Date(point.recordedAt.getTime() + 10 * 60_000),
          },
          source: { startsWith: 'DRIVER' },
          tenantId: context.tenantId,
        },
      });
      const geofence = await tx.geofenceEvent.create({
        data: {
          conflictReason: driverEvent
            ? 'MANUAL_AND_AUTOMATIC_EVENTS_COEXIST'
            : null,
          createdBy: context.accountId,
          driverEventId: driverEvent?.id ?? null,
          eventType,
          geofenceSnapshot: json({ latitude, longitude, radiusMeters: radius }),
          milestoneId: milestone.id,
          occurredAt: point.recordedAt,
          positionPointId: point.id,
          shipmentId: point.shipmentId,
          status: driverEvent ? 'CONFLICT' : 'CANDIDATE',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await tx.trackingEvent.create({
        data: {
          conflictEventId: driverEvent?.id ?? null,
          createdBy: context.accountId,
          eventNo: `TE-GEO-${Date.now()}-${geofence.id.slice(0, 6)}`,
          eventType: `GEOFENCE_${eventType}`,
          evidenceSnapshot: json({ geofenceEventId: geofence.id }),
          locationSnapshot: json({
            latitude: point.latitude.toString(),
            longitude: point.longitude.toString(),
          }),
          milestoneId: milestone.id,
          occurredAt: point.recordedAt,
          shipmentId: point.shipmentId,
          source: 'GEOFENCE',
          status: driverEvent ? 'CONFLICT' : 'CANDIDATE',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
    }
  }

  private distance(lat1: number, lon1: number, lat2: number, lon2: number) {
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.NaN;
    const radians = (value: number) => (value * Math.PI) / 180;
    const a =
      Math.sin(radians(lat2 - lat1) / 2) ** 2 +
      Math.cos(radians(lat1)) *
        Math.cos(radians(lat2)) *
        Math.sin(radians(lon2 - lon1) / 2) ** 2;
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  private hash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  private decimal(value: unknown) {
    try {
      const result = new Prisma.Decimal(String(value));
      if (!result.isFinite()) throw new Error();
      return result;
    } catch {
      this.invalid('Decimal value is invalid');
    }
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
    throw new AppError('TMS_TRACKING_INPUT_INVALID', message, 400);
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
    aggregateType = 'Shipment',
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
