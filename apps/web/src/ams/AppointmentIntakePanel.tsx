import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Tag, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface AppointmentRow {
  appointmentNo: string;
  id: string;
  requesterPartyRef: string;
  serviceType: string;
  status: string;
  type: string;
  version: number;
}
interface OccurrenceRow {
  conflictReason: string | null;
  id: string;
  occurrenceDate: string;
  status: string;
}
interface SlotRow {
  endsAt: string;
  id: string;
  serviceType: string;
  startsAt: string;
  status: string;
  version: number;
  warehouseRef: string;
}
interface AppointmentView {
  appointments: AppointmentRow[];
  occurrences: OccurrenceRow[];
}
const actions = createActionRegistry<string>([
  {
    id: 'createLinked',
    label: '照单预约',
    requiredPermissions: ['ams.appointment.create'],
  },
  {
    id: 'createUnlinked',
    label: '无单预约',
    requiredPermissions: ['ams.appointment.create'],
  },
  {
    id: 'createRecurring',
    label: '创建循环预约',
    requiredPermissions: ['ams.appointment.recurring'],
  },
  {
    allowedStatuses: ['PENDING'],
    confirmMessage: '确认预约后，待审批容量将转为已使用容量。',
    id: 'approve',
    label: '审批确认',
    requiredPermissions: ['ams.appointment.approve'],
  },
  {
    allowedStatuses: ['PENDING'],
    confirmMessage: '拒绝预约将释放其待审批容量。',
    id: 'reject',
    label: '审批拒绝',
    requiredPermissions: ['ams.appointment.approve'],
  },
]);

export function AppointmentIntakePanel() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<AppointmentView>({
    appointments: [],
    occurrences: [],
  });
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const selected = view.appointments.find(({ id }) => id === selectedId);
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'ams.appointment.read',
              'ams.appointment.create',
              'ams.appointment.recurring',
              'ams.appointment.approve',
            ]
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
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用预约受理工作台');
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
      const [appointments, capacity] = await Promise.all([
        request('/api/v1/ams/appointments/workbench'),
        request('/api/v1/ams/capacity/workbench'),
      ]);
      setView(appointments as unknown as AppointmentView);
      setSlots(
        (capacity as unknown as { slots: SlotRow[] }).slots.filter(
          ({ status }) => status === 'OPEN',
        ),
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '预约受理查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  async function execute(id: string) {
    const decision = decisions.find((item) => item.id === id);
    if (!decision?.enabled) return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage))
      return;
    try {
      const slot = slots[0];
      if (id.startsWith('create') && !slot)
        throw new Error('请先生成可用时隙');
      if ((id === 'approve' || id === 'reject') && selected)
        await request(`/api/v1/ams/appointments/${selected.id}/decide`, {
          body: JSON.stringify({
            decision: id === 'approve' ? 'APPROVE' : 'REJECT',
            expectedVersion: selected.version,
            reason: id === 'approve' ? '预约主管审核通过' : '预约资料不完整',
          }),
          method: 'POST',
        });
      if ((id === 'createLinked' || id === 'createUnlinked') && slot) {
        const linked = id === 'createLinked';
        const now = Date.now();
        await request('/api/v1/ams/appointments', {
          body: JSON.stringify({
            approvalPolicy: {
              customerRequiresApproval: false,
              requiresApprovalServiceTypes: [],
            },
            orderLinks: linked
              ? [
                  {
                    bookableQuantityBase: '100',
                    packageSpecSnapshot: { version: 1 },
                    quantity: '10',
                    quantityBase: '10',
                    quantityBaseUom: 'EA',
                    quantityUom: 'EA',
                    sourceLineRef: '1',
                    sourceRef: `DEMO-ORDER-${now}`,
                    sourceSnapshot: { orderNo: `DEMO-ORDER-${now}` },
                    sourceType: 'INBOUND',
                  },
                ]
              : [],
            requesterPartyRef: 'DEMO-PARTNER',
            requesterSnapshot: { name: '演示预约方' },
            requestedWindowFrom: slot.startsAt,
            requestedWindowTo: slot.endsAt,
            serviceType: slot.serviceType,
            slotVersion: slot.version,
            timeSlotId: slot.id,
            type: linked ? 'ORDER_LINKED' : 'UNLINKED',
            urgent: false,
            vehicleSnapshot: { plateNumber: '沪A-DEMO1' },
            warehouseRef: slot.warehouseRef,
            workload: {
              laborHours: '0.5',
              pallets: '1',
              quantity: '10',
              quantityUom: 'EA',
              vehicles: '1',
            },
          }),
          method: 'POST',
        });
      }
      if (id === 'createRecurring' && slot) {
        const start = new Date(slot.startsAt);
        const end = new Date(start.getTime() + 28 * 86_400_000);
        await request('/api/v1/ams/recurring-appointments', {
          body: JSON.stringify({
            effectiveFrom: start.toISOString().slice(0, 10),
            effectiveUntil: end.toISOString().slice(0, 10),
            intervalWeeks: 1,
            requesterPartyRef: 'DEMO-PARTNER',
            requesterSnapshot: { name: '演示长期预约方' },
            serviceType: slot.serviceType,
            slotStartTime: slot.startsAt.slice(11, 16),
            vehicleSnapshot: { plateNumber: '沪A-DEMO2' },
            warehouseRef: slot.warehouseRef,
            weekdays: [start.getUTCDay()],
            workload: {
              laborHours: '0.5',
              pallets: '1',
              quantity: '10',
              quantityUom: 'EA',
              vehicles: '1',
            },
          }),
          method: 'POST',
        });
      }
      setNotice('预约动作已完成；容量、审批和实例结果已更新');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '预约动作失败');
    }
  }
  return (
    <Card title="预约受理、并发占用与审批">
      <Typography.Paragraph>
        照单预约按来源行校验剩余可预约量；无单预约强制人工审批；循环规则逐实例占容量，节假日或冲突实例保持待确认。查询仅展示剩余容量和时隙版本，最终提交再次原子校验。
      </Typography.Paragraph>
      <Tag color="blue">版本条件占用</Tag>
      <Tag color="orange">无单严格审批</Tag>
      <Tag color="purple">循环逐实例</Tag>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar actions={decisions} onAction={({ id }) => void execute(id)} />
      <DataGrid
        columns={[
          { key: 'appointmentNo', label: '预约号' },
          { key: 'type', label: '类型' },
          { key: 'requesterPartyRef', label: '预约方' },
          { key: 'serviceType', label: '服务' },
          {
            key: 'status',
            label: '状态',
            render: (value) => <StatusBadge status={String(value)} />,
          },
          { key: 'version', label: '版本' },
        ]}
        onPageChange={() => undefined}
        onSelectionChange={(ids) => setSelectedId(ids.at(-1) ?? '')}
        page={1}
        pageSize={200}
        rows={view.appointments}
        selectedIds={selectedId ? [selectedId] : []}
        total={view.appointments.length}
      />
      <DataGrid
        columns={[
          { key: 'occurrenceDate', label: '循环实例日期' },
          { key: 'status', label: '实例状态' },
          { key: 'conflictReason', label: '待确认原因' },
        ]}
        onPageChange={() => undefined}
        onSelectionChange={() => undefined}
        page={1}
        pageSize={200}
        rows={view.occurrences}
        selectedIds={[]}
        total={view.occurrences.length}
      />
    </Card>
  );
}
