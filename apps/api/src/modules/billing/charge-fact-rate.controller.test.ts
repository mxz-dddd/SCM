import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { ChargeFactRateController } from './charge-fact-rate.controller';

describe('Billing charge fact HTTP contract', () => {
  it('uses generic idempotency for fact receipt and correction', () => {
    expect(
      Reflect.getMetadata(
        IDEMPOTENCY_SCOPE,
        ChargeFactRateController.prototype.receive,
      ),
    ).toBe('billing.charge-fact.receive.v1');
    expect(
      Reflect.getMetadata(
        IDEMPOTENCY_SCOPE,
        ChargeFactRateController.prototype.correct,
      ),
    ).toBe('billing.charge-fact.correct.v1');
    expect(
      Reflect.getMetadata(
        IDEMPOTENCY_SCOPE,
        ChargeFactRateController.prototype.consume,
      ),
    ).toBe('billing.charge-fact.consume.v1');
  });

  it('denies fact correction without the dedicated permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'billing-permission-test',
      originalUrl: '/api/v1/billing/facts/id/corrections',
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
      getClass: () => ChargeFactRateController,
      getHandler: () => ChargeFactRateController.prototype.correct,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'billing.fact.correct' }),
    );
  });
});
