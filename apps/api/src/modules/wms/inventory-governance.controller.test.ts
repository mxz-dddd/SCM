import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { InventoryGovernanceController } from './inventory-governance.controller';

describe('WMS inventory governance HTTP contract', () => {
  it('requires generic idempotency on every governance write command', () => {
    const methods = [
      'createAdjustment',
      'transitionAdjustment',
      'saveReplenishmentPolicy',
      'planReplenishment',
      'executeReplenishment',
      'runAging',
      'reconcile',
      'resolveReconciliationCase',
      'closeReconciliation',
    ] as const;
    for (const method of methods)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          InventoryGovernanceController.prototype[method],
        ),
      ).toMatch(/^wms\.inventory\./);
  });

  it('denies adjustment approval without its resource permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'adjustment-permission-test',
      originalUrl: '/api/v1/wms/inventory-adjustments/id/transition',
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
      getClass: () => InventoryGovernanceController,
      getHandler: () =>
        InventoryGovernanceController.prototype.transitionAdjustment,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionCode: 'wms.inventory.adjust.approve',
      }),
    );
  });
});
