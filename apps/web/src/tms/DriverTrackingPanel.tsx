import { useCallback, useEffect, useMemo, useState } from 'react';
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
  pickupWindowFrom: string;
  shipmentNo: string;
}
interface AssignmentRow extends RowBase {
  assignmentNo: string;
  shipmentId: string;
}
interface MilestoneRow extends RowBase {
  code: string;
  mandatory: boolean;
  milestonePlanId: string;
  plannedAt: string;
  sequence: number;
}
interface DriverTaskRow extends RowBase {
  currentMilestoneSequence: number;
  deviceId: string;
  lastOfflineSequence: number;
  milestonePlanId: string;
  shipmentId: string;
  taskNo: string;
}
interface PositionRow extends RowBase {
  recordedAt: string;
  rejectionReason: string | null;
  source: string;
}
interface View {
  assignments: AssignmentRow[];
  driverTasks: DriverTaskRow[];
  milestones: MilestoneRow[];
  positionPoints: PositionRow[];
  shipments: ShipmentRow[];
}
interface QueuedCommand {
  commandType: 'MILESTONE';
  deviceSequence: number;
  payload: {
    evidenceSnapshot: Record<string, unknown>;
    locationSnapshot: Record<string, unknown>;
    milestoneId: string;
    occurredAt: string;
  };
}

const deviceId = 'SCM-DRIVER-DEMO';
const emptyView: View = {
  assignments: [],
  driverTasks: [],
  milestones: [],
  positionPoints: [],
  shipments: [],
};
const actions = createActionRegistry<string>([
  {
    allowedStatuses: ['SHIPMENT_DISPATCHED', 'SHIPMENT_TRACKING'],
    id: 'plan',
    label: '生成节点计划',
    requiredPermissions: ['tms.tracking.plan'],
  },
  {
    allowedStatuses: ['ASSIGNMENT_DISPATCHED'],
    id: 'task',
    label: '下发司机任务',
    requiredPermissions: ['tms.tracking.plan'],
  },
  {
    allowedStatuses: ['TASK_ASSIGNED'],
    id: 'accept',
    label: '司机接单',
    requiredPermissions: ['tms.driver.execute'],
  },
  {
    allowedStatuses: ['TASK_ACCEPTED', 'TASK_IN_PROGRESS'],
    id: 'queue',
    label: '离线完成下一节点',
    requiredPermissions: ['tms.driver.execute'],
  },
  {
    allowedStatuses: ['TASK_ACCEPTED', 'TASK_IN_PROGRESS'],
    id: 'sync',
    label: '按序同步离线队列',
    requiredPermissions: ['tms.driver.execute'],
  },
  {
    allowedStatuses: ['SHIPMENT_TRACKING'],
    id: 'position',
    label: '上传 GPS 签到',
    requiredPermissions: ['tms.tracking.ingest'],
  },
  {
    allowedStatuses: ['SHIPMENT_TRACKING'],
    id: 'eta',
    label: '更新 ETA',
    requiredPermissions: ['tms.tracking.predict'],
  },
]);

export function DriverTrackingPanel() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<View>(emptyView);
  const [shipmentId, setShipmentId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [queue, setQueue] = useState<QueuedCommand[]>([]);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'tms.tracking.read',
              'tms.tracking.plan',
              'tms.driver.execute',
              'tms.tracking.ingest',
              'tms.tracking.predict',
            ]
          : [],
      ),
    [claims],
  );
  const shipment = view.shipments.find(({ id }) => id === shipmentId);
  const assignment = view.assignments.find(({ id }) => id === assignmentId);
  const task = view.driverTasks.find(({ id }) => id === taskId);
  const taskMilestones = view.milestones
    .filter(({ milestonePlanId }) => milestonePlanId === task?.milestonePlanId)
    .sort((left, right) => left.sequence - right.sequence);
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status:
        id === 'task'
          ? `ASSIGNMENT_${assignment?.status ?? 'NONE'}`
          : ['accept', 'queue', 'sync'].includes(id)
            ? `TASK_${task?.status ?? 'NONE'}`
            : `SHIPMENT_${shipment?.status ?? 'NONE'}`,
    }),
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用司机跟踪工作台');
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
        (await request('/api/v1/tms/tracking/workbench')) as unknown as View,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '司机跟踪查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  async function execute(actionId: string) {
    if (!decisions.find(({ id }) => id === actionId)?.enabled) return;
    try {
      if (actionId === 'plan' && shipment) {
        const base = Math.max(
          Date.now(),
          new Date(shipment.pickupWindowFrom).getTime(),
        );
        await request(
          `/api/v1/tms/tracking/shipments/${shipment.id}/milestone-plans`,
          {
            body: JSON.stringify({
              milestones: [
                ['PICKUP', 31.2, 121.4, 1],
                ['DEPARTURE', 31.21, 121.41, 2],
                ['DELIVERY', 31.3, 121.5, 5],
                ['POD', 31.3, 121.5, 6],
              ].map(([code, latitude, longitude, hours]) => ({
                code,
                locationSnapshot: { latitude, longitude, radiusMeters: 200 },
                mandatory: true,
                plannedAt: new Date(
                  base + Number(hours) * 3_600_000,
                ).toISOString(),
                requirementSnapshot: {
                  photo: code === 'POD',
                  scan: code === 'PICKUP',
                },
                type: code,
              })),
              templateSnapshot: {
                mode: 'ROAD_FTL',
                source: 'MOBILE_WORKBENCH',
              },
              timeZone: 'Asia/Shanghai',
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'task' && assignment)
        await request(
          `/api/v1/tms/tracking/assignments/${assignment.id}/driver-task`,
          {
            body: JSON.stringify({
              deviceId,
              deviceSnapshot: { platform: 'MOBILE_WEB', bound: true },
            }),
            method: 'POST',
          },
        );
      else if (actionId === 'accept' && task)
        await request(`/api/v1/tms/tracking/driver-tasks/${task.id}/accept`, {
          body: JSON.stringify({
            deviceId: task.deviceId,
            expectedVersion: task.version,
          }),
          method: 'POST',
        });
      else if (actionId === 'queue' && task) {
        const milestone = taskMilestones.find(
          ({ sequence }) =>
            sequence === task.currentMilestoneSequence + queue.length + 1,
        );
        if (!milestone) throw new Error('没有可按序完成的下一强制节点');
        setQueue((current) => [
          ...current,
          {
            commandType: 'MILESTONE',
            deviceSequence: task.lastOfflineSequence + current.length + 1,
            payload: {
              evidenceSnapshot: {
                photo: true,
                scan: true,
                signature: milestone.code === 'POD',
              },
              locationSnapshot: { source: 'DEVICE_GPS' },
              milestoneId: milestone.id,
              occurredAt: new Date().toISOString(),
            },
          },
        ]);
        setNotice(`节点 ${milestone.code} 已加入离线队列，等待按序同步`);
        return;
      } else if (actionId === 'sync' && task) {
        if (!queue.length) throw new Error('离线队列为空');
        await request(
          `/api/v1/tms/tracking/driver-tasks/${task.id}/offline-sync`,
          {
            body: JSON.stringify({
              commands: queue,
              deviceId: task.deviceId,
              expectedVersion: task.version,
            }),
            method: 'POST',
          },
        );
        setQueue([]);
      } else if (actionId === 'position' && shipment) {
        const activeAssignment = view.assignments.find(
          (row) =>
            row.shipmentId === shipment.id && row.status === 'DISPATCHED',
        );
        if (!activeAssignment) throw new Error('缺少已发运车辆指派');
        await request(
          `/api/v1/tms/tracking/shipments/${shipment.id}/positions`,
          {
            body: JSON.stringify({
              accuracyMeters: '12',
              latitude: '31.2001',
              longitude: '121.4001',
              rawSnapshot: { provider: 'BROWSER_GPS' },
              recordedAt: new Date().toISOString(),
              source: 'MOBILE',
              sourceEventId: crypto.randomUUID(),
              speedKph: '35',
              vehicleAssignmentId: activeAssignment.id,
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'eta' && shipment) {
        const shipmentTask = view.driverTasks.find(
          (candidate) => candidate.shipmentId === shipment.id,
        );
        const milestone = view.milestones.find(
          (row) =>
            row.status === 'PLANNED' &&
            row.milestonePlanId === shipmentTask?.milestonePlanId,
        );
        if (!milestone) throw new Error('缺少待预测的运输节点');
        await request(`/api/v1/tms/tracking/shipments/${shipment.id}/eta`, {
          body: JSON.stringify({
            averageSpeedKph: '55',
            milestoneId: milestone.id,
            trafficFactor: '1.15',
          }),
          method: 'POST',
        });
      }
      setNotice('司机跟踪动作已完成，设备事件与运输事实已保存');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '司机跟踪动作失败');
    }
  }

  const grid = <T extends RowBase>(
    rows: readonly T[],
    selectedId: string,
    setSelectedId: (id: string) => void,
    columns: readonly { key: keyof T & string; label: string }[],
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
    <Card title="节点计划、司机移动端与在途 ETA">
      <Typography.Paragraph>
        司机设备绑定后可接单、导航、签到、拍照、扫描、异常和签收；断网动作保留设备序号，恢复网络后只允许按序同步。
      </Typography.Paragraph>
      <Space wrap>
        <Tag color={queue.length ? 'orange' : 'green'}>
          离线队列 {queue.length}
        </Tag>
        <Tag>绑定设备 {task?.deviceId ?? deviceId}</Tag>
        <Tag color="blue">GPS 漂移/重复点清洗</Tag>
        <Tag color="purple">围栏手工冲突并存</Tag>
      </Space>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="调度：运单、派车与司机任务">
            {grid(view.shipments, shipmentId, setShipmentId, [
              { key: 'shipmentNo', label: '运单号' },
              { key: 'status', label: '状态' },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.assignments, assignmentId, setAssignmentId, [
              { key: 'assignmentNo', label: '派车单号' },
              { key: 'status', label: '状态' },
            ])}
            {grid(view.driverTasks, taskId, setTaskId, [
              { key: 'taskNo', label: '司机任务' },
              { key: 'status', label: '状态' },
              { key: 'lastOfflineSequence', label: '同步序号' },
              { key: 'version', label: '版本' },
            ])}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="司机：强制节点、轨迹与 ETA">
            <DataGrid
              columns={[
                { key: 'sequence', label: '顺序' },
                { key: 'code', label: '节点' },
                { key: 'mandatory', label: '强制' },
                { key: 'plannedAt', label: '计划时间' },
                {
                  key: 'status',
                  label: '状态',
                  render: (value) => <StatusBadge status={String(value)} />,
                },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={200}
              rows={taskMilestones}
              selectedIds={[]}
              total={taskMilestones.length}
            />
            <DataGrid
              columns={[
                { key: 'source', label: '轨迹来源' },
                { key: 'recordedAt', label: '采集时间' },
                { key: 'status', label: '清洗结果' },
                { key: 'rejectionReason', label: '拒绝原因' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={20}
              rows={view.positionPoints.slice(0, 20)}
              selectedIds={[]}
              total={view.positionPoints.length}
            />
          </Card>
        </Col>
      </Row>
    </Card>
  );
}
