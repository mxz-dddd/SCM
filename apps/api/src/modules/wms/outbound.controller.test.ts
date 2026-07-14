import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { OutboundController } from './outbound.controller';

describe('WMS outbound HTTP contract', () => {
  it('requires generic idempotency on every outbound write', () => {
    const methods = [
      'createOutbound',
      'releaseOutbound',
      'saveWaveTemplate',
      'createWave',
      'transitionWave',
      'resolveShortage',
    ] as const;
    for (const method of methods)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          OutboundController.prototype[method],
        ),
      ).toMatch(/^wms\.outbound\./);
  });

  it('denies wave release without its resource permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'wave-permission-test',
      originalUrl: '/api/v1/wms/waves/id/transition',
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
      getClass: () => OutboundController,
      getHandler: () => OutboundController.prototype.transitionWave,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'wms.wave.release' }),
    );
  });
});
