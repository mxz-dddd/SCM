import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { ReceivingDetailController } from './receiving-detail.controller';

describe('WMS receiving detail HTTP contract', () => {
  it('requires idempotency metadata on every receiving write', () => {
    const writes = [
      'receive',
      'receiveAuthorized',
      'createHandlingUnit',
      'build',
      'split',
      'merge',
      'reprint',
      'variance',
      'disposition',
    ] as const;
    for (const method of writes)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          ReceivingDetailController.prototype[method],
        ),
      ).toMatch(/^wms\./);
  });

  it('denies overage and shortage confirmation without supervisor permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'receiving-permission-test',
      originalUrl: '/api/v1/wms/inbounds/id/receive-authorized',
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
      getClass: () => ReceivingDetailController,
      getHandler: () => ReceivingDetailController.prototype.receiveAuthorized,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionCode: 'wms.receipt.variance.authorize',
      }),
    );
  });
});
