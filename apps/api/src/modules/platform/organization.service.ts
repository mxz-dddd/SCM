import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { buildOrganizationPath, type TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

const ORGANIZATION_TYPES = [
  'GROUP',
  'LEGAL_ENTITY',
  'BUSINESS_UNIT',
  'WAREHOUSE',
  'TRANSPORT',
] as const;

type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export function wouldCreateOrganizationCycle(
  parentById: ReadonlyMap<string, string | null>,
  organizationId: string,
  targetParentId: string | null,
): boolean {
  const visited = new Set<string>();
  let current = targetParentId;
  while (current) {
    if (current === organizationId) return true;
    if (visited.has(current)) return true;
    visited.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}

export interface CreateOrganizationInput {
  readonly code: string;
  readonly name: string;
  readonly parentId?: string;
  readonly type: OrganizationType;
}

export interface MoveOrganizationInput {
  readonly expectedVersion: number;
  readonly targetParentId: string | null;
}

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  list(context: TenantContext) {
    return this.prisma.organization.findMany({
      orderBy: [{ path: 'asc' }, { code: 'asc' }],
      where: { tenantId: context.tenantId },
    });
  }

  async create(
    input: CreateOrganizationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_-]{1,49}$/.test(code) || !input.name.trim()) {
      throw new AppError(
        'ORGANIZATION_INPUT_INVALID',
        'Organization code and name are invalid',
        400,
      );
    }
    if (!ORGANIZATION_TYPES.includes(input.type)) {
      throw new AppError(
        'ORGANIZATION_TYPE_INVALID',
        'Organization type is invalid',
        400,
      );
    }
    if (input.parentId && !isUuid(input.parentId)) {
      throw new AppError(
        'ORGANIZATION_PARENT_INVALID',
        'parentId must be a UUID',
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
          scope: 'platform.organization.create.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          const parent = input.parentId
            ? await transaction.organization.findFirst({
                where: {
                  id: input.parentId,
                  tenantId: context.tenantId,
                },
              })
            : null;
          if (input.parentId && !parent) {
            throw new AppError(
              'ORGANIZATION_PARENT_NOT_FOUND',
              'Parent organization was not found',
              404,
            );
          }
          if (parent?.pathRebuildStatus !== 'CURRENT') {
            throw new AppError(
              'ORGANIZATION_PATH_PENDING',
              'Parent organization path is being rebuilt',
              409,
            );
          }
          const organizationId = randomUUID();
          const path = buildOrganizationPath(parent?.path, organizationId);
          await transaction.organization.create({
            data: {
              code,
              createdBy: context.accountId,
              id: organizationId,
              name: input.name.trim(),
              parentId: input.parentId ?? null,
              path,
              tenantId: context.tenantId,
              type: input.type,
              updatedBy: context.accountId,
            },
          });
          await transaction.platformAuditLog.create({
            data: {
              action: 'organization.create',
              after: { code, parentId: input.parentId ?? null, path },
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              deviceId: context.deviceId,
              ipAddress: metadata.ipAddress ?? null,
              resourceId: organizationId,
              resourceType: 'Organization',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          return { organizationId, path, status: 'ACTIVE', version: 1 };
        },
      );
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        throw new AppError(
          'ORGANIZATION_DUPLICATE',
          'Organization code already exists in this tenant',
          409,
        );
      }
      throw error;
    }
  }

  async move(
    organizationId: string,
    input: MoveOrganizationInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (
      !isUuid(organizationId) ||
      (input.targetParentId !== null && !isUuid(input.targetParentId))
    ) {
      throw new AppError(
        'ORGANIZATION_ID_INVALID',
        'Organization identifiers must be UUIDs',
        400,
      );
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new AppError(
        'ORGANIZATION_VERSION_INVALID',
        'expectedVersion must be a positive integer',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 202,
        scope: `platform.organization.move.v1:${organizationId}`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const organizations = await transaction.organization.findMany({
          where: { tenantId: context.tenantId },
        });
        const organization = organizations.find(
          ({ id }) => id === organizationId,
        );
        if (!organization) {
          throw new AppError(
            'ORGANIZATION_NOT_FOUND',
            'Organization was not found',
            404,
          );
        }
        const targetParent = input.targetParentId
          ? organizations.find(({ id }) => id === input.targetParentId)
          : undefined;
        if (input.targetParentId && !targetParent) {
          throw new AppError(
            'ORGANIZATION_PARENT_NOT_FOUND',
            'Target parent organization was not found',
            404,
          );
        }
        const parentById = new Map(
          organizations.map(({ id, parentId }) => [id, parentId] as const),
        );
        if (
          wouldCreateOrganizationCycle(
            parentById,
            organizationId,
            input.targetParentId,
          )
        ) {
          throw new AppError(
            'ORGANIZATION_CYCLE',
            'An organization cannot be moved below itself or its descendants',
            409,
          );
        }
        if (
          targetParent?.pathRebuildStatus !== undefined &&
          targetParent.pathRebuildStatus !== 'CURRENT'
        ) {
          throw new AppError(
            'ORGANIZATION_PATH_PENDING',
            'Target parent path is being rebuilt',
            409,
          );
        }
        const updated = await transaction.organization.updateMany({
          data: {
            parentId: input.targetParentId,
            pathRebuildStatus: 'PENDING',
            updatedBy: context.accountId,
            version: organization.version + 1,
          },
          where: {
            id: organizationId,
            tenantId: context.tenantId,
            version: input.expectedVersion,
          },
        });
        if (updated.count !== 1) {
          throw new AppError(
            'ORGANIZATION_VERSION_CONFLICT',
            'Organization version changed; reload before retrying',
            409,
          );
        }
        await transaction.platformAuditLog.create({
          data: {
            action: 'organization.move',
            after: { parentId: input.targetParentId, pathStatus: 'PENDING' },
            before: {
              parentId: organization.parentId,
              path: organization.path,
              version: organization.version,
            },
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            ipAddress: metadata.ipAddress ?? null,
            resourceId: organizationId,
            resourceType: 'Organization',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await transaction.platformOutbox.create({
          data: {
            aggregateId: organizationId,
            aggregateType: 'Organization',
            aggregateVersion: organization.version + 1,
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            eventName: 'platform.organization-path-rebuild-requested.v1',
            payload: {
              organizationId,
              targetParentId: input.targetParentId,
              tenantId: context.tenantId,
            },
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        return {
          organizationId,
          pathStatus: 'PENDING',
          version: organization.version + 1,
        };
      },
    );
  }

  async rebuildPath(
    tenantId: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const organizations = await this.prisma.organization.findMany({
      where: { tenantId },
    });
    const root = organizations.find(({ id }) => id === organizationId);
    if (!root) return;
    const parent = root.parentId
      ? organizations.find(({ id }) => id === root.parentId)
      : undefined;
    const paths = new Map<string, string>();
    paths.set(root.id, buildOrganizationPath(parent?.path, root.id));
    const pending = new Set([root.id]);
    while (pending.size > 0) {
      const parentId = pending.values().next().value as string;
      pending.delete(parentId);
      for (const child of organizations.filter(
        ({ parentId: candidate }) => candidate === parentId,
      )) {
        paths.set(
          child.id,
          buildOrganizationPath(paths.get(parentId), child.id),
        );
        pending.add(child.id);
      }
    }
    await this.prisma.$transaction(
      [...paths].map(([id, path]) =>
        this.prisma.organization.update({
          data: { path, pathRebuildStatus: 'CURRENT', updatedBy: actorId },
          where: { id },
        }),
      ),
    );
  }
}
