import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { InboundController } from './inbound.controller';

describe('WMS inbound HTTP contract', () => {
  it('requires idempotency for every write endpoint', () => {
    const writes = [
      'create',
      'publish',
      'packages',
      'appointment',
      'checkIn',
      'tasks',
      'assign',
      'claim',
      'transfer',
      'transition',
      'complete',
      'scan',
      'resolve',
    ] as const;
    for (const method of writes) {
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          InboundController.prototype[method],
        ),
      ).toMatch(/^wms\./);
    }
  });

  it('denies manual barcode resolution without its dedicated permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: (name: string) =>
        name === 'X-Correlation-Id' ? 'wms-permission-test' : undefined,
      originalUrl: '/api/v1/wms/scans/id/manual-resolution',
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
      getClass: () => InboundController,
      getHandler: () => InboundController.prototype.resolve,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'wms.scan.resolve' }),
    );
  });
});
