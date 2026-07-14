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
import {
  AtpAllocationService,
  type AllocateOrderInput,
  type ProjectAvailabilityInput,
  type PromiseAvailabilityInput,
  type ReleaseAllocationInput,
} from './atp-allocation.service';

const meta = (request: TenantRequest, correlationId: string, key?: string) => ({
  correlationId,
  idempotencyKey: key,
  ipAddress: request.ip,
});

@Controller('api/v1/oms')
@UseGuards(PermissionGuard)
export class AtpAllocationController {
  constructor(
    @Inject(AtpAllocationService)
    private readonly service: AtpAllocationService,
  ) {}

  @Post('availability-projections')
  @Idempotent('oms.availability.project.v1')
  @RequirePermission('oms.availability.project')
  project(
    @Body() input: ProjectAvailabilityInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.project(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Get('availability')
  @RequirePermission('oms.availability.read')
  list(
    @Query('productId') productId: string,
    @Query('ownerId') ownerId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.list(productId, ownerId, request.tenantContext);
  }

  @Post('availability-promises')
  @Idempotent('oms.availability.promise.v1')
  @RequirePermission('oms.availability.read')
  promise(
    @Body() input: PromiseAvailabilityInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.promise(
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('orders/:id/allocations')
  @HttpCode(200)
  @Idempotent('oms.order.allocate.v1')
  @RequirePermission('oms.order.allocate')
  allocate(
    @Param('id') id: string,
    @Body() input: AllocateOrderInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.allocate(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }

  @Post('allocations/:id/release')
  @HttpCode(200)
  @Idempotent('oms.allocation.release.v1')
  @RequirePermission('oms.allocation.release')
  release(
    @Param('id') id: string,
    @Body() input: ReleaseAllocationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.release(
      id,
      input,
      request.tenantContext,
      meta(request, correlationId, key),
    );
  }
}
