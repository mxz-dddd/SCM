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
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import { PackShipService } from './pack-ship.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/wms')
@UseGuards(PermissionGuard)
export class PackShipController {
  constructor(
    @Inject(PackShipService) private readonly service: PackShipService,
  ) {}

  @Get('pack-ship')
  @RequirePermission('wms.pack-ship.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('outbounds/:id/pack-tasks')
  @Idempotent('wms.pack.create.v1')
  @RequirePermission('wms.pack.execute')
  createPackTask(
    @Param('id') id: string,
    @Body() input: Parameters<PackShipService['createPackTask']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createPackTask(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('packages/:id/measurements')
  @Idempotent('wms.pack.measure.v1')
  @RequirePermission('wms.pack.execute')
  measurePackage(
    @Param('id') id: string,
    @Body() input: Parameters<PackShipService['measurePackage']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.measurePackage(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('weight-exceptions/:id/resolve')
  @Idempotent('wms.pack.exception-resolve.v1')
  @RequirePermission('wms.pack.supervise')
  resolveWeightException(
    @Param('id') id: string,
    @Body() input: Parameters<PackShipService['resolveWeightException']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.resolveWeightException(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('packages/:id/seal')
  @Idempotent('wms.pack.seal.v1')
  @RequirePermission('wms.pack.execute')
  sealPackage(
    @Param('id') id: string,
    @Body() input: Parameters<PackShipService['sealPackage']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.sealPackage(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('packages/:id/labels')
  @Idempotent('wms.pack.label-issue.v1')
  @RequirePermission('wms.pack.label')
  issueLabel(
    @Param('id') id: string,
    @Body() input: Parameters<PackShipService['issueLabel']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.issueLabel(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('shipping-labels/:id/void')
  @Idempotent('wms.pack.label-void.v1')
  @RequirePermission('wms.pack.label')
  voidLabel(
    @Param('id') id: string,
    @Body() input: Parameters<PackShipService['voidLabel']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.voidLabel(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('packages/:id/stage')
  @Idempotent('wms.ship.stage.v1')
  @RequirePermission('wms.ship.stage')
  stagePackage(
    @Param('id') id: string,
    @Body() input: Parameters<PackShipService['stagePackage']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.stagePackage(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('outbounds/:id/load-tasks')
  @Idempotent('wms.ship.load-create.v1')
  @RequirePermission('wms.ship.load')
  createLoadTask(
    @Param('id') id: string,
    @Body() input: Parameters<PackShipService['createLoadTask']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createLoadTask(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('load-tasks/:id/confirm')
  @Idempotent('wms.ship.load-confirm.v1')
  @RequirePermission('wms.ship.load')
  confirmLoad(
    @Param('id') id: string,
    @Body() input: Parameters<PackShipService['confirmLoad']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.confirmLoad(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('load-tasks/:id/ship')
  @Idempotent('wms.ship.confirm.v1')
  @RequirePermission('wms.ship.confirm')
  ship(
    @Param('id') id: string,
    @Body() input: Parameters<PackShipService['ship']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.ship(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('outbounds/:id/cancel')
  @Idempotent('wms.ship.cancel.v1')
  @RequirePermission('wms.ship.cancel')
  cancelOutbound(
    @Param('id') id: string,
    @Body() input: Parameters<PackShipService['cancelOutbound']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.cancelOutbound(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
