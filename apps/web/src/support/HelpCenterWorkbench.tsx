import { Card, Col, Row, Tabs, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';

export type HelpSection = 'help' | 'user' | 'operations' | 'api' | 'releases';

const repositoryBase =
  'https://github.com/mxz-dddd/SCM/blob/codex/frontend-parity/';
const sections: readonly { key: HelpSection; label: string; path: string }[] = [
  { key: 'help', label: '帮助首页', path: '/support/help' },
  { key: 'user', label: '用户手册', path: '/support/user-guide' },
  { key: 'operations', label: '运维手册', path: '/support/operations' },
  { key: 'api', label: 'API 与架构', path: '/support/api' },
  { key: 'releases', label: '版本说明', path: '/support/releases' },
];

const documents: Record<
  HelpSection,
  readonly { label: string; file: string }[]
> = {
  help: [
    { label: '项目实施计划', file: 'docs/PLAN.md' },
    { label: '功能任务清单', file: 'docs/BACKLOG.md' },
  ],
  user: [
    { label: '本地启动与使用说明', file: 'README.md' },
    {
      label: '系统设计说明',
      file: 'docs/design/SCM_同类系统_架构与详细设计说明书_v0.1.md',
    },
  ],
  operations: [
    { label: '备份恢复与灾备', file: 'docs/runbooks/backup-restore-dr.md' },
    { label: '发布与迁移', file: 'docs/runbooks/release-migration.md' },
    { label: '事件重放', file: 'docs/runbooks/event-replay.md' },
  ],
  api: [
    { label: 'V2 架构', file: 'docs/design/V2_ARCHITECTURE.md' },
    { label: '事件目录', file: 'docs/design/V2_EVENT_CATALOG.md' },
    {
      label: '入口与 Webhook 安全',
      file: 'docs/security/ingress-and-webhook.md',
    },
  ],
  releases: [{ label: '版本变更记录', file: 'docs/CHANGELOG.md' }],
};

export function HelpCenterWorkbench({
  initialSection,
}: {
  initialSection: HelpSection;
}) {
  const navigate = useNavigate();
  return (
    <section className="help-center-workbench">
      <Typography.Title level={2}>澄链 SCM 帮助中心</Typography.Title>
      <Typography.Paragraph>
        本帮助中心只链接仓库原创用户文档、运维手册、架构/API 说明和版本记录。
      </Typography.Paragraph>
      <Tabs
        activeKey={initialSection}
        items={sections.map(({ key, label }) => ({ key, label }))}
        onChange={(key) => {
          const section = sections.find((item) => item.key === key);
          if (section) void navigate(section.path);
        }}
      />
      <Row gutter={[16, 16]}>
        {documents[initialSection].map((document) => (
          <Col key={document.file} xs={24} md={12} lg={8}>
            <Card title={document.label}>
              <Typography.Paragraph>{document.file}</Typography.Paragraph>
              <Typography.Link
                href={`${repositoryBase}${encodeURI(document.file)}`}
                rel="noreferrer"
                target="_blank"
              >
                打开仓库文档
              </Typography.Link>
            </Card>
          </Col>
        ))}
      </Row>
    </section>
  );
}

export const HelpHomePage = () => <HelpCenterWorkbench initialSection="help" />;
export const UserGuidePage = () => (
  <HelpCenterWorkbench initialSection="user" />
);
export const OperationsGuidePage = () => (
  <HelpCenterWorkbench initialSection="operations" />
);
export const ApiGuidePage = () => <HelpCenterWorkbench initialSection="api" />;
export const ReleaseNotesPage = () => (
  <HelpCenterWorkbench initialSection="releases" />
);
