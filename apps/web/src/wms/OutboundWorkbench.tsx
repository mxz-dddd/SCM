import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Space, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface OutboundView {
  allocations: Array<Record<string, unknown> & { id: string }>;
  orders: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  shortages: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  snapshotAt: string;
  templates: Array<Record<string, unknown> & { id: string; version: number }>;
  waves: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
}

interface PickingView {
  lines: Array<
    Record<string, unknown> & {
      id: string;
      pickedBase: string;
      productId: string;
      taskId: string;
      version: number;
    }
  >;
  scans: Array<Record<string, unknown> & { id: string }>;
  shortPicks: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  tasks: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  verifications: Array<
    Record<string, unknown> & { id: string; status: string }
  >;
}

interface PackShipView {
  dispatches: Array<Record<string, unknown> & { id: string }>;
  exceptions: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  labels: Array<Record<string, unknown> & { id: string; status: string }>;
  loads: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  packages: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  packTasks: Array<Record<string, unknown> & { id: string; status: string }>;
  staging: Array<Record<string, unknown> & { id: string; status: string }>;
}

const actions = createActionRegistry<'READY'>([
  {
    id: 'receive-outbound',
    label: '接收出库单',
    requiredPermissions: ['wms.outbound.write'],
  },
  {
    id: 'release-outbound',
    label: '释放出库单',
    requiredPermissions: ['wms.outbound.release'],
  },
  {
    id: 'save-wave-template',
    label: '配置波次模板',
    requiredPermissions: ['wms.wave.template.write'],
  },
  {
    id: 'simulate-wave',
    label: '模拟波次工作量',
    requiredPermissions: ['wms.wave.plan'],
  },
  {
    id: 'create-wave',
    label: '创建波次',
    requiredPermissions: ['wms.wave.plan'],
  },
  {
    id: 'transition-wave',
    label: '发布波次',
    requiredPermissions: ['wms.wave.release'],
  },
  {
    id: 'resolve-shortage',
    label: '处置缺货',
    requiredPermissions: ['wms.outbound.shortage.resolve'],
  },
  {
    id: 'assign-pick',
    label: '领取拣选任务',
    requiredPermissions: ['wms.picking.execute'],
  },
  {
    id: 'start-pick',
    label: '开始拣选',
    requiredPermissions: ['wms.picking.execute'],
  },
  {
    id: 'replan-pick',
    label: '重算拣选路线',
    requiredPermissions: ['wms.picking.supervise'],
  },
  {
    id: 'rf-scan',
    label: 'RF 扫描确认',
    requiredPermissions: ['wms.picking.execute'],
  },
  {
    id: 'short-pick',
    label: '登记短拣',
    requiredPermissions: ['wms.picking.execute'],
  },
  {
    id: 'resolve-short-pick',
    label: '处置短拣',
    requiredPermissions: ['wms.picking.supervise'],
  },
  {
    id: 'verify-pick',
    label: '复核拣选',
    requiredPermissions: ['wms.picking.verify'],
  },
  {
    id: 'correct-pick',
    label: '纠正差异',
    requiredPermissions: ['wms.picking.verify'],
  },
  {
    id: 'create-pack',
    label: '推荐箱型并包装',
    requiredPermissions: ['wms.pack.execute'],
  },
  {
    id: 'measure-seal',
    label: '称重量方与封箱',
    requiredPermissions: ['wms.pack.execute'],
  },
  {
    id: 'resolve-pack-exception',
    label: '处置包装超差',
    requiredPermissions: ['wms.pack.supervise'],
  },
  {
    id: 'issue-label',
    label: '签发出库标签',
    requiredPermissions: ['wms.pack.label'],
  },
  {
    id: 'stage-package',
    label: '集货暂存',
    requiredPermissions: ['wms.ship.stage'],
  },
  {
    id: 'create-load',
    label: '创建装车任务',
    requiredPermissions: ['wms.ship.load'],
  },
  {
    id: 'confirm-load',
    label: '扫描装车',
    requiredPermissions: ['wms.ship.load'],
  },
  {
    id: 'ship-outbound',
    label: '确认发运',
    requiredPermissions: ['wms.ship.confirm'],
  },
  {
    id: 'cancel-outbound',
    label: '取消出库',
    requiredPermissions: ['wms.ship.cancel'],
  },
]);

export function OutboundWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<OutboundView>({
    allocations: [],
    orders: [],
    shortages: [],
    snapshotAt: new Date(0).toISOString(),
    templates: [],
    waves: [],
  });
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [picking, setPicking] = useState<PickingView>({
    lines: [],
    scans: [],
    shortPicks: [],
    tasks: [],
    verifications: [],
  });
  const [packShip, setPackShip] = useState<PackShipView>({
    dispatches: [],
    exceptions: [],
    labels: [],
    loads: [],
    packages: [],
    packTasks: [],
    staging: [],
  });
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
  const decisions = actions
    .list()
    .map(({ id }) =>
      actions.decide(id, {
        dataScopeAllowed: true,
        permissions,
        status: 'READY',
      }),
    );
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用出库工作台');
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
      const [outboundView, pickingView, packShipView] = await Promise.all([
        request('/api/v1/wms/outbounds'),
        request('/api/v1/wms/picking'),
        request('/api/v1/wms/pack-ship'),
      ]);
      setView(outboundView as unknown as OutboundView);
      setPicking(pickingView as unknown as PickingView);
      setPackShip(packShipView as unknown as PackShipView);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '出库查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  async function execute(id: string) {
    if (!decisions.find((decision) => decision.id === id)?.enabled) return;
    try {
      if (id === 'receive-outbound') {
        const warehouseId = window.prompt('仓库 UUID');
        const ownerId = window.prompt('货主 UUID');
        const productId = window.prompt('商品 UUID');
        const quantity = window.prompt('出库数量', '1');
        if (!warehouseId || !ownerId || !productId || !quantity) return;
        await request('/api/v1/wms/outbounds', {
          body: JSON.stringify({
            carrierMode: window.prompt('承运方式', 'ROAD'),
            cutoffAt: new Date(Date.now() + 86_400_000).toISOString(),
            destinationSnapshot: { address: window.prompt('目的地址') },
            lines: [
              {
                baseUom: 'EA',
                lineNo: 1,
                originalUom: 'EA',
                productId,
                quantityBase: quantity,
                quantityOriginal: quantity,
              },
            ],
            ownerId,
            routeCode: window.prompt('路线代码'),
            serviceLevel: window.prompt('服务等级', 'STANDARD'),
            sourceRef: window.prompt('OMS 履约引用') ?? `WEB-OUT-${Date.now()}`,
            temperatureZone: window.prompt('温层', 'AMBIENT'),
            type: window.prompt(
              '类型 SALES / TRANSFER / RETURN_VENDOR',
              'SALES',
            ),
            warehouseId,
          }),
          method: 'POST',
        });
        setNotice('出库单草稿已接收');
      } else if (id === 'release-outbound') {
        const order = view.orders.find(({ status }) => status === 'DRAFT');
        const outboundId = window.prompt('出库单 UUID', order?.id ?? '');
        if (!outboundId) return;
        await request(`/api/v1/wms/outbounds/${outboundId}/release`, {
          body: JSON.stringify({
            expectedVersion:
              order?.version ?? Number(window.prompt('版本', '1')),
          }),
          method: 'POST',
        });
        setNotice('出库单已释放');
      } else if (id === 'save-wave-template') {
        const warehouseId = window.prompt('仓库 UUID');
        if (!warehouseId) return;
        await request('/api/v1/wms/wave-templates', {
          body: JSON.stringify({
            capacitySnapshot: {
              maxLines: 100,
              maxOrders: 50,
              maxQuantityBase: '10000',
            },
            criteria: {
              carrierMode: window.prompt('承运方式（可选）'),
              routeCode: window.prompt('路线（可选）'),
              temperatureZone: window.prompt('温层（可选）'),
            },
            name: window.prompt('模板名称', '默认波次模板'),
            strategy: {
              issueMethod: window.prompt('FIFO / FEFO', 'FEFO'),
              minimumSplits: true,
              wholeHandlingUnitFirst: true,
            },
            warehouseId,
            workloadFactors: { perBase: '0.1', perLine: '1', perOrder: '2' },
          }),
          method: 'POST',
        });
        setNotice('波次模板已配置');
      } else if (id === 'simulate-wave') {
        const templateId = window.prompt(
          '波次模板 UUID',
          view.templates[0]?.id ?? '',
        );
        if (!templateId) return;
        const result = (await request(
          `/api/v1/wms/wave-templates/${templateId}/simulate`,
        )) as unknown as {
          lineCount: number;
          orderCount: number;
          workload: string;
        };
        setNotice(
          `模拟结果：${result.orderCount} 单 / ${result.lineCount} 行 / 工作量 ${result.workload}`,
        );
      } else if (id === 'create-wave') {
        const templateId = window.prompt(
          '波次模板 UUID',
          view.templates[0]?.id ?? '',
        );
        if (!templateId) return;
        await request('/api/v1/wms/waves', {
          body: JSON.stringify({
            cutoffAt: new Date(Date.now() + 3_600_000).toISOString(),
            templateId,
          }),
          method: 'POST',
        });
        setNotice('波次草稿已创建');
      } else if (id === 'transition-wave') {
        const wave = view.waves.find(({ status }) => status !== 'COMPLETED');
        const waveId = window.prompt('波次 UUID', wave?.id ?? '');
        const targetStatus = window.prompt(
          '目标状态 PLANNED / RELEASED / COMPLETED',
        );
        if (!waveId || !targetStatus) return;
        await request(`/api/v1/wms/waves/${waveId}/transition`, {
          body: JSON.stringify({
            expectedVersion:
              wave?.version ?? Number(window.prompt('版本', '1')),
            targetStatus,
          }),
          method: 'POST',
        });
        setNotice(`波次已推进至 ${targetStatus}`);
      } else if (id === 'resolve-shortage') {
        const shortage = view.shortages.find(({ status }) => status === 'OPEN');
        const caseId = window.prompt('缺货工单 UUID', shortage?.id ?? '');
        const type = window.prompt(
          'WAIT_INBOUND / TRIGGER_REPLENISHMENT / SUBSTITUTE_LOT / CHANGE_WAREHOUSE / SPLIT_ORDER / SHORT_SHIP',
        );
        const reason = window.prompt('处置说明');
        if (!caseId || !type || !reason) return;
        await request(`/api/v1/wms/outbound-shortages/${caseId}/resolve`, {
          body: JSON.stringify({
            expectedVersion: shortage?.version ?? 1,
            resolutionSnapshot: { reason },
            type,
          }),
          method: 'POST',
        });
        setNotice('缺货结果已回写 OMS 事件');
      } else if (id === 'assign-pick') {
        const task = picking.tasks.find(({ status }) => status === 'OPEN');
        const taskId = window.prompt('拣选任务 UUID', task?.id ?? '');
        const assigneeId = window.prompt(
          '拣选员 UUID',
          claims?.subject ?? '',
        );
        const containerCode = window.prompt('目标容器码');
        if (!taskId || !assigneeId || !containerCode) return;
        await request(`/api/v1/wms/pick-tasks/${taskId}/assign`, {
          body: JSON.stringify({
            assigneeId,
            containerCode,
            expectedVersion: task?.version ?? 1,
          }),
          method: 'POST',
        });
        setNotice('拣选任务已领取并绑定容器');
      } else if (id === 'start-pick') {
        const task = picking.tasks.find(({ status }) => status === 'ASSIGNED');
        const taskId = window.prompt('拣选任务 UUID', task?.id ?? '');
        if (!taskId) return;
        await request(`/api/v1/wms/pick-tasks/${taskId}/start`, {
          body: JSON.stringify({ expectedVersion: task?.version ?? 1 }),
          method: 'POST',
        });
        setNotice('拣选任务已开始');
      } else if (id === 'replan-pick') {
        const task = picking.tasks.find(({ status }) =>
          ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(status),
        );
        const taskId = window.prompt('拣选任务 UUID', task?.id ?? '');
        if (!taskId) return;
        await request(`/api/v1/wms/pick-tasks/${taskId}/replan`, {
          body: JSON.stringify({
            aisleDirection: window.prompt('FORWARD / REVERSE', 'FORWARD'),
            congestionSnapshot: {},
            expectedVersion: task?.version ?? 1,
          }),
          method: 'POST',
        });
        setNotice('新版最短拣选路线已生成，历史路线保留');
      } else if (id === 'rf-scan') {
        const task = picking.tasks.find(
          ({ status }) => status === 'IN_PROGRESS',
        );
        const line = picking.lines.find(({ taskId }) => taskId === task?.id);
        if (!task || !line) return;
        const sourceLocationId = window.prompt(
          '扫描源储位 UUID',
          String(line.sourceLocationId ?? ''),
        );
        const productId = window.prompt('扫描商品 UUID', line.productId);
        const targetContainerCode = window.prompt(
          '扫描目标容器码',
          String(task.containerCode ?? ''),
        );
        const quantityBase = window.prompt('确认数量', '1');
        if (!sourceLocationId || !productId || !targetContainerCode || !quantityBase)
          return;
        await request(`/api/v1/wms/pick-tasks/${task.id}/scans`, {
          body: JSON.stringify({
            deviceId: 'WEB-RF',
            deviceSequence: String(Date.now()),
            ...(line.handlingUnitId
              ? { handlingUnitId: line.handlingUnitId }
              : {}),
            productId,
            quantityBase,
            scannedAt: new Date().toISOString(),
            sourceLocationId,
            targetContainerCode,
            taskLineId: line.id,
          }),
          method: 'POST',
        });
        setNotice('RF 扫描已确认；错误扫描会即时阻止并留痕');
      } else if (id === 'short-pick') {
        const task = picking.tasks.find(
          ({ status }) => status === 'IN_PROGRESS',
        );
        const line = picking.lines.find(({ taskId }) => taskId === task?.id);
        const shortBase = window.prompt('短拣数量', '1');
        const reasonCode = window.prompt('短拣原因码', 'LOCATION_SHORT');
        const reason = window.prompt('短拣说明');
        if (!line || !shortBase || !reasonCode || !reason) return;
        await request(`/api/v1/wms/pick-task-lines/${line.id}/short-pick`, {
          body: JSON.stringify({
            expectedLineVersion: line.version,
            reason,
            reasonCode,
            shortBase,
          }),
          method: 'POST',
        });
        setNotice('短拣已显式登记，任务等待复核处置');
      } else if (id === 'resolve-short-pick') {
        const shortPick = picking.shortPicks.find(
          ({ status }) => status === 'OPEN',
        );
        const type = window.prompt(
          'REVIEW / FREEZE / CYCLE_COUNT / REALLOCATE / SHORT_SHIP',
          'REVIEW',
        );
        const reason = window.prompt('处置说明');
        if (!shortPick || !type || !reason) return;
        await request(`/api/v1/wms/short-picks/${shortPick.id}/resolve`, {
          body: JSON.stringify({
            expectedVersion: shortPick.version,
            resolutionSnapshot: { reason },
            type,
          }),
          method: 'POST',
        });
        setNotice('短拣已处置并进入复核门禁');
      } else if (id === 'verify-pick') {
        const task = picking.tasks.find(({ status }) => status === 'REVIEWING');
        if (!task) return;
        const lines = picking.lines
          .filter(({ taskId }) => taskId === task.id)
          .map((line) => ({
            productId: line.productId,
            quantityBase: String(line.pickedBase),
            taskLineId: line.id,
          }));
        await request(`/api/v1/wms/pick-tasks/${task.id}/verify`, {
          body: JSON.stringify({
            actualSnapshot: {
              containerCode: window.prompt(
                '复核容器码',
                String(task.containerCode ?? ''),
              ),
              lines,
            },
            expectedVersion: task.version,
            scopeRef: String(task.containerCode ?? task.id),
            scopeType: 'CONTAINER',
          }),
          method: 'POST',
        });
        setNotice('拣选复核结果已固化');
      } else if (id === 'correct-pick') {
        const verification = picking.verifications.find(
          ({ status }) => status === 'FAILED',
        );
        const correctionType = window.prompt(
          'RETURN / SUPPLEMENT / REALLOCATE',
          'RETURN',
        );
        const reason = window.prompt('纠正说明');
        if (!verification || !correctionType || !reason) return;
        await request(
          `/api/v1/wms/pick-verifications/${verification.id}/correct`,
          {
            body: JSON.stringify({
              actualSnapshot: { reason },
              correctionType,
            }),
            method: 'POST',
          },
        );
        setNotice('差异纠正已追加，原始复核事实保持不变');
      } else if (id === 'create-pack') {
        const order = view.orders.find(({ status }) => status === 'PICKING');
        const outboundId = window.prompt('出库单 UUID', order?.id ?? '');
        if (!outboundId) return;
        await request(`/api/v1/wms/outbounds/${outboundId}/pack-tasks`, {
          body: JSON.stringify({
            boxes: [
              {
                code: window.prompt('箱型代码', 'BOX-M'),
                maxVolume: window.prompt('箱型最大体积', '1000000'),
                maxWeight: window.prompt('箱型最大重量', '30'),
              },
            ],
            materialSnapshot: { buffer: window.prompt('缓冲材料', 'PAPER') },
            ruleSnapshot: {
              defaultUnitVolume: '1',
              defaultUnitWeight: '1',
              volumeTolerancePct: '10',
              weightTolerancePct: '10',
            },
            serviceSnapshot: { service: window.prompt('包装服务', 'STANDARD') },
          }),
          method: 'POST',
        });
        setNotice('箱型推荐与多箱包装任务已生成');
      } else if (id === 'measure-seal') {
        const unit = packShip.packages.find(({ status }) => status === 'OPEN');
        if (!unit) return;
        const measurement = (await request(
          `/api/v1/wms/packages/${unit.id}/measurements`,
          {
            body: JSON.stringify({
              deviceId: 'WEB-SCALE',
              deviceSequence: String(Date.now()),
              height: window.prompt('实测高', '1'),
              length: window.prompt('实测长', '1'),
              measuredAt: new Date().toISOString(),
              rawSnapshot: { source: 'WEB' },
              source: 'ELECTRONIC_SCALE',
              weight: window.prompt('实测重量', '1'),
              width: window.prompt('实测宽', '1'),
            }),
            method: 'POST',
          },
        )) as unknown as { status: string };
        if (measurement.status === 'ACCEPTED') {
          const latest = (await request(
            '/api/v1/wms/pack-ship',
          )) as unknown as PackShipView;
          const measured = latest.packages.find(({ id }) => id === unit.id);
          if (measured)
            await request(`/api/v1/wms/packages/${unit.id}/seal`, {
              body: JSON.stringify({ expectedVersion: measured.version }),
              method: 'POST',
            });
          setNotice('称重量方通过并已封箱');
        } else setNotice('称重量方超差，已阻止封箱并生成复核工单');
      } else if (id === 'resolve-pack-exception') {
        const exception = packShip.exceptions.find(
          ({ status }) => status === 'OPEN',
        );
        const reason = window.prompt('超差复核说明');
        if (!exception || !reason) return;
        await request(`/api/v1/wms/weight-exceptions/${exception.id}/resolve`, {
          body: JSON.stringify({
            expectedVersion: exception.version,
            resolutionSnapshot: { reason },
          }),
          method: 'POST',
        });
        setNotice('包装超差已复核处置');
      } else if (id === 'issue-label') {
        const unit = packShip.packages.find(({ status }) => status === 'SEALED');
        if (!unit) return;
        await request(`/api/v1/wms/packages/${unit.id}/labels`, {
          body: JSON.stringify({
            contentRef: window.prompt('标签文件引用', `label://${unit.id}`),
            labelType: 'SHIPPING',
            templateVersion: window.prompt('标签模板版本', 'carrier-v1'),
          }),
          method: 'POST',
        });
        setNotice('出库标签已按包裹和模板版本绑定');
      } else if (id === 'stage-package') {
        const unit = packShip.packages.find(({ status }) => status === 'LABELLED');
        const stagingLocationId = window.prompt('暂存位 UUID');
        if (!unit || !stagingLocationId) return;
        await request(`/api/v1/wms/packages/${unit.id}/stage`, {
          body: JSON.stringify({
            loadSequence: 1,
            maxVolume: window.prompt('暂存位最大体积', '1000000'),
            routeCode: window.prompt('路线代码', String(unit.routeCode ?? '')),
            shipmentRef: window.prompt('TMS 运单引用'),
            stagingLocationId,
            tripRef: window.prompt('车次引用'),
          }),
          method: 'POST',
        });
        setNotice('包裹已通过线路与容量校验进入暂存');
      } else if (id === 'create-load') {
        const order = view.orders.find(({ status }) => status === 'STAGED');
        if (!order) return;
        await request(`/api/v1/wms/outbounds/${order.id}/load-tasks`, {
          body: JSON.stringify({
            dockRef: window.prompt('月台引用'),
            maxVolume: window.prompt('车辆最大体积', '1000000'),
            maxWeight: window.prompt('车辆最大重量', '10000'),
            sealNo: window.prompt('封签号'),
            shipmentRef: window.prompt('TMS 运单引用'),
            vehicleRef: window.prompt('车辆引用'),
          }),
          method: 'POST',
        });
        setNotice('装车任务已生成，应装清单已固化');
      } else if (id === 'confirm-load') {
        const load = packShip.loads.find(({ status }) =>
          ['OPEN', 'LOADING'].includes(status),
        );
        const unit = packShip.packages.find(({ status }) => status === 'STAGED');
        if (!load || !unit) return;
        await request(`/api/v1/wms/load-tasks/${load.id}/confirm`, {
          body: JSON.stringify({
            deviceId: 'WEB-LOAD-RF',
            deviceSequence: String(Date.now()),
            dockRef: String(load.dockRef ?? ''),
            packageId: unit.id,
            sealNo: String(load.sealNo ?? ''),
            vehicleRef: String(load.vehicleRef ?? ''),
          }),
          method: 'POST',
        });
        setNotice('包裹装车扫描已确认');
      } else if (id === 'ship-outbound') {
        const load = packShip.loads.find(({ status }) => status === 'LOADED');
        if (!load) return;
        await request(`/api/v1/wms/load-tasks/${load.id}/ship`, {
          body: JSON.stringify({
            actualAt: new Date().toISOString(),
            expectedVersion: load.version,
          }),
          method: 'POST',
        });
        setNotice('发运已确认，库存已幂等扣减并发布 shipped 事件');
      } else if (id === 'cancel-outbound') {
        const order = view.orders.find(
          ({ status }) => !['CANCELLED', 'SHIPPED'].includes(status),
        );
        const reason = window.prompt('取消说明');
        if (!order || !reason) return;
        await request(`/api/v1/wms/outbounds/${order.id}/cancel`, {
          body: JSON.stringify({ reason, reasonCode: 'CUSTOMER_CANCEL' }),
          method: 'POST',
        });
        setNotice('出库取消补偿计划已执行');
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '出库操作失败');
    }
  }

  return (
    <section>
      <Typography.Title level={2}>出库、拣选、包装与发运</Typography.Title>
      <Typography.Paragraph>
        波次模板支持候选与工作量模拟；发布时按整箱、FEFO/FIFO
        和最少拆分原子预占，缺口进入可回写 OMS 的处置工单。
        波次发布生成温层隔离的拣选任务，RF 错扫即时阻止，短拣必须处置后才能复核。
        包装超差阻止封箱，集货与装车防混线路，发运事务原子扣减库存并发布交接事件。
      </Typography.Paragraph>
      {error ? <Alert message={error} showIcon type="error" /> : null}
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      <CommandBar actions={decisions} onAction={({ id }) => void execute(id)} />
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card title="出库单与波次">
          <DataGrid
            columns={[
              { key: 'outboundNo', label: '出库单号' },
              { key: 'sourceRef', label: 'OMS 引用' },
              {
                key: 'status',
                label: '状态',
                render: (value) => <StatusBadge status={String(value)} />,
              },
              { key: 'cutoffAt', label: '截止时间' },
              { key: 'version', label: '版本' },
            ]}
            onPageChange={() => undefined}
            page={1}
            pageSize={100}
            rows={view.orders}
            total={view.orders.length}
          />
        </Card>
        <Card title="库存分配与缺货">
          <Typography.Text>
            分配明细 {view.allocations.length} 条；缺货工单{' '}
            {view.shortages.length} 条；快照 {view.snapshotAt}
          </Typography.Text>
        </Card>
        <Card title="拣选任务、RF 扫描与复核">
          <DataGrid
            columns={[
              { key: 'taskNo', label: '任务号' },
              { key: 'mode', label: '模式' },
              {
                key: 'status',
                label: '状态',
                render: (value) => <StatusBadge status={String(value)} />,
              },
              { key: 'containerCode', label: '目标容器' },
              { key: 'routeVersion', label: '路线版本' },
              { key: 'version', label: '版本' },
            ]}
            onPageChange={() => undefined}
            page={1}
            pageSize={100}
            rows={picking.tasks}
            total={picking.tasks.length}
          />
          <Typography.Text>
            RF 事件 {picking.scans.length} 条；短拣工单 {picking.shortPicks.length}{' '}
            条；复核事实 {picking.verifications.length} 条
          </Typography.Text>
        </Card>
        <Card title="包装、集货、装车与发运">
          <DataGrid
            columns={[
              { key: 'packageNo', label: '包裹号' },
              { key: 'boxTypeCode', label: '箱型' },
              {
                key: 'status',
                label: '状态',
                render: (value) => <StatusBadge status={String(value)} />,
              },
              { key: 'actualWeight', label: '实重' },
              { key: 'actualVolume', label: '实积' },
              { key: 'routeCode', label: '路线' },
            ]}
            onPageChange={() => undefined}
            page={1}
            pageSize={100}
            rows={packShip.packages}
            total={packShip.packages.length}
          />
          <Typography.Text>
            包装任务 {packShip.packTasks.length} 条；超差工单{' '}
            {packShip.exceptions.length} 条；标签 {packShip.labels.length} 版；
            暂存 {packShip.staging.length} 条；装车 {packShip.loads.length} 条；
            发运 {packShip.dispatches.length} 条
          </Typography.Text>
        </Card>
      </Space>
    </section>
  );
}
