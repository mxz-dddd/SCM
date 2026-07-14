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
import { FreightBillingService } from './freight-billing.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/tms/billing')
@UseGuards(PermissionGuard)
export class FreightBillingController {
  constructor(
    @Inject(FreightBillingService)
    private readonly service: FreightBillingService,
  ) {}
  @Get('workbench') @RequirePermission('tms.billing.read') workbench(
    @Req() request: TenantRequest,
  ) {
    return this.service.workbench(request.tenantContext);
  }
  @Post('shipments/:id/facts')
  @Idempotent('tms.billing.facts.v1')
  @RequirePermission('tms.billing.calculate')
  captureFacts(
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.captureFacts(
      id,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('shipments/:id/calculations')
  @Idempotent('tms.billing.calculate.v1')
  @RequirePermission('tms.billing.calculate')
  calculate(
    @Param('id') id: string,
    @Body() input: Parameters<FreightBillingService['calculate']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.calculate(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('calculations/:id/accruals')
  @Idempotent('tms.billing.accrual.v1')
  @RequirePermission('tms.billing.accrual')
  createAccrual(
    @Param('id') id: string,
    @Body() input: Parameters<FreightBillingService['createAccrual']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createAccrual(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('carrier-statements')
  @Idempotent('tms.billing.carrier-statement.v1')
  @RequirePermission('tms.billing.statement')
  createCarrierStatement(
    @Body() input: Parameters<FreightBillingService['createStatement']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createStatement(
      'PAYABLE',
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('customer-statements')
  @Idempotent('tms.billing.customer-statement.v1')
  @RequirePermission('tms.billing.statement')
  createCustomerStatement(
    @Body() input: Parameters<FreightBillingService['createStatement']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createStatement(
      'RECEIVABLE',
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('carrier-statements/:id/transition')
  @HttpCode(200)
  @Idempotent('tms.billing.carrier-transition.v1')
  @RequirePermission('tms.billing.statement')
  transitionCarrier(
    @Param('id') id: string,
    @Body() input: Parameters<FreightBillingService['transitionStatement']>[2],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionStatement(
      'PAYABLE',
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('customer-statements/:id/transition')
  @HttpCode(200)
  @Idempotent('tms.billing.customer-transition.v1')
  @RequirePermission('tms.billing.statement')
  transitionCustomer(
    @Param('id') id: string,
    @Body() input: Parameters<FreightBillingService['transitionStatement']>[2],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionStatement(
      'RECEIVABLE',
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('shipments/:id/settle')
  @HttpCode(200)
  @Idempotent('tms.billing.settle.v1')
  @RequirePermission('tms.billing.settle')
  settleShipment(
    @Param('id') id: string,
    @Body() input: Parameters<FreightBillingService['settleShipment']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.settleShipment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
