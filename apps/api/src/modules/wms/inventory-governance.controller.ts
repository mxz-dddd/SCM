import {
  Body,
  Controller,
  Get,
  Headers,
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
  type CreateAdjustmentInput,
  InventoryGovernanceService,
  type SaveReplenishmentPolicyInput,
} from './inventory-governance.service';

function metadata(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}

@Controller('api/v1/wms')
@UseGuards(PermissionGuard)
export class InventoryGovernanceController {
  constructor(
    @Inject(InventoryGovernanceService)
    private readonly service: InventoryGovernanceService,
  ) {}

  @Get('inventory-governance')
  @RequirePermission('wms.inventory.governance.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('inventory-adjustments')
  @Idempotent('wms.inventory.adjustment-create.v1')
  @RequirePermission('wms.inventory.adjust.write')
  createAdjustment(
    @Body() input: CreateAdjustmentInput,
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

  @Post('inventory-adjustments/:id/transition')
  @Idempotent('wms.inventory.adjustment-transition.v1')
  @RequirePermission('wms.inventory.adjust.approve')
  transitionAdjustment(
    @Param('id') id: string,
    @Body()
    input: {
      approvalReference?: string;
      direction?: 'INCREASE' | 'DECREASE';
      expectedBalanceVersion?: number;
      expectedVersion: number;
      targetStatus: 'PENDING_APPROVAL' | 'APPROVED' | 'POSTED' | 'REJECTED';
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionAdjustment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('replenishment-policies')
  @Idempotent('wms.inventory.replenishment-policy.v1')
  @RequirePermission('wms.inventory.replenishment.plan')
  saveReplenishmentPolicy(
    @Body() input: SaveReplenishmentPolicyInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.saveReplenishmentPolicy(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('replenishment-policies/:id/plan')
  @Idempotent('wms.inventory.replenishment-plan.v1')
  @RequirePermission('wms.inventory.replenishment.plan')
  planReplenishment(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number; waveDemandBase?: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.planReplenishment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('replenishment-tasks/:id/execute')
  @Idempotent('wms.inventory.replenishment-execute.v1')
  @RequirePermission('wms.inventory.replenishment.execute')
  executeReplenishment(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.executeReplenishment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory-aging-runs')
  @Idempotent('wms.inventory.aging-run.v1')
  @RequirePermission('wms.inventory.aging.run')
  runAging(
    @Body()
    input: {
      agedDays?: number;
      asOfDate?: string;
      nearExpiryDays?: number;
      warehouseId: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.runAging(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('inventory-genealogy')
  @RequirePermission('wms.inventory.trace')
  genealogy(
    @Query('inventoryLotId') inventoryLotId: string | undefined,
    @Query('serialNumber') serialNumber: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.service.genealogy(
      {
        ...(inventoryLotId ? { inventoryLotId } : {}),
        ...(serialNumber ? { serialNumber } : {}),
      },
      request.tenantContext,
    );
  }

  @Post('inventory-reconciliations')
  @Idempotent('wms.inventory.reconciliation-create.v1')
  @RequirePermission('wms.inventory.reconcile')
  reconcile(
    @Body()
    input: {
      erpClosingBase: string;
      ownerId?: string;
      periodEnd: string;
      periodStart: string;
      warehouseId: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.reconcile(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory-reconciliation-cases/:id/resolve')
  @Idempotent('wms.inventory.reconciliation-case-resolve.v1')
  @RequirePermission('wms.inventory.reconcile.resolve')
  resolveReconciliationCase(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number; resolution: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.resolveReconciliationCase(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory-reconciliations/:id/close')
  @Idempotent('wms.inventory.reconciliation-close.v1')
  @RequirePermission('wms.inventory.reconcile')
  closeReconciliation(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.closeReconciliation(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
