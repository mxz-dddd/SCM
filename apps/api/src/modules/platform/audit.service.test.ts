import { describe, expect, it } from 'vitest';
import { changedAuditFields, redactAuditValue } from './audit.service';

describe('audit data contracts', () => {
  it('recursively redacts credentials before persistence or response', () => {
    expect(
      redactAuditValue({
        authorization: 'Bearer test-only',
        nested: {
          apiKey: 'test-key',
          items: [{ password: 'test-password', value: 3 }],
        },
        publicValue: 'visible',
      }),
    ).toEqual({
      authorization: '[REDACTED]',
      nested: {
        apiKey: '[REDACTED]',
        items: [{ password: '[REDACTED]', value: 3 }],
      },
      publicValue: 'visible',
    });
  });

  it('returns a stable list of fields whose values changed', () => {
    expect(
      changedAuditFields(
        { name: 'before', removed: true, stable: 1 },
        { added: true, name: 'after', stable: 1 },
      ),
    ).toEqual(['added', 'name', 'removed']);
  });
});
