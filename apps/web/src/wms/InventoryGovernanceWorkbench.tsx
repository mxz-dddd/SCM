import { useCallback, useEffect, useMemo, useState } from 'react';
import { CommandBar, DataGrid, createActionRegistry } from '@scm/ui';
import { Alert, Card, Drawer, Space, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface GovernanceView {
  adjustments: Array<Record<string, unknown> & { id: string; status: string }>;
  aging: Array<Record<string, unknown> & { id: string }>;
  alerts: Array<Record<string, unknown> & { id: string; status: string }>;
  cases: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  reconciliations: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  replenishments: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  snapshotAt: string;
}

const governanceActions = createActionRegistry<'READY'>([
  {
    id: 'refresh-governance',
    label: '刷新库存治理',
    requiredPermissions: ['wms.inventory.governance.read'],
  },
  {
    id: 'create-adjustment',
    label: '创建调整单',
    requiredPermissions: ['wms.inventory.adjust.write'],
  },
  {
    id: 'transition-adjustment',
    label: '审批过账调整',
    requiredPermissions: ['wms.inventory.adjust.approve'],
  },
  {
    id: 'save-replenishment-policy',
    label: '配置补货策略',
    requiredPermissions: ['wms.inventory.replenishment.plan'],
  },
  {
    id: 'plan-replenishment',
    label: '生成补货任务',
    requiredPermissions: ['wms.inventory.replenishment.plan'],
  },
  {
    id: 'execute-replenishment',
    label: '执行补货',
    requiredPermissions: ['wms.inventory.replenishment.execute'],
  },
  {
    id: 'run-aging',
    label: '运行库龄效期',
    requiredPermissions: ['wms.inventory.aging.run'],
  },
  {
    id: 'trace-genealogy',
    label: '批次序列追溯',
    requiredPermissions: ['wms.inventory.trace'],
  },
  {
    id: 'reconcile-inventory',
    label: '执行 ERP 对账',
    requiredPermissions: ['wms.inventory.reconcile'],
  },
  {
    id: 'resolve-reconciliation',
    label: '处置对账工单',
    requiredPermissions: ['wms.inventory.reconcile.resolve'],
  },
]);

export function InventoryGovernanceWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<GovernanceView>();
  const [graph, setGraph] = useState<Record<string, unknown>>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? governanceActions
              .list()
              .flatMap(({ requiredPermissions }) => requiredPermissions)
          : [],
      ),
    [claims],
  );
  const decisions = governanceActions.list().map(({ id }) =>
    governanceActions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: 'READY',
    }),
  );
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用库存治理');
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
          '/api/v1/wms/inventory-governance',
        )) as unknown as GovernanceView,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '库存治理查询失败');
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  async function execute(id: string) {
    if (!decisions.find((decision) => decision.id === id)?.enabled) return;
    try {
      if (id === 'refresh-governance') await refresh();
      else if (id === 'create-adjustment') {
        const balanceId = window.prompt('库存余额 UUID');
        const type = window.prompt('类型 GAIN / LOSS / DAMAGE / DATA_FIX');
        const quantity = window.prompt('调整数量', '1');
        const reasonCode = window.prompt('原因码');
        const reason = window.prompt('原因说明');
        const attachment = window.prompt('附件引用');
        if (
          !balanceId ||
          !type ||
          !quantity ||
          !reasonCode ||
          !reason ||
          !attachment
        )
          return;
        await request('/api/v1/wms/inventory-adjustments', {
          body: JSON.stringify({
            attachmentRefs: [attachment],
            balanceId,
            financialImpact: {
              amount: window.prompt('财务影响金额', '0'),
              currency: 'CNY',
            },
            quantityBase: quantity,
            quantityOriginal: quantity,
            reason,
            reasonCode,
            type,
          }),
          method: 'POST',
        });
        setNotice('调整单已创建，审批前不会改动库存');
      } else if (id === 'transition-adjustment') {
        const adjustmentId = window.prompt(
          '调整单 UUID',
          view?.adjustments[0]?.id ?? '',
        );
        const targetStatus = window.prompt(
          '目标状态 PENDING_APPROVAL / APPROVED / POSTED / REJECTED',
        );
        const version = window.prompt('调整单版本');
        if (!adjustmentId || !targetStatus || !version) return;
        await request(
          `/api/v1/wms/inventory-adjustments/${adjustmentId}/transition`,
          {
            body: JSON.stringify({
              approvalReference:
                targetStatus === 'APPROVED'
                  ? window.prompt('审批引用')
                  : undefined,
              direction:
                targetStatus === 'POSTED'
                  ? window.prompt(
                      'DATA_FIX 方向 INCREASE / DECREASE（其他可空）',
                    ) || undefined
                  : undefined,
              expectedBalanceVersion:
                targetStatus === 'POSTED'
                  ? Number(window.prompt('库存余额版本'))
                  : undefined,
              expectedVersion: Number(version),
              targetStatus,
            }),
            method: 'POST',
          },
        );
        setNotice(`调整单已推进至 ${targetStatus}`);
      } else if (id === 'save-replenishment-policy') {
        const warehouseId = window.prompt('仓库 UUID');
        const productId = window.prompt('商品 UUID');
        const pickLocationId = window.prompt('拣选位 UUID');
        if (!warehouseId || !productId || !pickLocationId) return;
        await request('/api/v1/wms/replenishment-policies', {
          body: JSON.stringify({
            issueMethod: window.prompt('出库顺序 FIFO / FEFO', 'FEFO'),
            maximumBase: window.prompt('最大库存', '10'),
            minimumBase: window.prompt('最小库存', '3'),
            ownerId: window.prompt('货主 UUID（可选）') || undefined,
            pickLocationId,
            productId,
            warehouseId,
          }),
          method: 'POST',
        });
        setNotice('补货策略已保存');
      } else if (id === 'plan-replenishment') {
        const policyId = window.prompt('补货策略 UUID');
        const version = window.prompt('策略版本', '1');
        if (!policyId || !version) return;
        await request(`/api/v1/wms/replenishment-policies/${policyId}/plan`, {
          body: JSON.stringify({
            expectedVersion: Number(version),
            waveDemandBase: window.prompt('波次需求数量', '0'),
          }),
          method: 'POST',
        });
        setNotice('补货任务已按 FEFO/FIFO 生成');
      } else if (id === 'execute-replenishment') {
        const task = view?.replenishments.find(
          ({ status }) => status === 'PLANNED',
        );
        const taskId = window.prompt('补货任务 UUID', task?.id ?? '');
        const version = window.prompt('任务版本', String(task?.version ?? 1));
        if (!taskId || !version) return;
        await request(`/api/v1/wms/replenishment-tasks/${taskId}/execute`, {
          body: JSON.stringify({ expectedVersion: Number(version) }),
          method: 'POST',
        });
        setNotice('补货移库已执行');
      } else if (id === 'run-aging') {
        const warehouseId = window.prompt('仓库 UUID');
        if (!warehouseId) return;
        await request('/api/v1/wms/inventory-aging-runs', {
          body: JSON.stringify({
            agedDays: Number(window.prompt('长库龄天数', '180')),
            nearExpiryDays: Number(window.prompt('临期天数', '30')),
            warehouseId,
          }),
          method: 'POST',
        });
        setNotice('库龄桶与效期预警已更新');
      } else if (id === 'trace-genealogy') {
        const inventoryLotId = window.prompt('批次 UUID（与序列号二选一）');
        const serialNumber = inventoryLotId ? null : window.prompt('序列号');
        if (!inventoryLotId && !serialNumber) return;
        const query = new URLSearchParams();
        if (inventoryLotId) query.set('inventoryLotId', inventoryLotId);
        if (serialNumber) query.set('serialNumber', serialNumber);
        setGraph(
          (await request(
            `/api/v1/wms/inventory-genealogy?${query.toString()}`,
          )) as unknown as Record<string, unknown>,
        );
      } else if (id === 'reconcile-inventory') {
        const warehouseId = window.prompt('仓库 UUID');
        const erpClosingBase = window.prompt('ERP 期末数量');
        if (!warehouseId || !erpClosingBase) return;
        const end = new Date();
        const start = new Date(end.getTime() - 86_400_000);
        await request('/api/v1/wms/inventory-reconciliations', {
          body: JSON.stringify({
            erpClosingBase,
            ownerId: window.prompt('货主 UUID（可选）') || undefined,
            periodEnd: end.toISOString(),
            periodStart: start.toISOString(),
            warehouseId,
          }),
          method: 'POST',
        });
        setNotice('对账已完成，差异已自动进入工单');
      } else if (id === 'resolve-reconciliation') {
        const item = view?.cases.find(({ status }) => status === 'OPEN');
        const caseId = window.prompt('差异工单 UUID', item?.id ?? '');
        const resolution = window.prompt('处置结论');
        if (!caseId || !resolution) return;
        await request(
          `/api/v1/wms/inventory-reconciliation-cases/${caseId}/resolve`,
          {
            body: JSON.stringify({
              expectedVersion: item?.version ?? 1,
              resolution,
            }),
            method: 'POST',
          },
        );
        setNotice('对账差异工单已处置');
      }
      setError(undefined);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '库存治理操作失败');
    }
  }

  return (
    <section>
      <Typography.Title level={3}>库存治理、追溯与 ERP 对账</Typography.Title>
      <Typography.Paragraph>
        调整必须审批后过账；补货按 FEFO/FIFO
        排除冻结与盘点范围；对账差异只建工单，不直接改平库存。
      </Typography.Paragraph>
      {error ? <Alert message={error} showIcon type="error" /> : null}
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      <CommandBar actions={decisions} onAction={({ id }) => void execute(id)} />
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card title="调整单与自动补货">
          <Typography.Text>
            调整单 {view?.adjustments.length ?? 0}；补货任务{' '}
            {view?.replenishments.length ?? 0}。
          </Typography.Text>
        </Card>
        <Card title="库龄、效期与对账工单">
          <Typography.Text>
            库龄快照 {view?.aging.length ?? 0}；效期预警{' '}
            {view?.alerts.length ?? 0}；对账差异工单 {view?.cases.length ?? 0}。
          </Typography.Text>
        </Card>
      </Space>
      <Drawer
        onClose={() => setGraph(undefined)}
        open={Boolean(graph)}
        title="GenealogyGraph 与 RecallList"
        width="72vw"
      >
        <DataGrid
          columns={[
            { key: 'type', label: '节点类型' },
            { key: 'id', label: '节点 UUID' },
            { key: 'snapshot', label: '事实快照' },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={200}
          rows={
            (graph?.nodes ?? []) as Array<
              Record<string, unknown> & { id: string }
            >
          }
          total={Array.isArray(graph?.nodes) ? graph.nodes.length : 0}
        />
      </Drawer>
    </section>
  );
}
