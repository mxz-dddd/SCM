import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { ReconciliationController } from './reconciliation.controller';

describe('Billing reconciliation HTTP contract', () => {
  it('marks every reconciliation and adjustment command idempotent', () => {
    const expected = new Map([
      ['createStatement', 'billing.reconciliation.create.v1'],
      ['publishStatement', 'billing.reconciliation.publish.v1'],
      ['reconcileStatement', 'billing.reconciliation.reconcile.v1'],
      ['raiseDispute', 'billing.reconciliation.dispute.v1'],
      ['respondDispute', 'billing.reconciliation.dispute-respond.v1'],
      ['createAdjustment', 'billing.adjustment.create.v1'],
      ['submitAdjustment', 'billing.adjustment.submit.v1'],
      ['decideAdjustment', 'billing.adjustment.approval-decide.v1'],
      ['postAdjustment', 'billing.adjustment.post.v1'],
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

  it('denies adjustment approval without the dedicated permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'billing-adjustment-permission-test',
      originalUrl: '/api/v1/billing/adjustment-approvals/id/decide',
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
      getHandler: () => ReconciliationController.prototype.decideAdjustment,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionCode: 'billing.adjustment.approve',
      }),
    );
  });
});
