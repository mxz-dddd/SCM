import { describe, expect, it } from 'vitest';
import { assertCommentTransition, assertPrintJobTransition, assertPrintTemplateTransition } from './collaboration-print.service';
import { assertFeatureFlagTransition } from './feature-flag.service';

describe('platform finalization state machines', () => {
  it.each([
    ['DRAFT', 'PUBLISHED'], ['PUBLISHED', 'PAUSED'], ['PUBLISHED', 'RETIRED'],
    ['PAUSED', 'PUBLISHED'], ['PAUSED', 'RETIRED'],
  ] as const)('allows feature flag %s -> %s', (current, target) => {
    expect(() => assertFeatureFlagTransition(current, target)).not.toThrow();
  });

  it('rejects invalid feature flag transitions', () => {
    expect(() => assertFeatureFlagTransition('DRAFT', 'RETIRED')).toThrow(/not allowed/);
    expect(() => assertFeatureFlagTransition('RETIRED', 'PUBLISHED')).toThrow(/not allowed/);
  });

  it('guards comment and print transitions', () => {
    expect(() => assertCommentTransition('OPEN', 'RESOLVED')).not.toThrow();
    expect(() => assertCommentTransition('RESOLVED', 'OPEN')).not.toThrow();
    expect(() => assertCommentTransition('OPEN', 'OPEN')).toThrow(/not allowed/);
    expect(() => assertPrintTemplateTransition('DRAFT', 'PUBLISHED')).not.toThrow();
    expect(() => assertPrintTemplateTransition('PUBLISHED', 'RETIRED')).not.toThrow();
    expect(() => assertPrintTemplateTransition('RETIRED', 'PUBLISHED')).toThrow(/not allowed/);
    expect(() => assertPrintJobTransition('QUEUED', 'PRINTING')).not.toThrow();
    expect(() => assertPrintJobTransition('PRINTING', 'COMPLETED')).not.toThrow();
    expect(() => assertPrintJobTransition('PRINTING', 'FAILED')).not.toThrow();
    expect(() => assertPrintJobTransition('FAILED', 'PRINTING')).not.toThrow();
    expect(() => assertPrintJobTransition('COMPLETED', 'PRINTING')).toThrow(/not allowed/);
  });
});
