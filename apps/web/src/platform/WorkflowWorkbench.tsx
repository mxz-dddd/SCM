import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Button, Card, Input, Space, Typography } from 'antd';
import { useSessionStore } from './session-store';

interface DefinitionRow {
  code: string;
  id: string;
  name: string;
  status: string;
  version: number;
  versionNumber: number;
}

interface TaskRow {
  assigneeAccountId: string;
  dueAt: string | null;
  id: string;
  nodeKey: string;
  status: string;
  version: number;
  workflowInstanceId: string;
}

const taskActions = createActionRegistry<string>([
  {
    allowedStatuses: ['PENDING'],
    id: 'APPROVE',
    label: '同意',
    requiredPermissions: ['platform.approval.act'],
  },
  {
    allowedStatuses: ['PENDING'],
    confirmMessage: '确认拒绝该审批？',
    id: 'REJECT',
    label: '拒绝',
    requiredPermissions: ['platform.approval.act'],
  },
  {
    allowedStatuses: ['PENDING'],
    id: 'RETURN',
    label: '退回',
    requiredPermissions: ['platform.approval.act'],
  },
  {
    allowedStatuses: ['PENDING'],
    id: 'ADD_SIGN',
    label: '加签',
    requiredPermissions: ['platform.approval.act'],
  },
  {
    allowedStatuses: ['PENDING'],
    id: 'TRANSFER',
    label: '转交',
    requiredPermissions: ['platform.approval.act'],
  },
]);

export function WorkflowWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [definitions, setDefinitions] = useState<readonly DefinitionRow[]>([]);
  const [tasks, setTasks] = useState<readonly TaskRow[]>([]);
  const [selectedDefinitionIds, setSelectedDefinitionIds] = useState<
    readonly string[]
  >([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<readonly string[]>([]);
  const [taskStatus, setTaskStatus] = useState('PENDING');
  const [definitionCode, setDefinitionCode] = useState('ORDER_APPROVAL');
  const [definitionName, setDefinitionName] = useState('订单审批');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? claims.accountKind === 'USER'
            ? [
                'platform.approval.read',
                'platform.approval.act',
                'platform.workflow.start',
              ]
            : [
                'platform.workflow-definition.read',
                'platform.workflow-definition.write',
                'platform.workflow.start',
                'platform.approval.read',
                'platform.approval.act',
              ]
          : [],
      ),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用审批中心');
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
      const taskResponse = await request(
        `/api/v1/platform/approval-tasks?status=${encodeURIComponent(taskStatus)}`,
      );
      setTasks(taskResponse as unknown as TaskRow[]);
      if (claims.accountKind !== 'USER') {
        const definitionResponse = await request(
          '/api/v1/platform/workflow-definitions',
        );
        setDefinitions(definitionResponse as unknown as DefinitionRow[]);
      }
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '流程数据查询失败');
    }
  }, [accessToken, claims, request, taskStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedDefinition = definitions.find(
    ({ id }) => id === selectedDefinitionIds[0],
  );
  const selectedTask = tasks.find(({ id }) => id === selectedTaskIds[0]);
  const decisions = ['APPROVE', 'REJECT', 'RETURN', 'ADD_SIGN', 'TRANSFER'].map(
    (id) =>
      taskActions.decide(id, {
        dataScopeAllowed:
          selectedTask?.assigneeAccountId === claims?.subject ||
          claims?.accountKind !== 'USER',
        permissions,
        status: selectedTask?.status ?? 'COMPLETED',
      }),
  );

  async function createDefinition() {
    if (!claims) return;
    try {
      await request('/api/v1/platform/workflow-definitions', {
        body: JSON.stringify({
          code: definitionCode,
          definition: {
            nodes: [
              {
                candidates: { accountIds: [claims.subject] },
                key: 'manager_review',
                name: '主管审批',
                timeoutMinutes: 1440,
                type: 'APPROVAL',
              },
              { key: 'approved', name: '完成', type: 'END' },
            ],
            startNodeKey: 'manager_review',
            transitions: [{ from: 'manager_review', to: 'approved' }],
          },
          name: definitionName,
        }),
        method: 'POST',
      });
      setNotice('流程定义草稿已创建');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '流程定义创建失败');
    }
  }

  async function publishDefinition() {
    if (!selectedDefinition || selectedDefinition.status !== 'DRAFT') return;
    try {
      await request(
        `/api/v1/platform/workflow-definitions/${selectedDefinition.id}/publish`,
        {
          body: JSON.stringify({ expectedVersion: selectedDefinition.version }),
          method: 'POST',
        },
      );
      setNotice('流程版本已发布，后续实例将绑定该版本');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '流程发布失败');
    }
  }

  async function act(action: string) {
    const decision = decisions.find(({ id }) => id === action);
    if (!selectedTask || !decision?.enabled) return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage))
      return;
    try {
      await request(
        `/api/v1/platform/approval-tasks/${selectedTask.id}/actions`,
        {
          body: JSON.stringify({
            action,
            comment,
            expectedVersion: selectedTask.version,
            ...(['ADD_SIGN', 'TRANSFER'].includes(action)
              ? { targetAccountId }
              : {}),
          }),
          method: 'POST',
        },
      );
      setNotice(`审批动作 ${action} 已记录`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '审批动作失败');
    }
  }

  return (
    <section className="workflow-workbench">
      <Typography.Title level={2}>工作流与统一审批中心</Typography.Title>
      <Typography.Paragraph>
        流程实例固化已发布定义版本；所有审批、退回、加签、转交与撤回动作均留痕。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}

      {claims?.accountKind !== 'USER' ? (
        <Card title="WorkflowDefinition 版本">
          <Space wrap>
            <Input
              aria-label="流程代码"
              onChange={(event) => setDefinitionCode(event.target.value)}
              value={definitionCode}
            />
            <Input
              aria-label="流程名称"
              onChange={(event) => setDefinitionName(event.target.value)}
              value={definitionName}
            />
            <Button
              disabled={!permissions.has('platform.workflow-definition.write')}
              onClick={() => void createDefinition()}
            >
              新建流程版本草稿
            </Button>
            <Button
              disabled={selectedDefinition?.status !== 'DRAFT'}
              onClick={() => void publishDefinition()}
              type="primary"
            >
              发布选中版本
            </Button>
          </Space>
          <DataGrid
            columns={[
              { key: 'code', label: '代码' },
              { key: 'name', label: '名称' },
              { key: 'versionNumber', label: '定义版本' },
              {
                key: 'status',
                label: '状态',
                render: (value) => <StatusBadge status={String(value)} />,
              },
            ]}
            onPageChange={() => undefined}
            onSelectionChange={(ids) => setSelectedDefinitionIds(ids.slice(-1))}
            page={1}
            pageSize={200}
            rows={definitions}
            selectedIds={selectedDefinitionIds}
            total={definitions.length}
          />
        </Card>
      ) : null}

      <Card title="我的审批任务">
        <QueryPanel
          fields={[{ label: '状态', name: 'status', quick: true }]}
          onQuery={(values) => setTaskStatus(values.status || 'PENDING')}
          onReset={() => setTaskStatus('PENDING')}
        />
        <Space wrap>
          <Input
            aria-label="审批意见"
            onChange={(event) => setComment(event.target.value)}
            value={comment}
          />
          <Input
            aria-label="加签或转交账号 ID"
            onChange={(event) => setTargetAccountId(event.target.value)}
            value={targetAccountId}
          />
        </Space>
        <CommandBar actions={decisions} onAction={({ id }) => void act(id)} />
        <DataGrid
          columns={[
            { fixed: 'left', key: 'nodeKey', label: '当前节点' },
            { key: 'workflowInstanceId', label: '流程实例' },
            { key: 'assigneeAccountId', label: '审批人' },
            { key: 'dueAt', label: '截止时间' },
            {
              fixed: 'right',
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedTaskIds(ids.slice(-1))}
          page={1}
          pageSize={200}
          rows={tasks}
          selectedIds={selectedTaskIds}
          total={tasks.length}
        />
      </Card>
    </section>
  );
}
