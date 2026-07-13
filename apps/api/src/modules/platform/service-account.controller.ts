import { Body, Controller, Headers, Inject, Post, Req } from '@nestjs/common';
import type { TenantRequest } from './auth/tenant-context.middleware';
import {
  ServiceAccountService,
  type CreateServiceAccountInput,
} from './service-account.service';

@Controller('api/v1/platform/service-accounts')
export class ServiceAccountController {
  constructor(
    @Inject(ServiceAccountService)
    private readonly serviceAccounts: ServiceAccountService,
  ) {}

  @Post()
  create(
    @Body() input: CreateServiceAccountInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.serviceAccounts.create(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }
}
