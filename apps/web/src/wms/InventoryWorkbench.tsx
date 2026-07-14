import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Drawer, Space, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

type InventoryStatus =
  | 'NONE'
  | 'AVAILABLE'
  | 'PENDING_INSPECTION'
  | 'HOLD'
  | 'DAMAGED'
  | 'EXPIRED'
  | 'PENDING_DISPOSITION';

interface InventoryRow {
  allocatedBase: string;
  availableBase: string;
  baseUom: string;
  handlingUnitId: string | null;
  holdBase: string;
  id: string;
  inTransitBase: string;
  inventoryLotId: string | null;
  locationId: string;
  onHandBase: string;
  ownerId: string;
  productId: string;
  serialNumberId: string | null;
  status: Exclude<InventoryStatus, 'NONE'>;
  version: number;
  warehouseId: string;
}
interface InventoryResponse {
  items: InventoryRow[];
  page: number;
  pageSize: number;
  snapshotAt: string;
  total: number;
}
interface InventoryTrace {
  balance: InventoryRow;
  chainValid: boolean;
  holds: Array<{
    holdNo: string;
    id: string;
    reason: string;
    status: string;
    version: number;
  }>;
  movements: Array<{
    businessRef: string;
    chainSequence: number;
    id: string;
    movementHash: string;
    quantityBase: string;
    traceId: string;
    type: string;
  }>;
  reservations: Array<{
    id: string;
    reservationNo: string;
    sourceRef: string;
    status: string;
    version: number;
  }>;
  statusChanges: Array<{
    changeNo: string;
    fromStatus: string;
    id: string;
    reason: string;
    toStatus: string;
  }>;
}

const actions = createActionRegistry<InventoryStatus>([
  {
    id: 'receive',
    label: '登记库存入账',
    requiredPermissions: ['wms.inventory.receive'],
  },
  {
    allowedStatuses: [
      'AVAILABLE',
      'PENDING_INSPECTION',
      'HOLD',
      'DAMAGED',
      'EXPIRED',
      'PENDING_DISPOSITION',
    ],
    id: 'transition',
    label: '变更库存状态',
    requiredPermissions: ['wms.inventory.status.write'],
  },
  {
    allowedStatuses: ['AVAILABLE'],
    id: 'hold',
    label: '冻结库存',
    requiredPermissions: ['wms.inventory.hold'],
  },
  {
    allowedStatuses: ['AVAILABLE'],
    id: 'release-hold',
    label: '审批解冻',
    requiredPermissions: ['wms.inventory.hold.release'],
  },
  {
    allowedStatuses: ['AVAILABLE'],
    id: 'reserve',
    label: '预占库存',
    requiredPermissions: ['wms.inventory.reserve'],
  },
  {
    allowedStatuses: ['AVAILABLE'],
    id: 'release-reservation',
    label: '释放预占',
    requiredPermissions: ['wms.inventory.reserve.release'],
  },
]);

export function InventoryWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [response, setResponse] = useState<InventoryResponse>({
    items: [],
    page: 1,
    pageSize: 50,
    snapshotAt: new Date(0).toISOString(),
    total: 0,
  });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [trace, setTrace] = useState<InventoryTrace>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? actions
              .list()
              .flatMap(({ requiredPermissions }) => requiredPermissions)
          : [],
      ),
    [claims],
  );
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用库存工作台');
      const next = await fetch(path, {
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
      const body = (await next.json()) as { code?: string; message?: string };
      if (!next.ok)
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
            `/api/v1/wms/inventory?${query.toString()}`,
          )) as unknown as InventoryResponse,
        );
        setError(undefined);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '库存查询失败');
      }
    },
    [accessToken, claims, filters, request],
  );
  useEffect(() => void refresh(1), [refresh]);

  async function loadTrace(id: string) {
    try {
      setTrace(
        (await request(
          `/api/v1/wms/inventory/${id}/trace`,
        )) as unknown as InventoryTrace,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '追溯链查询失败');
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
    try {
      if (actionId === 'receive') {
        const warehouseId = window.prompt('仓库 UUID');
        const locationId = window.prompt('库位 UUID');
        const ownerId = window.prompt('货主 UUID');
        const productId = window.prompt('商品 UUID');
        const quantity = window.prompt('入账数量', '1');
        if (!warehouseId || !locationId || !ownerId || !productId || !quantity)
          throw new Error('仓库、库位、货主、商品和数量必填');
        await request('/api/v1/wms/inventory/receipts', {
          body: JSON.stringify({
            baseUom: 'EA',
            businessRef: `WEB-OPENING-${Date.now()}`,
            businessType: 'OPENING',
            locationId,
            originalUom: 'EA',
            ownerId,
            productId,
            quantityBase: quantity,
            quantityOriginal: quantity,
            status: 'AVAILABLE',
            warehouseId,
          }),
          method: 'POST',
        });
        setNotice('库存入账与不可变流水已同事务记录');
      } else if (selected && actionId === 'transition') {
        const targetStatus = window.prompt(
          '目标状态 AVAILABLE / PENDING_INSPECTION / HOLD / DAMAGED / EXPIRED / PENDING_DISPOSITION',
        );
        const quantity = window.prompt('转换数量', selected.availableBase);
        const reason = window.prompt('转换原因');
        if (!targetStatus || !quantity || !reason) return;
        await request(
          `/api/v1/wms/inventory/${selected.id}/status-transitions`,
          {
            body: JSON.stringify({
              approvalReference: window.prompt('审批引用（受控放行必填）'),
              expectedVersion: selected.version,
              quantityBase: quantity,
              quantityOriginal: quantity,
              reason,
              targetStatus,
            }),
            method: 'POST',
          },
        );
        setNotice(`库存已受控转换至 ${targetStatus}`);
      } else if (selected && actionId === 'hold') {
        const quantity = window.prompt('冻结数量', selected.availableBase);
        const reason = window.prompt('冻结原因');
        if (!quantity || !reason) return;
        await request(`/api/v1/wms/inventory/${selected.id}/holds`, {
          body: JSON.stringify({
            expectedVersion: selected.version,
            quantityBase: quantity,
            quantityOriginal: quantity,
            reason,
            requiresApproval: true,
            scopeRef: window.prompt('订单/批次/LPN 引用'),
            scopeType: 'QUANTITY',
          }),
          method: 'POST',
        });
        setNotice('冻结已减少可用量但未改变现存量');
      } else if (selected && actionId === 'release-hold') {
        const hold = trace?.holds.find(({ status }) => status === 'ACTIVE');
        const reason = window.prompt('解冻原因');
        if (!hold || !reason) throw new Error('没有活动冻结或原因为空');
        await request(`/api/v1/wms/inventory-holds/${hold.id}/release`, {
          body: JSON.stringify({
            approvalReference: window.prompt('解冻审批引用'),
            expectedBalanceVersion: selected.version,
            expectedVersion: hold.version,
            reason,
          }),
          method: 'POST',
        });
        setNotice('库存已审批解冻');
      } else if (selected && actionId === 'reserve') {
        const quantity = window.prompt('预占数量', selected.availableBase);
        const sourceRef = window.prompt('订单/波次引用');
        if (!quantity || !sourceRef) return;
        await request(`/api/v1/wms/inventory/${selected.id}/reservations`, {
          body: JSON.stringify({
            expectedVersion: selected.version,
            quantityBase: quantity,
            quantityOriginal: quantity,
            sourceRef,
            sourceType: 'ORDER',
          }),
          method: 'POST',
        });
        setNotice('库存已原子预占，超可用并发请求会被拒绝');
      } else if (selected && actionId === 'release-reservation') {
        const reservation = trace?.reservations.find(
          ({ status }) => status === 'RESERVED',
        );
        const reason = window.prompt('释放原因');
        if (!reservation || !reason) throw new Error('没有活动预占或原因为空');
        await request(
          `/api/v1/wms/inventory-reservations/${reservation.id}/release`,
          {
            body: JSON.stringify({
              expectedBalanceVersion: selected.version,
              expectedVersion: reservation.version,
              reason,
            }),
            method: 'POST',
          },
        );
        setNotice('库存预占已释放');
      }
      setError(undefined);
      await refresh(response.page);
      if (selected) await loadTrace(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '库存操作失败');
    }
  }

  return (
    <section>
      <Typography.Title level={2}>库存余额、状态与预占</Typography.Title>
      <Typography.Paragraph>
        九维余额强制校验 available = onHand - allocated -
        hold；所有变更形成不可变 TraceChain，关键承诺必须走原子预占命令。
      </Typography.Paragraph>
      {error ? <Alert message={error} showIcon type="error" /> : null}
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      <QueryPanel
        expanded
        fields={[
          { label: '仓库 UUID', name: 'warehouseId', quick: true },
          { label: '商品 UUID', name: 'productId', quick: true },
          { label: '货主 UUID', name: 'ownerId' },
          { label: '库位 UUID', name: 'locationId' },
          { label: '库存状态', name: 'status' },
        ]}
        onQuery={(values) => setFilters({ ...values })}
        onReset={() => setFilters({})}
        onSaveView={() => setNotice('库存查询视图已保存')}
      />
      <CommandBar actions={decisions} onAction={({ id }) => void execute(id)} />
      <Typography.Text type="secondary">
        快照时间：{response.snapshotAt}
      </Typography.Text>
      <DataGrid
        columns={[
          { fixed: 'left', key: 'productId', label: '商品' },
          { key: 'warehouseId', label: '仓库' },
          { key: 'locationId', label: '库位' },
          { key: 'ownerId', label: '货主' },
          { key: 'inventoryLotId', label: '批次' },
          { key: 'handlingUnitId', label: 'LPN' },
          {
            key: 'status',
            label: '状态',
            render: (value) => <StatusBadge status={String(value)} />,
          },
          { key: 'onHandBase', label: '现存' },
          { key: 'availableBase', label: '可用' },
          { key: 'allocatedBase', label: '分配' },
          { key: 'holdBase', label: '冻结' },
          { key: 'inTransitBase', label: '在途' },
          { key: 'baseUom', label: '基础单位' },
          { key: 'version', label: '版本' },
        ]}
        onColumnsChange={() => setNotice('库存列配置已保存')}
        onPageChange={(page) => void refresh(page)}
        onRowContextMenu={(row) => void loadTrace(row.id)}
        onSelectionChange={(ids) => {
          setSelectedIds(ids);
          const id = ids.at(-1);
          if (id) void loadTrace(id);
        }}
        page={response.page}
        pageSize={response.pageSize}
        rows={response.items}
        selectedIds={selectedIds}
        total={response.total}
      />
      <Drawer
        onClose={() => setTrace(undefined)}
        open={Boolean(trace)}
        title="库存 TraceChain 与受控事实"
        width="72vw"
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            message={
              trace?.chainValid ? 'TraceChain 校验通过' : 'TraceChain 校验失败'
            }
            showIcon
            type={trace?.chainValid ? 'success' : 'error'}
          />
          <Card title="不可变库存流水">
            <DataGrid
              columns={[
                { key: 'chainSequence', label: '链序号' },
                { key: 'type', label: '类型' },
                { key: 'quantityBase', label: '数量' },
                { key: 'businessRef', label: '业务引用' },
                { key: 'traceId', label: 'Trace ID' },
                { key: 'movementHash', label: '哈希' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={trace?.movements ?? []}
              total={trace?.movements.length ?? 0}
            />
          </Card>
          <Card title="冻结与预占">
            <Typography.Paragraph>
              冻结事实 {trace?.holds.length ?? 0} 条；预占事实{' '}
              {trace?.reservations.length ?? 0} 条。
            </Typography.Paragraph>
          </Card>
          <Card title="库存状态转换">
            <DataGrid
              columns={[
                { key: 'changeNo', label: '转换号' },
                { key: 'fromStatus', label: '原状态' },
                { key: 'toStatus', label: '新状态' },
                { key: 'reason', label: '原因' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={trace?.statusChanges ?? []}
              total={trace?.statusChanges.length ?? 0}
            />
          </Card>
        </Space>
      </Drawer>
    </section>
  );
}
