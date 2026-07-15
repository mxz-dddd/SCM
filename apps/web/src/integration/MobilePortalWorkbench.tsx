import { useCallback, useEffect, useMemo, useState } from 'react';
import { CommandBar, DataGrid, QueryPanel, StatusBadge, createActionRegistry } from '@scm/ui';
import type { DataGridColumn } from '@scm/ui';
import { Alert, Card, Col, Row, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

type PrincipalType = 'CUSTOMER' | 'SUPPLIER' | 'CARRIER';
interface GrantRow {
  displayName: string;
  id: string;
  permissions: readonly string[];
  principalRef: string;
  principalType: PrincipalType;
  status?: string;
  version?: number;
}
interface ProjectionRow {
  businessRef: string;
  id: string;
  principalRef: string;
  principalType: PrincipalType;
  projectionKey: string;
  projectionType: string;
  snapshot: Readonly<Record<string, unknown>>;
  sourceVersion: number;
}
interface CommandRow {
  businessRef: string;
  commandType: string;
  id: string;
  principalRef: string;
  principalType: PrincipalType;
  status: string;
  targetDomain: string;
  version: number;
}
interface PortalView {
  commands: readonly CommandRow[];
  grants: readonly GrantRow[];
  projections: readonly ProjectionRow[];
}
const empty: PortalView = { commands: [], grants: [], projections: [] };
const actions = createActionRegistry<string>([
  { id: 'refresh', label: '刷新移动与门户视图', requiredPermissions: ['integration.portal.read'] },
  { id: 'customerDemo', label: '初始化客户移动端', requiredPermissions: ['integration.portal.manage'] },
  { id: 'supplierDemo', label: '初始化供应商门户', requiredPermissions: ['integration.portal.manage'] },
  { id: 'carrierDemo', label: '初始化承运商门户', requiredPermissions: ['integration.portal.manage'] },
  { allowedStatuses: ['READY'], id: 'portalCommand', label: '提交所选业务动作', requiredPermissions: ['integration.portal.command'] },
]);

const projectionCatalog: Readonly<Record<PrincipalType, readonly Readonly<{ projectionType: string; suffix: string }>[]>> = {
  CARRIER: [
    { projectionType: 'TENDER', suffix: '委托' },
    { projectionType: 'VEHICLE', suffix: '车辆' },
    { projectionType: 'DRIVER', suffix: '司机' },
    { projectionType: 'TRACKING', suffix: '跟踪' },
    { projectionType: 'POD', suffix: '回单' },
    { projectionType: 'RECONCILIATION', suffix: '对账' },
  ],
  CUSTOMER: [
    { projectionType: 'ORDER', suffix: '订单' },
    { projectionType: 'INVENTORY', suffix: '库存' },
    { projectionType: 'APPOINTMENT', suffix: '预约' },
    { projectionType: 'SHIPMENT', suffix: '运输' },
    { projectionType: 'DELIVERY', suffix: '签收' },
    { projectionType: 'RECONCILIATION', suffix: '对账' },
    { projectionType: 'MESSAGE', suffix: '消息' },
    { projectionType: 'ATTACHMENT', suffix: '附件' },
  ],
  SUPPLIER: [
    { projectionType: 'ORDER', suffix: '订单' },
    { projectionType: 'ASN', suffix: 'ASN' },
    { projectionType: 'APPOINTMENT', suffix: '预约' },
    { projectionType: 'MESSAGE', suffix: '消息' },
    { projectionType: 'ATTACHMENT', suffix: '附件' },
  ],
};

export function MobilePortalWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<PortalView>(empty);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const selected = view.projections.find(({ id }) => id === selectedIds[0]);
  const permissions = useMemo(() => new Set(claims ? ['integration.portal.read', 'integration.portal.command', 'integration.portal.manage'] : []), [claims]);
  const decisions = actions.list().map(({ id }) => actions.decide(id, { dataScopeAllowed: true, permissions, status: id === 'portalCommand' ? (selected ? 'READY' : 'NONE') : 'READY' }));
  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!accessToken || !claims) throw new Error('请先登录后使用移动端与合作伙伴门户');
      const response = await fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
          'X-Tenant-Id': claims.tenantId,
          ...(init?.method && init.method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
          ...init?.headers,
        },
      });
      const body = (await response.json()) as T & { code?: string; message?: string };
      if (!response.ok) throw new Error(`${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '移动端与门户请求失败'}`);
      return body;
    },
    [accessToken, claims],
  );
  async function post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { body: JSON.stringify(body), method: 'POST' });
  }
  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    try {
      setView(await request<PortalView>('/api/v1/integration/portal/workspace'));
      setError(undefined);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '门户查询失败';
      if (message.includes('PORTAL_SCOPE_DENIED')) setView(empty);
      else throw caught;
    }
  }, [accessToken, claims, request]);
  useEffect(() => {
    void refresh().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '门户查询失败'));
  }, [refresh]);

  async function initialize(principalType: PrincipalType) {
    if (!claims) return;
    const principalRef = `${principalType}-DEMO-${Date.now()}`;
    await post('/api/v1/integration/portal/grants', {
      accountId: claims.subject,
      displayName: principalType === 'CUSTOMER' ? '客户移动端样例' : principalType === 'SUPPLIER' ? '供应商门户样例' : '承运商门户样例',
      permissions: ['VIEW_ALL', 'COMMAND_ALL'],
      principalRef,
      principalType,
    });
    const businessRef = `${principalType === 'CUSTOMER' ? 'SO' : principalType === 'SUPPLIER' ? 'PO' : 'SHP'}-${Date.now()}`;
    for (const item of projectionCatalog[principalType]) {
      const aggregateId = crypto.randomUUID();
      await post('/api/v1/integration/portal/projections/events', {
        businessRef,
        event: {
          aggregateId,
          aggregateType: 'PortalDemo',
          aggregateVersion: 1,
          eventId: crypto.randomUUID(),
          eventType: `${principalType === 'CARRIER' ? 'shipment' : 'order'}.updated.v1`,
          occurredAt: new Date().toISOString(),
          payload: { businessRef },
          schemaVersion: 1,
          traceId: crypto.randomUUID(),
        },
        principalRef,
        principalType,
        projectionKey: `${businessRef}-${item.projectionType}`,
        projectionType: item.projectionType,
        snapshot: { businessRef, label: `${businessRef} · ${item.suffix}`, status: 'OPEN', updatedAt: new Date().toISOString() },
      });
    }
  }

  async function execute(actionId: string) {
    if (!decisions.find(({ id }) => id === actionId)?.enabled) return;
    try {
      if (actionId === 'refresh') await refresh();
      else if (actionId === 'customerDemo') await initialize('CUSTOMER');
      else if (actionId === 'supplierDemo') await initialize('SUPPLIER');
      else if (actionId === 'carrierDemo') await initialize('CARRIER');
      else if (actionId === 'portalCommand' && selected) {
        const command = selected.principalType === 'CUSTOMER' ? 'CUSTOMER_CONFIRM' : selected.principalType === 'SUPPLIER' ? 'SUPPLIER_ORDER_RESPONSE' : 'CARRIER_TENDER_RESPONSE';
        await post('/api/v1/integration/portal/commands', {
          businessRef: selected.businessRef,
          commandType: command,
          payload: selected.principalType === 'SUPPLIER' ? { decision: 'ACCEPT' } : selected.principalType === 'CARRIER' ? { decision: 'ACCEPT' } : { expectedVersion: selected.sourceVersion },
          principalRef: selected.principalRef,
          principalType: selected.principalType,
        });
      }
      setNotice('门户动作已受理，目标领域将通过 Outbox 命令处理');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '移动端与门户动作失败');
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = view.projections.filter((row) => !normalizedQuery || `${row.businessRef} ${row.projectionType} ${JSON.stringify(row.snapshot)}`.toLowerCase().includes(normalizedQuery));
  const rows = (principalType: PrincipalType) => filtered.filter((row) => row.principalType === principalType);
  const grid = { onPageChange: () => undefined, page: 1, pageSize: 100 } as const;
  const columns: readonly DataGridColumn<ProjectionRow>[] = [
    { key: 'businessRef', label: '业务引用' },
    { key: 'projectionType', label: '视图' },
    { key: 'principalRef', label: '主体范围' },
    { key: 'snapshot', label: '移动摘要', render: (value: unknown) => String((value as { label?: string }).label ?? '-') },
    { key: 'sourceVersion', label: '来源版本' },
  ];
  return (
    <section className="mobile-portal-workbench">
      <Typography.Title level={2}>客户移动端与合作伙伴门户</Typography.Title>
      <Typography.Paragraph>客户、供应商和承运商共享 Web 权限模型，但每条查询和命令都绑定精确主体范围；跨域动作只发布目标领域命令，不读取或修改他域内部表。</Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <QueryPanel fields={[{ label: '业务号 / 视图', name: 'query', quick: true }]} onQuery={(values) => setQuery(values.query ?? '')} onReset={() => setQuery('')} />
      <CommandBar actions={decisions} onAction={(action) => void execute(action.id)} />
      <Row gutter={[12, 12]}>
        <Col xs={24} xl={8}><Card title="客户移动端：订单、库存、预约、运输、签收、对账"><DataGrid {...grid} columns={columns} onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))} rows={rows('CUSTOMER')} selectedIds={selectedIds} total={rows('CUSTOMER').length} /></Card></Col>
        <Col xs={24} xl={8}><Card title="供应商门户：订单、ASN、预约"><DataGrid {...grid} columns={columns} onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))} rows={rows('SUPPLIER')} selectedIds={selectedIds} total={rows('SUPPLIER').length} /></Card></Col>
        <Col xs={24} xl={8}><Card title="承运商门户：委托、车辆司机、跟踪、回单、对账"><DataGrid {...grid} columns={columns} onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))} rows={rows('CARRIER')} selectedIds={selectedIds} total={rows('CARRIER').length} /></Card></Col>
      </Row>
      <Card title="门户命令状态">
        <DataGrid {...grid} columns={[{ key: 'businessRef', label: '业务引用' }, { key: 'principalType', label: '主体' }, { key: 'commandType', label: '命令' }, { key: 'targetDomain', label: '目标领域' }, { key: 'status', label: '状态', render: (value) => <StatusBadge status={String(value)} /> }, { key: 'version', label: '版本' }]} onSelectionChange={() => undefined} rows={view.commands} total={view.commands.length} />
      </Card>
      <Alert message={`当前账号已绑定 ${view.grants.length} 个主体范围，展示 ${filtered.length} 个最新版本投影。`} showIcon type="info" />
    </section>
  );
}
