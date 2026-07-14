import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
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
import { LoadRouteService } from './load-route.service';
const metadata = (
  request: TenantRequest,
  correlationId: string,
  key?: string,
) => ({ correlationId, idempotencyKey: key, ipAddress: request.ip });
@Controller('api/v1/tms/optimization')
@UseGuards(PermissionGuard)
export class LoadRouteController {
  constructor(
    @Inject(LoadRouteService) private readonly service: LoadRouteService,
  ) {}
  @Get('workbench') @RequirePermission('tms.optimization.read') workbench(
    @Req() request: TenantRequest,
  ) {
    return this.service.workbench(request.tenantContext);
  }
  @Post('load-plans')
  @Idempotent('tms.optimization.load-create.v1')
  @RequirePermission('tms.load.manage')
  createLoadPlan(
    @Body() input: Parameters<LoadRouteService['createLoadPlan']>[0],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.createLoadPlan(
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('load-plans/:id/adjust')
  @HttpCode(200)
  @Idempotent('tms.optimization.load-adjust.v1')
  @RequirePermission('tms.load.manage')
  adjustLoad(
    @Param('id') id: string,
    @Body() input: Parameters<LoadRouteService['adjustLoad']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.adjustLoad(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('load-plans/:id/transition')
  @HttpCode(200)
  @Idempotent('tms.optimization.load-transition.v1')
  @RequirePermission('tms.load.publish')
  transitionLoad(
    @Param('id') id: string,
    @Body() input: Parameters<LoadRouteService['transitionLoad']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.transitionLoad(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('shipments/:id/routes/optimize')
  @Idempotent('tms.optimization.route-optimize.v1')
  @RequirePermission('tms.route.optimize')
  optimizeRoute(
    @Param('id') id: string,
    @Body() input: Parameters<LoadRouteService['optimizeRoute']>[1],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.optimizeRoute(
      id,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
  @Post('route-plans/:routeId/scenarios/:scenarioId/select')
  @HttpCode(200)
  @Idempotent('tms.optimization.route-select.v1')
  @RequirePermission('tms.route.optimize')
  selectScenario(
    @Param('routeId') routeId: string,
    @Param('scenarioId') scenarioId: string,
    @Body() input: Parameters<LoadRouteService['selectScenario']>[2],
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: TenantRequest,
  ) {
    return this.service.selectScenario(
      routeId,
      scenarioId,
      input,
      request.tenantContext,
      metadata(request, correlationId, key),
    );
  }
}
