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
interface ShipmentRow extends RowBase {
  shipmentNo: string;
}
interface ExceptionRow extends RowBase {
  exceptionNo: string;
  severity: string;
  shipmentId: string;
  slaDueAt: string;
  type: string;
}
interface MilestoneRow extends RowBase {
  code: string;
  plannedAt: string;
  shipmentId: string;
}
interface AppointmentRow extends RowBase {
  appointmentRef: string | null;
  milestoneId: string;
  requestRef: string;
  shipmentId: string;
}
interface MapRow extends RowBase {
  etaSnapshot: Record<string, unknown>;
  exceptionSnapshot: unknown[];
  positionSnapshot: {
    latitude?: number;
    longitude?: number;
    precision: string;
  };
  routeSnapshot: {
    stops?: {
      locationSnapshot: { latitude?: number; longitude?: number };
      sequence: number;
      stopRef: string;
    }[];
  };
  shipmentId: string;
  shipmentStatus: string;
  vehicleSnapshot: Record<string, unknown>;
}
interface View {
  appointmentLinks: AppointmentRow[];
  escalations: RowBase[];
  exceptions: ExceptionRow[];
  maps: MapRow[];
  milestones: MilestoneRow[];
  shipments: ShipmentRow[];
}

const emptyView: View = {
  appointmentLinks: [],
  escalations: [],
  exceptions: [],
  maps: [],
  milestones: [],
  shipments: [],
};
const actions = createActionRegistry<string>([
  {
    allowedStatuses: [
      'SHIPMENT_DISPATCHED',
      'SHIPMENT_TRACKING',
      'SHIPMENT_DELIVERED',
    ],
    id: 'refresh',
    label: '刷新在途地图',
    requiredPermissions: ['tms.operations.map.refresh'],
  },
  {
    allowedStatuses: ['MAP_ACTIVE'],
    id: 'precise',
    label: '查看精确位置',
    requiredPermissions: ['tms.operations.map.precise'],
  },
  {
    allowedStatuses: ['SHIPMENT_TRACKING'],
    id: 'detect',
    label: '运行异常检测',
    requiredPermissions: ['tms.operations.exception.detect'],
  },
  {
    allowedStatuses: ['EXCEPTION_OPEN'],
    id: 'acknowledge',
    label: '认领异常',
    requiredPermissions: ['tms.operations.exception.manage'],
  },
  {
    allowedStatuses: ['EXCEPTION_ACKNOWLEDGED'],
    id: 'plan',
    label: '提交处置计划',
    requiredPermissions: ['tms.operations.exception.manage'],
  },
  {
    allowedStatuses: ['EXCEPTION_IN_PROGRESS'],
    id: 'resolve',
    label: '验证恢复',
    requiredPermissions: ['tms.operations.exception.manage'],
  },
  {
    allowedStatuses: ['EXCEPTION_RESOLVED'],
    id: 'close',
    label: '沟通后关闭',
    requiredPermissions: ['tms.operations.exception.manage'],
  },
  {
    allowedStatuses: [
      'EXCEPTION_OPEN',
      'EXCEPTION_ACKNOWLEDGED',
      'EXCEPTION_IN_PROGRESS',
    ],
    id: 'escalate',
    label: '执行 SLA 升级',
    requiredPermissions: ['tms.operations.exception.escalate'],
  },
  {
    allowedStatuses: ['SHIPMENT_DISPATCHED', 'SHIPMENT_TRACKING'],
    id: 'appointment',
    label: '请求 AMS 预约',
    requiredPermissions: ['tms.operations.appointment.manage'],
  },
]);

function RouteMap({ map }: { map: MapRow | undefined }) {
  const stops = map?.routeSnapshot.stops ?? [];
  const coordinates = stops.map(({ locationSnapshot }) => ({
    latitude: Number(locationSnapshot.latitude ?? 0),
    longitude: Number(locationSnapshot.longitude ?? 0),
  }));
  const latitudes = coordinates.map(({ latitude }) => latitude);
  const longitudes = coordinates.map(({ longitude }) => longitude);
  const minimumLatitude = Math.min(...latitudes);
  const minimumLongitude = Math.min(...longitudes);
  const latitudeRange = Math.max(
    0.001,
    Math.max(...latitudes) - minimumLatitude,
  );
  const longitudeRange = Math.max(
    0.001,
    Math.max(...longitudes) - minimumLongitude,
  );
  const points = coordinates.map(({ latitude, longitude }) => ({
    x: 30 + ((longitude - minimumLongitude) / longitudeRange) * 300,
    y: 120 - ((latitude - minimumLatitude) / latitudeRange) * 80,
  }));
  const positionX = points.length
    ? 30 +
      Math.min(points.length - 1, Math.max(0, Math.floor(points.length / 2))) *
        110
    : 30;
  return (
    <svg
      aria-label="脱敏在途路线图"
      role="img"
      viewBox="0 0 360 160"
      width="100%"
    >
      <rect fill="#081b2c" height="160" rx="12" width="360" />
      <path
        d={`M ${points.map(({ x, y }) => `${x} ${y}`).join(' L ') || '30 80 L 330 80'}`}
        fill="none"
        stroke="#2dd4bf"
        strokeDasharray="8 5"
        strokeWidth="4"
      />
      {points.map(({ x, y }, index) => (
        <g key={`${x}-${index}`}>
          <circle cx={x} cy={y} fill="#e2e8f0" r="8" />
          <text
            fill="#94a3b8"
            fontSize="11"
            textAnchor="middle"
            x={x}
            y={y + 28}
          >
            {stops[index]?.stopRef}
          </text>
        </g>
      ))}
      {map ? (
        <g>
          <circle cx={positionX} cy="55" fill="#f59e0b" r="10" />
          <text fill="#f8fafc" fontSize="12" x={positionX + 14} y="58">
            当前位置 · {map.positionSnapshot.precision}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

export function InTransitOperationsPanel() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<View>(emptyView);
  const [shipmentId, setShipmentId] = useState('');
  const [mapId, setMapId] = useState('');
  const [exceptionId, setExceptionId] = useState('');
  const [appointmentId, setAppointmentId] = useState('');
  const [precisePosition, setPrecisePosition] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'tms.operations.read',
              'tms.operations.map.refresh',
              'tms.operations.map.precise',
              'tms.operations.exception.detect',
              'tms.operations.exception.manage',
              'tms.operations.exception.escalate',
              'tms.operations.appointment.manage',
            ]
          : [],
      ),
    [claims],
  );
  const shipment = view.shipments.find(({ id }) => id === shipmentId);
  const map = view.maps.find(({ id }) => id === mapId);
  const exception = view.exceptions.find(({ id }) => id === exceptionId);
  const appointment = view.appointmentLinks.find(
    ({ id }) => id === appointmentId,
  );
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status:
        id === 'precise'
          ? `MAP_${map?.status ?? 'NONE'}`
          : ['acknowledge', 'plan', 'resolve', 'close', 'escalate'].includes(id)
            ? `EXCEPTION_${exception?.status ?? 'NONE'}`
            : `SHIPMENT_${shipment?.status ?? 'NONE'}`,
    }),
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用在途运营工作台');
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
        (await request('/api/v1/tms/in-transit/workbench')) as unknown as View,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '在途运营查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  async function execute(actionId: string) {
    if (!decisions.find(({ id }) => id === actionId)?.enabled) return;
    try {
      if (actionId === 'refresh' && shipment)
        await request(
          `/api/v1/tms/in-transit/shipments/${shipment.id}/map/refresh`,
          { method: 'POST' },
        );
      else if (actionId === 'precise' && map) {
        const exact = (await request(
          `/api/v1/tms/in-transit/shipments/${map.shipmentId}/map/precise`,
        )) as unknown as MapRow;
        setPrecisePosition(
          `${exact.positionSnapshot.latitude ?? '-'}, ${exact.positionSnapshot.longitude ?? '-'}`,
        );
        setNotice('精确位置按独立权限读取，司机个人信息仍未返回');
        return;
      } else if (actionId === 'detect' && shipment)
        await request(
          `/api/v1/tms/in-transit/shipments/${shipment.id}/exceptions/detect`,
          {
            body: JSON.stringify({
              asOf: new Date().toISOString(),
              communicationGapMinutes: 20,
              delayMinutes: 30,
              detectedBy: 'SERVICE',
              routeDeviationMeters: 1200,
            }),
            method: 'POST',
          },
        );
      else if (
        ['acknowledge', 'plan', 'resolve', 'close'].includes(actionId) &&
        exception
      ) {
        const actionType =
          actionId === 'acknowledge'
            ? 'ACKNOWLEDGE'
            : actionId === 'plan'
              ? 'PLAN'
              : actionId === 'resolve'
                ? 'RESOLVE'
                : 'CLOSE';
        await request(
          `/api/v1/tms/in-transit/exceptions/${exception.id}/actions`,
          {
            body: JSON.stringify({
              actionType,
              businessVerified: actionId === 'close',
              customerCommunicatedAt:
                actionId === 'close' ? new Date().toISOString() : undefined,
              evidenceSnapshot: { source: 'CONTROL_TOWER' },
              expectedRecoveryAt: new Date(
                Date.now() + 60 * 60_000,
              ).toISOString(),
              expectedVersion: exception.version,
              handlingPlan: '联系承运商和司机，核验现场状态并更新客户',
              ownerId: claims?.subject,
              resolutionSummary:
                actionId === 'resolve' ? '现场已恢复并完成业务核验' : undefined,
              rootCause:
                actionId === 'resolve' ? '道路拥堵和通信不稳定' : undefined,
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'escalate' && claims)
        await request('/api/v1/tms/in-transit/exceptions/escalate-due', {
          body: JSON.stringify({
            asOf: new Date().toISOString(),
            toOwnerId: claims.subject,
          }),
          method: 'POST',
        });
      else if (actionId === 'appointment' && shipment) {
        const milestone = view.milestones.find(
          (row) => row.shipmentId === shipment.id && row.status === 'PLANNED',
        );
        if (!milestone) throw new Error('缺少可预约的计划节点');
        await request(
          `/api/v1/tms/in-transit/shipments/${shipment.id}/appointment-links`,
          {
            body: JSON.stringify({
              milestoneId: milestone.id,
              plannedAt: milestone.plannedAt,
              siteRequirementSnapshot: {
                dockType: 'STANDARD',
                source: 'TMS_CONTROL_TOWER',
              },
            }),
            method: 'POST',
          },
        );
      }
      setNotice('在途运营动作已保存，并通过 Outbox 发布下游事件');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '在途运营动作失败');
    }
  }

  const grid = <T extends RowBase>(
    rows: readonly T[],
    selectedId: string,
    setSelectedId: (id: string) => void,
    columns: readonly {
      key: keyof T & string;
      label: string;
      render?: (value: unknown) => ReactNode;
    }[],
  ) => (
    <DataGrid
      columns={columns}
      onPageChange={() => undefined}
      onSelectionChange={(ids) => setSelectedId(ids.at(-1) ?? '')}
      page={1}
      pageSize={200}
      rows={rows}
      selectedIds={selectedId ? [selectedId] : []}
      total={rows.length}
    />
  );

  return (
    <Card title="在途地图、异常处置与预约联动">
      <Typography.Paragraph>
        控制塔地图默认使用粗粒度位置并隐藏司机个人信息；异常按 SLA
        认领、处置、恢复验证和客户沟通闭环，AMS 联动仅通过版本化事件端口。
      </Typography.Paragraph>
      <Space wrap>
        <Tag color="cyan">默认模糊坐标</Tag>
        <Tag color="purple">司机隐私隔离</Tag>
        <Tag color="red">异常费用冻结</Tag>
        <Tag color="gold">AMS Outbox 占位</Tag>
        {precisePosition ? (
          <Tag color="blue">精确位置 {precisePosition}</Tag>
        ) : null}
      </Space>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="ShipmentMapProjection 脱敏地图">
            <RouteMap map={map} />
            {grid(view.shipments, shipmentId, setShipmentId, [
              { key: 'shipmentNo', label: '运单号' },
              {
                key: 'status',
                label: '运输状态',
                render: (value) => <StatusBadge status={String(value)} />,
              },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.maps, mapId, setMapId, [
              { key: 'shipmentStatus', label: '地图状态' },
              { key: 'status', label: '投影状态' },
              { key: 'version', label: '投影版本' },
            ])}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="TransportException 与 Escalation">
            {grid(view.exceptions, exceptionId, setExceptionId, [
              { key: 'exceptionNo', label: '异常号' },
              { key: 'type', label: '类型' },
              { key: 'severity', label: '严重度' },
              {
                key: 'status',
                label: '状态',
                render: (value) => <StatusBadge status={String(value)} />,
              },
              { key: 'slaDueAt', label: 'SLA 到期' },
            ])}
            {grid(view.appointmentLinks, appointmentId, setAppointmentId, [
              { key: 'requestRef', label: '预约请求' },
              { key: 'appointmentRef', label: 'AMS 预约号' },
              { key: 'status', label: '联动状态' },
              { key: 'version', label: '版本' },
            ])}
            {appointment ? (
              <Typography.Text type="secondary">
                已选预约联动：{appointment.requestRef}
              </Typography.Text>
            ) : null}
          </Card>
        </Col>
      </Row>
    </Card>
  );
}
