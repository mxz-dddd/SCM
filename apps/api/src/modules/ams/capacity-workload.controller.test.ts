import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { CapacityWorkloadController } from './capacity-workload.controller';

describe('AMS capacity and workload HTTP contract', () => {
  it('uses generic idempotency for every write command', () => {
    for (const method of [
      'createProfile',
      'publishProfile',
      'generateSlots',
      'changeSlot',
      'createWorkloadRule',
      'publishWorkloadRule',
      'estimate',
      'adjustEstimate',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          CapacityWorkloadController.prototype[method],
        ),
      ).toMatch(/^ams\./);
  });

  it('denies slot mutation without capacity permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'ams-permission-test',
      originalUrl: '/api/v1/ams/slots/id/change',
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
      getClass: () => CapacityWorkloadController,
      getHandler: () => CapacityWorkloadController.prototype.changeSlot,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'ams.capacity.manage' }),
    );
  });
});
