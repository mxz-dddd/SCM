import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { FulfillmentProcessController } from './fulfillment-process.controller';

describe('fulfillment process HTTP contract', () => {
  it('marks event consumption and explicit step retry as idempotent writes', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(
        IDEMPOTENCY_SCOPE,
        FulfillmentProcessController.prototype.consume,
      ),
    ).toBe('oms.fulfillment-process.consume.v2');
    expect(
      reflector.get(
        IDEMPOTENCY_SCOPE,
        FulfillmentProcessController.prototype.retry,
      ),
    ).toBe('oms.fulfillment-process.retry-step.v1');
    expect(
      reflector.get(
        IDEMPOTENCY_SCOPE,
        FulfillmentProcessController.prototype.compensate,
      ),
    ).toBe('oms.fulfillment-process.compensate-step.v1');
  });

  it('denies step retry without projection permission', async () => {
    const decide = vi
      .fn()
      .mockResolvedValue({ allowed: false, reason: 'NO_GRANT' });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'fulfillment-process-permission-test',
      originalUrl: '/api/v1/oms/fulfillment-processes/process/steps/step/retry',
      tenantContext: {
        accountId: '10000000-0000-4000-8000-000000000001',
        tenantId: '10000000-0000-4000-8000-000000000002',
      },
    };
    const execution = {
      getClass: () => FulfillmentProcessController,
      getHandler: () => FulfillmentProcessController.prototype.retry,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'oms.fulfillment.project' }),
    );
  });
});
