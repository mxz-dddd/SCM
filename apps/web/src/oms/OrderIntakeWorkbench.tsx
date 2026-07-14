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
  status:
    | 'DRAFT'
    | 'INVALID'
    | 'OPEN'
    | 'APPROVED'
    | 'REJECTED'
    | 'HOLD'
    | 'ALLOCATED'
    | 'RELEASED'
    | 'CANCELLED';
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
  backorders: BackorderRow[];
  changeConfirmations: ChangeConfirmationRow[];
  collaborations: CollaborationRow[];
  customerId: string | null;
  duplicateCases: DuplicateCaseRow[];
  exceptionCases: ExceptionCaseRow[];
  fulfillmentOrders: FulfillmentRow[];
  holds: GovernanceRow[];
  lines: OrderLineRow[];
  lineProgress: ProgressRow[];
  mergeMemberships: GovernanceRow[];
  priorityDecisions: GovernanceRow[];
  orderChanges: OrderChangeRow[];
  reviews: GovernanceRow[];
  rmas: RmaRow[];
  shipmentRequests: ShipmentRequestRow[];
  slaClocks: SlaClockRow[];
  sourcingDecisions: SourcingDecisionRow[];
  splitRelations: GovernanceRow[];
  settlementRequests: SettlementRow[];
  substitutions: SubstitutionRow[];
  versions: OrderVersionRow[];
}
interface ExceptionCaseRow extends GovernanceRow {
  assignedTo: string | null;
  exceptionType: string;
  responsibleDomain: string;
  severity: string;
  version: number;
}
interface SlaClockRow extends GovernanceRow {
  dueAt: string;
  responsibleDomain: string;
  stage: string;
  warningAt: string;
  version: number;
}
interface SettlementRow extends GovernanceRow {
  currency: string;
  requestNo: string;
  requestedAmount: string;
  version: number;
}
interface OrderChangeRow extends GovernanceRow {
  impactAssessment: unknown;
  requiredDomains: string[];
  version: number;
}
interface ChangeConfirmationRow extends GovernanceRow {
  domain: string;
  orderChangeId: string;
}
interface ProgressRow extends GovernanceRow {
  allocatedBase: string;
  cancelledBase: string;
  deliveredBase: string;
  orderLineId: string;
  promisedBase: string;
  shippedBase: string;
}
interface BackorderRow extends GovernanceRow {
  disposition: string;
  orderLineId: string;
  quantityBase: string;
}
interface SubstitutionRow extends GovernanceRow {
  originalProductId: string;
  replacementProductId: string;
  respondBy: string;
  version: number;
}
interface RmaRow extends GovernanceRow {
  resolution: string | null;
  returnBy: string;
  rmaNo: string;
  version: number;
}
interface CollaborationRow extends GovernanceRow {
  comment: string | null;
  partnerId: string;
  type: string;
}
interface AsnRow extends GovernanceRow {
  expectedArrival: string;
  externalAsnNo: string;
  warehouseId: string;
}
interface TimelineRow extends GovernanceRow {
  displayAt: string;
  eventType: string;
  fromStatus: string | null;
  sourceDomain: string;
  summary: string;
  toStatus: string | null;
  traceId: string;
}

interface FulfillmentRow extends GovernanceRow {
  fulfillmentNo: string;
  progressSnapshot: unknown;
  type: string;
  warehouseId: string;
}
interface ShipmentRequestRow extends GovernanceRow {
  mode: string;
  requestNo: string;
  serviceLevel: string | null;
}

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
    allowedStatuses: [
      'DRAFT',
      'INVALID',
      'OPEN',
      'APPROVED',
      'REJECTED',
      'HOLD',
      'ALLOCATED',
      'RELEASED',
      'NONE',
    ],
    id: 'create-manual',
    label: '新建人工草稿',
    requiredPermissions: ['oms.order.write'],
  },
  {
    allowedStatuses: [
      'DRAFT',
      'INVALID',
      'OPEN',
      'APPROVED',
      'REJECTED',
      'HOLD',
      'ALLOCATED',
      'RELEASED',
      'CANCELLED',
      'NONE',
    ],
    id: 'detect-exceptions',
    label: '聚合订单异常',
    requiredPermissions: ['oms.exception.write'],
  },
  {
    allowedStatuses: ['OPEN', 'APPROVED', 'ALLOCATED', 'RELEASED'],
    id: 'start-sla',
    label: '启动 SLA 时钟',
    requiredPermissions: ['oms.sla.write'],
  },
  {
    allowedStatuses: [
      'DRAFT',
      'INVALID',
      'OPEN',
      'APPROVED',
      'REJECTED',
      'HOLD',
      'ALLOCATED',
      'RELEASED',
      'CANCELLED',
    ],
    id: 'assign-exceptions',
    label: '批量指派异常',
    requiredPermissions: ['oms.exception.assign'],
  },
  {
    allowedStatuses: [
      'DRAFT',
      'INVALID',
      'OPEN',
      'APPROVED',
      'REJECTED',
      'HOLD',
      'ALLOCATED',
      'RELEASED',
      'CANCELLED',
    ],
    id: 'retry-exceptions',
    label: '批量重试异常',
    requiredPermissions: ['oms.exception.retry'],
  },
  {
    allowedStatuses: [
      'DRAFT',
      'INVALID',
      'OPEN',
      'APPROVED',
      'REJECTED',
      'HOLD',
      'ALLOCATED',
      'RELEASED',
      'CANCELLED',
      'NONE',
    ],
    id: 'monitor-sla',
    label: '执行 SLA 监控',
    requiredPermissions: ['oms.sla.monitor'],
  },
  {
    allowedStatuses: ['RELEASED', 'CANCELLED'],
    id: 'request-settlement',
    label: '生成结算请求',
    requiredPermissions: ['oms.settlement.write'],
  },
  {
    allowedStatuses: ['OPEN', 'APPROVED'],
    id: 'batch-hold',
    label: '批量逐单冻结',
    requiredPermissions: ['oms.order.batch'],
  },
  {
    allowedStatuses: ['OPEN', 'APPROVED', 'ALLOCATED', 'RELEASED', 'CANCELLED'],
    id: 'portal-preview',
    label: '客户门户预览',
    requiredPermissions: ['oms.portal.order.read'],
  },
  {
    allowedStatuses: ['OPEN', 'APPROVED', 'ALLOCATED', 'RELEASED'],
    id: 'partner-confirm',
    label: '记录伙伴确认',
    requiredPermissions: ['oms.partner.collaborate'],
  },
  {
    allowedStatuses: ['OPEN', 'APPROVED', 'ALLOCATED', 'RELEASED'],
    id: 'request-change',
    label: '发起订单变更',
    requiredPermissions: ['oms.order.change'],
  },
  {
    allowedStatuses: ['OPEN', 'APPROVED', 'ALLOCATED', 'RELEASED'],
    id: 'confirm-change',
    label: '确认变更影响',
    requiredPermissions: ['oms.order.change.confirm'],
  },
  {
    allowedStatuses: ['OPEN', 'APPROVED', 'ALLOCATED', 'RELEASED'],
    confirmMessage:
      '取消将按订单状态释放预占，并撤销尚未进入不可逆执行的履约与运输需求。',
    id: 'cancel-order',
    label: '取消订单',
    requiredPermissions: ['oms.order.cancel'],
  },
  {
    allowedStatuses: ['APPROVED', 'ALLOCATED', 'RELEASED'],
    id: 'propose-substitution',
    label: '建议替代品',
    requiredPermissions: ['oms.substitution.write'],
  },
  {
    allowedStatuses: ['RELEASED'],
    id: 'request-rma',
    label: '申请 RMA',
    requiredPermissions: ['oms.rma.write'],
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
    allowedStatuses: [
      'DRAFT',
      'INVALID',
      'OPEN',
      'APPROVED',
      'REJECTED',
      'HOLD',
      'ALLOCATED',
      'RELEASED',
      'NONE',
    ],
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
  const [releaseCalendarCode, setReleaseCalendarCode] =
    useState('DEFAULT_OPERATIONS');
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
              'oms.order.change',
              'oms.order.change.confirm',
              'oms.order.cancel',
              'oms.substitution.write',
              'oms.substitution.decide',
              'oms.rma.write',
              'oms.rma.transition',
              'oms.exception.read',
              'oms.exception.write',
              'oms.exception.assign',
              'oms.exception.retry',
              'oms.sla.write',
              'oms.sla.monitor',
              'oms.settlement.write',
              'oms.order.batch',
              'oms.portal.order.read',
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
      if (!accessToken || !claims)
        throw new Error('请先登录后使用订单接入工作台');
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

  const refresh = useCallback(
    async (page = 1) => {
      if (!accessToken || !claims) return;
      const query = new URLSearchParams({ page: String(page), pageSize: '50' });
      for (const [key, value] of Object.entries(filters))
        if (value) query.set(key, value);
      try {
        setResponse(
          (await request(
            `/api/v1/oms/orders?${query.toString()}`,
          )) as unknown as ListResponse,
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
      const [nextDetail, nextTimeline] = await Promise.all([
        request(`/api/v1/oms/orders/${id}`),
        request(`/api/v1/oms/orders/${id}/timeline?timeZone=Asia%2FShanghai`),
      ]);
      setDetail(nextDetail as unknown as OrderDetail);
      setTimeline((nextTimeline as unknown as { items: TimelineRow[] }).items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '订单详情查询失败');
    }
  }

  const selected = response.items.find(({ id }) => id === selectedIds.at(-1));
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selected?.status ?? 'NONE',
    }),
  );

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (!decision?.enabled) return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage))
      return;
    try {
      if (actionId === 'create-manual') {
        await request('/api/v1/oms/orders', {
          body: JSON.stringify({
            channel: 'MANUAL',
            lines: [],
            mappingVersion: 'manual-v1',
            rawPayload: {
              capturedAt: new Date().toISOString(),
              source: 'MANUAL',
            },
            type: 'SALES',
          }),
          method: 'POST',
        });
        setNotice('人工订单草稿已创建，可通过 API 或后续编辑补充字段');
      } else if (actionId === 'detect-exceptions') {
        const result = (await request('/api/v1/oms/order-exceptions/detect', {
          body: JSON.stringify({ stalledMinutes: 240 }),
          method: 'POST',
        })) as unknown as { created: number; detected: number };
        setNotice(
          `异常聚合完成：识别 ${result.detected}，新建 ${result.created}`,
        );
      } else if (selected && actionId === 'assign-exceptions') {
        const members = (detail?.exceptionCases ?? [])
          .filter(({ status }) =>
            ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(status),
          )
          .map(({ id, version }) => ({ caseId: id, expectedVersion: version }));
        if (!members.length) throw new Error('未找到可指派的订单异常');
        const result = (await request('/api/v1/oms/order-exceptions/batch', {
          body: JSON.stringify({
            action: 'ASSIGN',
            assignedTo: claims?.subject,
            members,
          }),
          method: 'POST',
        })) as unknown as { failedCount: number; processedCount: number };
        setNotice(
          `批量指派异常：成功 ${result.processedCount}，失败 ${result.failedCount}`,
        );
      } else if (selected && actionId === 'retry-exceptions') {
        const members = (detail?.exceptionCases ?? [])
          .filter(({ status }) => !['RESOLVED', 'CLOSED'].includes(status))
          .map(({ id, version }) => ({ caseId: id, expectedVersion: version }));
        if (!members.length) throw new Error('未找到可重试的订单异常');
        const result = (await request('/api/v1/oms/order-exceptions/batch', {
          body: JSON.stringify({
            action: 'RETRY',
            members,
            reason: '工作台批量重试',
          }),
          method: 'POST',
        })) as unknown as { failedCount: number; processedCount: number };
        setNotice(
          `批量重试异常：成功 ${result.processedCount}，失败 ${result.failedCount}`,
        );
      } else if (selected && actionId === 'start-sla') {
        await request(`/api/v1/oms/orders/${selected.id}/sla-clocks`, {
          body: JSON.stringify({
            calendarCode: releaseCalendarCode,
            durationMinutes: 1440,
            responsibleDomain: 'OMS',
            sourceVersion: selected.version,
            stage: 'RELEASE',
            warningLeadMinutes: 120,
          }),
          method: 'POST',
        });
        setNotice('订单释放 SLA 时钟已启动');
      } else if (actionId === 'monitor-sla') {
        const result = (await request('/api/v1/oms/sla-clocks/monitor', {
          body: '{}',
          method: 'POST',
        })) as unknown as { breached: number; warning: number };
        setNotice(
          `SLA 监控完成：预警 ${result.warning}，超时 ${result.breached}`,
        );
      } else if (selected && actionId === 'request-settlement') {
        await request(`/api/v1/oms/orders/${selected.id}/settlement-requests`, {
          body: JSON.stringify({
            chargeFacts: [],
            expectedVersion: selected.version,
          }),
          method: 'POST',
        });
        setNotice('订单商业费用与履约事实已固化并发送计费域');
      } else if (actionId === 'batch-hold') {
        const members = response.items
          .filter(({ id }) => selectedIds.includes(id))
          .map(({ id, version }) => ({
            expectedVersion: version,
            orderId: id,
          }));
        const result = (await request('/api/v1/oms/order-batches', {
          body: JSON.stringify({
            action: 'HOLD',
            members,
            reason: '工作台批量冻结',
          }),
          method: 'POST',
        })) as unknown as { failedCount: number; processedCount: number };
        setNotice(
          `逐单鉴权批量冻结：成功 ${result.processedCount}，失败 ${result.failedCount}`,
        );
      } else if (selected && actionId === 'portal-preview') {
        if (!detail?.customerId) throw new Error('订单缺少客户标识');
        await request(
          `/api/v1/oms/portal/orders/${selected.id}?partnerId=${detail.customerId}`,
        );
        setNotice(
          '客户门户视图已通过伙伴范围校验，可查看承诺、履约、轨迹与对账状态',
        );
      } else if (
        selected &&
        ['submit', 'submit-with-warnings'].includes(actionId)
      ) {
        const result = (await request(
          `/api/v1/oms/orders/${selected.id}/${actionId}`,
          {
            body: JSON.stringify({ expectedVersion: selected.version }),
            method: 'POST',
          },
        )) as unknown as {
          accepted: boolean;
          fieldErrors: unknown[];
          status: string;
        };
        setNotice(
          result.accepted
            ? '订单校验通过并已打开'
            : `订单仍为 ${result.status}，发现 ${result.fieldErrors.length} 个字段错误`,
        );
      } else if (selected && actionId === 'review') {
        const result = (await request(
          `/api/v1/oms/orders/${selected.id}/review`,
          {
            body: JSON.stringify({
              autoApproveLimit: '10000',
              expectedVersion: selected.version,
            }),
            method: 'POST',
          },
        )) as unknown as { reviewStatus: string; status: string };
        setNotice(
          `审核结果：${result.reviewStatus}，订单状态 ${result.status}`,
        );
      } else if (selected && actionId === 'priority') {
        await request(`/api/v1/oms/orders/${selected.id}/priority`, {
          body: JSON.stringify({
            expectedVersion: selected.version,
            factors: { source: 'WORKBENCH' },
            priority: 80,
            ruleVersion: 'workbench-v1',
          }),
          method: 'POST',
        });
        setNotice('优先级已更新，已执行数量不会参与重新分配');
      } else if (selected && actionId === 'hold') {
        await request(`/api/v1/oms/orders/${selected.id}/holds`, {
          body: JSON.stringify({
            expectedVersion: selected.version,
            holdType: 'OPERATIONS',
            reason: '工作台人工冻结',
          }),
          method: 'POST',
        });
        setNotice('订单已冻结');
      } else if (selected && actionId === 'release-hold') {
        const activeHold = detail?.holds.find(
          ({ status }) => status === 'ACTIVE',
        );
        if (!activeHold) throw new Error('未找到可解除的活动冻结');
        await request(`/api/v1/oms/order-holds/${activeHold.id}/release`, {
          body: JSON.stringify({
            expectedVersion: selected.version,
            reason: '工作台人工解冻',
          }),
          method: 'POST',
        });
        setNotice('订单冻结已解除');
      } else if (selected && actionId === 'merge') {
        const members = response.items
          .filter(({ id }) => selectedIds.includes(id))
          .map(({ id, version }) => ({
            expectedVersion: version,
            orderId: id,
          }));
        if (members.length < 2)
          throw new Error('请至少选择两张相同客户、地址和币种的订单');
        await request('/api/v1/oms/order-merge-groups', {
          body: JSON.stringify({ members }),
          method: 'POST',
        });
        setNotice('合单组已创建，来源订单映射保持可追溯');
      } else if (selected && actionId === 'allocate') {
        if (!detail?.customerId) throw new Error('订单缺少库存货主标识');
        const result = (await request(
          `/api/v1/oms/orders/${selected.id}/allocations`,
          {
            body: JSON.stringify({
              expectedVersion: selected.version,
              ownerId: detail.customerId,
              ruleSetCode,
            }),
            method: 'POST',
          },
        )) as unknown as { status: string };
        setNotice(
          result.status === 'FAILED'
            ? '候选仓不足或并发耗尽，分配已失败且未超卖'
            : 'ATP 分配与库存预占已完成',
        );
      } else if (selected && actionId === 'release-allocation') {
        const allocation = detail?.allocations.find(
          ({ status }) => status === 'RESERVED',
        );
        if (!allocation) throw new Error('未找到可释放的预占');
        await request(`/api/v1/oms/allocations/${allocation.id}/release`, {
          body: JSON.stringify({ expectedVersion: allocation.version }),
          method: 'POST',
        });
        setNotice('预占已释放，可用量已归还');
      } else if (selected && actionId === 'release-order') {
        await request(`/api/v1/oms/orders/${selected.id}/release`, {
          body: JSON.stringify({
            calendarCode: releaseCalendarCode,
            expectedVersion: selected.version,
            mode: 'DIRECT',
          }),
          method: 'POST',
        });
        setNotice('订单已释放，履约单与运输需求已提交');
      } else if (selected && actionId === 'release-batch') {
        const members = response.items
          .filter(({ id }) => selectedIds.includes(id))
          .map(({ id, version }) => ({
            expectedVersion: version,
            orderId: id,
          }));
        const result = (await request('/api/v1/oms/order-release-batches', {
          body: JSON.stringify({ calendarCode: releaseCalendarCode, members }),
          method: 'POST',
        })) as unknown as { failedCount: number; processedCount: number };
        setNotice(
          `批量释放完成：成功 ${result.processedCount}，失败 ${result.failedCount}`,
        );
      } else if (actionId === 'release-auto') {
        const result = (await request(
          '/api/v1/oms/order-release-batches/automatic',
          {
            body: JSON.stringify({
              calendarCode: releaseCalendarCode,
              limit: 100,
            }),
            method: 'POST',
          },
        )) as unknown as { failedCount: number; processedCount: number };
        setNotice(
          `日历自动释放完成：成功 ${result.processedCount}，失败 ${result.failedCount}`,
        );
      } else if (selected && actionId === 'request-change') {
        await request(`/api/v1/oms/orders/${selected.id}/changes`, {
          body: JSON.stringify({
            expectedVersion: selected.version,
            serviceLevel: 'WORKBENCH_REVIEW',
          }),
          method: 'POST',
        });
        setNotice('变更影响评估已创建，等待各责任域确认');
      } else if (selected && actionId === 'confirm-change') {
        const change = detail?.orderChanges.find(
          ({ status }) => status === 'PENDING_CONFIRMATIONS',
        );
        const confirmation = detail?.changeConfirmations.find(
          ({ orderChangeId, status }) =>
            orderChangeId === change?.id && status === 'PENDING',
        );
        if (!change || !confirmation) throw new Error('未找到待确认的变更影响');
        await request(`/api/v1/oms/order-changes/${change.id}/confirmations`, {
          body: JSON.stringify({
            accepted: true,
            domain: confirmation.domain,
            reason: '工作台确认',
          }),
          method: 'POST',
        });
        setNotice(`已确认 ${confirmation.domain} 域影响`);
      } else if (selected && actionId === 'cancel-order') {
        await request(`/api/v1/oms/orders/${selected.id}/cancel`, {
          body: JSON.stringify({
            expectedVersion: selected.version,
            reason: '工作台人工取消',
          }),
          method: 'POST',
        });
        setNotice('订单已按状态分级取消');
      } else if (selected && actionId === 'propose-substitution') {
        const line = detail?.lines[0];
        if (
          !detail?.customerId ||
          !line?.quantityBase ||
          !line.quantityOriginal
        )
          throw new Error('替代品建议需要客户和完整订单行');
        await request(
          `/api/v1/oms/orders/${selected.id}/lines/${line.id}/substitutions`,
          {
            body: JSON.stringify({
              compatibility: { confirmedBy: 'WORKBENCH' },
              partnerId: detail.customerId,
              quantityBase: line.quantityBase,
              quantityOriginal: line.quantityOriginal,
              replacementProductId: crypto.randomUUID(),
              respondBy: new Date(
                Date.now() + 24 * 60 * 60 * 1000,
              ).toISOString(),
              timeoutPolicy: 'WAIT',
            }),
            method: 'POST',
          },
        );
        setNotice('替代品建议已发送，需客户在期限内确认');
      } else if (selected && actionId === 'request-rma') {
        const progress = detail?.lineProgress.find(
          ({ deliveredBase }) => Number(deliveredBase) > 0,
        );
        const line = detail?.lines.find(
          ({ id }) => id === progress?.orderLineId,
        );
        if (!detail?.customerId || !progress || !line)
          throw new Error('RMA 需要已交付的订单行');
        await request(`/api/v1/oms/orders/${selected.id}/rmas`, {
          body: JSON.stringify({
            lines: [
              {
                itemCondition: 'UNOPENED',
                quantityBase: progress.deliveredBase,
                quantityOriginal: progress.deliveredBase,
                sourceOrderLineId: line.id,
              },
            ],
            partnerId: detail.customerId,
            reason: '工作台退货申请',
            returnBy: new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          }),
          method: 'POST',
        });
        setNotice('RMA 已申请，等待授权与逆向履约');
      } else if (selected && actionId === 'partner-confirm') {
        if (!detail?.customerId) throw new Error('订单缺少伙伴标识');
        await request(`/api/v1/oms/orders/${selected.id}/collaborations`, {
          body: JSON.stringify({
            comment: '工作台伙伴确认',
            confirmed: true,
            partnerId: detail.customerId,
            type: 'CUSTOMER_CONFIRMATION',
          }),
          method: 'POST',
        });
        setNotice('伙伴确认已形成结构化协同事实');
      } else if (selected && actionId === 'submit-asn') {
        const line = detail?.lines[0];
        const warehouseId = detail?.allocations.find(
          ({ warehouseId }) => warehouseId,
        )?.warehouseId;
        if (
          !detail?.customerId ||
          !line?.productId ||
          !line.quantityBase ||
          !line.quantityOriginal ||
          !line.baseUom ||
          !line.originalUom ||
          !warehouseId
        )
          throw new Error('ASN 需要伙伴、仓库和完整双单位订单行');
        const expectedArrival = new Date(Date.now() + 60 * 60 * 1000);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await request(`/api/v1/oms/orders/${selected.id}/asns`, {
          body: JSON.stringify({
            expectedArrival: expectedArrival.toISOString(),
            expiresAt: expiresAt.toISOString(),
            externalAsnNo: `ASN-${Date.now()}`,
            lines: [
              {
                baseUom: line.baseUom,
                originalUom: line.originalUom,
                productId: line.productId,
                quantityBase: line.quantityBase,
                quantityOriginal: line.quantityOriginal,
                sourceOrderLineId: line.id,
              },
            ],
            partnerId: detail.customerId,
            warehouseId,
          }),
          method: 'POST',
        });
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
            { label: '客户 ID', name: 'customerId' },
            { label: '订单类型', name: 'type' },
            { label: '最低金额', name: 'minAmount' },
            { label: '创建起始', name: 'createdFrom' },
          ]}
          onQuery={(values) => setFilters(values)}
          onReset={() => setFilters({})}
        />
        <CommandBar
          actions={decisions}
          onAction={({ id }) => void execute(id)}
        />
        <Input
          aria-label="分配规则集代码"
          onChange={(event) => setRuleSetCode(event.target.value.toUpperCase())}
          value={ruleSetCode}
        />
        <Input
          aria-label="释放营业日历代码"
          onChange={(event) =>
            setReleaseCalendarCode(event.target.value.toUpperCase())
          }
          value={releaseCalendarCode}
        />
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
              <Alert
                key={`${field}-${message}`}
                message={`${field}: ${message}`}
                type="error"
              />
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
            <DataGrid
              columns={[
                { key: 'status', label: '审核状态' },
                { key: 'findings', label: '风险发现' },
                { key: 'createdAt', label: '审核时间' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.reviews ?? []}
              selectedIds={[]}
              total={detail?.reviews.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="订单与行级冻结">
            <DataGrid
              columns={[
                { key: 'holdType', label: '冻结类型' },
                { key: 'reason', label: '原因' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.holds ?? []}
              selectedIds={[]}
              total={detail?.holds.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="优先级决策与实物保护">
            <DataGrid
              columns={[
                { key: 'priority', label: '优先级' },
                { key: 'status', label: '决策状态' },
                { key: 'createdAt', label: '决策时间' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.priorityDecisions ?? []}
              selectedIds={[]}
              total={detail?.priorityDecisions.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="合拆映射与数量金额守恒">
            <DataGrid
              columns={[
                { key: 'businessOrderId', label: '来源订单' },
                { key: 'childBusinessRef', label: '目标业务引用' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={[
                ...(detail?.mergeMemberships ?? []),
                ...(detail?.splitRelations ?? []),
              ]}
              selectedIds={[]}
              total={
                (detail?.mergeMemberships.length ?? 0) +
                (detail?.splitRelations.length ?? 0)
              }
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="ATP 快照与不确定性">
            <Typography.Paragraph>
              可用量按库存、已分配、冻结、安全库存、在途和预计入库汇总；承诺结果固定记录
              snapshotAt 与 uncertainty。
            </Typography.Paragraph>
            <DataGrid
              columns={[
                { key: 'quantityBase', label: '预占基础数量' },
                { key: 'baseUom', label: '基础单位' },
                { key: 'warehouseId', label: '候选仓' },
                { key: 'status', label: '预占状态' },
                { key: 'failureCode', label: '失败原因' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.allocations ?? []}
              selectedIds={[]}
              total={detail?.allocations.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="候选排除与规则版本">
            <DataGrid
              columns={[
                { key: 'ruleSetCode', label: '规则集' },
                { key: 'ruleSetVersionNumber', label: '规则版本' },
                { key: 'selectedCandidateId', label: '选中候选' },
                { key: 'exclusions', label: '排除原因' },
                { key: 'evaluationTraceId', label: '评估轨迹' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.sourcingDecisions ?? []}
              selectedIds={[]}
              total={detail?.sourcingDecisions.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="独立履约单状态机">
            <DataGrid
              columns={[
                { key: 'fulfillmentNo', label: '履约单号' },
                { key: 'warehouseId', label: '仓库' },
                { key: 'type', label: '类型' },
                { key: 'status', label: '状态' },
                { key: 'progressSnapshot', label: '进度快照' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.fulfillmentOrders ?? []}
              selectedIds={[]}
              total={detail?.fulfillmentOrders.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="直运与多段运输需求">
            <DataGrid
              columns={[
                { key: 'requestNo', label: '运输需求号' },
                { key: 'mode', label: '运输模式' },
                { key: 'serviceLevel', label: '服务等级' },
                { key: 'status', label: '状态' },
                { key: 'createdAt', label: '生成时间' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.shipmentRequests ?? []}
              selectedIds={[]}
              total={detail?.shipmentRequests.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="伙伴确认与承诺反馈">
            <DataGrid
              columns={[
                { key: 'partnerId', label: '伙伴' },
                { key: 'type', label: '协同类型' },
                { key: 'comment', label: '评论' },
                { key: 'createdAt', label: '发生时间' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.collaborations ?? []}
              selectedIds={[]}
              total={detail?.collaborations.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="供应商 ASN 箱托预告">
            <DataGrid
              columns={[
                { key: 'externalAsnNo', label: 'ASN 号' },
                { key: 'warehouseId', label: '仓库' },
                { key: 'expectedArrival', label: '预计到达' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.asns ?? []}
              selectedIds={[]}
              total={detail?.asns.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="变更影响评估与域确认">
            <DataGrid
              columns={[
                { key: 'status', label: '变更状态' },
                { key: 'requiredDomains', label: '责任域' },
                { key: 'impactAssessment', label: '影响评估' },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.orderChanges ?? []}
              selectedIds={[]}
              total={detail?.orderChanges.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="部分履约、欠货与替代品">
            <DataGrid
              columns={[
                { key: 'orderLineId', label: '订单行' },
                { key: 'quantityBase', label: '欠货量' },
                { key: 'disposition', label: '处置' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.backorders ?? []}
              selectedIds={[]}
              total={detail?.backorders.length ?? 0}
            />
            <DataGrid
              columns={[
                { key: 'originalProductId', label: '原商品' },
                { key: 'replacementProductId', label: '替代商品' },
                { key: 'respondBy', label: '确认截止' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.substitutions ?? []}
              selectedIds={[]}
              total={detail?.substitutions.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="履约数量守恒投影">
            <DataGrid
              columns={[
                { key: 'orderLineId', label: '订单行' },
                { key: 'promisedBase', label: '承诺' },
                { key: 'allocatedBase', label: '分配' },
                { key: 'shippedBase', label: '发运' },
                { key: 'deliveredBase', label: '交付' },
                { key: 'cancelledBase', label: '取消' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.lineProgress ?? []}
              selectedIds={[]}
              total={detail?.lineProgress.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="RMA 逆向全周期">
            <DataGrid
              columns={[
                { key: 'rmaNo', label: 'RMA 号' },
                { key: 'status', label: '状态' },
                { key: 'resolution', label: '处置结果' },
                { key: 'returnBy', label: '退回截止' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.rmas ?? []}
              selectedIds={[]}
              total={detail?.rmas.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="订单异常聚合与人工处置">
            <DataGrid
              columns={[
                { key: 'exceptionType', label: '异常类型' },
                { key: 'severity', label: '严重度' },
                { key: 'responsibleDomain', label: '责任域' },
                { key: 'assignedTo', label: '负责人' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.exceptionCases ?? []}
              selectedIds={[]}
              total={detail?.exceptionCases.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="订单 SLA 预警与升级">
            <DataGrid
              columns={[
                { key: 'stage', label: '阶段' },
                { key: 'responsibleDomain', label: '责任域' },
                { key: 'warningAt', label: '预警时间' },
                { key: 'dueAt', label: '截止时间' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.slaClocks ?? []}
              selectedIds={[]}
              total={detail?.slaClocks.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="商业费用与结算请求">
            <DataGrid
              columns={[
                { key: 'requestNo', label: '请求号' },
                { key: 'requestedAmount', label: '请求金额' },
                { key: 'currency', label: '币种' },
                { key: 'status', label: '计费状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.settlementRequests ?? []}
              selectedIds={[]}
              total={detail?.settlementRequests.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="客户门户订单自助视图">
            <Typography.Paragraph>
              按客户伙伴范围展示订单、承诺库存、履约发运、轨迹签收、附件引用、对账状态和退货；写操作继续执行状态与权限校验。
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col span={24}>
          <Card title="跨域订单时间线投影">
            <DataGrid
              columns={[
                { key: 'displayAt', label: '业务时间' },
                { key: 'sourceDomain', label: '来源域' },
                { key: 'eventType', label: '事件' },
                { key: 'fromStatus', label: '原状态' },
                { key: 'toStatus', label: '新状态' },
                { key: 'summary', label: '摘要' },
                { key: 'traceId', label: 'Trace' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={500}
              rows={timeline}
              selectedIds={[]}
              total={timeline.length}
            />
          </Card>
        </Col>
      </Row>
    </section>
  );
}
