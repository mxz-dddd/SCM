import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';
import {
  EventService,
  type ClaimEventsInput,
  type ConsumeEventInput,
  type DeliveryClaimInput,
  type DeliveryCompleteInput,
  type DeliveryFailInput,
  type EventLeaseInput,
} from './event.service';

@Controller('api/v1/platform/events')
@UseGuards(PermissionGuard)
export class EventController {
  constructor(@Inject(EventService) private readonly events: EventService) {}

  @Get('outbox')
  @RequirePermission('platform.event.read')
  listOutbox(
    @Query('status') status: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.events.listOutbox(request.tenantContext, status);
  }

  @Get('inbox')
  @RequirePermission('platform.event.read')
  listInbox(
    @Query('consumer') consumer: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.events.listInbox(request.tenantContext, consumer);
  }

  @Get('deliveries')
  @RequirePermission('platform.event.read')
  listDeliveries(
    @Query('consumer') consumer: string | undefined,
    @Query('status') status: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.events.listDeliveries(request.tenantContext, {
      ...(consumer ? { consumer } : {}),
      ...(status ? { status } : {}),
    });
  }

  @Get('checkpoints')
  @RequirePermission('platform.event.read')
  listCheckpoints(
    @Query('consumer') consumer: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.events.listCheckpoints(request.tenantContext, consumer);
  }

  @Post('relay/claim')
  @HttpCode(200)
  @RequirePermission('platform.event.process')
  claim(
    @Body() input: ClaimEventsInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.events.claim(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('outbox/:eventId/publish')
  @HttpCode(200)
  @RequirePermission('platform.event.process')
  publish(
    @Param('eventId') eventId: string,
    @Body() input: EventLeaseInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.events.publish(eventId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('outbox/:eventId/ack')
  @HttpCode(200)
  @RequirePermission('platform.event.process')
  acknowledge(
    @Param('eventId') eventId: string,
    @Body() input: EventLeaseInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.events.acknowledge(eventId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('outbox/:eventId/fail')
  @HttpCode(200)
  @RequirePermission('platform.event.process')
  fail(
    @Param('eventId') eventId: string,
    @Body() input: EventLeaseInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.events.fail(eventId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('outbox/:eventId/replay')
  @HttpCode(200)
  @RequirePermission('platform.event.replay')
  replay(
    @Param('eventId') eventId: string,
    @Body() input: { readonly expectedVersion: number },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.events.replay(
      eventId,
      input.expectedVersion,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post('deliveries/claim')
  @HttpCode(200)
  @RequirePermission('platform.event.process')
  claimDeliveries(
    @Body() input: DeliveryClaimInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.events.claimDeliveries(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('deliveries/:deliveryId/complete')
  @HttpCode(200)
  @RequirePermission('platform.event.process')
  completeDelivery(
    @Param('deliveryId') deliveryId: string,
    @Body() input: DeliveryCompleteInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.events.completeDelivery(
      deliveryId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post('deliveries/:deliveryId/fail')
  @HttpCode(200)
  @RequirePermission('platform.event.process')
  failDelivery(
    @Param('deliveryId') deliveryId: string,
    @Body() input: DeliveryFailInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.events.failDelivery(deliveryId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('deliveries/:deliveryId/replay')
  @HttpCode(200)
  @RequirePermission('platform.event.replay')
  replayDelivery(
    @Param('deliveryId') deliveryId: string,
    @Body() input: { readonly expectedVersion: number },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.events.replayDelivery(
      deliveryId,
      input.expectedVersion,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post('deliveries/:deliveryId/skip')
  @HttpCode(200)
  @RequirePermission('platform.event.replay')
  skipDelivery(
    @Param('deliveryId') deliveryId: string,
    @Body()
    input: { readonly expectedVersion: number; readonly reason: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.events.skipDelivery(deliveryId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('consume')
  @HttpCode(200)
  @RequirePermission('platform.event.process')
  consume(@Body() input: ConsumeEventInput) {
    return this.events.rejectDiagnosticConsume(input);
  }
}
