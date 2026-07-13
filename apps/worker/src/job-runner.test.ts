import { describe, expect, it } from 'vitest';
import { routeHandler, withTimeout } from './job-runner';

describe('system job runner', () => {
  it('routes whitelisted handlers and preserves payload', async () => {
    await expect(routeHandler('REPORT', { reportId: 'r1' })).resolves.toEqual({
      accepted: true,
      handler: 'REPORT',
      payload: { reportId: 'r1' },
    });
  });

  it('rejects unknown handlers', async () => {
    await expect(routeHandler('SHELL', {})).rejects.toThrow('JOB_HANDLER_UNKNOWN');
  });

  it('fails work that exceeds its timeout', async () => {
    await expect(withTimeout(new Promise(() => undefined), 1)).rejects.toThrow('JOB_TIMEOUT');
  });
});
