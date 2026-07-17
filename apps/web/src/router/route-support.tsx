import { Alert, Button, Result, Skeleton, Typography } from 'antd';
import {
  isRouteErrorResponse,
  useNavigate,
  useRouteError,
} from 'react-router-dom';
import { useWorkspaceStore } from '../workspace/workspace-store';

export function WorkbenchHome() {
  const markDirty = useWorkspaceStore((state) => state.markDirty);
  return (
    <section className="workspace-placeholder">
      <Typography.Title level={2}>工作台</Typography.Title>
      <Typography.Paragraph>
        查询条件与未提交草稿会随标签会话保存，地址栏可直接复制和恢复当前页面。
      </Typography.Paragraph>
      <Button onClick={() => markDirty('workbench', true)}>
        标记未保存草稿
      </Button>
    </section>
  );
}

export function RouteLoading() {
  return (
    <section aria-label="页面加载中" className="route-loading">
      <Skeleton active paragraph={{ rows: 6 }} />
    </section>
  );
}

export function UnauthorizedPage() {
  const navigate = useNavigate();
  return (
    <Result
      extra={
        <Button onClick={() => void navigate('/workbench')}>返回工作台</Button>
      }
      status="403"
      subTitle="当前账号没有打开此路由所需的数据与资源权限。"
      title="403 · 无权访问"
    />
  );
}

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Result
      extra={
        <Button onClick={() => void navigate('/workbench')}>返回工作台</Button>
      }
      status="404"
      subTitle="路由不存在或旧链接已经失效。"
      title="404 · 页面不存在"
    />
  );
}

export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : '页面模块加载失败';
  return (
    <section className="route-error">
      <Alert
        description="请刷新重试；若问题持续，请携带当前 URL 联系平台运维。"
        message={message}
        showIcon
        type="error"
      />
    </section>
  );
}
