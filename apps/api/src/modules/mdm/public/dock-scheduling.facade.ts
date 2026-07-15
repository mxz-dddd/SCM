import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class DockSchedulingFacade {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listActive(warehouseRef: string, context: TenantContext) {
    const docks = await this.prisma.warehouseDock.findMany({
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      where: {
        status: 'ACTIVE',
        tenantId: context.tenantId,
        warehouseId: warehouseRef,
      },
    });
    return docks.map((dock) => ({
      code: dock.code,
      id: dock.id,
      maxVehicleLength: dock.maxVehicleLength?.toString() ?? null,
      maxVehicleWeight: dock.maxVehicleWeight?.toString() ?? null,
      name: dock.name,
      serviceCapabilities: dock.serviceCapabilities,
      temperatureCapabilities: dock.temperatureCapabilities,
      version: dock.version,
      warehouseRef: dock.warehouseId,
    }));
  }
}
