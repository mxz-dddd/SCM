import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceContextSelection, WorkspaceTab } from '@scm/shared';
import {
  Avatar,
  Button,
  Drawer,
  Input,
  Layout,
  List,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ADMIN_NAV_CATEGORIES,
  ADMIN_ROUTE_REGISTRY,
  type AppRouteDefinition,
} from '../router/route-registry';
import {
  findAdminRouteById,
  findAdminRouteByPath,
  routeToWorkspaceTab,
} from '../router/route-helpers';
import { useSessionStore } from '../platform/session-store';
import { useWorkspaceStore } from './workspace-store';

const { Content, Header, Sider } = Layout;

interface WorkspaceCatalogItem {
  pageKey: string;
  route: string;
  title: string;
}

interface WorkspaceResponse {
  favorites: WorkspaceCatalogItem[];
  layout: {
    activeTabId: string | null;
    context: WorkspaceContextSelection;
    openTabs: WorkspaceTab[];
  } | null;
  recent: WorkspaceCatalogItem[];
}

export function ApplicationShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const claims = useSessionStore((state) => state.claims);
  const accessToken = useSessionStore((state) => state.accessToken);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const context = useWorkspaceStore((state) => state.context);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activate = useWorkspaceStore((state) => state.activate);
  const close = useWorkspaceStore((state) => state.close);
  const hydrate = useWorkspaceStore((state) => state.hydrate);
  const open = useWorkspaceStore((state) => state.open);
  const selectContext = useWorkspaceStore((state) => state.selectContext);
  const [commandOpen, setCommandOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [restored, setRestored] = useState(false);
  const [favorites, setFavorites] = useState<WorkspaceCatalogItem[]>([]);
  const [recent, setRecent] = useState<WorkspaceCatalogItem[]>([]);

  const permittedRoutes = useMemo(
    () =>
      ADMIN_ROUTE_REGISTRY.filter(
        (route) =>
          !claims ||
          !route.allowedAccountKinds ||
          route.allowedAccountKinds.includes(claims.accountKind),
      ),
    [claims],
  );

  const navigation = useMemo(() => {
    const permittedById = new Map(
      permittedRoutes.map((route) => [route.id, route] as const),
    );
    return ADMIN_NAV_CATEGORIES.map((category) => ({
      ...category,
      groups: category.groups
        .map((group) => ({
          ...group,
          routes: group.routeIds.flatMap((routeId) => {
            const route = permittedById.get(routeId);
            return route ? [route] : [];
          }),
        }))
        .filter((group) => group.routes.length > 0),
    })).filter((category) => category.groups.length > 0);
  }, [permittedRoutes]);

  const activeRoute =
    findAdminRouteByPath(location.pathname) ?? findAdminRouteById(activeTabId);
  const activeCategory =
    navigation.find((category) =>
      category.groups.some((group) =>
        group.routes.some((route) => route.id === activeRoute?.id),
      ),
    ) ?? navigation[0];
  const activeGroup =
    activeCategory?.groups.find((group) =>
      group.routes.some((route) => route.id === activeRoute?.id),
    ) ?? activeCategory?.groups[0];

  useEffect(() => {
    const route = findAdminRouteByPath(location.pathname);
    if (!route) return;
    if (!tabs.some((tab) => tab.id === route.id))
      open(routeToWorkspaceTab(route));
    else if (activeTabId !== route.id) activate(route.id);
  }, [activate, activeTabId, location.pathname, open, tabs]);

  useEffect(() => {
    if (!claims || !accessToken) {
      setRestored(false);
      return;
    }
    const controller = new AbortController();
    void fetch('/api/v1/platform/workspace', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Correlation-Id': crypto.randomUUID(),
        'X-Tenant-Id': claims.tenantId,
      },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Workspace restore failed');
        const catalog = (await response.json()) as WorkspaceResponse;
        setFavorites(catalog.favorites);
        setRecent(catalog.recent);
        if (catalog.layout) {
          hydrate({
            ...(catalog.layout.activeTabId
              ? { activeTabId: catalog.layout.activeTabId }
              : {}),
            context: catalog.layout.context,
            tabs: catalog.layout.openTabs,
          });
        } else selectContext({ tenantId: claims.tenantId });
        setRestored(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        selectContext({ tenantId: claims.tenantId });
        setRestored(true);
      });
    return () => controller.abort();
  }, [accessToken, claims, hydrate, selectContext]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  useEffect(() => {
    if (!claims || !accessToken || !restored) return;
    const timeout = window.setTimeout(() => {
      void fetch('/api/v1/platform/workspace', {
        body: JSON.stringify({ activeTabId, context, openTabs: tabs }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
          'X-Correlation-Id': crypto.randomUUID(),
          'X-Tenant-Id': claims.tenantId,
        },
        method: 'PUT',
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [accessToken, activeTabId, claims, context, restored, tabs]);

  const commands = useMemo(
    () =>
      permittedRoutes.filter(({ navLabel, title }) => {
        const normalized = query.trim().toLowerCase();
        return (
          title.toLowerCase().includes(normalized) ||
          navLabel.toLowerCase().includes(normalized)
        );
      }),
    [permittedRoutes, query],
  );

  function openRoute(route: AppRouteDefinition) {
    void navigate(route.path);
  }

  function openCategory(categoryId: string) {
    const category = navigation.find(({ id }) => id === categoryId);
    const firstRoute = category?.groups[0]?.routes[0];
    if (firstRoute) openRoute(firstRoute);
  }

  function openGroup(groupId: string) {
    const group = activeCategory?.groups.find(({ id }) => id === groupId);
    const firstRoute = group?.routes[0];
    if (firstRoute) openRoute(firstRoute);
  }

  function activateTab(tabId: string) {
    const route = findAdminRouteById(tabId);
    if (!route) return;
    activate(tabId);
    void navigate(route.path);
  }

  function closeTab(tabId: string) {
    const target = tabs.find(({ id }) => id === tabId);
    const finish = (confirmDirty: boolean) => {
      if (!close(tabId, confirmDirty)) return;
      const nextId = useWorkspaceStore.getState().activeTabId;
      const nextRoute = findAdminRouteById(nextId);
      if (nextRoute) void navigate(nextRoute.path);
    };
    if (!target?.dirty) {
      finish(false);
      return;
    }
    Modal.confirm({
      cancelText: '继续编辑',
      content: '此标签包含未提交草稿，关闭后将丢失当前修改。',
      okText: '确认关闭',
      onOk: () => finish(true),
      title: '关闭未保存标签？',
    });
  }

  function openCatalogItem(item: WorkspaceCatalogItem) {
    const route =
      findAdminRouteByPath(item.route) ?? findAdminRouteById(item.pageKey);
    if (route) openRoute(route);
  }

  return (
    <Layout className="app-shell">
      <Sider className="app-sidebar" collapsedWidth={56} width={56}>
        <div className="app-mark" aria-label="澄链 SCM">
          澄
        </div>
        <nav aria-label="模块导航" className="module-nav">
          {navigation.map((category) => (
            <Button
              aria-label={category.label}
              className={
                activeCategory?.id === category.id
                  ? 'module-button active'
                  : 'module-button'
              }
              key={category.id}
              onClick={() => openCategory(category.id)}
              title={category.label}
              type="text"
            >
              <span className="module-button-mark" aria-hidden="true">
                {category.shortLabel.slice(0, 1)}
              </span>
              <span className="module-button-label">{category.shortLabel}</span>
            </Button>
          ))}
        </nav>
      </Sider>
      <Layout>
        <Header className="app-header context-header">
          <Space wrap>
            <Select
              aria-label="租户"
              value={context.tenantId}
              options={[
                {
                  label: claims ? '当前租户' : '未登录',
                  value: context.tenantId,
                },
              ]}
            />
            <Select
              aria-label="组织"
              placeholder="选择组织"
              onChange={(organizationId) => selectContext({ organizationId })}
              options={(claims?.organizationIds ?? []).map((id) => ({
                label: id.slice(0, 8),
                value: id,
              }))}
            />
            <Select
              aria-label="仓库"
              placeholder="选择仓库"
              onChange={(warehouseId) => selectContext({ warehouseId })}
              options={[{ label: '默认仓库', value: 'default' }]}
            />
            <Select
              aria-label="语言"
              value={context.language}
              onChange={(language) => selectContext({ language })}
              options={[
                { label: '简体中文', value: 'zh-CN' },
                { label: 'English', value: 'en-US' },
              ]}
            />
          </Space>
          <Space>
            <Button onClick={() => setCommandOpen(true)}>⌘K 命令</Button>
            <Button onClick={() => setActivityOpen(true)}>收藏与最近</Button>
            <Avatar>{claims?.accountKind.slice(0, 1) ?? '访'}</Avatar>
          </Space>
        </Header>
        {activeCategory && activeGroup ? (
          <section
            aria-label={`${activeCategory.label}分层导航`}
            className="business-navigation"
          >
            <div className="business-navigation-title">
              <Typography.Text type="secondary">当前模块</Typography.Text>
              <Typography.Text strong>{activeCategory.label}</Typography.Text>
            </div>
            <nav aria-label="业务分组" className="business-group-nav">
              {activeCategory.groups.map((group) => (
                <Button
                  aria-current={
                    activeGroup.id === group.id ? 'page' : undefined
                  }
                  className={
                    activeGroup.id === group.id
                      ? 'business-group-button active'
                      : 'business-group-button'
                  }
                  key={group.id}
                  onClick={() => openGroup(group.id)}
                  type="text"
                >
                  {group.label}
                </Button>
              ))}
            </nav>
            <nav aria-label="页面导航" className="page-nav">
              {activeGroup.routes.map((route) => (
                <Button
                  aria-current={
                    activeRoute?.id === route.id ? 'page' : undefined
                  }
                  className={
                    activeRoute?.id === route.id
                      ? 'page-nav-button active'
                      : 'page-nav-button'
                  }
                  key={route.id}
                  onClick={() => openRoute(route)}
                  size="small"
                  type="text"
                >
                  {route.title}
                </Button>
              ))}
            </nav>
          </section>
        ) : null}
        <Tabs
          activeKey={activeTabId}
          className="workspace-tabs"
          hideAdd
          items={tabs.map((tab) => ({
            children:
              tab.id === activeTabId ? (
                <Content className="app-content">
                  <Outlet />
                </Content>
              ) : null,
            closable: tab.id !== 'workbench',
            key: tab.id,
            label: (
              <span>
                {tab.dirty ? '● ' : ''}
                {tab.title}
              </span>
            ),
          }))}
          onChange={activateTab}
          onEdit={(targetKey, action) =>
            action === 'remove' && closeTab(String(targetKey))
          }
          type="editable-card"
        />
      </Layout>
      <Modal
        footer={null}
        onCancel={() => setCommandOpen(false)}
        open={commandOpen}
        title="全局命令面板"
      >
        <Input
          autoFocus
          aria-label="搜索命令"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索页面或动作"
          value={query}
        />
        <List
          dataSource={commands}
          renderItem={(page) => (
            <List.Item
              actions={[
                <Button
                  key="open"
                  onClick={() => {
                    openRoute(page);
                    setCommandOpen(false);
                  }}
                >
                  打开
                </Button>,
              ]}
            >
              {page.title}
            </List.Item>
          )}
        />
      </Modal>
      <Drawer
        onClose={() => setActivityOpen(false)}
        open={activityOpen}
        title="收藏与最近访问"
      >
        <Typography.Title level={5}>收藏</Typography.Title>
        {favorites.length > 0 ? (
          <List
            dataSource={favorites}
            renderItem={(item) => (
              <List.Item>
                <Button type="link" onClick={() => openCatalogItem(item)}>
                  {item.title}
                </Button>
              </List.Item>
            )}
          />
        ) : (
          <Tag>暂无收藏</Tag>
        )}
        <Typography.Title level={5}>最近访问</Typography.Title>
        <List
          dataSource={recent}
          locale={{ emptyText: '暂无最近访问' }}
          renderItem={(item) => (
            <List.Item>
              <Button type="link" onClick={() => openCatalogItem(item)}>
                {item.title}
              </Button>
            </List.Item>
          )}
        />
      </Drawer>
    </Layout>
  );
}
