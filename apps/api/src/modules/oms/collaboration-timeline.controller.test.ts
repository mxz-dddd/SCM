import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { CollaborationTimelineController } from './collaboration-timeline.controller';
describe('partner collaboration authorization', () => {
  it('denies ASN submission outside partner permission', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => undefined,
      originalUrl: '/api/v1/oms/orders/id/asns',
      tenantContext: {},
    };
    const execution = {
      getClass: () => CollaborationTimelineController,
      getHandler: () => CollaborationTimelineController.prototype.asn,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'oms.asn.write' }),
    );
  });
});
