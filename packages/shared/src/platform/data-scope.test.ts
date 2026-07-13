import { describe, expect, it } from 'vitest';
import {
  dataScopeCacheKey,
  injectTenantAndDataScope,
  matchesDataScope,
  validateDataScopeExpression,
} from './data-scope';

describe('ABAC data scope expressions', () => {
  const candidate = {
    conditions: [
      { field: 'organizationId', operator: 'EQ', value: 'org-1' },
      { field: 'warehouseId', operator: 'IN', value: ['wh-1', 'wh-2'] },
      { field: 'ownerId', operator: 'EQ', value: 'owner-1' },
      { field: 'partnerId', operator: 'EQ', value: 'partner-1' },
      { field: 'createdBy', operator: 'EQ', value: 'account-1' },
      { field: 'region', operator: 'EQ', value: 'CN-EAST' },
      { field: 'custom.temperatureZone', operator: 'EQ', value: 'COLD' },
    ],
    match: 'ALL',
  };

  it('validates and evaluates supported dimensions', () => {
    const validation = validateDataScopeExpression(candidate);
    expect(validation.valid).toBe(true);
    expect(
      matchesDataScope(validation.expression!, {
        custom: { temperatureZone: 'COLD' },
        createdBy: 'account-1',
        organizationId: 'org-1',
        ownerId: 'owner-1',
        partnerId: 'partner-1',
        region: 'CN-EAST',
        warehouseId: 'wh-2',
      }),
    ).toBe(true);
    expect(
      matchesDataScope(validation.expression!, {
        custom: { temperatureZone: 'COLD' },
        createdBy: 'account-1',
        organizationId: 'org-2',
        ownerId: 'owner-1',
        partnerId: 'partner-1',
        region: 'CN-EAST',
        warehouseId: 'wh-2',
      }),
    ).toBe(false);
  });

  it('rejects unknown fields, operators and empty sets', () => {
    for (const invalid of [
      {
        conditions: [{ field: 'passwordHash', operator: 'EQ', value: 'x' }],
        match: 'ALL',
      },
      {
        conditions: [{ field: 'ownerId', operator: 'NE', value: 'x' }],
        match: 'ALL',
      },
      {
        conditions: [{ field: 'partnerId', operator: 'IN', value: [] }],
        match: 'ALL',
      },
    ]) {
      expect(validateDataScopeExpression(invalid).valid).toBe(false);
    }
  });

  it('injects immutable tenant and scope filters through AND', () => {
    expect(
      injectTenantAndDataScope(
        'trusted-tenant',
        { status: 'ACTIVE', tenantId: 'attacker-tenant' },
        { warehouseId: { in: ['wh-1'] } },
      ),
    ).toEqual({
      AND: [
        { tenantId: 'trusted-tenant' },
        { status: 'ACTIVE', tenantId: 'attacker-tenant' },
        { warehouseId: { in: ['wh-1'] } },
      ],
    });
  });

  it('separates cache entries by permission version', () => {
    const base = { accountId: 'a', resource: 'inventory', tenantId: 't' };
    expect(dataScopeCacheKey({ ...base, permissionVersion: 1 })).not.toBe(
      dataScopeCacheKey({ ...base, permissionVersion: 2 }),
    );
  });
});
