import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Col, Row } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface RowBase {
  id: string;
  status: string;
  version: number;
}
interface ShipmentRow extends RowBase {
  shipmentNo: string;
  totalPallets: string;
  totalVolumeBase: string;
  totalWeightBase: string;
}
interface LoadPlanRow extends RowBase {
  equipmentSelectionId: string;
  loadPlanNo: string;
  shipmentId: string;
}
interface MetricRow extends RowBase {
  compatible: boolean;
  loadPlanId: string;
  palletUtilization: string;
  valueUtilization: string;
  volumeUtilization: string;
  weightUtilization: string;
}
interface RoutePlanRow extends RowBase {
  routePlanNo: string;
  selectedScenarioId: string | null;
  shipmentId: string;
}
interface ScenarioRow extends RowBase {
  lockedStopRefs: string[];
  routePlanId: string;
  score: string;
  scoreBreakdown: Record<string, unknown>;
  stopSequence: string[];
}
interface RefRow extends RowBase {
  shipmentId?: string;
  shipmentItemId?: string;
  transportLegId?: string;
}
interface View {
  equipmentSelections: RefRow[];
  loadPlans: LoadPlanRow[];
  metrics: MetricRow[];
  routePlans: RoutePlanRow[];
  scenarios: ScenarioRow[];
  shipmentItems: RefRow[];
  shipments: ShipmentRow[];
  stops: RefRow[];
  transportLegs: RefRow[];
}

const actions = createActionRegistry<string>([
  {
    allowedStatuses: ['SHIPMENT'],
    id: 'create-load',
    label: '生成配载方案',
    requiredPermissions: ['tms.load.manage'],
  },
  {
    allowedStatuses: ['LOAD_DRAFT'],
    id: 'adjust-load',
    label: '手工拖放重校验',
    requiredPermissions: ['tms.load.manage'],
  },
  {
    allowedStatuses: ['LOAD_DRAFT'],
    id: 'validate-load',
    label: '校验配载',
    requiredPermissions: ['tms.load.publish'],
  },
  {
    allowedStatuses: ['LOAD_VALIDATED'],
    confirmMessage: '确认发布已通过容量和兼容性校验的配载方案？',
    id: 'publish-load',
    label: '发布配载',
    requiredPermissions: ['tms.load.publish'],
  },
  {
    allowedStatuses: ['SHIPMENT'],
    id: 'optimize-route',
    label: '生成多权重路线',
    requiredPermissions: ['tms.route.optimize'],
  },
  {
    allowedStatuses: ['ROUTE_OPTIMIZED'],
    id: 'select-route',
    label: '选择优化方案',
    requiredPermissions: ['tms.route.optimize'],
  },
  {
    allowedStatuses: ['SCENARIO'],
    id: 'reoptimize-lock',
    label: '锁定节点重优化',
    requiredPermissions: ['tms.route.optimize'],
  },
]);

export function LoadRouteOptimizationPanel() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<View>({
    equipmentSelections: [],
    loadPlans: [],
    metrics: [],
    routePlans: [],
    scenarios: [],
    shipmentItems: [],
    shipments: [],
    stops: [],
    transportLegs: [],
  });
  const [shipmentId, setShipmentId] = useState('');
  const [loadId, setLoadId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'tms.optimization.read',
              'tms.load.manage',
              'tms.load.publish',
              'tms.route.optimize',
            ]
          : [],
      ),
    [claims],
  );
  const shipment = view.shipments.find(({ id }) => id === shipmentId);
  const load = view.loadPlans.find(({ id }) => id === loadId);
  const route = view.routePlans.find(({ id }) => id === routeId);
  const scenario = view.scenarios.find(({ id }) => id === scenarioId);
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status:
        id === 'create-load' || id === 'optimize-route'
          ? shipment
            ? 'SHIPMENT'
            : 'NONE'
          : id === 'adjust-load' || id === 'validate-load'
            ? load?.status === 'DRAFT'
              ? 'LOAD_DRAFT'
              : 'NONE'
            : id === 'publish-load'
              ? load?.status === 'VALIDATED'
                ? 'LOAD_VALIDATED'
                : 'NONE'
              : id === 'select-route'
                ? route?.status === 'OPTIMIZED'
                  ? 'ROUTE_OPTIMIZED'
                  : 'NONE'
                : scenario
                  ? 'SCENARIO'
                  : 'NONE',
    }),
  );
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用配载路线工作台');
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
      setView(
        (await request(
          '/api/v1/tms/optimization/workbench',
        )) as unknown as View,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '配载路线查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const routePayload = (parentScenarioId?: string) => ({
    constraintSnapshot: {
      costPerKm: 2,
      shiftEnd: new Date(Date.now() + 16 * 3_600_000).toISOString(),
      shiftStart: new Date(Date.now() + 3_600_000).toISOString(),
    },
    distanceMatrix: {
      'A|B': 40,
      'A|C': 50,
      'B|C': 25,
      'B|D': 45,
      'C|B': 25,
      'C|D': 35,
    },
    ...(parentScenarioId ? { lockedStopRefs: ['B'], parentScenarioId } : {}),
    objectiveWeights: parentScenarioId
      ? [{ cost: 1, distance: 1 }]
      : [
          { cost: 0.8, distance: 0.2, onTime: 1 },
          { cost: 0.2, distance: 0.8, onTime: 2 },
        ],
    speedKph: 60,
    stops: ['A', 'B', 'C', 'D'].map((ref, index) => ({
      locationSnapshot: { code: ref },
      serviceMinutes: 15,
      stopRef: ref,
      stopType: index ? 'DELIVERY' : 'PICKUP',
      windowFrom: new Date(Date.now() + (index + 1) * 3_600_000).toISOString(),
      windowTo: new Date(Date.now() + (index + 8) * 3_600_000).toISOString(),
    })),
  });
  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (
      !decision?.enabled ||
      (decision.confirmMessage && !window.confirm(decision.confirmMessage))
    )
      return;
    try {
      if (actionId === 'create-load' && shipment) {
        const legIds = view.transportLegs
          .filter((leg) => leg.shipmentId === shipment.id)
          .map(({ id }) => id);
        const equipment = view.equipmentSelections.find(({ transportLegId }) =>
          legIds.includes(transportLegId ?? ''),
        );
        if (!equipment) throw new Error('运单缺少设备选择');
        await request('/api/v1/tms/optimization/load-plans', {
          body: JSON.stringify({
            equipmentSelectionId: equipment.id,
            layoutSnapshot: { decks: 1, zones: ['MAIN'] },
            shipmentId: shipment.id,
          }),
          method: 'POST',
        });
      } else if (actionId === 'adjust-load' && load) {
        const item = view.shipmentItems.find(
          ({ shipmentId: itemShipment }) => itemShipment === load.shipmentId,
        );
        if (!item) throw new Error('运单缺少配载项');
        await request(`/api/v1/tms/optimization/load-plans/${load.id}/adjust`, {
          body: JSON.stringify({
            expectedVersion: load.version,
            position: {
              column: 2,
              dangerousAllowed: true,
              temperatureZone: 'COLD',
            },
            shipmentItemId: item.id,
          }),
          method: 'POST',
        });
      } else if (
        (actionId === 'validate-load' || actionId === 'publish-load') &&
        load
      )
        await request(
          `/api/v1/tms/optimization/load-plans/${load.id}/transition`,
          {
            body: JSON.stringify({
              expectedVersion: load.version,
              targetStatus:
                actionId === 'validate-load' ? 'VALIDATED' : 'PUBLISHED',
            }),
            method: 'POST',
          },
        );
      else if (actionId === 'optimize-route' && shipment)
        await request(
          `/api/v1/tms/optimization/shipments/${shipment.id}/routes/optimize`,
          { body: JSON.stringify(routePayload()), method: 'POST' },
        );
      else if (actionId === 'select-route' && route) {
        const candidate = view.scenarios
          .filter(
            ({ routePlanId, status }) =>
              routePlanId === route.id && status === 'PROPOSED',
          )
          .sort((a, b) => Number(b.score) - Number(a.score))[0];
        if (!candidate) throw new Error('路线没有可选方案');
        await request(
          `/api/v1/tms/optimization/route-plans/${route.id}/scenarios/${candidate.id}/select`,
          {
            body: JSON.stringify({ expectedVersion: route.version }),
            method: 'POST',
          },
        );
      } else if (actionId === 'reoptimize-lock' && scenario && shipment)
        await request(
          `/api/v1/tms/optimization/shipments/${shipment.id}/routes/optimize`,
          { body: JSON.stringify(routePayload(scenario.id)), method: 'POST' },
        );
      setNotice('配载或路线动作已完成，计算轨迹与约束解释已保存');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '配载路线动作失败');
    }
  }
  return (
    <Card title="配载利用率、路线站点与优化方案">
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="LoadPlan 与实时 UtilizationMetrics">
            <DataGrid
              columns={[
                { key: 'shipmentNo', label: '运单号' },
                { key: 'totalWeightBase', label: '重量' },
                { key: 'totalVolumeBase', label: '体积' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setShipmentId(ids.at(-1) ?? '')}
              page={1}
              pageSize={100}
              rows={view.shipments}
              selectedIds={shipmentId ? [shipmentId] : []}
              total={view.shipments.length}
            />
            <DataGrid
              columns={[
                { key: 'loadPlanNo', label: '配载号' },
                {
                  key: 'status',
                  label: '状态',
                  render: (value) => <StatusBadge status={String(value)} />,
                },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setLoadId(ids.at(-1) ?? '')}
              page={1}
              pageSize={100}
              rows={view.loadPlans}
              selectedIds={loadId ? [loadId] : []}
              total={view.loadPlans.length}
            />
            <DataGrid
              columns={[
                { key: 'weightUtilization', label: '重量%' },
                { key: 'volumeUtilization', label: '体积%' },
                { key: 'palletUtilization', label: '托位%' },
                { key: 'valueUtilization', label: '价值%' },
                { key: 'compatible', label: '兼容' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={100}
              rows={view.metrics}
              selectedIds={[]}
              total={view.metrics.length}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="RoutePlan 与可解释 OptimizationScenario">
            <DataGrid
              columns={[
                { key: 'routePlanNo', label: '路线号' },
                {
                  key: 'status',
                  label: '状态',
                  render: (value) => <StatusBadge status={String(value)} />,
                },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setRouteId(ids.at(-1) ?? '')}
              page={1}
              pageSize={100}
              rows={view.routePlans}
              selectedIds={routeId ? [routeId] : []}
              total={view.routePlans.length}
            />
            <DataGrid
              columns={[
                { key: 'score', label: '综合得分' },
                {
                  key: 'stopSequence',
                  label: '站点序列',
                  render: (value) =>
                    Array.isArray(value) ? value.join('→') : '',
                },
                {
                  key: 'lockedStopRefs',
                  label: '锁定站点',
                  render: (value) =>
                    Array.isArray(value) ? value.join(',') : '',
                },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setScenarioId(ids.at(-1) ?? '')}
              page={1}
              pageSize={300}
              rows={view.scenarios}
              selectedIds={scenarioId ? [scenarioId] : []}
              total={view.scenarios.length}
            />
          </Card>
        </Col>
      </Row>
    </Card>
  );
}
