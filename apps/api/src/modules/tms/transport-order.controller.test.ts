import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { TransportOrderController } from './transport-order.controller';

describe('TMS transport order HTTP contract', () => {
  it('uses the generic Idempotency-Key interceptor for receive and review', () => {
    expect(
      Reflect.getMetadata(
        IDEMPOTENCY_SCOPE,
        TransportOrderController.prototype.receive,
      ),
    ).toBe('tms.transport-order.receive.v1');
    expect(
      Reflect.getMetadata(
        IDEMPOTENCY_SCOPE,
        TransportOrderController.prototype.review,
      ),
    ).toBe('tms.transport-order.review.v1');
  });

  it('denies review without transport supervisor permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'tms-permission-test',
      originalUrl: '/api/v1/tms/transport-orders/id/review',
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
      getClass: () => TransportOrderController,
      getHandler: () => TransportOrderController.prototype.review,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'tms.transport.review' }),
    );
  });
});
