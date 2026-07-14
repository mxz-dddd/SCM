import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { InventoryController } from './inventory.controller';

describe('WMS inventory HTTP contract', () => {
  it('requires idempotency on every inventory write command', () => {
    const methods = [
      'receive',
      'transition',
      'hold',
      'releaseHold',
      'reserve',
      'releaseReservation',
      'transfer',
      'transferOwnership',
      'createCount',
      'countLine',
      'approveCountLine',
      'transitionCount',
      'releaseCountSegment',
    ] as const;
    for (const method of methods)
      expect(
        Reflect.getMetadata(
          IDEMPOTENCY_SCOPE,
          InventoryController.prototype[method],
        ),
      ).toMatch(/^wms\.inventory\./);
  });

  it('denies inventory reservation without resource permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'inventory-permission-test',
      originalUrl: '/api/v1/wms/inventory/id/reservations',
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
      getClass: () => InventoryController,
      getHandler: () => InventoryController.prototype.reserve,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'wms.inventory.reserve' }),
    );
  });

  it('denies ownership transfer without its resource permission', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'NO_MATCHING_GRANT',
    });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'ownership-permission-test',
      originalUrl: '/api/v1/wms/inventory/id/ownership-transfers',
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
      getClass: () => InventoryController,
      getHandler: () => InventoryController.prototype.transferOwnership,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionCode: 'wms.inventory.owner-transfer',
      }),
    );
  });
});
