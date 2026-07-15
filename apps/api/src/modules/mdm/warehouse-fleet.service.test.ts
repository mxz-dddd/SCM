import { describe, expect, it } from 'vitest';
import {
  assertDriverCertificateTransition,
  assertFleetTransition,
  assertWarehouseTransition,
} from './warehouse-fleet.service';

describe('warehouse and fleet transitions', () => {
  it('allows all declared transitions', () => {
    expect(() => assertWarehouseTransition('DRAFT', 'ACTIVE')).not.toThrow();
    expect(() => assertWarehouseTransition('ACTIVE', 'INACTIVE')).not.toThrow();
    expect(() => assertFleetTransition('DRAFT', 'AVAILABLE')).not.toThrow();
    expect(() =>
      assertFleetTransition('AVAILABLE', 'UNAVAILABLE'),
    ).not.toThrow();
    expect(() =>
      assertFleetTransition('UNAVAILABLE', 'AVAILABLE'),
    ).not.toThrow();
    expect(() => assertFleetTransition('AVAILABLE', 'INACTIVE')).not.toThrow();
    expect(() =>
      assertFleetTransition('UNAVAILABLE', 'INACTIVE'),
    ).not.toThrow();
    expect(() =>
      assertDriverCertificateTransition('ACTIVE', 'EXPIRED'),
    ).not.toThrow();
    expect(() =>
      assertDriverCertificateTransition('ACTIVE', 'REVOKED'),
    ).not.toThrow();
  });
  it('rejects skipped, reverse and repeated transitions', () => {
    expect(() => assertWarehouseTransition('DRAFT', 'INACTIVE')).toThrowError(
      /not allowed/,
    );
    expect(() => assertWarehouseTransition('INACTIVE', 'ACTIVE')).toThrowError(
      /not allowed/,
    );
    expect(() => assertFleetTransition('DRAFT', 'INACTIVE')).toThrowError(
      /not allowed/,
    );
    expect(() => assertFleetTransition('INACTIVE', 'AVAILABLE')).toThrowError(
      /not allowed/,
    );
    expect(() =>
      assertDriverCertificateTransition('EXPIRED', 'ACTIVE'),
    ).toThrowError(/not allowed/);
  });
});
