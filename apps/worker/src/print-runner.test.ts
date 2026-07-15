import { describe, expect, it, vi } from 'vitest';
import { processPrintJob } from './print-runner';

describe('print worker', () => {
  it('claims the routed job and completes it', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({
        routeSnapshot: { printer: 'P1' },
        templateSnapshot: { body: 'x' },
        version: 2,
      })
      .mockResolvedValueOnce({ status: 'COMPLETED', version: 3 });
    const result = await processPrintJob(
      {
        data: { printJobId: 'job-1', tenantId: 'tenant-1' },
        id: 'bull-1',
      } as never,
      { request } as never,
    );
    expect(result).toEqual({ status: 'COMPLETED', version: 3 });
    expect(request.mock.calls[1]?.[1]).toContain('/claim');
    expect(request.mock.calls[2]?.[1]).toContain('/complete');
  });
});
