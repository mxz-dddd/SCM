import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { JobController } from './job.controller';
import { PermissionGuard } from './auth/permission.guard';

describe('job command authorization', () => {
  it('denies cancellation when RBAC does not grant platform.job.cancel', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false, reason: 'NO_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: (name: string) =>
        name === 'X-Correlation-Id' ? 'job-permission-test' : undefined,
      originalUrl: '/api/v1/platform/jobs/runs/run-1/cancel',
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
      getClass: () => JobController,
      getHandler: () => JobController.prototype.cancel,
      switchToHttp: () => ({ getRequest: () => request }),
    };

    await expect(guard.canActivate(executionContext as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'platform.job.cancel' }),
    );
  });
});
