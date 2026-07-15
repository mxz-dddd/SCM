import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { WorkerAccessible } from './worker-access.decorator';
import { WorkerAccessGuard } from './worker-access.guard';

class Routes {
  @WorkerAccessible('EVENT_RELAY_CLAIM')
  allowed() {}
  denied() {}
}

const execution = (handler: keyof Routes, accountKind: string) => {
  const request = { tenantContext: { accountKind } };
  return {
    context: {
      getClass: () => Routes,
      getHandler: () => Routes.prototype[handler],
      switchToHttp: () => ({ getRequest: () => request }),
    },
    request,
  };
};

describe('worker route allowlist guard', () => {
  it('allows only an explicitly marked worker operation', () => {
    const guard = new WorkerAccessGuard(new Reflector());
    const marked = execution('allowed', 'WORKER');
    expect(guard.canActivate(marked.context as never)).toBe(true);
    expect(marked.request).toMatchObject({
      workerOperation: 'EVENT_RELAY_CLAIM',
    });

    const unmarked = execution('denied', 'WORKER');
    expect(() => guard.canActivate(unmarked.context as never)).toThrow(
      'cannot access this operation',
    );
  });

  it('does not bypass normal-user RBAC on a marked route', () => {
    const guard = new WorkerAccessGuard(new Reflector());
    const normal = execution('allowed', 'USER');
    expect(guard.canActivate(normal.context as never)).toBe(true);
    expect(normal.request).not.toHaveProperty('workerOperation');
  });
});
