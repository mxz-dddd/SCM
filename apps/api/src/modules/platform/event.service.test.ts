import { describe, expect, it } from 'vitest';
import { assertOutboxTransition } from './event.service';

describe('outbox state machine', () => {
  it.each([
    ['PENDING', 'PROCESSING'],
    ['FAILED', 'PROCESSING'],
    ['PROCESSING', 'PROCESSING'],
    ['PROCESSING', 'PUBLISHED'],
    ['PROCESSING', 'FAILED'],
    ['PROCESSING', 'DEAD_LETTER'],
    ['DEAD_LETTER', 'PENDING'],
  ] as const)('allows %s -> %s', (current, target) => {
    expect(() => assertOutboxTransition(current, target)).not.toThrow();
  });

  it.each([
    ['PENDING', 'PUBLISHED'],
    ['FAILED', 'PUBLISHED'],
    ['PUBLISHED', 'PROCESSING'],
    ['DEAD_LETTER', 'PROCESSING'],
  ] as const)('rejects %s -> %s', (current, target) => {
    expect(() => assertOutboxTransition(current, target)).toThrow(/not allowed/);
  });
});
