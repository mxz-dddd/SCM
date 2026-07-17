import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { WorkerAccessible } from '../platform/auth/worker-access.decorator';
import type { BusinessEventInput } from '../platform/event.service';
import { Idempotent } from '../platform/idempotent.decorator';
import {
  BiAnalyticsService,
  type ObserveMetricInput,
  type PublishDashboardInput,
  type PublishMetricInput,
  type PublishReportInput,
} from './bi-analytics.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/control/bi')
@UseGuards(PermissionGuard)
export class BiAnalyticsController {
  constructor(
    @Inject(BiAnalyticsService)
    private readonly service: BiAnalyticsService,
  ) {}

  @Post('metrics')
  @Idempotent('control.bi.metric.publish.v1')
  @RequirePermission('control.bi.metric.manage')
  publishMetric(
    @Body() input: PublishMetricInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishMetric(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('metrics/:code/observations')
  @Idempotent('control.bi.metric.observe.v1')
  @RequirePermission('control.bi.metric.observe')
  observeMetric(
    @Param('code') code: string,
    @Body() input: ObserveMetricInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.observeMetric(
      code,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('dashboards')
  @Idempotent('control.bi.dashboard.publish.v1')
  @RequirePermission('control.bi.dashboard.manage')
  publishDashboard(
    @Body() input: PublishDashboardInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishDashboard(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('dashboards/:code')
  @RequirePermission('control.bi.dashboard.read')
  dashboard(
    @Param('code') code: string,
    @Query('organizationRef') organizationRef: string | undefined,
    @Query('warehouseRef') warehouseRef: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.service.dashboard(
      code,
      {
        ...(organizationRef ? { organizationRef } : {}),
        ...(warehouseRef ? { warehouseRef } : {}),
      },
      request.tenantContext,
    );
  }

  @Post('reports')
  @Idempotent('control.bi.report.publish.v1')
  @RequirePermission('control.bi.report.manage')
  publishReport(
    @Body() input: PublishReportInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishReport(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('reports/:id/query-jobs')
  @Idempotent('control.bi.query.run.v1')
  @RequirePermission('control.bi.query.execute')
  runQuery(
    @Param('id') id: string,
    @Body() input: { filters?: Record<string, string>; rowLimit: number },
    @Req() request: TenantRequest,
  ) {
    return this.service.runQuery(id, input, request.tenantContext, {
      exportRequested: false,
      sensitiveAccess: false,
    });
  }

  @Post('reports/:id/query-jobs/sensitive')
  @Idempotent('control.bi.query.sensitive.v1')
  @RequirePermission('control.bi.query.sensitive')
  runSensitiveQuery(
    @Param('id') id: string,
    @Body() input: { filters?: Record<string, string>; rowLimit: number },
    @Req() request: TenantRequest,
  ) {
    return this.service.runQuery(id, input, request.tenantContext, {
      exportRequested: false,
      sensitiveAccess: true,
    });
  }

  @Post('reports/:id/exports')
  @Idempotent('control.bi.report.export.v1')
  @RequirePermission('control.bi.export')
  exportReport(
    @Param('id') id: string,
    @Body() input: { filters?: Record<string, string>; rowLimit: number },
    @Req() request: TenantRequest,
  ) {
    return this.service.runQuery(id, input, request.tenantContext, {
      exportRequested: true,
      sensitiveAccess: false,
    });
  }

  @Post('lake/events/consume')
  @WorkerAccessible('CONTROL_BI_EVENT_CONSUME')
  @Idempotent('control.bi.lake.consume.v1')
  @RequirePermission('control.bi.lake.consume')
  consumeLakeEvent(
    @Body() event: BusinessEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.consumeLakeEvent(
      event,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('lake/recomputes')
  @Idempotent('control.bi.lake.recompute.v1')
  @RequirePermission('control.bi.lake.recompute')
  recomputeLake(
    @Body() input: { dataset: string; fromAt: string; toAt: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.recomputeLake(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('workbench')
  @RequirePermission('control.bi.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }
}
