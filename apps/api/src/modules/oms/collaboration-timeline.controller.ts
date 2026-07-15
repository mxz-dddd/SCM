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
import { Idempotent } from '../platform/idempotent.decorator';
import type { BusinessEventInput } from '../platform/event.service';
import {
  CollaborationTimelineService,
  type CollaborationInput,
  type CreateAsnInput,
} from './collaboration-timeline.service';
const meta = (request: TenantRequest, correlationId: string, key?: string) => ({
  correlationId,
  idempotencyKey: key,
  ipAddress: request.ip,
});
@Controller('api/v1/oms')
@UseGuards(PermissionGuard)
export class CollaborationTimelineController {
  constructor(
    @Inject(CollaborationTimelineService)
    private readonly service: CollaborationTimelineService,
  ) {}
  @Post('orders/:id/collaborations')
  @Idempotent('oms.partner-collaboration.create.v1')
  @RequirePermission('oms.partner.collaborate')
  collaborate(
    @Param('id') id: string,
    @Body() input: CollaborationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.collaborate(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('orders/:id/asns')
  @Idempotent('oms.asn.create.v1')
  @RequirePermission('oms.asn.write')
  asn(
    @Param('id') id: string,
    @Body() input: CreateAsnInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createAsn(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Post('timeline-events/consume')
  @WorkerAccessible('OMS_TIMELINE_EVENT_CONSUME')
  @Idempotent('oms.timeline.consume.v1')
  @RequirePermission('oms.timeline.consume')
  consume(
    @Body() event: BusinessEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.consumeTimeline(
      event,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
  @Get('orders/:id/timeline') @RequirePermission('oms.order.read') timeline(
    @Param('id') id: string,
    @Query('timeZone') timeZone: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.service.timeline(id, timeZone, request.tenantContext);
  }
}
