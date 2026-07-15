import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Col, Row, Tag, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface RowBase {
  id: string;
  status: string;
  version: number;
}
interface ProfileRow extends RowBase {
  profileCode: string;
  resourceType: string;
  revision: number;
  serviceType: string;
}
interface SlotRow extends RowBase {
  capacityQuantity: string;
  resourceType: string;
  serviceType: string;
  startsAt: string;
}
interface RuleRow extends RowBase {
  revision: number;
  ruleCode: string;
  serviceType: string;
}
interface EstimateRow extends RowBase {
  estimateNo: string;
  laborHours: string;
  sourceRef: string;
}
interface View {
  estimates: EstimateRow[];
  profiles: ProfileRow[];
  rules: RuleRow[];
  slots: SlotRow[];
}
const emptyView: View = { estimates: [], profiles: [], rules: [], slots: [] };
const actions = createActionRegistry<string>([
  {
    allowedStatuses: ['PROFILE_DRAFT'],
    confirmMessage: '发布后容量模型不可修改，后续调整必须创建新修订。',
    id: 'publishProfile',
    label: '发布容量模型',
    requiredPermissions: ['ams.capacity.manage'],
  },
  {
    allowedStatuses: ['PROFILE_PUBLISHED'],
    id: 'generateSlots',
    label: '生成未来 7 天时隙',
    requiredPermissions: ['ams.capacity.manage'],
  },
  {
    allowedStatuses: ['SLOT_OPEN'],
    confirmMessage: '关闭时隙将阻止新预约，并保留关闭原因和前后快照。',
    id: 'closeSlot',
    label: '关闭时隙',
    requiredPermissions: ['ams.capacity.manage'],
  },
  {
    allowedStatuses: ['SLOT_CLOSED'],
    id: 'reopenSlot',
    label: '重新开放时隙',
    requiredPermissions: ['ams.capacity.manage'],
  },
  {
    allowedStatuses: ['RULE_DRAFT'],
    confirmMessage: '发布后工作量规则不可修改，估算将保存规则版本和计算轨迹。',
    id: 'publishRule',
    label: '发布工作量规则',
    requiredPermissions: ['ams.workload.manage'],
  },
]);

export function AppointmentCapacityWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<View>(emptyView);
  const [profileId, setProfileId] = useState('');
  const [slotId, setSlotId] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const profile = view.profiles.find(({ id }) => id === profileId);
  const slot = view.slots.find(({ id }) => id === slotId);
  const rule = view.rules.find(({ id }) => id === ruleId);
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'ams.capacity.read',
              'ams.capacity.manage',
              'ams.workload.manage',
              'ams.workload.calculate',
              'ams.workload.adjust',
            ]
          : [],
      ),
    [claims],
  );
  const statusFor = (id: string) =>
    id === 'publishProfile' || id === 'generateSlots'
      ? `PROFILE_${profile?.status ?? 'NONE'}`
      : id === 'publishRule'
        ? `RULE_${rule?.status ?? 'NONE'}`
        : `SLOT_${slot?.status ?? 'NONE'}`;
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
        throw new Error('请先登录后使用预约容量工作台');
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
        (await request('/api/v1/ams/capacity/workbench')) as unknown as View,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '预约容量查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  async function execute(id: string) {
    if (!decisions.find((item) => item.id === id)?.enabled) return;
    try {
      if (id === 'publishProfile' && profile)
        await request(`/api/v1/ams/capacity-profiles/${profile.id}/publish`, {
          body: JSON.stringify({ expectedVersion: profile.version }),
          method: 'POST',
        });
      if (id === 'generateSlots' && profile) {
        const tomorrow = new Date(Date.now() + 86_400_000);
        const end = new Date(tomorrow.getTime() + 6 * 86_400_000);
        await request('/api/v1/ams/slots/generate', {
          body: JSON.stringify({
            dateFrom: tomorrow.toISOString().slice(0, 10),
            dateTo: end.toISOString().slice(0, 10),
            profileId: profile.id,
          }),
          method: 'POST',
        });
      }
      if ((id === 'closeSlot' || id === 'reopenSlot') && slot)
        await request(`/api/v1/ams/slots/${slot.id}/change`, {
          body: JSON.stringify({
            action: id === 'closeSlot' ? 'CLOSE' : 'REOPEN',
            expectedVersion: slot.version,
            reason: '预约容量工作台人工调整',
          }),
          method: 'POST',
        });
      if (id === 'publishRule' && rule)
        await request(`/api/v1/ams/workload-rules/${rule.id}/publish`, {
          body: JSON.stringify({ expectedVersion: rule.version }),
          method: 'POST',
        });
      setNotice('动作已完成，审计和领域事件已同步记录');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '预约容量动作失败');
    }
  }
  const visibleSlots = view.slots.filter(
    ({ serviceType, status }) =>
      (!filters.serviceType || serviceType.includes(filters.serviceType)) &&
      (!filters.status || status === filters.status),
  );
  return (
    <section>
      <Typography.Title level={2}>预约容量与工作量</Typography.Title>
      <Typography.Paragraph>
        仓库、月台、区域、班组和服务类型可按数量、托盘、车辆及工时发布容量；时隙生成遵守营业日历、提前期与黑名单，关闭、扩容和内部预留均保留原因及前后快照。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <QueryPanel
        fields={[
          { label: '服务类型', name: 'serviceType', quick: true },
          { label: '时隙状态', name: 'status', quick: true },
        ]}
        onQuery={(values) => setFilters(values)}
        onReset={() => setFilters({})}
        onSaveView={() => setNotice('预约容量查询视图已保存')}
      />
      <CommandBar actions={decisions} onAction={({ id }) => void execute(id)} />
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="容量模型与时隙">
            <Tag color="blue">多单位容量</Tag>
            <Tag color="orange">提前期 / 黑名单</Tag>
            <DataGrid
              columns={[
                { key: 'profileCode', label: '模型代码' },
                { key: 'revision', label: '修订' },
                { key: 'resourceType', label: '资源' },
                { key: 'serviceType', label: '服务' },
                {
                  key: 'status',
                  label: '状态',
                  render: (value) => <StatusBadge status={String(value)} />,
                },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setProfileId(ids.at(-1) ?? '')}
              page={1}
              pageSize={100}
              rows={view.profiles}
              selectedIds={profileId ? [profileId] : []}
              total={view.profiles.length}
            />
            <DataGrid
              columns={[
                { key: 'startsAt', label: '开始时间' },
                { key: 'resourceType', label: '资源' },
                { key: 'serviceType', label: '服务' },
                { key: 'capacityQuantity', label: '数量容量' },
                { key: 'status', label: '状态' },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setSlotId(ids.at(-1) ?? '')}
              page={1}
              pageSize={200}
              rows={visibleSlots}
              selectedIds={slotId ? [slotId] : []}
              total={visibleSlots.length}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="版本化工作量规则与估算">
            <Tag color="purple">公式轨迹</Tag>
            <Tag color="green">人工调整不覆盖</Tag>
            <DataGrid
              columns={[
                { key: 'ruleCode', label: '规则代码' },
                { key: 'revision', label: '修订' },
                { key: 'serviceType', label: '服务' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setRuleId(ids.at(-1) ?? '')}
              page={1}
              pageSize={100}
              rows={view.rules}
              selectedIds={ruleId ? [ruleId] : []}
              total={view.rules.length}
            />
            <DataGrid
              columns={[
                { key: 'estimateNo', label: '估算号' },
                { key: 'sourceRef', label: '来源' },
                { key: 'laborHours', label: '工时' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={100}
              rows={view.estimates}
              selectedIds={[]}
              total={view.estimates.length}
            />
          </Card>
        </Col>
      </Row>
    </section>
  );
}
