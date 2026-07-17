import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BusinessDrawer,
  BusinessTimeline,
  CommandBar,
  ConfigurationPageTemplate,
  DataGrid,
  ListPageTemplate,
  MasterDetail,
  MasterDetailPageTemplate,
  NotificationCenter,
  QueryPanel,
  StatusBadge,
  StatusStepper,
  TaskWorkbench,
  TaskPageTemplate,
  ToastFeedback,
  UI_PACKAGE_STATUS,
  applyFieldUpdate,
  serializeQueryToSearchParams,
} from './index';

describe('UI package contracts', () => {
  it('exposes its readiness marker', () => {
    expect(UI_PACKAGE_STATUS).toBe('business-components-ready');
  });

  it('renders the shared list and state primitives', () => {
    const markup = renderToStaticMarkup(
      <>
        <QueryPanel
          fields={[{ label: '状态', name: 'status', quick: true }]}
          onQuery={() => undefined}
          onReset={() => undefined}
          onSaveView={() => undefined}
        />
        <CommandBar
          actions={[
            {
              asynchronous: true,
              enabled: true,
              id: 'export',
              label: '导出',
            },
          ]}
          onAction={() => undefined}
        />
        <DataGrid
          columns={[{ key: 'code', label: '业务号' }]}
          onPageChange={() => undefined}
          page={1}
          pageSize={20}
          rows={[{ code: 'SO-1', id: '1' }]}
          total={1}
        />
        <MasterDetail
          currentVersion={3}
          detail="详情"
          list="列表"
          onSave={() => undefined}
          versionConflict={{ actual: 4, expected: 3 }}
        />
        <StatusBadge status="ACTIVE" />
        <StatusStepper current="OPEN" statuses={['DRAFT', 'OPEN', 'CLOSED']} />
        <BusinessTimeline
          events={[
            {
              actor: 'operator',
              occurredAt: '2026-07-14T00:00:00Z',
              source: 'OMS',
              title: '订单创建',
              traceId: 'trace-1',
            },
          ]}
        />
        <TaskWorkbench
          onClaim={() => undefined}
          tasks={[{ id: 'task-1', priority: 10, title: '待领取任务' }]}
        />
        <BusinessDrawer onClose={() => undefined} open title="详情抽屉">
          详情
        </BusinessDrawer>
        <NotificationCenter
          items={[{ id: 'n1', message: '异步任务已受理', severity: 'info' }]}
        />
        <ToastFeedback message="保存成功" tone="success" />
        <ListPageTemplate title="列表模板">列表内容</ListPageTemplate>
        <MasterDetailPageTemplate title="主从模板">
          主从内容
        </MasterDetailPageTemplate>
        <TaskPageTemplate title="任务模板">任务内容</TaskPageTemplate>
        <ConfigurationPageTemplate title="配置模板">
          配置内容
        </ConfigurationPageTemplate>
      </>,
    );
    expect(markup).toContain('保存视图');
    expect(markup).toContain('导出 · 异步');
    expect(markup).toContain('SO-1');
    expect(markup).toContain('版本冲突');
    expect(markup).toContain('data-state="current"');
    expect(markup).toContain('trace-1');
    expect(markup).toContain('待领取任务');
    expect(markup).toContain('异步任务已受理');
    expect(markup).toContain('scm-page-template-list');
    expect(markup).toContain('scm-page-template-master-detail');
    expect(markup).toContain('scm-page-template-task');
    expect(markup).toContain('scm-page-template-configuration');
    expect(serializeQueryToSearchParams({ page: '1', status: 'OPEN' })).toBe(
      'page=1&status=OPEN',
    );
  });

  it('updates only registered fields and returns per-row failures', () => {
    const rows = [
      { id: '1', owner: 'a', status: 'OPEN' },
      { id: '2', owner: 'b', status: 'CLOSED' },
    ];
    expect(
      applyFieldUpdate({
        allowedFields: new Set(['owner']),
        field: 'owner',
        rows,
        validate: (row) =>
          row.status === 'OPEN'
            ? { allowed: true }
            : { allowed: false, reason: 'STATUS_DENIED' },
        value: 'c',
      }),
    ).toEqual({
      failures: [{ id: '2', reason: 'STATUS_DENIED' }],
      updatedIds: ['1'],
    });
    expect(
      applyFieldUpdate({
        allowedFields: new Set(['owner']),
        field: 'status',
        rows,
        validate: () => ({ allowed: true }),
        value: 'CLOSED',
      }).updatedIds,
    ).toEqual([]);
  });
});
