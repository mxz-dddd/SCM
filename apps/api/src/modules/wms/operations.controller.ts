import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import { OperationsService } from './operations.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/wms')
@UseGuards(PermissionGuard)
export class OperationsController {
  constructor(
    @Inject(OperationsService) private readonly service: OperationsService,
  ) {}

  @Get('operations')
  @RequirePermission('wms.operations.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Get('dashboard')
  @RequirePermission('wms.dashboard.read')
  dashboard(@Req() request: TenantRequest) {
    return this.service.dashboard(request.tenantContext);
  }

  @Post('value-added-orders')
  @Idempotent('wms.operations.vas-create.v1')
  @RequirePermission('wms.vas.execute')
  createValueAddedOrder(
    @Body() input: Parameters<OperationsService['createValueAddedOrder']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createValueAddedOrder(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('value-added-orders/:id/transition')
  @Idempotent('wms.operations.vas-transition.v1')
  @RequirePermission('wms.vas.execute')
  transitionValueAddedOrder(
    @Param('id') id: string,
    @Body()
    input: Parameters<OperationsService['transitionValueAddedOrder']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionValueAddedOrder(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('labor-standards')
  @Idempotent('wms.operations.labor-standard.v1')
  @RequirePermission('wms.labor.manage')
  saveLaborStandard(
    @Body() input: Parameters<OperationsService['saveLaborStandard']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.saveLaborStandard(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('labor-assignments')
  @Idempotent('wms.operations.labor-assign.v1')
  @RequirePermission('wms.labor.manage')
  createLaborAssignment(
    @Body() input: Parameters<OperationsService['createLaborAssignment']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createLaborAssignment(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('labor-assignments/:id/transition')
  @Idempotent('wms.operations.labor-transition.v1')
  @RequirePermission('wms.labor.execute')
  transitionLaborAssignment(
    @Param('id') id: string,
    @Body()
    input: Parameters<OperationsService['transitionLaborAssignment']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionLaborAssignment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('offline-devices/:deviceId/sync')
  @Idempotent('wms.operations.offline-sync.v1')
  @RequirePermission('wms.mobile.sync')
  syncOfflineCommands(
    @Param('deviceId') deviceId: string,
    @Body()
    input: {
      commands: Parameters<OperationsService['syncOfflineCommands']>[1];
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.syncOfflineCommands(
      deviceId,
      input.commands,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('offline-conflicts/:id/resolve')
  @Idempotent('wms.operations.offline-resolve.v1')
  @RequirePermission('wms.mobile.supervise')
  resolveOfflineConflict(
    @Param('id') id: string,
    @Body() input: Parameters<OperationsService['resolveOfflineConflict']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.resolveOfflineConflict(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('device-commands')
  @Idempotent('wms.operations.device-command.v1')
  @RequirePermission('wms.device.control')
  issueDeviceCommand(
    @Body() input: Parameters<OperationsService['issueDeviceCommand']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.issueDeviceCommand(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('device-commands/:id/events')
  @Idempotent('wms.operations.device-event.v1')
  @RequirePermission('wms.device.control')
  recordDeviceEvent(
    @Param('id') id: string,
    @Body() input: Parameters<OperationsService['recordDeviceEvent']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.recordDeviceEvent(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('device-commands/timeout-scan')
  @Idempotent('wms.operations.device-timeout.v1')
  @RequirePermission('wms.device.control')
  timeoutDeviceCommands(
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.timeoutDeviceCommands(
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
