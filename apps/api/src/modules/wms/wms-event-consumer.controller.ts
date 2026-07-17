import {
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { WorkerAccessible } from '../platform/auth/worker-access.decorator';
import type { BusinessEventInput } from '../platform/event.service';
import { WmsEventConsumerService } from './wms-event-consumer.service';

@Controller('api/v1/wms/events')
@UseGuards(PermissionGuard)
export class WmsEventConsumerController {
  constructor(
    @Inject(WmsEventConsumerService)
    private readonly service: WmsEventConsumerService,
  ) {}

  @Post('fulfillment-released')
  @WorkerAccessible('WMS_FULFILLMENT_EVENT_CONSUME')
  @RequirePermission('wms.outbound.write')
  consume(
    @Body() event: BusinessEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.consume(event, request.tenantContext, {
      correlationId,
      idempotencyKey: key,
      ipAddress: request.ip,
    });
  }
}
