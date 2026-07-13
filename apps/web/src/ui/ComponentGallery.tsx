import { useMemo, useState } from 'react';
import {
  BusinessDrawer,
  BusinessTimeline,
  CommandBar,
  DataGrid,
  DecisionModal,
  FieldUpdater,
  MasterDetail,
  NotificationCenter,
  QueryPanel,
  StatusBadge,
  StatusStepper,
  TaskWorkbench,
  ToastFeedback,
  createActionRegistry,
} from '@scm/ui';

type DemoStatus = 'DRAFT' | 'OPEN' | 'CLOSED';

const actionRegistry = createActionRegistry<DemoStatus>([
  {
    allowedStatuses: ['DRAFT', 'OPEN'],
    confirmMessage: '确认提交当前单据？',
    id: 'submit',
    label: '提交',
    requiredPermissions: ['order.submit'],
  },
  {
    asynchronous: true,
    id: 'export',
    label: '导出',
    requiredPermissions: ['order.read'],
  },
  {
    allowedStatuses: ['DRAFT'],
    id: 'cancel',
    label: '取消',
    requiredPermissions: ['order.cancel'],
  },
]);

const rows = [
  {
    amount: 1280,
    code: 'SO-260714-01',
    id: 'order-1',
    owner: '华东一组',
    status: 'OPEN',
  },
  {
    amount: 860,
    code: 'SO-260714-02',
    id: 'order-2',
    owner: '华南二组',
    status: 'CLOSED',
  },
] as const;

export function ComponentGallery() {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [status] = useState<DemoStatus>('OPEN');
  const [pendingAction, setPendingAction] = useState<string>();
  const [notice, setNotice] = useState('组件合同已加载');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const actions = useMemo(
    () =>
      actionRegistry.list().map(({ id }) =>
        actionRegistry.decide(id, {
          dataScopeAllowed: true,
          permissions: new Set(['order.read', 'order.submit']),
          status,
        }),
      ),
    [status],
  );

  return (
    <section className="component-gallery">
      <header>
        <h2>统一业务组件</h2>
        <p>查询、动作、列表、状态、任务与反馈使用同一套交互合同。</p>
      </header>

      <QueryPanel
        expanded
        fields={[
          {
            label: '业务号',
            name: 'code',
            placeholder: '输入订单号',
            quick: true,
          },
          { label: '创建日期', name: 'createdAt', quick: true, type: 'date' },
        ]}
        onQuery={(values) =>
          setNotice(`已应用 ${Object.keys(values).length} 个查询条件`)
        }
        onReset={() => setNotice('查询条件已重置')}
        onSaveView={() => setNotice('视图已保存')}
      />

      <CommandBar
        actions={actions}
        onAction={(action) => {
          if (action.confirmMessage) setPendingAction(action.label);
          else setNotice(`${action.label}任务已受理`);
        }}
      />

      <DataGrid
        columns={[
          { fixed: 'left', key: 'code', label: '业务号' },
          { key: 'owner', label: '负责组织' },
          {
            key: 'status',
            label: '状态',
            render: (value) => <StatusBadge status={String(value)} />,
          },
          { fixed: 'right', key: 'amount', label: '金额' },
        ]}
        onColumnsChange={() => setNotice('列显示配置已保存')}
        onExportView={() => setNotice('当前视图导出任务已受理')}
        onPageChange={(page) => setNotice(`已请求第 ${page} 页`)}
        onRowContextMenu={() => setDrawerOpen(true)}
        onSelectionChange={setSelectedIds}
        page={1}
        pageSize={20}
        rows={rows}
        selectedIds={selectedIds}
        total={42}
      />

      <div className="component-gallery-grid">
        <MasterDetail
          currentVersion={3}
          detail={<p>单据详情使用版本号保护并发编辑。</p>}
          list={<strong>主从布局</strong>}
          onSave={(version) => setNotice(`按版本 ${version} 保存`)}
          versionConflict={{ actual: 4, expected: 3 }}
        />
        <div>
          <h3>状态路径</h3>
          <StatusStepper
            current="OPEN"
            statuses={['DRAFT', 'OPEN', 'CLOSED']}
          />
        </div>
        <div>
          <h3>业务时间线</h3>
          <BusinessTimeline
            events={[
              {
                actor: 'operator@example.com',
                occurredAt: '2026-07-14 09:30',
                source: 'OMS',
                title: '订单已提交',
                traceId: 'trace-demo-01',
              },
            ]}
          />
        </div>
        <div>
          <h3>任务工作台</h3>
          <TaskWorkbench
            onClaim={(taskId) => setNotice(`已领取任务 ${taskId}`)}
            tasks={[
              { id: 'pick-1', priority: 90, title: '波次拣货复核' },
              { id: 'count-1', priority: 40, title: '库存盘点' },
            ]}
          />
        </div>
      </div>

      <FieldUpdater
        allowedFields={['owner', 'priority']}
        impactCount={selectedIds.length}
        onApply={(field) => setNotice(`字段 ${field} 批量更新已提交`)}
      />
      <NotificationCenter
        items={[
          {
            id: 'notice-1',
            message: notice,
            severity: 'info',
            traceId: 'trace-demo-01',
          },
        ]}
      />
      <ToastFeedback message={notice} tone="success" />

      <BusinessDrawer
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        title="行详情"
      >
        <p>右键行打开统一详情抽屉。</p>
      </BusinessDrawer>
      <DecisionModal
        onCancel={() => setPendingAction(undefined)}
        onConfirm={() => {
          setNotice(`${pendingAction ?? '动作'}已确认`);
          setPendingAction(undefined);
        }}
        open={pendingAction !== undefined}
        title="确认业务动作"
      >
        确认执行“{pendingAction}”？
      </DecisionModal>
    </section>
  );
}
