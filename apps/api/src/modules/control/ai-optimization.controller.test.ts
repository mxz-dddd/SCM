import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { AiOptimizationController } from './ai-optimization.controller';

describe('Control AI optimization HTTP contract', () => {
  it('marks every AI command idempotent', () => {
    const expected = new Map([
      ['createRoute', 'control.ai.route.create.v1'],
      ['createLoad', 'control.ai.load.create.v1'],
      ['decideLoad', 'control.ai.load.decision.v1'],
      ['loadDeviation', 'control.ai.load.deviation.v1'],
      ['createForecast', 'control.ai.forecast.create.v1'],
      ['publishForecast', 'control.ai.forecast.publish.v1'],
      ['retireForecast', 'control.ai.forecast.retire.v1'],
      ['forecastDeviation', 'control.ai.forecast.deviation.v1'],
      ['createRecommendation', 'control.ai.inventory-recommendation.create.v1'],
      ['decideRecommendation', 'control.ai.inventory-recommendation.decision.v1'],
      ['createScenario', 'control.ai.network-scenario.create.v1'],
      ['runScenario', 'control.ai.network-scenario.run.v1'],
      ['archiveScenario', 'control.ai.network-scenario.archive.v1'],
      ['executeJob', 'control.ai.job.execute.v1'],
    ]);
    for (const [method, scope] of expected) {
      expect(Reflect.getMetadata(IDEMPOTENCY_SCOPE, AiOptimizationController.prototype[method as keyof AiOptimizationController])).toBe(scope);
    }
  });

  it('denies optimizer commands without the dedicated permission', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'control-ai-permission-test',
      originalUrl: '/api/v1/control/ai/route-optimizations',
      tenantContext: {
        accountId: '10000000-0000-4000-8000-000000000001',
        accountKind: 'USER',
        deviceId: 'test',
        organizationIds: [],
        permissionVersion: 1,
        tenantId: '10000000-0000-4000-8000-000000000002',
        tokenId: 'token',
      },
    };
    const execution = {
      getClass: () => AiOptimizationController,
      getHandler: () => AiOptimizationController.prototype.createRoute,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({ code: 'AUTH_PERMISSION_DENIED', statusCode: 403 });
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ permissionCode: 'control.ai.route.optimize' }));
  });
});
