import { describe, expect, it } from 'vitest';
import { assertReviewTransition } from './order-governance.service';

describe('order review and hold transitions', () => {
  it('allows every declared transition', () => {
    for (const [from, to] of [
      ['OPEN', 'APPROVED'],
      ['OPEN', 'REJECTED'],
      ['OPEN', 'HOLD'],
      ['APPROVED', 'HOLD'],
      ['HOLD', 'OPEN'],
      ['HOLD', 'APPROVED'],
      ['HOLD', 'REJECTED'],
    ] as const)
      expect(() => assertReviewTransition(from, to)).not.toThrow();
  });

  it('rejects skipped, reverse and terminal transitions', () => {
    expect(() => assertReviewTransition('DRAFT', 'APPROVED')).toThrowError(
      /not allowed/,
    );
    expect(() => assertReviewTransition('APPROVED', 'OPEN')).toThrowError(
      /not allowed/,
    );
    expect(() => assertReviewTransition('REJECTED', 'OPEN')).toThrowError(
      /not allowed/,
    );
  });
});
