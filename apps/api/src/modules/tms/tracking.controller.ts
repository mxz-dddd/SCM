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
import { TrackingService } from './tracking.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/tms/tracking')
@UseGuards(PermissionGuard)
export class TrackingController {
  constructor(
    @Inject(TrackingService) private readonly service: TrackingService,
  ) {}

  @Get('workbench') @RequirePermission('tms.tracking.read') workbench(
    @Req() request: TenantRequest,
  ) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('shipments/:id/milestone-plans')
  @Idempotent('tms.tracking.milestone-plan.v1')
  @RequirePermission('tms.tracking.plan')
  createMilestonePlan(
    @Param('id') id: string,
    @Body() input: Parameters<TrackingService['createMilestonePlan']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createMilestonePlan(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('assignments/:id/driver-task')
  @Idempotent('tms.tracking.driver-task.v1')
  @RequirePermission('tms.tracking.plan')
  createDriverTask(
    @Param('id') id: string,
    @Body() input: Parameters<TrackingService['createDriverTask']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createDriverTask(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('driver-tasks/:id/accept')
  @HttpCode(200)
  @Idempotent('tms.tracking.task-accept.v1')
  @RequirePermission('tms.driver.execute')
  acceptTask(
    @Param('id') id: string,
    @Body() input: Parameters<TrackingService['acceptTask']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.acceptTask(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('driver-tasks/:id/offline-sync')
  @HttpCode(200)
  @Idempotent('tms.tracking.offline-sync.v1')
  @RequirePermission('tms.driver.execute')
  syncOffline(
    @Param('id') id: string,
    @Body() input: Parameters<TrackingService['syncOffline']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.syncOffline(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/positions')
  @Idempotent('tms.tracking.position.v1')
  @RequirePermission('tms.tracking.ingest')
  ingestPosition(
    @Param('id') id: string,
    @Body() input: Parameters<TrackingService['ingestPosition']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.ingestPosition(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/eta')
  @Idempotent('tms.tracking.eta.v1')
  @RequirePermission('tms.tracking.predict')
  predictEta(
    @Param('id') id: string,
    @Body() input: Parameters<TrackingService['predictEta']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.predictEta(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
