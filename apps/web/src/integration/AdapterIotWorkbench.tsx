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

interface AdapterRow {
  adapterType: string;
  activeVersionNumber: number | null;
  code: string;
  id: string;
  name: string;
  status: string;
  vendor: string;
  version: number;
}
interface AdapterCommandRow {
  businessRef: string;
  capability: string;
  externalRef: string;
  id: string;
  status: string;
  version: number;
}
interface DeviceRow {
  deviceType: string;
  firmwareVersion: string | null;
  hardwareId: string;
  id: string;
  lastHeartbeatAt: string | null;
  name: string;
  status: string;
  telemetryPerMinuteLimit: number;
  version: number;
}
interface DeviceCommandRow {
  commandType: string;
  deviceId: string;
  id: string;
  sequence: number;
  status: string;
  version: number;
}
interface AdapterIotView {
  acknowledgements: readonly { id: string }[];
  adapterCommands: readonly AdapterCommandRow[];
  adapterEvents: readonly { id: string }[];
  adapters: readonly AdapterRow[];
  certificates: readonly { id: string }[];
  deviceCommands: readonly DeviceCommandRow[];
  devices: readonly DeviceRow[];
  heartbeats: readonly { id: string }[];
  telemetry: readonly { id: string }[];
  versions: readonly { id: string }[];
}
interface DeviceIdentity {
  certificateFingerprint: string;
  hardwareId: string;
}

const empty: AdapterIotView = {
  acknowledgements: [],
  adapterCommands: [],
  adapterEvents: [],
  adapters: [],
  certificates: [],
  deviceCommands: [],
  devices: [],
  heartbeats: [],
  telemetry: [],
  versions: [],
};

const actions = createActionRegistry<string>([
  {
    id: 'refresh',
    label: '刷新适配器与设备',
    requiredPermissions: ['integration.adapter-iot.read'],
  },
  {
    id: 'adapterDemo',
    label: '创建并发布样例适配器',
    requiredPermissions: ['integration.adapter.manage'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    id: 'commandDemo',
    label: '执行样例适配命令',
    requiredPermissions: ['integration.adapter.execute'],
  },
  {
    id: 'deviceDemo',
    label: '注册并激活样例设备',
    requiredPermissions: ['integration.device.manage'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    id: 'deviceCommandDemo',
    label: '下发并回执设备命令',
    requiredPermissions: ['integration.device.command'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    id: 'suspendDevice',
    label: '暂停设备',
    requiredPermissions: ['integration.device.manage'],
  },
]);

const randomFingerprint = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');

export function AdapterIotWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [view, setView] = useState<AdapterIotView>(empty);
  const [query, setQuery] = useState('');
  const [adapterIds, setAdapterIds] = useState<readonly string[]>([]);
  const [deviceIds, setDeviceIds] = useState<readonly string[]>([]);
  const [identities, setIdentities] = useState<
    Readonly<Record<string, DeviceIdentity>>
  >({});
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const selectedAdapter = view.adapters.find(({ id }) => id === adapterIds[0]);
  const selectedDevice = view.devices.find(({ id }) => id === deviceIds[0]);
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'integration.adapter-iot.read',
              'integration.adapter.manage',
              'integration.adapter.execute',
              'integration.device.manage',
              'integration.device.command',
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
        id === 'commandDemo'
          ? (selectedAdapter?.status ?? 'NONE')
          : id === 'deviceCommandDemo' || id === 'suspendDevice'
            ? (selectedDevice?.status ?? 'NONE')
            : 'READY',
    }),
  );

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用适配器与 IoT 中心');
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
          `${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '适配器与设备请求失败'}`,
        );
      return body;
    },
    [accessToken, claims],
  );
  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    setView(
      await request<AdapterIotView>(
        '/api/v1/integration/adapter-iot/workbench',
      ),
    );
    setError(undefined);
  }, [accessToken, claims, request]);
  useEffect(() => {
    void refresh().catch((caught: unknown) =>
      setError(
        caught instanceof Error ? caught.message : '适配器与设备查询失败',
      ),
    );
  }, [refresh]);
  async function post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { body: JSON.stringify(body), method: 'POST' });
  }
  async function execute(actionId: string) {
    if (!decisions.find(({ id }) => id === actionId)?.enabled) return;
    try {
      if (actionId === 'refresh') await refresh();
      else if (actionId === 'adapterDemo') {
        const adapter = await post<{
          adapterId: string;
          adapterVersionId: string;
        }>('/api/v1/integration/adapter-iot/adapters', {
          adapterType: 'ERP',
          capabilities: ['ORDER'],
          code: `ERP-ORDER-${Date.now()}`,
          expectedCanonical: { customerId: 'CUS-DEMO', orderNo: 'SO-DEMO' },
          name: 'ERP 订单语义隔离适配器',
          rules: [
            { source: 'VBELN', target: 'orderNo' },
            { source: 'KUNNR', target: 'customerId' },
          ],
          sampleInput: {
            KUNNR: 'CUS-DEMO',
            SAP_BUKRS: '1000',
            VBELN: 'SO-DEMO',
          },
          vendor: 'DEMO-ERP',
        });
        const tested = await post<{ version: number }>(
          `/api/v1/integration/adapter-iot/adapter-versions/${adapter.adapterVersionId}/test`,
          { expectedVersion: 1 },
        );
        await post(
          `/api/v1/integration/adapter-iot/adapter-versions/${adapter.adapterVersionId}/publish`,
          { expectedVersion: tested.version },
        );
        setAdapterIds([adapter.adapterId]);
      } else if (actionId === 'commandDemo' && selectedAdapter) {
        const normalized = await post<{
          adapterCommandId: string;
          version: number;
        }>('/api/v1/integration/adapter-iot/adapter-commands', {
          businessRef: `SO-${Date.now()}`,
          capability: 'ORDER',
          definitionId: selectedAdapter.id,
          direction: 'INBOUND',
          externalRef: `ERP-${crypto.randomUUID()}`,
          vendorPayload: {
            KUNNR: 'CUS-DEMO',
            SAP_BUKRS: '1000',
            VBELN: `SO-${Date.now()}`,
          },
        });
        const dispatched = await post<{ version: number }>(
          `/api/v1/integration/adapter-iot/adapter-commands/${normalized.adapterCommandId}/dispatch`,
          { expectedVersion: normalized.version },
        );
        await post(
          `/api/v1/integration/adapter-iot/adapter-commands/${normalized.adapterCommandId}/acknowledge`,
          {
            expectedVersion: dispatched.version,
            outcome: 'ACKNOWLEDGED',
            vendorResponse: { ERP_DOCUMENT: 'DEMO-9001' },
          },
        );
      } else if (actionId === 'deviceDemo' && claims) {
        const certificateFingerprint = randomFingerprint();
        const hardwareId = `TEMP-${crypto.randomUUID()}`;
        const registered = await post<{ deviceId: string; version: number }>(
          '/api/v1/integration/adapter-iot/devices',
          {
            capabilities: ['temperature'],
            certificateFingerprint,
            certificateValidUntil: '2035-01-01T00:00:00.000Z',
            deviceType: 'TEMPERATURE',
            hardwareId,
            name: '冷链温度传感器',
            telemetryPerMinuteLimit: 60,
          },
        );
        await post(
          `/api/v1/integration/adapter-iot/devices/${registered.deviceId}/transition`,
          { expectedVersion: registered.version, target: 'ACTIVE' },
        );
        const identity = { certificateFingerprint, hardwareId };
        setIdentities((current) => ({
          ...current,
          [registered.deviceId]: identity,
        }));
        setDeviceIds([registered.deviceId]);
        const external = { ...identity, tenantId: claims.tenantId };
        await post('/api/v1/external/iot/heartbeat', {
          ...external,
          firmwareVersion: '1.0.0',
          health: { battery: 100 },
          occurredAt: new Date().toISOString(),
        });
        await post('/api/v1/external/iot/telemetry', {
          ...external,
          occurredAt: new Date().toISOString(),
          sequence: crypto.randomUUID(),
          telemetryType: 'TEMPERATURE',
          values: { celsius: 4.2 },
        });
      } else if (actionId === 'deviceCommandDemo' && selectedDevice && claims) {
        const identity = identities[selectedDevice.id];
        if (!identity)
          throw new Error(
            '请先选择本工作台刚注册的样例设备，以便使用其临时证书完成回执',
          );
        const issued = await post<{ deviceCommandId: string; version: number }>(
          `/api/v1/integration/adapter-iot/devices/${selectedDevice.id}/commands`,
          {
            commandType: 'SET_SAMPLE_INTERVAL',
            expiresAt: '2030-01-01T00:00:00.000Z',
            payload: { seconds: 30 },
          },
        );
        await post(
          `/api/v1/integration/adapter-iot/device-commands/${issued.deviceCommandId}/send`,
          { expectedVersion: issued.version },
        );
        await post('/api/v1/external/iot/command-acknowledgements', {
          ...identity,
          commandId: issued.deviceCommandId,
          occurredAt: new Date().toISOString(),
          outcome: 'ACKNOWLEDGED',
          payload: { applied: true },
          tenantId: claims.tenantId,
        });
      } else if (actionId === 'suspendDevice' && selectedDevice) {
        await post(
          `/api/v1/integration/adapter-iot/devices/${selectedDevice.id}/transition`,
          { expectedVersion: selectedDevice.version, target: 'SUSPENDED' },
        );
      }
      setNotice('动作已完成；规范载荷、设备事实和回执证据已保留');
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '适配器与设备动作失败',
      );
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const adapters = view.adapters.filter(
    (row) =>
      !normalizedQuery ||
      `${row.code} ${row.name} ${row.vendor}`
        .toLowerCase()
        .includes(normalizedQuery),
  );
  const devices = view.devices.filter(
    (row) =>
      !normalizedQuery ||
      `${row.hardwareId} ${row.name} ${row.deviceType}`
        .toLowerCase()
        .includes(normalizedQuery),
  );
  const grid = {
    onPageChange: () => undefined,
    page: 1,
    pageSize: 100,
  } as const;
  return (
    <section className="adapter-iot-workbench">
      <Typography.Title level={2}>ERP / 财务适配器与 IoT 网关</Typography.Title>
      <Typography.Paragraph>
        厂商原始字段只保存在适配器证据中，领域事件仅携带版本化规范载荷；设备证书、心跳、命令回执和遥测配额由统一网关治理。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <QueryPanel
        fields={[{ label: '适配器 / 设备', name: 'query', quick: true }]}
        onQuery={(values) => setQuery(values.query ?? '')}
        onReset={() => setQuery('')}
      />
      <CommandBar
        actions={decisions}
        onAction={(action) => void execute(action.id)}
      />
      <Card title="版本化 ERP / 财务适配器">
        <DataGrid
          {...grid}
          columns={[
            { key: 'code', label: '编码' },
            { key: 'name', label: '名称' },
            { key: 'adapterType', label: '类型' },
            { key: 'vendor', label: '厂商' },
            { key: 'activeVersionNumber', label: '生效版本' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onSelectionChange={(ids) => setAdapterIds(ids.slice(-1))}
          rows={adapters}
          selectedIds={adapterIds}
          total={adapters.length}
        />
      </Card>
      <Card title="规范化适配命令">
        <DataGrid
          {...grid}
          columns={[
            { key: 'businessRef', label: '业务引用' },
            { key: 'externalRef', label: '外部引用' },
            { key: 'capability', label: '能力' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'version', label: '版本' },
          ]}
          onSelectionChange={() => undefined}
          rows={view.adapterCommands}
          total={view.adapterCommands.length}
        />
      </Card>
      <Card title="设备注册、证书与心跳">
        <DataGrid
          {...grid}
          columns={[
            { key: 'hardwareId', label: '硬件 ID' },
            { key: 'name', label: '名称' },
            { key: 'deviceType', label: '类型' },
            { key: 'firmwareVersion', label: '固件' },
            { key: 'lastHeartbeatAt', label: '最后心跳' },
            { key: 'telemetryPerMinuteLimit', label: '每分钟遥测配额' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onSelectionChange={(ids) => setDeviceIds(ids.slice(-1))}
          rows={devices}
          selectedIds={deviceIds}
          total={devices.length}
        />
      </Card>
      <Card title="设备命令与不可变回执">
        <DataGrid
          {...grid}
          columns={[
            { key: 'deviceId', label: '设备 ID' },
            { key: 'sequence', label: '序号' },
            { key: 'commandType', label: '命令' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'version', label: '版本' },
          ]}
          onSelectionChange={() => undefined}
          rows={view.deviceCommands}
          total={view.deviceCommands.length}
        />
      </Card>
      <Alert
        message={`证据汇总：适配事件 ${view.adapterEvents.length}、证书 ${view.certificates.length}、心跳 ${view.heartbeats.length}、遥测 ${view.telemetry.length}、回执 ${view.acknowledgements.length}`}
        showIcon
        type="info"
      />
    </section>
  );
}
