import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { FulfillmentReleaseController } from './fulfillment-release.controller';
describe('order release authorization', () => {
  it('marks release writes for common Idempotency-Key replay', () => {
    const reflector = new Reflector();
    expect(reflector.get(IDEMPOTENCY_SCOPE, FulfillmentReleaseController.prototype.release)).toBe('oms.order.release.v1');
    expect(reflector.get(IDEMPOTENCY_SCOPE, FulfillmentReleaseController.prototype.batch)).toBe('oms.order.release-batch.v1');
  });
  it('denies batch release without its dedicated permission', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = { header: () => 'release-test', originalUrl: '/api/v1/oms/order-release-batches', tenantContext: { accountId: '10000000-0000-4000-8000-000000000001', tenantId: '10000000-0000-4000-8000-000000000002' } };
    const execution = { getClass: () => FulfillmentReleaseController, getHandler: () => FulfillmentReleaseController.prototype.batch, switchToHttp: () => ({ getRequest: () => request }) };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({ code: 'AUTH_PERMISSION_DENIED', statusCode: 403 });
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ permissionCode: 'oms.order.release.batch' }));
  });
});
