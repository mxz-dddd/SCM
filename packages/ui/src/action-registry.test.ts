import { describe, expect, it } from 'vitest';
import { createActionRegistry, resolveAction } from './action-registry';

const approve = {
  allowedStatuses: ['OPEN'] as const,
  confirmMessage: '确认审核？',
  id: 'approve',
  label: '审核',
  requiredPermissions: ['order.approve'],
};

describe('Action Registry', () => {
  it('produces the same decision for every presentation surface', () => {
    const registry = createActionRegistry([approve]);
    const context = {
      dataScopeAllowed: true,
      permissions: new Set(['order.approve']),
      status: 'OPEN' as const,
    };
    const surfaces = ['command-bar', 'row-menu', 'footer'];
    expect(surfaces.map(() => registry.decide('approve', context))).toEqual([
      resolveAction(approve, context),
      resolveAction(approve, context),
      resolveAction(approve, context),
    ]);
  });

  it('denies missing permission, data scope and invalid status', () => {
    expect(
      resolveAction(approve, {
        dataScopeAllowed: true,
        permissions: new Set(),
        status: 'OPEN',
      }).reason,
    ).toBe('PERMISSION_DENIED');
    expect(
      resolveAction(approve, {
        dataScopeAllowed: false,
        permissions: new Set(['order.approve']),
        status: 'OPEN',
      }).reason,
    ).toBe('DATA_SCOPE_DENIED');
    expect(
      resolveAction(approve, {
        dataScopeAllowed: true,
        permissions: new Set(['order.approve']),
        status: 'CLOSED',
      }).reason,
    ).toBe('STATUS_DENIED');
  });

  it('rejects duplicate action identifiers', () => {
    expect(() => createActionRegistry([approve, approve])).toThrow(
      'Duplicate action id',
    );
  });
});
