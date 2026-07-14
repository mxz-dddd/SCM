import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { CapacityTenderController } from './capacity-tender.controller';

describe('TMS capacity and tender HTTP contract', () => {
  it('uses generic idempotency for every write command', () => {
    for (const method of [
      'createCapacityPool',
      'reserveCapacity',
      'releaseCapacity',
      'expireReservations',
      'approvePlan',
      'createTender',
      'respondTender',
      'revokeTender',
      'expireTenders',
      'createQuoteRequest',
      'submitBid',
      'recommendAward',
      'decideAward',
      'retender',
      'createSubcontract',
      'respondSubcontract',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          CapacityTenderController.prototype[method],
        ),
      ).toMatch(/^tms\.capacity-tender\./);
  });

  it('denies plan approval without approval permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'capacity-tender-permission-test',
      originalUrl: '/api/v1/tms/capacity-tender/plans/id/approve',
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
      getClass: () => CapacityTenderController,
      getHandler: () => CapacityTenderController.prototype.approvePlan,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'tms.plan.approve' }),
    );
  });
});
