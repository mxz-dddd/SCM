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

interface SearchRow {
  businessDomain: string;
  businessRef: string;
  businessStatus: string;
  id: string;
  occurredAt: string;
  partnerName: string | null;
  productName: string | null;
}

interface ImportRow {
  errorRows: number;
  fileName: string;
  id: string;
  importType: string;
  status: string;
  totalRows: number;
  validRows: number;
  version: number;
}

interface ExportRow {
  expiresAt: string | null;
  id: string;
  resourceType: string;
  rowCount: number;
  status: string;
  version: number;
}

const actions = createActionRegistry<string>([
  {
    asynchronous: true,
    id: 'import',
    label: '创建导入预检',
    requiredPermissions: ['platform.import.write'],
  },
  {
    asynchronous: true,
    id: 'export',
    label: '导出当前视图',
    requiredPermissions: ['platform.export.create'],
  },
]);

export function DataExchangeWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [searchRows, setSearchRows] = useState<readonly SearchRow[]>([]);
  const [imports, setImports] = useState<readonly ImportRow[]>([]);
  const [exports, setExports] = useState<readonly ExportRow[]>([]);
  const [filters, setFilters] = useState<Readonly<Record<string, string>>>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [fileObjectId, setFileObjectId] = useState('');
  const [viewName, setViewName] = useState('我的业务搜索');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const permissions = useMemo(
    () =>
      new Set(
        claims
          ? claims.accountKind === 'USER'
            ? [
                'platform.search.read',
                'platform.saved-view.read',
                'platform.saved-view.write',
                'platform.export.create',
                'platform.export.read',
              ]
            : [
                'platform.import.read',
                'platform.import.write',
                'platform.export.read',
                'platform.export.create',
                'platform.export.download',
                'platform.search.read',
                'platform.saved-view.read',
                'platform.saved-view.write',
              ]
          : [],
      ),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims)
        throw new Error('请先登录后使用数据交换中心');
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

  const refreshJobs = useCallback(async () => {
    if (!accessToken || !claims) return;
    try {
      const exportResponse = await request('/api/v1/platform/exports');
      setExports(exportResponse as unknown as ExportRow[]);
      if (claims.accountKind !== 'USER') {
        const importResponse = await request('/api/v1/platform/imports');
        setImports(importResponse as unknown as ImportRow[]);
      }
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '任务查询失败');
    }
  }, [accessToken, claims, request]);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  async function search(values = filters, targetPage = page) {
    const parameters = new URLSearchParams({
      page: String(targetPage),
      pageSize: '20',
      ...Object.fromEntries(
        Object.entries(values).filter(([, value]) => value.trim()),
      ),
    });
    try {
      const response = (await request(
        `/api/v1/platform/search?${parameters}`,
      )) as unknown as { items: SearchRow[]; total: number };
      setSearchRows(response.items);
      setTotal(response.total);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '统一搜索失败');
    }
  }

  async function saveView() {
    try {
      await request('/api/v1/platform/saved-views', {
        body: JSON.stringify({
          columns: ['businessRef', 'businessDomain', 'businessStatus'].map(
            (key) => ({ key }),
          ),
          filters,
          name: viewName,
          resourceType: 'UNIFIED_SEARCH',
          sort: [{ direction: 'desc', field: 'occurredAt' }],
          visibility: 'PERSONAL',
        }),
        method: 'POST',
      });
      setNotice('个人视图已保存');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '视图保存失败');
    }
  }

  async function createImport() {
    try {
      await request('/api/v1/platform/imports', {
        body: JSON.stringify({
          columnRules: [
            { name: 'businessRef', required: true, type: 'STRING' },
            { name: 'status', required: true, type: 'STRING' },
          ],
          fileObjectId,
          importType: 'BUSINESS_OBJECT',
          uniqueColumns: ['businessRef'],
        }),
        method: 'POST',
      });
      setNotice('导入任务已上传，等待预检');
      await refreshJobs();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导入创建失败');
    }
  }

  async function createExport() {
    try {
      await request('/api/v1/platform/exports', {
        body: JSON.stringify({
          columns: [
            'id',
            'createdAt',
            'title',
            'businessDomain',
            'businessRef',
            'status',
          ],
          filters,
          resourceType: 'INBOX',
          sort: [{ direction: 'desc', field: 'createdAt' }],
        }),
        method: 'POST',
      });
      setNotice('导出任务已进入异步队列');
      await refreshJobs();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导出创建失败');
    }
  }

  const decisions = ['import', 'export'].map((id) =>
    actions.decide(id, {
      dataScopeAllowed: true,
      permissions,
      status: 'READY',
    }),
  );

  return (
    <section className="data-exchange-workbench">
      <Typography.Title level={2}>导入导出与统一搜索</Typography.Title>
      <Typography.Paragraph>
        CSV / XLSX 逐行预检、异步脱敏导出、受限下载，以及个人和共享查询视图。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}

      <Card title="统一搜索与 SavedView">
        <QueryPanel
          expanded
          fields={[
            { label: '业务号 / 外部号 / 伙伴 / 产品', name: 'q', quick: true },
            { label: '业务域', name: 'businessDomain', quick: true },
            { label: '状态', name: 'status' },
            { label: '开始时间', name: 'from', type: 'date' },
            { label: '结束时间', name: 'to', type: 'date' },
          ]}
          onQuery={(values) => {
            setFilters(values);
            setPage(1);
            void search(values, 1);
          }}
          onReset={() => {
            setFilters({});
            setSearchRows([]);
          }}
          onSaveView={() => void saveView()}
        />
        <Space wrap>
          <Input
            aria-label="视图名称"
            onChange={(event) => setViewName(event.target.value)}
            value={viewName}
          />
          <Button onClick={() => void saveView()}>保存个人视图</Button>
        </Space>
        <DataGrid
          columns={[
            { fixed: 'left', key: 'businessRef', label: '业务号' },
            { key: 'businessDomain', label: '业务域' },
            { key: 'partnerName', label: '伙伴' },
            { key: 'productName', label: '产品' },
            {
              key: 'businessStatus',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { fixed: 'right', key: 'occurredAt', label: '业务时间' },
          ]}
          onExportView={() => void createExport()}
          onPageChange={(nextPage) => {
            setPage(nextPage);
            void search(filters, nextPage);
          }}
          page={page}
          pageSize={20}
          rows={searchRows}
          total={total}
        />
      </Card>

      <Card title="导入预检与逐行回执">
        <Space wrap>
          <Input
            aria-label="已扫描附件 ID"
            onChange={(event) => setFileObjectId(event.target.value)}
            placeholder="先在附件中心上传 CSV / XLSX"
            value={fileObjectId}
          />
          <CommandBar
            actions={[decisions[0]!]}
            onAction={() => void createImport()}
          />
        </Space>
        <DataGrid
          columns={[
            { key: 'fileName', label: '文件' },
            { key: 'importType', label: '导入类型' },
            { key: 'totalRows', label: '总行数' },
            { key: 'validRows', label: '有效行' },
            { key: 'errorRows', label: '错误行' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={100}
          rows={imports}
          total={imports.length}
        />
      </Card>

      <Card title="异步脱敏导出与限时下载">
        <CommandBar
          actions={[decisions[1]!]}
          onAction={() => void createExport()}
        />
        <DataGrid
          columns={[
            { key: 'resourceType', label: '资源' },
            { key: 'rowCount', label: '结果数' },
            { key: 'expiresAt', label: '有效期' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
          ]}
          onPageChange={() => undefined}
          page={1}
          pageSize={100}
          rows={exports}
          total={exports.length}
        />
      </Card>
    </section>
  );
}
