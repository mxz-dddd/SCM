import { describe, expect, it } from 'vitest';
import { assertGeocodeTransition, assertPartnerCertificateTransition, assertPartnerTransition, assertServiceZoneTransition } from './partner.service';

describe('partner and address state transitions', () => {
  it('allows every supported transition', () => {
    expect(() => assertPartnerTransition('DRAFT', 'ACTIVE')).not.toThrow();
    expect(() => assertPartnerTransition('ACTIVE', 'SUSPENDED')).not.toThrow();
    expect(() => assertPartnerTransition('SUSPENDED', 'ACTIVE')).not.toThrow();
    expect(() => assertPartnerTransition('ACTIVE', 'INACTIVE')).not.toThrow();
    expect(() => assertPartnerTransition('SUSPENDED', 'INACTIVE')).not.toThrow();
    expect(() => assertGeocodeTransition('PENDING', 'VERIFIED')).not.toThrow();
    expect(() => assertGeocodeTransition('PENDING', 'FAILED')).not.toThrow();
    expect(() => assertGeocodeTransition('PENDING', 'MANUAL_CORRECTION')).not.toThrow();
    expect(() => assertGeocodeTransition('FAILED', 'VERIFIED')).not.toThrow();
    expect(() => assertGeocodeTransition('FAILED', 'MANUAL_CORRECTION')).not.toThrow();
    expect(() => assertGeocodeTransition('VERIFIED', 'MANUAL_CORRECTION')).not.toThrow();
    expect(() => assertServiceZoneTransition('DRAFT', 'ACTIVE')).not.toThrow();
    expect(() => assertServiceZoneTransition('ACTIVE', 'INACTIVE')).not.toThrow();
    expect(() => assertPartnerCertificateTransition('ACTIVE', 'EXPIRED')).not.toThrow();
    expect(() => assertPartnerCertificateTransition('ACTIVE', 'INACTIVE')).not.toThrow();
  });

  it('rejects skipped, reverse and repeated transitions', () => {
    expect(() => assertPartnerTransition('DRAFT', 'INACTIVE')).toThrowError(/not allowed/);
    expect(() => assertPartnerTransition('INACTIVE', 'ACTIVE')).toThrowError(/not allowed/);
    expect(() => assertPartnerTransition('ACTIVE', 'ACTIVE')).toThrowError(/not allowed/);
    expect(() => assertGeocodeTransition('FAILED', 'FAILED')).toThrowError(/not allowed/);
    expect(() => assertGeocodeTransition('MANUAL_CORRECTION', 'VERIFIED')).toThrowError(/not allowed/);
    expect(() => assertServiceZoneTransition('DRAFT', 'INACTIVE')).toThrowError(/not allowed/);
    expect(() => assertServiceZoneTransition('INACTIVE', 'ACTIVE')).toThrowError(/not allowed/);
    expect(() => assertPartnerCertificateTransition('EXPIRED', 'ACTIVE')).toThrowError(/not allowed/);
  });
});
