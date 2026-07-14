import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { WarehouseFleetController } from './warehouse-fleet.controller';

describe('warehouse projection authorization', () => {
  it('denies projection writes without mdm.warehouse.project', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = { header: (name: string) => name === 'X-Correlation-Id' ? 'warehouse-permission-test' : undefined, originalUrl: '/api/v1/mdm/warehouses/id/usage-projection', tenantContext: { accountId: '10000000-0000-4000-8000-000000000001', accountKind: 'USER', deviceId: 'test', organizationIds: [], permissionVersion: 1, tenantId: '10000000-0000-4000-8000-000000000002', tokenId: 'token' } };
    const executionContext = { getClass: () => WarehouseFleetController, getHandler: () => WarehouseFleetController.prototype.updateUsage, switchToHttp: () => ({ getRequest: () => request }) };
    await expect(guard.canActivate(executionContext as never)).rejects.toMatchObject({ code: 'AUTH_PERMISSION_DENIED', statusCode: 403 });
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ permissionCode: 'mdm.warehouse.project' }));
  });
});
