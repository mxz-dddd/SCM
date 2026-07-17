import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionContextService } from './session-context.service';

const workerToken = 'worker-control-token-for-tests-at-least-32-characters';
const workerActorId = '10000000-0000-4000-8000-000000000099';

describe('worker session context', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('creates a restricted context only for an active requested tenant', async () => {
    vi.stubEnv('WORKER_CONTROL_TOKEN', workerToken);
    vi.stubEnv('WORKER_ACTOR_ID', workerActorId);
    const tenantId = randomUUID();
    const prisma = {
      tenant: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    };
    const tokens = { verify: vi.fn() };
    const service = new SessionContextService(prisma as never, tokens as never);

    await expect(
      service.authenticate(`Bearer ${workerToken}`, tenantId),
    ).resolves.toMatchObject({
      accountId: workerActorId,
      accountKind: 'WORKER',
      organizationIds: [],
      tenantId,
    });
    expect(tokens.verify).not.toHaveBeenCalled();
  });

  it('rejects suspended tenants and keeps normal JWT tenant matching strict', async () => {
    vi.stubEnv('WORKER_CONTROL_TOKEN', workerToken);
    vi.stubEnv('WORKER_ACTOR_ID', workerActorId);
    const prisma = {
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ status: 'SUSPENDED' }),
      },
    };
    const tokens = {
      verify: vi.fn().mockReturnValue({ tenantId: randomUUID() }),
    };
    const service = new SessionContextService(prisma as never, tokens as never);

    await expect(
      service.authenticate(`Bearer ${workerToken}`, randomUUID()),
    ).rejects.toMatchObject({ code: 'WORKER_TENANT_UNAVAILABLE' });
    await expect(
      service.authenticate('Bearer normal-jwt', randomUUID()),
    ).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISMATCH' });
  });

  it('discovers only the sanitized active tenant page with a worker token', async () => {
    vi.stubEnv('WORKER_CONTROL_TOKEN', workerToken);
    vi.stubEnv('WORKER_ACTOR_ID', workerActorId);
    const tenantId = randomUUID();
    const prisma = {
      tenant: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { code: 'A', id: tenantId, name: 'Tenant A', tenantId },
          ]),
      },
    };
    const service = new SessionContextService(prisma as never, {} as never);

    await expect(
      service.discoverActiveTenants(`Bearer ${workerToken}`, { limit: '10' }),
    ).resolves.toEqual({
      items: [{ code: 'A', id: tenantId, name: 'Tenant A', tenantId }],
      nextCursor: undefined,
    });
    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );
    await expect(
      service.discoverActiveTenants('Bearer ordinary-user-jwt', {}),
    ).rejects.toMatchObject({ code: 'WORKER_AUTH_REQUIRED' });
  });
});
