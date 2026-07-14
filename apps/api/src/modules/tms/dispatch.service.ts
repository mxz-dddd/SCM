import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import {
  FleetAssignmentFacade,
  type FleetAssignmentInspectionInput,
} from '../mdm/public/fleet-assignment.facade';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

interface AssignInput {
  backupContactSnapshot: Readonly<Record<string, unknown>>;
  carrierTenderId: string;
  driverRef: string;
  expectedShipmentVersion: number;
  scheduleFrom: string;
  scheduleTo: string;
  vehicleRef: string;
}

interface VehicleDocument {
  documentNo: string;
  status: 'ACTIVE' | 'REVOKED';
  type: string;
  validFrom: string;
  validUntil: string;
}

@Injectable()
export class DispatchService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FleetAssignmentFacade)
    private readonly fleet: FleetAssignmentFacade,
  ) {}

  async workbench(context: TenantContext) {
    const query = {
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: 200,
      where: { tenantId: context.tenantId },
    };
    const [
      assignments,
      checks,
      exceptions,
      dispatches,
      shipments,
      tenders,
      fleetCandidates,
    ] = await Promise.all([
      this.prisma.vehicleAssignment.findMany(query),
      this.prisma.complianceCheck.findMany(query),
      this.prisma.transportComplianceException.findMany(query),
      this.prisma.shipmentDispatch.findMany(query),
      this.prisma.shipment.findMany(query),
      this.prisma.carrierTender.findMany(query),
      this.fleet.listCandidates(context),
    ]);
    return toHttpJson({
      assignments,
      checks,
      dispatches,
      exceptions,
      fleetCandidates,
      shipments,
      tenders,
    });
  }

  async assign(
    shipmentId: string,
    input: AssignInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    this.uuid(input.carrierTenderId, 'carrierTenderId');
    this.uuid(input.vehicleRef, 'vehicleRef');
    this.uuid(input.driverRef, 'driverRef');
    if (!record(input.backupContactSnapshot).phone)
      this.invalid('Backup contact phone is required');
    const snapshot = await this.assignmentRequirements(shipmentId, context);
    const inspectionInput: FleetAssignmentInspectionInput = {
      carrierRef: snapshot.carrierRef,
      dangerousGoods: snapshot.dangerousGoods,
      driverRef: input.driverRef,
      pallets: snapshot.pallets,
      payload: snapshot.payload,
      requiredCertificateTypes: snapshot.requiredCertificateTypes,
      ...(snapshot.requiredEquipmentType
        ? { requiredEquipmentType: snapshot.requiredEquipmentType }
        : {}),
      ...(snapshot.requiredTemperatureMax
        ? { requiredTemperatureMax: snapshot.requiredTemperatureMax }
        : {}),
      ...(snapshot.requiredTemperatureMin
        ? { requiredTemperatureMin: snapshot.requiredTemperatureMin }
        : {}),
      scheduleFrom: input.scheduleFrom,
      scheduleTo: input.scheduleTo,
      vehicleRef: input.vehicleRef,
      volume: snapshot.volume,
    };
    const eligibility = await this.fleet.inspect(inspectionInput, context);
    if (!eligibility.allowed)
      throw new AppError(
        'TMS_VEHICLE_ASSIGNMENT_INELIGIBLE',
        'Vehicle or driver does not satisfy assignment requirements',
        409,
        {
          fieldErrors: eligibility.reasons.map((message) => ({
            field: 'eligibility',
            message,
          })),
        },
      );
    const scheduleFrom = new Date(eligibility.scheduleFrom);
    const scheduleTo = new Date(eligibility.scheduleTo);
    return this.prisma.$transaction(async (tx) => {
      await this.lockResources(tx, context.tenantId, [
        `driver:${input.driverRef}`,
        `vehicle:${input.vehicleRef}`,
      ]);
      const [shipment, tender] = await Promise.all([
        tx.shipment.findFirst({
          where: { id: shipmentId, tenantId: context.tenantId },
        }),
        tx.carrierTender.findFirst({
          where: {
            id: input.carrierTenderId,
            shipmentId,
            status: 'ACCEPTED',
            tenantId: context.tenantId,
          },
        }),
      ]);
      if (
        !shipment ||
        shipment.status !== 'ACCEPTED' ||
        shipment.version !== input.expectedShipmentVersion
      )
        throw this.conflict('TMS_ASSIGNMENT_SHIPMENT_CONFLICT');
      if (!tender || tender.carrierRef !== snapshot.carrierRef)
        throw new AppError(
          'TMS_ASSIGNMENT_TENDER_INVALID',
          'Accepted carrier tender is required',
          409,
        );
      if (
        scheduleFrom > shipment.pickupWindowFrom ||
        scheduleTo < shipment.deliveryWindowTo
      )
        throw new AppError(
          'TMS_ASSIGNMENT_SCHEDULE_COVERAGE_INVALID',
          'Assignment schedule must cover the shipment window',
          409,
        );
      const conflict = await tx.vehicleAssignment.findFirst({
        where: {
          OR: [
            { driverRef: input.driverRef },
            { vehicleRef: input.vehicleRef },
          ],
          scheduleFrom: { lt: scheduleTo },
          scheduleTo: { gt: scheduleFrom },
          status: { in: ['ASSIGNED', 'DISPATCHED'] },
          tenantId: context.tenantId,
        },
      });
      if (conflict)
        throw new AppError(
          'TMS_ASSIGNMENT_SCHEDULE_CONFLICT',
          'Vehicle or driver already has an overlapping assignment',
          409,
          { retryable: true },
        );
      const id = randomUUID();
      const assignment = await tx.vehicleAssignment.create({
        data: {
          assignedBy: context.accountId,
          assignmentNo: `VA-${Date.now()}-${id.slice(0, 6)}`,
          backupContactSnapshot: json(input.backupContactSnapshot),
          carrierTenderId: tender.id,
          createdBy: context.accountId,
          driverRef: input.driverRef,
          driverSnapshot: json(eligibility.driverSnapshot),
          eligibilitySnapshot: json(eligibility),
          id,
          requirementSnapshot: json(snapshot),
          scheduleFrom,
          scheduleTo,
          shipmentId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          vehicleRef: input.vehicleRef,
          vehicleSnapshot: json(eligibility.vehicleSnapshot),
        },
      });
      const changed = await tx.shipment.update({
        data: {
          status: 'DISPATCHED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: shipment.id },
      });
      await this.emit(
        tx,
        shipment.id,
        changed.version,
        'shipment.vehicle-assigned.v1',
        context,
        metadata,
        {
          driverRef: assignment.driverRef,
          shipmentId,
          vehicleAssignmentId: assignment.id,
          vehicleRef: assignment.vehicleRef,
        },
      );
      return {
        shipmentStatus: changed.status,
        shipmentVersion: changed.version,
        status: assignment.status,
        vehicleAssignmentId: assignment.id,
        version: assignment.version,
      };
    });
  }

  revokeAssignment(
    id: string,
    input: { expectedVersion: number; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'vehicleAssignmentId');
    if (!input.reason?.trim()) this.invalid('Revocation reason is required');
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.vehicleAssignment.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (
        !assignment ||
        assignment.status !== 'ASSIGNED' ||
        assignment.version !== input.expectedVersion
      )
        throw this.conflict('TMS_ASSIGNMENT_REVOKE_CONFLICT');
      const changed = await tx.vehicleAssignment.update({
        data: {
          revokedAt: new Date(),
          revokeReason: input.reason.trim(),
          status: 'REVOKED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id },
      });
      const shipment = await tx.shipment.updateMany({
        data: {
          status: 'ACCEPTED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          id: assignment.shipmentId,
          status: 'DISPATCHED',
          tenantId: context.tenantId,
        },
      });
      if (!shipment.count)
        throw this.conflict('TMS_ASSIGNMENT_SHIPMENT_CONFLICT');
      const restoredShipment = await tx.shipment.findUniqueOrThrow({
        where: { id: assignment.shipmentId },
      });
      await this.emit(
        tx,
        assignment.shipmentId,
        restoredShipment.version,
        'shipment.vehicle-assignment-revoked.v1',
        context,
        metadata,
        {
          reason: input.reason.trim(),
          shipmentId: assignment.shipmentId,
          vehicleAssignmentId: assignment.id,
        },
      );
      return {
        shipmentStatus: 'ACCEPTED' as const,
        shipmentVersion: restoredShipment.version,
        status: changed.status,
        vehicleAssignmentId: changed.id,
        version: changed.version,
      };
    });
  }

  async checkCompliance(
    assignmentId: string,
    input: {
      expectedAssignmentVersion: number;
      vehicleDocuments: readonly VehicleDocument[];
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(assignmentId, 'vehicleAssignmentId');
    const assignment = await this.prisma.vehicleAssignment.findFirst({
      where: {
        id: assignmentId,
        status: 'ASSIGNED',
        tenantId: context.tenantId,
      },
    });
    if (!assignment || assignment.version !== input.expectedAssignmentVersion)
      throw this.conflict('TMS_COMPLIANCE_ASSIGNMENT_CONFLICT');
    const requirement = record(assignment.requirementSnapshot);
    const inspection = await this.fleet.inspect(
      {
        carrierRef: String(requirement.carrierRef ?? ''),
        dangerousGoods: requirement.dangerousGoods === true,
        driverRef: assignment.driverRef,
        pallets: String(requirement.pallets ?? '0'),
        payload: String(requirement.payload ?? '0'),
        requiredCertificateTypes: Array.isArray(
          requirement.requiredCertificateTypes,
        )
          ? requirement.requiredCertificateTypes.map(String)
          : [],
        ...(requirement.requiredEquipmentType
          ? {
              requiredEquipmentType: String(requirement.requiredEquipmentType),
            }
          : {}),
        ...(requirement.requiredTemperatureMax
          ? {
              requiredTemperatureMax: String(
                requirement.requiredTemperatureMax,
              ),
            }
          : {}),
        ...(requirement.requiredTemperatureMin
          ? {
              requiredTemperatureMin: String(
                requirement.requiredTemperatureMin,
              ),
            }
          : {}),
        scheduleFrom: assignment.scheduleFrom.toISOString(),
        scheduleTo: assignment.scheduleTo.toISOString(),
        vehicleRef: assignment.vehicleRef,
        volume: String(requirement.volume ?? '0'),
      },
      context,
    );
    const requiredVehicleDocuments = [
      'VEHICLE_REGISTRATION',
      'VEHICLE_INSURANCE',
      'VEHICLE_INSPECTION',
      ...(requirement.dangerousGoods === true ? ['VEHICLE_HAZMAT'] : []),
    ];
    const failures = [...inspection.reasons];
    const documents = input.vehicleDocuments.map((document) => ({
      ...document,
      type: document.type.trim().toUpperCase(),
      validFrom: this.date(document.validFrom),
      validUntil: this.date(document.validUntil),
    }));
    for (const type of requiredVehicleDocuments) {
      const document = documents.find((candidate) => candidate.type === type);
      if (
        !document ||
        !document.documentNo?.trim() ||
        document.status !== 'ACTIVE' ||
        document.validFrom > assignment.scheduleFrom ||
        document.validUntil < assignment.scheduleTo
      )
        failures.push(`VEHICLE_DOCUMENT_INVALID:${type}`);
    }
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.vehicleAssignment.findFirst({
        where: {
          id: assignment.id,
          status: 'ASSIGNED',
          tenantId: context.tenantId,
          version: input.expectedAssignmentVersion,
        },
      });
      if (!current) throw this.conflict('TMS_COMPLIANCE_ASSIGNMENT_CONFLICT');
      const id = randomUUID();
      const status = failures.length ? 'FAILED' : 'PASSED';
      const changedAssignment = await tx.vehicleAssignment.update({
        data: {
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: current.id },
      });
      const check = await tx.complianceCheck.create({
        data: {
          assignmentVersion: changedAssignment.version,
          checkedBy: context.accountId,
          checkNo: `CC-${Date.now()}-${id.slice(0, 6)}`,
          checklistSnapshot: json({
            driverAndVehicleInspection: inspection,
            requiredVehicleDocuments,
            vehicleDocuments: documents.map((document) => ({
              ...document,
              validFrom: document.validFrom.toISOString(),
              validUntil: document.validUntil.toISOString(),
            })),
          }),
          createdBy: context.accountId,
          failureReasons: json(failures),
          id,
          shipmentId: current.shipmentId,
          status,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          vehicleAssignmentId: current.id,
        },
      });
      if (failures.length)
        for (const failure of failures)
          await tx.transportComplianceException.create({
            data: {
              complianceCheckId: check.id,
              createdBy: context.accountId,
              evidenceSnapshot: json({ failure, inspection }),
              exceptionCode: failure.split(':')[0]!,
              message: failure,
              shipmentId: current.shipmentId,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
              vehicleAssignmentId: current.id,
            },
          });
      else
        await tx.transportComplianceException.updateMany({
          data: {
            resolution: 'RECHECK_PASSED',
            resolvedAt: new Date(),
            resolvedBy: context.accountId,
            status: 'RESOLVED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            status: 'OPEN',
            tenantId: context.tenantId,
            vehicleAssignmentId: current.id,
          },
        });
      await this.emit(
        tx,
        current.id,
        changedAssignment.version,
        `shipment.compliance-${status.toLowerCase()}.v1`,
        context,
        metadata,
        {
          complianceCheckId: check.id,
          failureReasons: failures,
          shipmentId: current.shipmentId,
          vehicleAssignmentId: current.id,
        },
        'VehicleAssignment',
      );
      return {
        assignmentVersion: changedAssignment.version,
        complianceCheckId: check.id,
        failureReasons: failures,
        status: check.status,
        version: check.version,
      };
    });
  }

  confirmDispatch(
    shipmentId: string,
    input: {
      actualDepartureAt: string;
      complianceCheckId: string;
      documentSnapshot: Readonly<Record<string, unknown>>;
      expectedAssignmentVersion: number;
      expectedShipmentVersion: number;
      loadSnapshot: Readonly<Record<string, unknown>>;
      sealSnapshot: Readonly<Record<string, unknown>>;
      vehicleAssignmentId: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    this.uuid(input.vehicleAssignmentId, 'vehicleAssignmentId');
    this.uuid(input.complianceCheckId, 'complianceCheckId');
    const actualDepartureAt = this.date(input.actualDepartureAt);
    if (actualDepartureAt > new Date())
      this.invalid('Actual departure cannot be in the future');
    if (
      record(input.loadSnapshot).loaded !== true ||
      record(input.sealSnapshot).sealed !== true ||
      !record(input.sealSnapshot).sealNo ||
      record(input.documentSnapshot).complete !== true
    )
      throw new AppError(
        'TMS_DISPATCH_PREREQUISITES_INCOMPLETE',
        'Load, seal and dispatch documents must be complete',
        409,
      );
    return this.prisma.$transaction(async (tx) => {
      const [shipment, assignment, check, openExceptions] = await Promise.all([
        tx.shipment.findFirst({
          where: { id: shipmentId, tenantId: context.tenantId },
        }),
        tx.vehicleAssignment.findFirst({
          where: {
            id: input.vehicleAssignmentId,
            shipmentId,
            tenantId: context.tenantId,
          },
        }),
        tx.complianceCheck.findFirst({
          where: {
            id: input.complianceCheckId,
            shipmentId,
            status: 'PASSED',
            tenantId: context.tenantId,
            vehicleAssignmentId: input.vehicleAssignmentId,
          },
        }),
        tx.transportComplianceException.count({
          where: {
            status: 'OPEN',
            tenantId: context.tenantId,
            vehicleAssignmentId: input.vehicleAssignmentId,
          },
        }),
      ]);
      if (
        !shipment ||
        shipment.status !== 'DISPATCHED' ||
        shipment.version !== input.expectedShipmentVersion ||
        !assignment ||
        assignment.status !== 'ASSIGNED' ||
        assignment.version !== input.expectedAssignmentVersion
      )
        throw this.conflict('TMS_DISPATCH_STATE_CONFLICT');
      if (
        !check ||
        check.assignmentVersion !== assignment.version ||
        openExceptions
      )
        throw new AppError(
          'TMS_DISPATCH_COMPLIANCE_BLOCKED',
          'A current passed compliance check without open exceptions is required',
          409,
        );
      const id = randomUUID();
      const dispatch = await tx.shipmentDispatch.create({
        data: {
          actualDepartureAt,
          assignmentSnapshot: json({
            driverRef: assignment.driverRef,
            driverSnapshot: assignment.driverSnapshot,
            scheduleFrom: assignment.scheduleFrom,
            scheduleTo: assignment.scheduleTo,
            vehicleRef: assignment.vehicleRef,
            vehicleSnapshot: assignment.vehicleSnapshot,
          }),
          complianceCheckId: check.id,
          confirmedBy: context.accountId,
          createdBy: context.accountId,
          dispatchNo: `DSP-${Date.now()}-${id.slice(0, 6)}`,
          documentSnapshot: json(input.documentSnapshot),
          id,
          loadSnapshot: json(input.loadSnapshot),
          sealSnapshot: json(input.sealSnapshot),
          shipmentId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          vehicleAssignmentId: assignment.id,
        },
      });
      const [changedAssignment, changedShipment] = await Promise.all([
        tx.vehicleAssignment.update({
          data: {
            status: 'DISPATCHED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: assignment.id },
        }),
        tx.shipment.update({
          data: {
            status: 'TRACKING',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: shipment.id },
        }),
      ]);
      await this.emit(
        tx,
        shipment.id,
        changedShipment.version,
        'tracking.event.v1',
        context,
        metadata,
        {
          dispatchId: dispatch.id,
          location: null,
          shipmentId,
          source: 'DISPATCH_CONFIRMATION',
          stopId: null,
          time: actualDepartureAt.toISOString(),
          type: 'DEPARTED',
        },
      );
      return {
        dispatchId: dispatch.id,
        shipmentStatus: changedShipment.status,
        shipmentVersion: changedShipment.version,
        status: dispatch.status,
        vehicleAssignmentVersion: changedAssignment.version,
        version: dispatch.version,
      };
    });
  }

  private async assignmentRequirements(
    shipmentId: string,
    context: TenantContext,
  ) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId: context.tenantId },
    });
    if (!shipment)
      throw new AppError(
        'TMS_SHIPMENT_NOT_FOUND',
        'Shipment was not found',
        404,
      );
    const tender = await this.prisma.carrierTender.findFirst({
      orderBy: { respondedAt: 'desc' },
      where: {
        shipmentId,
        status: 'ACCEPTED',
        tenantId: context.tenantId,
      },
    });
    if (!tender)
      throw new AppError(
        'TMS_ASSIGNMENT_TENDER_INVALID',
        'Accepted carrier tender is required',
        409,
      );
    const legs = await this.prisma.transportLeg.findMany({
      where: { shipmentId, tenantId: context.tenantId },
    });
    const equipment = legs.length
      ? await this.prisma.equipmentSelection.findFirst({
          orderBy: { createdAt: 'desc' },
          where: {
            compatible: true,
            tenantId: context.tenantId,
            transportLegId: { in: legs.map(({ id }) => id) },
          },
        })
      : null;
    const dangerousGoods =
      (await this.prisma.shipmentItem.count({
        where: {
          itemSnapshot: { path: ['dangerousGoods'], equals: true },
          shipmentId,
          tenantId: context.tenantId,
        },
      })) > 0 || record(shipment.requirementSnapshot).dangerousGoods === true;
    return {
      carrierRef: tender.carrierRef,
      dangerousGoods,
      pallets: shipment.totalPallets.toString(),
      payload: shipment.totalWeightBase.toString(),
      requiredCertificateTypes: [
        'DRIVING_LICENSE',
        ...(dangerousGoods ? ['DRIVER_HAZMAT'] : []),
      ],
      requiredEquipmentType:
        equipment?.equipmentType ??
        (record(shipment.requirementSnapshot).equipmentType
          ? String(record(shipment.requirementSnapshot).equipmentType)
          : undefined),
      requiredTemperatureMax: shipment.temperatureMax?.toString(),
      requiredTemperatureMin: shipment.temperatureMin?.toString(),
      shipmentVersion: shipment.version,
      volume: shipment.totalVolumeBase.toString(),
    };
  }

  private async lockResources(
    tx: Prisma.TransactionClient,
    tenantId: string,
    resources: readonly string[],
  ) {
    for (const resource of [...resources].sort())
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${resource}`},0))`,
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
    throw new AppError('TMS_DISPATCH_INPUT_INVALID', message, 400);
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
