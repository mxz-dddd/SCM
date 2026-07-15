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

  @Post('consume')
  @HttpCode(200)
  @RequirePermission('platform.event.process')
  consume(@Body() input: ConsumeEventInput) {
    return this.events.rejectDiagnosticConsume(input);
  }
}
