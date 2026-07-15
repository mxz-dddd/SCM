import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { FinancialCloseController } from './financial-close.controller';

describe('Billing invoice, payment, period and report HTTP contract', () => {
  it('marks every financial command idempotent', () => {
    const expected = new Map([
      ['createInvoice', 'billing.invoice.create.v1'],
      ['createCreditNote', 'billing.invoice.credit-note.v1'],
      ['registerPayment', 'billing.payment.register.v1'],
      ['allocatePayment', 'billing.payment.allocate.v1'],
      ['createPeriod', 'billing.period.create.v1'],
      ['startPeriodClose', 'billing.period.start-close.v1'],
      ['closePeriod', 'billing.period.close.v1'],
      ['reopenPeriod', 'billing.period.reopen.v1'],
      ['generateReport', 'billing.settlement-report.generate.v1'],
    ]);
    for (const [method, scope] of expected)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          FinancialCloseController.prototype[
            method as keyof FinancialCloseController
          ],
        ),
      ).toBe(scope);
  });

  it('denies period reopening without the high-risk permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'billing-period-reopen-permission-test',
      originalUrl: '/api/v1/billing/periods/id/reopen',
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
      getClass: () => FinancialCloseController,
      getHandler: () => FinancialCloseController.prototype.reopenPeriod,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'billing.period.reopen' }),
    );
  });
});
