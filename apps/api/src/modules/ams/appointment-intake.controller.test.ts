import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { AppointmentIntakeController } from './appointment-intake.controller';

describe('AMS appointment intake HTTP contract', () => {
  it('uses generic idempotency for every write command', () => {
    for (const method of [
      'saveDraft',
      'createAndSubmit',
      'submit',
      'decide',
      'createRecurring',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          AppointmentIntakeController.prototype[method],
        ),
      ).toMatch(/^ams\./);
  });

  it('denies approval without appointment approval permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'ams-appointment-permission-test',
      originalUrl: '/api/v1/ams/appointments/id/decide',
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
      getClass: () => AppointmentIntakeController,
      getHandler: () => AppointmentIntakeController.prototype.decide,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'ams.appointment.approve' }),
    );
  });
});
