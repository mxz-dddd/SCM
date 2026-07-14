import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../platform/auth/permission.guard';
import { IDEMPOTENCY_SCOPE } from '../platform/idempotent.decorator';
import { ChangeReverseController } from './change-reverse.controller';

describe('order change and reverse authorization', () => {
  it('marks every write command for common Idempotency-Key replay', () => {
    const reflector = new Reflector();
    const scopes = [
      ['createChange', 'oms.order.change.v1'],
      ['confirmChange', 'oms.order.change-confirm.v1'],
      ['cancel', 'oms.order.cancel.v1'],
      ['progress', 'oms.order.progress.v1'],
      ['proposeSubstitution', 'oms.substitution.propose.v1'],
      ['decideSubstitution', 'oms.substitution.decision.v1'],
      ['expireSubstitutions', 'oms.substitution.expire.v1'],
      ['createRma', 'oms.rma.create.v1'],
      ['transitionRma', 'oms.rma.transition.v1'],
    ] as const;
    for (const [method, scope] of scopes)
      expect(
        reflector.get(
          IDEMPOTENCY_SCOPE,
          ChangeReverseController.prototype[method],
        ),
      ).toBe(scope);
  });

  it('denies RMA transition without its dedicated permission', async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false });
    const guard = new PermissionGuard(new Reflector(), { decide } as never);
    const request = {
      header: () => 'reverse-test',
      originalUrl: '/api/v1/oms/rmas/id/transition',
      tenantContext: {
        accountId: '10000000-0000-4000-8000-000000000001',
        tenantId: '10000000-0000-4000-8000-000000000002',
      },
    };
    const execution = {
      getClass: () => ChangeReverseController,
      getHandler: () => ChangeReverseController.prototype.transitionRma,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).rejects.toMatchObject({
      code: 'AUTH_PERMISSION_DENIED',
      statusCode: 403,
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'oms.rma.transition' }),
    );
  });
});
