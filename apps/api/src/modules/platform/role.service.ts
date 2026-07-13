import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  collectRoleLineage,
  type PermissionEffect,
  type TenantContext,
} from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

export interface CreateRoleInput {
  readonly code: string;
  readonly description?: string;
  readonly isTemplate?: boolean;
  readonly name: string;
  readonly templateRoleId?: string;
}

export interface GrantPermissionsInput {
  readonly grants: ReadonlyArray<{
    readonly effect: PermissionEffect;
    readonly permissionCode: string;
  }>;
}

export interface AssignRoleInput {
  readonly accountId: string;
  readonly organizationId?: string;
}

@Injectable()
export class RoleService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async list(context: TenantContext) {
    const [roles, permissions] = await Promise.all([
      this.prisma.role.findMany({
        orderBy: { code: 'asc' },
        where: { tenantId: context.tenantId },
      }),
      this.prisma.permission.findMany({
        orderBy: [{ resourceType: 'asc' }, { code: 'asc' }],
        where: { tenantId: context.tenantId },
      }),
    ]);
    return { permissions, roles };
  }

  async create(
    input: CreateRoleInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_.-]{2,99}$/.test(code) || !input.name.trim()) {
      throw new AppError(
        'ROLE_INPUT_INVALID',
        'Role code and name are invalid',
        400,
      );
    }
    if (input.templateRoleId && !isUuid(input.templateRoleId)) {
      throw new AppError(
        'ROLE_TEMPLATE_INVALID',
        'templateRoleId must be a UUID',
        400,
      );
    }
    try {
      return await this.idempotency.execute(
        {
          actorId: context.accountId,
          key: metadata.idempotencyKey,
          payload: input,
          responseCode: 201,
          scope: 'platform.role.create.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          if (input.templateRoleId) {
            const template = await transaction.role.findFirst({
              where: {
                id: input.templateRoleId,
                isTemplate: true,
                status: 'ACTIVE',
                tenantId: context.tenantId,
              },
            });
            if (!template) {
              throw new AppError(
                'ROLE_TEMPLATE_NOT_FOUND',
                'Active role template was not found',
                404,
              );
            }
          }
          const roleId = randomUUID();
          await transaction.role.create({
            data: {
              code,
              createdBy: context.accountId,
              description: input.description?.trim() || null,
              id: roleId,
              isTemplate: input.isTemplate ?? false,
              name: input.name.trim(),
              templateRoleId: input.templateRoleId ?? null,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.platformAuditLog.create({
            data: {
              action: 'role.create',
              after: { code, templateRoleId: input.templateRoleId ?? null },
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              deviceId: context.deviceId,
              ipAddress: metadata.ipAddress ?? null,
              resourceId: roleId,
              resourceType: 'Role',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          return { roleId, status: 'ACTIVE', version: 1 };
        },
      );
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        throw new AppError('ROLE_DUPLICATE', 'Role code already exists', 409);
      }
      throw error;
    }
  }

  grant(
    roleId: string,
    input: GrantPermissionsInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!isUuid(roleId) || input.grants.length === 0) {
      throw new AppError(
        'ROLE_GRANTS_INVALID',
        'roleId and at least one grant are required',
        400,
      );
    }
    const codes = input.grants.map(({ permissionCode }) => permissionCode);
    if (
      input.grants.some(({ effect }) => effect !== 'ALLOW' && effect !== 'DENY')
    ) {
      throw new AppError(
        'ROLE_GRANT_EFFECT_INVALID',
        'Grant effect must be ALLOW or DENY',
        400,
      );
    }
    if (new Set(codes).size !== codes.length) {
      throw new AppError(
        'ROLE_GRANTS_DUPLICATE',
        'A permission can only appear once per command',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 200,
        scope: `platform.role.grant.v1:${roleId}`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const [role, permissions] = await Promise.all([
          transaction.role.findFirst({
            where: { id: roleId, tenantId: context.tenantId },
          }),
          transaction.permission.findMany({
            where: { code: { in: codes }, tenantId: context.tenantId },
          }),
        ]);
        if (!role)
          throw new AppError('ROLE_NOT_FOUND', 'Role was not found', 404);
        if (permissions.length !== codes.length) {
          throw new AppError(
            'PERMISSION_NOT_FOUND',
            'One or more permissions were not found',
            404,
          );
        }
        await transaction.rolePermission.deleteMany({
          where: {
            permissionId: { in: permissions.map(({ id }) => id) },
            roleId,
            tenantId: context.tenantId,
          },
        });
        const permissionByCode = new Map(
          permissions.map(
            (permission) => [permission.code, permission] as const,
          ),
        );
        await transaction.rolePermission.createMany({
          data: input.grants.map((grant) => ({
            createdBy: context.accountId,
            effect: grant.effect,
            permissionId: permissionByCode.get(grant.permissionCode)!.id,
            roleId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          })),
        });
        const tenantRoles = await transaction.role.findMany({
          where: { status: 'ACTIVE', tenantId: context.tenantId },
        });
        const affectedRoleIds = tenantRoles
          .filter((candidate) =>
            collectRoleLineage(candidate.id, tenantRoles).includes(roleId),
          )
          .map(({ id }) => id);
        const assignments = await transaction.accountRole.findMany({
          where: {
            roleId: { in: affectedRoleIds },
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        await transaction.account.updateMany({
          data: {
            permissionVersion: { increment: 1 },
            updatedBy: context.accountId,
          },
          where: {
            id: { in: assignments.map(({ accountId }) => accountId) },
            tenantId: context.tenantId,
          },
        });
        await transaction.platformAuditLog.create({
          data: {
            action: 'role.permissions.replace',
            after: { grants: input.grants },
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            ipAddress: metadata.ipAddress ?? null,
            resourceId: roleId,
            resourceType: 'Role',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await transaction.platformOutbox.create({
          data: {
            aggregateId: roleId,
            aggregateType: 'Role',
            aggregateVersion: role.version + 1,
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            eventName: 'platform.role-permissions-changed.v1',
            payload: { grants: input.grants, roleId },
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await transaction.role.update({
          data: { updatedBy: context.accountId, version: { increment: 1 } },
          where: { id: roleId },
        });
        return { roleId, version: role.version + 1 };
      },
    );
  }

  assign(
    roleId: string,
    input: AssignRoleInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !isUuid(roleId) ||
      !isUuid(input.accountId) ||
      (input.organizationId && !isUuid(input.organizationId))
    ) {
      throw new AppError(
        'ROLE_ASSIGNMENT_INVALID',
        'Role assignment IDs are invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: `platform.role.assign.v1:${roleId}`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const [role, account, organization] = await Promise.all([
          transaction.role.findFirst({
            where: { id: roleId, tenantId: context.tenantId },
          }),
          transaction.account.findFirst({
            where: { id: input.accountId, tenantId: context.tenantId },
          }),
          input.organizationId
            ? transaction.organization.findFirst({
                where: { id: input.organizationId, tenantId: context.tenantId },
              })
            : null,
        ]);
        if (!role)
          throw new AppError('ROLE_NOT_FOUND', 'Role was not found', 404);
        if (!account)
          throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found', 404);
        if (input.organizationId && !organization) {
          throw new AppError(
            'ORGANIZATION_NOT_FOUND',
            'Organization was not found',
            404,
          );
        }
        const existing = await transaction.accountRole.findFirst({
          where: {
            accountId: input.accountId,
            organizationId: input.organizationId ?? null,
            roleId,
            tenantId: context.tenantId,
          },
        });
        const assignmentId = existing?.id ?? randomUUID();
        if (!existing) {
          await transaction.accountRole.create({
            data: {
              accountId: input.accountId,
              createdBy: context.accountId,
              id: assignmentId,
              organizationId: input.organizationId ?? null,
              roleId,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.account.update({
            data: {
              permissionVersion: { increment: 1 },
              updatedBy: context.accountId,
            },
            where: { id: input.accountId },
          });
        }
        await transaction.platformAuditLog.create({
          data: {
            action: 'account.role.assign',
            after: {
              accountId: input.accountId,
              organizationId: input.organizationId ?? null,
              roleId,
            },
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            ipAddress: metadata.ipAddress ?? null,
            resourceId: input.accountId,
            resourceType: 'Account',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        return { assignmentId, created: !existing, roleId };
      },
    );
  }
}
