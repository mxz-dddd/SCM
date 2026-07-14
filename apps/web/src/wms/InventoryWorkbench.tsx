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
import { InventoryGovernanceWorkbench } from './InventoryGovernanceWorkbench';

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
interface InventoryCountView {
  freezes: Array<{
    id: string;
    locationId: string;
    status: string;
  }>;
  lines: Array<{
    approvalReference: string | null;
    expectedQuantityBase: string;
    expectedQuantityOriginal: string;
    firstCountBase: string | null;
    id: string;
    locationId: string;
    recountBase: string | null;
    status: string;
    varianceReason: string | null;
    version: number;
  }>;
  order: {
    countNo: string;
    id: string;
    status: string;
    type: string;
    version: number;
    warehouseId: string;
  };
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
  {
    allowedStatuses: ['AVAILABLE'],
    id: 'transfer',
    label: '执行移库',
    requiredPermissions: ['wms.inventory.transfer'],
  },
  {
    allowedStatuses: ['AVAILABLE'],
    id: 'owner-transfer',
    label: '货主转换',
    requiredPermissions: ['wms.inventory.owner-transfer'],
  },
  {
    id: 'plan-count',
    label: '创建盘点',
    requiredPermissions: ['wms.inventory.count.plan'],
  },
  {
    id: 'open-count',
    label: '打开盘点',
    requiredPermissions: ['wms.inventory.count.read'],
  },
  {
    id: 'count-line',
    label: '录入初复盘',
    requiredPermissions: ['wms.inventory.count.execute'],
  },
  {
    id: 'advance-count',
    label: '推进盘点状态',
    requiredPermissions: ['wms.inventory.count.execute'],
  },
  {
    id: 'approve-count',
    label: '审批盘点差异',
    requiredPermissions: ['wms.inventory.count.approve'],
  },
  {
    id: 'release-count-segment',
    label: '分段解冻',
    requiredPermissions: ['wms.inventory.count.approve'],
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
  const [count, setCount] = useState<InventoryCountView>();
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
  async function loadCount(id: string) {
    setCount(
      (await request(
        `/api/v1/wms/inventory-counts/${id}`,
      )) as unknown as InventoryCountView,
    );
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
      } else if (selected && actionId === 'transfer') {
        const targetLocationId = window.prompt('目标库位 UUID');
        const quantity = window.prompt('移库数量', selected.availableBase);
        const reason = window.prompt('移库原因');
        if (!targetLocationId || !quantity || !reason) return;
        await request(`/api/v1/wms/inventory/${selected.id}/transfers`, {
          body: JSON.stringify({
            expectedVersion: selected.version,
            quantityBase: quantity,
            quantityOriginal: quantity,
            reason,
            targetLocationId,
          }),
          method: 'POST',
        });
        setNotice('源/目标余额与移库流水已在同一事务确认');
      } else if (selected && actionId === 'owner-transfer') {
        const targetOwnerId = window.prompt('目标货主 UUID');
        const quantity = window.prompt('转换数量', selected.availableBase);
        const contractReference = window.prompt('合同引用');
        const approvalReference = window.prompt('审批引用');
        const reason = window.prompt('转换原因');
        if (
          !targetOwnerId ||
          !quantity ||
          !contractReference ||
          !approvalReference ||
          !reason
        )
          return;
        await request(
          `/api/v1/wms/inventory/${selected.id}/ownership-transfers`,
          {
            body: JSON.stringify({
              approvalReference,
              contractReference,
              expectedVersion: selected.version,
              quantityBase: quantity,
              quantityOriginal: quantity,
              reason,
              targetOwnerId,
            }),
            method: 'POST',
          },
        );
        setNotice('货主转换双向流水与结算事实已记录');
      } else if (actionId === 'plan-count') {
        const type = window.prompt('盘点类型 FULL / CYCLE', 'FULL');
        const warehouseId = window.prompt(
          '仓库 UUID',
          selected?.warehouseId ?? '',
        );
        if (!type || !warehouseId) return;
        const planned = (await request('/api/v1/wms/inventory-counts', {
          body: JSON.stringify({
            ...(type === 'CYCLE' && selected
              ? { balanceIds: [selected.id] }
              : {}),
            blind: true,
            freezeInventory: type === 'FULL',
            ownerId: window.prompt('货主 UUID（可选）') || undefined,
            type,
            warehouseId,
          }),
          method: 'POST',
        })) as unknown as { countId: string };
        await loadCount(planned.countId);
        setNotice('盘点计划与冻结范围已生成');
      } else if (actionId === 'open-count') {
        const countId = window.prompt('盘点 UUID', count?.order.id ?? '');
        if (!countId) return;
        await loadCount(countId);
      } else if (actionId === 'count-line') {
        if (!count) throw new Error('请先打开盘点');
        const defaultLine = count.lines.find(({ status }) =>
          ['OPEN', 'COUNTED', 'RECOUNTED'].includes(status),
        );
        const lineId = window.prompt('盘点行 UUID', defaultLine?.id ?? '');
        const line = count.lines.find(({ id }) => id === lineId);
        if (!line) throw new Error('盘点行不存在');
        const quantity = window.prompt(
          '实盘数量',
          line.recountBase ?? line.firstCountBase ?? line.expectedQuantityBase,
        );
        if (quantity === null) return;
        await request(`/api/v1/wms/inventory-count-lines/${line.id}/count`, {
          body: JSON.stringify({
            expectedVersion: line.version,
            quantityBase: quantity,
            quantityOriginal: quantity,
            reason: window.prompt('差异原因（无差异可留空）') || undefined,
          }),
          method: 'POST',
        });
        await loadCount(count.order.id);
        setNotice('盘点数量已按版本记录');
      } else if (actionId === 'approve-count') {
        if (!count) throw new Error('请先打开盘点');
        const defaultLine = count.lines.find(({ status }) =>
          ['COUNTED', 'RECOUNTED'].includes(status),
        );
        const lineId = window.prompt('差异行 UUID', defaultLine?.id ?? '');
        const line = count.lines.find(({ id }) => id === lineId);
        const quantity = line
          ? window.prompt(
              '批准数量',
              line.recountBase ?? line.firstCountBase ?? '',
            )
          : null;
        const approvalReference = window.prompt('审批引用');
        const reason = window.prompt('差异原因');
        if (!line || quantity === null || !approvalReference || !reason) return;
        await request(`/api/v1/wms/inventory-count-lines/${line.id}/approve`, {
          body: JSON.stringify({
            approvalReference,
            expectedVersion: line.version,
            quantityBase: quantity,
            quantityOriginal: quantity,
            reason,
          }),
          method: 'POST',
        });
        await loadCount(count.order.id);
        setNotice('盘点差异已审批');
      } else if (actionId === 'advance-count') {
        if (!count) throw new Error('请先打开盘点');
        const targetStatus = window.prompt(
          '目标状态 COUNTING / REVIEWING / POSTED / CLOSED',
        );
        if (!targetStatus) return;
        await request(
          `/api/v1/wms/inventory-counts/${count.order.id}/transition`,
          {
            body: JSON.stringify({
              expectedVersion: count.order.version,
              targetStatus,
            }),
            method: 'POST',
          },
        );
        await loadCount(count.order.id);
        setNotice(`盘点已推进至 ${targetStatus}`);
      } else if (actionId === 'release-count-segment') {
        if (!count) throw new Error('请先打开盘点');
        const locationId = window.prompt(
          '解冻库位 UUID',
          count.freezes.find(({ status }) => status === 'ACTIVE')?.locationId ??
            '',
        );
        const reason = window.prompt('分段解冻原因');
        if (!locationId || !reason) return;
        await request(
          `/api/v1/wms/inventory-counts/${count.order.id}/release-segment`,
          {
            body: JSON.stringify({ locationId, reason }),
            method: 'POST',
          },
        );
        await loadCount(count.order.id);
        setNotice('盘点区域已分段解冻');
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
      <Typography.Title level={2}>库存余额、库内作业与盘点</Typography.Title>
      <Typography.Paragraph>
        九维余额强制校验 available = onHand - allocated -
        hold；移库同事务更新余额与流水，货主转换形成双向事实，盘点按初复盘、审批与分段解冻受控推进。
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
      <Drawer
        onClose={() => setCount(undefined)}
        open={Boolean(count)}
        title="循环盘点与全库盘点"
        width="78vw"
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            message={`${count?.order.countNo ?? ''} · ${count?.order.type ?? ''} · ${count?.order.status ?? ''}`}
            showIcon
            type={count?.order.status === 'CLOSED' ? 'success' : 'info'}
          />
          <Card title="初盘、复盘与差异审批">
            <DataGrid
              columns={[
                { key: 'locationId', label: '库位' },
                { key: 'status', label: '行状态' },
                { key: 'expectedQuantityBase', label: '账面数量' },
                { key: 'firstCountBase', label: '初盘' },
                { key: 'recountBase', label: '复盘' },
                { key: 'varianceReason', label: '差异原因' },
                { key: 'approvalReference', label: '审批引用' },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={count?.lines ?? []}
              total={count?.lines.length ?? 0}
            />
          </Card>
          <Card title="冻结范围与分段解冻">
            <Typography.Paragraph>
              冻结记录 {count?.freezes.length ?? 0} 条，活动冻结{' '}
              {count?.freezes.filter(({ status }) => status === 'ACTIVE')
                .length ?? 0}{' '}
              条。
            </Typography.Paragraph>
          </Card>
        </Space>
      </Drawer>
      <InventoryGovernanceWorkbench />
    </section>
  );
}
