import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Card, Col, Descriptions, Drawer, Row, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface ProductRow {
  baseUom: string;
  currentVersionNumber: number;
  id: string;
  name: string;
  sku: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  temperatureZone: string;
  version: number;
}

interface BarcodeRow {
  barcode: string;
  customerId: string | null;
  id: string;
  status: string;
  type: string;
}
interface PackageRow {
  code: string;
  customerId: string | null;
  id: string;
  level: string;
  name: string;
  originalUom: string;
  quantityInBase: string;
  status: string;
  versionNumber: number;
}
interface VersionRow {
  id: string;
  publishedAt: string;
  status: string;
  versionNumber: number;
}
interface ProductDetail extends ProductRow {
  barcodes: BarcodeRow[];
  packageSpecs: PackageRow[];
  versions: VersionRow[];
}

const actions = createActionRegistry<ProductRow['status'] | 'NONE'>([
  {
    allowedStatuses: ['DRAFT', 'ACTIVE'],
    id: 'edit',
    label: '编辑商品',
    requiredPermissions: ['mdm.product.write'],
  },
  {
    allowedStatuses: ['DRAFT', 'ACTIVE'],
    confirmMessage:
      '发布后将生成不可变 ProductVersion，并固化当前包装与条码快照。',
    id: 'publish',
    label: '发布新版本',
    requiredPermissions: ['mdm.product.publish'],
  },
  {
    allowedStatuses: ['ACTIVE'],
    confirmMessage: '停用后该商品不能再被新业务引用。',
    id: 'deactivate',
    label: '停用商品',
    requiredPermissions: ['mdm.product.write'],
  },
]);

export function ProductWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [products, setProducts] = useState<readonly ProductRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<ProductDetail>();
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? ['mdm.product.read', 'mdm.product.write', 'mdm.product.publish']
          : [],
      ),
    [claims],
  );
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用商品主数据工作台');
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
      const rows = await request(
        `/api/v1/mdm/products${status ? `?status=${status}` : ''}`,
      );
      setProducts(rows as unknown as ProductRow[]);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '商品查询失败');
    }
  }, [accessToken, claims, request, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  const selected = products.find(({ id }) => id === selectedIds[0]);
  const decisions = actions.list().map(({ id }) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: selected?.status ?? 'NONE',
    }),
  );

  async function loadDetail(id: string) {
    try {
      setDetail(
        (await request(
          `/api/v1/mdm/products/${id}`,
        )) as unknown as ProductDetail,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '商品详情查询失败');
    }
  }

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (!selected || !decision?.enabled || actionId === 'edit') return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage))
      return;
    try {
      await request(
        `/api/v1/mdm/products/${selected.id}/${actionId === 'publish' ? 'publish' : 'deactivate'}`,
        {
          body: JSON.stringify({ expectedVersion: selected.version }),
          method: 'POST',
        },
      );
      setNotice(
        actionId === 'publish'
          ? '商品版本已发布，历史快照保持不可变'
          : '商品已停用',
      );
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '商品动作失败');
    }
  }

  return (
    <section className="product-workbench">
      <Typography.Title level={2}>商品、条码与包装主数据</Typography.Title>
      <Typography.Paragraph>
        商品发布生成 ProductVersion 快照；PackageSpec 版本保存原单位、基础单位和
        Decimal 换算率，历史业务始终引用当时版本。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <Card title="商品目录">
        <QueryPanel
          fields={[{ label: '商品状态', name: 'status', quick: true }]}
          onQuery={(values) => setStatus(values.status ?? '')}
          onReset={() => setStatus('')}
        />
        <CommandBar
          actions={decisions}
          onAction={(action) => void execute(action.id)}
        />
        <DataGrid
          columns={[
            { key: 'sku', label: 'SKU' },
            { key: 'name', label: '商品名称' },
            { key: 'baseUom', label: '基础单位' },
            { key: 'temperatureZone', label: '温层' },
            { key: 'currentVersionNumber', label: '主数据版本' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          onSelectionChange={(ids) => {
            const next = ids.slice(-1);
            setSelectedIds(next);
            if (next[0]) void loadDetail(next[0]);
          }}
          page={1}
          pageSize={300}
          rows={products}
          selectedIds={selectedIds}
          total={products.length}
        />
      </Card>
      <Drawer
        destroyOnClose
        onClose={() => setDetail(undefined)}
        open={Boolean(detail)}
        title={detail ? `${detail.sku} · ${detail.name}` : '商品详情'}
        width={820}
      >
        {detail ? (
          <>
            <Descriptions
              column={2}
              items={[
                { key: 'status', label: '状态', children: detail.status },
                {
                  key: 'version',
                  label: '乐观锁版本',
                  children: detail.version,
                },
                { key: 'uom', label: '基础单位', children: detail.baseUom },
                {
                  key: 'snapshot',
                  label: '已发布版本',
                  children: detail.currentVersionNumber,
                },
              ]}
            />
            <Row gutter={[16, 16]}>
              <Col span={24}>
                <Card size="small" title="PackageSpec 包装版本">
                  <DataGrid
                    columns={[
                      { key: 'code', label: '包装代码' },
                      { key: 'name', label: '名称' },
                      { key: 'level', label: '层级' },
                      { key: 'quantityInBase', label: '基础单位数量' },
                      { key: 'versionNumber', label: '版本' },
                      { key: 'status', label: '状态' },
                    ]}
                    onPageChange={() => undefined}
                    onSelectionChange={() => undefined}
                    page={1}
                    pageSize={100}
                    rows={detail.packageSpecs}
                    selectedIds={[]}
                    total={detail.packageSpecs.length}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" title="条码与客户作用域">
                  <DataGrid
                    columns={[
                      { key: 'barcode', label: '条码' },
                      { key: 'type', label: '类型' },
                      { key: 'status', label: '状态' },
                    ]}
                    onPageChange={() => undefined}
                    onSelectionChange={() => undefined}
                    page={1}
                    pageSize={100}
                    rows={detail.barcodes}
                    selectedIds={[]}
                    total={detail.barcodes.length}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" title="ProductVersion 快照">
                  <DataGrid
                    columns={[
                      { key: 'versionNumber', label: '版本' },
                      { key: 'publishedAt', label: '发布时间' },
                      { key: 'status', label: '状态' },
                    ]}
                    onPageChange={() => undefined}
                    onSelectionChange={() => undefined}
                    page={1}
                    pageSize={100}
                    rows={detail.versions}
                    selectedIds={[]}
                    total={detail.versions.length}
                  />
                </Card>
              </Col>
            </Row>
          </>
        ) : null}
      </Drawer>
    </section>
  );
}
