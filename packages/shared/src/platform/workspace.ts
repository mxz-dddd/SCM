export interface WorkspaceTab {
  readonly dirty: boolean;
  readonly id: string;
  readonly route: string;
  readonly title: string;
}

export interface WorkspaceContextSelection {
  readonly language: string;
  readonly organizationId?: string;
  readonly tenantId: string;
  readonly warehouseId?: string;
}

export function requestTabClose(
  tabs: readonly WorkspaceTab[],
  tabId: string,
  confirmDirty: boolean,
): { readonly closed: boolean; readonly tabs: readonly WorkspaceTab[] } {
  const target = tabs.find(({ id }) => id === tabId);
  if (!target) return { closed: false, tabs };
  if (target.dirty && !confirmDirty) return { closed: false, tabs };
  return { closed: true, tabs: tabs.filter(({ id }) => id !== tabId) };
}

export function nextActiveTabId(
  tabsBeforeClose: readonly WorkspaceTab[],
  closedTabId: string,
  currentActiveTabId: string | undefined,
): string | undefined {
  if (currentActiveTabId !== closedTabId) return currentActiveTabId;
  const index = tabsBeforeClose.findIndex(({ id }) => id === closedTabId);
  const remaining = tabsBeforeClose.filter(({ id }) => id !== closedTabId);
  return remaining[Math.min(index, remaining.length - 1)]?.id;
}
