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
  RoleService,
  type AssignRoleInput,
  type CreateRoleInput,
  type GrantPermissionsInput,
} from './role.service';

@Controller('api/v1/platform/roles')
@UseGuards(PermissionGuard)
export class RoleController {
  constructor(@Inject(RoleService) private readonly roles: RoleService) {}

  @Get()
  @RequirePermission('platform.role.read')
  list(@Req() request: TenantRequest) {
    return this.roles.list(request.tenantContext);
  }

  @Post()
  @RequirePermission('platform.role.write')
  create(
    @Body() input: CreateRoleInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.roles.create(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post(':roleId/grants')
  @HttpCode(200)
  @RequirePermission('platform.role.write')
  grant(
    @Param('roleId') roleId: string,
    @Body() input: GrantPermissionsInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.roles.grant(roleId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post(':roleId/assignments')
  @RequirePermission('platform.role.write')
  assign(
    @Param('roleId') roleId: string,
    @Body() input: AssignRoleInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.roles.assign(roleId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }
}
