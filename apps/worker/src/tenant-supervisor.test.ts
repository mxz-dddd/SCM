import { describe, expect, it, vi } from 'vitest';
import { TenantSupervisor } from './tenant-supervisor';

describe('multi-tenant worker supervisor', () => {
  it('refreshes all active pages and processes tenants with bounded isolation', async () => {
    const discoverTenants = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ code: 'A', id: 'a', name: 'A', tenantId: 'tenant-a' }],
        nextCursor: 'a',
      })
      .mockResolvedValueOnce({
        items: [{ code: 'B', id: 'b', name: 'B', tenantId: 'tenant-b' }],
      });
    const request = vi.fn().mockResolvedValue({
      eventDeliveries: 0,
      jobs: 0,
      outbox: 0,
      printJobs: 0,
      webhooks: 0,
    });
    const supervisor = new TenantSupervisor(
      { discoverTenants, request } as never,
      2,
    );
    await supervisor.refresh();
    const processed: string[] = [];
    await supervisor.run('relay', async (tenantId) => {
      processed.push(tenantId);
    });

    expect(processed.sort()).toEqual(['tenant-a', 'tenant-b']);
    expect(supervisor.health()).toMatchObject({ discoveredTenantCount: 2 });
    expect(request).toHaveBeenCalledWith(
      'tenant-a',
      '/api/v1/internal/worker/backlog',
    );
  });

  it('prevents overlapping operation re-entry for the same tenant', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const supervisor = new TenantSupervisor(
      {
        discoverTenants: vi.fn().mockResolvedValue({
          items: [{ code: 'A', id: 'a', name: 'A', tenantId: 'tenant-a' }],
        }),
        request: vi.fn().mockResolvedValue({}),
      } as never,
      1,
    );
    await supervisor.refresh();
    const handler = vi.fn().mockReturnValue(blocked);
    const first = supervisor.run('delivery', handler);
    await Promise.resolve();
    await supervisor.run('delivery', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
