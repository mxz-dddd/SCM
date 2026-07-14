import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { FreightBillingController } from './freight-billing.controller';

describe('TMS freight billing HTTP contract', () => {
  it('uses generic idempotency for every command', () => {
    for (const method of [
      'captureFacts',
      'calculate',
      'createAccrual',
      'createCarrierStatement',
      'createCustomerStatement',
      'transitionCarrier',
      'transitionCustomer',
      'settleShipment',
    ] as const)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          FreightBillingController.prototype[method],
        ),
      ).toMatch(/^tms\.billing\./);
  });
  it('denies settlement without finance permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'billing-permission-test',
      originalUrl: '/api/v1/tms/billing/shipments/id/settle',
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
      getClass: () => FreightBillingController,
      getHandler: () => FreightBillingController.prototype.settleShipment,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'tms.billing.settle' }),
    );
  });
});
