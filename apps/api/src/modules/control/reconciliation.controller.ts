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
import type { BusinessEventInput } from '../platform/event.service';
import { Idempotent } from '../platform/idempotent.decorator';
import {
  ReconciliationService,
  type RunReconciliationInput,
} from './reconciliation.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/control/reconciliations')
@UseGuards(PermissionGuard)
export class ReconciliationController {
  constructor(
    @Inject(ReconciliationService)
    private readonly service: ReconciliationService,
  ) {}

  @Post('events/consume')
  @Idempotent('control.reconciliation.observation.consume.v1')
  @RequirePermission('control.reconciliation.consume')
  consumeObservation(
    @Body() event: BusinessEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.consumeObservation(
      event,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('schedules/bootstrap')
  @Idempotent('control.reconciliation.schedules.bootstrap.v1')
  @RequirePermission('control.reconciliation.schedule')
  bootstrapSchedules(
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.bootstrapSchedules(
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('runs')
  @Idempotent('control.reconciliation.run.v1')
  @RequirePermission('control.reconciliation.run')
  run(
    @Body() input: RunReconciliationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.run(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('cases/:id/resolve')
  @Idempotent('control.reconciliation.case.resolve.v1')
  @RequirePermission('control.reconciliation.resolve')
  resolveCase(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number; resolution: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.resolveCase(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('workbench')
  @RequirePermission('control.reconciliation.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }
}
