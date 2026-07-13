import { useEffect, useMemo, useState } from 'react';
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
import type { WorkspaceContextSelection, WorkspaceTab } from '@scm/shared';
import { AuthWorkbench } from '../platform/AuthWorkbench';
import { AuditWorkbench } from '../platform/AuditWorkbench';
import { ConfigurationWorkbench } from '../platform/ConfigurationWorkbench';
import { OrganizationRbacWorkbench } from '../platform/OrganizationRbacWorkbench';
import { useSessionStore } from '../platform/session-store';
import { ComponentGallery } from '../ui/ComponentGallery';
import { useWorkspaceStore } from './workspace-store';

const { Content, Header, Sider } = Layout;

const pageRegistry: readonly WorkspaceTab[] = [
  { dirty: false, id: 'workbench', route: '/workbench', title: '工作台' },
  {
    dirty: false,
    id: 'identity',
    route: '/platform/identity',
    title: '租户与认证',
  },
  { dirty: false, id: 'rbac', route: '/platform/rbac', title: '组织与权限' },
  {
    dirty: false,
    id: 'components',
    route: '/platform/components',
    title: '统一组件',
  },
  {
    dirty: false,
    id: 'configuration',
    route: '/platform/configuration',
    title: '配置中心',
  },
  {
    dirty: false,
    id: 'audit',
    route: '/platform/audit',
    title: '审计中心',
  },
  { dirty: false, id: 'orders', route: '/oms/orders', title: '订单中心' },
  { dirty: false, id: 'inventory', route: '/wms/inventory', title: '库存视图' },
  { dirty: false, id: 'transport', route: '/tms/shipments', title: '运输执行' },
];

const modules = [
  ['工作台', 'workbench'],
  ['平台', 'rbac'],
  ['组件', 'components'],
  ['配置', 'configuration'],
  ['审计', 'audit'],
  ['订单', 'orders'],
  ['仓储', 'inventory'],
  ['运输', 'transport'],
] as const;

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
  const claims = useSessionStore((state) => state.claims);
  const accessToken = useSessionStore((state) => state.accessToken);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const context = useWorkspaceStore((state) => state.context);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activate = useWorkspaceStore((state) => state.activate);
  const close = useWorkspaceStore((state) => state.close);
  const hydrate = useWorkspaceStore((state) => state.hydrate);
  const markDirty = useWorkspaceStore((state) => state.markDirty);
  const open = useWorkspaceStore((state) => state.open);
  const selectContext = useWorkspaceStore((state) => state.selectContext);
  const [commandOpen, setCommandOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [restored, setRestored] = useState(false);
  const [favorites, setFavorites] = useState<WorkspaceCatalogItem[]>([]);
  const [recent, setRecent] = useState<WorkspaceCatalogItem[]>([]);

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
        } else {
          selectContext({ tenantId: claims.tenantId });
        }
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
      pageRegistry.filter(({ title }) =>
        title.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  function closeTab(tabId: string) {
    const target = tabs.find(({ id }) => id === tabId);
    if (!target?.dirty) {
      close(tabId, false);
      return;
    }
    Modal.confirm({
      cancelText: '继续编辑',
      content: '此标签包含未提交草稿，关闭后将丢失当前修改。',
      okText: '确认关闭',
      onOk: () => close(tabId, true),
      title: '关闭未保存标签？',
    });
  }

  function renderPage(tabId: string) {
    if (tabId === 'identity') return <AuthWorkbench />;
    if (tabId === 'rbac') return <OrganizationRbacWorkbench />;
    if (tabId === 'components') return <ComponentGallery />;
    if (tabId === 'configuration') return <ConfigurationWorkbench />;
    if (tabId === 'audit') return <AuditWorkbench />;
    return (
      <section className="workspace-placeholder">
        <Typography.Title level={2}>
          {pageRegistry.find(({ id }) => id === tabId)?.title ?? '工作台'}
        </Typography.Title>
        <Typography.Paragraph>
          查询条件与未提交草稿会随标签会话保存。
        </Typography.Paragraph>
        <Button onClick={() => markDirty(tabId, true)}>标记未保存草稿</Button>
      </section>
    );
  }

  return (
    <Layout className="app-shell">
      <Sider className="app-sidebar" collapsed width={216}>
        <div className="app-mark" aria-label="SCM Cloud">
          SC
        </div>
        <nav aria-label="模块导航" className="module-nav">
          {modules.map(([label, pageId]) => (
            <Button
              aria-label={label}
              className={
                activeTabId === pageId
                  ? 'module-button active'
                  : 'module-button'
              }
              key={pageId}
              onClick={() =>
                open(pageRegistry.find(({ id }) => id === pageId)!)
              }
              type="text"
            >
              {label.slice(0, 1)}
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
        <Tabs
          activeKey={activeTabId}
          className="workspace-tabs"
          hideAdd
          items={tabs.map((tab) => ({
            children: (
              <Content className="app-content">{renderPage(tab.id)}</Content>
            ),
            closable: tab.id !== 'workbench',
            key: tab.id,
            label: (
              <span>
                {tab.dirty ? '● ' : ''}
                {tab.title}
              </span>
            ),
          }))}
          onChange={activate}
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
                    open(page);
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
            renderItem={(item) => <List.Item>{item.title}</List.Item>}
          />
        ) : (
          <Tag>暂无收藏</Tag>
        )}
        <Typography.Title level={5}>最近访问</Typography.Title>
        <List
          dataSource={recent}
          locale={{ emptyText: '暂无最近访问' }}
          renderItem={(item) => <List.Item>{item.title}</List.Item>}
        />
      </Drawer>
    </Layout>
  );
}
