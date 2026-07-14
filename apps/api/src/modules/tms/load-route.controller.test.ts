import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { LoadRouteController } from './load-route.controller';

describe('TMS load and route HTTP contract', () => {
  it('uses generic idempotency for every write command', () => {
    for (const method of [
      'createLoadPlan',
      'adjustLoad',
      'transitionLoad',
      'optimizeRoute',
      'selectScenario',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          LoadRouteController.prototype[method],
        ),
      ).toMatch(/^tms\.optimization\./);
  });

  it('denies route optimization without planner permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'route-permission-test',
      originalUrl: '/api/v1/tms/optimization/shipments/id/routes/optimize',
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
      getClass: () => LoadRouteController,
      getHandler: () => LoadRouteController.prototype.optimizeRoute,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'tms.route.optimize' }),
    );
  });
});
