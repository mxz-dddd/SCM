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
import { Idempotent } from '../platform/idempotent.decorator';
import type { BusinessEventInput } from '../platform/event.service';
import { FulfillmentProcessService } from './fulfillment-process.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/oms')
@UseGuards(PermissionGuard)
export class FulfillmentProcessController {
  constructor(
    @Inject(FulfillmentProcessService)
    private readonly service: FulfillmentProcessService,
  ) {}

  @Get('fulfillment-processes')
  @RequirePermission('oms.order.read')
  list(
    @Query('status') status: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.service.list(request.tenantContext, status);
  }

  @Get('fulfillment-processes/:id')
  @RequirePermission('oms.order.read')
  get(@Param('id') id: string, @Req() request: TenantRequest) {
    return this.service.get(id, request.tenantContext);
  }

  @Post('fulfillment-process/events')
  @Idempotent('oms.fulfillment-process.consume.v2')
  @RequirePermission('oms.fulfillment.project')
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

  @Post('fulfillment-processes/:id/steps/:stepId/retry')
  @Idempotent('oms.fulfillment-process.retry-step.v1')
  @RequirePermission('oms.fulfillment.project')
  retry(
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body()
    input: { expectedProcessVersion: number; expectedStepVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.retryStep(
      id,
      stepId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('fulfillment-processes/:id/steps/:stepId/compensate')
  @Idempotent('oms.fulfillment-process.compensate-step.v1')
  @RequirePermission('oms.fulfillment.project')
  compensate(
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body()
    input: {
      expectedProcessVersion: number;
      expectedStepVersion: number;
      reason: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.compensateStep(
      id,
      stepId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
