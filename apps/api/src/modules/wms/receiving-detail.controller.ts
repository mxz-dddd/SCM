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
import type { ReceiptMode } from '@prisma/client';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import {
  type BuildHandlingUnitInput,
  type CreateHandlingUnitInput,
  type DispositionInput,
  type MergeHandlingUnitInput,
  type ReceiveInput,
  ReceivingDetailService,
  type SplitHandlingUnitInput,
  type VarianceInput,
} from './receiving-detail.service';

function metadata(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}

@Controller('api/v1/wms')
@UseGuards(PermissionGuard)
export class ReceivingDetailController {
  constructor(
    @Inject(ReceivingDetailService)
    private readonly service: ReceivingDetailService,
  ) {}

  @Get('inbounds/:id/receiving-preview')
  @RequirePermission('wms.receipt.read')
  preview(
    @Param('id') id: string,
    @Query('mode') mode: ReceiptMode,
    @Req() request: TenantRequest,
  ) {
    return this.service.preview(id, mode, request.tenantContext);
  }

  @Get('inbounds/:id/receiving-detail')
  @RequirePermission('wms.receipt.read')
  get(@Param('id') id: string, @Req() request: TenantRequest) {
    return this.service.get(id, request.tenantContext);
  }

  @Post('inbounds/:id/receive')
  @Idempotent('wms.receiving.confirm.v1')
  @RequirePermission('wms.receipt.receive')
  receive(
    @Param('id') id: string,
    @Body() input: ReceiveInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.receive(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('inbounds/:id/receive-authorized')
  @Idempotent('wms.receiving.authorized-confirm.v1')
  @RequirePermission('wms.receipt.variance.authorize')
  receiveAuthorized(
    @Param('id') id: string,
    @Body() input: ReceiveInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.receive(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
      true,
    );
  }

  @Post('inbounds/:id/handling-units')
  @Idempotent('wms.handling-unit.create.v1')
  @RequirePermission('wms.handling-unit.write')
  createHandlingUnit(
    @Param('id') id: string,
    @Body() input: CreateHandlingUnitInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createHandlingUnit(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('handling-units/:id/build')
  @HttpCode(200)
  @Idempotent('wms.handling-unit.build.v1')
  @RequirePermission('wms.handling-unit.build')
  build(
    @Param('id') id: string,
    @Body() input: BuildHandlingUnitInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.buildHandlingUnit(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('handling-units/:id/split')
  @HttpCode(200)
  @Idempotent('wms.handling-unit.split.v1')
  @RequirePermission('wms.handling-unit.split')
  split(
    @Param('id') id: string,
    @Body() input: SplitHandlingUnitInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.splitHandlingUnit(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('handling-units/:id/merge')
  @HttpCode(200)
  @Idempotent('wms.handling-unit.merge.v1')
  @RequirePermission('wms.handling-unit.merge')
  merge(
    @Param('id') id: string,
    @Body() input: MergeHandlingUnitInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.mergeHandlingUnit(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('handling-units/:id/labels/reprint')
  @Idempotent('wms.handling-unit.label-reprint.v1')
  @RequirePermission('wms.label.print')
  reprint(
    @Param('id') id: string,
    @Body() input: { copies?: number; reason: string },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.reprintLabel(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('receiving-variances')
  @Idempotent('wms.receiving-variance.create.v1')
  @RequirePermission('wms.receiving.variance.write')
  variance(
    @Body() input: VarianceInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.openVariance(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('receiving-variances/:id/disposition')
  @HttpCode(200)
  @Idempotent('wms.receiving-variance.disposition.v1')
  @RequirePermission('wms.receiving.variance.dispose')
  disposition(
    @Param('id') id: string,
    @Body() input: DispositionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.disposeVariance(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
