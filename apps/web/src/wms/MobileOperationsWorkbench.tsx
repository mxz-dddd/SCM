import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { useSessionStore } from '../platform/session-store';

interface OperationsView {
  chargeFacts: Array<Record<string, unknown> & { id: string }>;
  deviceCommands: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  laborAssignments: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  laborMetrics: Array<Record<string, unknown> & { id: string }>;
  laborStandards: Array<Record<string, unknown> & { id: string }>;
  offlineCommands: Array<
    Record<string, unknown> & { id: string; status: string }
  >;
  syncConflicts: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
  valueAddedOrders: Array<
    Record<string, unknown> & { id: string; status: string; version: number }
  >;
}

interface DashboardView {
  exceptions: { offlineConflicts: number; weightExceptions: number };
  inventory: {
    allocatedBase: string;
    availableBase: string;
    holdBase: string;
    onHandBase: string;
  };
  labor: { performanceScore: string; qualityScore: string };
  snapshotAt: string;
  tasks: Record<string, number>;
}

interface QueuedScan {
  businessRef: string;
  businessVersion: number;
  commandType: string;
  deviceSequence: string;
  idempotencyKey: string;
  payload: { barcode: string; scannedAt: string };
}

const emptyOperations: OperationsView = {
  chargeFacts: [],
  deviceCommands: [],
  laborAssignments: [],
  laborMetrics: [],
  laborStandards: [],
  offlineCommands: [],
  syncConflicts: [],
  valueAddedOrders: [],
};

type OperationsFocus = 'tasks' | 'wes' | 'performance' | 'devices';

const focusCopy: Record<
  OperationsFocus,
  { description: string; title: string }
> = {
  tasks: {
    title: '仓储任务执行',
    description: '聚合拣选、包装、装车、增值作业与离线任务队列。',
  },
  wes: {
    title: 'WES 作业调度',
    description: '以设备命令、离线同步和冲突队列连接现场执行。',
  },
  performance: {
    title: '仓储作业绩效',
    description: '呈现劳务分配、质量评分、任务积压和作业异常。',
  },
  devices: {
    title: '仓储设备协同',
    description: '管理打印、扫码、设备命令与回执状态。',
  },
};

export function MobileOperationsWorkbench({
  focus = 'tasks',
}: {
  focus?: OperationsFocus;
}) {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [operations, setOperations] = useState<OperationsView>(emptyOperations);
  const [dashboard, setDashboard] = useState<DashboardView>();
  const [scanner, setScanner] = useState('');
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [feedback, setFeedback] = useState<{
    message: string;
    type: 'error' | 'success' | 'warning';
  }>();
  const deviceId = useMemo(
    () => `WEB-RF-${claims?.subject ?? 'anonymous'}`,
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录移动作业台');
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
      const [nextOperations, nextDashboard] = await Promise.all([
        request('/api/v1/wms/operations'),
        request('/api/v1/wms/dashboard'),
      ]);
      setOperations(nextOperations as unknown as OperationsView);
      setDashboard(nextDashboard as unknown as DashboardView);
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : '作业台加载失败',
        type: 'error',
      });
    }
  }, [accessToken, claims, request]);
  useEffect(() => void refresh(), [refresh]);

  function signal(type: 'error' | 'success' | 'warning', message: string) {
    setFeedback({ message, type });
    if ('vibrate' in navigator)
      navigator.vibrate(type === 'error' ? [150, 80, 150] : 80);
  }

  function enqueueBarcode() {
    const barcode = scanner.trim();
    if (!barcode) return;
    const businessRef = window.prompt('业务任务 UUID');
    const businessVersion = Number(window.prompt('业务版本', '1'));
    if (
      !businessRef ||
      !Number.isInteger(businessVersion) ||
      businessVersion < 1
    ) {
      signal('error', '缺少有效业务任务与版本');
      return;
    }
    const sequence = String(Date.now());
    setQueue((current) => [
      ...current,
      {
        businessRef,
        businessVersion,
        commandType: 'PICK_SCAN',
        deviceSequence: sequence,
        idempotencyKey: `${deviceId}-${sequence}`,
        payload: { barcode, scannedAt: new Date().toISOString() },
      },
    ]);
    setScanner('');
    signal('success', `已缓存扫描 ${barcode}`);
  }

  async function syncQueue() {
    if (!queue.length) return;
    try {
      const result = (await request(
        `/api/v1/wms/offline-devices/${encodeURIComponent(deviceId)}/sync`,
        {
          body: JSON.stringify({ commands: queue }),
          method: 'POST',
        },
      )) as unknown as { results: Array<{ status: string }> };
      const conflicts = result.results.filter(
        ({ status }) => status === 'CONFLICT',
      ).length;
      setQueue([]);
      signal(
        conflicts ? 'warning' : 'success',
        conflicts
          ? `${conflicts} 条命令进入人工冲突处理`
          : '离线命令已按设备序号同步',
      );
      await refresh();
    } catch (error) {
      signal(
        'error',
        error instanceof Error ? error.message : '同步失败，队列已保留',
      );
    }
  }

  async function createVas() {
    const warehouseId = window.prompt('仓库 UUID');
    const sourceRef = window.prompt('来源 LPN/包裹/订单引用');
    const type = window.prompt(
      'RELABEL / REPACK / KITTING / DISASSEMBLY / ASSEMBLY',
      'REPACK',
    );
    if (!warehouseId || !sourceRef || !type) return;
    try {
      await request('/api/v1/wms/value-added-orders', {
        body: JSON.stringify({
          assigneeRef: claims?.subject,
          inputSnapshot: { sourceRef },
          instructionSnapshot: {
            steps: ['SCAN_SOURCE', 'PROCESS', 'QUALITY_CONFIRM'],
          },
          processVersion: 'web-mobile-v1',
          sourceRef,
          type,
          warehouseId,
          workcellRef: window.prompt('工位', 'MOBILE-WORKCELL'),
        }),
        method: 'POST',
      });
      signal('success', '增值作业已创建');
      await refresh();
    } catch (error) {
      signal('error', error instanceof Error ? error.message : '创建失败');
    }
  }

  async function advanceVas() {
    const order = operations.valueAddedOrders.find(({ status }) =>
      ['OPEN', 'IN_PROGRESS', 'QUALITY_HOLD'].includes(status),
    );
    if (!order) return;
    try {
      if (order.status === 'OPEN')
        await request(`/api/v1/wms/value-added-orders/${order.id}/transition`, {
          body: JSON.stringify({
            expectedVersion: order.version,
            targetStatus: 'IN_PROGRESS',
          }),
          method: 'POST',
        });
      else {
        const quantity = window.prompt('完成数量', '1');
        if (!quantity) return;
        await request(`/api/v1/wms/value-added-orders/${order.id}/transition`, {
          body: JSON.stringify({
            expectedVersion: order.version,
            inputQuantityBase: quantity,
            inputSnapshot: { handlingUnits: [window.prompt('输入 LPN')] },
            outputQuantityBase: quantity,
            outputSnapshot: {
              handlingUnits: [window.prompt('输出 LPN')],
              steps: ['DONE'],
              uom: 'EA',
            },
            processTrace: { deviceId },
            qualitySnapshot: { passed: true },
            targetStatus: 'COMPLETED',
          }),
          method: 'POST',
        });
      }
      signal('success', '增值作业状态已推进');
      await refresh();
    } catch (error) {
      signal('error', error instanceof Error ? error.message : '操作失败');
    }
  }

  async function issuePrint() {
    const businessRef = window.prompt('业务引用');
    if (!businessRef) return;
    try {
      await request('/api/v1/wms/device-commands', {
        body: JSON.stringify({
          adapterType: 'PRINT',
          businessRef,
          commandType: 'PRINT_LABEL',
          deviceRef: window.prompt('打印机', 'PRINTER-01'),
          payload: { copies: 1, template: 'WAREHOUSE_LABEL' },
          timeoutAt: new Date(Date.now() + 60_000).toISOString(),
        }),
        method: 'POST',
      });
      signal('success', '打印指令已发送，等待设备回执');
      await refresh();
    } catch (error) {
      signal('error', error instanceof Error ? error.message : '设备指令失败');
    }
  }

  const largeButtonStyle = {
    height: 72,
    fontSize: 20,
    fontWeight: 700,
    width: '100%',
  } as const;
  return (
    <section>
      <Typography.Title level={2}>{focusCopy[focus].title}</Typography.Title>
      <Typography.Paragraph>
        {focusCopy[focus].description}
      </Typography.Paragraph>
      {feedback ? (
        <Alert message={feedback.message} showIcon type={feedback.type} />
      ) : null}
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="待拣选" value={dashboard?.tasks.pickOpen ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="待包装" value={dashboard?.tasks.packOpen ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="待装车" value={dashboard?.tasks.loadOpen ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="异常"
              value={
                (dashboard?.exceptions.offlineConflicts ?? 0) +
                (dashboard?.exceptions.weightExceptions ?? 0)
              }
            />
          </Card>
        </Col>
      </Row>
      <Card title="RF / PDA 扫描" style={{ marginTop: 16 }}>
        <Input
          autoFocus
          onChange={(event) => setScanner(event.target.value)}
          onPressEnter={enqueueBarcode}
          placeholder="扫描商品、LPN、库位或容器后回车"
          size="large"
          value={scanner}
        />
        <Space
          direction="vertical"
          size="middle"
          style={{ marginTop: 16, width: '100%' }}
        >
          <Button
            disabled={!claims}
            onClick={enqueueBarcode}
            style={largeButtonStyle}
            type="primary"
          >
            确认扫描
          </Button>
          <Button
            danger={queue.length > 0}
            disabled={!claims}
            onClick={() => void syncQueue()}
            style={largeButtonStyle}
          >
            同步离线队列（{queue.length}）
          </Button>
        </Space>
      </Card>
      <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <Button
            disabled={!claims}
            onClick={() => void createVas()}
            style={largeButtonStyle}
          >
            新建增值作业
          </Button>
        </Col>
        <Col xs={24} md={8}>
          <Button
            disabled={!claims}
            onClick={() => void advanceVas()}
            style={largeButtonStyle}
          >
            开始 / 完成作业
          </Button>
        </Col>
        <Col xs={24} md={8}>
          <Button
            disabled={!claims}
            onClick={() => void issuePrint()}
            style={largeButtonStyle}
          >
            发送打印指令
          </Button>
        </Col>
      </Row>
      <Card title="作业状态" style={{ marginTop: 16 }}>
        <Space wrap>
          <Tag color="blue">VAS {operations.valueAddedOrders.length}</Tag>
          <Tag color="cyan">劳务 {operations.laborAssignments.length}</Tag>
          <Tag color="purple">设备 {operations.deviceCommands.length}</Tag>
          <Tag color="gold">
            离线冲突{' '}
            {
              operations.syncConflicts.filter(({ status }) => status === 'OPEN')
                .length
            }
          </Tag>
          <Tag color="green">计费事实 {operations.chargeFacts.length}</Tag>
          <Tag>库存可用 {dashboard?.inventory.availableBase ?? '0'}</Tag>
          <Tag>绩效 {dashboard?.labor.performanceScore ?? '0'}</Tag>
        </Space>
      </Card>
    </section>
  );
}
