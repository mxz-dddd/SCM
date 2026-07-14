import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { ProductController } from './product.controller';

describe('product command authorization', () => {
  it('denies publishing when RBAC does not grant mdm.product.publish', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: (name: string) => name === 'X-Correlation-Id' ? 'mdm-permission-test' : undefined,
      originalUrl: '/api/v1/mdm/products/10000000-0000-4000-8000-000000000001/publish',
      tenantContext: { accountId: '10000000-0000-4000-8000-000000000002', accountKind: 'USER', deviceId: 'test', organizationIds: [], permissionVersion: 1, tenantId: '10000000-0000-4000-8000-000000000003', tokenId: 'token' },
    };
    const executionContext = { getClass: () => ProductController, getHandler: () => ProductController.prototype.publishProduct, switchToHttp: () => ({ getRequest: () => request }) };
    await expect(guard.canActivate(executionContext as never)).rejects.toMatchObject({ code: 'AUTH_PERMISSION_DENIED', statusCode: 403 });
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ permissionCode: 'mdm.product.publish' }));
  });
});
