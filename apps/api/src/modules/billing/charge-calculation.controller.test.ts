import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { ChargeCalculationController } from './charge-calculation.controller';

describe('Billing calculation HTTP contract', () => {
  it('uses the generic idempotency record for calculation replay', () => {
    expect(
      Reflect.getMetadata(
        IDEMPOTENCY_SCOPE,
        ChargeCalculationController.prototype.calculate,
      ),
    ).toBe('billing.charge.calculate.v1');
  });

  it('denies calculation without the execute permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'billing-calculation-permission-test',
      originalUrl: '/api/v1/billing/calculations',
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
      getClass: () => ChargeCalculationController,
      getHandler: () => ChargeCalculationController.prototype.calculate,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionCode: 'billing.calculation.execute',
      }),
    );
  });
});
