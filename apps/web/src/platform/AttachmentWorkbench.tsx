import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CommandBar,
  DataGrid,
  QueryPanel,
  StatusBadge,
  createActionRegistry,
} from '@scm/ui';
import { Alert, Button, Card, Checkbox, Input, Space, Typography } from 'antd';
import { useSessionStore } from './session-store';

type AttachmentStatus =
  | 'AVAILABLE'
  | 'EXPIRED'
  | 'PENDING_UPLOAD'
  | 'QUARANTINED'
  | 'REJECTED'
  | 'SCANNING';

interface AttachmentRow {
  contentVersion: number;
  contentType: string;
  createdAt: string;
  id: string;
  originalName: string;
  scanStatus: string;
  sensitive: boolean;
  sizeBytes: string;
  status: AttachmentStatus;
  version: number;
}

const actions = createActionRegistry<AttachmentStatus>([
  {
    confirmMessage: '确认将本次扫描结果登记为安全？',
    id: 'mark-clean',
    label: '扫描通过',
    requiredPermissions: ['platform.attachment.scan'],
    allowedStatuses: ['SCANNING'],
  },
  {
    confirmMessage: '确认隔离该附件并禁止下载？',
    id: 'quarantine',
    label: '发现病毒并隔离',
    requiredPermissions: ['platform.attachment.scan'],
    allowedStatuses: ['SCANNING'],
  },
  {
    id: 'download',
    label: '授权下载',
    requiredPermissions: ['platform.attachment.download'],
    allowedStatuses: ['AVAILABLE'],
  },
]);

export function AttachmentWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const fileInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<readonly AttachmentRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Readonly<Record<string, string>>>({});
  const [businessRef, setBusinessRef] = useState('DEMO-OBJECT-001');
  const [objectId, setObjectId] = useState(
    '10000000-0000-4000-8000-000000000099',
  );
  const [sensitive, setSensitive] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const permissions = useMemo(
    () =>
      new Set(
        claims && claims.accountKind !== 'USER'
          ? [
              'platform.attachment.read',
              'platform.attachment.write',
              'platform.attachment.scan',
              'platform.attachment.download',
            ]
          : [],
      ),
    [claims],
  );

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken || !claims) throw new Error('请先登录后管理附件');
      const response = await fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
          'X-Tenant-Id': claims.tenantId,
          ...(init?.method === 'POST'
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
      ...Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value.trim()),
      ),
    });
    try {
      const body = (await request(
        `/api/v1/platform/attachments?${parameters}`,
      )) as unknown as { items: AttachmentRow[]; total: number };
      setRows(body.items);
      setTotal(body.total);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '附件查询失败');
    }
  }, [accessToken, claims, filters, page, request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = rows.find(({ id }) => id === selectedIds[0]);
  const decisions = (['mark-clean', 'quarantine', 'download'] as const).map(
    (id) =>
      actions.decide(id, {
        dataScopeAllowed: true,
        permissions,
        status: selected?.status ?? 'PENDING_UPLOAD',
      }),
  );

  async function upload(file: File) {
    if (!claims) return;
    setBusy(true);
    try {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        await file.arrayBuffer(),
      );
      const checksum = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      const created = (await request('/api/v1/platform/attachments/uploads', {
        body: JSON.stringify({
          checksumSha256: checksum,
          contentType: file.type || 'text/plain',
          link: {
            businessDomain: 'OMS',
            businessRef,
            objectId,
            objectType: 'ORDER',
            ...(claims.organizationIds[0]
              ? { organizationId: claims.organizationIds[0] }
              : {}),
          },
          originalName: file.name,
          sensitive,
          sizeBytes: file.size,
        }),
        method: 'POST',
      })) as unknown as {
        fileObjectId: string;
        headers: Record<string, string>;
        uploadUrl: string;
        version: number;
      };
      const uploaded = await fetch(created.uploadUrl, {
        body: file,
        headers: created.headers,
        method: 'PUT',
      });
      if (!uploaded.ok) throw new Error('对象存储上传失败');
      await request(
        `/api/v1/platform/attachments/${created.fileObjectId}/uploads/complete`,
        {
          body: JSON.stringify({ expectedVersion: created.version }),
          method: 'POST',
        },
      );
      setNotice('上传完成，已进入病毒扫描队列');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '附件上传失败');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function recordScan(result: 'CLEAN' | 'INFECTED') {
    if (!selected) return;
    try {
      await request(
        `/api/v1/platform/attachments/${selected.id}/scan-results`,
        {
          body: JSON.stringify({
            engine: 'manual-verification-hook',
            engineVersion: '1',
            expectedVersion: selected.version,
            result,
          }),
          method: 'POST',
        },
      );
      setNotice(result === 'CLEAN' ? '附件已开放下载' : '附件已隔离');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '扫描回写失败');
    }
  }

  async function download() {
    if (!selected || !accessToken || !claims) return;
    try {
      const grant = (await request(
        `/api/v1/platform/attachments/${selected.id}/downloads`,
        {
          body: JSON.stringify({ expectedVersion: selected.version }),
          method: 'POST',
        },
      )) as unknown as { downloadUrl: string; sensitive: boolean };
      if (!grant.sensitive) {
        window.open(grant.downloadUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      const response = await fetch(grant.downloadUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Correlation-Id': crypto.randomUUID(),
          'X-Tenant-Id': claims.tenantId,
        },
      });
      if (!response.ok) throw new Error('水印下载失败');
      const url = URL.createObjectURL(await response.blob());
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '下载授权失败');
    }
  }

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (!decision?.enabled) return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage))
      return;
    if (actionId === 'mark-clean') await recordScan('CLEAN');
    if (actionId === 'quarantine') await recordScan('INFECTED');
    if (actionId === 'download') await download();
  }

  return (
    <section className="attachment-workbench">
      <Typography.Title level={2}>附件与对象存储</Typography.Title>
      <Typography.Paragraph>
        预签名直传、病毒扫描隔离、跨域对象引用与敏感附件水印下载。
      </Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}

      <Card title="上传并关联业务对象">
        <Space wrap>
          <Input
            aria-label="业务引用"
            onChange={(event) => setBusinessRef(event.target.value)}
            value={businessRef}
          />
          <Input
            aria-label="业务对象ID"
            onChange={(event) => setObjectId(event.target.value)}
            value={objectId}
          />
          <Checkbox
            checked={sensitive}
            onChange={(event) => setSensitive(event.target.checked)}
          >
            敏感附件（水印下载）
          </Checkbox>
          <input
            aria-label="选择附件"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
            ref={fileInput}
            type="file"
          />
          <Button
            disabled={!permissions.has('platform.attachment.write') || busy}
            loading={busy}
            onClick={() => fileInput.current?.click()}
            type="primary"
          >
            选择并上传
          </Button>
        </Space>
      </Card>

      <Card title="附件清单">
        <QueryPanel
          expanded
          fields={[
            { label: '文件名', name: 'search', quick: true },
            { label: '状态', name: 'status', quick: true },
            { label: '业务域', name: 'businessDomain' },
            { label: '业务对象ID', name: 'objectId' },
          ]}
          onQuery={(values) => {
            setFilters(values);
            setPage(1);
          }}
          onReset={() => setFilters({})}
        />
        <CommandBar
          actions={decisions}
          onAction={({ id }) => void execute(id)}
        />
        <DataGrid
          columns={[
            { fixed: 'left', key: 'originalName', label: '文件名' },
            { key: 'contentType', label: '类型' },
            { key: 'sizeBytes', label: '字节数' },
            { key: 'contentVersion', label: '内容版本' },
            {
              key: 'status',
              label: '状态',
              render: (value) => <StatusBadge status={String(value)} />,
            },
            { key: 'scanStatus', label: '扫描结果' },
            {
              key: 'sensitive',
              label: '敏感',
              render: (value) => (value ? '是' : '否'),
            },
            { fixed: 'right', key: 'version', label: '版本' },
          ]}
          onPageChange={setPage}
          onSelectionChange={(ids) => setSelectedIds(ids.slice(-1))}
          page={page}
          pageSize={20}
          rows={rows}
          selectedIds={selectedIds}
          total={total}
        />
      </Card>
    </section>
  );
}
