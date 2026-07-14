import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { DispatchController } from './dispatch.controller';

describe('TMS dispatch HTTP contract', () => {
  it('uses generic idempotency for every write command', () => {
    for (const method of [
      'assign',
      'revokeAssignment',
      'checkCompliance',
      'confirmDispatch',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          DispatchController.prototype[method],
        ),
      ).toMatch(/^tms\.dispatch\./);
  });

  it('denies dispatch confirmation without elevated permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'dispatch-permission-test',
      originalUrl: '/api/v1/tms/dispatch/shipments/id/confirm',
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
      getClass: () => DispatchController,
      getHandler: () => DispatchController.prototype.confirmDispatch,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'tms.dispatch.confirm' }),
    );
  });
});
