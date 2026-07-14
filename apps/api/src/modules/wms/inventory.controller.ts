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
import type { InventoryStockStatus } from '@prisma/client';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import {
  type CreateCountInput,
  type CreateHoldInput,
  type CreateReservationInput,
  InventoryService,
  type InventoryQuantityInput,
  type OwnershipTransferInput,
  type PostInventoryInput,
  type TransferInventoryInput,
  type TransitionInventoryInput,
} from './inventory.service';

function metadata(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}

@Controller('api/v1/wms')
@UseGuards(PermissionGuard)
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly service: InventoryService,
  ) {}

  @Get('inventory')
  @RequirePermission('wms.inventory.read')
  list(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('warehouseId') warehouseId: string | undefined,
    @Query('locationId') locationId: string | undefined,
    @Query('ownerId') ownerId: string | undefined,
    @Query('productId') productId: string | undefined,
    @Query('status') status: InventoryStockStatus | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.service.list(
      {
        ...(locationId ? { locationId } : {}),
        ...(ownerId ? { ownerId } : {}),
        ...(page ? { page: Number(page) } : {}),
        ...(pageSize ? { pageSize: Number(pageSize) } : {}),
        ...(productId ? { productId } : {}),
        ...(status ? { status } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      request.tenantContext,
    );
  }

  @Get('inventory/:id/trace')
  @RequirePermission('wms.inventory.trace')
  trace(@Param('id') id: string, @Req() request: TenantRequest) {
    return this.service.trace(id, request.tenantContext);
  }

  @Post('inventory/receipts')
  @Idempotent('wms.inventory.receive.v1')
  @RequirePermission('wms.inventory.receive')
  receive(
    @Body() input: PostInventoryInput,
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

  @Post('inventory/:id/status-transitions')
  @Idempotent('wms.inventory.status-transition.v1')
  @RequirePermission('wms.inventory.status.write')
  transition(
    @Param('id') id: string,
    @Body() input: TransitionInventoryInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionStatus(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory/:id/holds')
  @Idempotent('wms.inventory.hold.v1')
  @RequirePermission('wms.inventory.hold')
  hold(
    @Param('id') id: string,
    @Body() input: CreateHoldInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.hold(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory-holds/:id/release')
  @Idempotent('wms.inventory.hold-release.v1')
  @RequirePermission('wms.inventory.hold.release')
  releaseHold(
    @Param('id') id: string,
    @Body()
    input: {
      approvalReference?: string;
      expectedBalanceVersion: number;
      expectedVersion: number;
      reason: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.releaseHold(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory/:id/reservations')
  @Idempotent('wms.inventory.reserve.v1')
  @RequirePermission('wms.inventory.reserve')
  reserve(
    @Param('id') id: string,
    @Body() input: CreateReservationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.reserve(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory-reservations/:id/release')
  @Idempotent('wms.inventory.reservation-release.v1')
  @RequirePermission('wms.inventory.reserve.release')
  releaseReservation(
    @Param('id') id: string,
    @Body()
    input: {
      expectedBalanceVersion: number;
      expectedVersion: number;
      reason: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.releaseReservation(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory/:id/transfers')
  @Idempotent('wms.inventory.transfer.v1')
  @RequirePermission('wms.inventory.transfer')
  transfer(
    @Param('id') id: string,
    @Body() input: TransferInventoryInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transfer(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory/:id/ownership-transfers')
  @Idempotent('wms.inventory.ownership-transfer.v1')
  @RequirePermission('wms.inventory.owner-transfer')
  transferOwnership(
    @Param('id') id: string,
    @Body() input: OwnershipTransferInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transferOwnership(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory-counts')
  @Idempotent('wms.inventory.count-plan.v1')
  @RequirePermission('wms.inventory.count.plan')
  createCount(
    @Body() input: CreateCountInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createCount(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('inventory-counts/:id')
  @RequirePermission('wms.inventory.count.read')
  getCount(@Param('id') id: string, @Req() request: TenantRequest) {
    return this.service.getCount(id, request.tenantContext);
  }

  @Post('inventory-count-lines/:id/count')
  @Idempotent('wms.inventory.count-line.v1')
  @RequirePermission('wms.inventory.count.execute')
  countLine(
    @Param('id') id: string,
    @Body() input: InventoryQuantityInput & { reason?: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.countLine(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory-count-lines/:id/approve')
  @Idempotent('wms.inventory.count-approve.v1')
  @RequirePermission('wms.inventory.count.approve')
  approveCountLine(
    @Param('id') id: string,
    @Body()
    input: InventoryQuantityInput & {
      approvalReference: string;
      reason: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.approveCountLine(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory-counts/:id/transition')
  @Idempotent('wms.inventory.count-transition.v1')
  @RequirePermission('wms.inventory.count.execute')
  transitionCount(
    @Param('id') id: string,
    @Body()
    input: {
      expectedVersion: number;
      targetStatus: 'COUNTING' | 'REVIEWING' | 'POSTED' | 'CLOSED';
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionCount(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inventory-counts/:id/release-segment')
  @Idempotent('wms.inventory.count-release-segment.v1')
  @RequirePermission('wms.inventory.count.approve')
  releaseCountSegment(
    @Param('id') id: string,
    @Body() input: { locationId: string; reason: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.releaseCountSegment(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
