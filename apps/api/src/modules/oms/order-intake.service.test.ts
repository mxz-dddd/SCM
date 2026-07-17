import { describe, expect, it } from 'vitest';
import { assertOrderSubmissionTransition } from './order-intake.service';

describe('order intake transitions', () => {
  it('allows validation and submission transitions', () => {
    expect(() =>
      assertOrderSubmissionTransition('DRAFT', 'INVALID'),
    ).not.toThrow();
    expect(() =>
      assertOrderSubmissionTransition('DRAFT', 'OPEN'),
    ).not.toThrow();
    expect(() =>
      assertOrderSubmissionTransition('INVALID', 'OPEN'),
    ).not.toThrow();
  });

  it('rejects reverse, skipped and terminal transitions', () => {
    expect(() =>
      assertOrderSubmissionTransition('OPEN', 'INVALID'),
    ).toThrowError(/not allowed/);
    expect(() => assertOrderSubmissionTransition('OPEN', 'OPEN')).toThrowError(
      /not allowed/,
    );
    expect(() =>
      assertOrderSubmissionTransition('INVALID', 'INVALID'),
    ).toThrowError(/not allowed/);
  });
});
