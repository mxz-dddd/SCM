import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { TrackingController } from './tracking.controller';

describe('TMS tracking HTTP contract', () => {
  it('uses generic idempotency on all writes', () => {
    for (const method of [
      'createMilestonePlan',
      'createDriverTask',
      'acceptTask',
      'syncOffline',
      'ingestPosition',
      'predictEta',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          TrackingController.prototype[method],
        ),
      ).toMatch(/^tms\.tracking\./);
  });
  it('denies driver sync without execute permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'tracking-permission-test',
      originalUrl: '/api/v1/tms/tracking/driver-tasks/id/offline-sync',
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
      getClass: () => TrackingController,
      getHandler: () => TrackingController.prototype.syncOffline,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'tms.driver.execute' }),
    );
  });
});
