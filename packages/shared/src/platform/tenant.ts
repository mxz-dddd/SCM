export const TENANT_STATUSES = [
  'PROVISIONING',
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
] as const;

export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const ACCOUNT_KINDS = [
  'PLATFORM_ADMIN',
  'TENANT_ADMIN',
  'USER',
] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export interface SessionClaims {
  readonly accountKind: AccountKind;
  readonly deviceId: string;
  readonly expiresAt: number;
  readonly issuedAt: number;
  readonly organizationIds: readonly string[];
  readonly permissionVersion: number;
  readonly subject: string;
  readonly tenantId: string;
  readonly tokenId: string;
}

export interface TenantContext {
  readonly accountId: string;
  readonly accountKind: AccountKind;
  readonly deviceId: string;
  readonly organizationIds: readonly string[];
  readonly permissionVersion: number;
  readonly tenantId: string;
  readonly tokenId: string;
}

const TRANSITIONS: Readonly<Record<TenantStatus, readonly TenantStatus[]>> = {
  PROVISIONING: ['ACTIVE'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionTenant(
  current: TenantStatus,
  target: TenantStatus,
): boolean {
  return TRANSITIONS[current].includes(target);
}

export function assertTenantTransition(
  current: TenantStatus,
  target: TenantStatus,
): void {
  if (!canTransitionTenant(current, target)) {
    throw new Error(`Tenant transition ${current} -> ${target} is not allowed`);
  }
}
