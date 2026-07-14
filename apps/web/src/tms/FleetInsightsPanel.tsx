import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CommandBar,
  DataGrid,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Col, Row, Space, Tag, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface RowBase {
  id: string;
  status: string;
  version: number;
}
interface VehicleRow extends RowBase {
  plateNumber: string;
}
interface ShipmentRow extends RowBase {
  shipmentNo: string;
  temperatureMax: string | null;
  temperatureMin: string | null;
}
interface MaintenanceRow extends RowBase {
  maintenanceType: string;
  planNo: string;
  plannedFrom: string;
  plannedTo: string;
}
interface AlertRow extends RowBase {
  alertNo: string;
  alertType: string;
  severity: string;
}
interface MetricRow extends RowBase {
  dimensionValue: string;
  metricCode: string;
  uom: string;
  value: string;
}
interface TokenRow extends RowBase {
  expiresAt: string;
  maxViews: number;
  viewCount: number;
}
interface View {
  conditionAlerts: AlertRow[];
  maintenancePlans: MaintenanceRow[];
  metrics: MetricRow[];
  operatingFacts: RowBase[];
  shipments: ShipmentRow[];
  telemetry: RowBase[];
  trackingTokens: TokenRow[];
  vehicles: VehicleRow[];
}
const emptyView: View = {
  conditionAlerts: [],
  maintenancePlans: [],
  metrics: [],
  operatingFacts: [],
  shipments: [],
  telemetry: [],
  trackingTokens: [],
  vehicles: [],
};
const actions = createActionRegistry<string>([
  {
    allowedStatuses: ['VEHICLE_AVAILABLE'],
    id: 'scheduleMaintenance',
    label: '安排车辆保养',
    requiredPermissions: ['tms.fleet.maintenance'],
  },
  {
    allowedStatuses: ['VEHICLE_AVAILABLE'],
    id: 'recordFuel',
    label: '登记油耗事实',
    requiredPermissions: ['tms.fleet.maintenance'],
  },
  {
    allowedStatuses: ['MAINTENANCE_PLANNED'],
    id: 'startMaintenance',
    label: '车辆进场维修',
    requiredPermissions: ['tms.fleet.maintenance'],
  },
  {
    allowedStatuses: ['MAINTENANCE_IN_PROGRESS'],
    id: 'completeMaintenance',
    label: '完成维修并恢复运力',
    requiredPermissions: ['tms.fleet.maintenance'],
  },
  {
    allowedStatuses: ['SHIPMENT_DISPATCHED', 'SHIPMENT_TRACKING'],
    id: 'ingestTemperature',
    label: '接收温控遥测',
    requiredPermissions: ['tms.iot.ingest'],
  },
  {
    allowedStatuses: ['ALERT_OPEN'],
    id: 'acknowledgeAlert',
    label: '确认温控告警',
    requiredPermissions: ['tms.iot.resolve'],
  },
  {
    allowedStatuses: ['ALERT_ACKNOWLEDGED'],
    id: 'resolveAlert',
    label: '解决温控告警',
    requiredPermissions: ['tms.iot.resolve'],
  },
  {
    id: 'generateMetrics',
    label: '生成运输 KPI',
    requiredPermissions: ['tms.metrics.generate'],
  },
  {
    allowedStatuses: [
      'SHIPMENT_TENDERED',
      'SHIPMENT_ACCEPTED',
      'SHIPMENT_DISPATCHED',
      'SHIPMENT_TRACKING',
      'SHIPMENT_DELIVERED',
      'SHIPMENT_POD',
      'SHIPMENT_SETTLED',
    ],
    id: 'issueTracking',
    label: '签发客户追踪码',
    requiredPermissions: ['tms.tracking.share'],
  },
  {
    allowedStatuses: ['TOKEN_ACTIVE'],
    id: 'revokeTracking',
    label: '撤销客户追踪码',
    requiredPermissions: ['tms.tracking.share'],
  },
]);

export function FleetInsightsPanel() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<View>(emptyView);
  const [vehicleId, setVehicleId] = useState('');
  const [shipmentId, setShipmentId] = useState('');
  const [maintenanceId, setMaintenanceId] = useState('');
  const [alertId, setAlertId] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'tms.fleet.read',
              'tms.fleet.maintenance',
              'tms.iot.ingest',
              'tms.iot.resolve',
              'tms.metrics.generate',
              'tms.tracking.share',
            ]
          : [],
      ),
    [claims],
  );
  const vehicle = view.vehicles.find(({ id }) => id === vehicleId);
  const shipment = view.shipments.find(({ id }) => id === shipmentId);
  const maintenance = view.maintenancePlans.find(
    ({ id }) => id === maintenanceId,
  );
  const alert = view.conditionAlerts.find(({ id }) => id === alertId);
  const token = view.trackingTokens.find(({ id }) => id === tokenId);
  const statusFor = (id: string) =>
    ['scheduleMaintenance', 'recordFuel'].includes(id)
      ? `VEHICLE_${vehicle?.status ?? 'NONE'}`
      : ['startMaintenance', 'completeMaintenance'].includes(id)
        ? `MAINTENANCE_${maintenance?.status ?? 'NONE'}`
        : ['acknowledgeAlert', 'resolveAlert'].includes(id)
          ? `ALERT_${alert?.status ?? 'NONE'}`
          : id === 'revokeTracking'
            ? `TOKEN_${token?.status ?? 'NONE'}`
            : `SHIPMENT_${shipment?.status ?? 'NONE'}`;
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: statusFor(id),
    }),
  );
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用车队与运输洞察工作台');
      const response = await fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
          'X-Correlation-Id': crypto.randomUUID(),
          'X-Tenant-Id': claims.tenantId,
          ...init?.headers,
        },
      });
      const body = (await response.json()) as {
        code?: string;
        message?: string;
        token?: string;
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
          '/api/v1/tms/fleet-insights/workbench',
        )) as unknown as View,
      );
      setError(undefined);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '车队与运输洞察查询失败',
      );
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  async function execute(id: string) {
    if (!decisions.find((item) => item.id === id)?.enabled) return;
    try {
      const now = Date.now();
      let result: { token?: string } | undefined;
      if (id === 'scheduleMaintenance' && vehicle)
        await request('/api/v1/tms/fleet-insights/maintenance-plans', {
          body: JSON.stringify({
            detailSnapshot: { workshop: '授权维修站' },
            maintenanceType: 'MAINTENANCE',
            odometer: '120000',
            plannedFrom: new Date(now + 86_400_000).toISOString(),
            plannedTo: new Date(now + 86_400_000 + 4 * 3_600_000).toISOString(),
            reason: '计划保养',
            vehicleRef: vehicle.id,
          }),
          method: 'POST',
        });
      else if (id === 'recordFuel' && vehicle)
        await request('/api/v1/tms/fleet-insights/operating-facts', {
          body: JSON.stringify({
            detailSnapshot: { source: 'FLEET_WORKBENCH' },
            factType: 'FUEL',
            occurredAt: new Date(now).toISOString(),
            sourceRef: `FUEL-${now}`,
            uom: 'L',
            value: '100',
            vehicleRef: vehicle.id,
          }),
          method: 'POST',
        });
      else if (
        ['startMaintenance', 'completeMaintenance'].includes(id) &&
        maintenance
      )
        await request(
          `/api/v1/tms/fleet-insights/maintenance-plans/${maintenance.id}/transition`,
          {
            body: JSON.stringify({
              action: id === 'startMaintenance' ? 'START' : 'COMPLETE',
              expectedVersion: maintenance.version,
              reason:
                id === 'startMaintenance'
                  ? '车辆进入维修站'
                  : '维修验收通过，恢复运力',
            }),
            method: 'POST',
          },
        );
      else if (id === 'ingestTemperature' && shipment)
        await request(
          `/api/v1/tms/fleet-insights/shipments/${shipment.id}/telemetry`,
          {
            body: JSON.stringify({
              deviceRef: 'WORKBENCH-IOT',
              externalMessageId: `MSG-${now}`,
              metricType: 'TEMPERATURE',
              observedAt: new Date(now).toISOString(),
              payloadSnapshot: { sensor: 'CARGO' },
              retentionDays: 365,
              uom: 'C',
              value: shipment.temperatureMax ?? '8',
            }),
            method: 'POST',
          },
        );
      else if (['acknowledgeAlert', 'resolveAlert'].includes(id) && alert)
        await request(
          `/api/v1/tms/fleet-insights/condition-alerts/${alert.id}/transition`,
          {
            body: JSON.stringify({
              action: id === 'acknowledgeAlert' ? 'ACKNOWLEDGE' : 'RESOLVE',
              expectedVersion: alert.version,
              resolution:
                id === 'resolveAlert' ? '温控恢复，质量复核通过' : undefined,
            }),
            method: 'POST',
          },
        );
      else if (id === 'generateMetrics')
        await request('/api/v1/tms/fleet-insights/metrics/generate', {
          body: JSON.stringify({
            dimensionType: 'CARRIER',
            periodFrom: new Date(now - 30 * 86_400_000).toISOString(),
            periodTo: new Date(now).toISOString(),
          }),
          method: 'POST',
        });
      else if (id === 'issueTracking' && shipment)
        result = await request(
          `/api/v1/tms/fleet-insights/shipments/${shipment.id}/tracking-tokens`,
          {
            body: JSON.stringify({
              allowPod: true,
              audienceSnapshot: { channel: 'CUSTOMER_SHARE' },
              expiresAt: new Date(now + 7 * 86_400_000).toISOString(),
              maxViews: 20,
            }),
            method: 'POST',
          },
        );
      else if (id === 'revokeTracking' && token)
        await request(
          `/api/v1/tms/fleet-insights/tracking-tokens/${token.id}/revoke`,
          {
            body: JSON.stringify({
              expectedVersion: token.version,
              reason: '工作台撤销客户分享',
            }),
            method: 'POST',
          },
        );
      setNotice(
        result?.token
          ? `受控追踪路径：/api/v1/public/tracking/${result.token}`
          : '车队、IoT、KPI 或追踪码动作已完成，事实与访问记录已留痕',
      );
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '工作台动作失败');
    }
  }
  const grid = <T extends RowBase>(
    rows: readonly T[],
    selectedId: string,
    select: (id: string) => void,
    columns: readonly {
      key: keyof T & string;
      label: string;
      render?: (value: unknown) => ReactNode;
    }[],
  ) => (
    <DataGrid
      columns={columns}
      onPageChange={() => undefined}
      onSelectionChange={(ids) => select(ids.at(-1) ?? '')}
      page={1}
      pageSize={200}
      rows={rows}
      selectedIds={selectedId ? [selectedId] : []}
      total={rows.length}
    />
  );
  return (
    <Card title="车队运营、温控 IoT、运输 KPI 与客户追踪">
      <Typography.Paragraph>
        维护窗口车辆自动退出绑定运力池并阻断派车；原始遥测按保留期留存，超阈值进入运输异常。KPI
        可按客户、区域、线路和承运商下钻，客户追踪码限时、限次、可撤销且仅展示脱敏数据。
      </Typography.Paragraph>
      <Space wrap>
        <Tag color="orange">维护不可用门禁</Tag>
        <Tag color="red">温控超限告警</Tag>
        <Tag color="blue">KPI 可追溯</Tag>
        <Tag color="purple">追踪码哈希存储</Tag>
      </Space>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="车队维护与 IoT 处置">
            {grid(view.vehicles, vehicleId, setVehicleId, [
              { key: 'plateNumber', label: '车辆' },
              {
                key: 'status',
                label: '主数据状态',
                render: (value) => <StatusBadge status={String(value)} />,
              },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.maintenancePlans, maintenanceId, setMaintenanceId, [
              { key: 'planNo', label: '维护计划' },
              { key: 'maintenanceType', label: '类型' },
              { key: 'plannedFrom', label: '不可用开始' },
              { key: 'plannedTo', label: '不可用结束' },
              { key: 'status', label: '状态' },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.conditionAlerts, alertId, setAlertId, [
              { key: 'alertNo', label: '告警号' },
              { key: 'alertType', label: '类型' },
              { key: 'severity', label: '严重度' },
              { key: 'status', label: '状态' },
              { key: 'version', label: '版本' },
            ])}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="KPI 与客户追踪访问">
            {grid(view.shipments, shipmentId, setShipmentId, [
              { key: 'shipmentNo', label: '运单号' },
              { key: 'status', label: '状态' },
              { key: 'temperatureMin', label: '温度下限' },
              { key: 'temperatureMax', label: '温度上限' },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.metrics, '', () => undefined, [
              { key: 'metricCode', label: 'KPI' },
              { key: 'dimensionValue', label: '下钻维度' },
              { key: 'value', label: '值' },
              { key: 'uom', label: '单位' },
            ])}
            {grid(view.trackingTokens, tokenId, setTokenId, [
              { key: 'expiresAt', label: '追踪码到期' },
              { key: 'viewCount', label: '已访问' },
              { key: 'maxViews', label: '上限' },
              { key: 'status', label: '状态' },
              { key: 'version', label: '版本' },
            ])}
            <Typography.Text type="secondary">
              原始遥测 {view.telemetry.length} · 运营事实{' '}
              {view.operatingFacts.length}
            </Typography.Text>
          </Card>
        </Col>
      </Row>
    </Card>
  );
}
