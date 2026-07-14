import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { PickController } from './pick.controller';

describe('WMS picking HTTP contract', () => {
  it('requires generic idempotency on every picking write', () => {
    const methods = [
      'assignTask',
      'startTask',
      'replanRoute',
      'scan',
      'shortPick',
      'resolveShortPick',
      'verifyTask',
      'correctVerification',
    ] as const;
    for (const method of methods)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          PickController.prototype[method],
        ),
      ).toMatch(/^wms\.picking\./);
  });

  it('denies verification without its resource permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'pick-permission-test',
      originalUrl: '/api/v1/wms/pick-tasks/id/verify',
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
      getClass: () => PickController,
      getHandler: () => PickController.prototype.verifyTask,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'wms.picking.verify' }),
    );
  });
});
