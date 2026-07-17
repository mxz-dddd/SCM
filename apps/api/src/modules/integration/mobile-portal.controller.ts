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
import type { IntegrationPortalPrincipalType } from '@prisma/client';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { WorkerAccessible } from '../platform/auth/worker-access.decorator';
import { Idempotent } from '../platform/idempotent.decorator';
import {
  MobilePortalService,
  type CreatePortalCommandInput,
  type ProjectPortalEventInput,
  type SavePortalGrantInput,
} from './mobile-portal.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  idempotencyKey?: string,
) => ({
  correlationId,
  idempotencyKey,
  ipAddress: request.ip,
});

@Controller('api/v1/integration/portal')
@UseGuards(PermissionGuard)
export class MobilePortalController {
  constructor(
    @Inject(MobilePortalService) private readonly service: MobilePortalService,
  ) {}

  @Get('administration')
  @RequirePermission('integration.portal.manage')
  administration(@Req() request: TenantRequest) {
    return this.service.administration(request.tenantContext);
  }

  @Get('workspace')
  @RequirePermission('integration.portal.read')
  portal(
    @Query('principalType')
    principalType: IntegrationPortalPrincipalType | undefined,
    @Query('principalRef') principalRef: string | undefined,
    @Query('query') query: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.service.portal(request.tenantContext, {
      ...(principalRef ? { principalRef } : {}),
      ...(principalType ? { principalType } : {}),
      ...(query ? { query } : {}),
    });
  }

  @Post('grants')
  @Idempotent('integration.portal-grant.save.v1')
  @RequirePermission('integration.portal.manage')
  saveGrant(
    @Body() input: SavePortalGrantInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.saveGrant(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('grants/:id/transition')
  @HttpCode(200)
  @Idempotent('integration.portal-grant.transition.v1')
  @RequirePermission('integration.portal.manage')
  transitionGrant(
    @Param('id') id: string,
    @Body() input: Parameters<MobilePortalService['transitionGrant']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionGrant(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('projections/events')
  @WorkerAccessible('INTEGRATION_PORTAL_EVENT_CONSUME')
  @HttpCode(200)
  @Idempotent('integration.portal-projection.consume.v1')
  @RequirePermission('integration.portal.project')
  project(
    @Body() input: ProjectPortalEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.project(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('commands')
  @Idempotent('integration.portal-command.create.v1')
  @RequirePermission('integration.portal.command')
  createCommand(
    @Body() input: CreatePortalCommandInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createCommand(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('commands/:id/dispatch')
  @HttpCode(200)
  @Idempotent('integration.portal-command.dispatch.v1')
  @RequirePermission('integration.portal.process')
  dispatchCommand(
    @Param('id') id: string,
    @Body() input: { readonly expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.dispatchCommand(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('commands/:id/complete')
  @HttpCode(200)
  @Idempotent('integration.portal-command.complete.v1')
  @RequirePermission('integration.portal.process')
  completeCommand(
    @Param('id') id: string,
    @Body() input: Parameters<MobilePortalService['completeCommand']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.completeCommand(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
