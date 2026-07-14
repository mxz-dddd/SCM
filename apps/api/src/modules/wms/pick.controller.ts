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
import { Idempotent } from '../platform/idempotent.decorator';
import { type PickScanInput, PickService } from './pick.service';

function metadata(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}

@Controller('api/v1/wms')
@UseGuards(PermissionGuard)
export class PickController {
  constructor(@Inject(PickService) private readonly service: PickService) {}

  @Get('picking')
  @RequirePermission('wms.picking.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('pick-tasks/:id/assign')
  @Idempotent('wms.picking.assign.v1')
  @RequirePermission('wms.picking.execute')
  assignTask(
    @Param('id') id: string,
    @Body() input: { assigneeId: string; containerCode: string; expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.assignTask(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('pick-tasks/:id/start')
  @Idempotent('wms.picking.start.v1')
  @RequirePermission('wms.picking.execute')
  startTask(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.startTask(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('pick-tasks/:id/replan')
  @Idempotent('wms.picking.replan.v1')
  @RequirePermission('wms.picking.supervise')
  replanRoute(
    @Param('id') id: string,
    @Body() input: { aisleDirection?: 'FORWARD' | 'REVERSE'; congestionSnapshot?: Readonly<Record<string, number>>; expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.replanRoute(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('pick-tasks/:id/scans')
  @Idempotent('wms.picking.scan.v1')
  @RequirePermission('wms.picking.execute')
  scan(
    @Param('id') id: string,
    @Body() input: PickScanInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.scan(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('pick-task-lines/:id/short-pick')
  @Idempotent('wms.picking.short-pick.v1')
  @RequirePermission('wms.picking.execute')
  shortPick(
    @Param('id') id: string,
    @Body() input: { expectedLineVersion: number; reason: string; reasonCode: string; shortBase: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.shortPick(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('short-picks/:id/resolve')
  @Idempotent('wms.picking.short-pick-resolve.v1')
  @RequirePermission('wms.picking.supervise')
  resolveShortPick(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number; resolutionSnapshot: Readonly<Record<string, unknown>>; type: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.resolveShortPick(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('pick-tasks/:id/verify')
  @Idempotent('wms.picking.verify.v1')
  @RequirePermission('wms.picking.verify')
  verifyTask(
    @Param('id') id: string,
    @Body() input: { actualSnapshot: Readonly<Record<string, unknown>>; expectedVersion: number; scopeRef: string; scopeType: 'ORDER' | 'CONTAINER' | 'PACKAGE' },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.verifyTask(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('pick-verifications/:id/correct')
  @Idempotent('wms.picking.correct.v1')
  @RequirePermission('wms.picking.verify')
  correctVerification(
    @Param('id') id: string,
    @Body() input: { actualSnapshot: Readonly<Record<string, unknown>>; correctionType: 'RETURN' | 'SUPPLEMENT' | 'REALLOCATE' },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.correctVerification(id, input, request.tenantContext, metadata(request, correlationId, key));
  }
}
