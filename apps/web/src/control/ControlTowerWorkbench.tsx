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

interface TimelineRow {
  attachmentSnapshot: { attachments?: readonly string[] };
  businessRef: string;
  causationId: string | null;
  eventType: string;
  id: string;
  occurredAt: string;
  replayStatus: string;
  sourceDomain: string;
  summary: string;
  traceId: string;
}

interface OrderRow {
  blockingSnapshot: { blockers?: readonly unknown[] };
  businessRef: string;
  completionRate: string;
  currentStage: string;
  currentStatus: string;
  id: string;
  orderRef: string;
  promisedAt: string | null;
  refreshedAt: string;
}

interface InventoryRow {
  agingDays: number;
  availableQuantity: string;
  baseUom: string;
  holdQuantity: string;
  id: string;
  inTransitQuantity: string;
  ownerRef: string;
  productRef: string;
  regionRef: string;
  stockoutRisk: string;
  turnoverDays: string;
  warehouseRef: string;
}

interface TransportRow {
  businessRef: string;
  currentNodeRef: string | null;
  delayed: boolean;
  etaAt: string | null;
  id: string;
  latitude: string | null;
  locationPrecision: 'APPROXIMATE' | 'EXACT';
  longitude: string | null;
  routeRef: string;
  shipmentRef: string;
  temperatureAlert: boolean;
  vehicleRef: string | null;
}

interface YardRow {
  arrivedToday: number;
  dockRef: string;
  futureCapacity: string;
  id: string;
  lateCount: number;
  noShowCount: number;
  occupied: boolean;
  operationMinutes: number;
  queueCount: number;
  tmsReferenceSnapshot: { references?: readonly string[] };
  warehouseRef: string;
  wmsReferenceSnapshot: { references?: readonly string[] };
}

interface ControlTowerView {
  inventory: readonly InventoryRow[];
  orders: readonly OrderRow[];
  refreshedAt: string;
  timeline: readonly TimelineRow[];
  transport: readonly TransportRow[];
  transportHeat: readonly { routeRef: string; weight: number }[];
  yards: readonly YardRow[];
}

const emptyView: ControlTowerView = {
  inventory: [],
  orders: [],
  refreshedAt: '',
  timeline: [],
  transport: [],
  transportHeat: [],
  yards: [],
};

const actions = createActionRegistry<'READY'>([
  {
    id: 'refresh',
    label: '刷新控制塔',
    requiredPermissions: ['control.view.read'],
  },
  {
    id: 'exactLocation',
    label: '精确位置下钻',
    requiredPermissions: ['control.location.precise'],
  },
]);

export function ControlTowerWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<ControlTowerView>(emptyView);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(claims ? ['control.view.read', 'control.location.precise'] : []),
    [claims],
  );
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: 'READY',
    }),
  );

  const load = useCallback(
    async (exact = false) => {
      if (!accessToken || !claims) return;
      const response = await fetch(
        exact ? '/api/v1/control/views/exact' : '/api/v1/control/views',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Correlation-Id': crypto.randomUUID(),
            'X-Tenant-Id': claims.tenantId,
          },
        },
      );
      const body = (await response.json()) as ControlTowerView & {
        code?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '控制塔查询失败'}`,
        );
      setView(body);
      setError(undefined);
    },
    [accessToken, claims],
  );

  useEffect(() => {
    void load().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : '控制塔查询失败'),
    );
  }, [load]);

  const normalized = query.trim().toLowerCase();
  const contains = (...values: readonly (string | null)[]) =>
    !normalized ||
    values.some((value) => value?.toLowerCase().includes(normalized));
  const timelines = view.timeline.filter((row) =>
    contains(row.businessRef, row.eventType, row.summary, row.sourceDomain),
  );
  const orders = view.orders.filter((row) =>
    contains(row.businessRef, row.orderRef, row.currentStatus),
  );
  const inventory = view.inventory.filter((row) =>
    contains(row.warehouseRef, row.ownerRef, row.productRef, row.regionRef),
  );
  const transport = view.transport.filter((row) =>
    contains(row.businessRef, row.shipmentRef, row.vehicleRef, row.routeRef),
  );
  const yards = view.yards.filter((row) =>
    contains(row.warehouseRef, row.dockRef),
  );

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (!decision?.enabled) return;
    try {
      const exact = actionId === 'exactLocation';
      await load(exact);
      setNotice(exact ? '已按精确位置权限完成下钻' : '控制塔投影已刷新');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '控制塔动作失败');
    }
  }

  const grid = {
    onPageChange: () => undefined,
    page: 1,
    pageSize: 50,
  } as const;

  return (
    <section className="control-tower-workbench">
      <Typography.Title level={2}>供应链控制塔</Typography.Title>
      <Typography.Paragraph>
        控制域仅消费业务事件构建独立投影，统一呈现订单、库存、运输和月台状态；来源版本、因果链、重放状态与附件均可追溯。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <QueryPanel
        fields={[
          {
            label: '订单 / 商品 / 仓库 / 运输引用',
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

      <Card title="端到端业务时间线">
        <DataGrid
          {...grid}
          columns={[
            { key: 'businessRef', label: '业务引用' },
            { key: 'sourceDomain', label: '来源域' },
            { key: 'eventType', label: '事件' },
            { key: 'summary', label: '摘要' },
            { key: 'causationId', label: '因果事件' },
            { key: 'traceId', label: '追踪标识' },
            { key: 'replayStatus', label: '重放状态' },
            { key: 'occurredAt', label: '发生时间' },
          ]}
          rows={timelines}
          total={timelines.length}
        />
      </Card>

      <Card title="订单履约控制视图">
        <DataGrid
          {...grid}
          columns={[
            { key: 'orderRef', label: '订单' },
            { key: 'currentStage', label: '当前阶段' },
            {
              key: 'currentStatus',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'completionRate', label: '完成度' },
            { key: 'promisedAt', label: '承诺时间' },
            {
              key: 'blockingSnapshot',
              label: '阻塞项',
              render: (_value, row) =>
                String(row.blockingSnapshot.blockers?.length ?? 0),
            },
            { key: 'refreshedAt', label: '刷新时间' },
          ]}
          rows={orders}
          total={orders.length}
        />
      </Card>

      <Card title="库存网络与缺货风险">
        <DataGrid
          {...grid}
          columns={[
            { key: 'regionRef', label: '区域' },
            { key: 'warehouseRef', label: '仓库' },
            { key: 'ownerRef', label: '货主' },
            { key: 'productRef', label: '商品' },
            { key: 'availableQuantity', label: '可用' },
            { key: 'holdQuantity', label: '冻结' },
            { key: 'inTransitQuantity', label: '在途' },
            { key: 'agingDays', label: '库龄天数' },
            { key: 'turnoverDays', label: '周转天数' },
            { key: 'stockoutRisk', label: '缺货风险' },
          ]}
          rows={inventory}
          total={inventory.length}
        />
      </Card>

      <Card title="运输网络、ETA 与热力">
        <Typography.Paragraph>
          路线热力：
          {view.transportHeat
            .map((item) => `${item.routeRef} ${item.weight}`)
            .join('；') || '暂无'}
        </Typography.Paragraph>
        <DataGrid
          {...grid}
          columns={[
            { key: 'shipmentRef', label: '运单' },
            { key: 'vehicleRef', label: '车辆' },
            { key: 'routeRef', label: '路线' },
            { key: 'currentNodeRef', label: '当前节点' },
            { key: 'etaAt', label: 'ETA' },
            { key: 'delayed', label: '延误' },
            { key: 'temperatureAlert', label: '温控告警' },
            { key: 'latitude', label: '纬度' },
            { key: 'longitude', label: '经度' },
            { key: 'locationPrecision', label: '位置精度' },
          ]}
          rows={transport}
          total={transport.length}
        />
      </Card>

      <Card title="预约、排队与月台视图">
        <DataGrid
          {...grid}
          columns={[
            { key: 'warehouseRef', label: '仓库' },
            { key: 'dockRef', label: '月台' },
            { key: 'futureCapacity', label: '未来容量' },
            { key: 'arrivedToday', label: '今日到场' },
            { key: 'queueCount', label: '排队' },
            { key: 'occupied', label: '占用' },
            { key: 'operationMinutes', label: '作业分钟' },
            { key: 'lateCount', label: '迟到' },
            { key: 'noShowCount', label: '爽约' },
            {
              key: 'wmsReferenceSnapshot',
              label: 'WMS 联动',
              render: (_value, row) =>
                row.wmsReferenceSnapshot.references?.join(', ') ?? '',
            },
            {
              key: 'tmsReferenceSnapshot',
              label: 'TMS 联动',
              render: (_value, row) =>
                row.tmsReferenceSnapshot.references?.join(', ') ?? '',
            },
          ]}
          rows={yards}
          total={yards.length}
        />
      </Card>
    </section>
  );
}
