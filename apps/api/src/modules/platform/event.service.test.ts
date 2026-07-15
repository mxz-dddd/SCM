import { describe, expect, it } from 'vitest';
import {
  assertDeliveryTransition,
  assertOutboxTransition,
} from './event.service';

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
    expect(() => assertOutboxTransition(current, target)).toThrow(
      /not allowed/,
    );
  });
});

describe('event delivery state machine', () => {
  it.each([
    ['PENDING', 'PROCESSING'],
    ['FAILED', 'PROCESSING'],
    ['PROCESSING', 'PROCESSING'],
    ['PROCESSING', 'PROCESSED'],
    ['PROCESSING', 'IGNORED'],
    ['PROCESSING', 'FAILED'],
    ['PROCESSING', 'DEAD_LETTER'],
    ['DEAD_LETTER', 'PENDING'],
    ['DEAD_LETTER', 'IGNORED'],
  ] as const)('allows %s -> %s', (current, target) => {
    expect(() => assertDeliveryTransition(current, target)).not.toThrow();
  });

  it.each([
    ['PENDING', 'PROCESSED'],
    ['FAILED', 'PROCESSED'],
    ['PROCESSED', 'PROCESSING'],
    ['IGNORED', 'PENDING'],
    ['DEAD_LETTER', 'PROCESSING'],
  ] as const)('rejects %s -> %s', (current, target) => {
    expect(() => assertDeliveryTransition(current, target)).toThrow(
      /not allowed/,
    );
  });
});
