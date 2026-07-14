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
import { Idempotent } from '../platform/idempotent.decorator';
import { InTransitOperationsService } from './in-transit-operations.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/tms/in-transit')
@UseGuards(PermissionGuard)
export class InTransitOperationsController {
  constructor(
    @Inject(InTransitOperationsService)
    private readonly service: InTransitOperationsService,
  ) {}

  @Get('workbench')
  @RequirePermission('tms.operations.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Get('shipments/:id/map/precise')
  @RequirePermission('tms.operations.map.precise')
  preciseMap(@Param('id') id: string, @Req() request: TenantRequest) {
    return this.service.preciseMap(id, request.tenantContext);
  }

  @Post('shipments/:id/map/refresh')
  @HttpCode(200)
  @Idempotent('tms.operations.map-refresh.v1')
  @RequirePermission('tms.operations.map.refresh')
  refreshMap(
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.refreshMap(
      id,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/exceptions/detect')
  @Idempotent('tms.operations.exception-detect.v1')
  @RequirePermission('tms.operations.exception.detect')
  detectExceptions(
    @Param('id') id: string,
    @Body()
    input: Parameters<InTransitOperationsService['detectExceptions']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.detectExceptions(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('exceptions/:id/actions')
  @HttpCode(200)
  @Idempotent('tms.operations.exception-action.v1')
  @RequirePermission('tms.operations.exception.manage')
  actOnException(
    @Param('id') id: string,
    @Body() input: Parameters<InTransitOperationsService['actOnException']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.actOnException(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('exceptions/escalate-due')
  @HttpCode(200)
  @Idempotent('tms.operations.exception-escalate.v1')
  @RequirePermission('tms.operations.exception.escalate')
  escalateDue(
    @Body() input: Parameters<InTransitOperationsService['escalateDue']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.escalateDue(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/appointment-links')
  @Idempotent('tms.operations.appointment-request.v1')
  @RequirePermission('tms.operations.appointment.manage')
  requestAppointment(
    @Param('id') id: string,
    @Body()
    input: Parameters<InTransitOperationsService['requestAppointment']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.requestAppointment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('appointment-links/:id/changes')
  @HttpCode(200)
  @Idempotent('tms.operations.appointment-change.v1')
  @RequirePermission('tms.operations.appointment.manage')
  requestAppointmentChange(
    @Param('id') id: string,
    @Body()
    input: Parameters<
      InTransitOperationsService['requestAppointmentChange']
    >[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.requestAppointmentChange(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('appointment-links/:id/events')
  @HttpCode(200)
  @Idempotent('tms.operations.appointment-event.v1')
  @RequirePermission('tms.operations.appointment.integrate')
  applyAppointmentEvent(
    @Param('id') id: string,
    @Body()
    input: Parameters<InTransitOperationsService['applyAppointmentEvent']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.applyAppointmentEvent(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
