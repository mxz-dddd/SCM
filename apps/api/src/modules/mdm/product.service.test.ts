import { describe, expect, it } from 'vitest';
import { assertBarcodeTransition, assertCategoryTransition, assertPackageSpecTransition, assertProductTransition } from './product.service';

describe('product master data state transitions', () => {
  it('allows every supported transition', () => {
    expect(() => assertProductTransition('DRAFT', 'ACTIVE')).not.toThrow();
    expect(() => assertProductTransition('ACTIVE', 'INACTIVE')).not.toThrow();
    expect(() => assertPackageSpecTransition('DRAFT', 'PUBLISHED')).not.toThrow();
    expect(() => assertPackageSpecTransition('PUBLISHED', 'RETIRED')).not.toThrow();
    expect(() => assertCategoryTransition('ACTIVE', 'INACTIVE')).not.toThrow();
    expect(() => assertBarcodeTransition('ACTIVE', 'INACTIVE')).not.toThrow();
  });

  it('rejects skipped, reverse and repeated transitions', () => {
    expect(() => assertProductTransition('DRAFT', 'INACTIVE')).toThrowError(/not allowed/);
    expect(() => assertProductTransition('ACTIVE', 'DRAFT')).toThrowError(/not allowed/);
    expect(() => assertProductTransition('INACTIVE', 'ACTIVE')).toThrowError(/not allowed/);
    expect(() => assertPackageSpecTransition('DRAFT', 'RETIRED')).toThrowError(/not allowed/);
    expect(() => assertPackageSpecTransition('RETIRED', 'PUBLISHED')).toThrowError(/not allowed/);
    expect(() => assertCategoryTransition('INACTIVE', 'ACTIVE')).toThrowError(/not allowed/);
    expect(() => assertBarcodeTransition('INACTIVE', 'ACTIVE')).toThrowError(/not allowed/);
  });
});
