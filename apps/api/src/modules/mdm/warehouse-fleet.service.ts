import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type DriverCertificateStatus,
  type FleetStatus,
  type WarehouseStatus,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from '../platform/idempotency.service';
import type { CommandMetadata } from '../platform/tenant.service';

export interface VersionInput {
  readonly expectedVersion: number;
}
export interface SaveWarehouseInput {
  readonly addressId?: string;
  readonly code: string;
  readonly name: string;
  readonly serviceCapabilities?: Readonly<Record<string, unknown>>;
  readonly temperatureCapabilities?: readonly string[];
  readonly timeZone: string;
}
export interface WarehouseUsageInput {
  readonly futureAppointmentCount: number;
  readonly inventoryQuantity: string;
  readonly openTaskCount: number;
  readonly sourceVersions: Readonly<Record<string, number>>;
}
export interface SaveLocationInput {
  readonly code: string;
  readonly hazardousAllowed?: boolean;
  readonly maxVolume?: string;
  readonly maxWeight?: string;
  readonly mixingRules?: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly palletCapacity?: string;
  readonly parentId?: string;
  readonly sequence?: number;
  readonly temperatureZone?: 'AMBIENT' | 'CHILLED' | 'FROZEN' | 'CONTROLLED';
  readonly type: 'ZONE' | 'AISLE' | 'LOCATION' | 'STAGING';
  readonly volumeUom?: string;
  readonly warehouseId: string;
  readonly weightUom?: string;
}
export interface SaveDockInput {
  readonly code: string;
  readonly maxVehicleLength?: string;
  readonly maxVehicleWeight?: string;
  readonly name: string;
  readonly serviceCapabilities?: Readonly<Record<string, unknown>>;
  readonly temperatureCapabilities?: readonly string[];
  readonly warehouseId: string;
}
export interface SaveGateInput {
  readonly accessInstructions?: string;
  readonly code: string;
  readonly direction: 'IN' | 'OUT' | 'BOTH';
  readonly name: string;
  readonly serviceCapabilities?: Readonly<Record<string, unknown>>;
  readonly warehouseId: string;
}
export interface SaveEquipmentTypeInput {
  readonly code: string;
  readonly maxPayload: string;
  readonly maxVolume: string;
  readonly name: string;
  readonly payloadUom: string;
  readonly serviceCapabilities?: Readonly<Record<string, unknown>>;
  readonly temperatureControlled?: boolean;
  readonly volumeUom: string;
}
export interface SaveVehicleInput {
  readonly carrierPartnerId?: string;
  readonly equipmentTypeId: string;
  readonly maxPayload: string;
  readonly maxVolume: string;
  readonly payloadUom: string;
  readonly plateNumber: string;
  readonly temperatureControlled?: boolean;
  readonly temperatureMax?: string;
  readonly temperatureMin?: string;
  readonly volumeUom: string;
}
export interface SaveDriverInput {
  readonly carrierPartnerId?: string;
  readonly driverNo: string;
  readonly identityRef?: string;
  readonly name: string;
  readonly phone: string;
}
export interface SaveDriverCertificateInput {
  readonly attachmentId?: string;
  readonly certificateNo: string;
  readonly certificateType: string;
  readonly driverId: string;
  readonly requiredForAssignment?: boolean;
  readonly validFrom: string;
  readonly validUntil: string;
}
export interface FleetTransitionInput extends VersionInput {
  readonly reason?: string;
  readonly targetStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'INACTIVE';
}
export interface AssignmentEligibilityInput {
  readonly driverId: string;
  readonly payload?: string;
  readonly requiredCertificateTypes?: readonly string[];
  readonly requiredTemperatureMax?: string;
  readonly requiredTemperatureMin?: string;
  readonly vehicleId: string;
  readonly volume?: string;
}

const CODE = /^[A-Z0-9][A-Z0-9_.-]{0,99}$/;
const UOM = /^[A-Z][A-Z0-9_.-]{0,19}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertWarehouseTransition(
  current: WarehouseStatus,
  target: WarehouseStatus,
): void {
  if (!(
    (current === 'DRAFT' && target === 'ACTIVE') ||
    (current === 'ACTIVE' && target === 'INACTIVE')
  ))
    throw new AppError(
      'WAREHOUSE_TRANSITION_INVALID',
      `Warehouse transition ${current} -> ${target} is not allowed`,
      409,
    );
}
export function assertFleetTransition(
  current: FleetStatus,
  target: FleetStatus,
): void {
  const allowed =
    (current === 'DRAFT' && target === 'AVAILABLE') ||
    (current === 'AVAILABLE' && ['UNAVAILABLE', 'INACTIVE'].includes(target)) ||
    (current === 'UNAVAILABLE' && ['AVAILABLE', 'INACTIVE'].includes(target));
  if (!allowed)
    throw new AppError(
      'FLEET_TRANSITION_INVALID',
      `Fleet transition ${current} -> ${target} is not allowed`,
      409,
    );
}
export function assertDriverCertificateTransition(
  current: DriverCertificateStatus,
  target: DriverCertificateStatus,
): void {
  if (!(current === 'ACTIVE' && ['EXPIRED', 'REVOKED'].includes(target)))
    throw new AppError(
      'DRIVER_CERTIFICATE_TRANSITION_INVALID',
      `Driver certificate transition ${current} -> ${target} is not allowed`,
      409,
    );
}
function required(
  value: string | undefined,
  field: string,
  max: number,
): string {
  const result = value?.trim();
  if (!result || result.length > max)
    throw new AppError('MDM_INPUT_INVALID', `${field} is required`, 400);
  return result;
}
function optional(value: string | undefined, max: number): string | null {
  if (!value?.trim()) return null;
  const result = value.trim();
  if (result.length > max)
    throw new AppError('MDM_INPUT_INVALID', 'Value is too long', 400);
  return result;
}
function amount(
  value: string | undefined,
  field: string,
  positive = false,
): Prisma.Decimal | null {
  if (value === undefined) return null;
  try {
    const result = new Prisma.Decimal(value);
    if (
      !result.isFinite() ||
      result.isNegative() ||
      (positive && result.isZero())
    )
      throw new Error('range');
    return result;
  } catch {
    throw new AppError('MDM_DECIMAL_INVALID', `${field} is invalid`, 400);
  }
}
function date(value: string, field: string): Date {
  if (!DATE.test(value))
    throw new AppError('MDM_DATE_INVALID', `${field} must use YYYY-MM-DD`, 400);
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()))
    throw new AppError('MDM_DATE_INVALID', `${field} is invalid`, 400);
  return result;
}
function object(
  value?: Readonly<Record<string, unknown>>,
): Prisma.InputJsonObject {
  return (value ?? {}) as Prisma.InputJsonObject;
}
function array(value?: readonly string[]): Prisma.InputJsonArray {
  return [...(value ?? [])];
}

@Injectable()
export class WarehouseFleetService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  listWarehouses(context: TenantContext) {
    return this.prisma.warehouse.findMany({
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: 500,
      where: { tenantId: context.tenantId },
    });
  }
  async getWarehouse(id: string, context: TenantContext) {
    this.uuid(id, 'WAREHOUSE_NOT_FOUND');
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!warehouse)
      throw new AppError('WAREHOUSE_NOT_FOUND', 'Warehouse was not found', 404);
    const [locations, docks, gates, usage] = await Promise.all([
      this.prisma.warehouseLocation.findMany({
        orderBy: [{ sequence: 'asc' }, { code: 'asc' }],
        where: { warehouseId: id, tenantId: context.tenantId },
      }),
      this.prisma.warehouseDock.findMany({
        orderBy: { code: 'asc' },
        where: { warehouseId: id, tenantId: context.tenantId },
      }),
      this.prisma.warehouseGate.findMany({
        orderBy: { code: 'asc' },
        where: { warehouseId: id, tenantId: context.tenantId },
      }),
      this.prisma.warehouseUsageProjection.findUnique({
        where: {
          tenantId_warehouseId: { tenantId: context.tenantId, warehouseId: id },
        },
      }),
    ]);
    return { ...warehouse, docks, gates, locations, usage };
  }
  createWarehouse(
    input: SaveWarehouseInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = required(input.code, 'code', 100).toUpperCase();
    const name = required(input.name, 'name', 200);
    const timeZone = required(input.timeZone, 'timeZone', 100);
    if (!CODE.test(code) || (input.addressId && !isUuid(input.addressId)))
      throw new AppError(
        'WAREHOUSE_INVALID',
        'Warehouse input is invalid',
        400,
      );
    return this.command(
      'mdm.warehouse.create.v1',
      input,
      context,
      metadata,
      201,
      async (tx) => {
        if (
          input.addressId &&
          !(await tx.partnerAddress.findFirst({
            where: {
              id: input.addressId,
              status: 'ACTIVE',
              tenantId: context.tenantId,
            },
          }))
        )
          throw new AppError(
            'WAREHOUSE_ADDRESS_NOT_FOUND',
            'Active address was not found',
            404,
          );
        const row = await tx.warehouse.create({
          data: {
            addressId: input.addressId ?? null,
            code,
            createdBy: context.accountId,
            id: randomUUID(),
            name,
            serviceCapabilities: object(input.serviceCapabilities),
            temperatureCapabilities: array(input.temperatureCapabilities),
            tenantId: context.tenantId,
            timeZone,
            updatedBy: context.accountId,
          },
        });
        await tx.warehouseUsageProjection.create({
          data: {
            createdBy: context.accountId,
            id: randomUUID(),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            warehouseId: row.id,
          },
        });
        await this.record(
          tx,
          'Warehouse',
          row.id,
          row.version,
          'mdm.warehouse-created.v1',
          context,
          metadata,
          { code, status: row.status },
        );
        return {
          warehouseId: row.id,
          status: row.status,
          version: row.version,
        };
      },
    ).catch((error: unknown) => {
      throw this.unique(
        error,
        'WAREHOUSE_CODE_CONFLICT',
        'Warehouse code already exists',
      );
    });
  }
  updateUsage(
    warehouseId: string,
    input: WarehouseUsageInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(warehouseId, 'WAREHOUSE_NOT_FOUND');
    const inventoryQuantity = amount(
      input.inventoryQuantity,
      'inventoryQuantity',
    )!;
    if (
      !Number.isInteger(input.openTaskCount) ||
      input.openTaskCount < 0 ||
      !Number.isInteger(input.futureAppointmentCount) ||
      input.futureAppointmentCount < 0
    )
      throw new AppError(
        'WAREHOUSE_USAGE_INVALID',
        'Usage counts are invalid',
        400,
      );
    return this.command(
      'mdm.warehouse-usage.project.v1',
      { warehouseId, ...input },
      context,
      metadata,
      200,
      async (tx) => {
        await this.warehouse(tx, warehouseId, context);
        const row = await tx.warehouseUsageProjection.upsert({
          create: {
            createdBy: context.accountId,
            futureAppointmentCount: input.futureAppointmentCount,
            id: randomUUID(),
            inventoryQuantity,
            openTaskCount: input.openTaskCount,
            sourceVersions: object(input.sourceVersions),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            warehouseId,
          },
          update: {
            futureAppointmentCount: input.futureAppointmentCount,
            inventoryQuantity,
            openTaskCount: input.openTaskCount,
            projectedAt: new Date(),
            sourceVersions: object(input.sourceVersions),
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            tenantId_warehouseId: { tenantId: context.tenantId, warehouseId },
          },
        });
        await this.record(
          tx,
          'WarehouseUsageProjection',
          row.id,
          row.version,
          'mdm.warehouse-usage-projected.v1',
          context,
          metadata,
          { warehouseId },
        );
        return { projectionId: row.id, version: row.version };
      },
    );
  }
  transitionWarehouse(
    warehouseId: string,
    target: 'ACTIVE' | 'INACTIVE',
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(warehouseId, 'WAREHOUSE_NOT_FOUND');
    return this.command(
      'mdm.warehouse.transition.v1',
      { warehouseId, target, ...input },
      context,
      metadata,
      200,
      async (tx) => {
        const row = await this.warehouse(tx, warehouseId, context);
        this.version(
          row.version,
          input.expectedVersion,
          'WAREHOUSE_VERSION_CONFLICT',
        );
        assertWarehouseTransition(row.status, target);
        if (target === 'INACTIVE') {
          const usage = await tx.warehouseUsageProjection.findUnique({
            where: {
              tenantId_warehouseId: { tenantId: context.tenantId, warehouseId },
            },
          });
          const blockers = {
            futureAppointments: usage?.futureAppointmentCount ?? 0,
            inventoryQuantity: usage?.inventoryQuantity.toFixed() ?? '0',
            openTasks: usage?.openTaskCount ?? 0,
          };
          if (
            new Prisma.Decimal(blockers.inventoryQuantity).greaterThan(0) ||
            blockers.openTasks > 0 ||
            blockers.futureAppointments > 0
          )
            throw new AppError(
              'WAREHOUSE_DEACTIVATION_BLOCKED',
              'Warehouse has inventory, open tasks or future appointments',
              409,
              {
                fieldErrors: [
                  {
                    field: 'inventoryQuantity',
                    message: blockers.inventoryQuantity,
                  },
                  {
                    field: 'openTaskCount',
                    message: String(blockers.openTasks),
                  },
                  {
                    field: 'futureAppointmentCount',
                    message: String(blockers.futureAppointments),
                  },
                ],
              },
            );
        }
        const changed = await tx.warehouse.update({
          data: {
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: warehouseId },
        });
        await this.record(
          tx,
          'Warehouse',
          warehouseId,
          changed.version,
          `mdm.warehouse-${target.toLowerCase()}.v1`,
          context,
          metadata,
          { status: changed.status },
          { status: row.status },
        );
        return {
          warehouseId,
          status: changed.status,
          version: changed.version,
        };
      },
    );
  }

  createLocation(
    input: SaveLocationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = required(input.code, 'code', 100).toUpperCase();
    const maxWeight = amount(input.maxWeight, 'maxWeight');
    const maxVolume = amount(input.maxVolume, 'maxVolume');
    const palletCapacity = amount(input.palletCapacity, 'palletCapacity');
    if (
      !CODE.test(code) ||
      (maxWeight && !input.weightUom) ||
      (maxVolume && !input.volumeUom) ||
      (input.parentId && !isUuid(input.parentId))
    )
      throw new AppError(
        'WAREHOUSE_LOCATION_INVALID',
        'Location input is invalid',
        400,
      );
    return this.child(
      'WarehouseLocation',
      'mdm.warehouse-location.create.v1',
      'mdm.warehouse-location-created.v1',
      input,
      context,
      metadata,
      async (tx) => {
        await this.activeWarehouse(tx, input.warehouseId, context);
        if (
          input.parentId &&
          !(await tx.warehouseLocation.findFirst({
            where: {
              id: input.parentId,
              status: 'ACTIVE',
              tenantId: context.tenantId,
              warehouseId: input.warehouseId,
            },
          }))
        )
          throw new AppError(
            'WAREHOUSE_LOCATION_PARENT_NOT_FOUND',
            'Parent location was not found',
            404,
          );
        return tx.warehouseLocation.create({
          data: {
            code,
            createdBy: context.accountId,
            hazardousAllowed: input.hazardousAllowed ?? false,
            id: randomUUID(),
            maxVolume,
            maxWeight,
            mixingRules: object(input.mixingRules),
            name: required(input.name, 'name', 200),
            palletCapacity,
            parentId: input.parentId ?? null,
            sequence: input.sequence ?? 0,
            temperatureZone: input.temperatureZone ?? null,
            tenantId: context.tenantId,
            type: input.type,
            updatedBy: context.accountId,
            volumeUom: input.volumeUom?.toUpperCase() ?? null,
            warehouseId: input.warehouseId,
            weightUom: input.weightUom?.toUpperCase() ?? null,
          },
        });
      },
    );
  }
  createDock(
    input: SaveDockInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.child(
      'WarehouseDock',
      'mdm.warehouse-dock.create.v1',
      'mdm.warehouse-dock-created.v1',
      input,
      context,
      metadata,
      async (tx) => {
        await this.activeWarehouse(tx, input.warehouseId, context);
        return tx.warehouseDock.create({
          data: {
            code: required(input.code, 'code', 100).toUpperCase(),
            createdBy: context.accountId,
            id: randomUUID(),
            maxVehicleLength: amount(
              input.maxVehicleLength,
              'maxVehicleLength',
            ),
            maxVehicleWeight: amount(
              input.maxVehicleWeight,
              'maxVehicleWeight',
            ),
            name: required(input.name, 'name', 200),
            serviceCapabilities: object(input.serviceCapabilities),
            temperatureCapabilities: array(input.temperatureCapabilities),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            warehouseId: input.warehouseId,
          },
        });
      },
    );
  }
  createGate(
    input: SaveGateInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.child(
      'WarehouseGate',
      'mdm.warehouse-gate.create.v1',
      'mdm.warehouse-gate-created.v1',
      input,
      context,
      metadata,
      async (tx) => {
        await this.activeWarehouse(tx, input.warehouseId, context);
        return tx.warehouseGate.create({
          data: {
            accessInstructions: optional(input.accessInstructions, 1000),
            code: required(input.code, 'code', 100).toUpperCase(),
            createdBy: context.accountId,
            direction: input.direction,
            id: randomUUID(),
            name: required(input.name, 'name', 200),
            serviceCapabilities: object(input.serviceCapabilities),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            warehouseId: input.warehouseId,
          },
        });
      },
    );
  }

  listFleet(context: TenantContext) {
    return Promise.all([
      this.prisma.equipmentType.findMany({
        orderBy: { code: 'asc' },
        where: { tenantId: context.tenantId },
      }),
      this.prisma.vehicle.findMany({
        orderBy: { plateNumber: 'asc' },
        where: { tenantId: context.tenantId },
      }),
      this.prisma.driver.findMany({
        orderBy: { driverNo: 'asc' },
        where: { tenantId: context.tenantId },
      }),
      this.prisma.driverCertificate.findMany({
        orderBy: [{ validUntil: 'asc' }, { certificateType: 'asc' }],
        where: { tenantId: context.tenantId },
      }),
    ]).then(([equipmentTypes, vehicles, drivers, certificates]) => ({
      certificates,
      drivers,
      equipmentTypes,
      vehicles,
    }));
  }
  createEquipmentType(
    input: SaveEquipmentTypeInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.child(
      'EquipmentType',
      'mdm.equipment-type.create.v1',
      'mdm.equipment-type-created.v1',
      input,
      context,
      metadata,
      (tx) =>
        tx.equipmentType.create({
          data: {
            code: required(input.code, 'code', 100).toUpperCase(),
            createdBy: context.accountId,
            id: randomUUID(),
            maxPayload: amount(input.maxPayload, 'maxPayload', true)!,
            maxVolume: amount(input.maxVolume, 'maxVolume', true)!,
            name: required(input.name, 'name', 200),
            payloadUom: this.uom(input.payloadUom),
            serviceCapabilities: object(input.serviceCapabilities),
            temperatureControlled: input.temperatureControlled ?? false,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            volumeUom: this.uom(input.volumeUom),
          },
        }),
    );
  }
  createVehicle(
    input: SaveVehicleInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.equipmentTypeId, 'EQUIPMENT_TYPE_NOT_FOUND');
    return this.child(
      'Vehicle',
      'mdm.vehicle.create.v1',
      'mdm.vehicle-created.v1',
      input,
      context,
      metadata,
      async (tx) => {
        if (
          !(await tx.equipmentType.findFirst({
            where: {
              id: input.equipmentTypeId,
              status: 'ACTIVE',
              tenantId: context.tenantId,
            },
          }))
        )
          throw new AppError(
            'EQUIPMENT_TYPE_NOT_FOUND',
            'Active equipment type was not found',
            404,
          );
        const min = amount(input.temperatureMin, 'temperatureMin');
        const max = amount(input.temperatureMax, 'temperatureMax');
        if (
          (min === null) !== (max === null) ||
          (min && max && min.greaterThan(max)) ||
          (input.temperatureControlled && !min)
        )
          throw new AppError(
            'VEHICLE_TEMPERATURE_INVALID',
            'Vehicle temperature range is invalid',
            400,
          );
        return tx.vehicle.create({
          data: {
            carrierPartnerId: input.carrierPartnerId ?? null,
            createdBy: context.accountId,
            equipmentTypeId: input.equipmentTypeId,
            id: randomUUID(),
            maxPayload: amount(input.maxPayload, 'maxPayload', true)!,
            maxVolume: amount(input.maxVolume, 'maxVolume', true)!,
            payloadUom: this.uom(input.payloadUom),
            plateNumber: required(
              input.plateNumber,
              'plateNumber',
              50,
            ).toUpperCase(),
            temperatureControlled: input.temperatureControlled ?? false,
            temperatureMax: max,
            temperatureMin: min,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            volumeUom: this.uom(input.volumeUom),
          },
        });
      },
    );
  }
  createDriver(
    input: SaveDriverInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.child(
      'Driver',
      'mdm.driver.create.v1',
      'mdm.driver-created.v1',
      input,
      context,
      metadata,
      (tx) =>
        tx.driver.create({
          data: {
            carrierPartnerId: input.carrierPartnerId ?? null,
            createdBy: context.accountId,
            driverNo: required(input.driverNo, 'driverNo', 100).toUpperCase(),
            id: randomUUID(),
            identityRef: optional(input.identityRef, 200),
            name: required(input.name, 'name', 200),
            phone: required(input.phone, 'phone', 50),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        }),
    );
  }
  addDriverCertificate(
    input: SaveDriverCertificateInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.driverId, 'DRIVER_NOT_FOUND');
    const validFrom = date(input.validFrom, 'validFrom');
    const validUntil = date(input.validUntil, 'validUntil');
    if (
      validUntil < validFrom ||
      (input.attachmentId && !isUuid(input.attachmentId))
    )
      throw new AppError(
        'DRIVER_CERTIFICATE_INVALID',
        'Driver certificate input is invalid',
        400,
      );
    return this.child(
      'DriverCertificate',
      'mdm.driver-certificate.create.v1',
      'mdm.driver-certificate-created.v1',
      input,
      context,
      metadata,
      async (tx) => {
        if (
          !(await tx.driver.findFirst({
            where: {
              id: input.driverId,
              status: { not: 'INACTIVE' },
              tenantId: context.tenantId,
            },
          }))
        )
          throw new AppError('DRIVER_NOT_FOUND', 'Driver was not found', 404);
        return tx.driverCertificate.create({
          data: {
            attachmentId: input.attachmentId ?? null,
            certificateNo: required(input.certificateNo, 'certificateNo', 150),
            certificateType: required(
              input.certificateType,
              'certificateType',
              100,
            ).toUpperCase(),
            createdBy: context.accountId,
            driverId: input.driverId,
            id: randomUUID(),
            requiredForAssignment: input.requiredForAssignment ?? true,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            validFrom,
            validUntil,
          },
        });
      },
    );
  }
  transitionFleet(
    kind: 'vehicle' | 'driver',
    id: string,
    input: FleetTransitionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(
      id,
      kind === 'vehicle' ? 'VEHICLE_NOT_FOUND' : 'DRIVER_NOT_FOUND',
    );
    return this.command(
      `mdm.${kind}.transition.v1`,
      { id, ...input },
      context,
      metadata,
      200,
      async (tx) => {
        const row =
          kind === 'vehicle'
            ? await tx.vehicle.findFirst({
                where: { id, tenantId: context.tenantId },
              })
            : await tx.driver.findFirst({
                where: { id, tenantId: context.tenantId },
              });
        if (!row)
          throw new AppError(
            kind === 'vehicle' ? 'VEHICLE_NOT_FOUND' : 'DRIVER_NOT_FOUND',
            `${kind} was not found`,
            404,
          );
        this.version(
          row.version,
          input.expectedVersion,
          'FLEET_VERSION_CONFLICT',
        );
        assertFleetTransition(row.status, input.targetStatus);
        if (input.targetStatus === 'UNAVAILABLE' && !input.reason?.trim())
          throw new AppError(
            'FLEET_REASON_REQUIRED',
            'Unavailable reason is required',
            400,
          );
        if (kind === 'driver' && input.targetStatus === 'AVAILABLE') {
          const valid = await tx.driverCertificate.count({
            where: {
              driverId: id,
              requiredForAssignment: true,
              status: 'ACTIVE',
              tenantId: context.tenantId,
              validFrom: { lte: new Date() },
              validUntil: { gte: new Date() },
            },
          });
          if (!valid)
            throw new AppError(
              'DRIVER_CERTIFICATE_REQUIRED',
              'A valid required driver certificate is required',
              409,
            );
        }
        const data = {
          status: input.targetStatus,
          unavailableReason:
            input.targetStatus === 'UNAVAILABLE' ? input.reason!.trim() : null,
          updatedBy: context.accountId,
          version: { increment: 1 },
        } as const;
        const changed =
          kind === 'vehicle'
            ? await tx.vehicle.update({ data, where: { id } })
            : await tx.driver.update({ data, where: { id } });
        await this.record(
          tx,
          kind === 'vehicle' ? 'Vehicle' : 'Driver',
          id,
          changed.version,
          `mdm.${kind}-${input.targetStatus.toLowerCase()}.v1`,
          context,
          metadata,
          { status: changed.status },
          { status: row.status },
        );
        return { id, status: changed.status, version: changed.version };
      },
    );
  }
  transitionDriverCertificate(
    id: string,
    target: 'EXPIRED' | 'REVOKED',
    input: VersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'DRIVER_CERTIFICATE_NOT_FOUND');
    return this.command(
      'mdm.driver-certificate.transition.v1',
      { id, target, ...input },
      context,
      metadata,
      200,
      async (tx) => {
        const row = await tx.driverCertificate.findFirst({
          where: { id, tenantId: context.tenantId },
        });
        if (!row)
          throw new AppError(
            'DRIVER_CERTIFICATE_NOT_FOUND',
            'Driver certificate was not found',
            404,
          );
        this.version(
          row.version,
          input.expectedVersion,
          'DRIVER_CERTIFICATE_VERSION_CONFLICT',
        );
        assertDriverCertificateTransition(row.status, target);
        if (target === 'EXPIRED' && row.validUntil >= new Date())
          throw new AppError(
            'DRIVER_CERTIFICATE_NOT_EXPIRED',
            'Certificate has not expired',
            409,
          );
        const changed = await tx.driverCertificate.update({
          data: {
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id },
        });
        await this.record(
          tx,
          'DriverCertificate',
          id,
          changed.version,
          `mdm.driver-certificate-${target.toLowerCase()}.v1`,
          context,
          metadata,
          { status: target },
        );
        return { certificateId: id, status: target, version: changed.version };
      },
    );
  }
  async checkAssignment(
    input: AssignmentEligibilityInput,
    context: TenantContext,
  ) {
    this.uuid(input.vehicleId, 'VEHICLE_NOT_FOUND');
    this.uuid(input.driverId, 'DRIVER_NOT_FOUND');
    const [vehicle, driver, certificates] = await Promise.all([
      this.prisma.vehicle.findFirst({
        where: { id: input.vehicleId, tenantId: context.tenantId },
      }),
      this.prisma.driver.findFirst({
        where: { id: input.driverId, tenantId: context.tenantId },
      }),
      this.prisma.driverCertificate.findMany({
        where: {
          driverId: input.driverId,
          requiredForAssignment: true,
          tenantId: context.tenantId,
        },
      }),
    ]);
    if (!vehicle)
      throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle was not found', 404);
    if (!driver)
      throw new AppError('DRIVER_NOT_FOUND', 'Driver was not found', 404);
    const reasons: string[] = [];
    if (vehicle.status !== 'AVAILABLE') reasons.push('VEHICLE_NOT_AVAILABLE');
    if (driver.status !== 'AVAILABLE') reasons.push('DRIVER_NOT_AVAILABLE');
    const now = new Date();
    const required = new Set(
      (
        input.requiredCertificateTypes ??
        certificates.map(({ certificateType }) => certificateType)
      ).map((value) => value.toUpperCase()),
    );
    for (const type of required)
      if (
        !certificates.some(
          (item) =>
            item.certificateType === type &&
            item.status === 'ACTIVE' &&
            item.validFrom <= now &&
            item.validUntil >= now,
        )
      )
        reasons.push(`DRIVER_CERTIFICATE_INVALID:${type}`);
    const payload = amount(input.payload, 'payload');
    const volume = amount(input.volume, 'volume');
    if (payload?.greaterThan(vehicle.maxPayload))
      reasons.push('VEHICLE_PAYLOAD_EXCEEDED');
    if (volume?.greaterThan(vehicle.maxVolume))
      reasons.push('VEHICLE_VOLUME_EXCEEDED');
    const min = amount(input.requiredTemperatureMin, 'requiredTemperatureMin');
    const max = amount(input.requiredTemperatureMax, 'requiredTemperatureMax');
    if (
      (min || max) &&
      (!vehicle.temperatureControlled ||
        vehicle.temperatureMin === null ||
        vehicle.temperatureMax === null ||
        (min && min.lessThan(vehicle.temperatureMin)) ||
        (max && max.greaterThan(vehicle.temperatureMax)))
    )
      reasons.push('VEHICLE_TEMPERATURE_UNSUPPORTED');
    return {
      allowed: reasons.length === 0,
      driverId: driver.id,
      reasons,
      vehicleId: vehicle.id,
    };
  }

  private command<T extends Record<string, unknown>>(
    scope: string,
    payload: unknown,
    context: TenantContext,
    metadata: CommandMetadata,
    responseCode: number,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload,
        responseCode,
        scope,
        tenantId: context.tenantId,
      },
      operation,
    );
  }
  private child<T extends { id: string; version: number }>(
    aggregateType: string,
    scope: string,
    event: string,
    payload: unknown,
    context: TenantContext,
    metadata: CommandMetadata,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.command(scope, payload, context, metadata, 201, async (tx) => {
      const row = await operation(tx);
      await this.record(
        tx,
        aggregateType,
        row.id,
        row.version,
        event,
        context,
        metadata,
        { status: 'status' in row ? String(row.status) : 'ACTIVE' },
      );
      return { id: row.id, version: row.version };
    }).catch((error: unknown) => {
      throw this.unique(
        error,
        `${aggregateType.toUpperCase()}_CONFLICT`,
        `${aggregateType} already exists`,
      );
    });
  }
  private async record(
    tx: Prisma.TransactionClient,
    aggregateType: string,
    aggregateId: string,
    aggregateVersion: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    after: Prisma.InputJsonObject,
    before?: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      tx.platformAuditLog.create({
        data: {
          action: eventName,
          after,
          ...(before ? { before } : {}),
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: aggregateId,
          resourceType: aggregateType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId,
          aggregateType,
          aggregateVersion,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          payload: {
            aggregateId,
            tenantId: context.tenantId,
            version: aggregateVersion,
          },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
  private async warehouse(
    tx: Prisma.TransactionClient,
    id: string,
    context: TenantContext,
  ) {
    const row = await tx.warehouse.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!row)
      throw new AppError('WAREHOUSE_NOT_FOUND', 'Warehouse was not found', 404);
    return row;
  }
  private async activeWarehouse(
    tx: Prisma.TransactionClient,
    id: string,
    context: TenantContext,
  ) {
    this.uuid(id, 'WAREHOUSE_NOT_FOUND');
    const row = await this.warehouse(tx, id, context);
    if (row.status !== 'ACTIVE')
      throw new AppError(
        'WAREHOUSE_NOT_ACTIVE',
        'Warehouse must be active',
        409,
      );
    return row;
  }
  private uuid(id: string, code: string) {
    if (!isUuid(id)) throw new AppError(code, 'Resource was not found', 404);
  }
  private version(actual: number, expected: number, code: string) {
    if (!Number.isInteger(expected) || actual !== expected)
      throw new AppError(code, 'Resource changed; refresh and retry', 409, {
        retryable: true,
      });
  }
  private uom(value: string) {
    const result = required(value, 'uom', 20).toUpperCase();
    if (!UOM.test(result))
      throw new AppError('MDM_UOM_INVALID', 'UOM is invalid', 400);
    return result;
  }
  private unique(error: unknown, code: string, message: string): unknown {
    return isPrismaErrorCode(error, 'P2002')
      ? new AppError(code, message, 409)
      : error;
  }
}
