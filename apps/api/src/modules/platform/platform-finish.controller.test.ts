import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from './auth/permission.guard';
import { PlatformFinishController } from './platform-finish.controller';

describe('platform finalization authorization', () => {
  it('denies printing without platform.print.create', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'finish-permission-test',
      originalUrl: '/api/v1/platform/finalization/print-jobs',
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
    const executionContext = {
      getClass: () => PlatformFinishController,
      getHandler: () => PlatformFinishController.prototype.createPrintJob,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(
      guard.canActivate(executionContext as never),
    ).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'platform.print.create' }),
    );
  });
});
