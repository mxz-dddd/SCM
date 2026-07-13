import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_PERMISSIONS,
  TENANT_STATUSES,
  assertTenantTransition,
  type TenantContext,
  type TenantStatus,
} from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { isUuid } from '../../common/validation';
import { hashPassword } from './auth/password';
import { requireAccountKind } from './auth/authorization';
import { IdempotencyService } from './idempotency.service';

export interface ProvisionTenantInput {
  readonly code: string;
  readonly currency: string;
  readonly defaultLocale: string;
  readonly initialAdmin: {
    readonly displayName: string;
    readonly email?: string;
    readonly password: string;
    readonly username: string;
  };
  readonly isolationMode:
    'SHARED_SCHEMA' | 'DEDICATED_SCHEMA' | 'DEDICATED_DATABASE';
  readonly name: string;
  readonly planCapabilities?: Readonly<Record<string, unknown>>;
  readonly timezone: string;
}

export interface TransitionTenantInput {
  readonly expectedVersion: number;
  readonly reason?: string;
  readonly targetStatus: TenantStatus;
}

export interface CommandMetadata {
  readonly correlationId: string;
  readonly idempotencyKey: string | undefined;
  readonly ipAddress: string | undefined;
}

@Injectable()
export class TenantService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  async provision(
    input: ProvisionTenantInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    requireAccountKind(context, ['PLATFORM_ADMIN']);
    this.validateProvisioning(input);
    const passwordHash = await hashPassword(input.initialAdmin.password);

    try {
      return await this.idempotency.execute(
        {
          actorId: context.accountId,
          key: metadata.idempotencyKey,
          payload: input,
          responseCode: 201,
          scope: 'platform.tenant.provision.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          const tenantId = randomUUID();
          const organizationId = randomUUID();
          const personId = randomUUID();
          const accountId = randomUUID();
          const administratorRoleId = randomUUID();
          const code = input.code.trim().toUpperCase();
          const username = input.initialAdmin.username.trim().toLowerCase();

          await transaction.tenant.create({
            data: {
              code,
              createdBy: context.accountId,
              currency: input.currency,
              defaultLocale: input.defaultLocale,
              id: tenantId,
              isolationMode: input.isolationMode,
              name: input.name.trim(),
              planCapabilities: (input.planCapabilities ??
                {}) as Prisma.InputJsonObject,
              tenantId,
              timezone: input.timezone,
              updatedBy: context.accountId,
            },
          });
          await transaction.organization.create({
            data: {
              code: 'ROOT',
              createdBy: context.accountId,
              id: organizationId,
              name: input.name.trim(),
              path: `/${organizationId}`,
              tenantId,
              type: 'GROUP',
              updatedBy: context.accountId,
            },
          });
          await transaction.person.create({
            data: {
              createdBy: context.accountId,
              displayName: input.initialAdmin.displayName.trim(),
              email: input.initialAdmin.email ?? null,
              employeeNo: 'INITIAL-ADMIN',
              id: personId,
              tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.account.create({
            data: {
              createdBy: context.accountId,
              id: accountId,
              kind: 'TENANT_ADMIN',
              passwordHash,
              tenantId,
              updatedBy: context.accountId,
              username,
            },
          });
          await transaction.identityBinding.create({
            data: {
              accountId,
              createdBy: context.accountId,
              organizationId,
              personId,
              tenantId,
              updatedBy: context.accountId,
            },
          });
          const permissions = ADMIN_PERMISSIONS.map((permission) => ({
            ...permission,
            id: randomUUID(),
          }));
          await transaction.permission.createMany({
            data: permissions.map((permission) => ({
              code: permission.code,
              createdBy: context.accountId,
              id: permission.id,
              name: permission.name,
              resourceRef: permission.resourceRef,
              resourceType: permission.resourceType,
              tenantId,
              updatedBy: context.accountId,
            })),
          });
          await transaction.role.create({
            data: {
              code: 'TENANT_ADMINISTRATOR',
              createdBy: context.accountId,
              id: administratorRoleId,
              name: 'Tenant Administrator',
              tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.rolePermission.createMany({
            data: permissions.map((permission) => ({
              createdBy: context.accountId,
              effect: 'ALLOW' as const,
              permissionId: permission.id,
              roleId: administratorRoleId,
              tenantId,
              updatedBy: context.accountId,
            })),
          });
          await transaction.accountRole.create({
            data: {
              accountId,
              createdBy: context.accountId,
              organizationId: null,
              roleId: administratorRoleId,
              tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.platformAuditLog.create({
            data: {
              action: 'tenant.provision',
              after: { code, status: 'PROVISIONING', version: 1 },
              before: Prisma.DbNull,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              deviceId: context.deviceId,
              ipAddress: metadata.ipAddress ?? null,
              resourceId: tenantId,
              resourceType: 'Tenant',
              tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.platformOutbox.create({
            data: {
              aggregateId: tenantId,
              aggregateType: 'Tenant',
              aggregateVersion: 1,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              eventName: 'platform.tenant-provisioned.v1',
              payload: {
                code,
                organizationId,
                status: 'PROVISIONING',
                tenantId,
              },
              tenantId,
              updatedBy: context.accountId,
            },
          });

          return {
            adminAccountId: accountId,
            organizationId,
            status: 'PROVISIONING',
            tenantId,
            version: 1,
          };
        },
      );
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        throw new AppError(
          'TENANT_DUPLICATE',
          'Tenant code or initial administrator already exists',
          409,
        );
      }
      throw error;
    }
  }

  transition(
    tenantId: string,
    input: TransitionTenantInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    requireAccountKind(context, ['PLATFORM_ADMIN']);
    if (!isUuid(tenantId)) {
      throw new AppError('TENANT_ID_INVALID', 'tenantId must be a UUID', 400);
    }
    if (!TENANT_STATUSES.includes(input.targetStatus)) {
      throw new AppError(
        'TENANT_STATUS_INVALID',
        'Target status is invalid',
        400,
      );
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new AppError(
        'TENANT_VERSION_INVALID',
        'expectedVersion must be a positive integer',
        400,
      );
    }

    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 200,
        scope: `platform.tenant.transition.v1:${tenantId}`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const tenant = await transaction.tenant.findUnique({
          where: { id: tenantId },
        });
        if (!tenant) {
          throw new AppError('TENANT_NOT_FOUND', 'Tenant was not found', 404);
        }
        try {
          assertTenantTransition(tenant.status, input.targetStatus);
        } catch (error) {
          throw new AppError(
            'TENANT_TRANSITION_INVALID',
            error instanceof Error
              ? error.message
              : 'Tenant transition is invalid',
            409,
          );
        }
        if (tenant.version !== input.expectedVersion) {
          throw new AppError(
            'TENANT_VERSION_CONFLICT',
            'Tenant version changed; reload before retrying',
            409,
          );
        }

        const nextVersion = tenant.version + 1;
        const updated = await transaction.tenant.updateMany({
          data: {
            archivedAt:
              input.targetStatus === 'ARCHIVED'
                ? new Date()
                : tenant.archivedAt,
            status: input.targetStatus,
            suspendedReason:
              input.targetStatus === 'SUSPENDED'
                ? (input.reason ?? null)
                : null,
            updatedBy: context.accountId,
            version: nextVersion,
          },
          where: {
            id: tenantId,
            status: tenant.status,
            version: tenant.version,
          },
        });
        if (updated.count !== 1) {
          throw new AppError(
            'TENANT_VERSION_CONFLICT',
            'Tenant version changed; reload before retrying',
            409,
          );
        }
        await transaction.platformAuditLog.create({
          data: {
            action: 'tenant.transition',
            after: { status: input.targetStatus, version: nextVersion },
            before: { status: tenant.status, version: tenant.version },
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            ipAddress: metadata.ipAddress ?? null,
            resourceId: tenantId,
            resourceType: 'Tenant',
            tenantId: tenant.tenantId,
            updatedBy: context.accountId,
          },
        });
        await transaction.platformOutbox.create({
          data: {
            aggregateId: tenantId,
            aggregateType: 'Tenant',
            aggregateVersion: nextVersion,
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            eventName: 'platform.tenant-status-changed.v1',
            payload: {
              from: tenant.status,
              reason: input.reason ?? null,
              tenantId,
              to: input.targetStatus,
            },
            tenantId: tenant.tenantId,
            updatedBy: context.accountId,
          },
        });

        return {
          status: input.targetStatus,
          tenantId,
          version: nextVersion,
        };
      },
    );
  }

  private validateProvisioning(input: ProvisionTenantInput): void {
    const fieldErrors: Array<{ field: string; message: string }> = [];
    if (!/^[A-Z][A-Z0-9_-]{2,49}$/.test(input.code.trim().toUpperCase())) {
      fieldErrors.push({
        field: 'code',
        message: 'Use 3-50 letters, digits, _ or -',
      });
    }
    if (!input.name.trim())
      fieldErrors.push({ field: 'name', message: 'Required' });
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      fieldErrors.push({
        field: 'currency',
        message: 'Use an uppercase ISO code',
      });
    }
    if (!input.initialAdmin.username.trim()) {
      fieldErrors.push({ field: 'initialAdmin.username', message: 'Required' });
    }
    if (!input.initialAdmin.displayName.trim()) {
      fieldErrors.push({
        field: 'initialAdmin.displayName',
        message: 'Required',
      });
    }
    if (
      !['SHARED_SCHEMA', 'DEDICATED_SCHEMA', 'DEDICATED_DATABASE'].includes(
        input.isolationMode,
      )
    ) {
      fieldErrors.push({
        field: 'isolationMode',
        message: 'Unsupported isolation mode',
      });
    }
    if (fieldErrors.length > 0) {
      throw new AppError(
        'TENANT_INPUT_INVALID',
        'Tenant input is invalid',
        400,
        {
          fieldErrors,
        },
      );
    }
  }
}
