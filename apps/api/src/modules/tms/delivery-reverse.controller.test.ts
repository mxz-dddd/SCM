import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { DeliveryReverseController } from './delivery-reverse.controller';

describe('TMS delivery and reverse HTTP contract', () => {
  it('uses generic idempotency for every command', () => {
    for (const method of [
      'confirmDelivery',
      'submitPod',
      'reviewPod',
      'supplementPod',
      'createClaim',
      'transitionClaim',
      'createReturn',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          DeliveryReverseController.prototype[method],
        ),
      ).toMatch(/^tms\.delivery\./);
  });
  it('denies POD confirmation without reviewer permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'pod-permission-test',
      originalUrl: '/api/v1/tms/delivery/pods/id/review',
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
      getClass: () => DeliveryReverseController,
      getHandler: () => DeliveryReverseController.prototype.reviewPod,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'tms.pod.review' }),
    );
  });
});
