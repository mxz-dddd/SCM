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
import { type BuildPlanInput, PlanningService } from './planning.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/tms/planning')
@UseGuards(PermissionGuard)
export class PlanningController {
  constructor(
    @Inject(PlanningService) private readonly service: PlanningService,
  ) {}

  @Get('workbench')
  @RequirePermission('tms.planning.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('batches')
  @Idempotent('tms.planning.batch-create.v1')
  @RequirePermission('tms.planning.manage')
  createBatch(
    @Body() input: Parameters<PlanningService['createBatch']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createBatch(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('batches/:batchId/orders/:orderId/claim')
  @HttpCode(200)
  @Idempotent('tms.planning.order-claim.v1')
  @RequirePermission('tms.planning.claim')
  claimOrder(
    @Param('batchId') batchId: string,
    @Param('orderId') orderId: string,
    @Body() input: Parameters<PlanningService['claimOrder']>[2],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.claimOrder(
      batchId,
      orderId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('locks/:lockId/release')
  @HttpCode(200)
  @Idempotent('tms.planning.lock-release.v1')
  @RequirePermission('tms.planning.claim')
  releaseLock(
    @Param('lockId') lockId: string,
    @Body() input: Parameters<PlanningService['releaseLock']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.releaseLock(
      lockId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('batches/:batchId/plans')
  @Idempotent('tms.planning.plan-build.v1')
  @RequirePermission('tms.planning.manage')
  buildPlan(
    @Param('batchId') batchId: string,
    @Body() input: BuildPlanInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.buildPlan(
      batchId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('plans/:planId/validate')
  @HttpCode(200)
  @Idempotent('tms.planning.plan-validate.v1')
  @RequirePermission('tms.planning.manage')
  validatePlan(
    @Param('planId') planId: string,
    @Body() input: Parameters<PlanningService['validatePlan']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.validatePlan(
      planId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('plans/:planId/publish')
  @HttpCode(200)
  @Idempotent('tms.planning.plan-publish.v1')
  @RequirePermission('tms.planning.publish')
  publishPlan(
    @Param('planId') planId: string,
    @Body() input: Parameters<PlanningService['publishPlan']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishPlan(
      planId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
