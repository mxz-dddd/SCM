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
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';
import {
  ConfigurationService,
  type ChangeDictionaryItemStatusInput,
  type CreateConfigDraftInput,
  type CreateDictionaryInput,
  type CreateNumberRuleInput,
  type ListConfigurationQuery,
  type PublishConfigInput,
  type ResolveConfigInput,
  type RollbackConfigInput,
  type ValidateReasonUseInput,
} from './configuration.service';

@Controller('api/v1/platform/configuration')
@UseGuards(PermissionGuard)
export class ConfigurationController {
  constructor(
    @Inject(ConfigurationService)
    private readonly configuration: ConfigurationService,
  ) {}

  @Get('config-versions')
  @RequirePermission('platform.configuration.read')
  listConfigVersions(
    @Query() query: ListConfigurationQuery,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.listConfigVersions(request.tenantContext, query);
  }

  @Post('config-versions')
  @RequirePermission('platform.configuration.write')
  createConfigDraft(
    @Body() input: CreateConfigDraftInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.createConfigDraft(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Get('config-versions/:configVersionId/preview')
  @RequirePermission('platform.configuration.read')
  previewConfig(
    @Param('configVersionId') configVersionId: string,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.previewConfig(
      configVersionId,
      request.tenantContext,
    );
  }

  @Post('config-versions/:configVersionId/publish')
  @RequirePermission('platform.configuration.write')
  publishConfig(
    @Param('configVersionId') configVersionId: string,
    @Body() input: PublishConfigInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.publishConfig(
      configVersionId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post('config-versions/:configVersionId/rollback')
  @RequirePermission('platform.configuration.write')
  rollbackConfig(
    @Param('configVersionId') configVersionId: string,
    @Body() input: RollbackConfigInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.rollbackConfig(
      configVersionId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Get('resolve')
  @RequirePermission('platform.configuration.read')
  resolveConfig(
    @Query() input: ResolveConfigInput,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.resolveConfig(input, request.tenantContext);
  }

  @Get('dictionaries')
  @RequirePermission('platform.configuration.read')
  listDictionaries(@Req() request: TenantRequest) {
    return this.configuration.listDictionaries(request.tenantContext);
  }

  @Post('dictionaries')
  @RequirePermission('platform.configuration.write')
  createDictionary(
    @Body() input: CreateDictionaryInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.createDictionary(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Get('dictionaries/:dictionaryId/items')
  @RequirePermission('platform.configuration.read')
  listDictionaryItems(
    @Param('dictionaryId') dictionaryId: string,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.listDictionaryItems(
      dictionaryId,
      request.tenantContext,
    );
  }

  @Post('dictionary-items/:itemId/status')
  @RequirePermission('platform.configuration.write')
  changeDictionaryItemStatus(
    @Param('itemId') itemId: string,
    @Body() input: ChangeDictionaryItemStatusInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.changeDictionaryItemStatus(
      itemId,
      input,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }

  @Post('dictionary-items/:itemId/validate-use')
  @RequirePermission('platform.configuration.read')
  validateReasonUse(
    @Param('itemId') itemId: string,
    @Body() input: ValidateReasonUseInput,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.validateReasonUse(
      itemId,
      input,
      request.tenantContext,
    );
  }

  @Get('number-rules')
  @RequirePermission('platform.configuration.read')
  listNumberRules(@Req() request: TenantRequest) {
    return this.configuration.listNumberRules(request.tenantContext);
  }

  @Post('number-rules')
  @RequirePermission('platform.configuration.write')
  createNumberRule(
    @Body() input: CreateNumberRuleInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.createNumberRule(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('number-rules/:numberRuleId/reservations')
  @RequirePermission('platform.configuration.write')
  reserveSequence(
    @Param('numberRuleId') numberRuleId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.configuration.reserveSequence(
      numberRuleId,
      request.tenantContext,
      { correlationId, idempotencyKey, ipAddress: request.ip },
    );
  }
}
