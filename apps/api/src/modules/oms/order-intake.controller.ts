import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import {
  type ListOrdersInput,
  OrderIntakeService,
  type SaveOrderInput,
  type SubmitOrderInput,
  type UpdateOrderInput,
} from './order-intake.service';

function metadata(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}

@Controller('api/v1/oms/orders')
@UseGuards(PermissionGuard)
export class OrderIntakeController {
  constructor(@Inject(OrderIntakeService) private readonly service: OrderIntakeService) {}

  @Get()
  @RequirePermission('oms.order.read')
  list(@Query() input: ListOrdersInput, @Req() request: TenantRequest) {
    return this.service.list(input, request.tenantContext);
  }

  @Get(':id')
  @RequirePermission('oms.order.read')
  get(@Param('id') id: string, @Req() request: TenantRequest) {
    return this.service.get(id, request.tenantContext);
  }

  @Post()
  @Idempotent('oms.order.create.v1')
  @RequirePermission('oms.order.write')
  create(
    @Body() input: SaveOrderInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.create(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Put(':id')
  @Idempotent('oms.order.update.v1')
  @RequirePermission('oms.order.write')
  update(
    @Param('id') id: string,
    @Body() input: UpdateOrderInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.update(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Idempotent('oms.order.submit.v1')
  @RequirePermission('oms.order.submit')
  submit(
    @Param('id') id: string,
    @Body() input: SubmitOrderInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.submit(
      id,
      input,
      false,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post(':id/submit-with-warnings')
  @HttpCode(200)
  @Idempotent('oms.order.submit-with-warnings.v1')
  @RequirePermission('oms.order.warning.override')
  submitWithWarnings(
    @Param('id') id: string,
    @Body() input: SubmitOrderInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.submit(
      id,
      input,
      true,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
