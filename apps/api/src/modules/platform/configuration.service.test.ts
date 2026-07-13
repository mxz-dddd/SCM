import { describe, expect, it } from 'vitest';
import type { TenantContext } from '@scm/shared';
import {
  assertConfigTransition,
  assertDictionaryItemTransition,
  configurationDifference,
  configurationScopeAllowed,
  formatReservedNumber,
  resolveConfigurationLayers,
  sequencePeriodKey,
  validateReasonEvidence,
} from './configuration.service';

const userContext: TenantContext = {
  accountId: '10000000-0000-4000-8000-000000000001',
  accountKind: 'USER',
  deviceId: 'test-device',
  organizationIds: ['10000000-0000-4000-8000-000000000010'],
  permissionVersion: 1,
  tenantId: '10000000-0000-4000-8000-000000000002',
  tokenId: 'test-token',
};

describe('hierarchical configuration contracts', () => {
  it('merges tenant, organization, warehouse and customer layers in order', () => {
    const resolution = resolveConfigurationLayers(
      [
        {
          id: 'tenant-v1',
          rolloutPercentage: 100,
          scopeRef: '*',
          scopeType: 'TENANT',
          values: { cutoffHour: 16, mode: 'standard' },
          versionNumber: 1,
        },
        {
          id: 'org-v1',
          rolloutPercentage: 100,
          scopeRef: 'org-1',
          scopeType: 'ORGANIZATION',
          values: { cutoffHour: 18 },
          versionNumber: 1,
        },
        {
          id: 'warehouse-v1',
          rolloutPercentage: 100,
          scopeRef: 'warehouse-1',
          scopeType: 'WAREHOUSE',
          values: { mode: 'priority' },
          versionNumber: 1,
        },
        {
          id: 'customer-v1',
          rolloutPercentage: 100,
          scopeRef: 'customer-1',
          scopeType: 'CUSTOMER',
          values: { cutoffHour: 20 },
          versionNumber: 1,
        },
      ],
      {
        configKey: 'fulfillment.policy',
        customerId: 'customer-1',
        organizationId: 'org-1',
        warehouseId: 'warehouse-1',
      },
    );

    expect(resolution).toEqual({
      appliedVersionIds: ['tenant-v1', 'org-v1', 'warehouse-v1', 'customer-v1'],
      values: { cutoffHour: 20, mode: 'priority' },
    });
    expect(
      configurationDifference(
        { cutoffHour: 16, obsolete: true },
        { cutoffHour: 20, enabled: true },
      ),
    ).toEqual({
      added: ['enabled'],
      changed: ['cutoffHour'],
      removed: ['obsolete'],
    });
  });

  it('enforces publish and rollback transition maps', () => {
    expect(() =>
      assertConfigTransition('DRAFT', 'PUBLISHED', 'PUBLISH'),
    ).not.toThrow();
    expect(() =>
      assertConfigTransition('RETIRED', 'PUBLISHED', 'ROLLBACK'),
    ).not.toThrow();
    expect(() =>
      assertConfigTransition('PUBLISHED', 'PUBLISHED', 'PUBLISH'),
    ).toThrow(/not allowed/);
    expect(() =>
      assertConfigTransition('DRAFT', 'PUBLISHED', 'ROLLBACK'),
    ).toThrow(/not allowed/);
  });

  it('denies user writes outside their organization data scope', () => {
    expect(
      configurationScopeAllowed(
        userContext,
        'ORGANIZATION',
        userContext.organizationIds[0]!,
      ),
    ).toBe(true);
    expect(
      configurationScopeAllowed(
        userContext,
        'ORGANIZATION',
        '10000000-0000-4000-8000-000000000099',
      ),
    ).toBe(false);
    expect(
      configurationScopeAllowed(
        { ...userContext, accountKind: 'TENANT_ADMIN' },
        'CUSTOMER',
        '10000000-0000-4000-8000-000000000099',
      ),
    ).toBe(true);
  });
});

describe('dictionary and number rule contracts', () => {
  it('requires configured reason evidence while preserving historical snapshots', () => {
    const item = {
      requiresAttachment: true,
      requiresRemark: true,
      status: 'INACTIVE' as const,
    };
    expect(validateReasonEvidence(item, { forNewUse: true })).toEqual([
      'DICTIONARY_ITEM_INACTIVE',
      'REMARK_REQUIRED',
      'ATTACHMENT_REQUIRED',
    ]);
    expect(
      validateReasonEvidence(item, {
        attachmentIds: ['attachment-1'],
        forNewUse: false,
        remark: 'historical explanation',
      }),
    ).toEqual([]);
    expect(() =>
      assertDictionaryItemTransition('ACTIVE', 'INACTIVE'),
    ).not.toThrow();
    expect(() =>
      assertDictionaryItemTransition('INACTIVE', 'ACTIVE'),
    ).not.toThrow();
    expect(() => assertDictionaryItemTransition('ACTIVE', 'ACTIVE')).toThrow(
      /already/,
    );
  });

  it('formats reset periods and business numbers deterministically', () => {
    const at = new Date('2026-07-14T08:00:00.000Z');
    expect(sequencePeriodKey('NEVER', at)).toBe('ALL');
    expect(sequencePeriodKey('YEARLY', at)).toBe('2026');
    expect(sequencePeriodKey('MONTHLY', at)).toBe('202607');
    expect(sequencePeriodKey('DAILY', at)).toBe('20260714');
    expect(
      formatReservedNumber({
        at,
        businessType: 'ORDER',
        organizationRef: '*',
        prefixTemplate: '{TYPE}-{YYYY}{MM}{DD}-',
        sequence: 42n,
        sequenceWidth: 6,
      }),
    ).toBe('ORDER-20260714-000042');
  });
});
