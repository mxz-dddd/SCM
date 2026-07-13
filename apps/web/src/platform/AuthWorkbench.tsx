import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Space,
  Steps,
  Typography,
} from 'antd';
import type { ApiError, SessionClaims } from '@scm/shared';
import { TENANT_STATUSES } from '@scm/shared';
import { useSessionStore } from './session-store';

interface LoginValues {
  deviceId: string;
  password: string;
  tenantCode: string;
  username: string;
}

interface LoginResponse {
  accessToken: string;
  session: SessionClaims;
}

export function AuthWorkbench() {
  const establish = useSessionStore((state) => state.establish);
  const claims = useSessionStore((state) => state.claims);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function login(values: LoginValues) {
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch('/api/v1/auth/login', {
        body: JSON.stringify(values),
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
        },
        method: 'POST',
      });
      const body = (await response.json()) as LoginResponse | ApiError;
      if (!response.ok || !('accessToken' in body)) {
        throw new Error('message' in body ? body.message : 'Login failed');
      }
      establish(body.accessToken, body.session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="identity-heading">
      <Typography.Title id="identity-heading" level={3}>
        租户与认证
      </Typography.Title>
      <Space align="start" size="large" wrap>
        <Card title="本地账号登录" className="identity-card">
          {error ? <Alert message={error} type="error" showIcon /> : null}
          {claims ? (
            <Alert
              message={`已认证租户 ${claims.tenantId}`}
              description={`权限版本 ${claims.permissionVersion}`}
              type="success"
              showIcon
            />
          ) : (
            <Form<LoginValues>
              layout="vertical"
              initialValues={{ deviceId: 'web-browser' }}
              onFinish={(values) => void login(values)}
            >
              <Form.Item
                name="tenantCode"
                label="租户代码"
                rules={[{ required: true }]}
              >
                <Input autoComplete="organization" />
              </Form.Item>
              <Form.Item
                name="username"
                label="账号"
                rules={[{ required: true }]}
              >
                <Input autoComplete="username" />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true }]}
              >
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <Form.Item name="deviceId" hidden>
                <Input />
              </Form.Item>
              <Button htmlType="submit" type="primary" loading={submitting}>
                登录
              </Button>
            </Form>
          )}
        </Card>
        <Card title="租户生命周期" className="identity-card identity-lifecycle">
          <Steps
            direction="vertical"
            current={0}
            items={TENANT_STATUSES.map((status) => ({ title: status }))}
          />
          <Typography.Paragraph type="secondary">
            所有状态变化由受权命令执行，并携带版本、审计和 Outbox 事件。
          </Typography.Paragraph>
        </Card>
      </Space>
    </section>
  );
}
