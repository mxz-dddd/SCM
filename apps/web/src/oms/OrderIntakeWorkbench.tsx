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

interface OrderRow {
  channel: string;
  externalOrderNo: string | null;
  id: string;
  orderNo: string;
  status: 'DRAFT' | 'INVALID' | 'OPEN';
  type: string;
  validationErrors: readonly { field: string; message: string }[];
  version: number;
}

interface OrderLineRow {
  baseUom: string | null;
  id: string;
  lineNo: number;
  originalUom: string | null;
  quantityBase: string | null;
  quantityOriginal: string | null;
}

interface OrderVersionRow {
  changeReason: string;
  createdAt: string;
  id: string;
  versionNumber: number;
}

interface DuplicateCaseRow {
  createdAt: string;
  externalOrderNo: string;
  id: string;
  status: string;
}

interface OrderDetail extends OrderRow {
  duplicateCases: DuplicateCaseRow[];
  lines: OrderLineRow[];
  versions: OrderVersionRow[];
}

interface ListResponse {
  items: OrderRow[];
  page: number;
  pageSize: number;
  total: number;
}

const actions = createActionRegistry<OrderRow['status'] | 'NONE'>([
  {
    allowedStatuses: ['DRAFT', 'INVALID', 'OPEN', 'NONE'],
    id: 'create-manual',
    label: '新建人工草稿',
    requiredPermissions: ['oms.order.write'],
  },
  {
    allowedStatuses: ['DRAFT', 'INVALID'],
    confirmMessage: '提交后将执行字段与业务规则校验。',
    id: 'submit',
    label: '校验并提交',
    requiredPermissions: ['oms.order.submit'],
  },
  {
    allowedStatuses: ['INVALID'],
    confirmMessage: '仅警告可被强制通过；字段错误仍会阻止订单打开。',
    id: 'submit-with-warnings',
    label: '强制通过警告',
    requiredPermissions: ['oms.order.warning.override'],
  },
]);

export function OrderIntakeWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [response, setResponse] = useState<ListResponse>({
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
  });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<OrderDetail>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? [
              'oms.order.read',
              'oms.order.write',
              'oms.order.submit',
              'oms.order.warning.override',
            ]
          : [],
      ),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后使用订单接入工作台');
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

  const refresh = useCallback(
    async (page = 1) => {
      if (!accessToken || !claims) return;
      const query = new URLSearchParams({ page: String(page), pageSize: '50' });
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
      try {
        setResponse(
          (await request(`/api/v1/oms/orders?${query.toString()}`)) as unknown as ListResponse,
        );
        setError(undefined);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '订单查询失败');
      }
    },
    [accessToken, claims, filters, request],
  );

  useEffect(() => {
    void refresh(1);
  }, [refresh]);

  async function loadDetail(id: string) {
    try {
      setDetail(await request(`/api/v1/oms/orders/${id}`) as unknown as OrderDetail);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '订单详情查询失败');
    }
  }

  const selected = response.items.find(({ id }) => id === selectedIds[0]);
  const decisions = actions
    .list()
    .map(({ id }) =>
      actions.decide(id, {
        dataScopeAllowed: true,
        permissions,
        status: selected?.status ?? 'NONE',
      }),
    );

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (!decision?.enabled) return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage)) return;
    try {
      if (actionId === 'create-manual') {
        await request('/api/v1/oms/orders', {
          body: JSON.stringify({
            channel: 'MANUAL',
            lines: [],
            mappingVersion: 'manual-v1',
            rawPayload: { capturedAt: new Date().toISOString(), source: 'MANUAL' },
            type: 'SALES',
          }),
          method: 'POST',
        });
        setNotice('人工订单草稿已创建，可通过 API 或后续编辑补充字段');
      } else if (selected) {
        const result = (await request(`/api/v1/oms/orders/${selected.id}/${actionId}`, {
          body: JSON.stringify({ expectedVersion: selected.version }),
          method: 'POST',
        })) as unknown as { accepted: boolean; fieldErrors: unknown[]; status: string };
        setNotice(
          result.accepted
            ? '订单校验通过并已打开'
            : `订单仍为 ${result.status}，发现 ${result.fieldErrors.length} 个字段错误`,
        );
      }
      await refresh(1);
      if (selected) await loadDetail(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '订单动作失败');
    }
  }

  return (
    <section className="order-intake-workbench">
      <Typography.Title level={2}>多渠道订单接入</Typography.Title>
      <Typography.Paragraph>
        API、EDI、文件、门户和人工订单统一进入草稿模型；原始报文、映射版本、外部编号冲突、字段错误和每次变更版本均可追溯。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <Card title="订单草稿与外部编号">
        <QueryPanel
          fields={[
            { label: '订单号 / 外部单号', name: 'query', quick: true },
            { label: '状态', name: 'status', quick: true },
            { label: '渠道', name: 'channel' },
          ]}
          onQuery={(values) => setFilters(values)}
          onReset={() => setFilters({})}
        />
        <CommandBar actions={decisions} onAction={({ id }) => void execute(id)} />
        <DataGrid
          columns={[
            { key: 'orderNo', label: '订单号' },
            { key: 'externalOrderNo', label: '外部订单号' },
            { key: 'channel', label: '渠道' },
            { key: 'type', label: '类型' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'version', label: '版本' },
          ]}
          onPageChange={(page) => void refresh(page)}
          onSelectionChange={(ids) => {
            const next = ids.slice(-1);
            setSelectedIds(next);
            if (next[0]) void loadDetail(next[0]);
          }}
          page={response.page}
          pageSize={response.pageSize}
          rows={response.items}
          selectedIds={selectedIds}
          total={response.total}
        />
      </Card>
      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Card title="字段校验与双单位数量">
            <DataGrid
              columns={[
                { key: 'lineNo', label: '行号' },
                { key: 'quantityOriginal', label: '原数量' },
                { key: 'originalUom', label: '原单位' },
                { key: 'quantityBase', label: '基础数量' },
                { key: 'baseUom', label: '基础单位' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.lines ?? []}
              selectedIds={[]}
              total={detail?.lines.length ?? 0}
            />
            {(detail?.validationErrors ?? []).map(({ field, message }) => (
              <Alert key={`${field}-${message}`} message={`${field}: ${message}`} type="error" />
            ))}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="不可变 OrderVersion 与 ChangeSet">
            <DataGrid
              columns={[
                { key: 'versionNumber', label: '版本' },
                { key: 'changeReason', label: '变更原因' },
                { key: 'createdAt', label: '记录时间' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.versions ?? []}
              selectedIds={[]}
              total={detail?.versions.length ?? 0}
            />
          </Card>
        </Col>
        <Col span={24}>
          <Card title="内容冲突 DuplicateCase">
            <DataGrid
              columns={[
                { key: 'externalOrderNo', label: '外部订单号' },
                { key: 'status', label: '处置状态' },
                { key: 'createdAt', label: '发现时间' },
              ]}
              onPageChange={() => undefined}
              onSelectionChange={() => undefined}
              page={1}
              pageSize={300}
              rows={detail?.duplicateCases ?? []}
              selectedIds={[]}
              total={detail?.duplicateCases.length ?? 0}
            />
          </Card>
        </Col>
      </Row>
    </section>
  );
}
