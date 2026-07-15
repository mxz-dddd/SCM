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
import {
  MessageExchangeService,
  type CompleteFileInput,
  type CreateWebhookInput,
  type ReceiveFileInput,
  type SaveMappingInput,
  type SaveMappingVersionInput,
} from './message-exchange.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  idempotencyKey?: string,
) => ({
  correlationId,
  idempotencyKey,
  ipAddress: request.ip,
});

@Controller('api/v1/integration/exchange')
@UseGuards(PermissionGuard)
export class MessageExchangeController {
  constructor(
    @Inject(MessageExchangeService)
    private readonly service: MessageExchangeService,
  ) {}

  @Get('workbench')
  @RequirePermission('integration.exchange.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }

  @Post('files')
  @Idempotent('integration.file.receive.v1')
  @RequirePermission('integration.exchange.manage')
  receiveFile(
    @Body() input: ReceiveFileInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.receiveFile(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('files/:id/complete')
  @Idempotent('integration.file.complete.v1')
  @RequirePermission('integration.exchange.process')
  completeFile(
    @Param('id') id: string,
    @Body() input: CompleteFileInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.completeFile(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('files/:id/archive')
  @Idempotent('integration.file.archive.v1')
  @RequirePermission('integration.exchange.manage')
  archiveFile(
    @Param('id') id: string,
    @Body() input: { readonly expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.archiveFile(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('mappings')
  @Idempotent('integration.mapping.create.v1')
  @RequirePermission('integration.mapping.manage')
  createMapping(
    @Body() input: SaveMappingInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createMapping(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('mappings/:id/versions')
  @Idempotent('integration.mapping-version.create.v1')
  @RequirePermission('integration.mapping.manage')
  createMappingVersion(
    @Param('id') id: string,
    @Body() input: SaveMappingVersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createMappingVersion(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('mappings/versions/:id/test')
  @Idempotent('integration.mapping.test.v1')
  @RequirePermission('integration.mapping.manage')
  testMapping(
    @Param('id') id: string,
    @Body() input: { readonly expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.testMapping(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('mappings/versions/:id/publish')
  @Idempotent('integration.mapping.publish.v1')
  @RequirePermission('integration.mapping.manage')
  publishMapping(
    @Param('id') id: string,
    @Body() input: { readonly expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishMapping(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('mappings/:id/transform')
  @Idempotent('integration.mapping.transform.v1')
  @RequirePermission('integration.mapping.execute')
  transform(
    @Param('id') id: string,
    @Body()
    input: {
      readonly messageId?: string;
      readonly payload: Readonly<Record<string, unknown>>;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transform(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('webhooks')
  @Idempotent('integration.webhook.create.v1')
  @RequirePermission('integration.webhook.manage')
  createWebhook(
    @Body() input: CreateWebhookInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createWebhook(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('webhooks/:id/disable')
  @Idempotent('integration.webhook.disable.v1')
  @RequirePermission('integration.webhook.manage')
  disableWebhook(
    @Param('id') id: string,
    @Body() input: { readonly expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.disableWebhook(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('webhooks/events')
  @Idempotent('integration.webhook.event.publish.v1')
  @RequirePermission('integration.webhook.publish')
  publishWebhookEvent(
    @Body()
    input: {
      readonly businessRef?: string;
      readonly eventType: string;
      readonly objectScope?: string;
      readonly payload: Readonly<Record<string, unknown>>;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishWebhookEvent(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('deliveries/:id/complete')
  @Idempotent('integration.webhook.delivery.complete.v1')
  @RequirePermission('integration.exchange.process')
  completeDelivery(
    @Param('id') id: string,
    @Body()
    input: {
      readonly errorMessage?: string;
      readonly expectedVersion: number;
      readonly leaseOwner?: string;
      readonly responseBody?: string;
      readonly responseStatus?: number;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.completeDelivery(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('deliveries/claim')
  @Idempotent('integration.webhook.delivery.claim.v1')
  @RequirePermission('integration.exchange.process')
  claimDeliveries(
    @Body()
    input: {
      readonly leaseOwner: string;
      readonly leaseSeconds?: number;
      readonly limit?: number;
    },
    @Req() request: TenantRequest,
  ) {
    return this.service.claimDeliveries(input, request.tenantContext);
  }

  @Post('messages/:id/replay')
  @Idempotent('integration.message.replay.v1')
  @RequirePermission('integration.message.replay')
  replayMessage(
    @Param('id') id: string,
    @Body()
    input: {
      readonly expectedVersion: number;
      readonly mappingVersionId?: string;
      readonly reason: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.replayMessage(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
