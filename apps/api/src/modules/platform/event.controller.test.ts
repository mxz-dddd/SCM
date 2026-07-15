import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from './auth/permission.guard';
import { EventController } from './event.controller';

describe('event operations authorization', () => {
  it.each([
    [
      EventController.prototype.replay,
      '/api/v1/platform/events/outbox/event-1/replay',
    ],
    [
      EventController.prototype.replayDelivery,
      '/api/v1/platform/events/deliveries/delivery-1/replay',
    ],
  ])(
    'denies dead-letter replay without platform.event.replay',
    async (handler, path) => {
      const decide = vi
        .fn()
        .mockResolvedValue({ allowed: false, reason: 'NO_GRANT' });
      const guard = new PermissionGuard(new Reflector(), { decide } as never);
      const request = {
        header: (name: string) =>
          name === 'X-Correlation-Id' ? 'event-permission-test' : undefined,
        originalUrl: path,
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
        getHandler: () => handler,
        switchToHttp: () => ({ getRequest: () => request }),
      };

      await expect(
        guard.canActivate(executionContext as never),
      ).rejects.toMatchObject({
        code: 'AUTH_PERMISSION_DENIED',
        statusCode: 403,
      });
      expect(decide).toHaveBeenCalledWith(
        expect.objectContaining({ permissionCode: 'platform.event.replay' }),
      );
    },
  );
});
