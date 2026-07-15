import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface PolicyRow {
  code: string;
  id: string;
  name: string;
  perMinuteLimit: number;
  routePattern: string;
  status: 'ACTIVE' | 'DRAFT' | 'RETIRED';
  version: number;
}

interface CredentialRow {
  credentialType: 'API_KEY' | 'HMAC' | 'MTLS' | 'OAUTH2_CLIENT';
  id: string;
  keyId: string;
  name: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ROTATED';
  validUntil: string | null;
  version: number;
}

interface DecisionRow {
  correlationId: string;
  dailyCount: number;
  decidedAt: string;
  id: string;
  minuteCount: number;
  outcome: string;
  reasonCode: string;
  route: string;
}

interface ContractRow {
  id: string;
  name: string;
  routeBase: string;
  status: string;
  title: string;
  version: number;
}

interface ContractVersionRow {
  definitionId: string;
  id: string;
  semanticVersion: string;
  status: string;
  version: number;
}

interface GatewayView {
  credentials: readonly CredentialRow[];
  decisions: readonly DecisionRow[];
  logs: readonly { id: string }[];
  policies: readonly PolicyRow[];
}

interface ContractView {
  definitions: readonly ContractRow[];
  notices: readonly { id: string }[];
  versions: readonly ContractVersionRow[];
}

const emptyGateway: GatewayView = {
  credentials: [],
  decisions: [],
  logs: [],
  policies: [],
};
const emptyContracts: ContractView = {
  definitions: [],
  notices: [],
  versions: [],
};
const actions = createActionRegistry<CredentialRow['status'] | 'NONE'>([
  {
    id: 'refresh',
    label: '刷新网关中心',
    requiredPermissions: ['integration.gateway.read'],
  },
  {
    id: 'bootstrapPolicy',
    label: '创建并启用策略',
    requiredPermissions: ['integration.gateway.manage'],
  },
  ...(['API_KEY', 'HMAC', 'MTLS', 'OAUTH2_CLIENT'] as const).map((type) => ({
    id: `credential:${type}`,
    label: `创建 ${type} 凭证`,
    requiredPermissions: ['integration.credential.manage'],
  })),
  {
    allowedStatuses: ['ACTIVE'],
    id: 'rotate',
    label: '轮换选中凭证',
    requiredPermissions: ['integration.credential.manage'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    id: 'revoke',
    label: '吊销选中凭证',
    requiredPermissions: ['integration.credential.manage'],
  },
  {
    id: 'publishContract',
    label: '发布 OpenAPI 示例',
    requiredPermissions: ['integration.contract.manage'],
  },
]);

export function ApiGatewayWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [gateway, setGateway] = useState<GatewayView>(emptyGateway);
  const [contracts, setContracts] = useState<ContractView>(emptyContracts);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState<string>();
  const selected = gateway.credentials.find(({ id }) => id === selectedIds[0]);
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'integration.gateway.read',
              'integration.gateway.manage',
              'integration.credential.manage',
              'integration.contract.read',
              'integration.contract.manage',
            ]
          : [],
      ),
    [claims],
  );
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selected?.status ?? 'NONE',
    }),
  );

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用开放 API 中心');
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
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '网关请求失败'}`,
        );
      return body;
    },
    [accessToken, claims],
  );
  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    const [gatewayView, contractView] = await Promise.all([
      request<GatewayView>('/api/v1/integration/gateway/workbench'),
      request<ContractView>('/api/v1/integration/contracts/workbench'),
    ]);
    setGateway(gatewayView);
    setContracts(contractView);
    setError(undefined);
  }, [accessToken, claims, request]);
  useEffect(() => {
    void refresh().catch((caught: unknown) =>
      setError(
        caught instanceof Error ? caught.message : '开放 API 中心查询失败',
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
      else if (actionId === 'bootstrapPolicy') {
        const policy = await post<PolicyRow>(
          '/api/v1/integration/gateway/policies',
          {
            allowedIps: ['127.0.0.1'],
            code: `ORDERS-${Date.now()}`,
            dailyLimit: 10_000,
            maxRequestBytes: 1_048_576,
            name: '订单开放接口默认策略',
            perMinuteLimit: 60,
            requiredScopes: ['orders.write'],
            routePattern: '/api/v1/external/orders*',
            sensitiveDailyLimit: 500,
          },
        );
        await post(
          `/api/v1/integration/gateway/policies/${policy.id}/transition`,
          {
            expectedVersion: policy.version,
            target: 'ACTIVE',
          },
        );
      } else if (actionId.startsWith('credential:')) {
        const type = actionId.slice(
          'credential:'.length,
        ) as CredentialRow['credentialType'];
        const created = await post<{ secret?: string }>(
          '/api/v1/integration/gateway/credentials',
          {
            ...(type === 'MTLS'
              ? {
                  certificateFingerprint: crypto
                    .randomUUID()
                    .replaceAll('-', ''),
                }
              : {}),
            name: `${type} ${new Date().toLocaleString()}`,
            scopes: ['orders.write'],
            type,
          },
        );
        setSecret(created.secret);
      } else if (actionId === 'rotate' && selected) {
        const rotated = await post<{ secret?: string }>(
          `/api/v1/integration/gateway/credentials/${selected.id}/rotate`,
          {
            ...(selected.credentialType === 'MTLS'
              ? {
                  certificateFingerprint: crypto
                    .randomUUID()
                    .replaceAll('-', ''),
                }
              : {}),
            expectedVersion: selected.version,
          },
        );
        setSecret(rotated.secret);
      } else if (actionId === 'revoke' && selected)
        await post(
          `/api/v1/integration/gateway/credentials/${selected.id}/revoke`,
          {
            expectedVersion: selected.version,
          },
        );
      else if (actionId === 'publishContract') {
        const definition = await post<ContractRow>(
          '/api/v1/integration/contracts',
          {
            name: `orders-${Date.now()}`,
            routeBase: '/api/v1/external/orders',
            title: 'Orders Open API',
          },
        );
        const version = await post<ContractVersionRow>(
          `/api/v1/integration/contracts/${definition.id}/versions`,
          {
            errorCodes: [{ code: 'ORDER_INVALID', message: '订单输入无效' }],
            examples: { create: { externalOrderNo: 'SO-10001' } },
            semanticVersion: '1.0.0',
            specification: {
              info: { title: 'Orders Open API', version: '1.0.0' },
              openapi: '3.1.0',
              paths: {
                '/orders': {
                  post: { responses: { '201': { description: 'Created' } } },
                },
              },
            },
          },
        );
        await post(
          `/api/v1/integration/contracts/versions/${version.id}/publish`,
          {
            expectedVersion: version.version,
          },
        );
      }
      setNotice('动作已完成；策略、轮换、限流判定与契约版本均保留审计证据');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '开放 API 动作失败');
    }
  }

  const grid = {
    onPageChange: () => undefined,
    page: 1,
    pageSize: 50,
  } as const;

  return (
    <section className="api-gateway-workbench">
      <Typography.Title level={2}>开放 API 与网关治理</Typography.Title>
      <Typography.Paragraph>
        统一管理流量策略、OAuth2/API Key/HMAC/mTLS
        凭证轮换、不可变判定日志，以及机器可读 OpenAPI 版本和弃用日期。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {secret ? (
        <Alert
          description="请立即保存；刷新页面后不会再次展示。"
          message={`一次性凭证：${secret}`}
          showIcon
          type="warning"
        />
      ) : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />

      <Card title="网关流量策略">
        <DataGrid
          {...grid}
          columns={[
            { key: 'code', label: '策略编码' },
            { key: 'name', label: '名称' },
            { key: 'routePattern', label: '路由' },
            { key: 'perMinuteLimit', label: '每分钟' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={gateway.policies}
          total={gateway.policies.length}
        />
      </Card>

      <Card title="机器凭证与轮换">
        <DataGrid
          {...grid}
          columns={[
            { key: 'name', label: '名称' },
            { key: 'credentialType', label: '类型' },
            { key: 'keyId', label: 'Key ID' },
            { key: 'validUntil', label: '有效期' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onSelectionChange={setSelectedIds}
          rows={gateway.credentials}
          selectedIds={selectedIds}
          total={gateway.credentials.length}
        />
      </Card>

      <Card title="限流判定与 correlationId 证据">
        <DataGrid
          {...grid}
          columns={[
            { key: 'correlationId', label: 'Correlation ID' },
            { key: 'route', label: '路由' },
            { key: 'minuteCount', label: '分钟计数' },
            { key: 'dailyCount', label: '日计数' },
            { key: 'reasonCode', label: '判定原因' },
            {
              key: 'outcome',
              label: '结果',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={gateway.decisions}
          total={gateway.decisions.length}
        />
      </Card>

      <Card title="OpenAPI 契约与弃用管理">
        <DataGrid
          {...grid}
          columns={[
            { key: 'name', label: 'API 标识' },
            { key: 'title', label: '标题' },
            { key: 'routeBase', label: '路由前缀' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          rows={contracts.definitions}
          total={contracts.definitions.length}
        />
      </Card>
    </section>
  );
}
