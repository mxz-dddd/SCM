import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

type CaseStatus =
  'ACKNOWLEDGED' | 'CLOSED' | 'IN_PROGRESS' | 'OPEN' | 'RESOLVED';

interface SlaRow {
  businessRef: string;
  dueAt: string;
  id: string;
  milestone: string;
  responsibleDomain: string;
  status: string;
  version: number;
  warningAt: string;
}

interface RuleRow {
  activeVersionNumber: number | null;
  code: string;
  customerRef: string | null;
  id: string;
  name: string;
  status: string;
}

interface CaseRow {
  businessRef: string;
  caseNo: string;
  dueAt: string;
  escalationLevel: number;
  id: string;
  ownerRef: string | null;
  responsibleDomain: string;
  severity: string;
  status: CaseStatus;
  title: string;
  triggerCount: number;
  version: number;
}

interface KnowledgeRow {
  articleCode: string;
  id: string;
  rootCauseCode: string;
  title: string;
  versionNumber: number;
}

interface GovernanceView {
  assignments: readonly { alertCaseId: string; id: string }[];
  cases: readonly CaseRow[];
  clocks: readonly SlaRow[];
  escalations: readonly { alertCaseId: string; id: string }[];
  knowledge: readonly KnowledgeRow[];
  notifications: readonly { alertCaseId: string; id: string }[];
  remediations: readonly { alertCaseId: string; id: string }[];
  rootCauses: readonly { alertCaseId: string; id: string }[];
  rules: readonly RuleRow[];
}

const emptyView: GovernanceView = {
  assignments: [],
  cases: [],
  clocks: [],
  escalations: [],
  knowledge: [],
  notifications: [],
  remediations: [],
  rootCauses: [],
  rules: [],
};

const actions = createActionRegistry<CaseStatus | 'NONE'>([
  {
    id: 'refresh',
    label: '刷新预警中心',
    requiredPermissions: ['control.alert.read'],
  },
  {
    id: 'publishRule',
    label: '发布预警规则版本',
    requiredPermissions: ['control.alert.rule.manage'],
  },
  {
    id: 'startSla',
    label: '启动 SLA 计时器',
    requiredPermissions: ['control.sla.manage'],
  },
  {
    id: 'monitorSla',
    label: '运行 SLA 监控',
    requiredPermissions: ['control.sla.manage'],
  },
  {
    allowedStatuses: ['OPEN'],
    id: 'acknowledge',
    label: '确认例外',
    requiredPermissions: ['control.alert.manage'],
  },
  {
    allowedStatuses: ['OPEN', 'ACKNOWLEDGED'],
    id: 'startCase',
    label: '开始处置',
    requiredPermissions: ['control.alert.manage'],
  },
  {
    allowedStatuses: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'],
    id: 'resolve',
    label: '验证解决',
    requiredPermissions: ['control.alert.manage'],
  },
  {
    allowedStatuses: ['RESOLVED'],
    id: 'close',
    label: '根因关闭',
    requiredPermissions: ['control.alert.manage'],
  },
  {
    allowedStatuses: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED'],
    id: 'remediate',
    label: '请求领域修复命令',
    requiredPermissions: ['control.alert.remediate'],
  },
  {
    id: 'monitorEscalations',
    label: '运行通知升级',
    requiredPermissions: ['control.alert.escalate'],
  },
]);

export function AlertGovernanceWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<GovernanceView>(emptyView);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const selected = view.cases.find(({ id }) => id === selectedIds[0]);
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'control.alert.read',
              'control.alert.rule.manage',
              'control.alert.manage',
              'control.alert.remediate',
              'control.alert.escalate',
              'control.sla.manage',
            ]
          : [],
      ),
    [claims],
  );
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selected?.status ?? 'NONE',
    }),
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用预警中心');
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
      const body = (await response.json()) as GovernanceView & {
        code?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '预警请求失败'}`,
        );
      return body;
    },
    [accessToken, claims],
  );

  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    const result = await request(
      `/api/v1/control/alerts/workbench${query ? `?query=${encodeURIComponent(query)}` : ''}`,
    );
    setView(result);
    setError(undefined);
  }, [accessToken, claims, query, request]);

  useEffect(() => {
    void refresh().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : '预警中心查询失败'),
    );
  }, [refresh]);

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (!decision?.enabled) return;
    try {
      if (actionId === 'publishRule')
        await request('/api/v1/control/alert-rules', {
          body: JSON.stringify({
            channels: ['IN_APP', 'EMAIL'],
            code: `DEMO_DELAY_${Date.now()}`,
            condition: {
              eventTypes: ['tms.shipment-delayed.v1'],
              minimumDurationSeconds: 300,
              statuses: ['DELAYED'],
            },
            debounceSeconds: 60,
            dueMinutes: 30,
            escalationMinutes: 15,
            mergeWindowSeconds: 1800,
            name: '演示运输延误预警',
            responsibleDomain: 'TMS',
            severity: 'HIGH',
            suppressionSeconds: 600,
          }),
          method: 'POST',
        });
      else if (actionId === 'startSla')
        await request('/api/v1/control/slas', {
          body: JSON.stringify({
            businessRef: `DEMO-ORDER-${Date.now()}`,
            calendarCode: 'DEFAULT',
            durationMinutes: 120,
            milestone: 'DELIVERY',
            responsibleDomain: 'TMS',
            sourceVersion: 1,
            warningLeadMinutes: 30,
          }),
          method: 'POST',
        });
      else if (actionId === 'monitorSla')
        await request('/api/v1/control/slas/monitor', {
          body: JSON.stringify({ now: new Date().toISOString() }),
          method: 'POST',
        });
      else if (actionId === 'monitorEscalations')
        await request('/api/v1/control/alert-escalations/monitor', {
          body: JSON.stringify({ now: new Date().toISOString() }),
          method: 'POST',
        });
      else if (selected && actionId === 'remediate')
        await request(`/api/v1/control/alerts/${selected.id}/remediation`, {
          body: JSON.stringify({
            command: { requestedFrom: 'CONTROL_WORKBENCH' },
            commandType: 'tms.exception.recalculate.v1',
            reason: '控制塔登记修复请求，由领域命令执行',
            targetDomain: selected.responsibleDomain,
            targetRef: selected.businessRef,
          }),
          method: 'POST',
        });
      else if (selected) {
        const action = {
          acknowledge: 'ACKNOWLEDGE',
          close: 'CLOSE',
          resolve: 'RESOLVE',
          startCase: 'START',
        }[actionId];
        await request(`/api/v1/control/alerts/${selected.id}/actions`, {
          body: JSON.stringify({
            action,
            expectedVersion: selected.version,
            ...(action === 'RESOLVE'
              ? { resolution: '工作台验证处置完成', verified: true }
              : {}),
            ...(action === 'CLOSE'
              ? {
                  responsibleParty: selected.responsibleDomain,
                  rootCauseCode: 'OPERATIONS_PROCESS',
                  solution: '固化标准处置流程并完成复核',
                  verification: { passed: true },
                }
              : {}),
          }),
          method: 'POST',
        });
      }
      setNotice('预警治理动作已执行，历史事实保持不可变');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '预警治理动作失败');
    }
  }

  const grid = {
    onPageChange: () => undefined,
    page: 1,
    pageSize: 50,
  } as const;

  return (
    <section className="alert-governance-workbench">
      <Typography.Title level={2}>SLA、预警与例外治理</Typography.Title>
      <Typography.Paragraph>
        以控制域规则消费业务事件，统一去抖、抑制和合并告警；修复只登记目标领域命令，不直接修改订单、库存、运输或预约内部表。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <QueryPanel
        fields={[
          { label: '工单 / 业务引用 / 根因', name: 'query', quick: true },
        ]}
        onQuery={(values) => setQuery(values.query ?? '')}
        onReset={() => setQuery('')}
      />
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />

      <Card title="可暂停与重开的 SLA 计时器">
        <DataGrid
          {...grid}
          columns={[
            { key: 'businessRef', label: '业务引用' },
            { key: 'milestone', label: '里程碑' },
            { key: 'responsibleDomain', label: '责任域' },
            { key: 'warningAt', label: '预警时间' },
            { key: 'dueAt', label: '截止时间' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={view.clocks}
          total={view.clocks.length}
        />
      </Card>

      <Card title="版本化预警规则与复杂条件">
        <DataGrid
          {...grid}
          columns={[
            { key: 'code', label: '规则编码' },
            { key: 'name', label: '规则名称' },
            { key: 'customerRef', label: '客户覆盖' },
            { key: 'activeVersionNumber', label: '生效版本' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={view.rules}
          total={view.rules.length}
        />
      </Card>

      <Card title="例外工单与责任路由">
        <DataGrid
          {...grid}
          columns={[
            { key: 'caseNo', label: '工单号' },
            { key: 'businessRef', label: '业务引用' },
            { key: 'title', label: '标题' },
            { key: 'responsibleDomain', label: '责任域' },
            { key: 'ownerRef', label: '责任人' },
            { key: 'severity', label: '严重度' },
            { key: 'triggerCount', label: '合并次数' },
            { key: 'dueAt', label: '截止时间' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))}
          rows={view.cases}
          selectedIds={selectedIds}
          total={view.cases.length}
        />
      </Card>

      <Card title="通知、升级与领域修复请求">
        <Typography.Paragraph>
          通知请求 {view.notifications.length} 条；升级事件{' '}
          {view.escalations.length}
          条；领域修复请求 {view.remediations.length} 条；责任分派历史{' '}
          {view.assignments.length} 条。
        </Typography.Paragraph>
      </Card>

      <Card title="根因与处置知识库">
        <DataGrid
          {...grid}
          columns={[
            { key: 'articleCode', label: '知识编码' },
            { key: 'versionNumber', label: '版本' },
            { key: 'rootCauseCode', label: '根因' },
            { key: 'title', label: '标题' },
          ]}
          rows={view.knowledge}
          total={view.knowledge.length}
        />
        <Typography.Paragraph>
          已沉淀根因记录 {view.rootCauses.length}{' '}
          条；关闭工单必须包含责任、解决方案和验证证据。
        </Typography.Paragraph>
      </Card>
    </section>
  );
}
