import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { MobilePortalController } from './mobile-portal.controller';

describe('Customer mobile and partner portal HTTP contract', () => {
  it('marks every portal write idempotent', () => {
    const expected = new Map([
      ['saveGrant', 'integration.portal-grant.save.v1'],
      ['transitionGrant', 'integration.portal-grant.transition.v1'],
      ['project', 'integration.portal-projection.consume.v1'],
      ['createCommand', 'integration.portal-command.create.v1'],
      ['dispatchCommand', 'integration.portal-command.dispatch.v1'],
      ['completeCommand', 'integration.portal-command.complete.v1'],
    ]);
    for (const [method, scope] of expected)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          MobilePortalController.prototype[method as keyof MobilePortalController],
        ),
      ).toBe(scope);
  });

  it('denies portal commands without portal command permission', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'mobile-portal-permission-test',
      originalUrl: '/api/v1/integration/portal/commands',
      tenantContext: {
        accountId: '10000000-0000-4000-8000-000000000001',
        accountKind: 'USER',
        deviceId: 'mobile',
        organizationIds: [],
        permissionVersion: 1,
        tenantId: '10000000-0000-4000-8000-000000000002',
        tokenId: 'token',
      },
    };
    const execution = {
      getClass: () => MobilePortalController,
      getHandler: () => MobilePortalController.prototype.createCommand,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({ code: 'AUTH_PERMISSION_DENIED', statusCode: 403 });
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ permissionCode: 'integration.portal.command' }));
  });
});
