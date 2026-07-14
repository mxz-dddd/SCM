import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Col, Row, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface ContractRow {
  code: string;
  contractType: string;
  currency: string;
  id: string;
  name: string;
  status: string;
  version: number;
}

interface RateVersionRow {
  baseRate: string;
  currency: string;
  effectiveFrom: string;
  effectiveUntil: string;
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  version: number;
  versionNumber: number;
}

interface ContractDetail extends ContractRow {
  versions: RateVersionRow[];
}

interface CalendarRow {
  code: string;
  id: string;
  name: string;
  status: string;
  timeZone: string;
  versionNumber: number;
}

interface QualityIssueRow {
  code: string;
  id: string;
  message: string;
  severity: string;
  status: string;
}

interface QualityRow {
  fulfillmentEligible: boolean;
  id: string;
  issues: QualityIssueRow[];
  objectId: string;
  objectType: string;
  score: string;
  status: string;
  threshold: string;
}

const rateActions = createActionRegistry<RateVersionRow['status'] | 'NONE'>([
  {
    allowedStatuses: ['DRAFT'],
    confirmMessage: '发布后费率版本不可修改，确认继续？',
    id: 'PUBLISHED',
    label: '发布费率版本',
    requiredPermissions: ['mdm.contract.approve'],
  },
  {
    allowedStatuses: ['PUBLISHED'],
    confirmMessage: '退役后该费率不再用于新的业务匹配。',
    id: 'RETIRED',
    label: '退役费率版本',
    requiredPermissions: ['mdm.contract.approve'],
  },
]);

export function MdmGovernanceWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [contracts, setContracts] = useState<readonly ContractRow[]>([]);
  const [calendars, setCalendars] = useState<readonly CalendarRow[]>([]);
  const [quality, setQuality] = useState<readonly QualityRow[]>([]);
  const [contractStatus, setContractStatus] = useState('');
  const [selectedContractIds, setSelectedContractIds] = useState<readonly string[]>([]);
  const [selectedRateIds, setSelectedRateIds] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<ContractDetail>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const permissions = useMemo(
    () => new Set(claims ? ['mdm.contract.read', 'mdm.contract.approve'] : []),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用主数据治理工作台');
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
      if (!response.ok)
        throw new Error(`${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '请求失败'}`);
      return body;
    },
    [accessToken, claims],
  );

  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    try {
      const [contractRows, calendarRows, qualityRows] = await Promise.all([
        request('/api/v1/mdm/contracts'),
        request('/api/v1/mdm/calendars'),
        request('/api/v1/mdm/quality-assessments'),
      ]);
      setContracts(contractRows as unknown as ContractRow[]);
      setCalendars(calendarRows as unknown as CalendarRow[]);
      setQuality(qualityRows as unknown as QualityRow[]);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '治理数据查询失败');
    }
  }, [accessToken, claims, request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function loadContract(id: string) {
    try {
      setDetail(await request(`/api/v1/mdm/contracts/${id}`) as unknown as ContractDetail);
      setSelectedRateIds([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '合同详情查询失败');
    }
  }

  const selectedRate = detail?.versions.find(({ id }) => id === selectedRateIds[0]);
  const decisions = rateActions
    .list()
    .map(({ id }) =>
      rateActions.decide(id, {
        dataScopeAllowed: true,
        permissions,
        status: selectedRate?.status ?? 'NONE',
      }),
    );

  async function executeRate(target: string) {
    const decision = decisions.find(({ id }) => id === target);
    if (!selectedRate || !decision?.enabled) return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage)) return;
    try {
      await request(`/api/v1/mdm/rate-versions/${selectedRate.id}/${target}`, {
        body: JSON.stringify({ expectedVersion: selectedRate.version }),
        method: 'POST',
      });
      setNotice(target === 'PUBLISHED' ? '费率版本已发布' : '费率版本已退役');
      if (detail) await loadContract(detail.id);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '费率版本动作失败');
    }
  }

  const filteredContracts = contractStatus
    ? contracts.filter(({ status }) => status === contractStatus)
    : contracts;
  const issues = quality.flatMap(({ id: assessmentId, issues: rows }) =>
    rows.map((issue) => ({ ...issue, assessmentId })),
  );

  return (
    <section className="mdm-governance-workbench">
      <Typography.Title level={2}>合同、费率与主数据治理</Typography.Title>
      <Typography.Paragraph>
        合同固化伙伴快照并关联统一审批；已发布费率和营业日历不可变，外部编码映射按版本追溯，质量不达标的数据不会进入履约。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <Card title="合同与费率版本">
        <QueryPanel
          fields={[{ label: '合同状态', name: 'status', quick: true }]}
          onQuery={(values) => setContractStatus(values.status ?? '')}
          onReset={() => setContractStatus('')}
        />
        <DataGrid
          columns={[
            { key: 'code', label: '合同代码' },
            { key: 'name', label: '名称' },
            { key: 'contractType', label: '合同类型' },
            { key: 'currency', label: '币种' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => {
            const next = ids.slice(-1);
            setSelectedContractIds(next);
            if (next[0]) void loadContract(next[0]);
          }}
          page={1}
          pageSize={300}
          rows={filteredContracts}
          selectedIds={selectedContractIds}
          total={filteredContracts.length}
        />
        <CommandBar actions={decisions} onAction={({ id }) => void executeRate(id)} />
        <DataGrid
          columns={[
            { key: 'versionNumber', label: '费率版本' },
            { key: 'baseRate', label: '基础价格' },
            { key: 'currency', label: '币种' },
            { key: 'effectiveFrom', label: '生效时间' },
            { key: 'effectiveUntil', label: '失效时间' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => setSelectedRateIds(ids.slice(-1))}
          page={1}
          pageSize={300}
          rows={detail?.versions ?? []}
          selectedIds={selectedRateIds}
          total={detail?.versions.length ?? 0}
        />
      </Card>
      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Card title="营业日历、班次与截单窗口">
            <DataGrid
              columns={[
                { key: 'code', label: '日历代码' },
                { key: 'name', label: '名称' },
                { key: 'timeZone', label: '时区' },
                { key: 'versionNumber', label: '版本' },
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
              rows={calendars}
              selectedIds={[]}
              total={calendars.length}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="质量评估与履约资格">
            <DataGrid
              columns={[
                { key: 'objectType', label: '对象类型' },
                { key: 'score', label: '质量分' },
                { key: 'threshold', label: '门槛' },
                { key: 'fulfillmentEligible', label: '履约可用' },
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
              rows={quality}
              selectedIds={[]}
              total={quality.length}
            />
          </Card>
        </Col>
        <Col span={24}>
          <Card title="质量问题与外部编码版本追溯">
            <Typography.Paragraph>
              ExternalCodeMap 支持伙伴、商品、仓库、车型、车辆和司机；同一外部代码的历史映射保留版本。
            </Typography.Paragraph>
            <DataGrid
              columns={[
                { key: 'assessmentId', label: '评估 ID' },
                { key: 'code', label: '问题代码' },
                { key: 'severity', label: '级别' },
                { key: 'message', label: '说明' },
                { key: 'status', label: '状态' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={issues}
              selectedIds={[]}
              total={issues.length}
            />
          </Card>
        </Col>
      </Row>
    </section>
  );
}
