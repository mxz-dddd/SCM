import { Layout, Space, Tag, Typography } from 'antd';
import { CORRELATION_ID_HEADER, DATA_MODEL_CONVENTIONS } from '@scm/shared';
import { AuthWorkbench } from './platform/AuthWorkbench';

const { Content, Header, Sider } = Layout;

export function App() {
  return (
    <Layout className="app-shell">
      <Sider className="app-sidebar" collapsed width={216}>
        <div className="app-mark" aria-label="SCM Cloud">
          SC
        </div>
      </Sider>
      <Layout>
        <Header className="app-header">
          <Space>
            <Typography.Text strong>SCM Cloud</Typography.Text>
            <Tag color="blue">Platform scaffold</Tag>
          </Space>
        </Header>
        <Content className="app-content">
          <Typography.Title level={2}>供应链协同工作台</Typography.Title>
          <Typography.Paragraph>
            Web、API、Worker 与共享包已接入统一工作区。
          </Typography.Paragraph>
          <Typography.Text type="secondary">
            Trace header: {CORRELATION_ID_HEADER}
          </Typography.Text>
          <Typography.Title level={4}>Data baseline</Typography.Title>
          <ul>
            {DATA_MODEL_CONVENTIONS.map((convention) => (
              <li key={convention}>{convention}</li>
            ))}
          </ul>
          <AuthWorkbench />
        </Content>
      </Layout>
    </Layout>
  );
}
