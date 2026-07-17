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
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import { OperationClosureService } from './operation-closure.service';

const meta = (request: TenantRequest, correlationId: string, key?: string) => ({
  correlationId,
  idempotencyKey: key,
  ipAddress: request.ip,
});

@Controller('api/v1/ams/operations')
@UseGuards(PermissionGuard)
export class OperationClosureController {
  constructor(
    @Inject(OperationClosureService)
    private readonly service: OperationClosureService,
  ) {}

  @Get('workbench')
  @RequirePermission('ams.operation.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Get('dashboard')
  @RequirePermission('ams.dashboard.read')
  dashboard(
    @Query() query: Parameters<OperationClosureService['dashboard']>[0],
    @Req() request: TenantRequest,
  ) {
    return this.service.dashboard(query, request.tenantContext);
  }

  @Post('appointments/:id/events')
  @Idempotent('ams.operation.event.v1')
  @RequirePermission('ams.operation.manage')
  recordEvent(
    @Param('id') id: string,
    @Body() input: Parameters<OperationClosureService['recordEvent']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.recordEvent(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('appointments/:id/check-out')
  @HttpCode(200)
  @Idempotent('ams.operation.check-out.v1')
  @RequirePermission('ams.gate.checkout')
  checkOut(
    @Param('id') id: string,
    @Body() input: Parameters<OperationClosureService['checkOut']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.checkOut(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('appointments/:id/complete')
  @HttpCode(200)
  @Idempotent('ams.operation.complete.v1')
  @RequirePermission('ams.operation.manage')
  complete(
    @Param('id') id: string,
    @Body() input: Parameters<OperationClosureService['complete']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.complete(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('appointments/:id/no-show')
  @HttpCode(200)
  @Idempotent('ams.operation.no-show.v1')
  @RequirePermission('ams.noshow.manage')
  markNoShow(
    @Param('id') id: string,
    @Body() input: Parameters<OperationClosureService['markNoShow']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.markNoShow(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('no-shows/:id/appeals')
  @Idempotent('ams.operation.no-show-appeal.v1')
  @RequirePermission('ams.noshow.appeal')
  appeal(
    @Param('id') id: string,
    @Body() input: Parameters<OperationClosureService['appeal']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.appeal(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('appeals/:id/decide')
  @HttpCode(200)
  @Idempotent('ams.operation.no-show-decision.v1')
  @RequirePermission('ams.noshow.waive')
  decideAppeal(
    @Param('id') id: string,
    @Body() input: Parameters<OperationClosureService['decideAppeal']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.decideAppeal(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
}
