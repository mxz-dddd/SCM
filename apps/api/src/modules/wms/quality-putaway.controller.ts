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
import {
  type ConfirmPutawayInput,
  type CreateCrossDockInput,
  type CreateInspectionInput,
  type CreatePutawayTaskInput,
  type DecidePutawayInput,
  type DispositionInput,
  QualityPutawayService,
  type TransitionInspectionInput,
} from './quality-putaway.service';

function metadata(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}

@Controller('api/v1/wms')
@UseGuards(PermissionGuard)
export class QualityPutawayController {
  constructor(
    @Inject(QualityPutawayService)
    private readonly service: QualityPutawayService,
  ) {}

  @Get('inbounds/:id/quality-putaway')
  @RequirePermission('wms.quality.read')
  get(@Param('id') id: string, @Req() request: TenantRequest) {
    return this.service.get(id, request.tenantContext);
  }

  @Post('inbounds/:id/inspections')
  @Idempotent('wms.quality-inspection.create.v1')
  @RequirePermission('wms.quality.plan')
  inspection(
    @Param('id') id: string,
    @Body() input: CreateInspectionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createInspection(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inspections/:id/transition')
  @HttpCode(200)
  @Idempotent('wms.quality-inspection.transition.v1')
  @RequirePermission('wms.quality.inspect')
  transitionInspection(
    @Param('id') id: string,
    @Body() input: TransitionInspectionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionInspection(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inspections/:id/dispositions')
  @Idempotent('wms.quality-disposition.create.v1')
  @RequirePermission('wms.quality.dispose')
  disposition(
    @Param('id') id: string,
    @Body() input: DispositionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.dispose(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inbounds/:id/putaway-decisions')
  @Idempotent('wms.putaway-decision.create.v1')
  @RequirePermission('wms.putaway.decide')
  decide(
    @Param('id') id: string,
    @Body() input: DecidePutawayInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.decidePutaway(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('putaway-decisions/:id/tasks')
  @Idempotent('wms.putaway-task.create.v1')
  @RequirePermission('wms.putaway.task.write')
  task(
    @Param('id') id: string,
    @Body() input: CreatePutawayTaskInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createPutawayTask(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('putaway-tasks/:id/start')
  @HttpCode(200)
  @Idempotent('wms.putaway-task.start.v1')
  @RequirePermission('wms.putaway.task.execute')
  start(
    @Param('id') id: string,
    @Body() input: { assignedTo?: string; expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.startPutawayTask(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('putaway-tasks/:id/confirm')
  @HttpCode(200)
  @Idempotent('wms.putaway-task.confirm.v1')
  @RequirePermission('wms.putaway.task.execute')
  confirm(
    @Param('id') id: string,
    @Body() input: ConfirmPutawayInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.confirmPutaway(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inbounds/:id/cross-dock-allocations')
  @Idempotent('wms.cross-dock.create.v1')
  @RequirePermission('wms.cross-dock.write')
  crossDock(
    @Param('id') id: string,
    @Body() input: CreateCrossDockInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createCrossDock(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('cross-dock-allocations/:id/transition')
  @HttpCode(200)
  @Idempotent('wms.cross-dock.transition.v1')
  @RequirePermission('wms.cross-dock.write')
  transitionCrossDock(
    @Param('id') id: string,
    @Body()
    input: {
      expectedVersion: number;
      targetStatus: 'RESERVED' | 'COMPLETED' | 'CANCELLED';
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionCrossDock(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
