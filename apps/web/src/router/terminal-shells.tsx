import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  List,
  Space,
  Tag,
  Typography,
} from 'antd';
import { NavLink, useLocation } from 'react-router-dom';
import { MobileOperationsWorkbench } from '../wms/MobileOperationsWorkbench';
import { DriverTrackingPanel } from '../tms/DriverTrackingPanel';
import { useSessionStore } from '../platform/session-store';

type PrincipalType = 'CUSTOMER' | 'SUPPLIER';

interface ProjectionRow {
  businessRef: string;
  id: string;
  principalRef: string;
  principalType: PrincipalType | 'CARRIER';
  projectionType: string;
  snapshot: Readonly<Record<string, unknown>>;
  sourceVersion: number;
}

interface PortalView {
  projections: readonly ProjectionRow[];
}

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
    };
  }, []);
  return online;
}

function TerminalLayout({
  children,
  home,
  title,
}: {
  children: ReactNode;
  home: string;
  title: string;
}) {
  const online = useOnlineStatus();
  return (
    <main className="terminal-shell">
      <header className="terminal-header">
        <div>
          <Typography.Text className="terminal-brand">澄链协作</Typography.Text>
          <Typography.Title level={3}>{title}</Typography.Title>
        </div>
        <Badge
          status={online ? 'success' : 'warning'}
          text={online ? '在线 · 已同步' : '离线 · 本地队列保留'}
        />
      </header>
      <section className="terminal-content">{children}</section>
      <nav aria-label={`${title}底部导航`} className="terminal-bottom-nav">
        <NavLink end to={home}>
          首页
        </NavLink>
        <NavLink to={`${home}/activity`}>动态</NavLink>
        <NavLink to={`${home}/profile`}>我的</NavLink>
      </nav>
    </main>
  );
}

function PortalProjectionPanel({
  principalType,
}: {
  principalType: PrincipalType;
}) {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const location = useLocation();
  const [rows, setRows] = useState<readonly ProjectionRow[]>([]);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    try {
      const response = await fetch('/api/v1/integration/portal/workspace', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Correlation-Id': crypto.randomUUID(),
          'X-Tenant-Id': claims.tenantId,
        },
      });
      const body = (await response.json()) as PortalView & {
        code?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '加载失败'}`,
        );
      setRows(
        body.projections.filter((row) => row.principalType === principalType),
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '门户加载失败');
    }
  }, [accessToken, claims, principalType]);

  useEffect(() => void refresh(), [refresh]);
  const heading = location.pathname.endsWith('/activity')
    ? '最近动态'
    : '业务总览';
  const summary = useMemo(
    () =>
      rows.reduce<Record<string, number>>((result, row) => {
        result[row.projectionType] = (result[row.projectionType] ?? 0) + 1;
        return result;
      }, {}),
    [rows],
  );

  if (!claims)
    return <Alert message="请先登录后访问专属门户" showIcon type="info" />;
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <Card
        title={heading}
        extra={<Button onClick={() => void refresh()}>刷新</Button>}
      >
        <Space wrap>
          {Object.entries(summary).map(([key, count]) => (
            <Tag color="cyan" key={key}>
              {key} {count}
            </Tag>
          ))}
        </Space>
      </Card>
      {rows.length > 0 ? (
        <List
          dataSource={[...rows]}
          renderItem={(row) => (
            <List.Item>
              <List.Item.Meta
                description={`版本 ${row.sourceVersion} · ${row.projectionType}`}
                title={String(row.snapshot.label ?? row.businessRef)}
              />
            </List.Item>
          )}
        />
      ) : (
        <Empty description="暂无授权业务数据" />
      )}
    </Space>
  );
}

export function CustomerPortalShell() {
  return (
    <TerminalLayout home="/portal/customer" title="客户门户">
      <PortalProjectionPanel principalType="CUSTOMER" />
    </TerminalLayout>
  );
}

export function PartnerPortalShell() {
  return (
    <TerminalLayout home="/portal/partner" title="伙伴门户">
      <PortalProjectionPanel principalType="SUPPLIER" />
    </TerminalLayout>
  );
}

export function DriverTerminalShell() {
  return (
    <TerminalLayout home="/driver" title="司机执行端">
      <DriverTrackingPanel />
    </TerminalLayout>
  );
}

export function RfTerminalShell() {
  return (
    <TerminalLayout home="/rf" title="仓储 RF 端">
      <MobileOperationsWorkbench />
    </TerminalLayout>
  );
}
