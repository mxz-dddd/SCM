import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import { DispatchService } from './dispatch.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/tms/dispatch')
@UseGuards(PermissionGuard)
export class DispatchController {
  constructor(
    @Inject(DispatchService) private readonly service: DispatchService,
  ) {}

  @Get('workbench')
  @RequirePermission('tms.dispatch.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('shipments/:id/assign')
  @Idempotent('tms.dispatch.assignment-create.v1')
  @RequirePermission('tms.dispatch.assign')
  assign(
    @Param('id') id: string,
    @Body() input: Parameters<DispatchService['assign']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.assign(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('assignments/:id/revoke')
  @HttpCode(200)
  @Idempotent('tms.dispatch.assignment-revoke.v1')
  @RequirePermission('tms.dispatch.assign')
  revokeAssignment(
    @Param('id') id: string,
    @Body() input: Parameters<DispatchService['revokeAssignment']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.revokeAssignment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('assignments/:id/compliance-checks')
  @Idempotent('tms.dispatch.compliance-check.v1')
  @RequirePermission('tms.dispatch.compliance')
  checkCompliance(
    @Param('id') id: string,
    @Body() input: Parameters<DispatchService['checkCompliance']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.checkCompliance(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/confirm')
  @HttpCode(200)
  @Idempotent('tms.dispatch.confirm.v1')
  @RequirePermission('tms.dispatch.confirm')
  confirmDispatch(
    @Param('id') id: string,
    @Body() input: Parameters<DispatchService['confirmDispatch']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.confirmDispatch(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
