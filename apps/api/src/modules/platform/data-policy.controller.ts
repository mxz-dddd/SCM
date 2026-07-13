import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';
import {
  DataPolicyService,
  type CreateDataPolicyInput,
  type SimulateDataPolicyInput,
} from './data-policy.service';

@Controller('api/v1/platform/data-policies')
@UseGuards(PermissionGuard)
export class DataPolicyController {
  constructor(
    @Inject(DataPolicyService) private readonly policies: DataPolicyService,
  ) {}

  @Get()
  @RequirePermission('platform.policy.read')
  list(@Req() request: TenantRequest) {
    return this.policies.list(request.tenantContext);
  }

  @Post()
  @RequirePermission('platform.policy.write')
  create(
    @Body() input: CreateDataPolicyInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.policies.create(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('simulate')
  @HttpCode(200)
  @RequirePermission('platform.policy.read')
  simulate(
    @Body() input: SimulateDataPolicyInput,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.policies.decide(input, request.tenantContext, correlationId);
  }
}
