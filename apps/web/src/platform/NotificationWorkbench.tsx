import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Button, Card, Checkbox, Input, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from './session-store';

type InboxStatus = 'ARCHIVED' | 'READ' | 'UNREAD';
type NotificationStatus = 'DELIVERED' | 'FAILED' | 'PARTIAL_FAILED' | 'PENDING';

interface InboxRow {
  businessDomain: string;
  businessRef: string;
  createdAt: string;
  id: string;
  responsibilityGroup: string;
  route: string;
  severity: string;
  status: InboxStatus;
  summary: string;
  title: string;
  type: string;
  version: number;
}

interface NotificationRow {
  businessRef: string;
  deliveredChannels: string[];
  id: string;
  renderedSubject: string;
  requestedChannels: string[];
  severity: string;
  status: NotificationStatus;
  version: number;
}

interface TemplateRow {
  code: string;
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  version: number;
  versionNumber: number;
}

interface PreferenceRow {
  channel: string;
  enabled: boolean;
  id: string;
  minimumSeverity: string;
  version: number;
}

const inboxActions = createActionRegistry<InboxStatus>([
  {
    allowedStatuses: ['UNREAD'],
    id: 'read',
    label: '标记已读',
    requiredPermissions: ['platform.inbox.read'],
  },
  {
    allowedStatuses: ['READ'],
    confirmMessage: '归档后将从默认待办视图中移除，确认继续？',
    id: 'archive',
    label: '归档',
    requiredPermissions: ['platform.inbox.read'],
  },
  {
    id: 'open-business',
    label: '打开业务对象',
    requiredPermissions: ['platform.inbox.read'],
  },
]);

const deliveryActions = createActionRegistry<NotificationStatus>([
  {
    allowedStatuses: ['PENDING', 'PARTIAL_FAILED', 'FAILED'],
    confirmMessage: '确认投递或重试尚未成功的渠道？',
    id: 'dispatch',
    label: '投递 / 重试',
    requiredPermissions: ['platform.notification.send'],
  },
]);

export function NotificationWorkbench() {
  const navigate = useNavigate();
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [inbox, setInbox] = useState<readonly InboxRow[]>([]);
  const [notifications, setNotifications] = useState<readonly NotificationRow[]>([]);
  const [templates, setTemplates] = useState<readonly TemplateRow[]>([]);
  const [preferences, setPreferences] = useState<readonly PreferenceRow[]>([]);
  const [selectedInboxIds, setSelectedInboxIds] = useState<readonly string[]>([]);
  const [selectedNotificationIds, setSelectedNotificationIds] = useState<readonly string[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<readonly string[]>([]);
  const [filters, setFilters] = useState<Readonly<Record<string, string>>>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [templateCode, setTemplateCode] = useState('ORDER_EXCEPTION');
  const [templateSubject, setTemplateSubject] = useState('订单 {{businessRef}} 异常');
  const [templateBody, setTemplateBody] = useState('{{summary}}');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? claims.accountKind === 'USER'
            ? ['platform.inbox.read']
            : [
                'platform.inbox.read',
                'platform.inbox.write',
                'platform.notification.manage',
                'platform.notification.send',
              ]
          : [],
      ),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后查看待办');
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
      const body = (await response.json()) as { code?: string; message?: string };
      if (!response.ok) {
        throw new Error(`${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '请求失败'}`);
      }
      return body;
    },
    [accessToken, claims],
  );

  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: '20',
      ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim())),
    });
    try {
      const inboxResponse = (await request(
        `/api/v1/platform/notifications/inbox?${parameters}`,
      )) as unknown as { items: InboxRow[]; total: number };
      setInbox(inboxResponse.items);
      setTotal(inboxResponse.total);
      const preferenceResponse = (await request(
        '/api/v1/platform/notifications/preferences',
      )) as unknown as PreferenceRow[];
      setPreferences(preferenceResponse);
      if (claims.accountKind !== 'USER') {
        const [notificationResponse, templateResponse] = await Promise.all([
          request('/api/v1/platform/notifications'),
          request('/api/v1/platform/notifications/templates'),
        ]);
        setNotifications(notificationResponse as unknown as NotificationRow[]);
        setTemplates(templateResponse as unknown as TemplateRow[]);
      }
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '待办查询失败');
    }
  }, [accessToken, claims, filters, page, request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedInbox = inbox.find(({ id }) => id === selectedInboxIds[0]);
  const selectedNotification = notifications.find(
    ({ id }) => id === selectedNotificationIds[0],
  );
  const selectedTemplate = templates.find(({ id }) => id === selectedTemplateIds[0]);
  const inboxDecisions = (['read', 'archive', 'open-business'] as const).map((id) =>
    inboxActions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selectedInbox?.status ?? 'UNREAD',
    }),
  );
  const deliveryDecision = deliveryActions.decide('dispatch', {
    dataScopeAllowed: true,
    permissions,
    status: selectedNotification?.status ?? 'DELIVERED',
  });

  async function transitionInbox(target: 'archive' | 'read') {
    if (!selectedInbox) return;
    await request(
      `/api/v1/platform/notifications/inbox/${selectedInbox.id}/${target}`,
      {
        body: JSON.stringify({ expectedVersion: selectedInbox.version }),
        method: 'POST',
      },
    );
    setNotice(target === 'read' ? '已记录阅读时间' : '待办已归档');
    await refresh();
  }

  async function executeInbox(actionId: string) {
    const decision = inboxDecisions.find(({ id }) => id === actionId);
    if (!decision?.enabled || !selectedInbox) return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage)) return;
    try {
      if (actionId === 'read') await transitionInbox('read');
      if (actionId === 'archive') await transitionInbox('archive');
      if (actionId === 'open-business') void navigate(selectedInbox.route);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '待办操作失败');
    }
  }

  async function dispatch() {
    if (!selectedNotification || !deliveryDecision.enabled) return;
    if (deliveryDecision.confirmMessage && !window.confirm(deliveryDecision.confirmMessage)) return;
    try {
      await request(
        `/api/v1/platform/notifications/${selectedNotification.id}/dispatch`,
        {
          body: JSON.stringify({ expectedVersion: selectedNotification.version }),
          method: 'POST',
        },
      );
      setNotice('投递结果与重试计划已更新');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '投递失败');
    }
  }

  async function savePreference(channel: string, enabled: boolean, version?: number) {
    try {
      await request('/api/v1/platform/notifications/preferences', {
        body: JSON.stringify({ channel, enabled, expectedVersion: version }),
        method: 'PUT',
      });
      setNotice('订阅偏好已保存');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '偏好保存失败');
    }
  }

  async function createTemplate() {
    try {
      await request('/api/v1/platform/notifications/templates', {
        body: JSON.stringify({
          bodyTemplate: templateBody,
          channels: ['IN_APP', 'EMAIL'],
          code: templateCode,
          subjectTemplate: templateSubject,
          variableWhitelist: ['businessRef', 'summary'],
        }),
        method: 'POST',
      });
      setNotice('模板草稿已创建');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '模板创建失败');
    }
  }

  async function publishTemplate() {
    if (!selectedTemplate || selectedTemplate.status !== 'DRAFT') return;
    try {
      await request(
        `/api/v1/platform/notifications/templates/${selectedTemplate.id}/publish`,
        {
          body: JSON.stringify({ expectedVersion: selectedTemplate.version }),
          method: 'POST',
        },
      );
      setNotice('模板版本已发布');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '模板发布失败');
    }
  }

  return (
    <section className="notification-workbench">
      <Typography.Title level={2}>待办与消息中心</Typography.Title>
      <Typography.Paragraph>
        聚合审批、异常、到期和接口失败；通知按订阅、免打扰、重试与升级策略投递。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}

      <Card title="我的待办">
        <QueryPanel
          expanded
          fields={[
            { label: '状态', name: 'status', quick: true },
            { label: '严重度', name: 'severity', quick: true },
            { label: '业务域', name: 'businessDomain' },
            { label: '责任组', name: 'responsibilityGroup' },
          ]}
          onQuery={(values) => {
            setFilters(values);
            setPage(1);
          }}
          onReset={() => setFilters({})}
        />
        <CommandBar actions={inboxDecisions} onAction={({ id }) => void executeInbox(id)} />
        <DataGrid
          columns={[
            { fixed: 'left', key: 'title', label: '标题' },
            { key: 'type', label: '类型' },
            { key: 'businessDomain', label: '业务域' },
            { key: 'businessRef', label: '业务号' },
            { key: 'responsibilityGroup', label: '责任组' },
            { key: 'severity', label: '严重度', render: (value) => <StatusBadge status={String(value)} /> },
            { key: 'status', label: '状态', render: (value) => <StatusBadge status={String(value)} /> },
            { fixed: 'right', key: 'createdAt', label: '创建时间' },
          ]}
          onPageChange={setPage}
          onSelectionChange={(ids) => setSelectedInboxIds(ids.slice(-1))}
          page={page}
          pageSize={20}
          rows={inbox}
          selectedIds={selectedInboxIds}
          total={total}
        />
      </Card>

      <Card title="订阅与免打扰">
        <Space wrap>
          {['IN_APP', 'EMAIL', 'SMS', 'WECHAT', 'PUSH'].map((channel) => {
            const preference = preferences.find((item) => item.channel === channel);
            return (
              <Checkbox
                checked={preference?.enabled ?? true}
                key={channel}
                onChange={(event) =>
                  void savePreference(channel, event.target.checked, preference?.version)
                }
              >
                {channel}
              </Checkbox>
            );
          })}
        </Space>
      </Card>

      {claims?.accountKind !== 'USER' ? (
        <>
          <Card title="通知模板版本">
            <Space wrap>
              <Input aria-label="模板代码" onChange={(event) => setTemplateCode(event.target.value)} value={templateCode} />
              <Input aria-label="主题模板" onChange={(event) => setTemplateSubject(event.target.value)} value={templateSubject} />
              <Input aria-label="正文模板" onChange={(event) => setTemplateBody(event.target.value)} value={templateBody} />
              <Button disabled={!permissions.has('platform.notification.manage')} onClick={() => void createTemplate()}>
                新建模板草稿
              </Button>
              <Button disabled={selectedTemplate?.status !== 'DRAFT'} onClick={() => void publishTemplate()} type="primary">
                发布选中版本
              </Button>
            </Space>
            <DataGrid
              columns={[
                { key: 'code', label: '代码' },
                { key: 'versionNumber', label: '内容版本' },
                { key: 'status', label: '状态', render: (value) => <StatusBadge status={String(value)} /> },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setSelectedTemplateIds(ids.slice(-1))}
              page={1}
              pageSize={20}
              rows={templates}
              selectedIds={selectedTemplateIds}
              total={templates.length}
            />
          </Card>
          <Card title="投递与重试">
            <CommandBar actions={[deliveryDecision]} onAction={() => void dispatch()} />
            <DataGrid
              columns={[
                { fixed: 'left', key: 'renderedSubject', label: '主题' },
                { key: 'businessRef', label: '业务号' },
                { key: 'severity', label: '严重度' },
                { key: 'requestedChannels', label: '请求渠道' },
                { key: 'deliveredChannels', label: '成功渠道' },
                { fixed: 'right', key: 'status', label: '状态', render: (value) => <StatusBadge status={String(value)} /> },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={(ids) => setSelectedNotificationIds(ids.slice(-1))}
              page={1}
              pageSize={100}
              rows={notifications}
              selectedIds={selectedNotificationIds}
              total={notifications.length}
            />
          </Card>
        </>
      ) : null}
    </section>
  );
}
