import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { SettlementVoucherController } from './settlement-voucher.controller';

describe('Billing settlement voucher HTTP contract', () => {
  it('marks every voucher and accrual command idempotent', () => {
    const expected = new Map([
      ['create', 'billing.voucher.create.v1'],
      ['calculate', 'billing.voucher.calculate.v1'],
      ['validate', 'billing.voucher.validate.v1'],
      ['decide', 'billing.voucher.approval-decide.v1'],
      ['createAccrual', 'billing.accrual.create.v1'],
      ['postAccrual', 'billing.accrual.post.v1'],
    ]);
    for (const [method, scope] of expected)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          SettlementVoucherController.prototype[
            method as keyof SettlementVoucherController
          ],
        ),
      ).toBe(scope);
  });

  it('denies approval without the dedicated permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'billing-voucher-permission-test',
      originalUrl: '/api/v1/billing/voucher-approvals/id/decide',
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
      getClass: () => SettlementVoucherController,
      getHandler: () => SettlementVoucherController.prototype.decide,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'billing.voucher.approve' }),
    );
  });
});
