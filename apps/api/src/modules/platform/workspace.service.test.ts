import { describe, expect, it } from 'vitest';
import type { TenantContext } from '@scm/shared';
import { workspaceOwnershipWhere } from './workspace.service';

describe('workspace ownership isolation', () => {
  it('always derives tenant and account from trusted context', () => {
    const context: TenantContext = {
      accountId: 'account-a',
      accountKind: 'USER',
      deviceId: 'device',
      organizationIds: [],
      permissionVersion: 3,
      tenantId: 'tenant-a',
      tokenId: 'token',
    };
    expect(workspaceOwnershipWhere(context)).toEqual({
      accountId: 'account-a',
      tenantId: 'tenant-a',
    });
  });
});
