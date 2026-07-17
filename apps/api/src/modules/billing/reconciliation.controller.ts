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
  type CreateBillingAdjustmentInput,
  type CreateReconciliationStatementInput,
  ReconciliationService,
} from './reconciliation.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/billing')
@UseGuards(PermissionGuard)
export class ReconciliationController {
  constructor(
    @Inject(ReconciliationService)
    private readonly service: ReconciliationService,
  ) {}

  @Post('reconciliation-statements')
  @Idempotent('billing.reconciliation.create.v1')
  @RequirePermission('billing.reconciliation.manage')
  createStatement(
    @Body() input: CreateReconciliationStatementInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createStatement(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('reconciliation-statements/:id/publish')
  @Idempotent('billing.reconciliation.publish.v1')
  @RequirePermission('billing.reconciliation.manage')
  publishStatement(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishStatement(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('reconciliation-statements/:id/reconcile')
  @Idempotent('billing.reconciliation.reconcile.v1')
  @RequirePermission('billing.reconciliation.manage')
  reconcileStatement(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.reconcileStatement(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('reconciliation-statements/:id/disputes')
  @Idempotent('billing.reconciliation.dispute.v1')
  @RequirePermission('billing.reconciliation.respond')
  raiseDispute(
    @Param('id') id: string,
    @Body()
    input: {
      category:
        'DUPLICATE' | 'MISSING' | 'QUANTITY' | 'RATE' | 'SERVICE' | 'TAX';
      description: string;
      disputedAmount: string;
      evidenceRefs?: readonly string[];
      expectedStatementVersion: number;
      raisedByType: 'FINANCE' | 'PARTNER';
      statementLineId?: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.raiseDispute(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('reconciliation-disputes/:id/respond')
  @Idempotent('billing.reconciliation.dispute-respond.v1')
  @RequirePermission('billing.reconciliation.respond')
  respondDispute(
    @Param('id') id: string,
    @Body()
    input: {
      action: 'ACCEPT' | 'REJECT' | 'REQUEST_EVIDENCE' | 'SUBMIT_EVIDENCE';
      evidenceRefs?: readonly string[];
      expectedVersion: number;
      message: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.respondDispute(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('adjustments')
  @Idempotent('billing.adjustment.create.v1')
  @RequirePermission('billing.adjustment.manage')
  createAdjustment(
    @Body() input: CreateBillingAdjustmentInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createAdjustment(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('adjustments/:id/submit')
  @Idempotent('billing.adjustment.submit.v1')
  @RequirePermission('billing.adjustment.manage')
  submitAdjustment(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.submitAdjustment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('adjustment-approvals/:id/decide')
  @Idempotent('billing.adjustment.approval-decide.v1')
  @RequirePermission('billing.adjustment.approve')
  decideAdjustment(
    @Param('id') id: string,
    @Body()
    input: {
      decision: 'APPROVE' | 'REJECT';
      expectedAdjustmentVersion: number;
      expectedTaskVersion: number;
      reason: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.decideAdjustment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('adjustments/:id/post')
  @Idempotent('billing.adjustment.post.v1')
  @RequirePermission('billing.adjustment.manage')
  postAdjustment(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.postAdjustment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
