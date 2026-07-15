import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { IntegrationController } from './integration.controller';

describe('Integration gateway HTTP contract', () => {
  it('marks every gateway and API contract management command idempotent', () => {
    const expected = new Map([
      ['createPolicy', 'integration.gateway-policy.create.v1'],
      ['transitionPolicy', 'integration.gateway-policy.transition.v1'],
      ['createCredential', 'integration.api-credential.create.v1'],
      ['rotateCredential', 'integration.api-credential.rotate.v1'],
      ['revokeCredential', 'integration.api-credential.revoke.v1'],
      ['createDefinition', 'integration.api-definition.create.v1'],
      ['createVersion', 'integration.api-definition-version.create.v1'],
      ['publishVersion', 'integration.api-definition-version.publish.v1'],
      ['deprecateVersion', 'integration.api-definition-version.deprecate.v1'],
    ]);
    for (const [method, scope] of expected)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          IntegrationController.prototype[
            method as keyof IntegrationController
          ],
        ),
      ).toBe(scope);
  });

  it('denies credential rotation without integration credential permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'integration-permission-test',
      originalUrl: '/api/v1/integration/gateway/credentials/id/rotate',
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
      getClass: () => IntegrationController,
      getHandler: () => IntegrationController.prototype.rotateCredential,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionCode: 'integration.credential.manage',
      }),
    );
  });
});
