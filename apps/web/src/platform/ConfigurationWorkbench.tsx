import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Input, Select, Space, Typography } from 'antd';
import { useSessionStore } from './session-store';

type ConfigStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
type ActionStatus = ConfigStatus | 'ACTIVE' | 'ANY' | 'INACTIVE';

interface ConfigRow {
  configKey: string;
  id: string;
  scopeRef: string;
  scopeType: 'CUSTOMER' | 'ORGANIZATION' | 'TENANT' | 'WAREHOUSE';
  status: ConfigStatus;
  version: number;
  versionNumber: number;
}

interface DictionaryRow {
  category: string;
  code: string;
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
}

interface DictionaryResponse extends Omit<DictionaryRow, 'version'> {
  items: Omit<DictionaryRow, 'category'>[];
}

interface NumberRuleRow {
  businessType: string;
  currentSequence: string;
  id: string;
  organizationRef: string;
  prefixTemplate: string;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
}

const actionRegistry = createActionRegistry<ActionStatus>([
  {
    allowedStatuses: ['DRAFT'],
    id: 'preview',
    label: '差异预览',
    requiredPermissions: ['platform.configuration.read'],
  },
  {
    id: 'create-config',
    label: '新建配置草稿',
    requiredPermissions: ['platform.configuration.write'],
  },
  {
    allowedStatuses: ['DRAFT'],
    confirmMessage: '发布前将执行依赖校验并记录差异，确认发布？',
    id: 'publish',
    label: '发布配置',
    requiredPermissions: ['platform.configuration.write'],
  },
  {
    allowedStatuses: ['RETIRED'],
    confirmMessage: '回滚会退役当前版本并重新启用所选版本，确认回滚？',
    id: 'rollback',
    label: '回滚到此版本',
    requiredPermissions: ['platform.configuration.write'],
  },
  {
    id: 'create-dictionary',
    label: '新建原因字典',
    requiredPermissions: ['platform.configuration.write'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    confirmMessage: '停用后不能再用于新业务，历史快照不受影响。确认停用？',
    id: 'deactivate-item',
    label: '停用字典项',
    requiredPermissions: ['platform.configuration.write'],
  },
  {
    allowedStatuses: ['INACTIVE'],
    id: 'activate-item',
    label: '启用字典项',
    requiredPermissions: ['platform.configuration.write'],
  },
  {
    id: 'create-number-rule',
    label: '新建单号规则',
    requiredPermissions: ['platform.configuration.write'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    id: 'reserve-sequence',
    label: '预留下一号段',
    requiredPermissions: ['platform.configuration.write'],
  },
]);

export function ConfigurationWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [configs, setConfigs] = useState<readonly ConfigRow[]>([]);
  const [dictionaryItems, setDictionaryItems] = useState<
    readonly DictionaryRow[]
  >([]);
  const [numberRules, setNumberRules] = useState<readonly NumberRuleRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [selectedDictionaryIds, setSelectedDictionaryIds] = useState<
    readonly string[]
  >([]);
  const [selectedNumberRuleIds, setSelectedNumberRuleIds] = useState<
    readonly string[]
  >([]);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [configKey, setConfigKey] = useState('fulfillment.policy');
  const [configValues, setConfigValues] = useState(
    '{"cutoffHour":18,"mode":"standard"}',
  );
  const [configScopeType, setConfigScopeType] =
    useState<ConfigRow['scopeType']>('TENANT');
  const [configScopeRef, setConfigScopeRef] = useState('');
  const [dependencyKeys, setDependencyKeys] = useState('');
  const [rolloutPercentage, setRolloutPercentage] = useState('100');
  const [dictionaryCode, setDictionaryCode] = useState('EXCEPTION_REASON');
  const [dictionaryName, setDictionaryName] = useState('异常原因');
  const [numberBusinessType, setNumberBusinessType] = useState('ORDER');
  const [numberPrefix, setNumberPrefix] = useState('{TYPE}-{YYYY}{MM}{DD}-');

  const permissions = useMemo(
    () =>
      new Set(
        !claims
          ? []
          : claims.accountKind === 'USER'
            ? ['platform.configuration.read']
            : ['platform.configuration.read', 'platform.configuration.write'],
      ),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后管理配置');
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
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: '20',
      ...(search ? { search } : {}),
    });
    try {
      const [configResponse, dictionaryResponse, numberResponse] =
        await Promise.all([
          request(
            `/api/v1/platform/configuration/config-versions?${parameters}`,
          ),
          request('/api/v1/platform/configuration/dictionaries'),
          request('/api/v1/platform/configuration/number-rules'),
        ]);
      const configPage = configResponse as unknown as {
        items: ConfigRow[];
        total: number;
      };
      setConfigs(configPage.items);
      setTotal(configPage.total);
      setDictionaryItems(
        (dictionaryResponse as unknown as DictionaryResponse[]).flatMap(
          (dictionary) =>
            dictionary.items.map((item) => ({
              ...item,
              category: dictionary.code,
            })),
        ),
      );
      setNumberRules(numberResponse as unknown as NumberRuleRow[]);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '配置加载失败');
    }
  }, [accessToken, claims, page, request, search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = configs.find(({ id }) => id === selectedIds[0]);
  const selectedDictionaryItem = dictionaryItems.find(
    ({ id }) => id === selectedDictionaryIds[0],
  );
  const selectedNumberRule = numberRules.find(
    ({ id }) => id === selectedNumberRuleIds[0],
  );
  const actionStatus = (id: string): ActionStatus => {
    if (id === 'activate-item' || id === 'deactivate-item') {
      return selectedDictionaryItem?.status ?? 'ANY';
    }
    if (id === 'reserve-sequence') {
      return selectedNumberRule?.status ?? 'ANY';
    }
    return selected?.status ?? 'ANY';
  };
  const decide = (id: string) =>
    actionRegistry.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: actionStatus(id),
    });

  async function execute(id: string) {
    setError(undefined);
    try {
      const action = decide(id);
      if (!action.enabled) return;
      if (action.confirmMessage && !window.confirm(action.confirmMessage))
        return;
      if (id === 'create-config') {
        const values = JSON.parse(configValues) as unknown;
        if (!values || typeof values !== 'object' || Array.isArray(values)) {
          throw new Error('配置值必须是 JSON 对象');
        }
        await request('/api/v1/platform/configuration/config-versions', {
          body: JSON.stringify({
            configKey,
            dependencyKeys: dependencyKeys
              .split(',')
              .map((key) => key.trim())
              .filter(Boolean),
            ...(configScopeType === 'TENANT'
              ? {}
              : { scopeRef: configScopeRef }),
            scopeType: configScopeType,
            values,
          }),
          method: 'POST',
        });
      } else if (id === 'create-dictionary') {
        await request('/api/v1/platform/configuration/dictionaries', {
          body: JSON.stringify({
            category: 'REASON',
            code: dictionaryCode,
            items: [
              {
                code: 'OTHER',
                name: '其他',
                requiresRemark: true,
              },
            ],
            name: dictionaryName,
          }),
          method: 'POST',
        });
      } else if (id === 'create-number-rule') {
        await request('/api/v1/platform/configuration/number-rules', {
          body: JSON.stringify({
            blockSize: 100,
            businessType: numberBusinessType,
            prefixTemplate: numberPrefix,
            resetPeriod: 'DAILY',
            sequenceWidth: 6,
          }),
          method: 'POST',
        });
      } else if (id === 'preview' && selected) {
        const preview = (await request(
          `/api/v1/platform/configuration/config-versions/${selected.id}/preview`,
        )) as unknown as {
          difference: {
            added: string[];
            changed: string[];
            removed: string[];
          };
        };
        setNotice(
          `差异：新增 ${preview.difference.added.length}、修改 ${preview.difference.changed.length}、删除 ${preview.difference.removed.length}`,
        );
        return;
      } else if (
        (id === 'activate-item' || id === 'deactivate-item') &&
        selectedDictionaryItem
      ) {
        await request(
          `/api/v1/platform/configuration/dictionary-items/${selectedDictionaryItem.id}/status`,
          {
            body: JSON.stringify({
              expectedVersion: selectedDictionaryItem.version,
              status: id === 'activate-item' ? 'ACTIVE' : 'INACTIVE',
            }),
            method: 'POST',
          },
        );
      } else if (id === 'reserve-sequence' && selectedNumberRule) {
        const reservation = (await request(
          `/api/v1/platform/configuration/number-rules/${selectedNumberRule.id}/reservations`,
          { body: '{}', method: 'POST' },
        )) as unknown as { firstNumber: string; lastNumber: string };
        setNotice(
          `已预留号段 ${reservation.firstNumber} ～ ${reservation.lastNumber}`,
        );
        await refresh();
        return;
      } else if (selected) {
        await request(
          `/api/v1/platform/configuration/config-versions/${selected.id}/${id}`,
          {
            body: JSON.stringify({
              expectedVersion: selected.version,
              ...(id === 'publish'
                ? { rolloutPercentage: Number(rolloutPercentage) }
                : {}),
            }),
            method: 'POST',
          },
        );
      }
      setNotice(`${action.label}成功`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '配置命令失败');
    }
  }

  return (
    <section className="configuration-workbench">
      <Typography.Title level={2}>配置、字典与单号中心</Typography.Title>
      <Typography.Paragraph>
        版本发布与回滚保留差异记录；停用字典不改变历史快照；单号按号段原子预留。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}

      <Card title="分层配置版本">
        <QueryPanel
          fields={[
            {
              label: '配置键',
              name: 'search',
              placeholder: 'fulfillment.policy',
              quick: true,
            },
          ]}
          onQuery={(values) => {
            setPage(1);
            setSearch(values.search ?? '');
          }}
          onReset={() => {
            setPage(1);
            setSearch('');
          }}
        />
        <Space className="configuration-create-row" wrap>
          <Input
            aria-label="配置键"
            onChange={(event) => setConfigKey(event.target.value)}
            value={configKey}
          />
          <Input
            aria-label="配置 JSON"
            onChange={(event) => setConfigValues(event.target.value)}
            value={configValues}
          />
          <Select
            aria-label="配置层级"
            onChange={setConfigScopeType}
            options={[
              { label: '租户', value: 'TENANT' },
              { label: '组织', value: 'ORGANIZATION' },
              { label: '仓库', value: 'WAREHOUSE' },
              { label: '客户', value: 'CUSTOMER' },
            ]}
            value={configScopeType}
          />
          <Input
            aria-label="配置范围 ID"
            disabled={configScopeType === 'TENANT'}
            onChange={(event) => setConfigScopeRef(event.target.value)}
            placeholder="组织/仓库/客户 UUID"
            value={configScopeRef}
          />
          <Input
            aria-label="配置依赖"
            onChange={(event) => setDependencyKeys(event.target.value)}
            placeholder="依赖配置键，逗号分隔"
            value={dependencyKeys}
          />
          <CommandBar
            actions={[decide('create-config')]}
            onAction={({ id }) => void execute(id)}
          />
        </Space>
        <Space wrap>
          <Input
            aria-label="灰度百分比"
            max={100}
            min={1}
            onChange={(event) => setRolloutPercentage(event.target.value)}
            type="number"
            value={rolloutPercentage}
          />
          <CommandBar
            actions={[decide('preview'), decide('publish'), decide('rollback')]}
            onAction={({ id }) => void execute(id)}
          />
        </Space>
        <DataGrid
          columns={[
            { fixed: 'left', key: 'configKey', label: '配置键' },
            { key: 'scopeType', label: '层级' },
            { key: 'scopeRef', label: '范围' },
            { key: 'versionNumber', label: '业务版本' },
            {
              fixed: 'right',
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={setPage}
          onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))}
          page={page}
          pageSize={20}
          rows={configs}
          selectedIds={selectedIds}
          total={total}
        />
      </Card>

      <div className="configuration-lower-grid">
        <Card title="业务字典与原因码">
          <Space direction="vertical">
            <Input
              aria-label="字典代码"
              onChange={(event) => setDictionaryCode(event.target.value)}
              value={dictionaryCode}
            />
            <Input
              aria-label="字典名称"
              onChange={(event) => setDictionaryName(event.target.value)}
              value={dictionaryName}
            />
            <CommandBar
              actions={[decide('create-dictionary')]}
              onAction={({ id }) => void execute(id)}
            />
          </Space>
          <CommandBar
            actions={[decide('deactivate-item'), decide('activate-item')]}
            onAction={({ id }) => void execute(id)}
          />
          <DataGrid
            columns={[
              { key: 'code', label: '代码' },
              { key: 'name', label: '名称' },
              { key: 'category', label: '分类' },
              { key: 'status', label: '状态' },
            ]}
            onPageChange={() => undefined}
            onSelectionChange={(ids) => setSelectedDictionaryIds(ids.slice(-1))}
            page={1}
            pageSize={20}
            rows={dictionaryItems}
            selectedIds={selectedDictionaryIds}
            total={dictionaryItems.length}
          />
        </Card>
        <Card title="单号与号段">
          <Space direction="vertical">
            <Input
              aria-label="业务类型"
              onChange={(event) => setNumberBusinessType(event.target.value)}
              value={numberBusinessType}
            />
            <Input
              aria-label="单号前缀模板"
              onChange={(event) => setNumberPrefix(event.target.value)}
              value={numberPrefix}
            />
            <CommandBar
              actions={[decide('create-number-rule')]}
              onAction={({ id }) => void execute(id)}
            />
          </Space>
          <CommandBar
            actions={[decide('reserve-sequence')]}
            onAction={({ id }) => void execute(id)}
          />
          <DataGrid
            columns={[
              { key: 'businessType', label: '业务类型' },
              { key: 'prefixTemplate', label: '格式' },
              { key: 'currentSequence', label: '当前流水' },
              { key: 'status', label: '状态' },
            ]}
            onPageChange={() => undefined}
            onSelectionChange={(ids) => setSelectedNumberRuleIds(ids.slice(-1))}
            page={1}
            pageSize={20}
            rows={numberRules}
            selectedIds={selectedNumberRuleIds}
            total={numberRules.length}
          />
        </Card>
      </div>
    </section>
  );
}
