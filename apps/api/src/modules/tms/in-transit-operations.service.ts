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
const activeExceptionStatuses = [
  'OPEN',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
] as const;

type ExceptionType =
  | 'DELAY'
  | 'ROUTE_DEVIATION'
  | 'LONG_STOP'
  | 'TEMPERATURE'
  | 'DAMAGE'
  | 'REFUSAL'
  | 'COMPLIANCE'
  | 'COMMUNICATION_LOSS';
type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

@Injectable()
export class InTransitOperationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async workbench(context: TenantContext) {
    const query = {
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: 300,
      where: { tenantId: context.tenantId },
    };
    const [
      maps,
      exceptions,
      actions,
      escalations,
      appointmentLinks,
      shipments,
      milestones,
    ] = await Promise.all([
      this.prisma.shipmentMapProjection.findMany(query),
      this.prisma.transportException.findMany(query),
      this.prisma.exceptionAction.findMany(query),
      this.prisma.escalation.findMany(query),
      this.prisma.shipmentAppointmentLink.findMany(query),
      this.prisma.shipment.findMany({
        ...query,
        where: {
          status: { in: ['DISPATCHED', 'TRACKING', 'DELIVERED'] },
          tenantId: context.tenantId,
        },
      }),
      this.prisma.shipmentMilestone.findMany(query),
    ]);
    return toHttpJson({
      actions,
      appointmentLinks,
      escalations,
      exceptions,
      maps: maps.map((map) => this.visibleMap(map, false)),
      milestones,
      shipments,
    });
  }

  async preciseMap(shipmentId: string, context: TenantContext) {
    this.uuid(shipmentId, 'shipmentId');
    const map = await this.prisma.shipmentMapProjection.findFirst({
      where: { shipmentId, tenantId: context.tenantId },
    });
    if (!map)
      throw new AppError('TMS_MAP_NOT_FOUND', 'Map projection not found', 404);
    return toHttpJson(this.visibleMap(map, true));
  }

  refreshMap(
    shipmentId: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: {
          id: shipmentId,
          status: { in: ['DISPATCHED', 'TRACKING', 'DELIVERED'] },
          tenantId: context.tenantId,
        },
      });
      if (!shipment)
        throw new AppError(
          'TMS_MAP_SHIPMENT_INVALID',
          'Dispatched, tracking or delivered shipment is required',
          409,
        );
      const [route, milestones, point, eta, exceptions, assignment] =
        await Promise.all([
          tx.routePlan.findFirst({
            orderBy: { createdAt: 'desc' },
            where: {
              shipmentId,
              status: { in: ['SELECTED', 'OPTIMIZED'] },
              tenantId: context.tenantId,
            },
          }),
          tx.shipmentMilestone.findMany({
            orderBy: { sequence: 'asc' },
            where: { shipmentId, tenantId: context.tenantId },
          }),
          tx.positionPoint.findFirst({
            orderBy: { recordedAt: 'desc' },
            where: {
              shipmentId,
              status: 'ACCEPTED',
              tenantId: context.tenantId,
            },
          }),
          tx.etaPrediction.findFirst({
            orderBy: { calculatedAt: 'desc' },
            where: { shipmentId, status: 'ACTIVE', tenantId: context.tenantId },
          }),
          tx.transportException.findMany({
            where: {
              shipmentId,
              status: { in: [...activeExceptionStatuses] },
              tenantId: context.tenantId,
            },
          }),
          tx.vehicleAssignment.findFirst({
            orderBy: { createdAt: 'desc' },
            where: {
              shipmentId,
              status: 'DISPATCHED',
              tenantId: context.tenantId,
            },
          }),
        ]);
      const stops = route
        ? await tx.routeStop.findMany({
            orderBy: { sequence: 'asc' },
            where: { routePlanId: route.id, tenantId: context.tenantId },
          })
        : [];
      const data = {
        createdBy: context.accountId,
        driverRestrictedSnapshot: json(assignment?.driverSnapshot ?? {}),
        etaSnapshot: json(
          eta
            ? {
                confidence: eta.confidence.toString(),
                milestoneId: eta.milestoneId,
                predictedAt: eta.predictedAt,
                significantChange: eta.significantChange,
              }
            : {},
        ),
        exceptionSnapshot: json(
          exceptions.map(({ id, severity, status, type }) => ({
            id,
            severity,
            status,
            type,
          })),
        ),
        milestoneSnapshot: json(
          milestones.map(
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
              locationSnapshot,
              plannedAt,
              sequence,
              status,
            }),
          ),
        ),
        positionSnapshot: json(
          point
            ? {
                accuracyMeters: point.accuracyMeters.toString(),
                latitude: point.latitude.toString(),
                longitude: point.longitude.toString(),
                recordedAt: point.recordedAt,
                source: point.source,
              }
            : {},
        ),
        projectedAt: new Date(),
        routeSnapshot: json({
          routePlanId: route?.id ?? null,
          stops: stops.map(
            ({
              locationSnapshot,
              plannedArrival,
              sequence,
              stopRef,
              stopType,
            }) => ({
              locationSnapshot,
              plannedArrival,
              sequence,
              stopRef,
              stopType,
            }),
          ),
        }),
        shipmentStatus: shipment.status,
        sourceVersions: json({
          assignment: assignment?.version ?? null,
          eta: eta?.version ?? null,
          position: point?.version ?? null,
          route: route?.version ?? null,
          shipment: shipment.version,
        }),
        updatedBy: context.accountId,
        vehicleSnapshot: json(assignment?.vehicleSnapshot ?? {}),
      };
      const existing = await tx.shipmentMapProjection.findUnique({
        where: {
          tenantId_shipmentId: { shipmentId, tenantId: context.tenantId },
        },
      });
      const projection = existing
        ? await tx.shipmentMapProjection.update({
            data: { ...data, version: { increment: 1 } },
            where: { id: existing.id },
          })
        : await tx.shipmentMapProjection.create({
            data: { ...data, shipmentId, tenantId: context.tenantId },
          });
      await this.emit(
        tx,
        projection.id,
        projection.version,
        'shipment.map-projected.v1',
        context,
        metadata,
        { shipmentId },
        'ShipmentMapProjection',
      );
      return toHttpJson(this.visibleMap(projection, false));
    });
  }

  detectExceptions(
    shipmentId: string,
    input: {
      asOf: string;
      communicationGapMinutes?: number;
      complianceInvalid?: boolean;
      currentTemperature?: string;
      damageReported?: boolean;
      delayMinutes?: number;
      detectedBy: 'SYSTEM' | 'DRIVER' | 'SERVICE';
      refusalReported?: boolean;
      routeDeviationMeters?: number;
      stationaryMinutes?: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    const asOf = this.date(input.asOf);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${shipmentId}:exceptions`);
      const shipment = await tx.shipment.findFirst({
        where: {
          id: shipmentId,
          status: 'TRACKING',
          tenantId: context.tenantId,
        },
      });
      if (!shipment)
        throw new AppError(
          'TMS_EXCEPTION_SHIPMENT_INVALID',
          'Tracking shipment is required',
          409,
        );
      const detections: {
        evidence: Record<string, unknown>;
        severity: Severity;
        type: ExceptionType;
      }[] = [];
      if ((input.delayMinutes ?? 0) >= 15)
        detections.push({
          evidence: { delayMinutes: input.delayMinutes },
          severity: (input.delayMinutes ?? 0) >= 60 ? 'HIGH' : 'MEDIUM',
          type: 'DELAY',
        });
      if ((input.routeDeviationMeters ?? 0) >= 1000)
        detections.push({
          evidence: { routeDeviationMeters: input.routeDeviationMeters },
          severity:
            (input.routeDeviationMeters ?? 0) >= 5000 ? 'HIGH' : 'MEDIUM',
          type: 'ROUTE_DEVIATION',
        });
      if ((input.stationaryMinutes ?? 0) >= 30)
        detections.push({
          evidence: { stationaryMinutes: input.stationaryMinutes },
          severity: (input.stationaryMinutes ?? 0) >= 120 ? 'HIGH' : 'MEDIUM',
          type: 'LONG_STOP',
        });
      if (input.currentTemperature !== undefined) {
        const temperature = this.decimal(input.currentTemperature);
        if (
          (shipment.temperatureMin &&
            temperature.lessThan(shipment.temperatureMin)) ||
          (shipment.temperatureMax &&
            temperature.greaterThan(shipment.temperatureMax))
        )
          detections.push({
            evidence: {
              currentTemperature: temperature.toString(),
              maximum: shipment.temperatureMax?.toString(),
              minimum: shipment.temperatureMin?.toString(),
            },
            severity: 'CRITICAL',
            type: 'TEMPERATURE',
          });
      }
      if (input.damageReported)
        detections.push({
          evidence: { reported: true },
          severity: 'HIGH',
          type: 'DAMAGE',
        });
      if (input.refusalReported)
        detections.push({
          evidence: { reported: true },
          severity: 'HIGH',
          type: 'REFUSAL',
        });
      if (input.complianceInvalid)
        detections.push({
          evidence: { invalid: true },
          severity: 'CRITICAL',
          type: 'COMPLIANCE',
        });
      if ((input.communicationGapMinutes ?? 0) >= 15)
        detections.push({
          evidence: { communicationGapMinutes: input.communicationGapMinutes },
          severity:
            (input.communicationGapMinutes ?? 0) >= 60 ? 'HIGH' : 'MEDIUM',
          type: 'COMMUNICATION_LOSS',
        });
      const results: {
        exceptionId: string;
        replayed: boolean;
        severity: Severity;
        type: ExceptionType;
        version: number;
      }[] = [];
      for (const detection of detections) {
        const dedupeKey = `${shipmentId}:${detection.type}`;
        const existing = await tx.transportException.findFirst({
          where: {
            dedupeKey,
            status: { in: [...activeExceptionStatuses] },
            tenantId: context.tenantId,
          },
        });
        if (existing) {
          results.push({
            exceptionId: existing.id,
            replayed: true,
            severity: existing.severity,
            type: detection.type,
            version: existing.version,
          });
          continue;
        }
        const id = randomUUID();
        const slaMinutes =
          detection.severity === 'CRITICAL'
            ? 15
            : detection.severity === 'HIGH'
              ? 60
              : detection.severity === 'MEDIUM'
                ? 240
                : 480;
        const exception = await tx.transportException.create({
          data: {
            createdBy: context.accountId,
            dedupeKey,
            detectedAt: asOf,
            detectedBy: input.detectedBy,
            evidenceSnapshot: json(detection.evidence),
            exceptionNo: `TEX-${Date.now()}-${id.slice(0, 6)}`,
            financialHold: ['TEMPERATURE', 'DAMAGE', 'REFUSAL'].includes(
              detection.type,
            ),
            id,
            reassignRequested: detection.type === 'COMPLIANCE',
            severity: detection.severity,
            shipmentId,
            slaDueAt: new Date(asOf.getTime() + slaMinutes * 60_000),
            tenantId: context.tenantId,
            type: detection.type,
            updatedBy: context.accountId,
          },
        });
        await this.emit(
          tx,
          exception.id,
          exception.version,
          'alert.opened.v1',
          context,
          metadata,
          {
            alertCaseId: exception.id,
            businessRef: shipmentId,
            dueAt: exception.slaDueAt,
            severity: exception.severity,
            type: exception.type,
          },
          'TransportException',
        );
        results.push({
          exceptionId: exception.id,
          replayed: false,
          severity: exception.severity,
          type: detection.type,
          version: exception.version,
        });
      }
      return { detected: results.length, results };
    });
  }

  actOnException(
    id: string,
    input: {
      actionType: 'ACKNOWLEDGE' | 'PLAN' | 'UPDATE' | 'RESOLVE' | 'CLOSE';
      businessVerified?: boolean;
      customerCommunicatedAt?: string;
      evidenceSnapshot: Readonly<Record<string, unknown>>;
      expectedRecoveryAt?: string;
      expectedVersion: number;
      handlingPlan: string;
      ownerId?: string;
      resolutionSummary?: string;
      rootCause?: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'transportExceptionId');
    if (!input.handlingPlan?.trim()) this.invalid('Handling plan is required');
    if (input.ownerId) this.uuid(input.ownerId, 'ownerId');
    return this.prisma.$transaction(async (tx) => {
      const exception = await tx.transportException.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!exception || exception.version !== input.expectedVersion)
        throw this.conflict('TMS_EXCEPTION_VERSION_CONFLICT');
      const next = this.nextExceptionStatus(exception.status, input.actionType);
      if (
        input.actionType === 'RESOLVE' &&
        (!input.rootCause?.trim() || !input.resolutionSummary?.trim())
      )
        this.invalid('Root cause and resolution summary are required');
      const communicatedAt = input.customerCommunicatedAt
        ? this.date(input.customerCommunicatedAt)
        : exception.customerCommunicatedAt;
      if (
        input.actionType === 'CLOSE' &&
        (!exception.rootCause || !communicatedAt || !input.businessVerified)
      )
        throw new AppError(
          'TMS_EXCEPTION_CLOSE_BLOCKED',
          'Root cause, customer communication and business verification are required',
          409,
        );
      const now = new Date();
      const changed = await tx.transportException.update({
        data: {
          acknowledgedAt:
            next === 'ACKNOWLEDGED' || next === 'IN_PROGRESS'
              ? (exception.acknowledgedAt ?? now)
              : exception.acknowledgedAt,
          businessVerified:
            next === 'CLOSED' ? true : exception.businessVerified,
          closedAt: next === 'CLOSED' ? now : exception.closedAt,
          customerCommunicatedAt: communicatedAt,
          ownerId: input.ownerId ?? exception.ownerId,
          resolutionSummary:
            input.resolutionSummary?.trim() ?? exception.resolutionSummary,
          resolvedAt: next === 'RESOLVED' ? now : exception.resolvedAt,
          rootCause: input.rootCause?.trim() ?? exception.rootCause,
          status: next,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const action = await tx.exceptionAction.create({
        data: {
          actionType: input.actionType,
          createdBy: context.accountId,
          evidenceSnapshot: json(input.evidenceSnapshot),
          expectedRecoveryAt: input.expectedRecoveryAt
            ? this.date(input.expectedRecoveryAt)
            : null,
          fromStatus: exception.status,
          handlingPlan: input.handlingPlan.trim(),
          ownerId: input.ownerId ?? exception.ownerId,
          rootCause: input.rootCause?.trim() ?? null,
          tenantId: context.tenantId,
          toStatus: next,
          transportExceptionId: id,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        changed.id,
        changed.version,
        `shipment.exception-${input.actionType.toLowerCase()}.v1`,
        context,
        metadata,
        {
          actionId: action.id,
          shipmentId: changed.shipmentId,
          status: changed.status,
        },
        'TransportException',
      );
      return {
        actionId: action.id,
        exceptionId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  escalateDue(
    input: { asOf: string; toOwnerId: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.toOwnerId, 'toOwnerId');
    const asOf = this.date(input.asOf);
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.transportException.findMany({
        orderBy: [{ slaDueAt: 'asc' }, { id: 'asc' }],
        take: 100,
        where: {
          slaDueAt: { lte: asOf },
          status: { in: [...activeExceptionStatuses] },
          tenantId: context.tenantId,
        },
      });
      const escalationIds: string[] = [];
      for (const exception of due) {
        await this.lock(tx, `${context.tenantId}:${exception.id}:escalation`);
        const level =
          (await tx.escalation.count({
            where: {
              tenantId: context.tenantId,
              transportExceptionId: exception.id,
            },
          })) + 1;
        const escalation = await tx.escalation.create({
          data: {
            createdBy: context.accountId,
            dueAt: new Date(asOf.getTime() + 30 * 60_000),
            fromOwnerId: exception.ownerId,
            level,
            reason: `Exception SLA exceeded at ${asOf.toISOString()}`,
            tenantId: context.tenantId,
            toOwnerId: input.toOwnerId,
            transportExceptionId: exception.id,
            updatedBy: context.accountId,
          },
        });
        await tx.transportException.update({
          data: {
            ownerId: input.toOwnerId,
            slaDueAt: escalation.dueAt,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: exception.id },
        });
        await this.emit(
          tx,
          escalation.id,
          escalation.version,
          'shipment.exception-escalated.v1',
          context,
          metadata,
          {
            exceptionId: exception.id,
            level,
            shipmentId: exception.shipmentId,
          },
          'Escalation',
        );
        escalationIds.push(escalation.id);
      }
      return { escalated: escalationIds.length, escalationIds };
    });
  }

  requestAppointment(
    shipmentId: string,
    input: {
      milestoneId: string;
      plannedAt: string;
      siteRequirementSnapshot: Readonly<Record<string, unknown>>;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    this.uuid(input.milestoneId, 'milestoneId');
    const plannedAt = this.date(input.plannedAt);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${shipmentId}:appointment`);
      const [shipment, milestone] = await Promise.all([
        tx.shipment.findFirst({
          where: {
            id: shipmentId,
            status: { in: ['DISPATCHED', 'TRACKING'] },
            tenantId: context.tenantId,
          },
        }),
        tx.shipmentMilestone.findFirst({
          where: {
            id: input.milestoneId,
            shipmentId,
            status: 'PLANNED',
            tenantId: context.tenantId,
          },
        }),
      ]);
      if (!shipment || !milestone)
        throw new AppError(
          'TMS_APPOINTMENT_MILESTONE_INVALID',
          'Dispatched or tracking shipment with a planned milestone is required',
          409,
        );
      const id = randomUUID();
      const requestRef = `AMS-REQ-${Date.now()}-${id.slice(0, 6)}`;
      const link = await tx.shipmentAppointmentLink.create({
        data: {
          createdBy: context.accountId,
          id,
          milestoneId: milestone.id,
          plannedAt,
          requestRef,
          shipmentId,
          siteRequirementSnapshot: json(input.siteRequirementSnapshot),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await this.emit(
        tx,
        link.id,
        link.version,
        'appointment.requested.v1',
        context,
        metadata,
        {
          milestoneId: milestone.id,
          plannedAt,
          requestRef,
          shipmentId,
          siteRequirementSnapshot: json(input.siteRequirementSnapshot),
        },
        'ShipmentAppointmentLink',
      );
      return {
        appointmentLinkId: link.id,
        requestRef,
        status: link.status,
        version: link.version,
      };
    });
  }

  requestAppointmentChange(
    id: string,
    input: {
      expectedVersion: number;
      plannedAt?: string;
      reason: string;
      type: 'RESCHEDULE' | 'CANCEL';
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'appointmentLinkId');
    if (
      !input.reason?.trim() ||
      (input.type === 'RESCHEDULE' && !input.plannedAt)
    )
      this.invalid(
        'Appointment change reason and reschedule time are required',
      );
    return this.prisma.$transaction(async (tx) => {
      const link = await tx.shipmentAppointmentLink.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !link ||
        link.status !== 'LINKED' ||
        link.version !== input.expectedVersion
      )
        throw this.conflict('TMS_APPOINTMENT_CHANGE_CONFLICT');
      const plannedAt = input.plannedAt
        ? this.date(input.plannedAt)
        : link.plannedAt;
      const status =
        input.type === 'RESCHEDULE'
          ? 'RESCHEDULE_REQUESTED'
          : 'CANCELLATION_REQUESTED';
      const changed = await tx.shipmentAppointmentLink.update({
        data: {
          plannedAt,
          status,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      await this.emit(
        tx,
        changed.id,
        changed.version,
        `appointment.${input.type.toLowerCase()}-requested.v1`,
        context,
        metadata,
        {
          appointmentRef: link.appointmentRef,
          linkId: id,
          plannedAt,
          reason: input.reason.trim(),
          requestRef: link.requestRef,
        },
        'ShipmentAppointmentLink',
      );
      return {
        appointmentLinkId: id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  applyAppointmentEvent(
    id: string,
    input: {
      appointmentRef: string;
      appointmentSnapshot: Readonly<Record<string, unknown>>;
      eventType: 'CONFIRMED' | 'RESCHEDULED' | 'CANCELLED';
      plannedAt: string;
      sourceVersion: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'appointmentLinkId');
    if (
      !input.appointmentRef?.trim() ||
      !Number.isInteger(input.sourceVersion) ||
      input.sourceVersion < 1
    )
      this.invalid('Appointment event identity and version are required');
    const plannedAt = this.date(input.plannedAt);
    return this.prisma.$transaction(async (tx) => {
      const link = await tx.shipmentAppointmentLink.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!link)
        throw new AppError(
          'TMS_APPOINTMENT_LINK_NOT_FOUND',
          'Appointment link not found',
          404,
        );
      if (link.sourceVersion && input.sourceVersion <= link.sourceVersion) {
        if (
          input.sourceVersion === link.sourceVersion &&
          link.appointmentRef === input.appointmentRef &&
          this.hash(link.appointmentSnapshot) ===
            this.hash(input.appointmentSnapshot)
        )
          return {
            appointmentLinkId: id,
            replayed: true,
            status: link.status,
            version: link.version,
          };
        throw new AppError(
          'TMS_APPOINTMENT_EVENT_STALE',
          'Old or conflicting appointment event',
          409,
        );
      }
      const allowedStatuses = {
        CANCELLED: ['CANCELLATION_REQUESTED', 'LINKED'],
        CONFIRMED: ['REQUESTED', 'FAILED'],
        RESCHEDULED: ['RESCHEDULE_REQUESTED'],
      } as const;
      if (!allowedStatuses[input.eventType].includes(link.status as never))
        throw new AppError(
          'TMS_APPOINTMENT_EVENT_STATE_INVALID',
          `Cannot apply ${input.eventType} from ${link.status}`,
          409,
        );
      const previousMilestone =
        input.eventType === 'RESCHEDULED'
          ? await this.validateMilestoneTime(
              tx,
              link.milestoneId,
              plannedAt,
              context.tenantId,
            )
          : null;
      const status = input.eventType === 'CANCELLED' ? 'CANCELLED' : 'LINKED';
      const changed = await tx.shipmentAppointmentLink.update({
        data: {
          appointmentRef: input.appointmentRef.trim(),
          appointmentSnapshot: json(input.appointmentSnapshot),
          cancelledAt: status === 'CANCELLED' ? new Date() : null,
          linkedAt: status === 'LINKED' ? new Date() : link.linkedAt,
          plannedAt,
          sourceVersion: input.sourceVersion,
          status,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      if (input.eventType === 'RESCHEDULED') {
        const milestone = await tx.shipmentMilestone.update({
          data: {
            plannedAt,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: link.milestoneId },
        });
        const previousEta = await tx.etaPrediction.findFirst({
          orderBy: { calculatedAt: 'desc' },
          where: { milestoneId: milestone.id, tenantId: context.tenantId },
        });
        await tx.etaPrediction.create({
          data: {
            algorithmSnapshot: json({ source: 'AMS_APPOINTMENT_RESCHEDULE' }),
            changeMinutes: new Prisma.Decimal(
              (plannedAt.getTime() -
                (
                  previousEta?.predictedAt ?? previousMilestone!.plannedAt
                ).getTime()) /
                60_000,
            ),
            confidence: new Prisma.Decimal('0.95'),
            createdBy: context.accountId,
            inputSnapshot: json({
              appointmentLinkId: link.id,
              sourceVersion: input.sourceVersion,
            }),
            milestoneId: milestone.id,
            predictedAt: plannedAt,
            shipmentId: link.shipmentId,
            significantChange: true,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      await this.emit(
        tx,
        changed.id,
        changed.version,
        `appointment.${input.eventType.toLowerCase()}.v1`,
        context,
        metadata,
        {
          appointmentRef: changed.appointmentRef,
          linkId: id,
          plannedAt,
          shipmentId: link.shipmentId,
          sourceVersion: input.sourceVersion,
        },
        'ShipmentAppointmentLink',
      );
      return {
        appointmentLinkId: id,
        replayed: false,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  private visibleMap(
    map: {
      driverRestrictedSnapshot: unknown;
      positionSnapshot: unknown;
      [key: string]: unknown;
    },
    precise: boolean,
  ) {
    const position = record(map.positionSnapshot);
    const latitude = Number(position.latitude);
    const longitude = Number(position.longitude);
    return {
      ...map,
      driverRestrictedSnapshot: undefined,
      positionSnapshot:
        Number.isFinite(latitude) && Number.isFinite(longitude)
          ? {
              ...position,
              latitude: precise ? latitude : Number(latitude.toFixed(2)),
              longitude: precise ? longitude : Number(longitude.toFixed(2)),
              precision: precise ? 'EXACT' : 'COARSE',
            }
          : { precision: precise ? 'EXACT' : 'COARSE' },
    };
  }
  private nextExceptionStatus(current: string, action: string) {
    const transitions: Record<string, Record<string, string>> = {
      OPEN: { ACKNOWLEDGE: 'ACKNOWLEDGED' },
      ACKNOWLEDGED: {
        PLAN: 'IN_PROGRESS',
        RESOLVE: 'RESOLVED',
        UPDATE: 'IN_PROGRESS',
      },
      IN_PROGRESS: { RESOLVE: 'RESOLVED', UPDATE: 'IN_PROGRESS' },
      RESOLVED: { CLOSE: 'CLOSED' },
    };
    const next = transitions[current]?.[action];
    if (!next)
      throw new AppError(
        'TMS_EXCEPTION_TRANSITION_INVALID',
        `Cannot ${action} from ${current}`,
        409,
      );
    return next as 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  }
  private async validateMilestoneTime(
    tx: Prisma.TransactionClient,
    milestoneId: string,
    plannedAt: Date,
    tenantId: string,
  ) {
    const milestone = await tx.shipmentMilestone.findFirst({
      where: { id: milestoneId, tenantId },
    });
    if (!milestone)
      throw new AppError(
        'TMS_APPOINTMENT_MILESTONE_INVALID',
        'Milestone not found',
        409,
      );
    const [previous, next] = await Promise.all([
      tx.shipmentMilestone.findFirst({
        orderBy: { sequence: 'desc' },
        where: {
          milestonePlanId: milestone.milestonePlanId,
          sequence: { lt: milestone.sequence },
          tenantId,
        },
      }),
      tx.shipmentMilestone.findFirst({
        orderBy: { sequence: 'asc' },
        where: {
          milestonePlanId: milestone.milestonePlanId,
          sequence: { gt: milestone.sequence },
          tenantId,
        },
      }),
    ]);
    if (
      (previous && plannedAt <= previous.plannedAt) ||
      (next && plannedAt >= next.plannedAt)
    )
      throw new AppError(
        'TMS_APPOINTMENT_MILESTONE_ORDER_INVALID',
        'Reschedule must preserve milestone time order',
        409,
      );
    return milestone;
  }
  private hash(value: unknown) {
    const canonical = (current: unknown): unknown =>
      Array.isArray(current)
        ? current.map(canonical)
        : current && typeof current === 'object'
          ? Object.fromEntries(
              Object.entries(current as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, canonical(nested)]),
            )
          : current;
    return createHash('sha256')
      .update(JSON.stringify(canonical(value)))
      .digest('hex');
  }
  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
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
    throw new AppError('TMS_IN_TRANSIT_INPUT_INVALID', message, 400);
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
