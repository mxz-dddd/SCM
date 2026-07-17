import { Tabs, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { InventoryGovernanceWorkbench } from './InventoryGovernanceWorkbench';
import { MobileOperationsWorkbench } from './MobileOperationsWorkbench';

export type WarehouseOperationsSection =
  'tasks' | 'wes' | 'performance' | 'rules' | 'devices';

const sections: readonly {
  key: WarehouseOperationsSection;
  label: string;
  path: string;
}[] = [
  { key: 'tasks', label: '仓储任务', path: '/wms/operations/tasks' },
  { key: 'wes', label: 'WES 调度', path: '/wms/operations/wes' },
  {
    key: 'performance',
    label: '作业绩效',
    path: '/wms/operations/performance',
  },
  { key: 'rules', label: '作业规则', path: '/wms/operations/rules' },
  { key: 'devices', label: '设备协同', path: '/wms/operations/devices' },
];

export function WarehouseOperationsHub({
  initialSection,
}: {
  initialSection: WarehouseOperationsSection;
}) {
  const navigate = useNavigate();
  return (
    <section className="warehouse-operations-hub">
      <Typography.Title level={2}>仓储任务与 WES</Typography.Title>
      <Typography.Paragraph>
        稳定子入口复用真实任务、离线同步、设备指令、劳务绩效和库存治理
        API，不创建空白页面。
      </Typography.Paragraph>
      <Tabs
        activeKey={initialSection}
        items={sections.map(({ key, label }) => ({ key, label }))}
        onChange={(key) => {
          const section = sections.find((item) => item.key === key);
          if (section) void navigate(section.path);
        }}
      />
      {initialSection === 'rules' ? (
        <InventoryGovernanceWorkbench />
      ) : (
        <MobileOperationsWorkbench focus={initialSection} />
      )}
    </section>
  );
}

export const WarehouseTasksPage = () => (
  <WarehouseOperationsHub initialSection="tasks" />
);
export const WarehouseWesPage = () => (
  <WarehouseOperationsHub initialSection="wes" />
);
export const WarehousePerformancePage = () => (
  <WarehouseOperationsHub initialSection="performance" />
);
export const WarehouseRulesPage = () => (
  <WarehouseOperationsHub initialSection="rules" />
);
export const WarehouseDevicesPage = () => (
  <WarehouseOperationsHub initialSection="devices" />
);
