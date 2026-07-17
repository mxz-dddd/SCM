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
import { TmsEventConsumerService } from './tms-event-consumer.service';

@Controller('api/v1/tms/events')
@UseGuards(PermissionGuard)
export class TmsEventConsumerController {
  constructor(
    @Inject(TmsEventConsumerService)
    private readonly service: TmsEventConsumerService,
  ) {}

  @Post('shipment-requested')
  @WorkerAccessible('TMS_SHIPMENT_EVENT_CONSUME')
  @RequirePermission('tms.transport.receive')
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
