import { describe, expect, it } from 'vitest';
import {
  assertTenantTransition,
  canTransitionTenant,
  type TenantStatus,
} from './tenant';

const allowed: ReadonlyArray<readonly [TenantStatus, TenantStatus]> = [
  ['PROVISIONING', 'ACTIVE'],
  ['ACTIVE', 'SUSPENDED'],
  ['SUSPENDED', 'ACTIVE'],
  ['SUSPENDED', 'ARCHIVED'],
];

describe('tenant lifecycle', () => {
  it.each(allowed)('allows %s -> %s', (current, target) => {
    expect(canTransitionTenant(current, target)).toBe(true);
    expect(() => assertTenantTransition(current, target)).not.toThrow();
  });

  it.each([
    ['PROVISIONING', 'SUSPENDED'],
    ['ACTIVE', 'ARCHIVED'],
    ['ARCHIVED', 'ACTIVE'],
    ['ARCHIVED', 'SUSPENDED'],
  ] as const)('rejects %s -> %s', (current, target) => {
    expect(canTransitionTenant(current, target)).toBe(false);
    expect(() => assertTenantTransition(current, target)).toThrow(
      `Tenant transition ${current} -> ${target} is not allowed`,
    );
  });
});
