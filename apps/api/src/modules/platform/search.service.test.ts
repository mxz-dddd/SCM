import { describe, expect, it } from 'vitest';
import type { TenantContext } from '@scm/shared';
import { SearchService, redactSearchSnapshot } from './search.service';

const user: TenantContext = {
  accountId: '10000000-0000-4000-8000-000000000001',
  accountKind: 'USER',
  deviceId: 'test',
  organizationIds: ['10000000-0000-4000-8000-000000000010'],
  permissionVersion: 1,
  tenantId: '10000000-0000-4000-8000-000000000002',
  tokenId: 'token',
};

describe('unified search and SavedView contracts', () => {
  it('recursively redacts sensitive snapshot fields for scoped users', () => {
    expect(
      redactSearchSnapshot({
        contact: { email: 'a@example.com' },
        passwordHash: 'hash',
        safe: 'value',
      }),
    ).toEqual({
      contact: { email: '***' },
      passwordHash: '***',
      safe: 'value',
    });
  });

  it('denies shared view publication to a regular user', () => {
    const service = new SearchService({} as never, {} as never);
    expect(() =>
      service.saveView(
        {
          columns: [{ key: 'businessRef' }],
          filters: {},
          name: 'Shared',
          resourceType: 'UNIFIED_SEARCH',
          visibility: 'SHARED',
        },
        user,
        {
          correlationId: 'correlation',
          idempotencyKey: 'key',
          ipAddress: '127.0.0.1',
        },
      ),
    ).toThrow(/sharing permission/);
  });
});
