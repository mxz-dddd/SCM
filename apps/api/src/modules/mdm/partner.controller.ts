import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { PartnerStatus } from '@prisma/client';
import type { TenantRequest } from '../platform/auth/tenant-context.middleware';
import { RequirePermission } from '../platform/auth/permission.decorator';
import { PermissionGuard } from '../platform/auth/permission.guard';
import {
  PartnerService,
  type AddPartnerCertificateInput,
  type AddPartnerContactInput,
  type AddPartnerRoleInput,
  type GeocodeAddressInput,
  type PartnerVersionInput,
  type SaveAddressInput,
  type SaveExternalCodeInput,
  type SavePartnerInput,
  type SaveServiceZoneInput,
} from './partner.service';

function metadata(
  request: TenantRequest,
  correlationId: string,
  idempotencyKey?: string,
) {
  return { correlationId, idempotencyKey, ipAddress: request.ip };
}

@Controller('api/v1/mdm')
@UseGuards(PermissionGuard)
export class PartnerController {
  constructor(
    @Inject(PartnerService) private readonly partners: PartnerService,
  ) {}

  @Get('partners')
  @RequirePermission('mdm.partner.read')
  list(
    @Query('status') status: PartnerStatus | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.partners.list(request.tenantContext, status);
  }

  @Get('partners/:partnerId')
  @RequirePermission('mdm.partner.read')
  get(@Param('partnerId') partnerId: string, @Req() request: TenantRequest) {
    return this.partners.get(partnerId, request.tenantContext);
  }

  @Post('partners')
  @RequirePermission('mdm.partner.write')
  create(
    @Body() input: SavePartnerInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.save(
      undefined,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Put('partners/:partnerId')
  @HttpCode(200)
  @RequirePermission('mdm.partner.write')
  update(
    @Param('partnerId') partnerId: string,
    @Body() input: SavePartnerInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.save(
      partnerId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('partners/:partnerId/:target')
  @HttpCode(200)
  @RequirePermission('mdm.partner.write')
  transition(
    @Param('partnerId') partnerId: string,
    @Param('target') target: string,
    @Body() input: PartnerVersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    if (!['ACTIVE', 'SUSPENDED', 'INACTIVE'].includes(target))
      throw new Error('Unsupported partner target');
    return this.partners.transition(
      partnerId,
      target as 'ACTIVE' | 'SUSPENDED' | 'INACTIVE',
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('partner-roles')
  @RequirePermission('mdm.partner.write')
  addRole(
    @Body() input: AddPartnerRoleInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.addRole(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('partner-roles/:id/deactivate')
  @HttpCode(200)
  @RequirePermission('mdm.partner.write')
  deactivateRole(
    @Param('id') id: string,
    @Body() input: PartnerVersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.deactivateChild(
      'role',
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('partner-contacts')
  @RequirePermission('mdm.partner.write')
  addContact(
    @Body() input: AddPartnerContactInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.addContact(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('partner-contacts/:id/deactivate')
  @HttpCode(200)
  @RequirePermission('mdm.partner.write')
  deactivateContact(
    @Param('id') id: string,
    @Body() input: PartnerVersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.deactivateChild(
      'contact',
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('partner-certificates')
  @RequirePermission('mdm.partner.write')
  addCertificate(
    @Body() input: AddPartnerCertificateInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.addCertificate(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('partner-certificates/:id/deactivate')
  @HttpCode(200)
  @RequirePermission('mdm.partner.write')
  deactivateCertificate(
    @Param('id') id: string,
    @Body() input: PartnerVersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.deactivateChild(
      'certificate',
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('partner-certificates/:id/expire')
  @HttpCode(200)
  @RequirePermission('mdm.partner.write')
  expireCertificate(
    @Param('id') id: string,
    @Body() input: PartnerVersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.expireCertificate(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('partner-addresses')
  @RequirePermission('mdm.partner.write')
  saveAddress(
    @Body() input: SaveAddressInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.saveAddress(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('partner-addresses/:id/deactivate')
  @HttpCode(200)
  @RequirePermission('mdm.partner.write')
  deactivateAddress(
    @Param('id') id: string,
    @Body() input: PartnerVersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.deactivateChild(
      'address',
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('partner-addresses/:id/geocode')
  @HttpCode(200)
  @RequirePermission('mdm.partner.geocode')
  geocode(
    @Param('id') id: string,
    @Body() input: GeocodeAddressInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.geocode(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('partner-addresses/correction-queue')
  @RequirePermission('mdm.partner.geocode')
  correctionQueue(@Req() request: TenantRequest) {
    return this.partners.listCorrectionQueue(request.tenantContext);
  }

  @Post('service-zones')
  @RequirePermission('mdm.partner.write')
  saveServiceZone(
    @Body() input: SaveServiceZoneInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.saveServiceZone(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('service-zones/:id/:target')
  @HttpCode(200)
  @RequirePermission('mdm.partner.write')
  transitionServiceZone(
    @Param('id') id: string,
    @Param('target') target: string,
    @Body() input: PartnerVersionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    if (!['ACTIVE', 'INACTIVE'].includes(target))
      throw new Error('Unsupported service zone target');
    return this.partners.transitionServiceZone(
      id,
      target as 'ACTIVE' | 'INACTIVE',
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Post('external-codes')
  @RequirePermission('mdm.partner.write')
  saveExternalCode(
    @Body() input: SaveExternalCodeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.saveExternalCode(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }

  @Get('external-codes/resolve')
  @RequirePermission('mdm.partner.read')
  resolveExternalCode(
    @Query('sourceSystem') source: string,
    @Query('objectType') objectType: string,
    @Query('externalCode') externalCode: string,
    @Req() request: TenantRequest,
  ) {
    return this.partners.resolveExternalCode(
      source,
      objectType,
      externalCode,
      request.tenantContext,
    );
  }
}
