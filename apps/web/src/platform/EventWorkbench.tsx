import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Typography } from 'antd';
import { useSessionStore } from './session-store';

interface OutboxRow {
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: number;
  attemptCount: number;
  eventName: string;
  id: string;
  status: string;
  version: number;
}

interface InboxRow {
  aggregateVersion: number;
  consumer: string;
  eventType: string;
  id: string;
  status: string;
}

interface DeliveryRow {
  attemptCount: number;
  consumer: string;
  endpoint: string;
  eventId: string;
  id: string;
  partitionKey: string;
  status: string;
  version: number;
}

interface CheckpointRow {
  aggregateId: string;
  aggregateType: string;
  consumer: string;
  id: string;
  lastEventId: string;
  lastVersion: number;
}

const registry = createActionRegistry<string>([
  {
    allowedStatuses: ['DEAD_LETTER'],
    confirmMessage: '确认恢复该死信并重新进入有序投递队列？',
    id: 'replay',
    label: '恢复死信',
    requiredPermissions: ['platform.event.replay'],
  },
]);

const deliveryRegistry = createActionRegistry<string>([
  {
    allowedStatuses: ['DEAD_LETTER'],
    confirmMessage: '确认恢复该消费者死信并重新进入分区有序投递队列？',
    id: 'replay',
    label: '恢复消费者死信',
    requiredPermissions: ['platform.event.replay'],
  },
]);

export function EventWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [outbox, setOutbox] = useState<readonly OutboxRow[]>([]);
  const [deliveries, setDeliveries] = useState<readonly DeliveryRow[]>([]);
  const [inbox, setInbox] = useState<readonly InboxRow[]>([]);
  const [checkpoints, setCheckpoints] = useState<readonly CheckpointRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<
    readonly string[]
  >([]);
  const [outboxStatus, setOutboxStatus] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const [consumer, setConsumer] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? claims.accountKind === 'USER'
            ? ['platform.event.read']
            : ['platform.event.read', 'platform.event.replay']
          : [],
      ),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用事件中心');
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
      if (!response.ok) {
        throw new Error(
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '请求失败'}`,
        );
      }
      return body;
    },
    [accessToken, claims],
  );

  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    try {
      const [outboxRows, deliveryRows, inboxRows, checkpointRows] =
        await Promise.all([
          request(
            `/api/v1/platform/events/outbox${outboxStatus ? `?status=${outboxStatus}` : ''}`,
          ),
          request(
            `/api/v1/platform/events/deliveries${deliveryStatus || consumer ? `?${new URLSearchParams({ ...(deliveryStatus ? { status: deliveryStatus } : {}), ...(consumer ? { consumer } : {}) }).toString()}` : ''}`,
          ),
          request(
            `/api/v1/platform/events/inbox${consumer ? `?consumer=${encodeURIComponent(consumer)}` : ''}`,
          ),
          request(
            `/api/v1/platform/events/checkpoints${consumer ? `?consumer=${encodeURIComponent(consumer)}` : ''}`,
          ),
        ]);
      setOutbox(outboxRows as unknown as OutboxRow[]);
      setDeliveries(deliveryRows as unknown as DeliveryRow[]);
      setInbox(inboxRows as unknown as InboxRow[]);
      setCheckpoints(checkpointRows as unknown as CheckpointRow[]);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '事件数据查询失败');
    }
  }, [accessToken, claims, consumer, deliveryStatus, outboxStatus, request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = outbox.find(({ id }) => id === selectedIds[0]);
  const selectedDelivery = deliveries.find(
    ({ id }) => id === selectedDeliveryIds[0],
  );
  const replayDecision = registry.decide('replay', {
    dataScopeAllowed: true,
    permissions,
    status: selected?.status ?? 'NONE',
  });
  const deliveryReplayDecision = deliveryRegistry.decide('replay', {
    dataScopeAllowed: true,
    permissions,
    status: selectedDelivery?.status ?? 'NONE',
  });

  async function replay() {
    if (!selected || !replayDecision.enabled) return;
    if (
      replayDecision.confirmMessage &&
      !window.confirm(replayDecision.confirmMessage)
    )
      return;
    try {
      await request(`/api/v1/platform/events/outbox/${selected.id}/replay`, {
        body: JSON.stringify({ expectedVersion: selected.version }),
        method: 'POST',
      });
      setNotice('死信已恢复，将按聚合版本重新投递');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '死信恢复失败');
    }
  }

  async function replayDelivery() {
    if (!selectedDelivery || !deliveryReplayDecision.enabled) return;
    if (
      deliveryReplayDecision.confirmMessage &&
      !window.confirm(deliveryReplayDecision.confirmMessage)
    )
      return;
    try {
      await request(
        `/api/v1/platform/events/deliveries/${selectedDelivery.id}/replay`,
        {
          body: JSON.stringify({ expectedVersion: selectedDelivery.version }),
          method: 'POST',
        },
      );
      setNotice('消费者死信已恢复；已成功的其他订阅不会重复执行');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '消费者死信恢复失败');
    }
  }

  return (
    <section className="event-workbench">
      <Typography.Title level={2}>业务事件与投递运维中心</Typography.Title>
      <Typography.Paragraph>
        Outbox 记录事件发布，Delivery 按 tenant + consumer + partitionKey
        严格排序；每个消费者独立重试、死信与回放，Inbox 负责副作用去重。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}

      <Card title="事务 Outbox 与死信">
        <QueryPanel
          fields={[{ label: '投递状态', name: 'status', quick: true }]}
          onQuery={(values) => setOutboxStatus(values.status ?? '')}
          onReset={() => setOutboxStatus('')}
        />
        <CommandBar actions={[replayDecision]} onAction={() => void replay()} />
        <DataGrid
          columns={[
            { key: 'eventName', label: '事件类型' },
            { key: 'aggregateType', label: '聚合类型' },
            { key: 'aggregateId', label: '聚合 ID' },
            { key: 'aggregateVersion', label: '聚合版本' },
            { key: 'attemptCount', label: '尝试次数' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))}
          page={1}
          pageSize={300}
          rows={outbox}
          selectedIds={selectedIds}
          total={outbox.length}
        />
      </Card>

      <Card title="消费者 Delivery、死信与重放">
        <QueryPanel
          fields={[{ label: 'Delivery 状态', name: 'status', quick: true }]}
          onQuery={(values) => setDeliveryStatus(values.status ?? '')}
          onReset={() => setDeliveryStatus('')}
        />
        <CommandBar
          actions={[deliveryReplayDecision]}
          onAction={() => void replayDelivery()}
        />
        <DataGrid
          columns={[
            { key: 'consumer', label: '消费者' },
            { key: 'eventId', label: '事件 ID' },
            { key: 'partitionKey', label: '分区键' },
            { key: 'endpoint', label: '内部处理端点' },
            { key: 'attemptCount', label: '尝试次数' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedDeliveryIds(ids.slice(-1))}
          page={1}
          pageSize={300}
          rows={deliveries}
          selectedIds={selectedDeliveryIds}
          total={deliveries.length}
        />
      </Card>

      <Card title="消费者 Inbox 去重回执">
        <QueryPanel
          fields={[{ label: '消费者', name: 'consumer', quick: true }]}
          onQuery={(values) => setConsumer(values.consumer ?? '')}
          onReset={() => setConsumer('')}
        />
        <DataGrid
          columns={[
            { key: 'consumer', label: '消费者' },
            { key: 'eventType', label: '事件类型' },
            { key: 'aggregateVersion', label: '聚合版本' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={() => undefined}
          page={1}
          pageSize={300}
          rows={inbox}
          selectedIds={[]}
          total={inbox.length}
        />
      </Card>

      <Card title="消费者 Checkpoint">
        <DataGrid
          columns={[
            { key: 'consumer', label: '消费者' },
            { key: 'aggregateType', label: '聚合类型' },
            { key: 'aggregateId', label: '聚合 ID' },
            { key: 'lastVersion', label: '最后版本' },
            { key: 'lastEventId', label: '最后事件 ID' },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={() => undefined}
          page={1}
          pageSize={300}
          rows={checkpoints}
          selectedIds={[]}
          total={checkpoints.length}
        />
      </Card>
    </section>
  );
}
