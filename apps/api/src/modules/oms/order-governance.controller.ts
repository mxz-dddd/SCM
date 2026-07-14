import {
  Body,
  Controller,
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
  type MergeOrdersInput,
  OrderGovernanceService,
  type PlaceHoldInput,
  type ReleaseHoldInput,
  type ReviewDecisionInput,
  type ReviewOrderInput,
  type SetPriorityInput,
  type SplitOrderInput,
} from './order-governance.service';

function meta(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}

@Controller('api/v1/oms')
@UseGuards(PermissionGuard)
export class OrderGovernanceController {
  constructor(
    @Inject(OrderGovernanceService) private readonly service: OrderGovernanceService,
  ) {}

  @Post('orders/:id/review')
  @HttpCode(200)
  @Idempotent('oms.order.review.v1')
  @RequirePermission('oms.order.review')
  review(@Param('id') id: string, @Body() input: ReviewOrderInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.review(id, input, request.tenantContext, meta(request, correlationId, key));
  }

  @Post('order-reviews/:id/decision')
  @HttpCode(200)
  @Idempotent('oms.order.review-decision.v1')
  @RequirePermission('oms.order.approve')
  decide(@Param('id') id: string, @Body() input: ReviewDecisionInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.decideReview(id, input, request.tenantContext, meta(request, correlationId, key));
  }

  @Post('order-merge-groups')
  @Idempotent('oms.order.merge.v1')
  @RequirePermission('oms.order.adjust')
  merge(@Body() input: MergeOrdersInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.merge(input, request.tenantContext, meta(request, correlationId, key));
  }

  @Post('orders/:id/splits')
  @Idempotent('oms.order.split.v1')
  @RequirePermission('oms.order.adjust')
  split(@Param('id') id: string, @Body() input: SplitOrderInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.split(id, input, request.tenantContext, meta(request, correlationId, key));
  }

  @Post('orders/:id/priority')
  @HttpCode(200)
  @Idempotent('oms.order.priority.v1')
  @RequirePermission('oms.order.priority')
  priority(@Param('id') id: string, @Body() input: SetPriorityInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.setPriority(id, input, request.tenantContext, meta(request, correlationId, key));
  }

  @Post('orders/:id/holds')
  @Idempotent('oms.order.hold.v1')
  @RequirePermission('oms.order.hold')
  hold(@Param('id') id: string, @Body() input: PlaceHoldInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.hold(id, input, request.tenantContext, meta(request, correlationId, key));
  }

  @Post('order-holds/:id/release')
  @HttpCode(200)
  @Idempotent('oms.order.hold-release.v1')
  @RequirePermission('oms.order.hold.release')
  releaseHold(@Param('id') id: string, @Body() input: ReleaseHoldInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.releaseHold(id, input, request.tenantContext, meta(request, correlationId, key));
  }
}
