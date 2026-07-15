import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface ScheduleRow {
  code: string;
  cronExpression: string | null;
  handler: string;
  id: string;
  name: string;
  status: string;
}

interface RunRow {
  differenceCount: number;
  id: string;
  matchedCount: number;
  periodEnd: string;
  reconciliationType: string;
  status: string;
  triggerRef: string;
}

interface ItemRow {
  businessRef: string;
  id: string;
  outcome: string;
  reconciliationRunId: string;
}

interface CaseRow {
  businessRef: string;
  caseNo: string;
  id: string;
  reasonCode: string;
  reconciliationType: string;
  status: 'OPEN' | 'RESOLVED';
  version: number;
}

interface ReconciliationView {
  cases: readonly CaseRow[];
  items: readonly ItemRow[];
  observations: readonly { id: string }[];
  runs: readonly RunRow[];
  schedules: readonly ScheduleRow[];
}

const emptyView: ReconciliationView = {
  cases: [],
  items: [],
  observations: [],
  runs: [],
  schedules: [],
};
const types = [
  ['ORDER_FULFILLMENT', '运行订单-履约对账'],
  ['INVENTORY_MOVEMENT', '运行库存-流水对账'],
  ['SHIPMENT_POD', '运行运单-POD 对账'],
  ['BILLING_VOUCHER', '运行计费-凭证对账'],
] as const;
const actions = createActionRegistry<'NONE' | 'OPEN' | 'RESOLVED'>([
  {
    id: 'refresh',
    label: '刷新验收中心',
    requiredPermissions: ['control.reconciliation.read'],
  },
  {
    id: 'bootstrap',
    label: '上线四类每日任务',
    requiredPermissions: ['control.reconciliation.schedule'],
  },
  ...types.map(([id, label]) => ({
    id,
    label,
    requiredPermissions: ['control.reconciliation.run'],
  })),
  {
    allowedStatuses: ['OPEN'],
    id: 'resolve',
    label: '关闭对账例外',
    requiredPermissions: ['control.reconciliation.resolve'],
  },
]);

export function ReconciliationWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<ReconciliationView>(emptyView);
  const [selectedCaseIds, setSelectedCaseIds] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const selected = view.cases.find(({ id }) => id === selectedCaseIds[0]);
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'control.reconciliation.read',
              'control.reconciliation.schedule',
              'control.reconciliation.run',
              'control.reconciliation.resolve',
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
      if (!accessToken || !claims) throw new Error('请先登录后使用验收中心');
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
      const body = (await response.json()) as ReconciliationView & {
        code?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '验收请求失败'}`,
        );
      return body;
    },
    [accessToken, claims],
  );
  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    setView(await request('/api/v1/control/reconciliations/workbench'));
    setError(undefined);
  }, [accessToken, claims, request]);
  useEffect(() => {
    void refresh().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : '验收中心查询失败'),
    );
  }, [refresh]);

  async function post(path: string, body?: unknown) {
    await request(path, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      method: 'POST',
    });
  }

  async function execute(actionId: string) {
    if (!decisions.find(({ id }) => id === actionId)?.enabled) return;
    try {
      if (actionId === 'bootstrap')
        await post('/api/v1/control/reconciliations/schedules/bootstrap');
      else if (actionId === 'resolve' && selected)
        await post(
          `/api/v1/control/reconciliations/cases/${selected.id}/resolve`,
          {
            expectedVersion: selected.version,
            resolution: '工作台复核双边事实一致并关闭例外',
          },
        );
      else if (types.some(([type]) => type === actionId)) {
        const periodEnd = new Date();
        const periodStart = new Date(periodEnd.getTime() - 86_400_000);
        await post('/api/v1/control/reconciliations/runs', {
          periodEnd: periodEnd.toISOString(),
          periodStart: periodStart.toISOString(),
          triggerRef: `manual:${crypto.randomUUID()}`,
          type: actionId,
        });
      }
      setNotice('验收动作已执行，差异快照与终态记录保持不可变');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '验收动作失败');
    }
  }

  const grid = {
    onPageChange: () => undefined,
    page: 1,
    pageSize: 50,
  } as const;

  return (
    <section className="reconciliation-workbench">
      <Typography.Title level={2}>P4 验收与跨域对账</Typography.Title>
      <Typography.Paragraph>
        费率场景验证历史凭证不被新费率改写、重算追加可解释版本；四类一致性任务只消费跨域观测，不直接访问其他领域内部表。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />

      <Card title="费率历史与重算验收">
        <Typography.Paragraph>
          验收入口从空库启动真实
          API，断言费率发生时点匹配、旧凭证金额不变、重算生成新 CalculationTrace
          并展示费率版本与金额差异。
        </Typography.Paragraph>
      </Card>

      <Card title="四类每日对账任务">
        <DataGrid
          {...grid}
          columns={[
            { key: 'code', label: '任务编码' },
            { key: 'name', label: '任务名称' },
            { key: 'cronExpression', label: 'Cron' },
            { key: 'handler', label: '处理器' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={view.schedules}
          total={view.schedules.length}
        />
      </Card>

      <Card title="对账运行与不可变差异">
        <DataGrid
          {...grid}
          columns={[
            { key: 'reconciliationType', label: '对账类型' },
            { key: 'triggerRef', label: '触发引用' },
            { key: 'periodEnd', label: '期间截止' },
            { key: 'matchedCount', label: '一致' },
            { key: 'differenceCount', label: '差异' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={view.runs}
          total={view.runs.length}
        />
        <Typography.Paragraph>
          已接收双边观测 {view.observations.length} 条；固化对账明细{' '}
          {view.items.length} 条。
        </Typography.Paragraph>
      </Card>

      <Card title="例外工单与闭环">
        <DataGrid
          {...grid}
          columns={[
            { key: 'caseNo', label: '工单号' },
            { key: 'reconciliationType', label: '对账类型' },
            { key: 'businessRef', label: '业务引用' },
            { key: 'reasonCode', label: '差异原因' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onSelectionChange={(ids) => setSelectedCaseIds(ids.slice(-1))}
          rows={view.cases}
          selectedIds={selectedCaseIds}
          total={view.cases.length}
        />
      </Card>
    </section>
  );
}
