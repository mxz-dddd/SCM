import { describe, expect, it } from 'vitest';
import {
  assertProcessStepTransition,
  assertProcessTransition,
} from './fulfillment-process.state';

describe('fulfillment process transition maps', () => {
  it.each([
    ['STARTED', 'WAITING_DOWNSTREAM'],
    ['WAITING_DOWNSTREAM', 'EXECUTING'],
    ['WAITING_DOWNSTREAM', 'FAILED'],
    ['WAITING_DOWNSTREAM', 'MANUAL_INTERVENTION'],
    ['EXECUTING', 'COMPLETED'],
    ['EXECUTING', 'FAILED'],
    ['EXECUTING', 'COMPENSATING'],
    ['EXECUTING', 'MANUAL_INTERVENTION'],
    ['FAILED', 'WAITING_DOWNSTREAM'],
    ['FAILED', 'COMPENSATING'],
    ['FAILED', 'MANUAL_INTERVENTION'],
    ['COMPENSATING', 'FAILED'],
    ['COMPENSATING', 'MANUAL_INTERVENTION'],
    ['MANUAL_INTERVENTION', 'WAITING_DOWNSTREAM'],
    ['MANUAL_INTERVENTION', 'COMPENSATING'],
  ] as const)('allows process %s -> %s', (current, target) => {
    expect(() => assertProcessTransition(current, target)).not.toThrow();
  });

  it.each([
    ['PENDING', 'PROCESSING'],
    ['PENDING', 'SUCCEEDED'],
    ['PENDING', 'FAILED'],
    ['PENDING', 'MANUAL'],
    ['PROCESSING', 'SUCCEEDED'],
    ['PROCESSING', 'FAILED'],
    ['PROCESSING', 'MANUAL'],
    ['MANUAL', 'PENDING'],
    ['MANUAL', 'COMPENSATING'],
    ['SUCCEEDED', 'COMPENSATING'],
    ['SUCCEEDED', 'MANUAL'],
    ['FAILED', 'PENDING'],
    ['FAILED', 'COMPENSATING'],
    ['FAILED', 'MANUAL'],
    ['COMPENSATING', 'COMPENSATED'],
    ['COMPENSATING', 'FAILED'],
    ['COMPENSATING', 'MANUAL'],
  ] as const)('allows step %s -> %s', (current, target) => {
    expect(() => assertProcessStepTransition(current, target)).not.toThrow();
  });

  it('rejects terminal regression', () => {
    expect(() =>
      assertProcessTransition('COMPLETED', 'EXECUTING'),
    ).toThrowError(
      expect.objectContaining({
        code: 'FULFILLMENT_PROCESS_TRANSITION_INVALID',
      }),
    );
    expect(() =>
      assertProcessStepTransition('COMPENSATED', 'PENDING'),
    ).toThrowError(
      expect.objectContaining({ code: 'FULFILLMENT_STEP_TRANSITION_INVALID' }),
    );
  });
});
