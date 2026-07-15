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
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import { CapacityWorkloadService } from './capacity-workload.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/ams')
@UseGuards(PermissionGuard)
export class CapacityWorkloadController {
  constructor(
    @Inject(CapacityWorkloadService)
    private readonly service: CapacityWorkloadService,
  ) {}

  @Get('capacity/workbench')
  @RequirePermission('ams.capacity.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Get('slots')
  @RequirePermission('ams.capacity.read')
  slots(
    @Query()
    query: Parameters<CapacityWorkloadService['slots']>[0],
    @Req() request: TenantRequest,
  ) {
    return this.service.slots(query, request.tenantContext);
  }

  @Post('capacity-profiles')
  @Idempotent('ams.capacity.profile-create.v1')
  @RequirePermission('ams.capacity.manage')
  createProfile(
    @Body() input: Parameters<CapacityWorkloadService['createProfile']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createProfile(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('capacity-profiles/:id/publish')
  @HttpCode(200)
  @Idempotent('ams.capacity.profile-publish.v1')
  @RequirePermission('ams.capacity.manage')
  publishProfile(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityWorkloadService['publishProfile']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishProfile(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('slots/generate')
  @Idempotent('ams.capacity.slot-generate.v1')
  @RequirePermission('ams.capacity.manage')
  generateSlots(
    @Body() input: Parameters<CapacityWorkloadService['generateSlots']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.generateSlots(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('slots/:id/change')
  @HttpCode(200)
  @Idempotent('ams.capacity.slot-change.v1')
  @RequirePermission('ams.capacity.manage')
  changeSlot(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityWorkloadService['changeSlot']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.changeSlot(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('workload-rules')
  @Idempotent('ams.workload.rule-create.v1')
  @RequirePermission('ams.workload.manage')
  createWorkloadRule(
    @Body()
    input: Parameters<CapacityWorkloadService['createWorkloadRule']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createWorkloadRule(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('workload-rules/:id/publish')
  @HttpCode(200)
  @Idempotent('ams.workload.rule-publish.v1')
  @RequirePermission('ams.workload.manage')
  publishWorkloadRule(
    @Param('id') id: string,
    @Body()
    input: Parameters<CapacityWorkloadService['publishWorkloadRule']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishWorkloadRule(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('workload-estimates')
  @Idempotent('ams.workload.estimate.v1')
  @RequirePermission('ams.workload.calculate')
  estimate(
    @Body() input: Parameters<CapacityWorkloadService['estimate']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.estimate(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('workload-estimates/:id/adjust')
  @Idempotent('ams.workload.adjust.v1')
  @RequirePermission('ams.workload.adjust')
  adjustEstimate(
    @Param('id') id: string,
    @Body() input: Parameters<CapacityWorkloadService['adjustEstimate']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.adjustEstimate(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
