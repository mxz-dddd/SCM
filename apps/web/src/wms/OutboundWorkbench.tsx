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
      setView(
        (await request('/api/v1/wms/outbounds')) as unknown as OutboundView,
      );
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
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '出库操作失败');
    }
  }

  return (
    <section>
      <Typography.Title level={2}>出库单、波次与库存分配</Typography.Title>
      <Typography.Paragraph>
        波次模板支持候选与工作量模拟；发布时按整箱、FEFO/FIFO
        和最少拆分原子预占，缺口进入可回写 OMS 的处置工单。
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
      </Space>
    </section>
  );
}
