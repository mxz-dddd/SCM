import { useCallback, useEffect, useMemo, useState } from 'react';
import { CommandBar, DataGrid, QueryPanel, StatusBadge, createActionRegistry } from '@scm/ui';
import { Alert, Card, Col, Descriptions, Drawer, Row, Typography } from 'antd';
import { useSessionStore } from '../platform/session-store';

interface PartnerRow { code: string; id: string; legalName: string; shortName: string | null; status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'; version: number }
interface RoleRow { id: string; roleType: string; status: string }
interface ContactRow { email: string | null; id: string; isPrimary: boolean; name: string; phone: string | null; status: string }
interface CertificateRow { certificateNo: string; certificateType: string; id: string; status: string; validUntil: string | null }
interface AddressRow { code: string; countryCode: string; geocodeStatus: string; id: string; rawText: string; status: string; version: number }
interface ZoneRow { code: string; id: string; name: string; status: string; zoneType: string }
interface PartnerDetail extends PartnerRow { addresses: AddressRow[]; certificates: CertificateRow[]; contacts: ContactRow[]; roles: RoleRow[]; serviceZones: ZoneRow[] }

const registry = createActionRegistry<PartnerRow['status'] | 'NONE'>([
  { allowedStatuses: ['DRAFT', 'ACTIVE', 'SUSPENDED'], id: 'edit', label: '编辑伙伴', requiredPermissions: ['mdm.partner.write'] },
  { allowedStatuses: ['DRAFT', 'SUSPENDED'], confirmMessage: '确认启用该伙伴供新业务引用？', id: 'ACTIVE', label: '启用', requiredPermissions: ['mdm.partner.write'] },
  { allowedStatuses: ['ACTIVE'], confirmMessage: '暂停后新业务不可选择该伙伴。', id: 'SUSPENDED', label: '暂停', requiredPermissions: ['mdm.partner.write'] },
  { allowedStatuses: ['ACTIVE', 'SUSPENDED'], confirmMessage: '停用不可恢复，历史业务仍保留伙伴快照。', id: 'INACTIVE', label: '停用', requiredPermissions: ['mdm.partner.write'] },
]);

export function PartnerWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [partners, setPartners] = useState<readonly PartnerRow[]>([]);
  const [corrections, setCorrections] = useState<readonly AddressRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<PartnerDetail>();
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const permissions = useMemo(() => new Set(claims ? ['mdm.partner.read', 'mdm.partner.write', 'mdm.partner.geocode'] : []), [claims]);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    if (!accessToken || !claims) throw new Error('请先登录后使用伙伴主数据工作台');
    const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID(), 'X-Tenant-Id': claims.tenantId, ...(init?.method && init.method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}), ...init?.headers } });
    const body = (await response.json()) as { code?: string; message?: string };
    if (!response.ok) throw new Error(`${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '请求失败'}`);
    return body;
  }, [accessToken, claims]);

  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    try {
      const [partnerRows, correctionRows] = await Promise.all([request(`/api/v1/mdm/partners${status ? `?status=${status}` : ''}`), request('/api/v1/mdm/partner-addresses/correction-queue')]);
      setPartners(partnerRows as unknown as PartnerRow[]);
      setCorrections(correctionRows as unknown as AddressRow[]);
      setError(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '伙伴查询失败'); }
  }, [accessToken, claims, request, status]);
  useEffect(() => { void refresh(); }, [refresh]);

  const selected = partners.find(({ id }) => id === selectedIds[0]);
  const decisions = registry.list().map(({ id }) => registry.decide(id, { dataScopeAllowed: true, permissions, status: selected?.status ?? 'NONE' }));

  async function loadDetail(id: string) {
    try { setDetail(await request(`/api/v1/mdm/partners/${id}`) as unknown as PartnerDetail); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '伙伴详情查询失败'); }
  }

  async function execute(actionId: string) {
    const decision = decisions.find(({ id }) => id === actionId);
    if (!selected || !decision?.enabled || actionId === 'edit') return;
    if (decision.confirmMessage && !window.confirm(decision.confirmMessage)) return;
    try {
      await request(`/api/v1/mdm/partners/${selected.id}/${actionId}`, { body: JSON.stringify({ expectedVersion: selected.version }), method: 'POST' });
      setNotice(`伙伴状态已更新为 ${actionId}`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '伙伴动作失败'); }
  }

  return <section className="partner-workbench">
    <Typography.Title level={2}>伙伴、地址与服务区域</Typography.Title>
    <Typography.Paragraph>同一法人可同时承担客户、供应商和承运商角色；地址标准化与地理编码保留原始文本，失败项进入人工校正队列。</Typography.Paragraph>
    {notice ? <Alert message={notice} showIcon type="success" /> : null}
    {error ? <Alert message={error} showIcon type="error" /> : null}
    <Card title="统一伙伴档案">
      <QueryPanel fields={[{ label: '伙伴状态', name: 'status', quick: true }]} onQuery={(values) => setStatus(values.status ?? '')} onReset={() => setStatus('')} />
      <CommandBar actions={decisions} onAction={(action) => void execute(action.id)} />
      <DataGrid columns={[{ key: 'code', label: '伙伴代码' }, { key: 'legalName', label: '法人名称' }, { key: 'shortName', label: '简称' }, { key: 'status', label: '状态', render: (value) => <StatusBadge status={String(value)} /> }, { key: 'version', label: '版本' }]} onPageChange={() => undefined} onSelectionChange={(ids) => { const next = ids.slice(-1); setSelectedIds(next); if (next[0]) void loadDetail(next[0]); }} page={1} pageSize={300} rows={partners} selectedIds={selectedIds} total={partners.length} />
    </Card>
    <Card title="地理编码人工校正队列">
      <DataGrid columns={[{ key: 'code', label: '地址代码' }, { key: 'rawText', label: '不可变原始地址' }, { key: 'countryCode', label: '国家' }, { key: 'geocodeStatus', label: '地理状态', render: (value) => <StatusBadge status={String(value)} /> }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={corrections} selectedIds={[]} total={corrections.length} />
    </Card>
    <Drawer destroyOnClose onClose={() => setDetail(undefined)} open={Boolean(detail)} title={detail ? `${detail.code} · ${detail.legalName}` : '伙伴详情'} width={900}>
      {detail ? <>
        <Descriptions column={2} items={[{ key: 'status', label: '状态', children: detail.status }, { key: 'version', label: '乐观锁版本', children: detail.version }]} />
        <Row gutter={[16, 16]}>
          <Col span={12}><Card size="small" title="多重伙伴角色"><DataGrid columns={[{ key: 'roleType', label: '角色' }, { key: 'status', label: '状态' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={100} rows={detail.roles} selectedIds={[]} total={detail.roles.length} /></Card></Col>
          <Col span={12}><Card size="small" title="联系人"><DataGrid columns={[{ key: 'name', label: '姓名' }, { key: 'email', label: '邮箱' }, { key: 'phone', label: '电话' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={100} rows={detail.contacts} selectedIds={[]} total={detail.contacts.length} /></Card></Col>
          <Col span={24}><Card size="small" title="地址与地理编码"><DataGrid columns={[{ key: 'code', label: '代码' }, { key: 'rawText', label: '原始地址' }, { key: 'geocodeStatus', label: '地理状态' }, { key: 'status', label: '状态' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={100} rows={detail.addresses} selectedIds={[]} total={detail.addresses.length} /></Card></Col>
          <Col span={12}><Card size="small" title="证照与有效期"><DataGrid columns={[{ key: 'certificateType', label: '类型' }, { key: 'certificateNo', label: '编号' }, { key: 'validUntil', label: '到期日' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={100} rows={detail.certificates} selectedIds={[]} total={detail.certificates.length} /></Card></Col>
          <Col span={12}><Card size="small" title="服务区域"><DataGrid columns={[{ key: 'code', label: '代码' }, { key: 'name', label: '名称' }, { key: 'zoneType', label: '类型' }, { key: 'status', label: '状态' }]} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={100} rows={detail.serviceZones} selectedIds={[]} total={detail.serviceZones.length} /></Card></Col>
        </Row>
      </> : null}
    </Drawer>
  </section>;
}
