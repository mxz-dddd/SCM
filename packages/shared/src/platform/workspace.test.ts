import { describe, expect, it } from 'vitest';
import {
  nextActiveTabId,
  requestTabClose,
  type WorkspaceTab,
} from './workspace';

const tabs: readonly WorkspaceTab[] = [
  { dirty: false, id: 'workbench', route: '/workbench', title: '工作台' },
  { dirty: true, id: 'orders', route: '/oms/orders', title: '订单' },
];

describe('workspace tab lifecycle', () => {
  it('closes a clean tab directly', () => {
    expect(requestTabClose(tabs, 'workbench', false)).toEqual({
      closed: true,
      tabs: [tabs[1]],
    });
  });

  it('keeps a dirty tab until the user confirms', () => {
    expect(requestTabClose(tabs, 'orders', false)).toEqual({
      closed: false,
      tabs,
    });
    expect(requestTabClose(tabs, 'orders', true).closed).toBe(true);
  });

  it('selects a deterministic neighboring tab after close', () => {
    expect(nextActiveTabId(tabs, 'orders', 'orders')).toBe('workbench');
    expect(nextActiveTabId(tabs, 'workbench', 'orders')).toBe('orders');
  });
});
