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

interface VersionedRow {
  id: string;
  status: string;
  version: number;
}

interface RouteRow extends VersionedRow {
  jobRunId: string | null;
}

interface RouteResultRow extends VersionedRow {
  explanation: string;
  feasibility: string;
  optimizationId: string;
  solverVersion: string;
}

interface LoadRow extends VersionedRow {
  explanation: string;
  jobRunId: string | null;
}

interface ForecastRow extends VersionedRow {
  modelVersion: string;
  seriesKey: string;
  versionNumber: number;
}

interface RecommendationRow extends VersionedRow {
  explanation: string;
  productId: string;
  warehouseId: string;
}

interface ScenarioRow extends VersionedRow {
  jobRunId: string | null;
  name: string;
  scenarioNo: string;
}

interface AiView {
  forecasts: readonly ForecastRow[];
  loads: readonly LoadRow[];
  recommendations: readonly RecommendationRow[];
  routeResults: readonly RouteResultRow[];
  routes: readonly RouteRow[];
  scenarios: readonly ScenarioRow[];
  simulationResults: readonly VersionedRow[];
}

const emptyView: AiView = {
  forecasts: [],
  loads: [],
  recommendations: [],
  routeResults: [],
  routes: [],
  scenarios: [],
  simulationResults: [],
};

const permissions = [
  'control.ai.read',
  'control.ai.route.optimize',
  'control.ai.load.optimize',
  'control.ai.load.confirm',
  'control.ai.load.feedback',
  'control.ai.forecast.manage',
  'control.ai.forecast.publish',
  'control.ai.forecast.feedback',
  'control.ai.inventory.recommend',
  'control.ai.inventory.decide',
  'control.ai.network.manage',
  'control.ai.network.run',
  'control.ai.network.export',
] as const;

const actions = createActionRegistry<string>([
  { id: 'refresh', label: '刷新 AI 工作台', requiredPermissions: ['control.ai.read'] },
  { id: 'route', label: '提交车辆路径优化', requiredPermissions: ['control.ai.route.optimize'] },
  { id: 'load', label: '提交装载优化', requiredPermissions: ['control.ai.load.optimize'] },
  { allowedStatuses: ['PROPOSED'], id: 'confirmLoad', label: '人工确认装载建议', requiredPermissions: ['control.ai.load.confirm'] },
  { allowedStatuses: ['CONFIRMED'], id: 'feedbackLoad', label: '反馈实际装载偏差', requiredPermissions: ['control.ai.load.feedback'] },
  { id: 'forecast', label: '生成需求预测版本', requiredPermissions: ['control.ai.forecast.manage'] },
  { allowedStatuses: ['DRAFT'], id: 'publishForecast', label: '发布预测版本', requiredPermissions: ['control.ai.forecast.publish'] },
  { allowedStatuses: ['PUBLISHED'], id: 'recommend', label: '生成补货建议', requiredPermissions: ['control.ai.inventory.recommend'] },
  { id: 'scenario', label: '创建网络情景', requiredPermissions: ['control.ai.network.manage'] },
  { allowedStatuses: ['DRAFT', 'FAILED'], id: 'runScenario', label: '运行网络模拟', requiredPermissions: ['control.ai.network.run'] },
  { allowedStatuses: ['COMPLETED'], id: 'exportScenario', label: '导出情景比较', requiredPermissions: ['control.ai.network.export'] },
]);

const productId = '10000000-0000-4000-8000-000000000301';
const warehouseId = '10000000-0000-4000-8000-000000000401';
const packageSpecVersionId = '10000000-0000-4000-8000-000000000501';

export function AiOptimizationWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<AiView>(emptyView);
  const [selectedLoadIds, setSelectedLoadIds] = useState<readonly string[]>([]);
  const [selectedForecastIds, setSelectedForecastIds] = useState<readonly string[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<readonly string[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const selectedLoad = view.loads.find(({ id }) => id === selectedLoadIds[0]);
  const selectedForecast = view.forecasts.find(({ id }) => id === selectedForecastIds[0]);
  const selectedScenario = view.scenarios.find(({ id }) => id === selectedScenarioIds[0]);
  const actionStatus = selectedLoad?.status ?? selectedForecast?.status ?? selectedScenario?.status ?? 'NONE';
  const granted = useMemo(() => new Set(claims ? permissions : []), [claims]);
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, { dataScopeAllowed: true, permissions: granted, status: actionStatus }),
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用 AI 优化工作台');
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
      const body = (await response.json()) as AiView & { code?: string; message?: string };
      if (!response.ok) throw new Error(`${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? 'AI 优化请求失败'}`);
      return body;
    },
    [accessToken, claims],
  );
  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    setView(await request('/api/v1/control/ai/workbench'));
    setError(undefined);
  }, [accessToken, claims, request]);
  useEffect(() => {
    void refresh().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'AI 工作台查询失败'));
  }, [refresh]);

  async function post(path: string, body: unknown) {
    return request(path, { body: JSON.stringify(body), method: 'POST' });
  }

  async function execute(actionId: string) {
    if (!decisions.find(({ id }) => id === actionId)?.enabled) return;
    const organizationRef = claims?.organizationIds[0] ?? 'DEMO-ORGANIZATION';
    try {
      if (actionId === 'route') {
        await post('/api/v1/control/ai/route-optimizations', {
          distanceMatrix: [[0, 10, 20], [10, 0, 10], [20, 10, 0]],
          durationMatrix: [[0, 10, 20], [10, 0, 10], [20, 10, 0]],
          locations: [{ id: 'DEPOT' }, { id: 'CUSTOMER-A' }, { id: 'CUSTOMER-B' }],
          objective: { mode: 'MIN_DISTANCE_AND_VEHICLES' },
          organizationRef,
          stops: [
            { demand: 4, id: 'STOP-A', locationIndex: 1, serviceMinutes: 5, windowEndMinutes: 120, windowStartMinutes: 0 },
            { demand: 6, id: 'STOP-B', locationIndex: 2, serviceMinutes: 5, windowEndMinutes: 120, windowStartMinutes: 0 },
          ],
          vehicles: [{ capacity: 10, fixedCost: 5, id: 'VEHICLE-1', maxMinutes: 180 }],
        });
      } else if (actionId === 'load') {
        await post('/api/v1/control/ai/load-optimizations', {
          containers: [{ bayCount: 6, id: 'TRUCK-1', maxCgOffset: 300, maxVolume: 1000, maxWeight: 1000 }],
          items: [
            { id: 'PALLET-A', incompatibleWith: [], unloadSequence: 1, volume: 100, weight: 200 },
            { id: 'PALLET-B', incompatibleWith: [], unloadSequence: 2, volume: 120, weight: 180 },
          ],
          organizationRef,
        });
      } else if (actionId === 'confirmLoad' && selectedLoad) {
        await post(`/api/v1/control/ai/load-optimizations/${selectedLoad.id}/decision`, { decision: 'CONFIRMED', expectedVersion: selectedLoad.version, reason: '计划员复核硬约束与卸货顺序后确认' });
      } else if (actionId === 'feedbackLoad' && selectedLoad) {
        await post(`/api/v1/control/ai/load-optimizations/${selectedLoad.id}/deviations`, { actual: { movedItems: [], note: '现场装载与建议一致' }, expectedVersion: selectedLoad.version });
      } else if (actionId === 'forecast') {
        const today = new Date();
        const start = new Date(today.getTime() - 6 * 86_400_000);
        await post('/api/v1/control/ai/forecasts', {
          confidenceLevel: 0.95,
          dimensions: { productId, region: 'EAST' },
          granularity: 'DAY',
          history: Array.from({ length: 7 }, (_, index) => ({
            at: new Date(start.getTime() + index * 86_400_000).toISOString(),
            baseQty: String(90 + index * 3),
            baseUom: 'EA',
            packageSpecVersionId,
            qty: String(90 + index * 3),
            uom: 'EA',
          })),
          horizon: 14,
          organizationRef,
          trainingFrom: start.toISOString(),
          trainingTo: today.toISOString(),
        });
      } else if (actionId === 'publishForecast' && selectedForecast) {
        await post(`/api/v1/control/ai/forecasts/${selectedForecast.id}/publish`, { expectedVersion: selectedForecast.version });
      } else if (actionId === 'recommend' && selectedForecast) {
        await post('/api/v1/control/ai/inventory-recommendations', {
          currentInventory: { baseQty: '300', baseUom: 'EA', packageSpecVersionId, qty: '300', shelfLifeDays: 180, uom: 'EA' },
          forecastId: selectedForecast.id,
          leadTimeDays: 3,
          organizationRef,
          productId,
          serviceLevel: 0.95,
          warehouseId,
        });
      } else if (actionId === 'scenario') {
        await post('/api/v1/control/ai/network-scenarios', {
          baselineSnapshot: {
            carrierCapacityBaseQty: '1000',
            demandBaseQty: '900',
            variableCost: { amount: '2.50', currency: 'CNY' },
            warehouses: [{ capacityBaseQty: '1000', fixedCost: { amount: '5000', currency: 'CNY' }, id: warehouseId, open: true, slaMinutes: 480 }],
          },
          changes: { demandMultiplier: 1.2, slaTargetMinutes: 420 },
          name: '需求增长 20% 情景',
          organizationRef,
          scenarioNo: `SCENARIO-${Date.now()}`,
        });
      } else if (actionId === 'runScenario' && selectedScenario) {
        await post(`/api/v1/control/ai/network-scenarios/${selectedScenario.id}/run`, { expectedVersion: selectedScenario.version });
      } else if (actionId === 'exportScenario' && selectedScenario) {
        await request(`/api/v1/control/ai/network-scenarios/${selectedScenario.id}/export`);
      }
      setNotice('动作已受理；求解任务可通过 jobId 跟踪，结果保留版本、约束与解释。');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'AI 优化动作失败');
    }
  }

  const filtered = <T extends VersionedRow>(rows: readonly T[]) =>
    statusFilter ? rows.filter(({ status }) => status === statusFilter) : rows;
  const grid = { onPageChange: () => undefined, page: 1, pageSize: 50 } as const;
  const statusColumn = { key: 'status', label: '状态', render: (value: unknown) => <StatusBadge status={String(value)} /> } as const;

  return (
    <section className="ai-optimization-workbench">
      <Typography.Title level={2}>AI 优化与情景模拟</Typography.Title>
      <Typography.Paragraph>
        路径与装载通过固定 OR-Tools sidecar 求解；领域层只传约束快照并保存解释。预测、补货与网络情景均版本化，补货建议不会直接修改库存。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <QueryPanel
        fields={[{ label: '状态', name: 'status', quick: true }]}
        onQuery={(values) => setStatusFilter(String(values.status ?? '').trim().toUpperCase())}
        onReset={() => setStatusFilter('')}
      />
      <CommandBar actions={decisions} onAction={(action) => void execute(action.id)} />

      <Card title="车辆路径：时间窗、容量、工时与可解释结果">
        <DataGrid {...grid} columns={[{ key: 'jobRunId', label: '异步 jobId' }, statusColumn]} rows={filtered(view.routes)} total={filtered(view.routes).length} />
        <DataGrid {...grid} columns={[{ key: 'solverVersion', label: '求解器版本' }, { key: 'feasibility', label: '可行性' }, { key: 'explanation', label: '约束解释' }]} rows={view.routeResults} total={view.routeResults.length} />
      </Card>

      <Card title="装载建议：人工确认与实际偏差反馈">
        <DataGrid {...grid} columns={[{ key: 'jobRunId', label: '异步 jobId' }, { key: 'explanation', label: '建议解释' }, statusColumn]} onSelectionChange={(ids) => setSelectedLoadIds(ids.slice(-1))} rows={filtered(view.loads)} selectedIds={selectedLoadIds} total={filtered(view.loads).length} />
      </Card>

      <Card title="需求预测：训练窗口、版本与置信区间">
        <DataGrid {...grid} columns={[{ key: 'versionNumber', label: '预测版本' }, { key: 'modelVersion', label: '模型版本' }, { key: 'seriesKey', label: '序列键' }, statusColumn]} onSelectionChange={(ids) => setSelectedForecastIds(ids.slice(-1))} rows={filtered(view.forecasts)} selectedIds={selectedForecastIds} total={filtered(view.forecasts).length} />
      </Card>

      <Card title="库存策略建议：只建议、不直接改库存">
        <DataGrid {...grid} columns={[{ key: 'warehouseId', label: '仓库 ID' }, { key: 'productId', label: '商品 ID' }, { key: 'explanation', label: '策略解释' }, statusColumn]} rows={filtered(view.recommendations)} total={filtered(view.recommendations).length} />
      </Card>

      <Card title="供应链网络：独立基线、情景比较与导出">
        <DataGrid {...grid} columns={[{ key: 'scenarioNo', label: '情景号' }, { key: 'name', label: '情景名称' }, { key: 'jobRunId', label: '异步 jobId' }, statusColumn]} onSelectionChange={(ids) => setSelectedScenarioIds(ids.slice(-1))} rows={filtered(view.scenarios)} selectedIds={selectedScenarioIds} total={filtered(view.scenarios).length} />
        <Typography.Paragraph>已固化不可变模拟结果 {view.simulationResults.length} 份。</Typography.Paragraph>
      </Card>
    </section>
  );
}
