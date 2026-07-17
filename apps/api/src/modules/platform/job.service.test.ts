import { describe, expect, it } from 'vitest';
import { assertJobTransition, JobService } from './job.service';

describe('job state machine and validation', () => {
  it.each([
    ['QUEUED', 'RUNNING'],
    ['QUEUED', 'CANCELLED'],
    ['RUNNING', 'CANCEL_REQUESTED'],
    ['RUNNING', 'QUEUED'],
    ['RUNNING', 'SUCCEEDED'],
    ['RUNNING', 'FAILED'],
    ['RUNNING', 'TIMED_OUT'],
    ['CANCEL_REQUESTED', 'CANCELLED'],
  ] as const)('allows %s -> %s', (current, target) => {
    expect(() => assertJobTransition(current, target)).not.toThrow();
  });

  it.each([
    ['QUEUED', 'SUCCEEDED'],
    ['CANCEL_REQUESTED', 'SUCCEEDED'],
    ['SUCCEEDED', 'RUNNING'],
    ['FAILED', 'QUEUED'],
    ['CANCELLED', 'RUNNING'],
    ['TIMED_OUT', 'QUEUED'],
  ] as const)('rejects %s -> %s', (current, target) => {
    expect(() => assertJobTransition(current, target)).toThrow(/not allowed/);
  });

  it('rejects invalid definition input before persistence', async () => {
    const service = new JobService({} as never, {} as never, {} as never);
    await expect(
      service.saveDefinition(
        {
          code: 'BAD',
          cronExpression: '* * *',
          handler: 'SHELL',
          name: 'Bad job',
          triggerType: 'CRON',
        },
        {
          accountId: '10000000-0000-4000-8000-000000000001',
          accountKind: 'USER',
          deviceId: 'test',
          organizationIds: [],
          permissionVersion: 1,
          tenantId: '10000000-0000-4000-8000-000000000002',
          tokenId: 'token',
        },
        {
          correlationId: 'test',
          idempotencyKey: 'test',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toThrow(/invalid/);
  });
});
