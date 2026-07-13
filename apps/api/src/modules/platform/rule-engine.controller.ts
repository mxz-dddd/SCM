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
import type { TenantRequest } from './auth/tenant-context.middleware';
import { RequirePermission } from './auth/permission.decorator';
import { PermissionGuard } from './auth/permission.guard';
import {
  RuleEngineService,
  type EvaluateRuleInput,
  type RuleVersionInput,
  type SaveRuleSetInput,
} from './rule-engine.service';

@Controller('api/v1/platform/rules')
@UseGuards(PermissionGuard)
export class RuleEngineController {
  constructor(
    @Inject(RuleEngineService) private readonly rules: RuleEngineService,
  ) {}

  @Get('sets')
  @RequirePermission('platform.rule.read')
  listRuleSets(@Req() request: TenantRequest) {
    return this.rules.listRuleSets(request.tenantContext);
  }

  @Post('sets')
  @RequirePermission('platform.rule.write')
  saveRuleSet(
    @Body() input: SaveRuleSetInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.rules.saveRuleSet(input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('sets/:ruleSetId/publish')
  @HttpCode(200)
  @RequirePermission('platform.rule.write')
  publish(
    @Param('ruleSetId') ruleSetId: string,
    @Body() input: RuleVersionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.rules.publish(ruleSetId, input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('simulate')
  @HttpCode(200)
  @RequirePermission('platform.rule.simulate')
  simulate(
    @Body() input: EvaluateRuleInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.rules.evaluate('SIMULATION', input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Post('evaluate')
  @HttpCode(200)
  @RequirePermission('platform.rule.evaluate')
  evaluate(
    @Body() input: EvaluateRuleInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.rules.evaluate('EXECUTION', input, request.tenantContext, {
      correlationId,
      idempotencyKey,
      ipAddress: request.ip,
    });
  }

  @Get('traces')
  @RequirePermission('platform.rule.read')
  listTraces(
    @Query('scenario') scenario: string | undefined,
    @Req() request: TenantRequest,
  ) {
    return this.rules.listTraces(request.tenantContext, scenario);
  }
}
