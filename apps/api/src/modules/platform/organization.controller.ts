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
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';
import {
  OrganizationService,
  type CreateOrganizationInput,
  type MoveOrganizationInput,
} from './organization.service';

@Controller('api/v1/platform/organizations')
@UseGuards(PermissionGuard)
export class OrganizationController {
  constructor(
    @Inject(OrganizationService)
    private readonly organizations: OrganizationService,
  ) {}

  @Get()
  @RequirePermission('platform.organization.read')
  list(@Req() request: TenantRequest) {
    return this.organizations.list(request.tenantContext);
  }

  @Post()
  @RequirePermission('platform.organization.write')
  create(
    @Body() input: CreateOrganizationInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.organizations.create(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post(':organizationId/moves')
  @HttpCode(202)
  @RequirePermission('platform.organization.write')
  move(
    @Param('organizationId') organizationId: string,
    @Body() input: MoveOrganizationInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.organizations.move(
      organizationId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }
}
