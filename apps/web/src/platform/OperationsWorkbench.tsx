import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Col, Row, Statistic, Typography } from 'antd';
import { useSessionStore } from './session-store';

interface OpsRow {
  id: string;
  jobRunId?: string | null;
  status: string;
  version: number;
  [key: string]: unknown;
}
interface OperationsView {
  alerts: OpsRow[];
  archiveJobs: OpsRow[];
  backups: OpsRow[];
  capacityPlans: OpsRow[];
  drills: OpsRow[];
  migrationRuns: OpsRow[];
  monitorRules: OpsRow[];
  privacyRequests: OpsRow[];
  reconciliationReports: OpsRow[];
  redactionRecords: OpsRow[];
  releases: OpsRow[];
  retentionPolicies: OpsRow[];
  telemetry: {
    counters: Record<string, number>;
    durations: Record<string, { count: number; maxMs: number; meanMs: number }>;
  };
  tenantMigrations: OpsRow[];
  usageMetrics: OpsRow[];
}

const empty: OperationsView = {
  alerts: [],
  archiveJobs: [],
  backups: [],
  capacityPlans: [],
  drills: [],
  migrationRuns: [],
  monitorRules: [],
  privacyRequests: [],
  reconciliationReports: [],
  redactionRecords: [],
  releases: [],
  retentionPolicies: [],
  telemetry: { counters: {}, durations: {} },
  tenantMigrations: [],
  usageMetrics: [],
};
const permissions = [
  'platform.operations.read',
  'platform.operations.monitor.manage',
  'platform.operations.signal.ingest',
  'platform.operations.recovery.manage',
  'platform.operations.release.manage',
  'platform.operations.policy.manage',
  'platform.operations.archive.manage',
  'platform.operations.privacy.manage',
  'platform.operations.capacity.manage',
  'platform.operations.migration.manage',
] as const;
const registry = createActionRegistry<string>([
  {
    id: 'refresh',
    label: '刷新运维工作台',
    requiredPermissions: ['platform.operations.read'],
  },
  {
    id: 'monitor',
    label: '创建监控规则',
    requiredPermissions: ['platform.operations.monitor.manage'],
  },
  {
    id: 'signal',
    label: '采集队列积压指标',
    requiredPermissions: ['platform.operations.signal.ingest'],
  },
  {
    id: 'backup',
    label: '登记 PITR 备份',
    requiredPermissions: ['platform.operations.recovery.manage'],
  },
  {
    id: 'release',
    label: '登记发布制品',
    requiredPermissions: ['platform.operations.release.manage'],
  },
  {
    id: 'retention',
    label: '创建保留策略',
    requiredPermissions: ['platform.operations.policy.manage'],
  },
  {
    id: 'privacy',
    label: '登记主体请求',
    requiredPermissions: ['platform.operations.privacy.manage'],
  },
  {
    id: 'capacity',
    label: '创建容量计划',
    requiredPermissions: ['platform.operations.capacity.manage'],
  },
  {
    asynchronous: true,
    id: 'migration',
    label: '创建租户迁移计划',
    requiredPermissions: ['platform.operations.migration.manage'],
  },
]);

const text = (row: OpsRow, key: string) => String(row[key] ?? '—');
const columns = [
  {
    key: 'status',
    label: '状态',
    render: (value: unknown) => <StatusBadge status={String(value)} />,
  },
  { key: 'version', label: '版本' },
] as const;

export function OperationsWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<OperationsView>(empty);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const granted = useMemo(() => new Set(claims ? permissions : []), [claims]);
  const actions = registry.list().map(({ id }) =>
    registry.decide(id, {
      dataScopeAllowed: true,
      permissions: granted,
      status: 'READY',
    }),
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用生产运维工作台');
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
      const body = (await response.json()) as OperationsView & {
        code?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '运维请求失败'}`,
        );
      return body;
    },
    [accessToken, claims],
  );
  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    setView(await request('/api/v1/platform/operations/workbench'));
    setError(undefined);
  }, [accessToken, claims, request]);
  useEffect(() => {
    void refresh().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : '运维工作台查询失败'),
    );
  }, [refresh]);

  async function post(path: string, body: unknown) {
    return request(path, { body: JSON.stringify(body), method: 'POST' });
  }
  async function execute(id: string) {
    if (!actions.find((action) => action.id === id)?.enabled) return;
    const suffix = crypto.randomUUID();
    try {
      if (id === 'monitor')
        await post('/api/v1/platform/operations/monitor-rules', {
          code: `API.ERROR.${suffix.slice(0, 8)}`,
          dedupSeconds: 300,
          dimensionFilter: {},
          durationSeconds: 60,
          name: 'API 错误率',
          operator: 'GT',
          ownerRef: 'SRE',
          severity: 'CRITICAL',
          signal: 'api.error_rate',
          threshold: 0.02,
        });
      else if (id === 'signal')
        await post('/api/v1/platform/operations/signals', {
          dimensions: { queue: 'job-run' },
          domain: 'PLATFORM',
          signal: 'queue.backlog',
          traceId: crypto.randomUUID(),
          unit: 'jobs',
          value: 120,
        });
      else if (id === 'backup')
        await post('/api/v1/platform/operations/backups', {
          backupNo: `BACKUP-${suffix}`,
          environment: 'production',
          policy: {
            crossRegion: true,
            databasePitr: true,
            objectVersioning: true,
          },
          targetRpoMinutes: 15,
          targetRtoMinutes: 60,
        });
      else if (id === 'release')
        await post('/api/v1/platform/operations/releases', {
          artifacts: {
            imageScanPassed: true,
            migrationSafetyPassed: true,
            testsPassed: true,
          },
          commitSha: suffix.replaceAll('-', '').padEnd(40, '0').slice(0, 40),
          environment: 'production',
          imageDigest: `sha256:${suffix.replaceAll('-', '').padEnd(64, '0')}`,
          releaseNo: `REL-${suffix}`,
        });
      else if (id === 'retention')
        await post('/api/v1/platform/operations/retention-policies', {
          archiveAfterDays: 30,
          archiveTier: 'COLD',
          category: `TELEMETRY-${suffix.slice(0, 8)}`,
          contract: { searchable: true },
          deleteAllowed: true,
          legalHold: false,
          retainDays: 365,
        });
      else if (id === 'privacy')
        await post('/api/v1/platform/operations/privacy-requests', {
          dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          legalBasis: { retainAudit: true },
          requestNo: `DSR-${suffix}`,
          requestType: 'ACCESS',
          scope: { domains: ['OMS', 'TMS'] },
          subjectRef: `subject-${suffix}`,
        });
      else if (id === 'capacity')
        await post('/api/v1/platform/operations/capacity-plans', {
          code: `API-${suffix.slice(0, 8)}`,
          domain: 'PLATFORM',
          effectiveFrom: new Date().toISOString(),
          quota: { dailyRequests: 100000 },
          scaling: { maxReplicas: 20, targetCpu: 65 },
          tiering: { hotDays: 30 },
        });
      else if (id === 'migration')
        await post('/api/v1/platform/operations/tenant-migrations', {
          dependencies: { satisfied: true },
          planNo: `TM-${suffix}`,
          rollback: { tested: true },
          scope: { domains: ['MDM', 'OMS'] },
          sourceEnvironment: 'pilot',
          sourceTotals: { orderCount: 0 },
          targetEnvironment: 'production',
          targetTotals: { orderCount: 0 },
        });
      await refresh();
      setNotice(id === 'refresh' ? '运维视图已刷新' : '运维命令已登记');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运维动作失败');
    }
  }
  const matches = (row: OpsRow) =>
    !query ||
    Object.values(row).some((value) =>
      String(value).toLowerCase().includes(query.toLowerCase()),
    );
  const grid = (rows: OpsRow[], extra: { key: string; label: string }[]) => (
    <DataGrid
      columns={[...extra, ...columns]}
      onPageChange={() => undefined}
      page={1}
      pageSize={300}
      rows={rows.filter(matches)}
      total={rows.filter(matches).length}
    />
  );
  const activeAlerts = view.alerts.filter(
    ({ status }) => status !== 'RESOLVED',
  ).length;
  const queued = [
    ...view.archiveJobs,
    ...view.drills,
    ...view.privacyRequests,
    ...view.tenantMigrations,
  ].filter(({ status }) => ['QUEUED', 'RUNNING'].includes(status)).length;

  return (
    <section className="operations-workbench">
      <Typography.Title level={2}>生产运维与数据治理</Typography.Title>
      {error ? (
        <Alert
          closable
          message={error}
          onClose={() => setError(undefined)}
          type="error"
        />
      ) : null}
      {notice ? (
        <Alert
          closable
          message={notice}
          onClose={() => setNotice(undefined)}
          type="success"
        />
      ) : null}
      <QueryPanel
        fields={[{ label: '状态、编号或域', name: 'keyword', quick: true }]}
        onQuery={(values) => setQuery(values.keyword ?? '')}
        onReset={() => setQuery('')}
        onSaveView={() => setNotice('运维视图已保存')}
      />
      <CommandBar
        actions={actions}
        onAction={(action) => void execute(action.id)}
      />
      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Card>
            <Statistic title="未恢复告警" value={activeAlerts} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="异步任务" value={queued} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="用量指标" value={view.usageMetrics.length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="最近最大延迟(ms)"
              value={Math.max(
                0,
                ...Object.values(view.telemetry.durations).map(
                  ({ maxMs }) => maxMs,
                ),
              )}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="业务与技术告警">
            {grid(view.alerts, [
              { key: 'signal', label: '信号' },
              { key: 'severity', label: '级别' },
              { key: 'triggerCount', label: '次数' },
            ])}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="备份与容灾演练">
            {grid(
              [...view.backups, ...view.drills],
              [
                { key: 'backupNo', label: '备份/演练号' },
                { key: 'jobRunId', label: '异步 jobId' },
              ],
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="发布与迁移">
            {grid(
              [...view.releases, ...view.migrationRuns],
              [
                { key: 'releaseNo', label: '发布号' },
                { key: 'phase', label: '迁移阶段' },
              ],
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="保留、归档与隐私">
            {grid(
              [
                ...view.retentionPolicies,
                ...view.archiveJobs,
                ...view.privacyRequests,
              ],
              [
                { key: 'category', label: '类别' },
                { key: 'jobRunId', label: '异步 jobId' },
              ],
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="容量、配额与成本">
            {grid(view.capacityPlans, [
              { key: 'code', label: '计划代码' },
              { key: 'domain', label: '域' },
            ])}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="租户迁移与对账">
            {grid(
              [...view.tenantMigrations, ...view.reconciliationReports],
              [
                { key: 'planNo', label: '计划号' },
                { key: 'differenceCount', label: '差异数' },
                { key: 'jobRunId', label: '异步 jobId' },
              ],
            )}
          </Card>
        </Col>
      </Row>
      <Typography.Paragraph type="secondary">
        日志、指标、Trace 通过 traceId
        与业务引用关联；归档、隐私与迁移只接收领域快照/命令，不跨域访问内部表。当前规则{' '}
        {view.monitorRules.length} 条，脱敏证据 {view.redactionRecords.length}{' '}
        条。
        {text(
          {
            id: 'telemetry',
            status: 'ACTIVE',
            version: 1,
            requests: Object.values(view.telemetry.counters).reduce(
              (sum, value) => sum + value,
              0,
            ),
          },
          'requests',
        )}{' '}
        次可观测请求。
      </Typography.Paragraph>
    </section>
  );
}
