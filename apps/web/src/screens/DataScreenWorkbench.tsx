import { Tabs, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { BiAnalyticsWorkbench } from '../control/BiAnalyticsWorkbench';
import { ControlTowerWorkbench } from '../control/ControlTowerWorkbench';

export type DataScreenSection = 'manage' | 'groups' | 'mine' | 'maps';

const sections: readonly {
  key: DataScreenSection;
  label: string;
  path: string;
}[] = [
  { key: 'manage', label: '大屏管理', path: '/screens/manage' },
  { key: 'groups', label: '大屏分组', path: '/screens/groups' },
  { key: 'mine', label: '我的大屏', path: '/screens/mine' },
  { key: 'maps', label: '地图配置', path: '/screens/maps' },
];

export function DataScreenWorkbench({
  initialSection,
}: {
  initialSection: DataScreenSection;
}) {
  const navigate = useNavigate();
  return (
    <section className="data-screen-workbench">
      <Typography.Title level={2}>数据大屏中心</Typography.Title>
      <Typography.Paragraph>
        大屏、分组和个人视图复用版本化 BI
        看板；地图配置复用控制塔运输网络与权限化位置数据。
      </Typography.Paragraph>
      <Tabs
        activeKey={initialSection}
        items={sections.map(({ key, label }) => ({ key, label }))}
        onChange={(key) => {
          const section = sections.find((item) => item.key === key);
          if (section) void navigate(section.path);
        }}
      />
      {initialSection === 'maps' ? (
        <ControlTowerWorkbench />
      ) : (
        <BiAnalyticsWorkbench />
      )}
    </section>
  );
}

export const DataScreenManagePage = () => (
  <DataScreenWorkbench initialSection="manage" />
);
export const DataScreenGroupsPage = () => (
  <DataScreenWorkbench initialSection="groups" />
);
export const MyDataScreensPage = () => (
  <DataScreenWorkbench initialSection="mine" />
);
export const DataScreenMapsPage = () => (
  <DataScreenWorkbench initialSection="maps" />
);
