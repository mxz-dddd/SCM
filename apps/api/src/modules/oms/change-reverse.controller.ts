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
  ChangeReverseService,
  type CancelOrderInput,
  type ConfirmChangeInput,
  type CreateOrderChangeInput,
  type CreateRmaInput,
  type DecideSubstitutionInput,
  type ExpireSubstitutionsInput,
  type ProgressInput,
  type ProposeSubstitutionInput,
  type TransitionRmaInput,
} from './change-reverse.service';

function metadata(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}

@Controller('api/v1/oms')
@UseGuards(PermissionGuard)
export class ChangeReverseController {
  constructor(
    @Inject(ChangeReverseService)
    private readonly service: ChangeReverseService,
  ) {}

  @Post('orders/:id/changes')
  @Idempotent('oms.order.change.v1')
  @RequirePermission('oms.order.change')
  createChange(
    @Param('id') id: string,
    @Body() input: CreateOrderChangeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createChange(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('order-changes/:id/confirmations')
  @HttpCode(200)
  @Idempotent('oms.order.change-confirm.v1')
  @RequirePermission('oms.order.change.confirm')
  confirmChange(
    @Param('id') id: string,
    @Body() input: ConfirmChangeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.confirmChange(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @Idempotent('oms.order.cancel.v1')
  @RequirePermission('oms.order.cancel')
  cancel(
    @Param('id') id: string,
    @Body() input: CancelOrderInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.cancel(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('orders/:id/lines/:lineId/progress')
  @HttpCode(200)
  @Idempotent('oms.order.progress.v1')
  @RequirePermission('oms.fulfillment.project')
  progress(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() input: ProgressInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.progress(
      id,
      lineId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('orders/:id/lines/:lineId/substitutions')
  @Idempotent('oms.substitution.propose.v1')
  @RequirePermission('oms.substitution.write')
  proposeSubstitution(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() input: ProposeSubstitutionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.proposeSubstitution(
      id,
      lineId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('substitutions/:id/decision')
  @HttpCode(200)
  @Idempotent('oms.substitution.decision.v1')
  @RequirePermission('oms.substitution.decide')
  decideSubstitution(
    @Param('id') id: string,
    @Body() input: DecideSubstitutionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.decideSubstitution(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('substitutions/expire')
  @HttpCode(200)
  @Idempotent('oms.substitution.expire.v1')
  @RequirePermission('oms.substitution.write')
  expireSubstitutions(
    @Body() input: ExpireSubstitutionsInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.expireSubstitutions(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('orders/:id/rmas')
  @Idempotent('oms.rma.create.v1')
  @RequirePermission('oms.rma.write')
  createRma(
    @Param('id') id: string,
    @Body() input: CreateRmaInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createRma(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('rmas/:id/transition')
  @HttpCode(200)
  @Idempotent('oms.rma.transition.v1')
  @RequirePermission('oms.rma.transition')
  transitionRma(
    @Param('id') id: string,
    @Body() input: TransitionRmaInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionRma(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
