import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  createActionRegistry,
  type DataGridColumn,
} from '@scm/ui';
import { Alert, Card, Col, Row } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface RowBase {
  id: string;
  status: string;
  version: number;
}
interface PoolRow extends RowBase {
  carrierRef: string;
  poolNo: string;
  reservedWeightBase: string;
  totalWeightBase: string;
}
interface ShipmentRow extends RowBase {
  consolidationPlanId: string;
  shipmentNo: string;
}
interface PlanRow extends RowBase {
  planNo: string;
}
interface ReservationRow extends RowBase {
  capacityPoolId: string;
  shipmentId: string;
}
interface TenderRow extends RowBase {
  carrierRef: string;
  capacityReservationId: string;
  priceAmount: string;
  shipmentId: string;
  tenderNo: string;
}
interface QuoteRow extends RowBase {
  requestNo: string;
  shipmentId: string;
}
interface BidRow extends RowBase {
  carrierRef: string;
}
interface AwardRow extends RowBase {
  carrierBidId: string;
}
interface RetenderRow extends RowBase {
  shipmentId: string;
}
interface View {
  awards: AwardRow[];
  bids: BidRow[];
  capacityPools: PoolRow[];
  plans: PlanRow[];
  quoteRequests: QuoteRow[];
  reservations: ReservationRow[];
  retenderCases: RetenderRow[];
  shipments: ShipmentRow[];
  subcontracts: RowBase[];
  tenders: TenderRow[];
}

const actions = createActionRegistry<string>([
  {
    id: 'create-pool',
    label: '登记承运运力',
    requiredPermissions: ['tms.capacity.manage'],
  },
  {
    allowedStatuses: ['PLAN_PUBLISHED'],
    confirmMessage: '确认成本、超载风险和承运资质均已复核？',
    id: 'approve-plan',
    label: '审批并预占运力',
    requiredPermissions: ['tms.plan.approve'],
  },
  {
    allowedStatuses: ['SHIPMENT_APPROVED'],
    id: 'send-tender',
    label: '直接委托承运商',
    requiredPermissions: ['tms.tender.manage'],
  },
  {
    allowedStatuses: ['TENDER_SENT', 'TENDER_QUESTIONED'],
    id: 'accept-tender',
    label: '接受委托',
    requiredPermissions: ['tms.tender.respond'],
  },
  {
    allowedStatuses: ['TENDER_SENT', 'TENDER_QUESTIONED', 'TENDER_ACCEPTED'],
    confirmMessage: '撤销后才允许改派，并将释放原运力。',
    id: 'revoke-tender',
    label: '撤销并发起改派',
    requiredPermissions: ['tms.tender.revoke'],
  },
  {
    allowedStatuses: ['SHIPMENT_APPROVED'],
    id: 'create-quote',
    label: '发起竞价询价',
    requiredPermissions: ['tms.quote.manage'],
  },
  {
    allowedStatuses: ['QUOTE_OPEN'],
    id: 'recommend-award',
    label: '比价并生成推荐',
    requiredPermissions: ['tms.quote.award'],
  },
  {
    allowedStatuses: ['AWARD_PROPOSED'],
    confirmMessage: '确认采用推荐承运商并同步生成委托？',
    id: 'approve-award',
    label: '批准授标',
    requiredPermissions: ['tms.quote.award'],
  },
  {
    allowedStatuses: ['RETENDER_OPEN'],
    id: 'retender',
    label: '执行拒单改派',
    requiredPermissions: ['tms.tender.manage'],
  },
  {
    allowedStatuses: ['TENDER_ACCEPTED'],
    id: 'subcontract',
    label: '登记转委托责任链',
    requiredPermissions: ['tms.subcontract.manage'],
  },
  {
    id: 'expire-scan',
    label: '扫描超时委托',
    requiredPermissions: ['tms.tender.manage'],
  },
]);

const emptyView: View = {
  awards: [],
  bids: [],
  capacityPools: [],
  plans: [],
  quoteRequests: [],
  reservations: [],
  retenderCases: [],
  shipments: [],
  subcontracts: [],
  tenders: [],
};

export function CapacityTenderPanel() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<View>(emptyView);
  const [planId, setPlanId] = useState('');
  const [shipmentId, setShipmentId] = useState('');
  const [poolId, setPoolId] = useState('');
  const [tenderId, setTenderId] = useState('');
  const [quoteId, setQuoteId] = useState('');
  const [awardId, setAwardId] = useState('');
  const [retenderId, setRetenderId] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'tms.capacity-tender.read',
              'tms.capacity.manage',
              'tms.plan.approve',
              'tms.tender.manage',
              'tms.tender.respond',
              'tms.tender.revoke',
              'tms.quote.manage',
              'tms.quote.award',
              'tms.subcontract.manage',
            ]
          : [],
      ),
    [claims],
  );
  const plan = view.plans.find(({ id }) => id === planId);
  const shipment = view.shipments.find(({ id }) => id === shipmentId);
  const pool = view.capacityPools.find(({ id }) => id === poolId);
  const tender = view.tenders.find(({ id }) => id === tenderId);
  const quote = view.quoteRequests.find(({ id }) => id === quoteId);
  const award = view.awards.find(({ id }) => id === awardId);
  const retenderCase = view.retenderCases.find(({ id }) => id === retenderId);
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status:
        id === 'approve-plan'
          ? `PLAN_${plan?.status ?? 'NONE'}`
          : id === 'send-tender' || id === 'create-quote'
            ? `SHIPMENT_${shipment?.status ?? 'NONE'}`
            : id === 'accept-tender' ||
                id === 'revoke-tender' ||
                id === 'subcontract'
              ? `TENDER_${tender?.status ?? 'NONE'}`
              : id === 'recommend-award'
                ? `QUOTE_${quote?.status ?? 'NONE'}`
                : id === 'approve-award'
                  ? `AWARD_${award?.status ?? 'NONE'}`
                  : id === 'retender'
                    ? `RETENDER_${retenderCase?.status ?? 'NONE'}`
                    : 'NONE',
    }),
  );
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用运力委托工作台');
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
          '/api/v1/tms/capacity-tender/workbench',
        )) as unknown as View,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运力委托查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (
      !decision?.enabled ||
      (decision.confirmMessage && !window.confirm(decision.confirmMessage))
    )
      return;
    const expiresAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
    try {
      if (actionId === 'create-pool')
        await request('/api/v1/tms/capacity-tender/capacity-pools', {
          body: JSON.stringify({
            calendarSnapshot: { available: true },
            carrierRef: `CARRIER-${Date.now()}`,
            carrierSnapshot: { source: 'WORKBENCH' },
            qualificationSnapshot: { qualified: true },
            regionCode: 'EAST',
            serviceDate: expiresAt.slice(0, 10),
            sourceType: 'CONTRACT',
            totalPallets: '20',
            totalVolumeBase: '80',
            totalWeightBase: '30000',
            vehicleType: 'BOX_TRUCK',
          }),
          method: 'POST',
        });
      else if (actionId === 'approve-plan' && plan) {
        const shipments = view.shipments.filter(
          (row) =>
            row.consolidationPlanId === plan.id && row.status === 'PLANNED',
        );
        const pools = view.capacityPools.filter(
          ({ status }) => status === 'ACTIVE',
        );
        if (!shipments.length || pools.length < shipments.length)
          throw new Error('计划内每张运单都需要独立可用运力池');
        await request(`/api/v1/tms/capacity-tender/plans/${plan.id}/approve`, {
          body: JSON.stringify({
            costAmount: '12000',
            currency: 'CNY',
            decision: 'APPROVE',
            expectedVersion: plan.version,
            qualificationSnapshot: { qualified: true },
            reason: '工作台成本与风险复核通过',
            reservations: shipments.map((row, index) => ({
              capacityPoolId: pools[index]!.id,
              expectedPoolVersion: pools[index]!.version,
              expiresAt: new Date(Date.now() + 48 * 3_600_000).toISOString(),
              shipmentId: row.id,
            })),
            riskSnapshot: { overloaded: false },
            variancePercentage: '0',
          }),
          method: 'POST',
        });
      } else if (actionId === 'send-tender' && shipment) {
        const reservation = view.reservations.find(
          (row) => row.shipmentId === shipment.id && row.status === 'ACTIVE',
        );
        const owner = view.capacityPools.find(
          ({ id }) => id === reservation?.capacityPoolId,
        );
        if (!reservation || !owner) throw new Error('运单缺少有效运力预占');
        await request(
          `/api/v1/tms/capacity-tender/shipments/${shipment.id}/reservations/${reservation.id}/tenders`,
          {
            body: JSON.stringify({
              carrierSnapshot: { carrierRef: owner.carrierRef },
              currency: 'CNY',
              expiresAt,
              priceAmount: '1200',
              requirementSnapshot: { source: 'WORKBENCH' },
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'accept-tender' && tender)
        await request(
          `/api/v1/tms/capacity-tender/tenders/${tender.id}/respond`,
          {
            body: JSON.stringify({
              decision: 'ACCEPT',
              expectedVersion: tender.version,
              reason: '承运商已确认',
            }),
            method: 'POST',
          },
        );
      else if (actionId === 'revoke-tender' && tender)
        await request(
          `/api/v1/tms/capacity-tender/tenders/${tender.id}/revoke`,
          {
            body: JSON.stringify({
              expectedVersion: tender.version,
              reason: '工作台显式撤销后改派',
            }),
            method: 'POST',
          },
        );
      else if (actionId === 'create-quote' && shipment) {
        const carriers = [
          ...new Set(view.capacityPools.map(({ carrierRef }) => carrierRef)),
        ];
        if (!carriers.length) throw new Error('请先登记候选承运商运力');
        await request(
          `/api/v1/tms/capacity-tender/shipments/${shipment.id}/quote-requests`,
          {
            body: JSON.stringify({
              candidateCarriers: carriers,
              deadlineAt: expiresAt,
              requestType: 'BID',
              requirementSnapshot: { source: 'WORKBENCH' },
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'recommend-award' && quote)
        await request(
          `/api/v1/tms/capacity-tender/quote-requests/${quote.id}/recommend`,
          {
            body: JSON.stringify({
              expectedVersion: quote.version,
              priceWeight: 70,
              serviceWeight: 30,
            }),
            method: 'POST',
          },
        );
      else if (actionId === 'approve-award' && award) {
        const bid = view.bids.find(({ id }) => id === award.carrierBidId);
        const awardPool = view.capacityPools.find(
          (row) =>
            row.carrierRef === bid?.carrierRef && row.status === 'ACTIVE',
        );
        if (!awardPool) throw new Error('推荐承运商没有可用运力');
        await request(
          `/api/v1/tms/capacity-tender/award-decisions/${award.id}/decide`,
          {
            body: JSON.stringify({
              capacityPoolId: awardPool.id,
              decision: 'APPROVE',
              expectedPoolVersion: awardPool.version,
              expectedVersion: award.version,
              expiresAt,
              reason: '采用综合评分最高方案',
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'retender' && retenderCase && pool) {
        await request(
          `/api/v1/tms/capacity-tender/retender-cases/${retenderCase.id}/retender`,
          {
            body: JSON.stringify({
              capacityPoolId: pool.id,
              carrierSnapshot: { carrierRef: pool.carrierRef },
              currency: 'CNY',
              expectedPoolVersion: pool.version,
              expiresAt,
              priceAmount: '1500',
              requirementSnapshot: { source: 'RETENDER' },
              shipmentId: retenderCase.shipmentId,
            }),
            method: 'POST',
          },
        );
      } else if (actionId === 'subcontract' && tender)
        await request(
          `/api/v1/tms/capacity-tender/shipments/${tender.shipmentId}/subcontracts`,
          {
            body: JSON.stringify({
              actualCarrierRef: `${tender.carrierRef}-SUB`,
              complianceSnapshot: { qualified: true },
              downstreamCarrierRef: `${tender.carrierRef}-SUB`,
              feeLayerSnapshot: { currency: 'CNY' },
              parentTenderId: tender.id,
              responsibilityChain: [
                { carrierRef: tender.carrierRef, role: 'CONTRACTUAL' },
                { carrierRef: `${tender.carrierRef}-SUB`, role: 'ACTUAL' },
              ],
              upstreamCarrierRef: tender.carrierRef,
              visibilityScope: { customerVisible: true },
            }),
            method: 'POST',
          },
        );
      else if (actionId === 'expire-scan')
        await Promise.all([
          request('/api/v1/tms/capacity-tender/tenders/expire-scan', {
            method: 'POST',
          }),
          request(
            '/api/v1/tms/capacity-tender/capacity-reservations/expire-scan',
            { method: 'POST' },
          ),
        ]);
      setNotice('运力、委托或承运协同动作已完成，审计与事件已保存');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运力委托动作失败');
    }
  }

  const grid = <T extends RowBase>(
    rows: readonly T[],
    selectedId: string,
    onSelect: (id: string) => void,
    columns: readonly DataGridColumn<T>[],
  ) => (
    <DataGrid
      columns={columns}
      onPageChange={() => undefined}
      onSelectionChange={(ids) => onSelect(ids.at(-1) ?? '')}
      page={1}
      pageSize={200}
      rows={rows}
      selectedIds={selectedId ? [selectedId] : []}
      total={rows.length}
    />
  );

  return (
    <Card title="运力容量、承运委托与竞价分包">
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="CapacityPool 原子预占与计划审批">
            {grid(view.capacityPools, poolId, setPoolId, [
              { key: 'poolNo', label: '运力池号' },
              { key: 'carrierRef', label: '承运商' },
              { key: 'reservedWeightBase', label: '已占重量' },
              { key: 'totalWeightBase', label: '总重量' },
              { key: 'status', label: '状态' },
            ])}
            {grid(view.plans, planId, setPlanId, [
              { key: 'planNo', label: '运输计划号' },
              { key: 'status', label: '审批状态' },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.shipments, shipmentId, setShipmentId, [
              { key: 'shipmentNo', label: '运单号' },
              { key: 'status', label: '状态' },
              { key: 'version', label: '版本' },
            ])}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="CarrierTender、Award 与责任链">
            {grid(view.tenders, tenderId, setTenderId, [
              { key: 'tenderNo', label: '委托号' },
              { key: 'carrierRef', label: '承运商' },
              { key: 'priceAmount', label: '报价' },
              { key: 'status', label: '状态' },
            ])}
            {grid(view.quoteRequests, quoteId, setQuoteId, [
              { key: 'requestNo', label: '询价号' },
              { key: 'status', label: '状态' },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.awards, awardId, setAwardId, [
              { key: 'carrierBidId', label: '推荐报价' },
              { key: 'status', label: '授标状态' },
              { key: 'version', label: '版本' },
            ])}
            {grid(view.retenderCases, retenderId, setRetenderId, [
              { key: 'shipmentId', label: '拒单运单' },
              { key: 'status', label: '改派状态' },
              { key: 'version', label: '版本' },
            ])}
          </Card>
        </Col>
      </Row>
    </Card>
  );
}
