export const PERMISSION_RESOURCE_TYPES = [
  'MENU',
  'PAGE',
  'API',
  'BUTTON',
  'FIELD',
  'EXPORT',
] as const;

export type PermissionEffect = 'ALLOW' | 'DENY';
export type PermissionResourceType = (typeof PERMISSION_RESOURCE_TYPES)[number];

export const ADMIN_PERMISSIONS = [
  {
    code: 'platform.organization.read',
    name: '查看组织树',
    resourceRef: '/api/v1/platform/organizations',
    resourceType: 'API',
  },
  {
    code: 'platform.organization.write',
    name: '维护组织树',
    resourceRef: '/api/v1/platform/organizations/*',
    resourceType: 'API',
  },
  {
    code: 'platform.role.read',
    name: '查看角色权限',
    resourceRef: '/api/v1/platform/roles',
    resourceType: 'API',
  },
  {
    code: 'platform.role.write',
    name: '维护角色权限',
    resourceRef: '/api/v1/platform/roles/*',
    resourceType: 'API',
  },
  {
    code: 'platform.policy.read',
    name: '查看数据范围策略',
    resourceRef: '/api/v1/platform/data-policies',
    resourceType: 'API',
  },
  {
    code: 'platform.policy.write',
    name: '维护数据范围策略',
    resourceRef: '/api/v1/platform/data-policies/*',
    resourceType: 'API',
  },
  {
    code: 'platform.configuration.read',
    name: '查看配置字典与单号规则',
    resourceRef: '/api/v1/platform/configuration/*',
    resourceType: 'API',
  },
  {
    code: 'platform.configuration.write',
    name: '维护配置字典与单号规则',
    resourceRef: '/api/v1/platform/configuration/*',
    resourceType: 'API',
  },
  {
    code: 'platform.audit.read',
    name: '只读查询审计与变更历史',
    resourceRef: '/api/v1/platform/audit/*',
    resourceType: 'API',
  },
  {
    code: 'platform.attachment.read',
    name: '查看附件与业务关联',
    resourceRef: '/api/v1/platform/attachments',
    resourceType: 'API',
  },
  {
    code: 'platform.attachment.write',
    name: '上传附件与维护业务关联',
    resourceRef: '/api/v1/platform/attachments/*',
    resourceType: 'API',
  },
  {
    code: 'platform.attachment.scan',
    name: '回写附件病毒扫描结果',
    resourceRef: '/api/v1/platform/attachments/*/scan-results',
    resourceType: 'API',
  },
  {
    code: 'platform.attachment.download',
    name: '下载授权范围内附件',
    resourceRef: '/api/v1/platform/attachments/*/downloads',
    resourceType: 'API',
  },
  {
    code: 'platform.inbox.read',
    name: '查看与处理个人待办消息',
    resourceRef: '/api/v1/platform/notifications/inbox/*',
    resourceType: 'API',
  },
  {
    code: 'platform.inbox.write',
    name: '创建业务待办消息',
    resourceRef: '/api/v1/platform/notifications/inbox',
    resourceType: 'API',
  },
  {
    code: 'platform.notification.manage',
    name: '管理通知模板与投递记录',
    resourceRef: '/api/v1/platform/notifications/*',
    resourceType: 'API',
  },
  {
    code: 'platform.notification.send',
    name: '创建投递重试与升级通知',
    resourceRef: '/api/v1/platform/notifications/*',
    resourceType: 'API',
  },
  {
    code: 'platform.import.read',
    name: '查看导入任务与逐行回执',
    resourceRef: '/api/v1/platform/imports',
    resourceType: 'API',
  },
  {
    code: 'platform.import.write',
    name: '创建并推进导入任务',
    resourceRef: '/api/v1/platform/imports/*',
    resourceType: 'API',
  },
  {
    code: 'platform.import.process',
    name: '执行导入校验与结果回写',
    resourceRef: '/api/v1/platform/imports/*',
    resourceType: 'API',
  },
  {
    code: 'platform.export.read',
    name: '查看个人导出任务',
    resourceRef: '/api/v1/platform/exports',
    resourceType: 'API',
  },
  {
    code: 'platform.export.create',
    name: '按当前视图创建脱敏导出',
    resourceRef: '/api/v1/platform/exports',
    resourceType: 'EXPORT',
  },
  {
    code: 'platform.export.process',
    name: '执行异步导出任务',
    resourceRef: '/api/v1/platform/exports/*',
    resourceType: 'API',
  },
  {
    code: 'platform.export.download',
    name: '下载授权范围内导出结果',
    resourceRef: '/api/v1/platform/exports/downloads/*',
    resourceType: 'EXPORT',
  },
  {
    code: 'platform.search.read',
    name: '统一搜索业务对象',
    resourceRef: '/api/v1/platform/search',
    resourceType: 'API',
  },
  {
    code: 'platform.search.index',
    name: '写入统一搜索投影',
    resourceRef: '/api/v1/platform/search/documents',
    resourceType: 'API',
  },
  {
    code: 'platform.saved-view.read',
    name: '查看个人与共享视图',
    resourceRef: '/api/v1/platform/saved-views',
    resourceType: 'API',
  },
  {
    code: 'platform.saved-view.write',
    name: '维护个人与共享视图',
    resourceRef: '/api/v1/platform/saved-views/*',
    resourceType: 'API',
  },
  {
    code: 'platform.workflow-definition.read',
    name: '查看流程定义与版本',
    resourceRef: '/api/v1/platform/workflow-definitions',
    resourceType: 'API',
  },
  {
    code: 'platform.workflow-definition.write',
    name: '维护并发布流程定义版本',
    resourceRef: '/api/v1/platform/workflow-definitions/*',
    resourceType: 'API',
  },
  {
    code: 'platform.workflow.start',
    name: '发起与撤回工作流实例',
    resourceRef: '/api/v1/platform/workflow-instances/*',
    resourceType: 'API',
  },
  {
    code: 'platform.approval.read',
    name: '查看审批任务与历史',
    resourceRef: '/api/v1/platform/approval-tasks',
    resourceType: 'API',
  },
  {
    code: 'platform.approval.act',
    name: '执行审批与批量动作',
    resourceRef: '/api/v1/platform/approval-tasks/*',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.rule.read',
    name: '查看规则版本与求值追踪',
    resourceRef: '/api/v1/platform/rules/*',
    resourceType: 'API',
  },
  {
    code: 'platform.rule.write',
    name: '维护并发布规则集',
    resourceRef: '/api/v1/platform/rules/sets/*',
    resourceType: 'API',
  },
  {
    code: 'platform.rule.simulate',
    name: '模拟规则求值',
    resourceRef: '/api/v1/platform/rules/simulate',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.rule.evaluate',
    name: '执行正式规则求值',
    resourceRef: '/api/v1/platform/rules/evaluate',
    resourceType: 'API',
  },
  {
    code: 'platform.job.read',
    name: '查看调度定义、运行与日志',
    resourceRef: '/api/v1/platform/jobs/*',
    resourceType: 'API',
  },
  {
    code: 'platform.job.write',
    name: '维护调度任务定义',
    resourceRef: '/api/v1/platform/jobs/definitions',
    resourceType: 'API',
  },
  {
    code: 'platform.job.trigger',
    name: '触发调度任务',
    resourceRef: '/api/v1/platform/jobs/definitions/*/runs',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.job.cancel',
    name: '取消调度任务运行',
    resourceRef: '/api/v1/platform/jobs/runs/*/cancel',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.job.process',
    name: '领取并回报调度任务',
    resourceRef: '/api/v1/platform/jobs/runs/*',
    resourceType: 'API',
  },
  {
    code: 'platform.admin.menu',
    name: '平台管理菜单',
    resourceRef: 'platform-admin',
    resourceType: 'MENU',
  },
  {
    code: 'platform.rbac.page',
    name: '组织与权限页面',
    resourceRef: 'platform-rbac',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.configuration.page',
    name: '配置中心页面',
    resourceRef: 'platform-configuration',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.audit.page',
    name: '审计查询页面',
    resourceRef: 'platform-audit',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.attachment.page',
    name: '附件中心页面',
    resourceRef: 'platform-attachments',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.inbox.page',
    name: '待办与消息中心页面',
    resourceRef: 'platform-inbox',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.data-exchange.page',
    name: '导入导出与统一搜索页面',
    resourceRef: 'platform-data-exchange',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.workflow.page',
    name: '流程定义与审批中心页面',
    resourceRef: 'platform-workflow',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.rule.page',
    name: '规则引擎与决策追踪页面',
    resourceRef: 'platform-rules',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.job.page',
    name: '调度任务中心页面',
    resourceRef: 'platform-jobs',
    resourceType: 'PAGE',
  },
  {
    code: 'platform.organization.move',
    name: '移动组织按钮',
    resourceRef: 'organization.move',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.configuration.publish',
    name: '发布与回滚配置按钮',
    resourceRef: 'configuration.publish',
    resourceType: 'BUTTON',
  },
  {
    code: 'platform.account.secret-field',
    name: '账号敏感字段',
    resourceRef: 'account.identitySource',
    resourceType: 'FIELD',
  },
  {
    code: 'platform.rbac.export',
    name: '导出权限配置',
    resourceRef: 'platform-rbac.csv',
    resourceType: 'EXPORT',
  },
  {
    code: 'platform.audit.export',
    name: '导出审计查询结果',
    resourceRef: 'platform-audit.csv',
    resourceType: 'EXPORT',
  },
] as const satisfies ReadonlyArray<{
  code: string;
  name: string;
  resourceRef: string;
  resourceType: PermissionResourceType;
}>;

export const READ_ONLY_AUDITOR_PERMISSION_CODES = [
  'platform.audit.read',
  'platform.audit.page',
  'platform.audit.export',
] as const;

export interface PermissionGrant {
  readonly effect: PermissionEffect;
  readonly organizationPath: string | undefined;
  readonly permissionCode: string;
}

export interface PermissionResolution {
  readonly allowed: boolean;
  readonly reason: 'EXPLICIT_DENY' | 'NO_MATCHING_GRANT' | 'ROLE_ALLOW';
}

export interface RoleTemplateLink {
  readonly id: string;
  readonly templateRoleId: string | null;
}

export function collectRoleLineage(
  roleId: string,
  roles: readonly RoleTemplateLink[],
): readonly string[] {
  const roleById = new Map(roles.map((role) => [role.id, role] as const));
  const lineage: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = roleId;
  while (currentId && !visited.has(currentId) && lineage.length < 16) {
    visited.add(currentId);
    lineage.push(currentId);
    currentId = roleById.get(currentId)?.templateRoleId ?? null;
  }
  return lineage;
}

export function resolvePermission(
  grants: readonly PermissionGrant[],
  permissionCode: string,
  targetOrganizationPath?: string,
): PermissionResolution {
  const matching = grants.filter(
    (grant) =>
      grant.permissionCode === permissionCode &&
      (targetOrganizationPath
        ? !grant.organizationPath ||
          targetOrganizationPath === grant.organizationPath ||
          targetOrganizationPath.startsWith(`${grant.organizationPath}/`)
        : !grant.organizationPath),
  );
  if (matching.some((grant) => grant.effect === 'DENY')) {
    return { allowed: false, reason: 'EXPLICIT_DENY' };
  }
  if (matching.some((grant) => grant.effect === 'ALLOW')) {
    return { allowed: true, reason: 'ROLE_ALLOW' };
  }
  return { allowed: false, reason: 'NO_MATCHING_GRANT' };
}

export function buildOrganizationPath(
  parentPath: string | undefined,
  organizationId: string,
): string {
  return parentPath ? `${parentPath}/${organizationId}` : `/${organizationId}`;
}
