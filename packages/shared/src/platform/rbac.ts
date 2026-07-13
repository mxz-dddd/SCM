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
    code: 'platform.organization.move',
    name: '移动组织按钮',
    resourceRef: 'organization.move',
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
] as const satisfies ReadonlyArray<{
  code: string;
  name: string;
  resourceRef: string;
  resourceType: PermissionResourceType;
}>;

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
