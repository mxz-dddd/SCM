import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { OrderOperationsController } from './order-operations.controller';

describe('order operations authorization', () => {
  it('marks operations writes for Idempotency-Key replay', () => {
    const reflector = new Reflector();
    for (const [method, scope] of [
      ['detect', 'oms.exception.detect.v1'],
      ['reportException', 'oms.exception.report.v1'],
      ['batchExceptions', 'oms.exception.batch.v1'],
      ['assign', 'oms.exception.assign.v1'],
      ['exceptionAction', 'oms.exception.action.v1'],
      ['startSla', 'oms.sla.start.v1'],
      ['monitorSla', 'oms.sla.monitor.v1'],
      ['transitionSla', 'oms.sla.transition.v1'],
      ['settlement', 'oms.settlement.request.v1'],
      ['projectSettlement', 'oms.settlement.project.v1'],
      ['batch', 'oms.order.batch.v1'],
      ['portalChange', 'oms.portal.order.change.v1'],
      ['portalCancel', 'oms.portal.order.cancel.v1'],
      ['portalRma', 'oms.portal.rma.create.v1'],
    ] as const)
      expect(
        reflector.get(
          IDEMPOTENCY_SCOPE,
          OrderOperationsController.prototype[method],
        ),
      ).toBe(scope);
  });
  it('denies a customer portal read without portal permission', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => undefined,
      originalUrl: '/api/v1/oms/portal/orders/id',
      tenantContext: {},
    };
    const execution = {
      getClass: () => OrderOperationsController,
      getHandler: () => OrderOperationsController.prototype.portal,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'oms.portal.order.read' }),
    );
  });
});
