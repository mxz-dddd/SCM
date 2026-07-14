import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ShortageResolutionType } from '@prisma/client';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import { type CreateOutboundInput, OutboundService } from './outbound.service';

function metadata(request: TenantRequest, correlationId: string, key?: string) {
  return { correlationId, idempotencyKey: key, ipAddress: request.ip };
}

@Controller('api/v1/wms')
@UseGuards(PermissionGuard)
export class OutboundController {
  constructor(
    @Inject(OutboundService) private readonly service: OutboundService,
  ) {}

  @Get('outbounds')
  @RequirePermission('wms.outbound.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('outbounds')
  @Idempotent('wms.outbound.create.v1')
  @RequirePermission('wms.outbound.write')
  createOutbound(
    @Body() input: CreateOutboundInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createOutbound(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('outbounds/:id/release')
  @Idempotent('wms.outbound.release.v1')
  @RequirePermission('wms.outbound.release')
  releaseOutbound(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.releaseOutbound(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('wave-templates')
  @Idempotent('wms.outbound.wave-template.v1')
  @RequirePermission('wms.wave.template.write')
  saveWaveTemplate(
    @Body()
    input: {
      capacitySnapshot: Readonly<Record<string, unknown>>;
      criteria: Readonly<Record<string, unknown>>;
      name: string;
      strategy: Readonly<Record<string, unknown>>;
      warehouseId: string;
      workloadFactors: Readonly<Record<string, unknown>>;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.saveWaveTemplate(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('wave-templates/:id/simulate')
  @RequirePermission('wms.wave.plan')
  simulateWave(@Param('id') id: string, @Req() request: TenantRequest) {
    return this.service.simulateWave(id, request.tenantContext);
  }

  @Post('waves')
  @Idempotent('wms.outbound.wave-create.v1')
  @RequirePermission('wms.wave.plan')
  createWave(
    @Body()
    input: {
      cutoffAt: string;
      orderIds?: readonly string[];
      templateId: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createWave(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('waves/:id/transition')
  @Idempotent('wms.outbound.wave-transition.v1')
  @RequirePermission('wms.wave.release')
  transitionWave(
    @Param('id') id: string,
    @Body()
    input: {
      expectedVersion: number;
      targetStatus: 'PLANNED' | 'RELEASED' | 'COMPLETED';
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionWave(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('outbound-shortages/:id/resolve')
  @Idempotent('wms.outbound.shortage-resolve.v1')
  @RequirePermission('wms.outbound.shortage.resolve')
  resolveShortage(
    @Param('id') id: string,
    @Body()
    input: {
      expectedVersion: number;
      resolutionSnapshot: Readonly<Record<string, unknown>>;
      type: ShortageResolutionType;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.resolveShortage(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
