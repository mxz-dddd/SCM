import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import { FulfillmentReleaseService, type AutoReleaseInput, type FulfillmentProgressInput, type ReleaseBatchInput, type ReleaseOrderInput } from './fulfillment-release.service';
const meta = (request: TenantRequest, correlationId: string, key?: string) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });
@Controller('api/v1/oms') @UseGuards(PermissionGuard)
export class FulfillmentReleaseController {
  constructor(@Inject(FulfillmentReleaseService) private readonly service: FulfillmentReleaseService) {}
  @Post('orders/:id/release') @HttpCode(200) @Idempotent('oms.order.release.v1') @RequirePermission('oms.order.release')
  release(@Param('id') id: string, @Body() input: ReleaseOrderInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) { return this.service.release(id, input, request.tenantContext, meta(request, correlationId, key)); }
  @Post('order-release-batches') @Idempotent('oms.order.release-batch.v1') @RequirePermission('oms.order.release.batch')
  batch(@Body() input: ReleaseBatchInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) { return this.service.batch(input, request.tenantContext, meta(request, correlationId, key)); }
  @Post('order-release-batches/automatic') @Idempotent('oms.order.release-auto.v1') @RequirePermission('oms.order.release.auto')
  automatic(@Body() input: AutoReleaseInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) { return this.service.automatic(input, request.tenantContext, meta(request, correlationId, key)); }
  @Post('fulfillment-orders/:id/status-events') @HttpCode(200) @Idempotent('oms.fulfillment.progress.v1') @RequirePermission('oms.fulfillment.project')
  progress(@Param('id') id: string, @Body() input: FulfillmentProgressInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) { return this.service.projectProgress(id, input, request.tenantContext, meta(request, correlationId, key)); }
}
