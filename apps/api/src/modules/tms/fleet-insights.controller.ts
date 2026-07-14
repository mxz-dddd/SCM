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
import { FleetInsightsService } from './fleet-insights.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/tms/fleet-insights')
@UseGuards(PermissionGuard)
export class FleetInsightsController {
  constructor(
    @Inject(FleetInsightsService)
    private readonly service: FleetInsightsService,
  ) {}

  @Get('workbench')
  @RequirePermission('tms.fleet.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('maintenance-plans')
  @Idempotent('tms.fleet.maintenance-plan.v1')
  @RequirePermission('tms.fleet.maintenance')
  scheduleMaintenance(
    @Body() input: Parameters<FleetInsightsService['scheduleMaintenance']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.scheduleMaintenance(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('maintenance-plans/:id/transition')
  @HttpCode(200)
  @Idempotent('tms.fleet.maintenance-transition.v1')
  @RequirePermission('tms.fleet.maintenance')
  transitionMaintenance(
    @Param('id') id: string,
    @Body() input: Parameters<FleetInsightsService['transitionMaintenance']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionMaintenance(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('operating-facts')
  @Idempotent('tms.fleet.operating-fact.v1')
  @RequirePermission('tms.fleet.maintenance')
  recordOperatingFact(
    @Body() input: Parameters<FleetInsightsService['recordOperatingFact']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.recordOperatingFact(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/telemetry')
  @Idempotent('tms.iot.telemetry.v1')
  @RequirePermission('tms.iot.ingest')
  ingestTelemetry(
    @Param('id') id: string,
    @Body() input: Parameters<FleetInsightsService['ingestTelemetry']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.ingestTelemetry(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('condition-alerts/:id/transition')
  @HttpCode(200)
  @Idempotent('tms.iot.condition-transition.v1')
  @RequirePermission('tms.iot.resolve')
  transitionAlert(
    @Param('id') id: string,
    @Body() input: Parameters<FleetInsightsService['transitionAlert']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionAlert(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('metrics/generate')
  @Idempotent('tms.metrics.generate.v1')
  @RequirePermission('tms.metrics.generate')
  generateMetrics(
    @Body() input: Parameters<FleetInsightsService['generateMetrics']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.generateMetrics(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/tracking-tokens')
  @Idempotent('tms.tracking.access-issue.v1')
  @RequirePermission('tms.tracking.share')
  issueTrackingToken(
    @Param('id') id: string,
    @Body() input: Parameters<FleetInsightsService['issueTrackingToken']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.issueTrackingToken(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('tracking-tokens/:id/revoke')
  @HttpCode(200)
  @Idempotent('tms.tracking.access-revoke.v1')
  @RequirePermission('tms.tracking.share')
  revokeTrackingToken(
    @Param('id') id: string,
    @Body() input: Parameters<FleetInsightsService['revokeTrackingToken']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.revokeTrackingToken(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}

@Controller('api/v1/public/tracking')
export class PublicTrackingController {
  constructor(
    @Inject(FleetInsightsService)
    private readonly service: FleetInsightsService,
  ) {}

  @Get(':token')
  view(@Param('token') token: string, @Req() request: { ip?: string }) {
    return this.service.publicTracking(token, request.ip);
  }
}
