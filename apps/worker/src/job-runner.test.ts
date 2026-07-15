import { describe, expect, it, vi } from 'vitest';
import { executeRoutedHandler, routeHandler, withTimeout } from './job-runner';

describe('system job runner', () => {
  it('routes whitelisted handlers and preserves payload', async () => {
    await expect(routeHandler('REPORT', { reportId: 'r1' })).resolves.toEqual({
      accepted: true,
      handler: 'REPORT',
      payload: { reportId: 'r1' },
    });
  });

  it('rejects unknown handlers', async () => {
    await expect(routeHandler('SHELL', {})).rejects.toThrow(
      'JOB_HANDLER_UNKNOWN',
    );
  });

  it('executes reconciliation jobs through the governed control API', async () => {
    const request = vi.fn().mockResolvedValue({
      reconciliationRunId: 'run-1',
      status: 'COMPLETED',
    });
    await expect(
      executeRoutedHandler(
        'RECONCILIATION',
        {
          periodEnd: '2030-07-11T00:00:00.000Z',
          periodStart: '2030-07-10T00:00:00.000Z',
          type: 'ORDER_FULFILLMENT',
        },
        'tenant-1',
        'job-run-1',
        { request } as never,
      ),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(request).toHaveBeenCalledWith(
      'tenant-1',
      '/api/v1/control/reconciliations/runs',
      expect.objectContaining({
        body: JSON.stringify({
          periodEnd: '2030-07-11T00:00:00.000Z',
          periodStart: '2030-07-10T00:00:00.000Z',
          triggerRef: 'job-run-1',
          type: 'ORDER_FULFILLMENT',
        }),
        method: 'POST',
      }),
    );
  });

  it('executes AI optimization jobs through the narrow worker command', async () => {
    const request = vi.fn().mockResolvedValue({
      optimizationId: 'route-1',
      status: 'SUCCEEDED',
    });
    await expect(
      executeRoutedHandler(
        'AI_OPTIMIZATION',
        { aggregateId: 'route-1', kind: 'ROUTE' },
        'tenant-1',
        'job-run-1',
        { request } as never,
      ),
    ).resolves.toMatchObject({ status: 'SUCCEEDED' });
    expect(request).toHaveBeenCalledWith(
      'tenant-1',
      '/api/v1/control/ai/jobs/execute',
      {
        body: JSON.stringify({
          aggregateId: 'route-1',
          kind: 'ROUTE',
          jobRunId: 'job-run-1',
        }),
        method: 'POST',
      },
    );
  });

  it('executes operations jobs through the narrow worker command', async () => {
    const request = vi.fn().mockResolvedValue({ status: 'COMPLETED' });
    await expect(
      executeRoutedHandler(
        'OPS_OPERATION',
        { aggregateId: 'archive-1', kind: 'ARCHIVE' },
        'tenant-1',
        'job-run-1',
        { request } as never,
      ),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(request).toHaveBeenCalledWith(
      'tenant-1',
      '/api/v1/platform/operations/jobs/execute',
      {
        body: JSON.stringify({
          aggregateId: 'archive-1',
          kind: 'ARCHIVE',
          jobRunId: 'job-run-1',
        }),
        headers: { 'Idempotency-Key': 'ops-operation:job-run-1' },
        method: 'POST',
      },
    );
  });

  it('fails work that exceeds its timeout', async () => {
    await expect(withTimeout(new Promise(() => undefined), 1)).rejects.toThrow(
      'JOB_TIMEOUT',
    );
  });
});
