import { describe, expect, it } from 'vitest';
import type { TenantContext } from '@scm/shared';
import { requireAccountKind } from './authorization';

function context(accountKind: TenantContext['accountKind']): TenantContext {
  return {
    accountId: 'account-1',
    accountKind,
    deviceId: 'device-1',
    organizationIds: [],
    permissionVersion: 1,
    tenantId: 'tenant-1',
    tokenId: 'token-1',
  };
}

describe('platform resource authorization', () => {
  it('allows a platform administrator', () => {
    expect(() =>
      requireAccountKind(context('PLATFORM_ADMIN'), ['PLATFORM_ADMIN']),
    ).not.toThrow();
  });

  it('rejects a regular user even when the UI could expose the action', () => {
    expect(() =>
      requireAccountKind(context('USER'), ['PLATFORM_ADMIN']),
    ).toThrow('not allowed to perform this action');
  });
});
