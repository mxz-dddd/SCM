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
import { DeliveryReverseService } from './delivery-reverse.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/tms/delivery')
@UseGuards(PermissionGuard)
export class DeliveryReverseController {
  constructor(
    @Inject(DeliveryReverseService)
    private readonly service: DeliveryReverseService,
  ) {}

  @Get('workbench') @RequirePermission('tms.delivery.read') workbench(
    @Req() request: TenantRequest,
  ) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('shipments/:id/confirm')
  @Idempotent('tms.delivery.confirm.v1')
  @RequirePermission('tms.delivery.confirm')
  confirmDelivery(
    @Param('id') id: string,
    @Body() input: Parameters<DeliveryReverseService['confirmDelivery']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.confirmDelivery(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/pod')
  @Idempotent('tms.delivery.pod-submit.v1')
  @RequirePermission('tms.pod.submit')
  submitPod(
    @Param('id') id: string,
    @Body() input: Parameters<DeliveryReverseService['submitPod']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.submitPod(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('pods/:id/review')
  @HttpCode(200)
  @Idempotent('tms.delivery.pod-review.v1')
  @RequirePermission('tms.pod.review')
  reviewPod(
    @Param('id') id: string,
    @Body() input: Parameters<DeliveryReverseService['reviewPod']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.reviewPod(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('pods/:id/supplement')
  @HttpCode(200)
  @Idempotent('tms.delivery.pod-supplement.v1')
  @RequirePermission('tms.pod.submit')
  supplementPod(
    @Param('id') id: string,
    @Body() input: Parameters<DeliveryReverseService['supplementPod']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.supplementPod(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/claims')
  @Idempotent('tms.delivery.claim-create.v1')
  @RequirePermission('tms.claim.manage')
  createClaim(
    @Param('id') id: string,
    @Body() input: Parameters<DeliveryReverseService['createClaim']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createClaim(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('claims/:id/transition')
  @HttpCode(200)
  @Idempotent('tms.delivery.claim-transition.v1')
  @RequirePermission('tms.claim.manage')
  transitionClaim(
    @Param('id') id: string,
    @Body() input: Parameters<DeliveryReverseService['transitionClaim']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionClaim(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipments/:id/returns')
  @Idempotent('tms.delivery.return-create.v1')
  @RequirePermission('tms.return.manage')
  createReturn(
    @Param('id') id: string,
    @Body() input: Parameters<DeliveryReverseService['createReturn']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createReturn(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
