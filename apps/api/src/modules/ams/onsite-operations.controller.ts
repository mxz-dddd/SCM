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
import { OnsiteOperationsService } from './onsite-operations.service';

const meta = (request: TenantRequest, correlationId: string, key?: string) => ({
  correlationId,
  idempotencyKey: key,
  ipAddress: request.ip,
});

@Controller('api/v1/ams/onsite')
@UseGuards(PermissionGuard)
export class OnsiteOperationsController {
  constructor(
    @Inject(OnsiteOperationsService)
    private readonly service: OnsiteOperationsService,
  ) {}

  @Get('workbench')
  @RequirePermission('ams.onsite.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('gate/verifications')
  @Idempotent('ams.gate.verify.v1')
  @RequirePermission('ams.gate.verify')
  verifyGate(
    @Body() input: Parameters<OnsiteOperationsService['verifyGate']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.verifyGate(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('appointments/:id/gate-passes')
  @Idempotent('ams.gate.pass-issue.v1')
  @RequirePermission('ams.gate.verify')
  issuePass(
    @Param('id') id: string,
    @Body() input: Parameters<OnsiteOperationsService['issuePass']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.issuePass(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('gate/access-events')
  @Idempotent('ams.gate.access.v1')
  @RequirePermission('ams.gate.access')
  access(
    @Body() input: Parameters<OnsiteOperationsService['access']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.access(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('appointments/:id/queue')
  @Idempotent('ams.queue.enqueue.v1')
  @RequirePermission('ams.queue.manage')
  enqueue(
    @Param('id') id: string,
    @Body() input: Parameters<OnsiteOperationsService['enqueue']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.enqueue(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('queue/:id/call')
  @HttpCode(200)
  @Idempotent('ams.queue.call.v1')
  @RequirePermission('ams.queue.manage')
  call(
    @Param('id') id: string,
    @Body() input: Parameters<OnsiteOperationsService['call']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.call(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('queue/:id/acknowledge')
  @HttpCode(200)
  @Idempotent('ams.queue.ack.v1')
  @RequirePermission('ams.queue.manage')
  acknowledgeCall(
    @Param('id') id: string,
    @Body() input: Parameters<OnsiteOperationsService['acknowledgeCall']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.acknowledgeCall(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('queue/:id/timeout')
  @HttpCode(200)
  @Idempotent('ams.queue.timeout.v1')
  @RequirePermission('ams.queue.manage')
  timeoutCall(
    @Param('id') id: string,
    @Body() input: Parameters<OnsiteOperationsService['timeoutCall']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.timeoutCall(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('appointments/:id/dock-assignments')
  @Idempotent('ams.dock.assign.v1')
  @RequirePermission('ams.dock.assign')
  assignDock(
    @Param('id') id: string,
    @Body() input: Parameters<OnsiteOperationsService['assignDock']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.assignDock(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('appointments/:id/dock-switches')
  @HttpCode(200)
  @Idempotent('ams.dock.switch.v1')
  @RequirePermission('ams.dock.assign')
  switchDock(
    @Param('id') id: string,
    @Body() input: Parameters<OnsiteOperationsService['switchDock']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.switchDock(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('docks/:id/fault')
  @HttpCode(200)
  @Idempotent('ams.dock.fault.v1')
  @RequirePermission('ams.dock.assign')
  setDockFault(
    @Param('id') id: string,
    @Body() input: Parameters<OnsiteOperationsService['setDockFault']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.setDockFault(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
}
