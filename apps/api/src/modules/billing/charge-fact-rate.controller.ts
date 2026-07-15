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
import { Idempotent } from '../platform/idempotent.decorator';
import type { BusinessEventInput } from '../platform/event.service';
import {
  ChargeFactRateService,
  type CorrectChargeFactInput,
  type ReceiveChargeFactInput,
} from './charge-fact-rate.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/billing')
@UseGuards(PermissionGuard)
export class ChargeFactRateController {
  constructor(
    @Inject(ChargeFactRateService)
    private readonly service: ChargeFactRateService,
  ) {}

  @Get('workbench')
  @RequirePermission('billing.fact.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('facts')
  @Idempotent('billing.charge-fact.receive.v1')
  @RequirePermission('billing.fact.ingest')
  receive(
    @Body() input: ReceiveChargeFactInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.receive(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('events/consume')
  @WorkerAccessible('BILLING_EVENT_CONSUME')
  @Idempotent('billing.charge-fact.consume.v1')
  @RequirePermission('billing.fact.ingest')
  consume(
    @Body() input: BusinessEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.consume(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('facts/:id/corrections')
  @Idempotent('billing.charge-fact.correct.v1')
  @RequirePermission('billing.fact.correct')
  correct(
    @Param('id') id: string,
    @Body() input: CorrectChargeFactInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.correct(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
