import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { OperationsController } from './operations.controller';

describe('WMS value-added, labor, mobile and device HTTP contract', () => {
  it('requires generic idempotency on every write command', () => {
    const methods = [
      'createValueAddedOrder',
      'transitionValueAddedOrder',
      'saveLaborStandard',
      'createLaborAssignment',
      'transitionLaborAssignment',
      'syncOfflineCommands',
      'resolveOfflineConflict',
      'issueDeviceCommand',
      'recordDeviceEvent',
      'timeoutDeviceCommands',
    ] as const;
    for (const method of methods)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          OperationsController.prototype[method],
        ),
      ).toMatch(/^wms\.operations\./);
  });

  it('denies offline conflict resolution without supervisor permission', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'offline-permission-test',
      originalUrl: '/api/v1/wms/offline-conflicts/id/resolve',
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
      getClass: () => OperationsController,
      getHandler: () => OperationsController.prototype.resolveOfflineConflict,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({ code: 'AUTH_PERMISSION_DENIED', statusCode: 403 });
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ permissionCode: 'wms.mobile.supervise' }));
  });
});
