import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../../common/app-error';
import { isUuid } from '../../../common/validation';
import { PrismaService } from '../../../database/prisma.service';

export interface FleetAssignmentInspectionInput {
  readonly carrierRef: string;
  readonly dangerousGoods: boolean;
  readonly driverRef: string;
  readonly pallets: string;
  readonly payload: string;
  readonly requiredCertificateTypes: readonly string[];
  readonly requiredEquipmentType?: string;
  readonly requiredTemperatureMax?: string;
  readonly requiredTemperatureMin?: string;
  readonly scheduleFrom: string;
  readonly scheduleTo: string;
  readonly vehicleRef: string;
  readonly volume: string;
}

@Injectable()
export class FleetAssignmentFacade {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listCandidates(context: TenantContext) {
    const [vehicles, drivers, certificates] = await Promise.all([
      this.prisma.vehicle.findMany({
        orderBy: [{ plateNumber: 'asc' }, { id: 'asc' }],
        take: 500,
        where: { status: 'AVAILABLE', tenantId: context.tenantId },
      }),
      this.prisma.driver.findMany({
        orderBy: [{ driverNo: 'asc' }, { id: 'asc' }],
        take: 500,
        where: { status: 'AVAILABLE', tenantId: context.tenantId },
      }),
      this.prisma.driverCertificate.findMany({
        orderBy: [{ validUntil: 'asc' }, { id: 'asc' }],
        take: 1000,
        where: { status: 'ACTIVE', tenantId: context.tenantId },
      }),
    ]);
    return { certificates, drivers, vehicles };
  }

  async inspect(input: FleetAssignmentInspectionInput, context: TenantContext) {
    if (!isUuid(input.vehicleRef) || !isUuid(input.driverRef))
      throw new AppError(
        'FLEET_ASSIGNMENT_REFERENCE_INVALID',
        'Vehicle or driver reference is invalid',
        400,
      );
    const scheduleFrom = this.date(input.scheduleFrom);
    const scheduleTo = this.date(input.scheduleTo);
    if (scheduleTo <= scheduleFrom)
      throw new AppError(
        'FLEET_ASSIGNMENT_SCHEDULE_INVALID',
        'Assignment schedule is invalid',
        400,
      );
    const [vehicle, driver, certificates] = await Promise.all([
      this.prisma.vehicle.findFirst({
        where: { id: input.vehicleRef, tenantId: context.tenantId },
      }),
      this.prisma.driver.findFirst({
        where: { id: input.driverRef, tenantId: context.tenantId },
      }),
      this.prisma.driverCertificate.findMany({
        orderBy: [{ certificateType: 'asc' }, { validUntil: 'desc' }],
        where: { driverId: input.driverRef, tenantId: context.tenantId },
      }),
    ]);
    if (!vehicle)
      throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle was not found', 404);
    if (!driver)
      throw new AppError('DRIVER_NOT_FOUND', 'Driver was not found', 404);
    const equipment = await this.prisma.equipmentType.findFirst({
      where: {
        id: vehicle.equipmentTypeId,
        tenantId: context.tenantId,
      },
    });
    if (!equipment)
      throw new AppError(
        'EQUIPMENT_TYPE_NOT_FOUND',
        'Equipment type was not found',
        404,
      );
    const reasons: string[] = [];
    if (vehicle.status !== 'AVAILABLE') reasons.push('VEHICLE_NOT_AVAILABLE');
    if (driver.status !== 'AVAILABLE') reasons.push('DRIVER_NOT_AVAILABLE');
    if (equipment.status !== 'ACTIVE')
      reasons.push('EQUIPMENT_TYPE_NOT_ACTIVE');
    if (
      vehicle.carrierPartnerId &&
      vehicle.carrierPartnerId !== input.carrierRef
    )
      reasons.push('VEHICLE_CARRIER_MISMATCH');
    if (driver.carrierPartnerId && driver.carrierPartnerId !== input.carrierRef)
      reasons.push('DRIVER_CARRIER_MISMATCH');
    if (
      input.requiredEquipmentType &&
      equipment.code !== input.requiredEquipmentType.trim().toUpperCase()
    )
      reasons.push('EQUIPMENT_TYPE_MISMATCH');
    if (this.decimal(input.payload).greaterThan(vehicle.maxPayload))
      reasons.push('VEHICLE_PAYLOAD_EXCEEDED');
    if (this.decimal(input.volume).greaterThan(vehicle.maxVolume))
      reasons.push('VEHICLE_VOLUME_EXCEEDED');
    const capabilities = this.record(equipment.serviceCapabilities);
    const palletCapacity = this.optionalDecimal(
      typeof capabilities.palletCapacity === 'string' ||
        typeof capabilities.palletCapacity === 'number'
        ? String(capabilities.palletCapacity)
        : undefined,
    );
    if (
      this.decimal(input.pallets).greaterThan(0) &&
      (!palletCapacity ||
        this.decimal(input.pallets).greaterThan(palletCapacity))
    )
      reasons.push('VEHICLE_PALLET_CAPACITY_EXCEEDED');
    const minimum = this.optionalDecimal(input.requiredTemperatureMin);
    const maximum = this.optionalDecimal(input.requiredTemperatureMax);
    if (
      (minimum || maximum) &&
      (!vehicle.temperatureControlled ||
        vehicle.temperatureMin === null ||
        vehicle.temperatureMax === null ||
        (minimum && minimum.lessThan(vehicle.temperatureMin)) ||
        (maximum && maximum.greaterThan(vehicle.temperatureMax)))
    )
      reasons.push('VEHICLE_TEMPERATURE_UNSUPPORTED');
    if (input.dangerousGoods && capabilities.dangerousGoodsCapable !== true)
      reasons.push('VEHICLE_DANGEROUS_GOODS_UNSUPPORTED');
    const requiredTypes = new Set(
      input.requiredCertificateTypes.map((value) => value.trim().toUpperCase()),
    );
    for (const type of requiredTypes)
      if (
        !certificates.some(
          (certificate) =>
            certificate.certificateType === type &&
            certificate.status === 'ACTIVE' &&
            certificate.validFrom <= scheduleFrom &&
            certificate.validUntil >= scheduleTo,
        )
      )
        reasons.push(`DRIVER_CERTIFICATE_INVALID:${type}`);
    return {
      allowed: reasons.length === 0,
      driverSnapshot: {
        carrierPartnerId: driver.carrierPartnerId,
        certificates: certificates.map((certificate) => ({
          certificateNo: certificate.certificateNo,
          certificateType: certificate.certificateType,
          id: certificate.id,
          status: certificate.status,
          validFrom: certificate.validFrom.toISOString(),
          validUntil: certificate.validUntil.toISOString(),
          version: certificate.version,
        })),
        driverNo: driver.driverNo,
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        status: driver.status,
        version: driver.version,
      },
      reasons,
      scheduleFrom: scheduleFrom.toISOString(),
      scheduleTo: scheduleTo.toISOString(),
      vehicleSnapshot: {
        carrierPartnerId: vehicle.carrierPartnerId,
        equipmentType: {
          code: equipment.code,
          id: equipment.id,
          serviceCapabilities: equipment.serviceCapabilities,
          version: equipment.version,
        },
        id: vehicle.id,
        maxPayload: vehicle.maxPayload.toString(),
        maxVolume: vehicle.maxVolume.toString(),
        plateNumber: vehicle.plateNumber,
        status: vehicle.status,
        temperatureControlled: vehicle.temperatureControlled,
        temperatureMax: vehicle.temperatureMax?.toString() ?? null,
        temperatureMin: vehicle.temperatureMin?.toString() ?? null,
        version: vehicle.version,
      },
    };
  }

  private date(value: string) {
    const result = new Date(value);
    if (!value || Number.isNaN(result.getTime()))
      throw new AppError(
        'FLEET_ASSIGNMENT_DATE_INVALID',
        'Assignment date is invalid',
        400,
      );
    return result;
  }
  private decimal(value: string) {
    try {
      const result = new Prisma.Decimal(value);
      if (!result.isFinite() || result.isNegative()) throw new Error();
      return result;
    } catch {
      throw new AppError(
        'FLEET_ASSIGNMENT_QUANTITY_INVALID',
        'Assignment quantity is invalid',
        400,
      );
    }
  }
  private optionalDecimal(value?: string) {
    return value === undefined ? null : this.decimal(value);
  }
  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
