import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiRateLimitGuard } from './api-rate-limit.guard';

describe('ApiRateLimitGuard', () => {
  it('uses tenant, actor and matched route for the database-backed high-water mark', async () => {
    const consume = vi.fn().mockResolvedValue(1);
    const guard = new ApiRateLimitGuard({ consume } as never);
    const request = {
      baseUrl: '/api/v1/oms',
      path: '/api/v1/oms/orders/one',
      route: { path: '/orders/:id' },
      tenantContext: {
        accountId: 'actor-1',
        accountKind: 'USER',
        tenantId: 'tenant-1',
      },
    };
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext),
    ).resolves.toBe(true);
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({
        route: '/api/v1/oms/orders/:id',
        subject: 'tenant-1:actor-1:/api/v1/oms/orders/:id',
      }),
    );
  });
});
