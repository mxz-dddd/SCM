import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface FileRow {
  channel: string;
  fileName: string;
  id: string;
  lineCount: number;
  partnerRef: string;
  status: string;
  version: number;
}
interface SubscriptionRow {
  endpointUrl: string;
  id: string;
  name: string;
  status: string;
  version: number;
}
interface DeliveryRow {
  attemptNumber: number;
  availableAt: string;
  id: string;
  messageId: string;
  status: string;
  version: number;
}
interface MappingRow {
  activeVersionNumber: number | null;
  code: string;
  id: string;
  name: string;
  status: string;
}
interface MessageRow {
  businessRef: string | null;
  channel: string;
  errorCode: string | null;
  id: string;
  messageType: string;
  status: string;
  version: number;
}
interface ExchangeView {
  acknowledgements: readonly { id: string }[];
  deliveries: readonly DeliveryRow[];
  files: readonly FileRow[];
  mappings: readonly MappingRow[];
  messages: readonly MessageRow[];
  replays: readonly { id: string }[];
  subscriptions: readonly SubscriptionRow[];
  transforms: readonly { id: string }[];
  versions: readonly { id: string }[];
}
const empty: ExchangeView = {
  acknowledgements: [],
  deliveries: [],
  files: [],
  mappings: [],
  messages: [],
  replays: [],
  subscriptions: [],
  transforms: [],
  versions: [],
};
const actions = createActionRegistry<string>([
  {
    id: 'refresh',
    label: '刷新消息监控',
    requiredPermissions: ['integration.exchange.read'],
  },
  {
    id: 'fileDemo',
    label: '接收并处理样例文件',
    requiredPermissions: ['integration.exchange.manage'],
  },
  {
    id: 'mappingDemo',
    label: '测试并发布样例映射',
    requiredPermissions: ['integration.mapping.manage'],
  },
  {
    id: 'webhookDemo',
    label: '创建 Webhook 订阅',
    requiredPermissions: ['integration.webhook.manage'],
  },
  {
    id: 'publishEvent',
    label: '发布样例事件',
    requiredPermissions: ['integration.webhook.publish'],
  },
  {
    allowedStatuses: ['PENDING', 'PROCESSING'],
    id: 'failDelivery',
    label: '记录投递失败',
    requiredPermissions: ['integration.exchange.process'],
  },
  {
    allowedStatuses: ['FAILED', 'DEAD_LETTER'],
    id: 'replay',
    label: '授权重放消息',
    requiredPermissions: ['integration.message.replay'],
  },
]);

export function MessageExchangeWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<ExchangeView>(empty);
  const [deliveryIds, setDeliveryIds] = useState<readonly string[]>([]);
  const [messageIds, setMessageIds] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState<string>();
  const selectedDelivery = view.deliveries.find(
    ({ id }) => id === deliveryIds[0],
  );
  const selectedMessage = view.messages.find(({ id }) => id === messageIds[0]);
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'integration.exchange.read',
              'integration.exchange.manage',
              'integration.exchange.process',
              'integration.mapping.manage',
              'integration.webhook.manage',
              'integration.webhook.publish',
              'integration.message.replay',
            ]
          : [],
      ),
    [claims],
  );
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status:
        id === 'failDelivery'
          ? (selectedDelivery?.status ?? 'NONE')
          : id === 'replay'
            ? (selectedMessage?.status ?? 'NONE')
            : 'READY',
    }),
  );
  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用消息集成中心');
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
      const body = (await response.json()) as T & {
        code?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '消息集成请求失败'}`,
        );
      return body;
    },
    [accessToken, claims],
  );
  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    setView(
      await request<ExchangeView>('/api/v1/integration/exchange/workbench'),
    );
    setError(undefined);
  }, [accessToken, claims, request]);
  useEffect(() => {
    void refresh().catch((caught: unknown) =>
      setError(
        caught instanceof Error ? caught.message : '消息集成中心查询失败',
      ),
    );
  }, [refresh]);
  async function post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { body: JSON.stringify(body), method: 'POST' });
  }
  async function execute(actionId: string) {
    if (!decisions.find(({ id }) => id === actionId)?.enabled) return;
    setSecret(undefined);
    try {
      if (actionId === 'refresh') await refresh();
      else if (actionId === 'fileDemo') {
        const file = await post<{ fileExchangeId: string; version: number }>(
          '/api/v1/integration/exchange/files',
          {
            businessRef: `ASN-${Date.now()}`,
            channel: 'SFTP',
            directory: '/inbound/asn',
            encryption: 'PGP',
            fileName: `asn-${Date.now()}.json.pgp`,
            format: 'JSON',
            lines: [
              { payload: { externalSku: 'SKU-001', quantity: 2 } },
              { payload: { externalSku: 'SKU-002', quantity: 1 } },
            ],
            objectRef: `private/inbound/${crypto.randomUUID()}`,
            partnerRef: 'DEMO-SUPPLIER',
          },
        );
        const completed = await post<{ version: number }>(
          `/api/v1/integration/exchange/files/${file.fileExchangeId}/complete`,
          {
            expectedVersion: file.version,
            results: [
              {
                lineNumber: 1,
                output: { sku: 'SKU-001', quantity: 2 },
                success: true,
              },
              {
                lineNumber: 2,
                output: { sku: 'SKU-002', quantity: 1 },
                success: true,
              },
            ],
          },
        );
        await post(
          `/api/v1/integration/exchange/files/${file.fileExchangeId}/archive`,
          {
            expectedVersion: completed.version,
          },
        );
      } else if (actionId === 'mappingDemo') {
        const mapping = await post<{
          mappingVersionId: string;
          version: number;
        }>('/api/v1/integration/exchange/mappings', {
          code: `ERP-ORDER-${Date.now()}`,
          expectedOutput: { quantityBase: 12, sku: 'SKU-001' },
          name: 'ERP 订单字段映射',
          rules: [
            { source: 'externalSku', target: 'sku' },
            { factor: 6, source: 'caseQuantity', target: 'quantityBase' },
          ],
          sampleInput: { caseQuantity: 2, externalSku: 'SKU-001' },
          sourceSystem: 'ERP',
          targetObject: 'Order',
        });
        const tested = await post<{ version: number }>(
          `/api/v1/integration/exchange/mappings/versions/${mapping.mappingVersionId}/test`,
          { expectedVersion: mapping.version },
        );
        await post(
          `/api/v1/integration/exchange/mappings/versions/${mapping.mappingVersionId}/publish`,
          { expectedVersion: tested.version },
        );
      } else if (actionId === 'webhookDemo') {
        const created = await post<{ secret: string }>(
          '/api/v1/integration/exchange/webhooks',
          {
            baseDelaySeconds: 30,
            endpointUrl: 'https://partner.example.test/webhooks/scm',
            eventTypes: ['order.released.v1'],
            maxAttempts: 5,
            name: `伙伴 Webhook ${new Date().toLocaleString()}`,
          },
        );
        setSecret(created.secret);
      } else if (actionId === 'publishEvent')
        await post('/api/v1/integration/exchange/webhooks/events', {
          businessRef: `SO-${Date.now()}`,
          eventType: 'order.released.v1',
          payload: { orderId: crypto.randomUUID(), version: 1 },
        });
      else if (actionId === 'failDelivery' && selectedDelivery)
        await post(
          `/api/v1/integration/exchange/deliveries/${selectedDelivery.id}/complete`,
          {
            errorMessage: '工作台模拟伙伴端超时',
            expectedVersion: selectedDelivery.version,
            responseStatus: 503,
          },
        );
      else if (actionId === 'replay' && selectedMessage)
        await post(
          `/api/v1/integration/exchange/messages/${selectedMessage.id}/replay`,
          {
            expectedVersion: selectedMessage.version,
            reason: '映射或伙伴端问题已修复，授权重新处理原始消息',
          },
        );
      setNotice('动作已执行；原始消息、每次投递、映射版本和重放关系均保留');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '消息集成动作失败');
    }
  }
  const grid = {
    onPageChange: () => undefined,
    page: 1,
    pageSize: 50,
  } as const;
  return (
    <section className="message-exchange-workbench">
      <Typography.Title level={2}>消息集成与重放中心</Typography.Title>
      <Typography.Paragraph>
        管理 EDI/SFTP 文件、Webhook
        至少一次投递、版本化字段映射，并按业务号、状态、错误和重试轨迹定位后授权重放。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {secret ? (
        <Alert
          description="请立即保存；刷新后不再展示。"
          message={`一次性 Webhook 密钥：${secret}`}
          showIcon
          type="warning"
        />
      ) : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />
      <Card title="文件交换与回执">
        <DataGrid
          {...grid}
          columns={[
            { key: 'fileName', label: '文件名' },
            { key: 'channel', label: '渠道' },
            { key: 'partnerRef', label: '伙伴' },
            { key: 'lineCount', label: '行数' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={view.files}
          total={view.files.length}
        />
      </Card>
      <Card title="Webhook 订阅">
        <DataGrid
          {...grid}
          columns={[
            { key: 'name', label: '名称' },
            { key: 'endpointUrl', label: '端点' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={view.subscriptions}
          total={view.subscriptions.length}
        />
      </Card>
      <Card title="投递尝试与退避">
        <DataGrid
          {...grid}
          columns={[
            { key: 'messageId', label: '消息 ID' },
            { key: 'attemptNumber', label: '次数' },
            { key: 'availableAt', label: '下次可用' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onSelectionChange={setDeliveryIds}
          rows={view.deliveries}
          selectedIds={deliveryIds}
          total={view.deliveries.length}
        />
      </Card>
      <Card title="字段映射版本">
        <DataGrid
          {...grid}
          columns={[
            { key: 'code', label: '编码' },
            { key: 'name', label: '名称' },
            { key: 'activeVersionNumber', label: '活动版本' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={view.mappings}
          total={view.mappings.length}
        />
      </Card>
      <Card title="消息监控与授权重放">
        <DataGrid
          {...grid}
          columns={[
            { key: 'businessRef', label: '业务号' },
            { key: 'channel', label: '渠道' },
            { key: 'messageType', label: '消息类型' },
            { key: 'errorCode', label: '错误码' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onSelectionChange={setMessageIds}
          rows={view.messages}
          selectedIds={messageIds}
          total={view.messages.length}
        />
      </Card>
    </section>
  );
}
