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
  AiOptimizationService,
  type DemandForecastInput,
  type InventoryRecommendationInput,
  type LoadOptimizationInput,
  type NetworkScenarioInput,
  type RouteOptimizationInput,
} from './ai-optimization.service';

const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });

@Controller('api/v1/control/ai')
@UseGuards(PermissionGuard)
export class AiOptimizationController {
  constructor(
    @Inject(AiOptimizationService)
    private readonly service: AiOptimizationService,
  ) {}

  @Post('route-optimizations')
  @Idempotent('control.ai.route.create.v1')
  @RequirePermission('control.ai.route.optimize')
  createRoute(
    @Body() input: RouteOptimizationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createRouteOptimization(input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('load-optimizations')
  @Idempotent('control.ai.load.create.v1')
  @RequirePermission('control.ai.load.optimize')
  createLoad(
    @Body() input: LoadOptimizationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createLoadOptimization(input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('load-optimizations/:id/decision')
  @Idempotent('control.ai.load.decision.v1')
  @RequirePermission('control.ai.load.confirm')
  decideLoad(
    @Param('id') id: string,
    @Body() input: Parameters<AiOptimizationService['decideLoad']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.decideLoad(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('load-optimizations/:id/deviations')
  @Idempotent('control.ai.load.deviation.v1')
  @RequirePermission('control.ai.load.feedback')
  loadDeviation(
    @Param('id') id: string,
    @Body() input: Parameters<AiOptimizationService['recordLoadDeviation']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.recordLoadDeviation(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('forecasts')
  @Idempotent('control.ai.forecast.create.v1')
  @RequirePermission('control.ai.forecast.manage')
  createForecast(
    @Body() input: DemandForecastInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createForecast(input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('forecasts/:id/publish')
  @Idempotent('control.ai.forecast.publish.v1')
  @RequirePermission('control.ai.forecast.publish')
  publishForecast(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.publishForecast(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('forecasts/:id/retire')
  @Idempotent('control.ai.forecast.retire.v1')
  @RequirePermission('control.ai.forecast.publish')
  retireForecast(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.retireForecast(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('forecasts/:id/deviations')
  @Idempotent('control.ai.forecast.deviation.v1')
  @RequirePermission('control.ai.forecast.feedback')
  forecastDeviation(
    @Param('id') id: string,
    @Body() input: Parameters<AiOptimizationService['recordForecastDeviation']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.recordForecastDeviation(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('inventory-recommendations')
  @Idempotent('control.ai.inventory-recommendation.create.v1')
  @RequirePermission('control.ai.inventory.recommend')
  createRecommendation(
    @Body() input: InventoryRecommendationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createInventoryRecommendation(input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('inventory-recommendations/:id/decision')
  @Idempotent('control.ai.inventory-recommendation.decision.v1')
  @RequirePermission('control.ai.inventory.decide')
  decideRecommendation(
    @Param('id') id: string,
    @Body() input: Parameters<AiOptimizationService['decideRecommendation']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.decideRecommendation(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('network-scenarios')
  @Idempotent('control.ai.network-scenario.create.v1')
  @RequirePermission('control.ai.network.manage')
  createScenario(
    @Body() input: NetworkScenarioInput,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createScenario(input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('network-scenarios/:id/run')
  @Idempotent('control.ai.network-scenario.run.v1')
  @RequirePermission('control.ai.network.run')
  runScenario(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.runScenario(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('network-scenarios/:id/archive')
  @Idempotent('control.ai.network-scenario.archive.v1')
  @RequirePermission('control.ai.network.manage')
  archiveScenario(
    @Param('id') id: string,
    @Body() input: { expectedVersion: number },
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.archiveScenario(id, input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Post('jobs/execute')
  @Idempotent('control.ai.job.execute.v1')
  @RequirePermission('control.ai.job.process')
  executeJob(
    @Body() input: Parameters<AiOptimizationService['executeJob']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.executeJob(input, request.tenantContext, metadata(request, correlationId, key));
  }

  @Get('network-scenarios/:id/export')
  @RequirePermission('control.ai.network.export')
  exportScenario(@Param('id') id: string, @Req() request: TenantRequest) {
    return this.service.exportScenario(id, request.tenantContext);
  }

  @Get('workbench')
  @RequirePermission('control.ai.read')
  workbench(@Req() request: TenantRequest) {
    return this.service.workbench(request.tenantContext);
  }
}
