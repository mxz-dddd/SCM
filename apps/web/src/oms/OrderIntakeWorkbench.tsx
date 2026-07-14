import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Col, Input, Row, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface OrderRow {
  channel: string;
  externalOrderNo: string | null;
  id: string;
  orderNo: string;
  priority: number;
  status: 'DRAFT' | 'INVALID' | 'OPEN' | 'APPROVED' | 'REJECTED' | 'HOLD' | 'ALLOCATED' | 'RELEASED';
  type: string;
  validationErrors: readonly { field: string; message: string }[];
  version: number;
}

interface OrderLineRow {
  baseUom: string | null;
  id: string;
  lineNo: number;
  originalUom: string | null;
  productId: string | null;
  quantityBase: string | null;
  quantityOriginal: string | null;
}

interface OrderVersionRow {
  changeReason: string;
  createdAt: string;
  id: string;
  versionNumber: number;
}

interface DuplicateCaseRow {
  createdAt: string;
  externalOrderNo: string;
  id: string;
  status: string;
}

interface OrderDetail extends OrderRow {
  allocations: AllocationRow[];
  asns: AsnRow[];
  collaborations: CollaborationRow[];
  customerId: string | null;
  duplicateCases: DuplicateCaseRow[];
  fulfillmentOrders: FulfillmentRow[];
  holds: GovernanceRow[];
  lines: OrderLineRow[];
  mergeMemberships: GovernanceRow[];
  priorityDecisions: GovernanceRow[];
  reviews: GovernanceRow[];
  shipmentRequests: ShipmentRequestRow[];
  sourcingDecisions: SourcingDecisionRow[];
  splitRelations: GovernanceRow[];
  versions: OrderVersionRow[];
}
interface CollaborationRow extends GovernanceRow { comment: string | null; partnerId: string; type: string }
interface AsnRow extends GovernanceRow { expectedArrival: string; externalAsnNo: string; warehouseId: string }
interface TimelineRow extends GovernanceRow { displayAt: string; eventType: string; fromStatus: string | null; sourceDomain: string; summary: string; toStatus: string | null; traceId: string }

interface FulfillmentRow extends GovernanceRow { fulfillmentNo: string; progressSnapshot: unknown; type: string; warehouseId: string }
interface ShipmentRequestRow extends GovernanceRow { mode: string; requestNo: string; serviceLevel: string | null }

interface AllocationRow extends GovernanceRow {
  baseUom: string;
  failureCode: string | null;
  quantityBase: string;
  version: number;
  warehouseId: string;
}

interface SourcingDecisionRow extends GovernanceRow {
  evaluationTraceId: string;
  exclusions: readonly unknown[];
  ruleSetCode: string;
  ruleSetVersionNumber: number;
  selectedCandidateId: string | null;
}

interface GovernanceRow {
  businessOrderId?: string;
  childBusinessRef?: string;
  createdAt: string;
  findings?: unknown;
  holdType?: string;
  id: string;
  priority?: number;
  reason?: string;
  status: string;
}

interface ListResponse {
  items: OrderRow[];
  page: number;
  pageSize: number;
  total: number;
}

const actions = createActionRegistry<OrderRow['status'] | 'NONE'>([
  {
    allowedStatuses: ['DRAFT', 'INVALID', 'OPEN', 'APPROVED', 'REJECTED', 'HOLD', 'ALLOCATED', 'RELEASED', 'NONE'],
    id: 'create-manual',
    label: '新建人工草稿',
    requiredPermissions: ['oms.order.write'],
  },
  {
    allowedStatuses: ['OPEN', 'APPROVED', 'ALLOCATED', 'RELEASED'],
    id: 'partner-confirm',
    label: '记录伙伴确认',
    requiredPermissions: ['oms.partner.collaborate'],
  },
  {
    allowedStatuses: ['APPROVED', 'ALLOCATED', 'RELEASED'],
    id: 'submit-asn',
    label: '提交供应商 ASN',
    requiredPermissions: ['oms.asn.write'],
  },
  {
    allowedStatuses: ['APPROVED'],
    confirmMessage: '将按已发布规则评估候选仓并原子预占可用量。',
    id: 'allocate',
    label: '执行 ATP 分配',
    requiredPermissions: ['oms.order.allocate'],
  },
  {
    allowedStatuses: ['ALLOCATED'],
    confirmMessage: '释放将归还库存投影可用量并发送跨域释放事件。',
    id: 'release-allocation',
    label: '释放预占',
    requiredPermissions: ['oms.allocation.release'],
  },
  {
    allowedStatuses: ['ALLOCATED'],
    confirmMessage: '将校验营业日与截单时间，生成履约单和运输需求后释放订单。',
    id: 'release-order',
    label: '释放履约',
    requiredPermissions: ['oms.order.release'],
  },
  {
    allowedStatuses: ['ALLOCATED'],
    confirmMessage: '将分别校验所选订单，失败成员保留原因且不回滚成功成员。',
    id: 'release-batch',
    label: '批量释放',
    requiredPermissions: ['oms.order.release.batch'],
  },
  {
    allowedStatuses: ['DRAFT', 'INVALID', 'OPEN', 'APPROVED', 'REJECTED', 'HOLD', 'ALLOCATED', 'RELEASED', 'NONE'],
    id: 'release-auto',
    label: '日历自动释放',
    requiredPermissions: ['oms.order.release.auto'],
  },
  {
    allowedStatuses: ['DRAFT', 'INVALID'],
    confirmMessage: '提交后将执行字段与业务规则校验。',
    id: 'submit',
    label: '校验并提交',
    requiredPermissions: ['oms.order.submit'],
  },
  {
    allowedStatuses: ['OPEN'],
    confirmMessage: '将按金额、信用和风险标记执行自动或人工审核路由。',
    id: 'review',
    label: '执行风险审核',
    requiredPermissions: ['oms.order.review'],
  },
  {
    allowedStatuses: ['OPEN', 'APPROVED', 'HOLD'],
    id: 'priority',
    label: '提升优先级',
    requiredPermissions: ['oms.order.priority'],
  },
  {
    allowedStatuses: ['OPEN', 'APPROVED'],
    confirmMessage: '冻结将阻止订单进入后续释放流程。',
    id: 'hold',
    label: '冻结订单',
    requiredPermissions: ['oms.order.hold'],
  },
  {
    allowedStatuses: ['HOLD'],
    confirmMessage: '解除冻结需要记录原因并保留释放事实。',
    id: 'release-hold',
    label: '解除冻结',
    requiredPermissions: ['oms.order.hold.release'],
  },
  {
    allowedStatuses: ['OPEN', 'APPROVED'],
    id: 'merge',
    label: '合并选中订单',
    requiredPermissions: ['oms.order.adjust'],
  },
  {
    allowedStatuses: ['INVALID'],
    confirmMessage: '仅警告可被强制通过；字段错误仍会阻止订单打开。',
    id: 'submit-with-warnings',
    label: '强制通过警告',
    requiredPermissions: ['oms.order.warning.override'],
  },
]);

export function OrderIntakeWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [response, setResponse] = useState<ListResponse>({
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
  });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<OrderDetail>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [ruleSetCode, setRuleSetCode] = useState('ORDER_ALLOCATION_DEFAULT');
  const [releaseCalendarCode, setReleaseCalendarCode] = useState('DEFAULT_OPERATIONS');
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'oms.order.read',
              'oms.order.write',
              'oms.order.submit',
              'oms.order.warning.override',
              'oms.order.review',
              'oms.order.approve',
              'oms.order.adjust',
              'oms.order.priority',
              'oms.order.hold',
              'oms.order.hold.release',
              'oms.availability.read',
              'oms.order.allocate',
              'oms.allocation.release',
              'oms.order.release',
              'oms.order.release.batch',
              'oms.order.release.auto',
              'oms.partner.collaborate',
              'oms.asn.write',
            ]
          : [],
      ),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用订单接入工作台');
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
      const body = (await response.json()) as { code?: string; message?: string };
      if (!response.ok)
        throw new Error(`${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '请求失败'}`);
      return body;
    },
    [accessToken, claims],
  );

  const refresh = useCallback(
    async (page = 1) => {
      if (!accessToken || !claims) return;
      const query = new URLSearchParams({ page: String(page), pageSize: '50' });
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
      try {
        setResponse(
          (await request(`/api/v1/oms/orders?${query.toString()}`)) as unknown as ListResponse,
        );
        setError(undefined);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '订单查询失败');
      }
    },
    [accessToken, claims, filters, request],
  );

  useEffect(() => {
    void refresh(1);
  }, [refresh]);

  async function loadDetail(id: string) {
    try {
      const [nextDetail, nextTimeline] = await Promise.all([request(`/api/v1/oms/orders/${id}`), request(`/api/v1/oms/orders/${id}/timeline?timeZone=Asia%2FShanghai`)]);
      setDetail(nextDetail as unknown as OrderDetail);
      setTimeline((nextTimeline as unknown as { items: TimelineRow[] }).items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '订单详情查询失败');
    }
  }

  const selected = response.items.find(({ id }) => id === selectedIds.at(-1));
  const decisions = actions
    .list()
    .map(({ id }) =>
      actions.decide(id, {
        dataScopeAllowed: true,
        permissions,
        status: selected?.status ?? 'NONE',
      }),
    );

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (!decision?.enabled) return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage)) return;
    try {
      if (actionId === 'create-manual') {
        await request('/api/v1/oms/orders', {
          body: JSON.stringify({
            channel: 'MANUAL',
            lines: [],
            mappingVersion: 'manual-v1',
            rawPayload: { capturedAt: new Date().toISOString(), source: 'MANUAL' },
            type: 'SALES',
          }),
          method: 'POST',
        });
        setNotice('人工订单草稿已创建，可通过 API 或后续编辑补充字段');
      } else if (selected && ['submit', 'submit-with-warnings'].includes(actionId)) {
        const result = (await request(`/api/v1/oms/orders/${selected.id}/${actionId}`, {
          body: JSON.stringify({ expectedVersion: selected.version }),
          method: 'POST',
        })) as unknown as { accepted: boolean; fieldErrors: unknown[]; status: string };
        setNotice(
          result.accepted
            ? '订单校验通过并已打开'
            : `订单仍为 ${result.status}，发现 ${result.fieldErrors.length} 个字段错误`,
        );
      } else if (selected && actionId === 'review') {
        const result = (await request(`/api/v1/oms/orders/${selected.id}/review`, {
          body: JSON.stringify({ autoApproveLimit: '10000', expectedVersion: selected.version }),
          method: 'POST',
        })) as unknown as { reviewStatus: string; status: string };
        setNotice(`审核结果：${result.reviewStatus}，订单状态 ${result.status}`);
      } else if (selected && actionId === 'priority') {
        await request(`/api/v1/oms/orders/${selected.id}/priority`, {
          body: JSON.stringify({ expectedVersion: selected.version, factors: { source: 'WORKBENCH' }, priority: 80, ruleVersion: 'workbench-v1' }),
          method: 'POST',
        });
        setNotice('优先级已更新，已执行数量不会参与重新分配');
      } else if (selected && actionId === 'hold') {
        await request(`/api/v1/oms/orders/${selected.id}/holds`, {
          body: JSON.stringify({ expectedVersion: selected.version, holdType: 'OPERATIONS', reason: '工作台人工冻结' }),
          method: 'POST',
        });
        setNotice('订单已冻结');
      } else if (selected && actionId === 'release-hold') {
        const activeHold = detail?.holds.find(({ status }) => status === 'ACTIVE');
        if (!activeHold) throw new Error('未找到可解除的活动冻结');
        await request(`/api/v1/oms/order-holds/${activeHold.id}/release`, {
          body: JSON.stringify({ expectedVersion: selected.version, reason: '工作台人工解冻' }),
          method: 'POST',
        });
        setNotice('订单冻结已解除');
      } else if (selected && actionId === 'merge') {
        const members = response.items
          .filter(({ id }) => selectedIds.includes(id))
          .map(({ id, version }) => ({ expectedVersion: version, orderId: id }));
        if (members.length < 2) throw new Error('请至少选择两张相同客户、地址和币种的订单');
        await request('/api/v1/oms/order-merge-groups', {
          body: JSON.stringify({ members }),
          method: 'POST',
        });
        setNotice('合单组已创建，来源订单映射保持可追溯');
      } else if (selected && actionId === 'allocate') {
        if (!detail?.customerId) throw new Error('订单缺少库存货主标识');
        const result = (await request(`/api/v1/oms/orders/${selected.id}/allocations`, {
          body: JSON.stringify({ expectedVersion: selected.version, ownerId: detail.customerId, ruleSetCode }),
          method: 'POST',
        })) as unknown as { status: string };
        setNotice(result.status === 'FAILED' ? '候选仓不足或并发耗尽，分配已失败且未超卖' : 'ATP 分配与库存预占已完成');
      } else if (selected && actionId === 'release-allocation') {
        const allocation = detail?.allocations.find(({ status }) => status === 'RESERVED');
        if (!allocation) throw new Error('未找到可释放的预占');
        await request(`/api/v1/oms/allocations/${allocation.id}/release`, { body: JSON.stringify({ expectedVersion: allocation.version }), method: 'POST' });
        setNotice('预占已释放，可用量已归还');
      } else if (selected && actionId === 'release-order') {
        await request(`/api/v1/oms/orders/${selected.id}/release`, { body: JSON.stringify({ calendarCode: releaseCalendarCode, expectedVersion: selected.version, mode: 'DIRECT' }), method: 'POST' });
        setNotice('订单已释放，履约单与运输需求已提交');
      } else if (selected && actionId === 'release-batch') {
        const members = response.items.filter(({ id }) => selectedIds.includes(id)).map(({ id, version }) => ({ expectedVersion: version, orderId: id }));
        const result = (await request('/api/v1/oms/order-release-batches', { body: JSON.stringify({ calendarCode: releaseCalendarCode, members }), method: 'POST' })) as unknown as { failedCount: number; processedCount: number };
        setNotice(`批量释放完成：成功 ${result.processedCount}，失败 ${result.failedCount}`);
      } else if (actionId === 'release-auto') {
        const result = (await request('/api/v1/oms/order-release-batches/automatic', { body: JSON.stringify({ calendarCode: releaseCalendarCode, limit: 100 }), method: 'POST' })) as unknown as { failedCount: number; processedCount: number };
        setNotice(`日历自动释放完成：成功 ${result.processedCount}，失败 ${result.failedCount}`);
      } else if (selected && actionId === 'partner-confirm') {
        if (!detail?.customerId) throw new Error('订单缺少伙伴标识');
        await request(`/api/v1/oms/orders/${selected.id}/collaborations`, { body: JSON.stringify({ comment: '工作台伙伴确认', confirmed: true, partnerId: detail.customerId, type: 'CUSTOMER_CONFIRMATION' }), method: 'POST' });
        setNotice('伙伴确认已形成结构化协同事实');
      } else if (selected && actionId === 'submit-asn') {
        const line = detail?.lines[0]; const warehouseId = detail?.allocations.find(({ warehouseId }) => warehouseId)?.warehouseId;
        if (!detail?.customerId || !line?.productId || !line.quantityBase || !line.quantityOriginal || !line.baseUom || !line.originalUom || !warehouseId) throw new Error('ASN 需要伙伴、仓库和完整双单位订单行');
        const expectedArrival = new Date(Date.now() + 60 * 60 * 1000); const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await request(`/api/v1/oms/orders/${selected.id}/asns`, { body: JSON.stringify({ expectedArrival: expectedArrival.toISOString(), expiresAt: expiresAt.toISOString(), externalAsnNo: `ASN-${Date.now()}`, lines: [{ baseUom: line.baseUom, originalUom: line.originalUom, productId: line.productId, quantityBase: line.quantityBase, quantityOriginal: line.quantityOriginal, sourceOrderLineId: line.id }], partnerId: detail.customerId, warehouseId }), method: 'POST' });
        setNotice('ASN 已校验并推送 WMS/AMS');
      }
      await refresh(1);
      if (selected) await loadDetail(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '订单动作失败');
    }
  }

  return (
    <section className="order-intake-workbench">
      <Typography.Title level={2}>多渠道订单接入</Typography.Title>
      <Typography.Paragraph>
        API、EDI、文件、门户和人工订单统一进入草稿模型；原始报文、映射版本、外部编号冲突、字段错误和每次变更版本均可追溯。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <Card title="订单草稿与外部编号">
        <QueryPanel
          fields={[
            { label: '订单号 / 外部单号', name: 'query', quick: true },
            { label: '状态', name: 'status', quick: true },
            { label: '渠道', name: 'channel' },
          ]}
          onQuery={(values) => setFilters(values)}
          onReset={() => setFilters({})}
        />
        <CommandBar actions={decisions} onAction={({ id }) => void execute(id)} />
        <Input aria-label="分配规则集代码" onChange={(event) => setRuleSetCode(event.target.value.toUpperCase())} value={ruleSetCode} />
        <Input aria-label="释放营业日历代码" onChange={(event) => setReleaseCalendarCode(event.target.value.toUpperCase())} value={releaseCalendarCode} />
        <DataGrid
          columns={[
            { key: 'orderNo', label: '订单号' },
            { key: 'externalOrderNo', label: '外部订单号' },
            { key: 'channel', label: '渠道' },
            { key: 'type', label: '类型' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'version', label: '版本' },
          ]}
          onPageChange={(page) => void refresh(page)}
          onSelectionChange={(ids) => {
            const next = ids;
            setSelectedIds(next);
            if (next.at(-1)) void loadDetail(next.at(-1)!);
          }}
          page={response.page}
          pageSize={response.pageSize}
          rows={response.items}
          selectedIds={selectedIds}
          total={response.total}
        />
      </Card>
      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Card title="字段校验与双单位数量">
            <DataGrid
              columns={[
                { key: 'lineNo', label: '行号' },
                { key: 'quantityOriginal', label: '原数量' },
                { key: 'originalUom', label: '原单位' },
                { key: 'quantityBase', label: '基础数量' },
                { key: 'baseUom', label: '基础单位' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.lines ?? []}
              selectedIds={[]}
              total={detail?.lines.length ?? 0}
            />
            {(detail?.validationErrors ?? []).map(({ field, message }) => (
              <Alert key={`${field}-${message}`} message={`${field}: ${message}`} type="error" />
            ))}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="不可变 OrderVersion 与 ChangeSet">
            <DataGrid
              columns={[
                { key: 'versionNumber', label: '版本' },
                { key: 'changeReason', label: '变更原因' },
                { key: 'createdAt', label: '记录时间' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.versions ?? []}
              selectedIds={[]}
              total={detail?.versions.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={24}>
          <Card title="内容冲突 DuplicateCase">
            <DataGrid
              columns={[
                { key: 'externalOrderNo', label: '外部订单号' },
                { key: 'status', label: '处置状态' },
                { key: 'createdAt', label: '发现时间' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.duplicateCases ?? []}
              selectedIds={[]}
              total={detail?.duplicateCases.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="审核风险与人工审批">
            <DataGrid columns={[{ key: 'status', label: '审核状态' }, { key: 'findings', label: '风险发现' }, { key: 'createdAt', label: '审核时间' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={detail?.reviews ?? []} selectedIds={[]} total={detail?.reviews.length ?? 0} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="订单与行级冻结">
            <DataGrid columns={[{ key: 'holdType', label: '冻结类型' }, { key: 'reason', label: '原因' }, { key: 'status', label: '状态' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={detail?.holds ?? []} selectedIds={[]} total={detail?.holds.length ?? 0} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="优先级决策与实物保护">
            <DataGrid columns={[{ key: 'priority', label: '优先级' }, { key: 'status', label: '决策状态' }, { key: 'createdAt', label: '决策时间' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={detail?.priorityDecisions ?? []} selectedIds={[]} total={detail?.priorityDecisions.length ?? 0} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="合拆映射与数量金额守恒">
            <DataGrid columns={[{ key: 'businessOrderId', label: '来源订单' }, { key: 'childBusinessRef', label: '目标业务引用' }, { key: 'status', label: '状态' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={[...(detail?.mergeMemberships ?? []), ...(detail?.splitRelations ?? [])]} selectedIds={[]} total={(detail?.mergeMemberships.length ?? 0) + (detail?.splitRelations.length ?? 0)} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="ATP 快照与不确定性">
            <Typography.Paragraph>可用量按库存、已分配、冻结、安全库存、在途和预计入库汇总；承诺结果固定记录 snapshotAt 与 uncertainty。</Typography.Paragraph>
            <DataGrid columns={[{ key: 'quantityBase', label: '预占基础数量' }, { key: 'baseUom', label: '基础单位' }, { key: 'warehouseId', label: '候选仓' }, { key: 'status', label: '预占状态' }, { key: 'failureCode', label: '失败原因' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={detail?.allocations ?? []} selectedIds={[]} total={detail?.allocations.length ?? 0} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="候选排除与规则版本">
            <DataGrid columns={[{ key: 'ruleSetCode', label: '规则集' }, { key: 'ruleSetVersionNumber', label: '规则版本' }, { key: 'selectedCandidateId', label: '选中候选' }, { key: 'exclusions', label: '排除原因' }, { key: 'evaluationTraceId', label: '评估轨迹' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={detail?.sourcingDecisions ?? []} selectedIds={[]} total={detail?.sourcingDecisions.length ?? 0} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="独立履约单状态机">
            <DataGrid columns={[{ key: 'fulfillmentNo', label: '履约单号' }, { key: 'warehouseId', label: '仓库' }, { key: 'type', label: '类型' }, { key: 'status', label: '状态' }, { key: 'progressSnapshot', label: '进度快照' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={detail?.fulfillmentOrders ?? []} selectedIds={[]} total={detail?.fulfillmentOrders.length ?? 0} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="直运与多段运输需求">
            <DataGrid columns={[{ key: 'requestNo', label: '运输需求号' }, { key: 'mode', label: '运输模式' }, { key: 'serviceLevel', label: '服务等级' }, { key: 'status', label: '状态' }, { key: 'createdAt', label: '生成时间' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={detail?.shipmentRequests ?? []} selectedIds={[]} total={detail?.shipmentRequests.length ?? 0} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="伙伴确认与承诺反馈">
            <DataGrid columns={[{ key: 'partnerId', label: '伙伴' }, { key: 'type', label: '协同类型' }, { key: 'comment', label: '评论' }, { key: 'createdAt', label: '发生时间' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={detail?.collaborations ?? []} selectedIds={[]} total={detail?.collaborations.length ?? 0} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="供应商 ASN 箱托预告">
            <DataGrid columns={[{ key: 'externalAsnNo', label: 'ASN 号' }, { key: 'warehouseId', label: '仓库' }, { key: 'expectedArrival', label: '预计到达' }, { key: 'status', label: '状态' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={detail?.asns ?? []} selectedIds={[]} total={detail?.asns.length ?? 0} />
          </Card>
        </Col>
        <Col span={24}>
          <Card title="跨域订单时间线投影">
            <DataGrid columns={[{ key: 'displayAt', label: '业务时间' }, { key: 'sourceDomain', label: '来源域' }, { key: 'eventType', label: '事件' }, { key: 'fromStatus', label: '原状态' }, { key: 'toStatus', label: '新状态' }, { key: 'summary', label: '摘要' }, { key: 'traceId', label: 'Trace' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={500} rows={timeline} selectedIds={[]} total={timeline.length} />
          </Card>
        </Col>
      </Row>
    </section>
  );
}
