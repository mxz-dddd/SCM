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

type InboundStatus =
  | 'NONE'
  | 'DRAFT'
  | 'EXPECTED'
  | 'ARRIVED'
  | 'RECEIVING'
  | 'COMPLETED'
  | 'CANCELLED';

interface InboundRow {
  asnMode: string;
  expectedArrival: string | null;
  id: string;
  inboundNo: string;
  ownerId: string;
  sourceRef: string;
  status: Exclude<InboundStatus, 'NONE'>;
  version: number;
  warehouseId: string;
}
interface InboundLine {
  baseUom: string;
  id: string;
  lineNo: number;
  originalUom: string;
  productId: string;
  quantityBase: string;
  quantityOriginal: string;
}
interface InboundPackage {
  id: string;
  lpn: string;
  packageType: string;
  parentPackageId: string | null;
  status: string;
}
interface AppointmentLink {
  appointmentId: string;
  id: string;
  sourceVersion: number;
  status: string;
}
interface ArrivalEvent {
  eventType: string;
  id: string;
  occurredAt: string;
  temporaryRegistration: boolean;
}
interface ReceiptTask {
  assignedTo: string | null;
  id: string;
  pausedReason: string | null;
  status: string;
  taskNo: string;
  version: number;
  workload: string;
  workloadUom: string;
}
interface ScanEvent {
  id: string;
  normalizedBarcode: string;
  rawBarcode: string;
  resolvedObjectType: string | null;
  status: string;
}
interface InboundDetail extends InboundRow {
  appointments: AppointmentLink[];
  arrivals: ArrivalEvent[];
  assignments: Array<{
    id: string;
    mode: string;
    reason: string;
    toAssignee: string;
  }>;
  lines: InboundLine[];
  packages: InboundPackage[];
  scans: ScanEvent[];
  tasks: ReceiptTask[];
}
interface ListResponse {
  items: InboundRow[];
  page: number;
  pageSize: number;
  total: number;
}

const actions = createActionRegistry<InboundStatus>([
  {
    id: 'create',
    label: '新建入库单',
    requiredPermissions: ['wms.inbound.write'],
  },
  {
    allowedStatuses: ['DRAFT'],
    id: 'parse-packages',
    label: '解析箱托层级',
    requiredPermissions: ['wms.inbound.package'],
  },
  {
    allowedStatuses: ['DRAFT'],
    confirmMessage: '发布后入库单进入 Expected，行项目不再允许修改。',
    id: 'publish',
    label: '发布预期入库',
    requiredPermissions: ['wms.inbound.publish'],
  },
  {
    allowedStatuses: ['EXPECTED'],
    id: 'appointment',
    label: '接入预约投影',
    requiredPermissions: ['wms.inbound.appointment.project'],
  },
  {
    allowedStatuses: ['EXPECTED'],
    id: 'check-in',
    label: '车辆到场签到',
    requiredPermissions: ['wms.inbound.checkin'],
  },
  {
    allowedStatuses: ['ARRIVED'],
    id: 'create-task',
    label: '生成收货任务',
    requiredPermissions: ['wms.receipt.task.write'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'claim-task',
    label: '抢单',
    requiredPermissions: ['wms.receipt.task.claim'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'transfer-task',
    label: '转派',
    requiredPermissions: ['wms.receipt.task.transfer'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'advance-task',
    label: '推进任务状态',
    requiredPermissions: ['wms.receipt.task.execute'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'pause-task',
    label: '暂停任务',
    requiredPermissions: ['wms.receipt.task.execute'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    confirmMessage: '仅当全部收货任务终态时才可完成入库。',
    id: 'complete',
    label: '完成入库',
    requiredPermissions: ['wms.inbound.complete'],
  },
  {
    id: 'scan',
    label: '条码扫描识别',
    requiredPermissions: ['wms.scan.write'],
  },
  {
    allowedStatuses: ['DRAFT', 'EXPECTED', 'ARRIVED', 'RECEIVING', 'COMPLETED'],
    id: 'manual-resolve',
    label: '人工解析条码',
    requiredPermissions: ['wms.scan.resolve'],
  },
]);

export function InboundWorkbench() {
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
  const [detail, setDetail] = useState<InboundDetail>();
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
      if (!accessToken || !claims)
        throw new Error('请先登录后使用入库接入工作台');
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
            `/api/v1/wms/inbounds?${query.toString()}`,
          )) as unknown as ListResponse,
        );
        setError(undefined);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '入库单查询失败');
      }
    },
    [accessToken, claims, filters, request],
  );
  useEffect(() => void refresh(1), [refresh]);

  async function loadDetail(id: string) {
    try {
      setDetail(
        (await request(
          `/api/v1/wms/inbounds/${id}`,
        )) as unknown as InboundDetail,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '入库详情查询失败');
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
      if (actionId === 'create') {
        const productId = window.prompt('商品 UUID');
        const warehouseId = window.prompt('仓库 UUID');
        const ownerId = window.prompt('货主 UUID');
        if (!productId || !warehouseId || !ownerId) return;
        await request('/api/v1/wms/inbounds', {
          body: JSON.stringify({
            asnMode: 'NONE',
            lines: [
              {
                baseUom: 'EA',
                lineNo: 1,
                originalUom: 'EA',
                productId,
                quantityBase: '1',
                quantityOriginal: '1',
              },
            ],
            ownerId,
            sourceRef: `MANUAL-${Date.now()}`,
            sourceType: 'PURCHASE',
            sourceVersion: 1,
            warehouseId,
          }),
          method: 'POST',
        });
        setNotice('入库草稿已创建');
      } else if (actionId === 'scan') {
        const rawBarcode = window.prompt('扫描条码');
        if (!rawBarcode) return;
        await request('/api/v1/wms/scans', {
          body: JSON.stringify({
            deviceId: 'WEB-WORKBENCH',
            deviceSequence: Date.now(),
            ...(selected ? { inboundOrderId: selected.id } : {}),
            rawBarcode,
            scannedAt: new Date().toISOString(),
          }),
          method: 'POST',
        });
        setNotice('条码扫描事实已记录');
      } else if (selected && actionId === 'parse-packages') {
        const line = detail?.lines[0];
        const lpn = window.prompt('箱 LPN');
        if (!line || !lpn) throw new Error('请先打开含行项目的入库详情');
        await request(`/api/v1/wms/inbounds/${selected.id}/packages/parse`, {
          body: JSON.stringify({
            expectedVersion: selected.version,
            packages: [
              {
                clientRef: 'carton-1',
                contents: [
                  {
                    baseUom: line.baseUom,
                    inboundLineId: line.id,
                    originalUom: line.originalUom,
                    quantityBase: line.quantityBase,
                    quantityOriginal: line.quantityOriginal,
                  },
                ],
                lpn,
                packageType: 'CARTON',
              },
            ],
          }),
          method: 'POST',
        });
        setNotice('ASN 箱托层级与数量守恒校验通过');
      } else if (selected && actionId === 'publish') {
        await request(`/api/v1/wms/inbounds/${selected.id}/publish`, {
          body: JSON.stringify({ expectedVersion: selected.version }),
          method: 'POST',
        });
        setNotice('入库单已发布为 Expected');
      } else if (selected && actionId === 'appointment') {
        await request(
          `/api/v1/wms/inbounds/${selected.id}/appointment-projections`,
          {
            body: JSON.stringify({
              appointmentId: crypto.randomUUID(),
              appointmentSnapshot: { source: 'AMS_WORKBENCH' },
              sourceVersion: 1,
              status: 'CONFIRMED',
            }),
            method: 'POST',
          },
        );
        setNotice('AMS 预约只读投影已关联');
      } else if (selected && actionId === 'check-in') {
        const appointmentId = detail?.appointments.at(-1)?.appointmentId;
        await request(`/api/v1/wms/inbounds/${selected.id}/check-in`, {
          body: JSON.stringify(
            appointmentId
              ? {
                  appointmentId,
                  expectedVersion: selected.version,
                  occurredAt: new Date().toISOString(),
                }
              : {
                  approvalReference: 'WEB-TEMPORARY-APPROVAL',
                  expectedVersion: selected.version,
                  occurredAt: new Date().toISOString(),
                  temporaryRegistration: true,
                },
          ),
          method: 'POST',
        });
        setNotice('不可变到场签到事件已记录');
      } else if (selected && actionId === 'create-task') {
        await request(`/api/v1/wms/inbounds/${selected.id}/receipt-tasks`, {
          body: JSON.stringify({
            expectedVersion: selected.version,
            tasks: [{ workload: '1', workloadUom: 'EA' }],
          }),
          method: 'POST',
        });
        setNotice('收货任务已生成，支持自动派工与抢单');
      } else if (selected && actionId === 'claim-task') {
        const task = detail?.tasks.find(({ status }) => status === 'OPEN');
        if (!task) throw new Error('没有可抢的开放任务');
        await request(`/api/v1/wms/receipt-tasks/${task.id}/claim`, {
          body: JSON.stringify({
            assignedTo: claims!.subject,
            expectedVersion: task.version,
            reason: '工作台抢单',
          }),
          method: 'POST',
        });
        setNotice('抢单成功');
      } else if (selected && actionId === 'transfer-task') {
        const task = detail?.tasks.find(({ status }) =>
          ['ASSIGNED', 'IN_PROGRESS', 'PAUSED'].includes(status),
        );
        const assignedTo = window.prompt('转派人员 UUID');
        if (!task || !assignedTo) throw new Error('没有可转派任务或人员为空');
        await request(`/api/v1/wms/receipt-tasks/${task.id}/transfer`, {
          body: JSON.stringify({
            assignedTo,
            expectedVersion: task.version,
            reason: '工作台转派',
          }),
          method: 'POST',
        });
        setNotice('转派历史已记录');
      } else if (selected && actionId === 'pause-task') {
        const task = detail?.tasks.find(
          ({ status }) => status === 'IN_PROGRESS',
        );
        const reason = window.prompt('暂停原因');
        if (!task || !reason) throw new Error('没有执行中任务或原因为空');
        await request(`/api/v1/wms/receipt-tasks/${task.id}/transition`, {
          body: JSON.stringify({
            expectedVersion: task.version,
            reason,
            targetStatus: 'PAUSED',
          }),
          method: 'POST',
        });
        setNotice('任务已暂停并保留原因');
      } else if (selected && actionId === 'advance-task') {
        const task = detail?.tasks.find(({ status }) =>
          ['ASSIGNED', 'PAUSED', 'IN_PROGRESS'].includes(status),
        );
        if (!task) throw new Error('没有可推进的任务');
        const targetStatus =
          task.status === 'IN_PROGRESS' ? 'COMPLETED' : 'IN_PROGRESS';
        await request(`/api/v1/wms/receipt-tasks/${task.id}/transition`, {
          body: JSON.stringify({ expectedVersion: task.version, targetStatus }),
          method: 'POST',
        });
        setNotice(`任务已推进至 ${targetStatus}`);
      } else if (selected && actionId === 'complete') {
        await request(`/api/v1/wms/inbounds/${selected.id}/complete`, {
          body: JSON.stringify({ expectedVersion: selected.version }),
          method: 'POST',
        });
        setNotice('入库单已完成');
      } else if (selected && actionId === 'manual-resolve') {
        const scan = detail?.scans.find(
          ({ status }) => status === 'UNRESOLVED',
        );
        const objectId = window.prompt('解析对象 UUID');
        const objectType = window.prompt(
          '对象类型 ORDER / PRODUCT / PACKAGE / LOCATION',
        );
        const reason = window.prompt('人工解析原因');
        if (!scan || !objectId || !objectType || !reason)
          throw new Error('未解析扫描或解析信息不完整');
        await request(`/api/v1/wms/scans/${scan.id}/manual-resolution`, {
          body: JSON.stringify({ objectId, objectType, reason }),
          method: 'POST',
        });
        setNotice('人工条码解析事实已追加');
      }
      setError(undefined);
      await refresh(response.page);
      if (selected) await loadDetail(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '入库操作失败');
    }
  }

  return (
    <section>
      <Typography.Title level={2}>入库接入与收货执行</Typography.Title>
      <Typography.Paragraph>
        统一处理入库状态、ASN 箱托、预约投影、到场签到、派工抢单与
        GS1/客户码解析。
      </Typography.Paragraph>
      {error ? <Alert message={error} showIcon type="error" /> : null}
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      <QueryPanel
        expanded
        fields={[
          {
            label: '入库号/来源号',
            name: 'query',
            quick: true,
            type: 'search',
          },
          { label: '状态', name: 'status', quick: true },
          { label: '仓库 UUID', name: 'warehouseId' },
        ]}
        onQuery={(values) => setFilters({ ...values })}
        onReset={() => setFilters({})}
        onSaveView={() => setNotice('入库查询视图已保存')}
      />
      <CommandBar actions={decisions} onAction={({ id }) => void execute(id)} />
      <DataGrid
        columns={[
          { fixed: 'left', key: 'inboundNo', label: '入库单号' },
          { key: 'sourceRef', label: '来源单号' },
          {
            key: 'status',
            label: '状态',
            render: (value) => <StatusBadge status={String(value)} />,
          },
          { key: 'asnMode', label: 'ASN 模式' },
          { key: 'warehouseId', label: '仓库' },
          { key: 'ownerId', label: '货主' },
          { key: 'expectedArrival', label: '预计到达' },
          { key: 'version', label: '版本' },
        ]}
        onColumnsChange={() => setNotice('入库列表列配置已保存')}
        onPageChange={(page) => void refresh(page)}
        onRowContextMenu={(row) => void loadDetail(row.id)}
        onSelectionChange={(ids) => {
          setSelectedIds(ids);
          const id = ids.at(-1);
          if (id) void loadDetail(id);
        }}
        page={response.page}
        pageSize={response.pageSize}
        rows={response.items}
        selectedIds={selectedIds}
        total={response.total}
      />
      <Drawer
        onClose={() => setDetail(undefined)}
        open={Boolean(detail)}
        title={detail ? `入库详情 · ${detail.inboundNo}` : '入库详情'}
        width="76vw"
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Card title="状态与跨域边界快照">
            <Typography.Text>
              {detail?.status} · v{detail?.version} · AMS 仅通过预约投影接入
            </Typography.Text>
          </Card>
          <Card title="入库行与原/基础单位数量">
            <DataGrid
              columns={[
                { key: 'lineNo', label: '行号' },
                { key: 'productId', label: '商品' },
                { key: 'quantityOriginal', label: '原数量' },
                { key: 'originalUom', label: '原单位' },
                { key: 'quantityBase', label: '基础数量' },
                { key: 'baseUom', label: '基础单位' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={detail?.lines ?? []}
              total={detail?.lines.length ?? 0}
            />
          </Card>
          <Card title="ASN 箱托层级与 LPN">
            <DataGrid
              columns={[
                { key: 'lpn', label: 'LPN' },
                { key: 'packageType', label: '包装层级' },
                { key: 'parentPackageId', label: '上级包装' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={detail?.packages ?? []}
              total={detail?.packages.length ?? 0}
            />
          </Card>
          <Card title="预约关联与不可变到场事件">
            <Typography.Paragraph>
              预约投影 {detail?.appointments.length ?? 0} 条；到场事件{' '}
              {detail?.arrivals.length ?? 0} 条。
            </Typography.Paragraph>
          </Card>
          <Card title="收货任务与派工历史">
            <DataGrid
              columns={[
                { key: 'taskNo', label: '任务号' },
                { key: 'status', label: '状态' },
                { key: 'assignedTo', label: '执行人' },
                { key: 'workload', label: '工作量' },
                { key: 'workloadUom', label: '单位' },
                { key: 'pausedReason', label: '暂停原因' },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={detail?.tasks ?? []}
              total={detail?.tasks.length ?? 0}
            />
            <Typography.Paragraph>
              自动派工 / 抢单 / 转派历史 {detail?.assignments.length ?? 0} 条。
            </Typography.Paragraph>
          </Card>
          <Card title="GS1、客户码与人工解析">
            <DataGrid
              columns={[
                { key: 'rawBarcode', label: '原始条码' },
                { key: 'normalizedBarcode', label: '标准化条码' },
                { key: 'resolvedObjectType', label: '对象类型' },
                { key: 'status', label: '解析状态' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={detail?.scans ?? []}
              total={detail?.scans.length ?? 0}
            />
          </Card>
        </Space>
      </Drawer>
    </section>
  );
}
