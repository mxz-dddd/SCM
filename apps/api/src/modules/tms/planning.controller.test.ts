import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { PlanningController } from './planning.controller';

describe('TMS planning HTTP contract', () => {
  it('marks every planning write command with generic idempotency', () => {
    for (const method of [
      'createBatch',
      'claimOrder',
      'releaseLock',
      'buildPlan',
      'validatePlan',
      'publishPlan',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          PlanningController.prototype[method],
        ),
      ).toMatch(/^tms\.planning\./);
  });

  it('denies plan publication without publish permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'planning-permission-test',
      originalUrl: '/api/v1/tms/planning/plans/id/publish',
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
      getClass: () => PlanningController,
      getHandler: () => PlanningController.prototype.publishPlan,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'tms.planning.publish' }),
    );
  });
});
