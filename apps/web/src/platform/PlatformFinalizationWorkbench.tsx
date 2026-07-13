import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataGrid, QueryPanel, StatusBadge } from '@scm/ui';
import { Alert, Button, Card, Input, Select, Space, Typography } from 'antd';
import { useSessionStore } from './session-store';

interface Row { id: string; status: string; version: number; [key: string]: unknown }

export function PlatformFinalizationWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [locale, setLocale] = useState({ currency: 'CNY', language: 'zh-CN', timeZone: 'Asia/Shanghai', unitSystem: 'METRIC', version: 0 });
  const [conversions, setConversions] = useState<readonly Row[]>([]);
  const [flags, setFlags] = useState<readonly Row[]>([]);
  const [templates, setTemplates] = useState<readonly Row[]>([]);
  const [printJobs, setPrintJobs] = useState<readonly Row[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [comments, setComments] = useState<readonly Row[]>([]);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const canAdmin = Boolean(claims && claims.accountKind !== 'USER');

  const request = useCallback(async (path: string, init?: RequestInit) => {
    if (!accessToken || !claims) throw new Error('请先登录后使用平台收尾中心');
    const response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Correlation-Id': crypto.randomUUID(),
        'X-Tenant-Id': claims.tenantId,
        ...(init?.method && init.method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json()) as { code?: string; message?: string };
    if (!response.ok) throw new Error(`${body.code ?? 'REQUEST_FAILED'}: ${body.message ?? '请求失败'}`);
    return body;
  }, [accessToken, claims]);

  const base = '/api/v1/platform/finalization';
  const refresh = useCallback(async () => {
    if (!accessToken || !claims) return;
    try {
      const [localeRow, conversionRows, flagRows, templateRows, jobRows] = await Promise.all([
        request(`${base}/locale`), request(`${base}/unit-conversions`), request(`${base}/feature-flags`),
        request(`${base}/print-templates`), request(`${base}/print-jobs`),
      ]);
      setLocale(localeRow as unknown as typeof locale);
      setConversions(conversionRows as unknown as Row[]);
      setFlags(flagRows as unknown as Row[]);
      setTemplates(templateRows as unknown as Row[]);
      setPrintJobs(jobRows as unknown as Row[]);
      setError(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '平台数据查询失败'); }
  }, [accessToken, claims, request]);

  useEffect(() => { void refresh(); }, [refresh]);

  const statusColumn = useMemo(() => ({ key: 'status', label: '状态', render: (value: unknown) => <StatusBadge status={String(value)} /> }), []);
  const grid = (rows: readonly Row[], columns: readonly { key: string; label: string; render?: (value: unknown) => React.ReactNode }[]) => (
    <DataGrid columns={columns} onPageChange={() => undefined} onSelectionChange={() => undefined} page={1} pageSize={300} rows={rows} selectedIds={[]} total={rows.length} />
  );

  async function act(path: string, body: unknown, success: string) {
    try {
      await request(`${base}/${path}`, { body: JSON.stringify(body), method: 'POST' });
      setNotice(success);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败'); }
  }

  async function loadComments(values?: Record<string, string | undefined>) {
    const id = values?.businessId ?? businessId;
    if (!id) return;
    setBusinessId(id);
    try {
      const rows = await request(`${base}/comments?businessType=ORDER&businessId=${encodeURIComponent(id)}`);
      setComments(rows as unknown as Row[]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '评论查询失败'); }
  }

  return (
    <section className="platform-finalization-workbench">
      <Typography.Title level={2}>国际化、开关、协同与打印中心</Typography.Title>
      <Typography.Paragraph>UTC 时间按业务时区显示，数量保留原单位与换算版本；渐进发布、协同评论和打印任务均可审计与重放。</Typography.Paragraph>
      {notice ? <Alert message={notice} showIcon type="success" /> : null}
      {error ? <Alert message={error} showIcon type="error" /> : null}

      <Card title="LocaleContext 与单位换算">
        <Space wrap>
          <Select aria-label="界面语言" value={locale.language} onChange={(language) => setLocale({ ...locale, language })} options={[{ label: '简体中文', value: 'zh-CN' }, { label: 'English', value: 'en-US' }]} />
          <Input aria-label="IANA 时区" value={locale.timeZone} onChange={(event) => setLocale({ ...locale, timeZone: event.target.value })} />
          <Button disabled={!accessToken} onClick={() => void act('locale', { ...locale, expectedVersion: locale.version || undefined }, '区域设置已保存')}>保存区域设置</Button>
          <Button disabled={!canAdmin} onClick={() => void act('unit-conversions', { code: 'KG_TO_G', dimension: 'MASS', factor: '1000', fromUom: 'KG', toUom: 'G' }, '单位换算版本已创建')}>新建 KG→G 换算</Button>
        </Space>
        {grid(conversions, [{ key: 'code', label: '代码' }, { key: 'fromUom', label: '原单位' }, { key: 'toUom', label: '基础单位' }, { key: 'factor', label: '换算因子' }, statusColumn])}
      </Card>

      <Card title="FeatureFlag 渐进发布">
        <Button disabled={!canAdmin} onClick={() => void act('feature-flags', { code: 'NEW_FLOW', name: '新流程', rules: [{ enabled: true, id: 'TEN_PERCENT', percentage: 10, priority: 1 }] }, '特性开关草稿已创建')}>新建 10% 开关版本</Button>
        {grid(flags, [{ key: 'code', label: '开关代码' }, { key: 'name', label: '名称' }, { key: 'versionNumber', label: '版本' }, statusColumn])}
      </Card>

      <Card title="评论、@提及与外部可见性">
        <QueryPanel fields={[{ label: '业务对象 ID', name: 'businessId', quick: true }]} onQuery={(values) => void loadComments(values)} onReset={() => { setBusinessId(''); setComments([]); }} />
        <Space wrap>
          <Button disabled={!accessToken || !businessId} onClick={() => void act('comments', { body: '协同更新', businessId, businessType: 'ORDER', visibility: 'INTERNAL' }, '内部评论已发布')}>发布内部评论</Button>
          <Button disabled={!accessToken || !businessId} onClick={() => void act('comments', { body: '伙伴可见更新', businessId, businessType: 'ORDER', visibility: 'EXTERNAL' }, '外部评论已发布')}>发布伙伴评论</Button>
        </Space>
        {grid(comments, [{ key: 'body', label: '评论' }, { key: 'visibility', label: '可见性' }, statusColumn])}
      </Card>

      <Card title="PrintTemplate、打印机路由与 PrintJob">
        <Space wrap>
          <Button disabled={!canAdmin} onClick={() => void act('print-templates', { code: 'SHIP_LABEL', content: { body: '{{orderNo}}' }, documentType: 'SHIP_LABEL', language: 'zh-CN', name: '运输标签', routeTags: ['LABEL'], variables: ['orderNo'] }, '打印模板草稿已创建')}>新建打印模板</Button>
          <Button disabled={!canAdmin} onClick={() => void act('printers', { code: `PRINTER_${Date.now()}`, endpointRef: 'printer://local-label', name: '标签打印机', routeTags: ['LABEL'] }, '打印机已注册')}>注册打印机</Button>
        </Space>
        {grid(templates, [{ key: 'code', label: '模板代码' }, { key: 'documentType', label: '单据类型' }, { key: 'language', label: '语言' }, statusColumn])}
        {grid(printJobs, [{ key: 'documentType', label: '打印类型' }, { key: 'copies', label: '份数' }, { key: 'printerId', label: '打印机' }, statusColumn])}
      </Card>
    </section>
  );
}
