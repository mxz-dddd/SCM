import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { ReconciliationController } from './reconciliation.controller';

describe('Control reconciliation HTTP contract', () => {
  it('marks observation, schedule, run and resolution commands idempotent', () => {
    const expected = new Map([
      ['consumeObservation', 'control.reconciliation.observation.consume.v1'],
      ['bootstrapSchedules', 'control.reconciliation.schedules.bootstrap.v1'],
      ['run', 'control.reconciliation.run.v1'],
      ['resolveCase', 'control.reconciliation.case.resolve.v1'],
    ]);
    for (const [method, scope] of expected)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          ReconciliationController.prototype[
            method as keyof ReconciliationController
          ],
        ),
      ).toBe(scope);
  });

  it('denies case resolution without the dedicated permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'control-reconciliation-permission-test',
      originalUrl: '/api/v1/control/reconciliations/cases/id/resolve',
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
      getClass: () => ReconciliationController,
      getHandler: () => ReconciliationController.prototype.resolveCase,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionCode: 'control.reconciliation.resolve',
      }),
    );
  });
});
