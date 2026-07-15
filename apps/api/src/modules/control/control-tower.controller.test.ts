import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { ControlTowerController } from './control-tower.controller';

describe('Control tower HTTP contract', () => {
  it('uses the generic idempotency record for projection consumption', () => {
    expect(
      Reflect.getMetadata(
        IDEMPOTENCY_SCOPE,
        ControlTowerController.prototype.consume,
      ),
    ).toBe('control.projection.consume.v1');
  });

  it('denies exact location drill-down without the precise permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'control-location-permission-test',
      originalUrl: '/api/v1/control/views/exact',
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
      getClass: () => ControlTowerController,
      getHandler: () => ControlTowerController.prototype.exactWorkbench,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'control.location.precise' }),
    );
  });
});
