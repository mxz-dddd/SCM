import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import {
  WarehouseFleetService,
  type AssignmentEligibilityInput,
  type FleetTransitionInput,
  type SaveDockInput,
  type SaveDriverCertificateInput,
  type SaveDriverInput,
  type SaveEquipmentTypeInput,
  type SaveGateInput,
  type SaveLocationInput,
  type SaveVehicleInput,
  type SaveWarehouseInput,
  type VersionInput,
  type WarehouseUsageInput,
} from './warehouse-fleet.service';

function meta(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}

@Controller('api/v1/mdm')
@UseGuards(PermissionGuard)
export class WarehouseFleetController {
  constructor(
    @Inject(WarehouseFleetService)
    private readonly service: WarehouseFleetService,
  ) {}
  @Get('warehouses') @RequirePermission('mdm.warehouse.read') listWarehouses(
    @Req() request: TenantRequest,
  ) {
    return this.service.listWarehouses(request.tenantContext);
  }
  @Get('warehouses/:id') @RequirePermission('mdm.warehouse.read') getWarehouse(
    @Param('id') id: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.getWarehouse(id, request.tenantContext);
  }
  @Post('warehouses') @RequirePermission('mdm.warehouse.write') createWarehouse(
    @Body() input: SaveWarehouseInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createWarehouse(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('warehouses/:id/:target')
  @HttpCode(200)
  @RequirePermission('mdm.warehouse.write')
  transitionWarehouse(
    @Param('id') id: string,
    @Param('target') target: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    if (!['ACTIVE', 'INACTIVE'].includes(target))
      throw new Error('Unsupported warehouse target');
    return this.service.transitionWarehouse(
      id,
      target as 'ACTIVE' | 'INACTIVE',
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('warehouses/:id/usage-projection')
  @HttpCode(200)
  @RequirePermission('mdm.warehouse.project')
  updateUsage(
    @Param('id') id: string,
    @Body() input: WarehouseUsageInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.updateUsage(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('warehouse-locations')
  @RequirePermission('mdm.warehouse.write')
  createLocation(
    @Body() input: SaveLocationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createLocation(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('warehouse-docks') @RequirePermission('mdm.warehouse.write') createDock(
    @Body() input: SaveDockInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createDock(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('warehouse-gates') @RequirePermission('mdm.warehouse.write') createGate(
    @Body() input: SaveGateInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createGate(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Get('fleet') @RequirePermission('mdm.fleet.read') listFleet(
    @Req() request: TenantRequest,
  ) {
    return this.service.listFleet(request.tenantContext);
  }
  @Post('equipment-types')
  @RequirePermission('mdm.fleet.write')
  createEquipmentType(
    @Body() input: SaveEquipmentTypeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createEquipmentType(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('vehicles') @RequirePermission('mdm.fleet.write') createVehicle(
    @Body() input: SaveVehicleInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createVehicle(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('drivers') @RequirePermission('mdm.fleet.write') createDriver(
    @Body() input: SaveDriverInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createDriver(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('driver-certificates')
  @RequirePermission('mdm.fleet.write')
  addCertificate(
    @Body() input: SaveDriverCertificateInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.addDriverCertificate(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post(':kind(vehicles|drivers)/:id/transition')
  @HttpCode(200)
  @RequirePermission('mdm.fleet.write')
  transitionFleet(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() input: FleetTransitionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionFleet(
      kind === 'vehicles' ? 'vehicle' : 'driver',
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('driver-certificates/:id/:target')
  @HttpCode(200)
  @RequirePermission('mdm.fleet.write')
  transitionCertificate(
    @Param('id') id: string,
    @Param('target') target: string,
    @Body() input: VersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    if (!['EXPIRED', 'REVOKED'].includes(target))
      throw new Error('Unsupported certificate target');
    return this.service.transitionDriverCertificate(
      id,
      target as 'EXPIRED' | 'REVOKED',
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('fleet/assignment-eligibility')
  @HttpCode(200)
  @RequirePermission('mdm.fleet.read')
  checkAssignment(
    @Body() input: AssignmentEligibilityInput,
    @Req() request: TenantRequest,
  ) {
    return this.service.checkAssignment(input, request.tenantContext);
  }
}
