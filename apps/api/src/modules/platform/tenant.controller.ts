import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { TenantRequest } from './auth/tenant-context.middleware';
import {
  TenantService,
  type ProvisionTenantInput,
  type TransitionTenantInput,
} from './tenant.service';

@Controller('api/v1/platform/tenants')
export class TenantController {
  constructor(@Inject(TenantService) private readonly tenants: TenantService) {}

  @Post()
  provision(
    @Body() input: ProvisionTenantInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.tenants.provision(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post(':tenantId/transitions')
  @HttpCode(200)
  transition(
    @Param('tenantId') tenantId: string,
    @Body() input: TransitionTenantInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.tenants.transition(tenantId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }
}
