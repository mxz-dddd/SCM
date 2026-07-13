import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Button, Card, Input, Select, Space, Typography } from 'antd';
import { useSessionStore } from './session-store';

interface RuleSetRow {
  code: string;
  id: string;
  name: string;
  scenario: string;
  status: string;
  version: number;
  versionNumber: number;
}

interface TraceRow {
  id: string;
  mode: string;
  outcome: string;
  ruleSetCode: string;
  ruleSetVersionNumber: number;
  scenario: string;
}

const registry = createActionRegistry<string>([
  {
    allowedStatuses: ['DRAFT'],
    id: 'publish',
    label: '发布规则版本',
    requiredPermissions: ['platform.rule.write'],
  },
  {
    id: 'simulate',
    label: '模拟求值',
    requiredPermissions: ['platform.rule.simulate'],
  },
]);

export function RuleEngineWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [ruleSets, setRuleSets] = useState<readonly RuleSetRow[]>([]);
  const [traces, setTraces] = useState<readonly TraceRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [code, setCode] = useState('DEFAULT_ALLOCATION');
  const [scenario, setScenario] = useState('ALLOCATION');
  const [minimumCapacity, setMinimumCapacity] = useState('100');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? claims.accountKind === 'USER'
            ? ['platform.rule.read', 'platform.rule.simulate']
            : [
                'platform.rule.read',
                'platform.rule.write',
                'platform.rule.simulate',
                'platform.rule.evaluate',
              ]
          : [],
      ),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用规则中心');
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
    try {
      const [sets, traceRows] = await Promise.all([
        request('/api/v1/platform/rules/sets'),
        request('/api/v1/platform/rules/traces'),
      ]);
      setRuleSets(sets as unknown as RuleSetRow[]);
      setTraces(traceRows as unknown as TraceRow[]);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '规则数据查询失败');
    }
  }, [accessToken, claims, request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = ruleSets.find(({ id }) => id === selectedIds[0]);
  const decisions = ['publish', 'simulate'].map((id) =>
    registry.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selected?.status ?? 'NONE',
    }),
  );

  async function createRuleSet() {
    try {
      await request('/api/v1/platform/rules/sets', {
        body: JSON.stringify({
          code,
          name: `${scenario} 默认规则`,
          rules: [
            {
              code: 'CAPACITY_REQUIRED',
              conditions: [
                {
                  field: 'capacity',
                  operator: 'LT',
                  source: 'CANDIDATE',
                  value: Number(minimumCapacity),
                },
              ],
              name: '排除容量不足候选',
              priority: 10,
              result: { effect: 'EXCLUDE', reason: 'CAPACITY_INSUFFICIENT' },
            },
            {
              code: 'LOW_COST_SCORE',
              conditions: [
                { field: 'cost', operator: 'EXISTS', source: 'CANDIDATE' },
              ],
              name: '候选基础评分',
              priority: 20,
              result: { effect: 'INCLUDE', score: 10 },
            },
          ],
          scenario,
        }),
        method: 'POST',
      });
      setNotice('规则集草稿已创建');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '规则集创建失败');
    }
  }

  async function publish() {
    if (!selected || selected.status !== 'DRAFT') return;
    try {
      await request(`/api/v1/platform/rules/sets/${selected.id}/publish`, {
        body: JSON.stringify({ expectedVersion: selected.version }),
        method: 'POST',
      });
      setNotice('规则版本已发布');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '规则发布失败');
    }
  }

  async function simulate() {
    const target =
      selected?.status === 'PUBLISHED'
        ? selected
        : ruleSets.find(
            (item) => item.scenario === scenario && item.status === 'PUBLISHED',
          );
    if (!target) {
      setError('请先选择或发布同场景规则集');
      return;
    }
    try {
      const result = (await request('/api/v1/platform/rules/simulate', {
        body: JSON.stringify({
          candidates: [
            { capacity: 50, cost: 5, id: 'candidate-low' },
            { capacity: 200, cost: 10, id: 'candidate-ready' },
          ],
          facts: { businessRef: 'SIMULATION' },
          ruleSetCode: target.code,
          scenario: target.scenario,
        }),
        method: 'POST',
      })) as unknown as {
        decision: { selectedCandidateId: string | null };
        outcome: string;
      };
      setNotice(
        `模拟 ${result.outcome}，选择 ${result.decision.selectedCandidateId ?? '无候选'}`,
      );
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '模拟执行失败');
    }
  }

  return (
    <section className="rule-engine-workbench">
      <Typography.Title level={2}>规则引擎与决策追踪</Typography.Title>
      <Typography.Paragraph>
        为分配、上架、波次、承运商、时隙与计费提供同一优先级求值接口和完整解释。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}

      <Card title="RuleSet 版本">
        <QueryPanel
          fields={[{ label: '场景', name: 'scenario', quick: true }]}
          onQuery={(values) => values.scenario && setScenario(values.scenario)}
          onReset={() => setScenario('ALLOCATION')}
        />
        <Space wrap>
          <Input
            aria-label="规则集代码"
            onChange={(event) => setCode(event.target.value)}
            value={code}
          />
          <Select
            aria-label="规则场景"
            onChange={setScenario}
            options={[
              'ALLOCATION',
              'PUTAWAY',
              'WAVE',
              'CARRIER_SELECTION',
              'SLOT',
              'CHARGING',
            ].map((value) => ({ label: value, value }))}
            value={scenario}
          />
          <Input
            aria-label="最小容量"
            onChange={(event) => setMinimumCapacity(event.target.value)}
            value={minimumCapacity}
          />
          <Button
            disabled={!permissions.has('platform.rule.write')}
            onClick={() => void createRuleSet()}
          >
            新建规则版本草稿
          </Button>
        </Space>
        <CommandBar
          actions={decisions}
          onAction={({ id }) =>
            id === 'publish' ? void publish() : void simulate()
          }
        />
        <DataGrid
          columns={[
            { key: 'code', label: '代码' },
            { key: 'scenario', label: '场景' },
            { key: 'versionNumber', label: '规则版本' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))}
          page={1}
          pageSize={300}
          rows={ruleSets}
          selectedIds={selectedIds}
          total={ruleSets.length}
        />
      </Card>

      <Card title="EvaluationTrace 命中与排除解释">
        <DataGrid
          columns={[
            { key: 'scenario', label: '场景' },
            { key: 'ruleSetCode', label: '规则集' },
            { key: 'ruleSetVersionNumber', label: '版本' },
            { key: 'mode', label: '模式' },
            {
              key: 'outcome',
              label: '结果',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={200}
          rows={traces}
          total={traces.length}
        />
      </Card>
    </section>
  );
}
