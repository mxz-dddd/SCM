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
interface ReceiptLineRow {
  acceptedQuantityBase: string;
  id: string;
  mode: string;
  pendingQuantityBase: string;
  productId: string;
  receivedQuantityBase: string;
  rejectedQuantityBase: string;
}
interface ReceivingVarianceRow {
  id: string;
  reason: string;
  status: string;
  type: string;
  version: number;
}
interface HandlingUnitRow {
  id: string;
  labelNumber: string;
  lpn: string;
  parentHandlingUnitId: string | null;
  status: string;
  type: string;
  version: number;
}
interface HandlingUnitContentRow {
  handlingUnitId: string;
  id: string;
  quantityBase: string;
  quantityOriginal: string;
  receiptLineId: string;
  status: string;
}
interface ReceivingDetail {
  handlingUnitContents: HandlingUnitContentRow[];
  handlingUnitEvents: Array<{ id: string; occurredAt: string; type: string }>;
  handlingUnits: HandlingUnitRow[];
  labelJobs: Array<{
    id: string;
    jobNo: string;
    labelNumber: string;
    status: string;
  }>;
  lots: Array<{ id: string; status: string }>;
  receiptLines: ReceiptLineRow[];
  serials: Array<{ id: string; serialNumber: string; status: string }>;
  variances: ReceivingVarianceRow[];
}
interface QualityPutawayDetail {
  crossDocks: Array<{
    demandRef: string;
    id: string;
    status: string;
    version: number;
  }>;
  decisions: Array<{
    evaluationTraceId: string;
    handlingUnitId: string;
    id: string;
    selectedLocationId: string;
    status: string;
    version: number;
  }>;
  dispositions: Array<{
    id: string;
    reason: string;
    type: string;
  }>;
  inspections: Array<{
    id: string;
    inventoryLotId: string | null;
    planMode: string;
    receiptLineId: string;
    sampleSize: number;
    status: string;
    version: number;
  }>;
  movements: Array<{
    id: string;
    scannedLpn: string;
    scannedTargetCode: string;
  }>;
  results: Array<{ id: string; itemCode: string; passed: boolean }>;
  tasks: Array<{
    handlingUnitId: string;
    id: string;
    quantityBase: string;
    status: string;
    targetLocationId: string;
    version: number;
  }>;
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
    id: 'receive-blind',
    label: '盲收确认',
    requiredPermissions: ['wms.receipt.receive'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'receive-ordered',
    label: '按单收货',
    requiredPermissions: ['wms.receipt.receive'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    confirmMessage: '超收、短收或替代包装将记录主管授权与差异通知。',
    id: 'receive-authorized',
    label: '授权超短收',
    requiredPermissions: ['wms.receipt.variance.authorize'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'create-handling-unit',
    label: '生成 LPN',
    requiredPermissions: ['wms.handling-unit.write'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'build-pallet',
    label: '建托',
    requiredPermissions: ['wms.handling-unit.build'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'split-pallet',
    label: '拆托',
    requiredPermissions: ['wms.handling-unit.split'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'merge-pallet',
    label: '合托',
    requiredPermissions: ['wms.handling-unit.merge'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'reprint-label',
    label: '补打标签',
    requiredPermissions: ['wms.label.print'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'open-variance',
    label: '记录差异',
    requiredPermissions: ['wms.receiving.variance.write'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'dispose-variance',
    label: '处置差异',
    requiredPermissions: ['wms.receiving.variance.dispose'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'plan-inspection',
    label: '创建质检计划',
    requiredPermissions: ['wms.quality.plan'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'advance-inspection',
    label: '推进质检',
    requiredPermissions: ['wms.quality.inspect'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    confirmMessage: '不合格品处置将记录审批引用、数量与计费事实快照。',
    id: 'dispose-quality',
    label: '不合格处置',
    requiredPermissions: ['wms.quality.dispose'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'decide-putaway',
    label: '计算上架库位',
    requiredPermissions: ['wms.putaway.decide'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'create-putaway-task',
    label: '生成上架任务',
    requiredPermissions: ['wms.putaway.task.write'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'execute-putaway',
    label: '执行上架扫描',
    requiredPermissions: ['wms.putaway.task.execute'],
  },
  {
    allowedStatuses: ['RECEIVING'],
    id: 'cross-dock',
    label: '越库匹配',
    requiredPermissions: ['wms.cross-dock.write'],
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
  const [receivingDetail, setReceivingDetail] = useState<ReceivingDetail>();
  const [qualityPutaway, setQualityPutaway] = useState<QualityPutawayDetail>();
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
      const [nextDetail, nextReceivingDetail, nextQualityPutaway] =
        await Promise.all([
          request(`/api/v1/wms/inbounds/${id}`),
          request(`/api/v1/wms/inbounds/${id}/receiving-detail`),
          request(`/api/v1/wms/inbounds/${id}/quality-putaway`),
        ]);
      setDetail(nextDetail as unknown as InboundDetail);
      setReceivingDetail(nextReceivingDetail as unknown as ReceivingDetail);
      setQualityPutaway(nextQualityPutaway as unknown as QualityPutawayDetail);
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
      } else if (
        selected &&
        ['receive-blind', 'receive-ordered', 'receive-authorized'].includes(
          actionId,
        )
      ) {
        const task = detail?.tasks.find(
          ({ status }) => status === 'IN_PROGRESS',
        );
        const line = detail?.lines[0];
        const received = window.prompt(
          '本次收货数量',
          line?.quantityBase ?? '1',
        );
        if (!task || !line || !received)
          throw new Error('需要执行中任务、入库行和收货数量');
        const batch = window.prompt('供应商批次（无批次控制可空）');
        const serials = (window.prompt('序列号，逗号分隔（可空）') ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        const authorized = actionId === 'receive-authorized';
        await request(
          `/api/v1/wms/inbounds/${selected.id}/${authorized ? 'receive-authorized' : 'receive'}`,
          {
            body: JSON.stringify({
              expectedTaskVersion: task.version,
              lines: [
                {
                  accepted: {
                    quantityBase: received,
                    quantityOriginal: received,
                  },
                  ...(authorized
                    ? {
                        authorizationReference: `WEB-${Date.now()}`,
                        varianceReason: '工作台主管授权',
                      }
                    : {}),
                  inboundLineId: line.id,
                  ...(batch
                    ? {
                        lots: [
                          {
                            clientRef: 'web-lot',
                            expiryDate: window.prompt('失效日期 YYYY-MM-DD'),
                            productionDate:
                              window.prompt('生产日期 YYYY-MM-DD'),
                            quantityBase: received,
                            quantityOriginal: received,
                            supplierBatchNo: batch,
                          },
                        ],
                      }
                    : {}),
                  pending: { quantityBase: '0', quantityOriginal: '0' },
                  received: {
                    quantityBase: received,
                    quantityOriginal: received,
                  },
                  rejected: { quantityBase: '0', quantityOriginal: '0' },
                  ...(serials.length
                    ? {
                        serials: serials.map((serialNumber) => ({
                          ...(batch ? { lotClientRef: 'web-lot' } : {}),
                          serialNumber,
                        })),
                      }
                    : {}),
                },
              ],
              mode: actionId === 'receive-blind' ? 'BLIND' : 'ORDERED',
              receivedAt: new Date().toISOString(),
              taskId: task.id,
            }),
            method: 'POST',
          },
        );
        setNotice(authorized ? '授权超短收已确认并生成差异' : '收货事实已确认');
      } else if (selected && actionId === 'create-handling-unit') {
        const receipt = receivingDetail?.receiptLines[0];
        const lpn = window.prompt('新 LPN');
        const type = window.prompt('类型 CARTON / PALLET', 'CARTON');
        if (!lpn || !type) throw new Error('需要 LPN 与类型');
        if (type === 'CARTON' && !receipt)
          throw new Error('箱 LPN 需要已确认收货行');
        await request(`/api/v1/wms/inbounds/${selected.id}/handling-units`, {
          body: JSON.stringify({
            contents:
              type === 'PALLET'
                ? []
                : [
                    {
                      quantityBase: receipt!.acceptedQuantityBase,
                      quantityOriginal: receipt!.acceptedQuantityBase,
                      receiptLineId: receipt!.id,
                    },
                  ],
            lpn,
            type,
          }),
          method: 'POST',
        });
        setNotice('LPN 与初始标签任务已生成');
      } else if (selected && actionId === 'build-pallet') {
        const child = receivingDetail?.handlingUnits.find(
          ({ status, type }) => status === 'ACTIVE' && type === 'CARTON',
        );
        const parent = receivingDetail?.handlingUnits.find(
          ({ status, type }) => status === 'ACTIVE' && type === 'PALLET',
        );
        if (!child || !parent) throw new Error('需要活动箱 LPN 与托盘 LPN');
        await request(`/api/v1/wms/handling-units/${parent.id}/build`, {
          body: JSON.stringify({
            childExpectedVersion: child.version,
            childId: child.id,
            parentExpectedVersion: parent.version,
          }),
          method: 'POST',
        });
        setNotice('建托完成并追加处理单元事件');
      } else if (selected && actionId === 'split-pallet') {
        const unit = receivingDetail?.handlingUnits.find(
          ({ status }) => status === 'ACTIVE',
        );
        const content = receivingDetail?.handlingUnitContents.find(
          (item) =>
            item.handlingUnitId === unit?.id && item.status === 'ACTIVE',
        );
        const quantity = window.prompt('拆出数量', '1');
        if (!unit || !content || !quantity) throw new Error('没有可拆处理单元');
        await request(`/api/v1/wms/handling-units/${unit.id}/split`, {
          body: JSON.stringify({
            contents: [
              {
                quantityBase: quantity,
                quantityOriginal: quantity,
                receiptLineId: content.receiptLineId,
              },
            ],
            expectedVersion: unit.version,
          }),
          method: 'POST',
        });
        setNotice('拆托完成并生成新 LPN/标签');
      } else if (selected && actionId === 'merge-pallet') {
        const units = (receivingDetail?.handlingUnits ?? []).filter(
          ({ status }) => status === 'ACTIVE',
        );
        if (units.length < 2) throw new Error('至少需要两个活动处理单元');
        await request(`/api/v1/wms/handling-units/${units[0]!.id}/merge`, {
          body: JSON.stringify({
            sourceExpectedVersion: units[1]!.version,
            sourceId: units[1]!.id,
            targetExpectedVersion: units[0]!.version,
          }),
          method: 'POST',
        });
        setNotice('合托完成，来源 LPN 保留追溯');
      } else if (selected && actionId === 'reprint-label') {
        const unit = receivingDetail?.handlingUnits[0];
        const reason = window.prompt('补打原因');
        if (!unit || !reason) throw new Error('需要处理单元与补打原因');
        await request(`/api/v1/wms/handling-units/${unit.id}/labels/reprint`, {
          body: JSON.stringify({ copies: 1, reason }),
          method: 'POST',
        });
        setNotice('已创建同标签号的新补打任务');
      } else if (selected && actionId === 'open-variance') {
        const type = window.prompt('差异类型', 'DAMAGE');
        const reason = window.prompt('差异原因');
        const attachmentId = window.prompt('照片附件 UUID（可空）');
        if (!type || !reason) throw new Error('差异类型与原因必填');
        await request('/api/v1/wms/receiving-variances', {
          body: JSON.stringify({
            inboundOrderId: selected.id,
            ...(attachmentId ? { photoRefs: [{ attachmentId }] } : {}),
            reason,
            type,
          }),
          method: 'POST',
        });
        setNotice('差异已记录并通过 Outbox 通知采购/供应商');
      } else if (selected && actionId === 'dispose-variance') {
        const variance = receivingDetail?.variances.find(
          ({ status }) => status === 'PENDING',
        );
        const targetStatus = window.prompt('处置状态', 'QUALITY_REVIEW');
        const reason = window.prompt('处置原因');
        if (!variance || !targetStatus || !reason)
          throw new Error('没有待处置差异或处置信息不完整');
        await request(
          `/api/v1/wms/receiving-variances/${variance.id}/disposition`,
          {
            body: JSON.stringify({
              expectedVersion: variance.version,
              reason,
              targetStatus,
            }),
            method: 'POST',
          },
        );
        setNotice(`差异已处置为 ${targetStatus}`);
      } else if (selected && actionId === 'plan-inspection') {
        const receipt = receivingDetail?.receiptLines[0];
        const lot = receivingDetail?.lots[0];
        const planMode = window.prompt(
          '质检方式 EXEMPT / FULL / SAMPLE',
          'SAMPLE',
        );
        const sampleSize = Number(
          planMode === 'EXEMPT' ? 0 : window.prompt('抽样数量', '1'),
        );
        if (!receipt || !planMode || !Number.isInteger(sampleSize))
          throw new Error('需要已确认收货行、质检方式和抽样数量');
        await request(`/api/v1/wms/inbounds/${selected.id}/inspections`, {
          body: JSON.stringify({
            ...(lot ? { inventoryLotId: lot.id } : {}),
            planMode,
            planSnapshot: { source: 'WEB_WORKBENCH' },
            receiptLineId: receipt.id,
            riskScore: window.prompt('风险分', '0') ?? '0',
            sampleSize,
          }),
          method: 'POST',
        });
        setNotice('质检计划已创建，未放行库存保持不可用');
      } else if (selected && actionId === 'advance-inspection') {
        const inspection = qualityPutaway?.inspections.find(({ status }) =>
          ['PENDING', 'INSPECTING', 'HOLD'].includes(status),
        );
        if (!inspection) throw new Error('没有可推进的质检单');
        const targetStatus =
          inspection.status === 'PENDING' && inspection.planMode !== 'EXEMPT'
            ? 'INSPECTING'
            : inspection.status === 'HOLD'
              ? 'INSPECTING'
              : inspection.planMode === 'EXEMPT'
                ? 'ACCEPTED'
                : window.prompt('质检结果 ACCEPTED / REJECTED / HOLD');
        if (!targetStatus) return;
        const terminal = ['ACCEPTED', 'REJECTED', 'HOLD'].includes(
          targetStatus,
        );
        await request(`/api/v1/wms/inspections/${inspection.id}/transition`, {
          body: JSON.stringify({
            expectedVersion: inspection.version,
            ...(terminal && inspection.planMode !== 'EXEMPT'
              ? {
                  resultSummary: { source: 'WEB_WORKBENCH' },
                  results: Array.from(
                    { length: inspection.sampleSize },
                    (_, index) => ({
                      expectedSnapshot: { accepted: true },
                      itemCode: 'VISUAL',
                      measuredSnapshot: {
                        accepted: targetStatus === 'ACCEPTED',
                      },
                      passed: targetStatus === 'ACCEPTED',
                      sampleRef: `WEB-${index + 1}`,
                    }),
                  ),
                }
              : {}),
            targetStatus,
          }),
          method: 'POST',
        });
        setNotice(`质检已推进至 ${targetStatus}`);
      } else if (selected && actionId === 'dispose-quality') {
        const inspection = qualityPutaway?.inspections.find(({ status }) =>
          ['REJECTED', 'HOLD'].includes(status),
        );
        const receipt = receivingDetail?.receiptLines.find(
          ({ id }) => id === inspection?.receiptLineId,
        );
        const type = window.prompt(
          '处置 RETURN_SUPPLIER / REWORK / DOWNGRADE / SCRAP / CONCESSION',
          'CONCESSION',
        );
        const reason = window.prompt('处置原因');
        if (!inspection || !receipt || !type || !reason)
          throw new Error('没有待处置质检单或处置信息不完整');
        await request(`/api/v1/wms/inspections/${inspection.id}/dispositions`, {
          body: JSON.stringify({
            ...(type === 'CONCESSION'
              ? { approvalReference: window.prompt('特采审批引用') }
              : {}),
            expectedInspectionVersion: inspection.version,
            quantityBase: receipt.acceptedQuantityBase,
            quantityOriginal: receipt.acceptedQuantityBase,
            reason,
            type,
          }),
          method: 'POST',
        });
        setNotice(`不合格品已处置为 ${type}`);
      } else if (selected && actionId === 'decide-putaway') {
        const unit = receivingDetail?.handlingUnits.find(
          ({ status }) => status === 'ACTIVE',
        );
        const content = receivingDetail?.handlingUnitContents.find(
          ({ handlingUnitId, status }) =>
            handlingUnitId === unit?.id && status === 'ACTIVE',
        );
        const receipt = receivingDetail?.receiptLines.find(
          ({ id }) => id === content?.receiptLineId,
        );
        const lot = receivingDetail?.lots.find(
          ({ status }) => status === 'RELEASED',
        );
        if (!unit || !receipt) throw new Error('需要已质检放行的活动 LPN');
        await request(`/api/v1/wms/inbounds/${selected.id}/putaway-decisions`, {
          body: JSON.stringify({
            handlingUnitId: unit.id,
            ...(lot ? { inventoryLotId: lot.id } : {}),
            productId: receipt.productId,
            ruleSetCode:
              window.prompt('上架规则集代码', 'PUTAWAY_DEFAULT') ??
              'PUTAWAY_DEFAULT',
          }),
          method: 'POST',
        });
        setNotice('硬约束过滤与规则评估已完成，StrategyTrace 已保存');
      } else if (selected && actionId === 'create-putaway-task') {
        const decision = qualityPutaway?.decisions.find(
          ({ status }) => status === 'PROPOSED',
        );
        const unit = receivingDetail?.handlingUnits.find(
          ({ id }) => id === decision?.handlingUnitId,
        );
        const content = receivingDetail?.handlingUnitContents.find(
          ({ handlingUnitId, status }) =>
            handlingUnitId === unit?.id && status === 'ACTIVE',
        );
        if (!decision || !content) throw new Error('没有可确认的上架决策');
        const quantity =
          window.prompt('本次上架数量', content.quantityBase) ??
          content.quantityBase;
        await request(`/api/v1/wms/putaway-decisions/${decision.id}/tasks`, {
          body: JSON.stringify({
            assignedTo: claims!.subject,
            decisionExpectedVersion: decision.version,
            quantityBase: quantity,
            quantityOriginal: quantity,
          }),
          method: 'POST',
        });
        setNotice('上架任务已按路径顺序生成');
      } else if (selected && actionId === 'execute-putaway') {
        const task = qualityPutaway?.tasks.find(({ status }) =>
          ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(status),
        );
        if (!task) throw new Error('没有可执行的上架任务');
        if (task.status !== 'IN_PROGRESS') {
          await request(`/api/v1/wms/putaway-tasks/${task.id}/start`, {
            body: JSON.stringify({ expectedVersion: task.version }),
            method: 'POST',
          });
          setNotice('上架任务已开始，请再次执行并扫描 LPN/目标库位');
        } else {
          const unit = receivingDetail?.handlingUnits.find(
            ({ id }) => id === task.handlingUnitId,
          );
          const scannedLpn = window.prompt('扫描 LPN', unit?.lpn);
          const scannedTargetCode = window.prompt('扫描目标库位编码');
          if (!scannedLpn || !scannedTargetCode)
            throw new Error('LPN 与目标库位扫描必填');
          await request(`/api/v1/wms/putaway-tasks/${task.id}/confirm`, {
            body: JSON.stringify({
              expectedVersion: task.version,
              scannedLpn,
              scannedTargetCode,
            }),
            method: 'POST',
          });
          setNotice('上架移动已确认并形成不可变库存引用');
        }
      } else if (selected && actionId === 'cross-dock') {
        const existing = qualityPutaway?.crossDocks.find(({ status }) =>
          ['PROPOSED', 'RESERVED'].includes(status),
        );
        if (existing) {
          const targetStatus =
            existing.status === 'PROPOSED' ? 'RESERVED' : 'COMPLETED';
          await request(
            `/api/v1/wms/cross-dock-allocations/${existing.id}/transition`,
            {
              body: JSON.stringify({
                expectedVersion: existing.version,
                targetStatus,
              }),
              method: 'POST',
            },
          );
          setNotice(`越库分配已推进至 ${targetStatus}`);
        } else {
          const receipt = receivingDetail?.receiptLines[0];
          const stagingLocationId = window.prompt('暂存库位 UUID');
          const demandRef = window.prompt('需求单号');
          if (!receipt || !stagingLocationId || !demandRef)
            throw new Error('需要收货行、暂存库位和需求单号');
          const windowStart = new Date(Date.now() + 60_000);
          const windowEnd = new Date(Date.now() + 3_660_000);
          await request(
            `/api/v1/wms/inbounds/${selected.id}/cross-dock-allocations`,
            {
              body: JSON.stringify({
                demandRef,
                demandSnapshot: { productId: receipt.productId },
                productId: receipt.productId,
                quantityBase: receipt.acceptedQuantityBase,
                quantityOriginal: receipt.acceptedQuantityBase,
                receiptLineId: receipt.id,
                stagingLocationId,
                windowEnd: windowEnd.toISOString(),
                windowStart: windowStart.toISOString(),
              }),
              method: 'POST',
            },
          );
          setNotice('越库需求、品质状态与时间窗匹配成功');
        }
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
        onClose={() => {
          setDetail(undefined);
          setReceivingDetail(undefined);
          setQualityPutaway(undefined);
        }}
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
          <Card title="盲收 / 按单收货与数量分解">
            <DataGrid
              columns={[
                { key: 'mode', label: '模式' },
                { key: 'productId', label: '商品' },
                { key: 'receivedQuantityBase', label: '已收' },
                { key: 'acceptedQuantityBase', label: '接受' },
                { key: 'rejectedQuantityBase', label: '拒收' },
                { key: 'pendingQuantityBase', label: '待定' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={receivingDetail?.receiptLines ?? []}
              total={receivingDetail?.receiptLines.length ?? 0}
            />
          </Card>
          <Card title="批次、序列与效期隔离">
            <Typography.Paragraph>
              批次 {receivingDetail?.lots.length ?? 0}；序列号{' '}
              {receivingDetail?.serials.length ?? 0}；隔离批次{' '}
              {receivingDetail?.lots.filter(
                ({ status }) => status === 'QUARANTINED',
              ).length ?? 0}
              。
            </Typography.Paragraph>
          </Card>
          <Card title="LPN 建托、拆托、合托与标签">
            <DataGrid
              columns={[
                { key: 'lpn', label: 'LPN' },
                { key: 'type', label: '类型' },
                { key: 'parentHandlingUnitId', label: '父 LPN' },
                { key: 'labelNumber', label: '标签号' },
                { key: 'status', label: '状态' },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={receivingDetail?.handlingUnits ?? []}
              total={receivingDetail?.handlingUnits.length ?? 0}
            />
            <Typography.Paragraph>
              不可变处理单元事件{' '}
              {receivingDetail?.handlingUnitEvents.length ?? 0}；标签任务{' '}
              {receivingDetail?.labelJobs.length ?? 0}。
            </Typography.Paragraph>
          </Card>
          <Card title="质检计划、抽样结果与放行状态">
            <DataGrid
              columns={[
                { key: 'planMode', label: '计划方式' },
                { key: 'sampleSize', label: '抽样数' },
                { key: 'inventoryLotId', label: '批次' },
                { key: 'status', label: '质检状态' },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={qualityPutaway?.inspections ?? []}
              total={qualityPutaway?.inspections.length ?? 0}
            />
            <Typography.Paragraph>
              不可变抽样结果 {qualityPutaway?.results.length ?? 0}{' '}
              条；未放行批次不可进入上架或越库。
            </Typography.Paragraph>
          </Card>
          <Card title="不合格品处置与计费事实">
            <DataGrid
              columns={[
                { key: 'type', label: '处置类型' },
                { key: 'reason', label: '原因' },
                { key: 'id', label: '处置引用' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={qualityPutaway?.dispositions ?? []}
              total={qualityPutaway?.dispositions.length ?? 0}
            />
          </Card>
          <Card title="规则驱动上架、StrategyTrace 与扫描移动">
            <DataGrid
              columns={[
                { key: 'status', label: '决策状态' },
                { key: 'selectedLocationId', label: '推荐库位' },
                { key: 'evaluationTraceId', label: 'StrategyTrace' },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={qualityPutaway?.decisions ?? []}
              total={qualityPutaway?.decisions.length ?? 0}
            />
            <Typography.Paragraph>
              上架任务 {qualityPutaway?.tasks.length ?? 0} 条；不可变移动{' '}
              {qualityPutaway?.movements.length ?? 0} 条。
            </Typography.Paragraph>
          </Card>
          <Card title="越库匹配与时间窗">
            <DataGrid
              columns={[
                { key: 'demandRef', label: '需求单号' },
                { key: 'status', label: '状态' },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={qualityPutaway?.crossDocks ?? []}
              total={qualityPutaway?.crossDocks.length ?? 0}
            />
          </Card>
          <Card title="收货差异、照片证据与处置">
            <DataGrid
              columns={[
                { key: 'type', label: '类型' },
                { key: 'reason', label: '原因' },
                { key: 'status', label: '处置' },
                { key: 'version', label: '版本' },
              ]}
              onPageChange={() => undefined}
              page={1}
              pageSize={200}
              rows={receivingDetail?.variances ?? []}
              total={receivingDetail?.variances.length ?? 0}
            />
          </Card>
        </Space>
      </Drawer>
    </section>
  );
}
