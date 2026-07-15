import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface ProcessRow {
  expectedStepCount: number;
  failureCode: string | null;
  id: string;
  manualInterventionRequired: boolean;
  orderNo: string;
  status: string;
  succeededStepCount: number;
  version: number;
}

interface StepRow {
  attemptCount: number;
  id: string;
  lastError: string | null;
  status: string;
  stepType: string;
  targetBusinessNo: string | null;
  targetType: string | null;
  version: number;
}

interface LinkRow {
  id: string;
  sourceBusinessNo: string;
  sourceType: string;
  targetBusinessNo: string;
  targetType: string;
}

const registry = createActionRegistry<string>([
  {
    allowedStatuses: ['FAILED', 'MANUAL'],
    confirmMessage: '确认仅重试当前失败步骤？已成功的下游对象不会重复创建。',
    id: 'retry-step',
    label: '重试失败步骤',
    requiredPermissions: ['oms.fulfillment.project'],
  },
]);

export function FulfillmentProcessWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [status, setStatus] = useState('');
  const [processes, setProcesses] = useState<readonly ProcessRow[]>([]);
  const [steps, setSteps] = useState<readonly StepRow[]>([]);
  const [links, setLinks] = useState<readonly LinkRow[]>([]);
  const [selectedProcessIds, setSelectedProcessIds] = useState<
    readonly string[]
  >([]);
  const [selectedStepIds, setSelectedStepIds] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? claims.accountKind === 'USER'
            ? ['oms.order.read']
            : ['oms.order.read', 'oms.fulfillment.project']
          : [],
      ),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用履约过程中心');
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
      const body = await request(
        `/api/v1/oms/fulfillment-processes${status ? `?status=${status}` : ''}`,
      );
      setProcesses((body as unknown as { items: ProcessRow[] }).items);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '履约过程查询失败');
    }
  }, [accessToken, claims, request, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const processId = selectedProcessIds[0];
    if (!processId) {
      setSteps([]);
      setLinks([]);
      return;
    }
    void request(`/api/v1/oms/fulfillment-processes/${processId}`)
      .then((body) => {
        const detail = body as unknown as {
          links: LinkRow[];
          steps: StepRow[];
        };
        setSteps(detail.steps);
        setLinks(detail.links);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : '过程详情查询失败'),
      );
  }, [request, selectedProcessIds]);

  const selectedProcess = processes.find(
    ({ id }) => id === selectedProcessIds[0],
  );
  const selectedStep = steps.find(({ id }) => id === selectedStepIds[0]);
  const retryDecision = registry.decide('retry-step', {
    dataScopeAllowed: true,
    permissions,
    status: selectedStep?.status ?? 'NONE',
  });

  async function retryStep() {
    if (!selectedProcess || !selectedStep || !retryDecision.enabled) return;
    if (
      retryDecision.confirmMessage &&
      !window.confirm(retryDecision.confirmMessage)
    )
      return;
    try {
      await request(
        `/api/v1/oms/fulfillment-processes/${selectedProcess.id}/steps/${selectedStep.id}/retry`,
        {
          body: JSON.stringify({
            expectedProcessVersion: selectedProcess.version,
            expectedStepVersion: selectedStep.version,
          }),
          method: 'POST',
        },
      );
      setNotice('失败步骤已重新进入有序投递队列');
      setSelectedStepIds([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '步骤重试失败');
    }
  }

  return (
    <section className="workbench-page">
      <Typography.Title level={2}>履约过程中心</Typography.Title>
      <Typography.Paragraph>
        观察 OMS release 到 WMS 出库、TMS
        运输订单的自动编排，并对永久失败步骤进行显式重试。
      </Typography.Paragraph>
      {notice ? (
        <Alert
          closable
          message={notice}
          onClose={() => setNotice(undefined)}
          type="success"
        />
      ) : null}
      {error ? (
        <Alert
          closable
          message={error}
          onClose={() => setError(undefined)}
          type="error"
        />
      ) : null}
      <QueryPanel
        fields={[
          {
            label: '过程状态',
            name: 'status',
            placeholder: 'WAITING_DOWNSTREAM / MANUAL_INTERVENTION',
            quick: true,
          },
        ]}
        onReset={() => setStatus('')}
        onQuery={(values) => setStatus((values.status ?? '').toUpperCase())}
      />
      <CommandBar actions={[retryDecision]} onAction={() => void retryStep()} />
      <Card title="过程实例">
        <DataGrid
          columns={[
            { key: 'orderNo', label: '订单号' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'succeededStepCount', label: '成功步骤' },
            { key: 'expectedStepCount', label: '预期步骤' },
            { key: 'failureCode', label: '失败码' },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={200}
          rows={processes}
          selectedIds={selectedProcessIds}
          onSelectionChange={(ids) => setSelectedProcessIds(ids.slice(-1))}
          total={processes.length}
        />
      </Card>
      <Card title="步骤与重试">
        <DataGrid
          columns={[
            { key: 'stepType', label: '步骤' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'attemptCount', label: '尝试次数' },
            { key: 'targetType', label: '目标域对象' },
            { key: 'targetBusinessNo', label: '目标业务号' },
            { key: 'lastError', label: '最后错误' },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={200}
          rows={steps}
          selectedIds={selectedStepIds}
          onSelectionChange={(ids) => setSelectedStepIds(ids.slice(-1))}
          total={steps.length}
        />
      </Card>
      <Card title="跨域对象链接">
        <DataGrid
          columns={[
            { key: 'sourceType', label: '来源类型' },
            { key: 'sourceBusinessNo', label: '来源业务号' },
            { key: 'targetType', label: '目标类型' },
            { key: 'targetBusinessNo', label: '目标业务号' },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={200}
          rows={links}
          total={links.length}
        />
      </Card>
    </section>
  );
}
