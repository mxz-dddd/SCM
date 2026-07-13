import {
  nextActiveTabId,
  requestTabClose,
  type WorkspaceContextSelection,
  type WorkspaceTab,
} from '@scm/shared';
import { create } from 'zustand';

interface WorkspaceState {
  activeTabId: string;
  context: WorkspaceContextSelection;
  tabs: readonly WorkspaceTab[];
  activate: (tabId: string) => void;
  close: (tabId: string, confirmDirty: boolean) => boolean;
  hydrate: (input: {
    readonly activeTabId?: string;
    readonly context: WorkspaceContextSelection;
    readonly tabs: readonly WorkspaceTab[];
  }) => void;
  markDirty: (tabId: string, dirty: boolean) => void;
  open: (tab: WorkspaceTab) => void;
  selectContext: (context: Partial<WorkspaceContextSelection>) => void;
}

const initialTabs: readonly WorkspaceTab[] = [
  { dirty: false, id: 'workbench', route: '/workbench', title: '工作台' },
  {
    dirty: false,
    id: 'identity',
    route: '/platform/identity',
    title: '租户与认证',
  },
];

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeTabId: 'workbench',
  context: { language: 'zh-CN', tenantId: 'unselected' },
  tabs: initialTabs,
  activate: (activeTabId) => set({ activeTabId }),
  close: (tabId, confirmDirty) => {
    const state = get();
    const result = requestTabClose(state.tabs, tabId, confirmDirty);
    if (!result.closed) return false;
    set({
      activeTabId:
        nextActiveTabId(state.tabs, tabId, state.activeTabId) ?? 'workbench',
      tabs: result.tabs,
    });
    return true;
  },
  hydrate: ({ activeTabId, context, tabs }) =>
    set({
      activeTabId: activeTabId ?? tabs[0]?.id ?? 'workbench',
      context,
      tabs: tabs.length > 0 ? tabs : initialTabs,
    }),
  markDirty: (tabId, dirty) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, dirty } : tab,
      ),
    })),
  open: (tab) =>
    set((state) => ({
      activeTabId: tab.id,
      tabs: state.tabs.some(({ id }) => id === tab.id)
        ? state.tabs
        : [...state.tabs, tab],
    })),
  selectContext: (context) =>
    set((state) => ({ context: { ...state.context, ...context } })),
}));
