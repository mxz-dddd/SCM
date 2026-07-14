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
import { AppError } from '../../common/app-error';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import type {
  CreateOrderChangeInput,
  CreateRmaInput,
} from './change-reverse.service';
import {
  type AssignExceptionInput,
  type BatchOrderCommandInput,
  type BatchExceptionInput,
  type CreateSettlementInput,
  type DetectExceptionsInput,
  type ExceptionActionInput,
  type ListExceptionsInput,
  type MonitorSlaInput,
  OrderOperationsService,
  type PortalPartnerInput,
  type ProjectSettlementInput,
  type ReportExceptionInput,
  type StartSlaInput,
  type TransitionSlaInput,
} from './order-operations.service';

function metadata(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}

@Controller('api/v1/oms')
@UseGuards(PermissionGuard)
export class OrderOperationsController {
  constructor(
    @Inject(OrderOperationsService)
    private readonly service: OrderOperationsService,
  ) {}
  @Get('order-exceptions') @RequirePermission('oms.exception.read') exceptions(
    @Query() input: ListExceptionsInput,
    @Req() request: TenantRequest,
  ) {
    return this.service.listExceptions(input, request.tenantContext);
  }
  @Post('order-exceptions/detect')
  @HttpCode(200)
  @Idempotent('oms.exception.detect.v1')
  @RequirePermission('oms.exception.write')
  detect(
    @Body() input: DetectExceptionsInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.detectExceptions(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('order-exceptions/report')
  @Idempotent('oms.exception.report.v1')
  @RequirePermission('oms.exception.write')
  reportException(
    @Body() input: ReportExceptionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.reportException(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('order-exceptions/batch')
  @HttpCode(200)
  @Idempotent('oms.exception.batch.v1')
  @RequirePermission('oms.exception.assign')
  batchExceptions(
    @Body() input: BatchExceptionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.batchExceptions(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('order-exceptions/:id/assign')
  @HttpCode(200)
  @Idempotent('oms.exception.assign.v1')
  @RequirePermission('oms.exception.assign')
  assign(
    @Param('id') id: string,
    @Body() input: AssignExceptionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.assignException(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('order-exceptions/:id/actions/:action')
  @HttpCode(200)
  @Idempotent('oms.exception.action.v1')
  @RequirePermission('oms.exception.retry')
  exceptionAction(
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() input: ExceptionActionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    const normalized = action.toUpperCase();
    if (!['RETRY', 'COMPENSATE', 'RESOLVE', 'CLOSE'].includes(normalized))
      throw new AppError(
        'ORDER_EXCEPTION_ACTION_INVALID',
        'Unsupported exception action',
        400,
      );
    return this.service.requestExceptionAction(
      id,
      normalized as 'RETRY' | 'COMPENSATE' | 'RESOLVE' | 'CLOSE',
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('orders/:id/sla-clocks')
  @Idempotent('oms.sla.start.v1')
  @RequirePermission('oms.sla.write')
  startSla(
    @Param('id') id: string,
    @Body() input: StartSlaInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.startSla(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('sla-clocks/monitor')
  @HttpCode(200)
  @Idempotent('oms.sla.monitor.v1')
  @RequirePermission('oms.sla.monitor')
  monitorSla(
    @Body() input: MonitorSlaInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.monitorSla(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('sla-clocks/:id/transition')
  @HttpCode(200)
  @Idempotent('oms.sla.transition.v1')
  @RequirePermission('oms.sla.write')
  transitionSla(
    @Param('id') id: string,
    @Body() input: TransitionSlaInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionSla(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('orders/:id/settlement-requests')
  @Idempotent('oms.settlement.request.v1')
  @RequirePermission('oms.settlement.write')
  settlement(
    @Param('id') id: string,
    @Body() input: CreateSettlementInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createSettlement(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('settlement-requests/:id/status')
  @HttpCode(200)
  @Idempotent('oms.settlement.project.v1')
  @RequirePermission('oms.settlement.project')
  projectSettlement(
    @Param('id') id: string,
    @Body() input: ProjectSettlementInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.projectSettlement(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('order-batches')
  @HttpCode(200)
  @Idempotent('oms.order.batch.v1')
  @RequirePermission('oms.order.batch')
  batch(
    @Body() input: BatchOrderCommandInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.batch(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Get('portal/orders/:id') @RequirePermission('oms.portal.order.read') portal(
    @Param('id') id: string,
    @Query() input: PortalPartnerInput,
    @Req() request: TenantRequest,
  ) {
    return this.service.portalView(id, input, request.tenantContext);
  }
  @Post('portal/orders/:id/changes')
  @Idempotent('oms.portal.order.change.v1')
  @RequirePermission('oms.portal.order.change')
  portalChange(
    @Param('id') id: string,
    @Query('partnerId') partnerId: string,
    @Body() input: CreateOrderChangeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.portalChange(
      id,
      partnerId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('portal/orders/:id/cancel')
  @HttpCode(200)
  @Idempotent('oms.portal.order.cancel.v1')
  @RequirePermission('oms.portal.order.cancel')
  portalCancel(
    @Param('id') id: string,
    @Query('partnerId') partnerId: string,
    @Body() input: { expectedVersion: number; reason: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.portalCancel(
      id,
      partnerId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('portal/orders/:id/rmas')
  @Idempotent('oms.portal.rma.create.v1')
  @RequirePermission('oms.portal.rma.write')
  portalRma(
    @Param('id') id: string,
    @Body() input: CreateRmaInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.portalRma(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
