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

interface FactRow {
  businessRef: string;
  chargeType: string;
  currency: string;
  eventId: string;
  id: string;
  occurredAt: string;
  quantityBase: string;
  quantityBaseUom: string;
  serviceType: string;
  sourceDomain: string;
  status: 'ACTIVE';
}

interface MatchRow {
  baseRate: string | null;
  chargeFactId: string;
  currency: string;
  factOccurredAt: string;
  id: string;
  priority: number | null;
  rateVersionNumber: number | null;
  rateVersionRef: string | null;
  status: 'MATCHED' | 'UNMATCHED';
}

interface ExceptionRow {
  chargeFactId: string;
  code: string;
  createdAt: string;
  id: string;
  reason: string;
  status: 'OPEN' | 'RESOLVED';
}

interface BillingView {
  corrections: readonly { chargeFactId: string; id: string }[];
  exceptions: readonly ExceptionRow[];
  facts: readonly FactRow[];
  matches: readonly MatchRow[];
}

const actions = createActionRegistry<'ACTIVE' | 'NONE'>([
  {
    id: 'receive',
    label: '接收计费事实',
    requiredPermissions: ['billing.fact.ingest'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    confirmMessage: '原计费事实不可覆盖，将追加一条更正事实并重新匹配费率。',
    id: 'correct',
    label: '追加事实更正',
    requiredPermissions: ['billing.fact.correct'],
  },
]);

export function BillingFactWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<BillingView>({
    corrections: [],
    exceptions: [],
    facts: [],
    matches: [],
  });
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const selected = view.facts.find(({ id }) => id === selectedIds[0]);
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? ['billing.fact.read', 'billing.fact.ingest', 'billing.fact.correct']
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
  const facts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return view.facts;
    return view.facts.filter((fact) =>
      [fact.businessRef, fact.chargeType, fact.eventId, fact.serviceType].some(
        (value) => value.toLowerCase().includes(normalized),
      ),
    );
  }, [query, view.facts]);

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用计费事实工作台');
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
      const body = (await response.json()) as {
        code?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '请求失败'}`,
        );
      return body;
    },
    [accessToken, claims],
  );

  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    try {
      const result = (await request(
        '/api/v1/billing/workbench',
      )) as unknown as BillingView;
      setView(result);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '计费事实查询失败');
    }
  }, [accessToken, claims, request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (!decision?.enabled) return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage))
      return;
    try {
      if (actionId === 'receive') {
        const now = new Date();
        await request('/api/v1/billing/facts', {
          body: JSON.stringify({
            aggregateRef: `DEMO-SHIPMENT-${now.getTime()}`,
            businessRef: `DEMO-BILLING-${now.getTime()}`,
            chargeType: 'TRANSPORT_LINEHAUL',
            currency: 'CNY',
            dimensions: { equipmentType: 'VAN', route: 'SHA-SUZ' },
            eventId: crypto.randomUUID(),
            occurredAt: now.toISOString(),
            partyRef: '00000000-0000-4000-8000-000000000001',
            quantityBase: '1000',
            quantityBaseUom: 'KG',
            quantityOriginal: '1000',
            quantityUom: 'KG',
            routeRef: 'SHA-SUZ',
            serviceType: 'LINEHAUL',
            sourceDomain: 'TMS',
            sourceEventType: 'shipment.delivered.v1',
            sourceSnapshot: { channel: 'WORKBENCH', demo: true },
          }),
          method: 'POST',
        });
        setNotice('计费事实已去重接收，并按发生时点完成费率匹配');
      } else if (selected) {
        await request(`/api/v1/billing/facts/${selected.id}/corrections`, {
          body: JSON.stringify({
            corrected: {
              quantityBase: String(Number(selected.quantityBase) + 1),
              quantityOriginal: String(Number(selected.quantityBase) + 1),
            },
            reason: '工作台复核计量后追加更正',
          }),
          method: 'POST',
        });
        setNotice('更正事实已追加，原事实与原 MatchTrace 保持不变');
      }
      setSelectedIds([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '计费事实动作失败');
    }
  }

  return (
    <section className="billing-fact-workbench">
      <Typography.Title level={2}>计费事实与费率匹配</Typography.Title>
      <Typography.Paragraph>
        按事件与业务收费键双重去重接收 WMS、TMS、AMS
        事实；原事实不可覆盖，更正追加留痕，费率按业务发生时点与多维优先级匹配。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <Card title="ChargeFact 与 FactCorrection">
        <QueryPanel
          fields={[
            {
              label: '业务引用 / 收费类型 / 事件',
              name: 'query',
              quick: true,
            },
          ]}
          onQuery={(values) => setQuery(values.query ?? '')}
          onReset={() => setQuery('')}
        />
        <CommandBar
          actions={decisions}
          onAction={(action) => void execute(action.id)}
        />
        <DataGrid
          columns={[
            { key: 'businessRef', label: '业务引用' },
            { key: 'chargeType', label: '收费类型' },
            { key: 'sourceDomain', label: '来源域' },
            { key: 'quantityBase', label: '基础数量' },
            { key: 'quantityBaseUom', label: '基础单位' },
            { key: 'serviceType', label: '服务类型' },
            { key: 'currency', label: '币种' },
            { key: 'occurredAt', label: '业务发生时点' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))}
          page={1}
          pageSize={50}
          rows={facts}
          selectedIds={selectedIds}
          total={facts.length}
        />
      </Card>
      <Card title="RateMatch 与 MatchTrace">
        <DataGrid
          columns={[
            { key: 'chargeFactId', label: '事实 ID' },
            {
              key: 'status',
              label: '匹配状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'rateVersionRef', label: '费率版本' },
            { key: 'rateVersionNumber', label: '版本号' },
            { key: 'priority', label: '优先级' },
            { key: 'baseRate', label: '基础费率' },
            { key: 'currency', label: '币种' },
            { key: 'factOccurredAt', label: '匹配时点' },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={50}
          rows={view.matches}
          total={view.matches.length}
        />
      </Card>
      <Card title="零命中计费异常">
        <DataGrid
          columns={[
            { key: 'chargeFactId', label: '事实 ID' },
            { key: 'code', label: '异常码' },
            { key: 'reason', label: '原因' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'createdAt', label: '创建时间' },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={50}
          rows={view.exceptions}
          total={view.exceptions.length}
        />
      </Card>
    </section>
  );
}
