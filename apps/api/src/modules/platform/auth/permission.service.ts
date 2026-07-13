import { Inject, Injectable } from '@nestjs/common';
import {
  collectRoleLineage,
  resolvePermission,
  type TenantContext,
} from '@scm/shared';
import { PrismaService } from '../../../database/prisma.service';

interface DecidePermissionInput {
  readonly context: TenantContext;
  readonly correlationId: string;
  readonly organizationId?: string;
  readonly permissionCode: string;
  readonly resourceRef?: string;
}

@Injectable()
export class PermissionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async decide(input: DecidePermissionInput) {
    const assignments = await this.prisma.accountRole.findMany({
      where: {
        accountId: input.context.accountId,
        status: 'ACTIVE',
        tenantId: input.context.tenantId,
      },
    });
    const roles = await this.prisma.role.findMany({
      where: { status: 'ACTIVE', tenantId: input.context.tenantId },
    });
    const chainsByAssignment = new Map<string, readonly string[]>();
    for (const assignment of assignments) {
      chainsByAssignment.set(
        assignment.id,
        collectRoleLineage(assignment.roleId, roles),
      );
    }
    const roleIds = new Set([...chainsByAssignment.values()].flat());

    const permission = await this.prisma.permission.findFirst({
      where: {
        code: input.permissionCode,
        status: 'ACTIVE',
        tenantId: input.context.tenantId,
      },
    });
    const rolePermissions = permission
      ? await this.prisma.rolePermission.findMany({
          where: {
            permissionId: permission.id,
            roleId: { in: [...roleIds] },
            status: 'ACTIVE',
            tenantId: input.context.tenantId,
          },
        })
      : [];
    const scopeIds = assignments
      .map(({ organizationId }) => organizationId)
      .filter((id): id is string => Boolean(id));
    const scopeOrganizations = await this.prisma.organization.findMany({
      where: { id: { in: scopeIds }, tenantId: input.context.tenantId },
    });
    const scopePath = new Map(
      scopeOrganizations.map(({ id, path }) => [id, path] as const),
    );
    const target = input.organizationId
      ? await this.prisma.organization.findFirst({
          where: { id: input.organizationId, tenantId: input.context.tenantId },
        })
      : undefined;
    const effectByRole = new Map(
      rolePermissions.map(({ effect, roleId }) => [roleId, effect] as const),
    );
    const grants = assignments.flatMap((assignment) => {
      return (chainsByAssignment.get(assignment.id) ?? [])
        .filter((roleId) => effectByRole.has(roleId))
        .map((roleId) => ({
          effect: effectByRole.get(roleId)!,
          organizationPath: assignment.organizationId
            ? scopePath.get(assignment.organizationId)
            : undefined,
          permissionCode: input.permissionCode,
        }));
    });
    const resolution = resolvePermission(
      grants,
      input.permissionCode,
      target?.path,
    );

    await this.prisma.permissionDecisionAudit.create({
      data: {
        accountId: input.context.accountId,
        correlationId: input.correlationId,
        createdBy: input.context.accountId,
        decision: resolution.allowed ? 'ALLOW' : 'DENY',
        organizationId: input.organizationId ?? null,
        permissionCode: input.permissionCode,
        reason: resolution.reason,
        resourceRef: input.resourceRef ?? null,
        tenantId: input.context.tenantId,
        updatedBy: input.context.accountId,
      },
    });
    return resolution;
  }
}
