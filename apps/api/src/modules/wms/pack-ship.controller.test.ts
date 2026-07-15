import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { PackShipController } from './pack-ship.controller';

describe('WMS pack and ship HTTP contract', () => {
  it('requires generic idempotency on every write command', () => {
    const methods = [
      'createPackTask',
      'measurePackage',
      'resolveWeightException',
      'sealPackage',
      'issueLabel',
      'voidLabel',
      'stagePackage',
      'createLoadTask',
      'confirmLoad',
      'ship',
      'cancelOutbound',
    ] as const;
    for (const method of methods)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          PackShipController.prototype[method],
        ),
      ).toMatch(/^wms\.(pack|ship)\./);
  });

  it('denies shipment confirmation without supervisor permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'ship-permission-test',
      originalUrl: '/api/v1/wms/load-tasks/id/ship',
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
      getClass: () => PackShipController,
      getHandler: () => PackShipController.prototype.ship,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'wms.ship.confirm' }),
    );
  });
});
