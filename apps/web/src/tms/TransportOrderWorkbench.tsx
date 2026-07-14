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
import { TransportPlanningPanel } from './TransportPlanningPanel';
import { LoadRouteOptimizationPanel } from './LoadRouteOptimizationPanel';
import { CapacityTenderPanel } from './CapacityTenderPanel';
import { DispatchPanel } from './DispatchPanel';
import { DriverTrackingPanel } from './DriverTrackingPanel';

type TransportStatus = 'OPEN' | 'PLANNED' | 'FROZEN' | 'RETURNED';

interface TransportOrderRow {
  createdAt: string;
  deliveryWindowTo: string;
  externalOrderNo: string | null;
  id: string;
  orderNo: string;
  pickupWindowFrom: string;
  serviceLevel: string;
  sourceRef: string;
  status: TransportStatus;
  type: string;
  version: number;
  volumeBase: string;
  weightBase: string;
}

interface TransportOrderPage {
  items: TransportOrderRow[];
  page: number;
  pageSize: number;
  total: number;
}

const actions = createActionRegistry<TransportStatus | 'NONE'>([
  {
    id: 'receive',
    label: '接收运输订单',
    requiredPermissions: ['tms.transport.receive'],
  },
  {
    allowedStatuses: ['OPEN', 'FROZEN', 'RETURNED'],
    confirmMessage:
      '确认地址、禁运、车型、承运商资质、时间窗与费用责任均已通过？',
    id: 'approve',
    label: '审核通过并进入计划',
    requiredPermissions: ['tms.transport.review'],
  },
  {
    allowedStatuses: ['OPEN', 'RETURNED'],
    confirmMessage: '将冻结选中运输订单并记录不可变审核事实。',
    id: 'freeze',
    label: '冻结异常订单',
    requiredPermissions: ['tms.transport.review'],
  },
  {
    allowedStatuses: ['OPEN', 'FROZEN'],
    confirmMessage: '将订单退回来源方修正，并保留本次审核记录。',
    id: 'return',
    label: '退回来源方',
    requiredPermissions: ['tms.transport.review'],
  },
]);

export function TransportOrderWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [rows, setRows] = useState<readonly TransportOrderRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'tms.transport.read',
              'tms.transport.receive',
              'tms.transport.review',
            ]
          : [],
      ),
    [claims],
  );
  const selected = rows.find(({ id }) => id === selectedIds[0]);
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
        throw new Error('请先登录后使用运输订单工作台');
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
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: '50',
    });
    if (query) parameters.set('query', query);
    if (status) parameters.set('status', status);
    try {
      const result = (await request(
        `/api/v1/tms/transport-orders?${parameters.toString()}`,
      )) as unknown as TransportOrderPage;
      setRows(result.items);
      setTotal(result.total);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运输订单查询失败');
    }
  }, [accessToken, claims, page, query, request, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (!decision?.enabled) return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage))
      return;
    try {
      if (actionId === 'receive') {
        const now = Date.now();
        await request('/api/v1/tms/transport-orders', {
          body: JSON.stringify({
            chargeResponsibilitySnapshot: {
              payerRef: 'DEMO-CUSTOMER',
              term: 'PREPAID',
            },
            deliveryWindowFrom: new Date(now + 8 * 3_600_000).toISOString(),
            deliveryWindowTo: new Date(now + 12 * 3_600_000).toISOString(),
            destinationAddressSnapshot: {
              city: '上海市',
              countryCode: 'CN',
              line1: '浦东新区云链路 88 号',
            },
            externalOrderNo: `EXT-${now}`,
            originAddressSnapshot: {
              city: '苏州市',
              countryCode: 'CN',
              line1: '工业园区协同路 16 号',
            },
            packagingSnapshot: {
              packageSpecVersion: 'DEMO-V1',
              palletCount: 2,
            },
            pickupWindowFrom: new Date(now + 2 * 3_600_000).toISOString(),
            pickupWindowTo: new Date(now + 4 * 3_600_000).toISOString(),
            serviceLevel: 'NEXT_DAY',
            sourceRef: `DEMO-${now}`,
            sourceSnapshot: { channel: 'WORKBENCH', lineCount: 1 },
            sourceType: 'STANDALONE',
            temperatureMax: '8',
            temperatureMin: '2',
            temperatureUom: 'C',
            type: 'STANDALONE',
            vehicleRequirementSnapshot: { refrigerated: true },
            volume: '2.5',
            volumeBase: '2.5',
            volumeUom: 'M3',
            weight: '1200',
            weightBase: '1200',
            weightUom: 'KG',
          }),
          method: 'POST',
        });
        setNotice('运输需求已标准化接入，等待主管审核');
      } else if (selected) {
        const isApprove = actionId === 'approve';
        await request(`/api/v1/tms/transport-orders/${selected.id}/review`, {
          body: JSON.stringify({
            addressConfirmed: isApprove,
            carrierQualified: true,
            chargeResponsibilityConfirmed: true,
            decision: isApprove
              ? 'APPROVE'
              : actionId === 'freeze'
                ? 'FREEZE'
                : 'RETURN',
            expectedVersion: selected.version,
            prohibitedGoodsDetected: false,
            reason: isApprove ? '工作台审核通过' : '地址信息需要来源方复核',
            timeWindowFeasible: true,
            vehicleCompatible: true,
          }),
          method: 'POST',
        });
        setNotice(
          isApprove
            ? '审核通过，订单已进入计划池'
            : actionId === 'freeze'
              ? '异常订单已冻结'
              : '订单已退回来源方',
        );
      }
      setSelectedIds([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运输订单动作失败');
    }
  }

  return (
    <section className="transport-order-workbench">
      <Typography.Title level={2}>运输订单接入与审核</Typography.Title>
      <Typography.Paragraph>
        统一保存来源、地址、时间窗、包装、重量体积、温层与服务等级快照；审核异常可冻结或退回，每次决定均生成不可变
        TransportOrderApproval。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <Card title="运输订单池">
        <QueryPanel
          fields={[
            { label: '订单号 / 来源号', name: 'query', quick: true },
            { label: '运输状态', name: 'status', quick: true },
          ]}
          onQuery={(values) => {
            setPage(1);
            setQuery(values.query ?? '');
            setStatus(values.status ?? '');
          }}
          onReset={() => {
            setPage(1);
            setQuery('');
            setStatus('');
          }}
        />
        <CommandBar
          actions={decisions}
          onAction={(action) => void execute(action.id)}
        />
        <DataGrid
          columns={[
            { key: 'orderNo', label: '运输订单号' },
            { key: 'sourceRef', label: '来源单号' },
            { key: 'type', label: '类型' },
            { key: 'serviceLevel', label: '服务等级' },
            { key: 'weightBase', label: '重量 KG' },
            { key: 'volumeBase', label: '体积 M³' },
            { key: 'pickupWindowFrom', label: '提货窗开始' },
            { key: 'deliveryWindowTo', label: '交付窗结束' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'version', label: '版本' },
          ]}
          onPageChange={setPage}
          onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))}
          page={page}
          pageSize={50}
          rows={rows}
          selectedIds={selectedIds}
          total={total}
        />
      </Card>
      <TransportPlanningPanel />
      <LoadRouteOptimizationPanel />
      <CapacityTenderPanel />
      <DispatchPanel />
      <DriverTrackingPanel />
    </section>
  );
}
