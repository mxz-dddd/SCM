import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { OnsiteOperationsController } from './onsite-operations.controller';

describe('AMS gate, queue and dock HTTP contract', () => {
  it('uses generic idempotency on every on-site write command', () => {
    for (const method of ['verifyGate','issuePass','access','enqueue','call','acknowledgeCall','timeoutCall','assignDock','switchDock','setDockFault'] as const)
      expect(Reflect.getMetadata(IDEMPOTENCY_SCOPE, OnsiteOperationsController.prototype[method])).toMatch(/^ams\./);
  });

  it('denies dock assignment without dispatcher permission', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false, reason: 'NO_MATCHING_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = { header: () => 'onsite-permission-test', originalUrl: '/api/v1/ams/onsite/appointments/id/dock-assignments', tenantContext: { accountId: '10000000-0000-4000-8000-000000000001', accountKind: 'USER', deviceId: 'test', organizationIds: [], permissionVersion: 1, tenantId: '10000000-0000-4000-8000-000000000002', tokenId: 'token' } };
    const execution = { getClass: () => OnsiteOperationsController, getHandler: () => OnsiteOperationsController.prototype.assignDock, switchToHttp: () => ({ getRequest: () => request }) };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({ code: 'AUTH_PERMISSION_DENIED', statusCode: 403 });
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ permissionCode: 'ams.dock.assign' }));
  });
});
