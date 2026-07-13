import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Space,
  Table,
  Tag,
  Tree,
  Typography,
} from 'antd';
import { DATA_SCOPE_DIMENSIONS, PERMISSION_RESOURCE_TYPES } from '@scm/shared';
import { useSessionStore } from './session-store';

interface OrganizationRow {
  code: string;
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  pathRebuildStatus: 'CURRENT' | 'FAILED' | 'PENDING';
  type: string;
}

interface RoleRow {
  code: string;
  id: string;
  name: string;
  templateRoleId: string | null;
}

interface RoleCatalog {
  roles: RoleRow[];
}

export function OrganizationRbacWorkbench() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const claims = useSessionStore((state) => state.claims);
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [error, setError] = useState<string>();
  const canAdminister =
    claims?.accountKind === 'PLATFORM_ADMIN' ||
    claims?.accountKind === 'TENANT_ADMIN';

  useEffect(() => {
    if (!accessToken || !claims) return;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'X-Correlation-Id': crypto.randomUUID(),
      'X-Tenant-Id': claims.tenantId,
    };
    void Promise.all([
      fetch('/api/v1/platform/organizations', { headers }),
      fetch('/api/v1/platform/roles', { headers }),
    ])
      .then(async ([organizationResponse, roleResponse]) => {
        if (!organizationResponse.ok || !roleResponse.ok) {
          throw new Error('当前账号无权读取组织或角色配置');
        }
        setOrganizations(
          (await organizationResponse.json()) as OrganizationRow[],
        );
        const catalog = (await roleResponse.json()) as RoleCatalog;
        setRoles(catalog.roles);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : '加载权限配置失败'),
      );
  }, [accessToken, claims]);

  const treeData = organizations.map((organization) => ({
    key: organization.id,
    title: (
      <Space>
        <span>{organization.name}</span>
        <Tag>{organization.type}</Tag>
        {organization.pathRebuildStatus === 'PENDING' ? (
          <Tag color="processing">路径重建中</Tag>
        ) : null}
      </Space>
    ),
  }));

  return (
    <section aria-labelledby="organization-rbac-heading">
      <Typography.Title id="organization-rbac-heading" level={3}>
        组织与角色权限
      </Typography.Title>
      {error ? <Alert message={error} type="warning" showIcon /> : null}
      <Space align="start" size="large" wrap>
        <Card
          className="identity-card"
          title="业务组织树"
          extra={
            canAdminister ? <Button type="primary">新增组织</Button> : null
          }
        >
          {treeData.length > 0 ? (
            <Tree defaultExpandAll treeData={treeData} />
          ) : (
            <Empty description={claims ? '尚无可见组织' : '登录后加载组织树'} />
          )}
          <Typography.Paragraph type="secondary">
            节点移动先做循环与版本校验，路径由异步任务重建。
          </Typography.Paragraph>
        </Card>
        <Card
          className="rbac-card"
          title="角色与资源权限"
          extra={canAdminister ? <Button>新增角色</Button> : null}
        >
          <Space wrap>
            {PERMISSION_RESOURCE_TYPES.map((type) => (
              <Tag key={type} color="blue">
                {type}
              </Tag>
            ))}
          </Space>
          {claims ? (
            <Table<RoleRow>
              columns={[
                { dataIndex: 'code', title: '角色代码' },
                { dataIndex: 'name', title: '名称' },
                {
                  dataIndex: 'templateRoleId',
                  render: (value: string | null) => value ?? '—',
                  title: '继承模板',
                },
              ]}
              dataSource={roles}
              locale={{ emptyText: '尚无角色' }}
              pagination={false}
              rowKey="id"
              size="small"
            />
          ) : (
            <Empty description="登录后加载角色" />
          )}
          <Typography.Paragraph type="secondary">
            界面隐藏仅改善体验；每个命令仍由后端 Guard 二次鉴权并审计
            Allow/Deny。
          </Typography.Paragraph>
        </Card>
        <Card
          className="identity-card"
          title="ABAC 数据范围"
          extra={canAdminister ? <Button>新建策略</Button> : null}
        >
          <Space wrap>
            {DATA_SCOPE_DIMENSIONS.map((dimension) => (
              <Tag key={dimension} color="purple">
                {dimension}
              </Tag>
            ))}
            <Tag color="purple">custom.*</Tag>
          </Space>
          <Typography.Paragraph>
            显式表达式按角色与资源限定数据；未命中策略时默认拒绝。
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            编译范围缓存键包含账号与权限版本，查询强制合并可信 tenantId。
          </Typography.Paragraph>
          {canAdminister ? <Button>模拟策略决策</Button> : null}
        </Card>
      </Space>
    </section>
  );
}
