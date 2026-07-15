import {
  Body,
  Controller,
  Headers,
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
  type CreateBillingInvoiceInput,
  FinancialCloseService,
} from './financial-close.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/billing')
@UseGuards(PermissionGuard)
export class FinancialCloseController {
  constructor(
    @Inject(FinancialCloseService)
    private readonly service: FinancialCloseService,
  ) {}

  @Post('invoices')
  @Idempotent('billing.invoice.create.v1')
  @RequirePermission('billing.invoice.manage')
  createInvoice(
    @Body() input: CreateBillingInvoiceInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createInvoice(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('invoices/:id/credit-notes')
  @Idempotent('billing.invoice.credit-note.v1')
  @RequirePermission('billing.invoice.manage')
  createCreditNote(
    @Param('id') id: string,
    @Body()
    input: {
      attachmentRefs?: readonly string[];
      invoiceDate: string;
      invoiceNo: string;
      lines: readonly { amount: string; originalInvoiceLineId: string }[];
      reason: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createCreditNote(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('payments')
  @Idempotent('billing.payment.register.v1')
  @RequirePermission('billing.payment.manage')
  registerPayment(
    @Body()
    input: {
      amount: string;
      counterpartyRef: string;
      currency: string;
      direction: 'PAYABLE' | 'RECEIVABLE';
      externalRef: string;
      paymentType: 'FEE' | 'NORMAL' | 'REFUND' | 'UNMATCHED';
      source: 'ERP' | 'MANUAL';
      sourceSnapshot?: Record<string, unknown>;
      transactionDate: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.registerPayment(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('payments/:id/allocations')
  @Idempotent('billing.payment.allocate.v1')
  @RequirePermission('billing.payment.manage')
  allocatePayment(
    @Param('id') id: string,
    @Body()
    input: {
      allocations: readonly {
        amount: string;
        feeAmount?: string;
        targetRef: string;
        targetType: 'INVOICE' | 'VOUCHER';
      }[];
      expectedVersion: number;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.allocatePayment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('periods')
  @Idempotent('billing.period.create.v1')
  @RequirePermission('billing.period.close')
  createPeriod(
    @Body() input: { periodFrom: string; periodKey: string; periodTo: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createPeriod(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('periods/:id/start-close')
  @Idempotent('billing.period.start-close.v1')
  @RequirePermission('billing.period.close')
  startPeriodClose(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.startPeriodClose(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('periods/:id/close')
  @Idempotent('billing.period.close.v1')
  @RequirePermission('billing.period.close')
  closePeriod(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.closePeriod(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('periods/:id/reopen')
  @Idempotent('billing.period.reopen.v1')
  @RequirePermission('billing.period.reopen')
  reopenPeriod(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number; reason: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.reopenPeriod(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('settlement-reports')
  @Idempotent('billing.settlement-report.generate.v1')
  @RequirePermission('billing.report.generate')
  generateReport(
    @Body()
    input: {
      currency: string;
      dimensionType: 'ORDER' | 'PARTNER' | 'ROUTE' | 'SERVICE' | 'WAREHOUSE';
      periodFrom: string;
      periodTo: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.generateReport(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
