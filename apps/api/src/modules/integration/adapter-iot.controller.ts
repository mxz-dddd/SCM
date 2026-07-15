import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import {
  AdapterIotService,
  type CreateAdapterInput,
  type CreateAdapterVersionInput,
  type DeviceCommandAckInput,
  type DeviceHeartbeatInput,
  type DeviceTelemetryInput,
  type RegisterDeviceInput,
  type SubmitAdapterCommandInput,
} from './adapter-iot.service';

const metadata = (request: TenantRequest, correlationId: string, idempotencyKey?: string) => ({
  correlationId,
  idempotencyKey,
  ipAddress: request.ip,
});

@Controller('api/v1/integration/adapter-iot')
@UseGuards(PermissionGuard)
export class AdapterIotController {
  constructor(@Inject(AdapterIotService) private readonly service: AdapterIotService) {}

  @Get('workbench')
  @RequirePermission('integration.adapter-iot.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('adapters')
  @Idempotent('integration.adapter.create.v1')
  @RequirePermission('integration.adapter.manage')
  createAdapter(@Body() input: CreateAdapterInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.createAdapter(input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('adapters/:id/versions')
  @Idempotent('integration.adapter-version.create.v1')
  @RequirePermission('integration.adapter.manage')
  createAdapterVersion(@Param('id') id: string, @Body() input: CreateAdapterVersionInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.createAdapterVersion(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('adapter-versions/:id/test')
  @HttpCode(200)
  @Idempotent('integration.adapter-version.test.v1')
  @RequirePermission('integration.adapter.manage')
  testAdapterVersion(@Param('id') id: string, @Body() input: { readonly expectedVersion: number }, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.testAdapterVersion(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('adapter-versions/:id/publish')
  @HttpCode(200)
  @Idempotent('integration.adapter-version.publish.v1')
  @RequirePermission('integration.adapter.manage')
  publishAdapterVersion(@Param('id') id: string, @Body() input: { readonly expectedVersion: number }, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.publishAdapterVersion(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('adapters/:id/transition')
  @HttpCode(200)
  @Idempotent('integration.adapter.transition.v1')
  @RequirePermission('integration.adapter.manage')
  transitionAdapter(@Param('id') id: string, @Body() input: Parameters<AdapterIotService['transitionAdapter']>[1], @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.transitionAdapter(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('adapter-commands')
  @Idempotent('integration.adapter-command.submit.v1')
  @RequirePermission('integration.adapter.execute')
  submitAdapterCommand(@Body() input: SubmitAdapterCommandInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.submitAdapterCommand(input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('adapter-commands/:id/dispatch')
  @HttpCode(200)
  @Idempotent('integration.adapter-command.dispatch.v1')
  @RequirePermission('integration.adapter.execute')
  dispatchAdapterCommand(@Param('id') id: string, @Body() input: { readonly expectedVersion: number }, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.dispatchAdapterCommand(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('adapter-commands/:id/acknowledge')
  @HttpCode(200)
  @Idempotent('integration.adapter-command.acknowledge.v1')
  @RequirePermission('integration.adapter.execute')
  acknowledgeAdapterCommand(@Param('id') id: string, @Body() input: Parameters<AdapterIotService['acknowledgeAdapterCommand']>[1], @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.acknowledgeAdapterCommand(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('devices')
  @Idempotent('integration.device.register.v1')
  @RequirePermission('integration.device.manage')
  registerDevice(@Body() input: RegisterDeviceInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.registerDevice(input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('devices/:id/transition')
  @HttpCode(200)
  @Idempotent('integration.device.transition.v1')
  @RequirePermission('integration.device.manage')
  transitionDevice(@Param('id') id: string, @Body() input: Parameters<AdapterIotService['transitionDevice']>[1], @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.transitionDevice(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('devices/:id/certificates/rotate')
  @HttpCode(200)
  @Idempotent('integration.device-certificate.rotate.v1')
  @RequirePermission('integration.device.manage')
  rotateDeviceCertificate(@Param('id') id: string, @Body() input: Parameters<AdapterIotService['rotateDeviceCertificate']>[1], @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.rotateDeviceCertificate(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('devices/:id/commands')
  @Idempotent('integration.device-command.issue.v1')
  @RequirePermission('integration.device.command')
  issueDeviceCommand(@Param('id') id: string, @Body() input: Parameters<AdapterIotService['issueDeviceCommand']>[1], @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.issueDeviceCommand(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('device-commands/:id/send')
  @HttpCode(200)
  @Idempotent('integration.device-command.send.v1')
  @RequirePermission('integration.device.command')
  sendDeviceCommand(@Param('id') id: string, @Body() input: { readonly expectedVersion: number }, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: TenantRequest) {
    return this.service.sendDeviceCommand(id, input, request.tenantContext, metadata(request, correlationId, key));
  }
}

@Controller('api/v1/external/iot')
export class ExternalIotController {
  constructor(@Inject(AdapterIotService) private readonly service: AdapterIotService) {}

  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@Body() input: DeviceHeartbeatInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: Request) {
    return this.service.heartbeat(input, key, correlationId, request.ip);
  }

  @Post('telemetry')
  @HttpCode(202)
  telemetry(@Body() input: DeviceTelemetryInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: Request) {
    return this.service.ingestTelemetry(input, key, correlationId, request.ip);
  }

  @Post('command-acknowledgements')
  @HttpCode(200)
  commandAcknowledgement(@Body() input: DeviceCommandAckInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string, @Req() request: Request) {
    return this.service.acknowledgeDeviceCommand(input, key, correlationId, request.ip);
  }
}
