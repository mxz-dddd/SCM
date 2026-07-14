import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Col, Row } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface BatchRow {
  id: string;
  batchNo: string;
  planningDate: string;
  regionCode: string;
  status: string;
  version: number;
}
interface LockRow {
  id: string;
  planningBatchId: string;
  transportOrderId: string;
  plannerId: string;
  status: string;
  version: number;
}
interface PlanRow {
  id: string;
  planNo: string;
  planningBatchId: string;
  status: string;
  version: number;
}
interface ShipmentRow {
  id: string;
  shipmentNo: string;
  mode: string;
  status: string;
  totalWeightBase: string;
  totalVolumeBase: string;
}
interface LegRow {
  carrierRef: string | null;
  id: string;
  mode: string;
  sequence: number;
  shipmentId: string;
  status: string;
}
interface PoolOrder {
  destinationAddressSnapshot: Record<string, unknown>;
  id: string;
  originAddressSnapshot: Record<string, unknown>;
  packagingSnapshot: Record<string, unknown>;
  poolStatus: string;
  requirementSnapshot?: Record<string, unknown>;
  serviceLevel: string;
  status: string;
  temperatureMax: string | null;
  temperatureMin: string | null;
  version: number;
  volumeBase: string;
  weightBase: string;
}
interface PlanningView {
  batches: BatchRow[];
  legs: LegRow[];
  locks: LockRow[];
  orders: PoolOrder[];
  plans: PlanRow[];
  shipments: ShipmentRow[];
}

const actions = createActionRegistry<string>([
  {
    id: 'create-batch',
    label: '新建计划批次',
    requiredPermissions: ['tms.planning.manage'],
  },
  {
    allowedStatuses: ['DRAFT', 'PLANNING'],
    id: 'claim-order',
    label: '领取订单',
    requiredPermissions: ['tms.planning.claim'],
  },
  {
    allowedStatuses: ['LOCK_ACTIVE'],
    id: 'release-lock',
    label: '释放领取锁',
    requiredPermissions: ['tms.planning.claim'],
  },
  {
    allowedStatuses: ['PLANNING'],
    id: 'build-plan',
    label: '构建合拆运计划',
    requiredPermissions: ['tms.planning.manage'],
  },
  {
    allowedStatuses: ['PLAN_DRAFT'],
    id: 'validate-plan',
    label: '校验计划与设备',
    requiredPermissions: ['tms.planning.manage'],
  },
  {
    allowedStatuses: ['PLAN_VALIDATED'],
    confirmMessage: '发布前将再次校验数量守恒、多段节点顺序与设备容量。',
    id: 'publish-plan',
    label: '发布运输计划',
    requiredPermissions: ['tms.planning.publish'],
  },
]);

export function TransportPlanningPanel() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<PlanningView>({
    batches: [],
    legs: [],
    locks: [],
    orders: [],
    plans: [],
    shipments: [],
  });
  const [batchId, setBatchId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [lockId, setLockId] = useState('');
  const [planId, setPlanId] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'tms.planning.read',
              'tms.planning.manage',
              'tms.planning.claim',
              'tms.planning.publish',
            ]
          : [],
      ),
    [claims],
  );
  const selectedBatch = view.batches.find(({ id }) => id === batchId);
  const selectedOrder = view.orders.find(({ id }) => id === orderId);
  const selectedLock = view.locks.find(({ id }) => id === lockId);
  const selectedPlan = view.plans.find(({ id }) => id === planId);
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed:
        id === 'claim-order'
          ? Boolean(selectedOrder && selectedOrder.poolStatus === 'UNPLANNED')
          : id === 'release-lock'
            ? Boolean(selectedLock)
            : true,
      permissions,
      status:
        id === 'release-lock'
          ? selectedLock?.status === 'ACTIVE'
            ? 'LOCK_ACTIVE'
            : 'NONE'
          : id === 'validate-plan'
            ? selectedPlan?.status === 'DRAFT'
              ? 'PLAN_DRAFT'
              : 'NONE'
            : id === 'publish-plan'
              ? selectedPlan?.status === 'VALIDATED'
                ? 'PLAN_VALIDATED'
                : 'NONE'
              : (selectedBatch?.status ?? 'NONE'),
    }),
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用运输计划工作台');
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
          '/api/v1/tms/planning/workbench',
        )) as unknown as PlanningView,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运输计划查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (
      !decision?.enabled ||
      (decision.confirmMessage && !window.confirm(decision.confirmMessage))
    )
      return;
    try {
      if (actionId === 'create-batch') {
        await request('/api/v1/tms/planning/batches', {
          body: JSON.stringify({
            criteria: { serviceLevel: 'NEXT_DAY' },
            planningDate: new Date().toISOString().slice(0, 10),
            regionCode: 'EAST',
          }),
          method: 'POST',
        });
      } else if (actionId === 'claim-order' && selectedBatch && selectedOrder) {
        await request(
          `/api/v1/tms/planning/batches/${selectedBatch.id}/orders/${selectedOrder.id}/claim`,
          {
            body: JSON.stringify({
              expectedBatchVersion: selectedBatch.version,
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'release-lock' && selectedLock) {
        await request(`/api/v1/tms/planning/locks/${selectedLock.id}/release`, {
          body: JSON.stringify({
            expectedVersion: selectedLock.version,
            reason: '计划员主动释放',
          }),
          method: 'POST',
        });
      } else if (actionId === 'build-plan' && selectedBatch) {
        const locks = view.locks.filter(
          ({ planningBatchId, status }) =>
            planningBatchId === selectedBatch.id && status === 'ACTIVE',
        );
        const lockedOrders = locks
          .map(({ transportOrderId }) =>
            view.orders.find(({ id }) => id === transportOrderId),
          )
          .filter((order): order is PoolOrder => Boolean(order));
        if (!lockedOrders.length) throw new Error('请先领取至少一张运输订单');
        await request(
          `/api/v1/tms/planning/batches/${selectedBatch.id}/plans`,
          {
            body: JSON.stringify({
              expectedBatchVersion: selectedBatch.version,
              policySnapshot: {
                allowConsolidation: true,
                ruleVersion: 'WORKBENCH-V1',
              },
              shipments: lockedOrders.map((order, index) => ({
                deliveryWindowTo: new Date(
                  Date.now() + 12 * 3_600_000,
                ).toISOString(),
                destinationSnapshot: order.destinationAddressSnapshot,
                items: [
                  {
                    allocationRatio: '1',
                    itemSnapshot: { source: 'WORKBENCH' },
                    quantity: '1',
                    quantityBase: '1',
                    quantityBaseUom: 'EA',
                    quantityUom: 'EA',
                    sourceLineRef: `ORDER-${index + 1}`,
                    transportOrderId: order.id,
                    volumeBase: order.volumeBase,
                    weightBase: order.weightBase,
                  },
                ],
                legs: [
                  {
                    carrierSnapshot: {},
                    destinationSnapshot: order.destinationAddressSnapshot,
                    equipment: {
                      capacityPallets: '100',
                      capacityVolumeBase: '1000',
                      capacityWeightBase: '50000',
                      equipmentSnapshot: {
                        loadingMethods: ['REAR'],
                        temperatureControlled: true,
                      },
                      equipmentType: 'GENERAL_TRUCK',
                    },
                    mode: 'ROAD_FTL',
                    originNodeSnapshot: order.originAddressSnapshot,
                    plannedEndAt: new Date(
                      Date.now() + 8 * 3_600_000,
                    ).toISOString(),
                    plannedStartAt: new Date(
                      Date.now() + 2 * 3_600_000,
                    ).toISOString(),
                    sequence: 1,
                    slaSnapshot: { serviceLevel: order.serviceLevel },
                  },
                ],
                mode: 'ROAD_FTL',
                modeDecision: {
                  candidates: [{ mode: 'ROAD_FTL', score: 100 }],
                  explanation: { selectedBecause: 'DIRECT_ROUTE' },
                  ruleVersion: 'MODE-V1',
                },
                originSnapshot: order.originAddressSnapshot,
                pickupWindowFrom: new Date(
                  Date.now() + 2 * 3_600_000,
                ).toISOString(),
                requirementSnapshot: {
                  refrigerated: order.temperatureMin !== null,
                },
                temperatureMax: order.temperatureMax ?? undefined,
                temperatureMin: order.temperatureMin ?? undefined,
                totalPallets: String(order.packagingSnapshot.palletCount ?? 0),
                totalVolumeBase: order.volumeBase,
                totalWeightBase: order.weightBase,
              })),
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'validate-plan' && selectedPlan) {
        await request(
          `/api/v1/tms/planning/plans/${selectedPlan.id}/validate`,
          {
            body: JSON.stringify({ expectedVersion: selectedPlan.version }),
            method: 'POST',
          },
        );
      } else if (actionId === 'publish-plan' && selectedPlan) {
        const batch = view.batches.find(
          ({ id }) => id === selectedPlan.planningBatchId,
        );
        if (!batch) throw new Error('计划批次不存在');
        await request(`/api/v1/tms/planning/plans/${selectedPlan.id}/publish`, {
          body: JSON.stringify({
            expectedBatchVersion: batch.version,
            expectedVersion: selectedPlan.version,
          }),
          method: 'POST',
        });
      }
      setNotice('运输计划动作已完成，守恒与兼容性校验已留痕');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运输计划动作失败');
    }
  }

  return (
    <Card title="计划批次、合拆运与多段线路">
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="PlanningBatch 与订单池">
            <DataGrid
              columns={[
                { key: 'batchNo', label: '批次号' },
                { key: 'planningDate', label: '计划日' },
                { key: 'regionCode', label: '区域' },
                {
                  key: 'status',
                  label: '状态',
                  render: (value) => <StatusBadge status={String(value)} />,
                },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setBatchId(ids.at(-1) ?? '')}
              page={1}
              pageSize={100}
              rows={view.batches}
              selectedIds={batchId ? [batchId] : []}
              total={view.batches.length}
            />
            <DataGrid
              columns={[
                { key: 'serviceLevel', label: '服务等级' },
                { key: 'weightBase', label: '重量' },
                { key: 'volumeBase', label: '体积' },
                {
                  key: 'poolStatus',
                  label: '池状态',
                  render: (value) => <StatusBadge status={String(value)} />,
                },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setOrderId(ids.at(-1) ?? '')}
              page={1}
              pageSize={100}
              rows={view.orders}
              selectedIds={orderId ? [orderId] : []}
              total={view.orders.length}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="PlanningLock 与合拆计划">
            <DataGrid
              columns={[
                { key: 'transportOrderId', label: '运输订单' },
                { key: 'plannerId', label: '计划员' },
                {
                  key: 'status',
                  label: '状态',
                  render: (value) => <StatusBadge status={String(value)} />,
                },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setLockId(ids.at(-1) ?? '')}
              page={1}
              pageSize={100}
              rows={view.locks}
              selectedIds={lockId ? [lockId] : []}
              total={view.locks.length}
            />
            <DataGrid
              columns={[
                { key: 'planNo', label: '计划号' },
                {
                  key: 'status',
                  label: '状态',
                  render: (value) => <StatusBadge status={String(value)} />,
                },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setPlanId(ids.at(-1) ?? '')}
              page={1}
              pageSize={100}
              rows={view.plans}
              selectedIds={planId ? [planId] : []}
              total={view.plans.length}
            />
          </Card>
        </Col>
        <Col span={24}>
          <Card size="small" title="Shipment、TransportLeg 与独立承运 SLA">
            <DataGrid
              columns={[
                { key: 'shipmentNo', label: '运单号' },
                { key: 'mode', label: '模式' },
                { key: 'totalWeightBase', label: '重量' },
                { key: 'totalVolumeBase', label: '体积' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={100}
              rows={view.shipments}
              selectedIds={[]}
              total={view.shipments.length}
            />
            <DataGrid
              columns={[
                { key: 'shipmentId', label: '运单' },
                { key: 'sequence', label: '段序' },
                { key: 'mode', label: '模式' },
                { key: 'carrierRef', label: '承运商' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={view.legs}
              selectedIds={[]}
              total={view.legs.length}
            />
          </Card>
        </Col>
      </Row>
    </Card>
  );
}
