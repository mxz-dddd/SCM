import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from './auth/permission.guard';
import { EventController } from './event.controller';

describe('event operations authorization', () => {
  it('denies dead-letter replay without platform.event.replay', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false, reason: 'NO_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: (name: string) =>
        name === 'X-Correlation-Id' ? 'event-permission-test' : undefined,
      originalUrl: '/api/v1/platform/events/outbox/event-1/replay',
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
    const executionContext = {
      getClass: () => EventController,
      getHandler: () => EventController.prototype.replay,
      switchToHttp: () => ({ getRequest: () => request }),
    };

    await expect(guard.canActivate(executionContext as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'platform.event.replay' }),
    );
  });
});
