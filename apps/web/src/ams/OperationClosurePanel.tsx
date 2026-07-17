import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Col, Row, Statistic, Tag, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface RowData {
  id: string;
  status: string;
  version: number;
  [key: string]: unknown;
}
interface View {
  appeals: RowData[];
  appointments: RowData[];
  completions: RowData[];
  events: RowData[];
  noShows: RowData[];
  penalties: RowData[];
}
interface Dashboard {
  metrics: Record<string, number>;
  futureCapacity: RowData[];
}
const emptyView: View = {
  appeals: [],
  appointments: [],
  completions: [],
  events: [],
  noShows: [],
  penalties: [],
};
const actions = createActionRegistry<string>([
  {
    allowedStatuses: ['EVENT_NONE'],
    id: 'docked',
    label: '记录靠台',
    requiredPermissions: ['ams.operation.manage'],
  },
  {
    allowedStatuses: ['EVENT_DOCKED'],
    id: 'start',
    label: '开始作业',
    requiredPermissions: ['ams.operation.manage'],
  },
  {
    allowedStatuses: ['EVENT_STARTED', 'EVENT_RESUMED'],
    id: 'pause',
    label: '暂停作业',
    requiredPermissions: ['ams.operation.manage'],
  },
  {
    allowedStatuses: ['EVENT_PAUSED'],
    id: 'resume',
    label: '恢复作业',
    requiredPermissions: ['ams.operation.manage'],
  },
  {
    allowedStatuses: ['EVENT_STARTED', 'EVENT_RESUMED'],
    id: 'finish',
    label: '完成装卸',
    requiredPermissions: ['ams.operation.manage'],
  },
  {
    allowedStatuses: ['EVENT_COMPLETED'],
    id: 'depart',
    label: '离开月台',
    requiredPermissions: ['ams.operation.manage'],
  },
  {
    allowedStatuses: ['EVENT_DEPARTED'],
    id: 'checkout',
    label: '校验出场',
    requiredPermissions: ['ams.gate.checkout'],
  },
  {
    allowedStatuses: ['APPOINTMENT_CHECKED_OUT'],
    id: 'complete',
    label: '关闭预约',
    requiredPermissions: ['ams.operation.manage'],
  },
  {
    allowedStatuses: ['APPOINTMENT_CONFIRMED'],
    id: 'noShow',
    label: '标记爽约',
    requiredPermissions: ['ams.noshow.manage'],
  },
  {
    allowedStatuses: ['NOSHOW_OPEN'],
    id: 'appeal',
    label: '提交申诉',
    requiredPermissions: ['ams.noshow.appeal'],
  },
  {
    allowedStatuses: ['NOSHOW_APPEALED'],
    id: 'waive',
    label: '批准豁免',
    requiredPermissions: ['ams.noshow.waive'],
  },
]);

export function OperationClosurePanel() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<View>(emptyView);
  const [dashboard, setDashboard] = useState<Dashboard>({
    futureCapacity: [],
    metrics: {},
  });
  const [appointmentId, setAppointmentId] = useState('');
  const [noShowId, setNoShowId] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const appointment = view.appointments.find(({ id }) => id === appointmentId);
  const noShow = view.noShows.find(({ id }) => id === noShowId);
  const appointmentEvents = view.events
    .filter((event) => event.appointmentId === appointmentId)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));
  const lastEvent = appointmentEvents.at(-1);
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'ams.operation.read',
              'ams.operation.manage',
              'ams.gate.checkout',
              'ams.noshow.manage',
              'ams.noshow.appeal',
              'ams.noshow.waive',
              'ams.dashboard.read',
            ]
          : [],
      ),
    [claims],
  );
  const statusFor = (id: string) =>
    id === 'appeal' || id === 'waive'
      ? `NOSHOW_${noShow?.status ?? 'NONE'}`
      : ['complete', 'noShow'].includes(id)
        ? `APPOINTMENT_${appointment?.status ?? 'NONE'}`
        : `EVENT_${lastEvent?.eventType ?? 'NONE'}`;
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
        throw new Error('请先登录后使用作业闭环工作台');
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
      const [workbench, metrics] = await Promise.all([
        request('/api/v1/ams/operations/workbench'),
        request('/api/v1/ams/operations/dashboard'),
      ]);
      setView(workbench as unknown as View);
      setDashboard(metrics as unknown as Dashboard);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '作业闭环查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);
  async function execute(id: string) {
    if (!decisions.find((decision) => decision.id === id)?.enabled) return;
    try {
      const eventType = {
        docked: 'DOCKED',
        start: 'STARTED',
        pause: 'PAUSED',
        resume: 'RESUMED',
        finish: 'COMPLETED',
        depart: 'DEPARTED',
      }[id];
      if (eventType && appointment)
        await request(
          `/api/v1/ams/operations/appointments/${appointment.id}/events`,
          {
            body: JSON.stringify({
              businessLinks: { wmsTaskRefs: [], tmsTaskRefs: [] },
              eventType,
              evidenceSnapshot: { source: 'WEB_WORKBENCH' },
              expectedVersion: appointment.version,
              occurredAt: new Date().toISOString(),
              quantity:
                eventType === 'COMPLETED' || eventType === 'DEPARTED'
                  ? String(appointment.workloadQuantity ?? '0')
                  : '0',
              quantityUom: String(appointment.workloadQuantityUom ?? 'EA'),
              reason: `现场工作台：${eventType}`,
            }),
            method: 'POST',
          },
        );
      if (id === 'checkout' && appointment)
        await request(
          `/api/v1/ams/operations/appointments/${appointment.id}/check-out`,
          {
            body: JSON.stringify({
              documents: { refs: [], valid: true },
              evidenceSnapshot: { gate: 'WEB-GATE' },
              exceptions: { openCount: 0 },
              expectedVersion: appointment.version,
              occurredAt: new Date().toISOString(),
              seal: { valid: true },
            }),
            method: 'POST',
          },
        );
      if (id === 'complete' && appointment)
        await request(
          `/api/v1/ams/operations/appointments/${appointment.id}/complete`,
          {
            body: JSON.stringify({ expectedVersion: appointment.version }),
            method: 'POST',
          },
        );
      if (id === 'noShow' && appointment)
        await request(
          `/api/v1/ams/operations/appointments/${appointment.id}/no-show`,
          {
            body: JSON.stringify({
              contractSnapshot: { source: 'WORKBENCH' },
              expectedVersion: appointment.version,
              graceMinutes: 30,
              notificationSnapshot: { channels: ['APP'] },
              observedAt: new Date().toISOString(),
              penalty: { amount: '0', currency: 'CNY', shouldCharge: false },
              reason: '超过宽限期未到场',
            }),
            method: 'POST',
          },
        );
      if (id === 'appeal' && noShow)
        await request(`/api/v1/ams/operations/no-shows/${noShow.id}/appeals`, {
          body: JSON.stringify({
            evidenceSnapshot: {},
            expectedVersion: noShow.version,
            reason: '现场提交爽约申诉',
          }),
          method: 'POST',
        });
      if (id === 'waive' && noShow) {
        const appeal = view.appeals.find(
          (item) => item.noShowCaseId === noShow.id,
        );
        if (!appeal) throw new Error('未找到待决申诉');
        await request(`/api/v1/ams/operations/appeals/${appeal.id}/decide`, {
          body: JSON.stringify({
            decision: 'WAIVED',
            expectedCaseVersion: noShow.version,
            reason: '现场主管批准豁免',
          }),
          method: 'POST',
        });
      }
      setNotice('作业闭环动作已完成，实际时长与绩效事实已更新');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '作业闭环动作失败');
    }
  }
  const grid = (
    rows: RowData[],
    selected: string,
    select: (id: string) => void,
    columns: { key: string; label: string }[],
  ) => (
    <DataGrid
      columns={columns.map((column) =>
        column.key === 'status'
          ? {
              ...column,
              render: (value: unknown) => (
                <StatusBadge status={String(value)} />
              ),
            }
          : column,
      )}
      onPageChange={() => undefined}
      onSelectionChange={(ids) => select(ids.at(-1) ?? '')}
      page={1}
      pageSize={200}
      rows={rows}
      selectedIds={selected ? [selected] : []}
      total={rows.length}
    />
  );
  const metricCards: readonly (readonly [string, string])[] = [
    ['今日预约', 'appointments'],
    ['排队', 'queued'],
    ['占用月台', 'dockOccupied'],
    ['平均等待(分)', 'averageWaitingMinutes'],
    ['平均作业(分)', 'averageOperatingMinutes'],
    ['爽约', 'noShows'],
  ];
  return (
    <Card title="装卸作业、出场关闭、爽约与现场容量">
      <Typography.Paragraph>
        作业事件按时间单调追加并关联 WMS/TMS
        公开业务引用；出场原子释放月台，关闭发布实际时长。爽约罚金保持原始事实，申诉豁免通过追加决策生效。
      </Typography.Paragraph>
      <Tag color="blue">作业事件不可变</Tag>
      <Tag color="green">出场释放月台</Tag>
      <Tag color="orange">罚金不覆盖</Tag>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <Row gutter={8}>
        {metricCards.map(([title, key]) => (
          <Col key={key} span={4}>
            <Statistic title={title} value={dashboard.metrics[key] ?? 0} />
          </Col>
        ))}
      </Row>
      <CommandBar actions={decisions} onAction={({ id }) => void execute(id)} />
      {grid(view.appointments, appointmentId, setAppointmentId, [
        { key: 'appointmentNo', label: '预约号' },
        { key: 'requesterPartyRef', label: '客户/承运商' },
        { key: 'serviceType', label: '业务类型' },
        { key: 'status', label: '状态' },
        { key: 'version', label: '版本' },
      ])}
      {grid(appointmentEvents, '', () => undefined, [
        { key: 'sequence', label: '序号' },
        { key: 'eventType', label: '作业事件' },
        { key: 'occurredAt', label: '发生时间' },
        { key: 'quantity', label: '数量' },
      ])}
      {grid(view.noShows, noShowId, setNoShowId, [
        { key: 'appointmentId', label: '预约' },
        { key: 'detectedAt', label: '识别时间' },
        { key: 'graceMinutes', label: '宽限(分)' },
        { key: 'status', label: '申诉状态' },
        { key: 'version', label: '版本' },
      ])}
      {grid(dashboard.futureCapacity, '', () => undefined, [
        { key: 'startsAt', label: '未来时隙' },
        { key: 'serviceType', label: '业务类型' },
        { key: 'status', label: '状态' },
        { key: 'version', label: '版本' },
      ])}
    </Card>
  );
}
