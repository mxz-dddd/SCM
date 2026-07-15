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
import type { IntegrationCredentialType } from '@prisma/client';
import type { Request } from 'express';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { Idempotent } from '../platform/idempotent.decorator';
import {
  ApiContractService,
  type CreateApiDefinitionInput,
  type CreateApiVersionInput,
} from './api-contract.service';
import {
  GatewayService,
  type CreateGatewayCredentialInput,
  type GatewayAuthorizationInput,
  type SaveGatewayPolicyInput,
} from './gateway.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  idempotencyKey?: string,
) => ({ correlationId, idempotencyKey, ipAddress: request.ip });

@Controller('api/v1/integration')
@UseGuards(PermissionGuard)
export class IntegrationController {
  constructor(
    @Inject(GatewayService) private readonly gateway: GatewayService,
    @Inject(ApiContractService) private readonly contracts: ApiContractService,
  ) {}

  @Get('gateway/workbench')
  @RequirePermission('integration.gateway.read')
  gatewayWorkbench(@Req() request: TenantRequest) {
    return this.gateway.workbench(request.tenantContext);
  }

  @Post('gateway/policies')
  @Idempotent('integration.gateway-policy.create.v1')
  @RequirePermission('integration.gateway.manage')
  createPolicy(
    @Body() input: SaveGatewayPolicyInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.gateway.createPolicy(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('gateway/policies/:id/transition')
  @Idempotent('integration.gateway-policy.transition.v1')
  @RequirePermission('integration.gateway.manage')
  transitionPolicy(
    @Param('id') id: string,
    @Body()
    input: {
      readonly expectedVersion: number;
      readonly target: 'ACTIVE' | 'RETIRED';
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.gateway.transitionPolicy(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('gateway/credentials')
  @Idempotent('integration.api-credential.create.v1')
  @RequirePermission('integration.credential.manage')
  createCredential(
    @Body() input: CreateGatewayCredentialInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.gateway.createCredential(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('gateway/credentials/:id/rotate')
  @Idempotent('integration.api-credential.rotate.v1')
  @RequirePermission('integration.credential.manage')
  rotateCredential(
    @Param('id') id: string,
    @Body()
    input: {
      readonly certificateFingerprint?: string;
      readonly expectedVersion: number;
      readonly validUntil?: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.gateway.rotateCredential(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('gateway/credentials/:id/revoke')
  @Idempotent('integration.api-credential.revoke.v1')
  @RequirePermission('integration.credential.manage')
  revokeCredential(
    @Param('id') id: string,
    @Body() input: { readonly expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.gateway.revokeCredential(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('contracts/workbench')
  @RequirePermission('integration.contract.read')
  contractWorkbench(@Req() request: TenantRequest) {
    return this.contracts.workbench(request.tenantContext);
  }

  @Post('contracts')
  @Idempotent('integration.api-definition.create.v1')
  @RequirePermission('integration.contract.manage')
  createDefinition(
    @Body() input: CreateApiDefinitionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.contracts.createDefinition(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('contracts/:id/versions')
  @Idempotent('integration.api-definition-version.create.v1')
  @RequirePermission('integration.contract.manage')
  createVersion(
    @Param('id') id: string,
    @Body() input: CreateApiVersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.contracts.createVersion(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('contracts/versions/:id/publish')
  @Idempotent('integration.api-definition-version.publish.v1')
  @RequirePermission('integration.contract.manage')
  publishVersion(
    @Param('id') id: string,
    @Body() input: { readonly expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.contracts.publishVersion(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('contracts/versions/:id/deprecate')
  @Idempotent('integration.api-definition-version.deprecate.v1')
  @RequirePermission('integration.contract.manage')
  deprecateVersion(
    @Param('id') id: string,
    @Body()
    input: {
      readonly deprecationDate: string;
      readonly expectedVersion: number;
      readonly replacementVersion?: string;
      readonly summary: string;
      readonly sunsetDate: string;
    },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.contracts.deprecateVersion(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}

@Controller('api/v1/external')
export class ExternalGatewayController {
  constructor(
    @Inject(GatewayService) private readonly gateway: GatewayService,
  ) {}

  @Post('oauth/token')
  issueToken(
    @Body()
    input: {
      readonly clientId: string;
      readonly clientSecret: string;
      readonly scopes?: readonly string[];
    },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.gateway.issueToken(input, idempotencyKey);
  }

  @Post('gateway/authorize')
  authorize(
    @Body()
    input: Omit<GatewayAuthorizationInput, 'correlationId' | 'ipAddress'>,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: Request,
  ) {
    return this.gateway.authorize({
      ...input,
      ...(correlationId ? { correlationId } : {}),
      ipAddress: request.ip ?? 'unknown',
    });
  }
}

@Controller('api/v1/public/openapi')
export class PublicApiContractController {
  constructor(
    @Inject(ApiContractService) private readonly contracts: ApiContractService,
  ) {}

  @Get(':tenantId/:name/:version')
  specification(
    @Param('tenantId') tenantId: string,
    @Param('name') name: string,
    @Param('version') version: string,
  ) {
    return this.contracts.publicSpecification(tenantId, name, version);
  }
}

export type GatewayCredentialType = IntegrationCredentialType;
