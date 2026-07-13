import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  collectRoleLineage,
  dataScopeCacheKey,
  injectTenantAndDataScope,
  matchesDataScope,
  validateDataScopeExpression,
  type DataScopeExpression,
  type TenantContext,
} from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

interface CompiledPolicy {
  readonly expression: DataScopeExpression;
  readonly id: string;
}

export interface CreateDataPolicyInput {
  readonly code: string;
  readonly expression: unknown;
  readonly name: string;
  readonly priority?: number;
  readonly resource: string;
  readonly roleId: string;
}

export interface SimulateDataPolicyInput {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly resource: string;
}

@Injectable()
export class DataPolicyService {
  private readonly cache = new Map<string, readonly CompiledPolicy[]>();

  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  list(context: TenantContext) {
    return this.prisma.dataScopePolicy.findMany({
      orderBy: [{ resource: 'asc' }, { priority: 'asc' }, { code: 'asc' }],
      where: { tenantId: context.tenantId },
    });
  }

  async create(
    input: CreateDataPolicyInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.code.trim().toUpperCase();
    const resource = input.resource.trim();
    const validation = validateDataScopeExpression(input.expression);
    if (
      !/^[A-Z][A-Z0-9_.-]{2,99}$/.test(code) ||
      !input.name.trim() ||
      !resource ||
      !isUuid(input.roleId) ||
      !validation.valid ||
      !validation.expression
    ) {
      throw new AppError(
        'DATA_POLICY_EXPRESSION_INVALID',
        'Data policy metadata or expression is invalid',
        400,
        {
          fieldErrors: validation.errors.map((message) => ({
            field: 'expression',
            message,
          })),
        },
      );
    }
    const expression = validation.expression;
    if (
      input.priority !== undefined &&
      (!Number.isInteger(input.priority) || input.priority < 0)
    ) {
      throw new AppError(
        'DATA_POLICY_PRIORITY_INVALID',
        'priority must be a non-negative integer',
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
          scope: 'platform.data-policy.create.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          const role = await transaction.role.findFirst({
            where: {
              id: input.roleId,
              status: 'ACTIVE',
              tenantId: context.tenantId,
            },
          });
          if (!role) {
            throw new AppError('ROLE_NOT_FOUND', 'Role was not found', 404);
          }
          const policyId = randomUUID();
          await transaction.dataScopePolicy.create({
            data: {
              code,
              createdBy: context.accountId,
              expression: expression as unknown as Prisma.InputJsonObject,
              id: policyId,
              name: input.name.trim(),
              priority: input.priority ?? 100,
              resource,
              roleId: input.roleId,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          const roles = await transaction.role.findMany({
            where: { status: 'ACTIVE', tenantId: context.tenantId },
          });
          const affectedRoleIds = roles
            .filter((candidate) =>
              collectRoleLineage(candidate.id, roles).includes(input.roleId),
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
              action: 'data-policy.create',
              after: {
                code,
                expression,
                resource,
                roleId: input.roleId,
              } as unknown as Prisma.InputJsonObject,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              deviceId: context.deviceId,
              ipAddress: metadata.ipAddress ?? null,
              resourceId: policyId,
              resourceType: 'DataScopePolicy',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.platformOutbox.create({
            data: {
              aggregateId: policyId,
              aggregateType: 'DataScopePolicy',
              aggregateVersion: 1,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              eventName: 'platform.data-policy-created.v1',
              payload: { policyId, resource, roleId: input.roleId },
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          return { policyId, status: 'ACTIVE', version: 1 };
        },
      );
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        throw new AppError(
          'DATA_POLICY_DUPLICATE',
          'Data policy code already exists',
          409,
        );
      }
      throw error;
    }
  }

  async decide(
    input: SimulateDataPolicyInput,
    context: TenantContext,
    correlationId: string,
  ) {
    if (
      !input.resource?.trim() ||
      !input.attributes ||
      typeof input.attributes !== 'object' ||
      Array.isArray(input.attributes)
    ) {
      throw new AppError(
        'DATA_POLICY_SIMULATION_INVALID',
        'resource and an attributes object are required',
        400,
      );
    }
    const resource = input.resource.trim();
    const policies = await this.compiledPolicies(context, resource);
    const matchedPolicyIds = policies
      .filter(({ expression }) =>
        matchesDataScope(expression, input.attributes),
      )
      .map(({ id }) => id);
    const allowed = matchedPolicyIds.length > 0;
    const attributesHash = createHash('sha256')
      .update(JSON.stringify(input.attributes))
      .digest('hex');
    await this.prisma.dataPolicyDecisionAudit.create({
      data: {
        accountId: context.accountId,
        attributesHash,
        correlationId,
        createdBy: context.accountId,
        decision: allowed ? 'ALLOW' : 'DENY',
        matchedPolicyIds,
        permissionVersion: context.permissionVersion,
        reason: allowed ? 'POLICY_MATCH' : 'NO_MATCHING_POLICY',
        resource,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
    return {
      allowed,
      matchedPolicyIds,
      reason: allowed ? 'POLICY_MATCH' : 'NO_MATCHING_POLICY',
    };
  }

  async scopedWhere(
    context: TenantContext,
    resource: string,
    baseWhere: Readonly<Record<string, unknown>>,
  ) {
    const policies = await this.compiledPolicies(context, resource);
    const policyWhere = policies.map(({ expression }) => ({
      [expression.match === 'ALL' ? 'AND' : 'OR']: expression.conditions.map(
        (condition) => {
          if (condition.field.startsWith('custom.')) {
            const path = condition.field.slice('custom.'.length).split('.');
            return condition.operator === 'EQ'
              ? { extensionFields: { equals: condition.value, path } }
              : {
                  OR: (condition.value as readonly string[]).map((value) => ({
                    extensionFields: { equals: value, path },
                  })),
                };
          }
          return {
            [condition.field]:
              condition.operator === 'EQ'
                ? condition.value
                : { in: condition.value },
          };
        },
      ),
    }));
    return injectTenantAndDataScope(context.tenantId, baseWhere, {
      OR: policyWhere,
    });
  }

  private async compiledPolicies(
    context: TenantContext,
    resource: string,
  ): Promise<readonly CompiledPolicy[]> {
    const key = dataScopeCacheKey({
      accountId: context.accountId,
      permissionVersion: context.permissionVersion,
      resource,
      tenantId: context.tenantId,
    });
    const cached = this.cache.get(key);
    if (cached) return cached;
    const [assignments, roles] = await Promise.all([
      this.prisma.accountRole.findMany({
        where: {
          accountId: context.accountId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      }),
      this.prisma.role.findMany({
        where: { status: 'ACTIVE', tenantId: context.tenantId },
      }),
    ]);
    const roleIds = new Set(
      assignments.flatMap((assignment) =>
        collectRoleLineage(assignment.roleId, roles),
      ),
    );
    const stored = await this.prisma.dataScopePolicy.findMany({
      orderBy: { priority: 'asc' },
      where: {
        resource,
        roleId: { in: [...roleIds] },
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const compiled = stored.flatMap((policy) => {
      const validation = validateDataScopeExpression(policy.expression);
      return validation.valid && validation.expression
        ? [{ expression: validation.expression, id: policy.id }]
        : [];
    });
    this.cache.set(key, compiled);
    return compiled;
  }
}
