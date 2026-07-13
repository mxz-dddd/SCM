import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Button, Card, Input, Select, Space, Typography } from 'antd';
import { useSessionStore } from './session-store';

interface DefinitionRow {
  code: string;
  handler: string;
  id: string;
  name: string;
  status: string;
  triggerType: string;
  version: number;
}

interface RunRow {
  handler: string;
  id: string;
  progress: number;
  status: string;
  triggerType: string;
  version: number;
}

const registry = createActionRegistry<string>([
  {
    allowedStatuses: ['ACTIVE'],
    id: 'trigger',
    label: '立即运行',
    requiredPermissions: ['platform.job.trigger'],
  },
  {
    allowedStatuses: ['QUEUED', 'RUNNING'],
    confirmMessage: '确认取消该任务运行？',
    id: 'cancel',
    label: '取消运行',
    requiredPermissions: ['platform.job.cancel'],
  },
]);

export function JobWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [definitions, setDefinitions] = useState<readonly DefinitionRow[]>([]);
  const [runs, setRuns] = useState<readonly RunRow[]>([]);
  const [selectedDefinitionIds, setSelectedDefinitionIds] = useState<readonly string[]>([]);
  const [selectedRunIds, setSelectedRunIds] = useState<readonly string[]>([]);
  const [runStatus, setRunStatus] = useState('');
  const [code, setCode] = useState('DAILY_REPORT');
  const [name, setName] = useState('每日运营报告');
  const [handler, setHandler] = useState('REPORT');
  const [triggerType, setTriggerType] = useState('CRON');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? claims.accountKind === 'USER'
            ? ['platform.job.read']
            : [
                'platform.job.read',
                'platform.job.write',
                'platform.job.trigger',
                'platform.job.cancel',
              ]
          : [],
      ),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用调度中心');
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
    try {
      const [definitionRows, runRows] = await Promise.all([
        request('/api/v1/platform/jobs/definitions'),
        request(`/api/v1/platform/jobs/runs${runStatus ? `?status=${runStatus}` : ''}`),
      ]);
      setDefinitions(definitionRows as unknown as DefinitionRow[]);
      setRuns(runRows as unknown as RunRow[]);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '调度数据查询失败');
    }
  }, [accessToken, claims, request, runStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedDefinition = definitions.find(({ id }) => id === selectedDefinitionIds[0]);
  const selectedRun = runs.find(({ id }) => id === selectedRunIds[0]);
  const decisions = [
    registry.decide('trigger', {
      dataScopeAllowed: true,
      permissions,
      status: selectedDefinition?.status ?? 'NONE',
    }),
    registry.decide('cancel', {
      dataScopeAllowed: true,
      permissions,
      status: selectedRun?.status ?? 'NONE',
    }),
  ];

  async function createDefinition() {
    try {
      await request('/api/v1/platform/jobs/definitions', {
        body: JSON.stringify({
          code,
          cronExpression: triggerType === 'CRON' ? '0 2 * * *' : undefined,
          eventName: triggerType === 'EVENT' ? 'platform.demo-ready.v1' : undefined,
          handler,
          name,
          runAt: triggerType === 'ONCE' ? new Date(Date.now() + 60_000).toISOString() : undefined,
          triggerType,
        }),
        method: 'POST',
      });
      setNotice('JobDefinition 已保存并注册 BullMQ 调度');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '任务定义保存失败');
    }
  }

  async function act(id: string) {
    try {
      if (id === 'trigger' && selectedDefinition) {
        await request(`/api/v1/platform/jobs/definitions/${selectedDefinition.id}/runs`, {
          body: JSON.stringify({ payload: { source: 'workbench' } }),
          method: 'POST',
        });
        setNotice('任务已进入队列，可在运行列表查看进度');
      }
      if (id === 'cancel' && selectedRun) {
        await request(`/api/v1/platform/jobs/runs/${selectedRun.id}/cancel`, {
          body: JSON.stringify({ expectedVersion: selectedRun.version, reason: '工作台人工取消' }),
          method: 'POST',
        });
        setNotice('取消请求已提交');
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '任务操作失败');
    }
  }

  return (
    <section className="job-workbench">
      <Typography.Title level={2}>调度任务与异步执行中心</Typography.Title>
      <Typography.Paragraph>
        一次、周期与事件触发统一进入 BullMQ；数据库租约控制并发与防重，并保留进度、结果及不可变日志。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}

      <Card title="JobDefinition 调度定义">
        <Space wrap>
          <Input aria-label="任务代码" onChange={(event) => setCode(event.target.value)} value={code} />
          <Input aria-label="任务名称" onChange={(event) => setName(event.target.value)} value={name} />
          <Select aria-label="处理器" onChange={setHandler} options={['REPORT', 'EXPORT', 'IMPORT', 'RECONCILIATION'].map((value) => ({ label: value, value }))} value={handler} />
          <Select aria-label="触发类型" onChange={setTriggerType} options={['ONCE', 'CRON', 'EVENT'].map((value) => ({ label: value, value }))} value={triggerType} />
          <Button disabled={!permissions.has('platform.job.write')} onClick={() => void createDefinition()}>
            新建调度定义
          </Button>
        </Space>
        <DataGrid
          columns={[
            { key: 'code', label: '代码' },
            { key: 'name', label: '名称' },
            { key: 'handler', label: '处理器' },
            { key: 'triggerType', label: '触发' },
            { key: 'status', label: '状态', render: (value) => <StatusBadge status={String(value)} /> },
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

      <Card title="JobRun 进度与结果">
        <QueryPanel
          fields={[{ label: '状态', name: 'status', quick: true }]}
          onQuery={(values) => setRunStatus(values.status ?? '')}
          onReset={() => setRunStatus('')}
        />
        <CommandBar actions={decisions} onAction={({ id }) => void act(id)} />
        <DataGrid
          columns={[
            { key: 'handler', label: '处理器' },
            { key: 'triggerType', label: '触发' },
            { key: 'progress', label: '进度 %' },
            { key: 'status', label: '状态', render: (value) => <StatusBadge status={String(value)} /> },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedRunIds(ids.slice(-1))}
          page={1}
          pageSize={200}
          rows={runs}
          selectedIds={selectedRunIds}
          total={runs.length}
        />
      </Card>
    </section>
  );
}
