import { Tabs, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { BillingFactWorkbench } from '../billing/BillingFactWorkbench';
import { BiAnalyticsWorkbench } from '../control/BiAnalyticsWorkbench';
import { ControlTowerWorkbench } from '../control/ControlTowerWorkbench';

export type ReportSection = 'center' | 'subjects' | 'mine' | 'templates';

const sections: readonly { key: ReportSection; label: string; path: string }[] =
  [
    { key: 'center', label: '报表中心', path: '/reports/center' },
    { key: 'subjects', label: '主题分析', path: '/reports/subjects' },
    { key: 'mine', label: '我的报表', path: '/reports/mine' },
    { key: 'templates', label: '模板管理', path: '/reports/templates' },
  ];

function ReportContent({ section }: { section: ReportSection }) {
  if (section === 'subjects') return <ControlTowerWorkbench />;
  if (section === 'templates') return <BillingFactWorkbench />;
  return <BiAnalyticsWorkbench />;
}

export function ReportCenterWorkbench({
  initialSection,
}: {
  initialSection: ReportSection;
}) {
  const navigate = useNavigate();
  return (
    <section className="report-center-workbench">
      <Typography.Title level={2}>原创报表中心</Typography.Title>
      <Typography.Paragraph>
        目录只组合本系统真实
        BI、控制塔与结算事实；不复制参考租户的报表模板或业务数据。
      </Typography.Paragraph>
      <Tabs
        activeKey={initialSection}
        items={sections.map(({ key, label }) => ({ key, label }))}
        onChange={(key) => {
          const section = sections.find((item) => item.key === key);
          if (section) void navigate(section.path);
        }}
      />
      <ReportContent section={initialSection} />
    </section>
  );
}

export const ReportCenterPage = () => (
  <ReportCenterWorkbench initialSection="center" />
);
export const ReportSubjectsPage = () => (
  <ReportCenterWorkbench initialSection="subjects" />
);
export const MyReportsPage = () => (
  <ReportCenterWorkbench initialSection="mine" />
);
export const ReportTemplatesPage = () => (
  <ReportCenterWorkbench initialSection="templates" />
);
