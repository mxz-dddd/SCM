import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BusinessTimeline,
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Typography } from 'antd';
import { useSessionStore } from './session-store';

interface AuditRow {
  action: string;
  after: unknown;
  before: unknown;
  category: string;
  correlationId: string;
  createdAt: string;
  createdBy: string;
  id: string;
  outcome: string;
  resourceId: string;
  resourceType: string;
}

interface HistoryRow {
  action: string;
  after: unknown;
  before: unknown;
  changedAt: string;
  changedFields: string[];
  correlationId: string;
  id: string;
  resourceId: string;
  resourceType: string;
}

const actionRegistry = createActionRegistry<'READY'>([
  {
    confirmMessage: '导出会记录当前筛选、字段和结果数量，确认继续？',
    id: 'export-audit',
    label: '导出当前审计视图',
    requiredPermissions: ['platform.audit.export'],
  },
]);

export function AuditWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [logs, setLogs] = useState<readonly AuditRow[]>([]);
  const [history, setHistory] = useState<readonly HistoryRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Readonly<Record<string, string>>>({});
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const permissions = useMemo(
    () =>
      new Set(
        claims && claims.accountKind !== 'USER'
          ? ['platform.audit.read', 'platform.audit.export']
          : [],
      ),
    [claims],
  );
  const exportAction = actionRegistry.decide('export-audit', {
    dataScopeAllowed: true,
    permissions,
    status: 'READY',
  });

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后查询审计');
      const response = await fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
          'X-Tenant-Id': claims.tenantId,
          ...(init?.method === 'POST'
            ? { 'Idempotency-Key': crypto.randomUUID() }
            : {}),
          ...init?.headers,
        },
      });
      const body = (await response.json()) as {
        code?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '请求失败'}`,
        );
      }
      return body;
    },
    [accessToken, claims],
  );

  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: '20',
      ...Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value.trim()),
      ),
    });
    try {
      const [logResponse, historyResponse] = await Promise.all([
        request(`/api/v1/platform/audit/logs?${parameters}`),
        request('/api/v1/platform/audit/change-history?page=1&pageSize=20'),
      ]);
      const logPage = logResponse as unknown as {
        items: AuditRow[];
        total: number;
      };
      const historyPage = historyResponse as unknown as {
        items: HistoryRow[];
      };
      setLogs(logPage.items);
      setTotal(logPage.total);
      setHistory(historyPage.items);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '审计查询失败');
    }
  }, [accessToken, claims, filters, page, request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function exportView() {
    if (!exportAction.enabled || !window.confirm(exportAction.confirmMessage!))
      return;
    try {
      const response = (await request('/api/v1/platform/audit/exports', {
        body: JSON.stringify({
          exportedFields: [
            'createdAt',
            'category',
            'action',
            'resourceType',
            'outcome',
            'correlationId',
          ],
          queryCriteria: filters,
          resourceType: 'AuditLog',
          resultCount: total,
        }),
        method: 'POST',
      })) as unknown as { auditLogId: string };
      setNotice(`导出已留痕：${response.auditLogId.slice(0, 8)}`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导出留痕失败');
    }
  }

  const selected = logs.find(({ id }) => id === selectedIds[0]);

  return (
    <section className="audit-workbench">
      <Typography.Title level={2}>审计与变更历史</Typography.Title>
      <Typography.Paragraph>
        只读查询登录、敏感访问、导出和业务变更；审计记录不可修改或删除。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}

      <Card title="审计日志">
        <QueryPanel
          expanded
          fields={[
            { label: '动作', name: 'action', quick: true },
            { label: '类别', name: 'category', quick: true },
            { label: '业务引用', name: 'businessRef', quick: true },
            { label: '资源类型', name: 'resourceType', quick: true },
            { label: '开始日期', name: 'from', type: 'date' },
            { label: '结束日期', name: 'to', type: 'date' },
          ]}
          onQuery={(values) => {
            setFilters(values);
            setPage(1);
          }}
          onReset={() => {
            setFilters({});
            setPage(1);
          }}
        />
        <CommandBar
          actions={[exportAction]}
          onAction={() => void exportView()}
        />
        <DataGrid
          columns={[
            { fixed: 'left', key: 'createdAt', label: '时间' },
            { key: 'category', label: '类别' },
            { key: 'action', label: '动作' },
            { key: 'resourceType', label: '资源' },
            {
              key: 'outcome',
              label: '结果',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { fixed: 'right', key: 'correlationId', label: 'Trace' },
          ]}
          onPageChange={setPage}
          onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))}
          page={page}
          pageSize={20}
          rows={logs}
          selectedIds={selectedIds}
          total={total}
        />
      </Card>

      <div className="audit-detail-grid">
        <Card title="选中记录（已脱敏）">
          {selected ? (
            <pre>
              {JSON.stringify(
                { after: selected.after, before: selected.before },
                null,
                2,
              )}
            </pre>
          ) : (
            <Typography.Text type="secondary">
              请选择一条审计日志
            </Typography.Text>
          )}
        </Card>
        <Card title="操作时间线">
          <BusinessTimeline
            events={logs.slice(0, 10).map((log) => ({
              actor: log.createdBy,
              occurredAt: log.createdAt,
              source: log.resourceType,
              title: log.action,
              traceId: log.correlationId,
            }))}
          />
        </Card>
      </div>

      <Card title="不可变 ChangeHistory">
        <DataGrid
          columns={[
            { fixed: 'left', key: 'changedAt', label: '变更时间' },
            { key: 'resourceType', label: '资源' },
            { key: 'action', label: '动作' },
            {
              key: 'changedFields',
              label: '变更字段',
              render: (value) => (value as string[]).join(', '),
            },
            { fixed: 'right', key: 'correlationId', label: 'Trace' },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={20}
          rows={history}
          total={history.length}
        />
      </Card>
    </section>
  );
}
