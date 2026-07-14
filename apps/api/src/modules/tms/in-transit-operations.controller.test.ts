import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { InTransitOperationsController } from './in-transit-operations.controller';

describe('TMS in-transit operations HTTP contract', () => {
  it('uses generic idempotency for every command', () => {
    for (const method of [
      'refreshMap',
      'detectExceptions',
      'actOnException',
      'escalateDue',
      'requestAppointment',
      'requestAppointmentChange',
      'applyAppointmentEvent',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          InTransitOperationsController.prototype[method],
        ),
      ).toMatch(/^tms\.operations\./);
  });

  it('denies precise position without the separate permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'map-permission-test',
      originalUrl: '/api/v1/tms/in-transit/shipments/id/map/precise',
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
      getClass: () => InTransitOperationsController,
      getHandler: () => InTransitOperationsController.prototype.preciseMap,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'tms.operations.map.precise' }),
    );
  });
});
