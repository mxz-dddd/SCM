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
import { WorkerAccessible } from '../platform/auth/worker-access.decorator';
import type { BusinessEventInput } from '../platform/event.service';
import { Idempotent } from '../platform/idempotent.decorator';
import { ControlTowerService } from './control-tower.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/control')
@UseGuards(PermissionGuard)
export class ControlTowerController {
  constructor(
    @Inject(ControlTowerService)
    private readonly service: ControlTowerService,
  ) {}

  @Post('events/consume')
  @WorkerAccessible('CONTROL_EVENT_CONSUME')
  @Idempotent('control.projection.consume.v1')
  @RequirePermission('control.projection.consume')
  consume(
    @Body() event: BusinessEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.consume(
      event,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('timelines/:businessRef')
  @RequirePermission('control.view.read')
  timeline(
    @Param('businessRef') businessRef: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.timeline(businessRef, request.tenantContext);
  }

  @Get('views')
  @RequirePermission('control.view.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Get('views/exact')
  @RequirePermission('control.location.precise')
  exactWorkbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext, true);
  }
}
