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
  type ReceiveTransportOrderInput,
  type ReviewTransportOrderInput,
  TransportOrderService,
} from './transport-order.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({
  correlationId,
  idempotencyKey: key,
  ipAddress: request.ip,
});

@Controller('api/v1/tms/transport-orders')
@UseGuards(PermissionGuard)
export class TransportOrderController {
  constructor(
    @Inject(TransportOrderService)
    private readonly service: TransportOrderService,
  ) {}

  @Get()
  @RequirePermission('tms.transport.read')
  list(
    @Query()
    input: {
      page?: string;
      pageSize?: string;
      query?: string;
      status?: string;
      type?: string;
    },
    @Req() request: TenantRequest,
  ) {
    return this.service.list(input, request.tenantContext);
  }

  @Get(':id')
  @RequirePermission('tms.transport.read')
  get(@Param('id') id: string, @Req() request: TenantRequest) {
    return this.service.get(id, request.tenantContext);
  }

  @Post()
  @Idempotent('tms.transport-order.receive.v1')
  @RequirePermission('tms.transport.receive')
  receive(
    @Body() input: ReceiveTransportOrderInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.receive(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post(':id/review')
  @HttpCode(200)
  @Idempotent('tms.transport-order.review.v1')
  @RequirePermission('tms.transport.review')
  review(
    @Param('id') id: string,
    @Body() input: ReviewTransportOrderInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.review(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
