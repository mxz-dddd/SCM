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
  type CreateSettlementVoucherInput,
  SettlementVoucherService,
} from './settlement-voucher.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({
  correlationId,
  idempotencyKey: key,
  ipAddress: request.ip,
});

@Controller('api/v1/billing')
@UseGuards(PermissionGuard)
export class SettlementVoucherController {
  constructor(
    @Inject(SettlementVoucherService)
    private readonly service: SettlementVoucherService,
  ) {}

  @Post('vouchers')
  @Idempotent('billing.voucher.create.v1')
  @RequirePermission('billing.voucher.manage')
  create(
    @Body() input: CreateSettlementVoucherInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createDraft(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('vouchers/:id/calculate')
  @Idempotent('billing.voucher.calculate.v1')
  @RequirePermission('billing.voucher.manage')
  calculate(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
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

  @Post('vouchers/:id/validate')
  @Idempotent('billing.voucher.validate.v1')
  @RequirePermission('billing.voucher.validate')
  validate(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.validate(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('voucher-approvals/:id/decide')
  @Idempotent('billing.voucher.approval-decide.v1')
  @RequirePermission('billing.voucher.approve')
  decide(
    @Param('id') id: string,
    @Body()
    input: {
      decision: 'APPROVE' | 'REJECT';
      expectedTaskVersion: number;
      expectedVoucherVersion: number;
      reason: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.decideApproval(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('calculations/:id/accruals')
  @Idempotent('billing.accrual.create.v1')
  @RequirePermission('billing.accrual.manage')
  createAccrual(
    @Param('id') id: string,
    @Body() input: { accountingDate: string },
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

  @Post('accruals/:id/post')
  @Idempotent('billing.accrual.post.v1')
  @RequirePermission('billing.accrual.manage')
  postAccrual(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.postAccrual(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
