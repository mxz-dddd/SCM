import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface MetricRow {
  activeVersionNumber: number | null;
  code: string;
  id: string;
  name: string;
  status: string;
}

interface ObservationRow {
  id: string;
  metricVersionId: string;
  periodEnd: string;
  value: string;
}

interface DashboardRow {
  activeVersionNumber: number | null;
  code: string;
  id: string;
  name: string;
  status: string;
}

interface ReportRow {
  activeVersionNumber: number | null;
  code: string;
  id: string;
  name: string;
  status: string;
  visibility: string;
}

interface JobRow {
  estimatedCost: number;
  exportRequested: boolean;
  id: string;
  rowCount: number;
  status: string;
}

interface WatermarkRow {
  dataset: string;
  id: string;
  lastOccurredAt: string;
  lateRecordCount: number;
}

interface RecomputeRow {
  dataset: string;
  id: string;
  isolationKey: string;
  outputCount: number;
  status: string;
}

interface BiView {
  dashboards: readonly DashboardRow[];
  dimensionSnapshots: readonly { dataset: string; id: string }[];
  factSnapshots: readonly { dataset: string; id: string }[];
  jobs: readonly JobRow[];
  metrics: readonly MetricRow[];
  observations: readonly ObservationRow[];
  recomputes: readonly RecomputeRow[];
  reports: readonly ReportRow[];
  watermarks: readonly WatermarkRow[];
}

const emptyView: BiView = {
  dashboards: [],
  dimensionSnapshots: [],
  factSnapshots: [],
  jobs: [],
  metrics: [],
  observations: [],
  recomputes: [],
  reports: [],
  watermarks: [],
};

const actions = createActionRegistry<'READY'>([
  {
    id: 'refresh',
    label: '刷新 BI 工作台',
    requiredPermissions: ['control.bi.read'],
  },
  {
    id: 'publishMetric',
    label: '发布 KPI 口径版本',
    requiredPermissions: ['control.bi.metric.manage'],
  },
  {
    id: 'publishDashboard',
    label: '发布运营看板版本',
    requiredPermissions: ['control.bi.dashboard.manage'],
  },
  {
    id: 'publishReport',
    label: '保存自助分析报表',
    requiredPermissions: ['control.bi.report.manage'],
  },
  {
    id: 'runQuery',
    label: '运行受控查询',
    requiredPermissions: ['control.bi.query.execute'],
  },
  {
    id: 'sensitiveQuery',
    label: '查看未脱敏结果',
    requiredPermissions: ['control.bi.query.sensitive'],
  },
  {
    id: 'exportReport',
    label: '导出报表结果',
    requiredPermissions: ['control.bi.export'],
  },
  {
    id: 'recompute',
    label: '隔离重算数据集',
    requiredPermissions: ['control.bi.lake.recompute'],
  },
]);

export function BiAnalyticsWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<BiView>(emptyView);
  const [selectedReportIds, setSelectedReportIds] = useState<readonly string[]>(
    [],
  );
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'control.bi.read',
              'control.bi.metric.manage',
              'control.bi.dashboard.manage',
              'control.bi.report.manage',
              'control.bi.query.execute',
              'control.bi.query.sensitive',
              'control.bi.export',
              'control.bi.lake.recompute',
            ]
          : [],
      ),
    [claims],
  );
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: 'READY',
    }),
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用 BI 工作台');
      const response = await fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
          'X-Tenant-Id': claims.tenantId,
          ...(init?.method && init.method !== 'GET'
            ? { 'Idempotency-Key': crypto.randomUUID() }
            : {}),
          ...init?.headers,
        },
      });
      const body = (await response.json()) as BiView & {
        code?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? 'BI 请求失败'}`,
        );
      return body;
    },
    [accessToken, claims],
  );

  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    setView(await request('/api/v1/control/bi/workbench'));
    setError(undefined);
  }, [accessToken, claims, request]);

  useEffect(() => {
    void refresh().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : 'BI 工作台查询失败'),
    );
  }, [refresh]);

  async function post(path: string, body: unknown) {
    await request(path, { body: JSON.stringify(body), method: 'POST' });
  }

  async function execute(actionId: string) {
    if (!decisions.find(({ id }) => id === actionId)?.enabled) return;
    const metric = view.metrics[0];
    const reportId = selectedReportIds[0] ?? view.reports[0]?.id;
    try {
      if (actionId === 'publishMetric') {
        const suffix = Date.now();
        await post('/api/v1/control/bi/metrics', {
          code: `DEMO_RATE_${suffix}`,
          dataSources: ['SHIPMENT_FACT'],
          dimensions: ['organizationRef', 'warehouseRef', 'date'],
          formula: { operands: ['completed', 'total'], operator: 'RATIO' },
          granularity: 'DAY',
          name: '演示履约率',
          refreshPolicy: { mode: 'EVENT', seconds: 30 },
          timeZone: 'Asia/Shanghai',
        });
      } else if (actionId === 'publishDashboard') {
        if (!metric) throw new Error('请先发布 KPI 口径');
        await post('/api/v1/control/bi/dashboards', {
          code: `DEMO_DASHBOARD_${Date.now()}`,
          layout: { columns: 12 },
          name: '演示运营看板',
          refreshSeconds: 30,
          widgets: [
            {
              key: 'service-rate',
              metricCode: metric.code,
              position: { h: 2, w: 3, x: 0, y: 0 },
              title: '履约率',
              type: 'CARD',
            },
          ],
        });
      } else if (actionId === 'publishReport') {
        if (!metric) throw new Error('请先发布 KPI 口径');
        await post('/api/v1/control/bi/reports', {
          code: `DEMO_REPORT_${Date.now()}`,
          dimensions: ['organizationRef', 'warehouseRef', 'date'],
          exportPolicy: { allowed: true, maxRows: 1000 },
          maskingFields: [],
          metricCodes: [metric.code],
          name: '演示自助分析',
          quota: {
            dailyCost: 100000,
            dailyExports: 3,
            dailyQueries: 20,
            maxRows: 1000,
          },
          semanticModel: 'CONTROL_METRICS',
          visibility: 'PRIVATE',
        });
      } else if (actionId === 'recompute') {
        await post('/api/v1/control/bi/lake/recomputes', {
          dataset: 'SHIPMENT_FACT',
          fromAt: new Date(Date.now() - 86_400_000).toISOString(),
          toAt: new Date(Date.now() + 1000).toISOString(),
        });
      } else {
        if (!reportId) throw new Error('请选择或先保存一张报表');
        const path =
          actionId === 'sensitiveQuery'
            ? `/api/v1/control/bi/reports/${reportId}/query-jobs/sensitive`
            : actionId === 'exportReport'
              ? `/api/v1/control/bi/reports/${reportId}/exports`
              : `/api/v1/control/bi/reports/${reportId}/query-jobs`;
        await post(path, { rowLimit: 100 });
      }
      setNotice('BI 动作已执行，发布版本与历史快照保持不可变');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'BI 动作失败');
    }
  }

  const grid = {
    onPageChange: () => undefined,
    page: 1,
    pageSize: 50,
  } as const;

  return (
    <section className="bi-analytics-workbench">
      <Typography.Title level={2}>BI 分析与数据湖</Typography.Title>
      <Typography.Paragraph>
        以版本化语义口径驱动看板和自助分析；查询受权限、配额和脱敏策略约束，数据湖保留水位、迟到事实与隔离重算快照。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />

      <Card title="KPI 指标口径与历史版本">
        <DataGrid
          {...grid}
          columns={[
            { key: 'code', label: '指标编码' },
            { key: 'name', label: '指标名称' },
            { key: 'activeVersionNumber', label: '生效版本' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={view.metrics}
          total={view.metrics.length}
        />
        <Typography.Paragraph>
          已固化指标观测 {view.observations.length} 条。
        </Typography.Paragraph>
      </Card>

      <Card title="运营看板与自动刷新">
        <DataGrid
          {...grid}
          columns={[
            { key: 'code', label: '看板编码' },
            { key: 'name', label: '名称' },
            { key: 'activeVersionNumber', label: '版本' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={view.dashboards}
          total={view.dashboards.length}
        />
      </Card>

      <Card title="自助分析、配额与脱敏">
        <DataGrid
          {...grid}
          columns={[
            { key: 'code', label: '报表编码' },
            { key: 'name', label: '名称' },
            { key: 'visibility', label: '共享范围' },
            { key: 'activeVersionNumber', label: '版本' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onSelectionChange={(ids) => setSelectedReportIds(ids.slice(-1))}
          rows={view.reports}
          selectedIds={selectedReportIds}
          total={view.reports.length}
        />
        <Typography.Paragraph>
          受控查询任务 {view.jobs.length} 个。
        </Typography.Paragraph>
      </Card>

      <Card title="数据湖事实、维度与隔离重算">
        <DataGrid
          {...grid}
          columns={[
            { key: 'dataset', label: '数据集' },
            { key: 'lastOccurredAt', label: '事件水位' },
            { key: 'lateRecordCount', label: '迟到记录' },
          ]}
          rows={view.watermarks}
          total={view.watermarks.length}
        />
        <DataGrid
          {...grid}
          columns={[
            { key: 'dataset', label: '重算数据集' },
            { key: 'isolationKey', label: '隔离键' },
            { key: 'outputCount', label: '输出快照' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={view.recomputes}
          total={view.recomputes.length}
        />
        <Typography.Paragraph>
          在线事实 {view.factSnapshots.length} 条；维度历史{' '}
          {view.dimensionSnapshots.length} 条。
        </Typography.Paragraph>
      </Card>
    </section>
  );
}
