import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { OperationClosureController } from './operation-closure.controller';

describe('AMS operation closure HTTP contract', () => {
  it('uses generic idempotency on every operation write command', () => {
    for (const method of [
      'recordEvent',
      'checkOut',
      'complete',
      'markNoShow',
      'appeal',
      'decideAppeal',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          OperationClosureController.prototype[method],
        ),
      ).toMatch(/^ams\./);
  });

  it('denies penalty waiver without finance permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'ams-operation-permission-test',
      originalUrl: '/api/v1/ams/operations/appeals/id/decide',
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
      getClass: () => OperationClosureController,
      getHandler: () => OperationClosureController.prototype.decideAppeal,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'ams.noshow.waive' }),
    );
  });
});
