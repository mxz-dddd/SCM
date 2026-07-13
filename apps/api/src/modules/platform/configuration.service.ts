import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type ConfigPublishAction,
  type ConfigScopeType,
  type ConfigVersionStatus,
  type RecordStatus,
  type SequenceResetPeriod,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;

export interface CreateConfigDraftInput {
  readonly configKey: string;
  readonly dependencyKeys?: readonly string[];
  readonly scopeRef?: string;
  readonly scopeType: ConfigScopeType;
  readonly values: JsonObject;
}

export interface PublishConfigInput {
  readonly effectiveFrom?: string;
  readonly expectedVersion: number;
  readonly rolloutPercentage?: number;
}

export interface RollbackConfigInput {
  readonly expectedVersion: number;
}

export interface ResolveConfigInput {
  readonly configKey: string;
  readonly customerId?: string;
  readonly organizationId?: string;
  readonly rolloutKey?: string;
  readonly warehouseId?: string;
}

export interface ListConfigurationQuery {
  readonly page?: number | string;
  readonly pageSize?: number | string;
  readonly search?: string;
}

export interface CreateDictionaryInput {
  readonly category: string;
  readonly code: string;
  readonly description?: string;
  readonly items: readonly {
    readonly code: string;
    readonly metadata?: JsonObject;
    readonly name: string;
    readonly requiresAttachment?: boolean;
    readonly requiresRemark?: boolean;
    readonly sortOrder?: number;
  }[];
  readonly name: string;
}

export interface ChangeDictionaryItemStatusInput {
  readonly expectedVersion: number;
  readonly status: RecordStatus;
}

export interface ValidateReasonUseInput {
  readonly attachmentIds?: readonly string[];
  readonly forNewUse?: boolean;
  readonly remark?: string;
}

export interface CreateNumberRuleInput {
  readonly blockSize?: number;
  readonly businessType: string;
  readonly organizationRef?: string;
  readonly prefixTemplate: string;
  readonly resetPeriod?: SequenceResetPeriod;
  readonly sequenceWidth?: number;
}

export interface ResolveLayer {
  readonly id: string;
  readonly rolloutPercentage: number;
  readonly scopeRef: string;
  readonly scopeType: ConfigScopeType;
  readonly values: JsonObject;
  readonly versionNumber: number;
}

const CONFIG_KEY_PATTERN = /^[a-z][a-z0-9_.-]{2,149}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{1,99}$/;
const CONFIG_SCOPE_PRIORITY: Readonly<Record<ConfigScopeType, number>> = {
  TENANT: 0,
  ORGANIZATION: 1,
  WAREHOUSE: 2,
  CUSTOMER: 3,
};

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePage(query: ListConfigurationQuery) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new AppError(
      'PAGINATION_INVALID',
      'page and pageSize must be bounded positive integers',
      400,
    );
  }
  return { page, pageSize };
}

function normalizeScope(scopeType: ConfigScopeType, scopeRef?: string): string {
  if (scopeType === 'TENANT') return '*';
  const normalized = scopeRef?.trim() ?? '';
  if (!isUuid(normalized)) {
    throw new AppError(
      'CONFIG_SCOPE_INVALID',
      'Non-tenant configuration scopes require a UUID scopeRef',
      400,
    );
  }
  return normalized;
}

export function configurationScopeAllowed(
  context: TenantContext,
  scopeType: ConfigScopeType,
  scopeRef: string,
): boolean {
  if (
    context.accountKind === 'PLATFORM_ADMIN' ||
    context.accountKind === 'TENANT_ADMIN' ||
    scopeType === 'TENANT'
  ) {
    return true;
  }
  if (scopeType === 'ORGANIZATION' || scopeType === 'WAREHOUSE') {
    return context.organizationIds.includes(scopeRef);
  }
  return false;
}

export function assertConfigTransition(
  current: ConfigVersionStatus,
  target: ConfigVersionStatus,
  action: ConfigPublishAction,
): void {
  const allowed =
    (action === 'PUBLISH' && current === 'DRAFT' && target === 'PUBLISHED') ||
    (action === 'ROLLBACK' && current === 'RETIRED' && target === 'PUBLISHED');
  if (!allowed) {
    throw new AppError(
      'CONFIG_TRANSITION_INVALID',
      `Configuration transition ${current} -> ${target} is not allowed for ${action}`,
      409,
    );
  }
}

export function configurationDifference(before: JsonObject, after: JsonObject) {
  const keys = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort();
  return {
    added: keys.filter((key) => !(key in before) && key in after),
    changed: keys.filter(
      (key) =>
        key in before &&
        key in after &&
        JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    ),
    removed: keys.filter((key) => key in before && !(key in after)),
  };
}

function rolloutAllows(
  versionId: string,
  rolloutKey: string,
  percentage: number,
) {
  if (percentage >= 100) return true;
  const bucket =
    Number.parseInt(
      createHash('sha256')
        .update(`${versionId}:${rolloutKey}`)
        .digest('hex')
        .slice(0, 8),
      16,
    ) % 100;
  return bucket < percentage;
}

export function resolveConfigurationLayers(
  layers: readonly ResolveLayer[],
  input: ResolveConfigInput,
) {
  const matchingScopeRefs = new Map<ConfigScopeType, string | undefined>([
    ['TENANT', '*'],
    ['ORGANIZATION', input.organizationId],
    ['WAREHOUSE', input.warehouseId],
    ['CUSTOMER', input.customerId],
  ]);
  const applicable = layers
    .filter(
      (layer) => matchingScopeRefs.get(layer.scopeType) === layer.scopeRef,
    )
    .filter(
      (layer) =>
        layer.rolloutPercentage === 100 ||
        (input.rolloutKey !== undefined &&
          rolloutAllows(layer.id, input.rolloutKey, layer.rolloutPercentage)),
    )
    .sort(
      (left, right) =>
        CONFIG_SCOPE_PRIORITY[left.scopeType] -
          CONFIG_SCOPE_PRIORITY[right.scopeType] ||
        left.versionNumber - right.versionNumber,
    );
  return {
    appliedVersionIds: applicable.map(({ id }) => id),
    values: Object.assign(
      {},
      ...applicable.map(({ values }) => values),
    ) as JsonObject,
  };
}

export function validateReasonEvidence(
  item: {
    readonly requiresAttachment: boolean;
    readonly requiresRemark: boolean;
    readonly status: RecordStatus;
  },
  input: ValidateReasonUseInput,
): readonly string[] {
  const errors: string[] = [];
  if ((input.forNewUse ?? true) && item.status !== 'ACTIVE') {
    errors.push('DICTIONARY_ITEM_INACTIVE');
  }
  if (item.requiresRemark && !input.remark?.trim()) {
    errors.push('REMARK_REQUIRED');
  }
  if (item.requiresAttachment && !(input.attachmentIds?.length ?? 0)) {
    errors.push('ATTACHMENT_REQUIRED');
  }
  return errors;
}

export function assertDictionaryItemTransition(
  current: RecordStatus,
  target: RecordStatus,
): void {
  if (current === target) {
    throw new AppError(
      'DICTIONARY_TRANSITION_INVALID',
      'Dictionary item is already in that status',
      409,
    );
  }
}

export function sequencePeriodKey(
  resetPeriod: SequenceResetPeriod,
  at: Date,
): string {
  const year = String(at.getUTCFullYear());
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  const day = String(at.getUTCDate()).padStart(2, '0');
  if (resetPeriod === 'NEVER') return 'ALL';
  if (resetPeriod === 'YEARLY') return year;
  if (resetPeriod === 'MONTHLY') return `${year}${month}`;
  return `${year}${month}${day}`;
}

export function formatReservedNumber(input: {
  readonly at: Date;
  readonly businessType: string;
  readonly organizationRef: string;
  readonly prefixTemplate: string;
  readonly sequence: bigint;
  readonly sequenceWidth: number;
}): string {
  const year = String(input.at.getUTCFullYear());
  const month = String(input.at.getUTCMonth() + 1).padStart(2, '0');
  const day = String(input.at.getUTCDate()).padStart(2, '0');
  const prefix = input.prefixTemplate
    .replaceAll('{YYYY}', year)
    .replaceAll('{YY}', year.slice(-2))
    .replaceAll('{MM}', month)
    .replaceAll('{DD}', day)
    .replaceAll(
      '{ORG}',
      input.organizationRef === '*' ? '' : input.organizationRef,
    )
    .replaceAll('{TYPE}', input.businessType);
  return `${prefix}${String(input.sequence).padStart(input.sequenceWidth, '0')}`;
}

@Injectable()
export class ConfigurationService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listConfigVersions(
    context: TenantContext,
    query: ListConfigurationQuery,
  ) {
    const { page, pageSize } = normalizePage(query);
    const search = query.search?.trim();
    const scopeWhere =
      context.accountKind === 'USER'
        ? {
            OR: [
              { scopeType: 'TENANT' as const },
              {
                scopeRef: { in: [...context.organizationIds] },
                scopeType: {
                  in: ['ORGANIZATION', 'WAREHOUSE'] as ConfigScopeType[],
                },
              },
            ],
          }
        : {};
    const where = {
      ...(search
        ? { configKey: { contains: search, mode: 'insensitive' as const } }
        : {}),
      ...scopeWhere,
      tenantId: context.tenantId,
    };
    const [items, total] = await Promise.all([
      this.prisma.configVersion.findMany({
        orderBy: [
          { configKey: 'asc' },
          { scopeType: 'asc' },
          { scopeRef: 'asc' },
          { versionNumber: 'desc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      this.prisma.configVersion.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async previewConfig(configVersionId: string, context: TenantContext) {
    const candidate = await this.findConfig(configVersionId, context);
    const previous = await this.prisma.configVersion.findFirst({
      orderBy: { versionNumber: 'desc' },
      where: {
        configKey: candidate.configKey,
        id: { not: candidate.id },
        scopeRef: candidate.scopeRef,
        scopeType: candidate.scopeType,
        status: 'PUBLISHED',
        tenantId: context.tenantId,
      },
    });
    return {
      configVersionId,
      dependencies: candidate.dependencyKeys,
      difference: configurationDifference(
        (previous?.values ?? {}) as JsonObject,
        candidate.values as JsonObject,
      ),
      previousVersionId: previous?.id ?? null,
    };
  }

  createConfigDraft(
    input: CreateConfigDraftInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const configKey = input.configKey?.trim().toLowerCase();
    if (
      !['TENANT', 'ORGANIZATION', 'WAREHOUSE', 'CUSTOMER'].includes(
        input.scopeType,
      )
    ) {
      throw new AppError(
        'CONFIG_SCOPE_INVALID',
        'Configuration scopeType is invalid',
        400,
      );
    }
    const scopeRef = normalizeScope(input.scopeType, input.scopeRef);
    const dependencies = [...new Set(input.dependencyKeys ?? [])].sort();
    if (
      !CONFIG_KEY_PATTERN.test(configKey) ||
      !isJsonObject(input.values) ||
      dependencies.some((dependency) => !CONFIG_KEY_PATTERN.test(dependency))
    ) {
      throw new AppError(
        'CONFIG_DRAFT_INVALID',
        'Configuration key, values or dependencies are invalid',
        400,
      );
    }
    this.assertScope(context, input.scopeType, scopeRef);
    return this.idempotency
      .execute(
        {
          actorId: context.accountId,
          key: metadata.idempotencyKey,
          payload: input,
          responseCode: 201,
          scope: 'platform.config-version.create.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          const latest = await transaction.configVersion.findFirst({
            orderBy: { versionNumber: 'desc' },
            where: {
              configKey,
              scopeRef,
              scopeType: input.scopeType,
              tenantId: context.tenantId,
            },
          });
          const configVersionId = randomUUID();
          const versionNumber = (latest?.versionNumber ?? 0) + 1;
          await transaction.configVersion.create({
            data: {
              configKey,
              createdBy: context.accountId,
              dependencyKeys: dependencies,
              id: configVersionId,
              scopeRef,
              scopeType: input.scopeType,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
              values: input.values as Prisma.InputJsonObject,
              versionNumber,
            },
          });
          await transaction.platformAuditLog.create({
            data: {
              action: 'configuration.draft.create',
              after: {
                configKey,
                scopeRef,
                scopeType: input.scopeType,
                versionNumber,
              },
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              deviceId: context.deviceId,
              ipAddress: metadata.ipAddress ?? null,
              resourceId: configVersionId,
              resourceType: 'ConfigVersion',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.platformOutbox.create({
            data: {
              aggregateId: configVersionId,
              aggregateType: 'ConfigVersion',
              aggregateVersion: 1,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              eventName: 'platform.config-draft-created.v1',
              payload: {
                configKey,
                configVersionId,
                scopeRef,
                scopeType: input.scopeType,
                versionNumber,
              },
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          return {
            accepted: true,
            configVersionId,
            status: 'DRAFT',
            version: 1,
            versionNumber,
          };
        },
      )
      .catch(mapConfigurationPrismaError);
  }

  publishConfig(
    configVersionId: string,
    input: PublishConfigInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateExpectedVersion(input.expectedVersion);
    const rolloutPercentage = input.rolloutPercentage ?? 100;
    if (
      !Number.isInteger(rolloutPercentage) ||
      rolloutPercentage < 1 ||
      rolloutPercentage > 100
    ) {
      throw new AppError(
        'CONFIG_ROLLOUT_INVALID',
        'rolloutPercentage must be an integer from 1 through 100',
        400,
      );
    }
    const effectiveFrom = input.effectiveFrom
      ? new Date(input.effectiveFrom)
      : new Date();
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new AppError(
        'CONFIG_EFFECTIVE_TIME_INVALID',
        'effectiveFrom is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { configVersionId, ...input },
        responseCode: 200,
        scope: `platform.config-version.publish.v1:${configVersionId}`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const candidate = await transaction.configVersion.findFirst({
          where: { id: configVersionId, tenantId: context.tenantId },
        });
        if (!candidate)
          throw new AppError(
            'CONFIG_VERSION_NOT_FOUND',
            'Config version was not found',
            404,
          );
        this.assertScope(context, candidate.scopeType, candidate.scopeRef);
        assertConfigTransition(candidate.status, 'PUBLISHED', 'PUBLISH');
        if (candidate.version !== input.expectedVersion) {
          throw new AppError(
            'CONFIG_VERSION_CONFLICT',
            'Config version changed before publication',
            409,
          );
        }
        const dependencies = candidate.dependencyKeys as string[];
        if (dependencies.length > 0) {
          const publishedDependencies =
            await transaction.configVersion.findMany({
              distinct: ['configKey'],
              select: { configKey: true },
              where: {
                configKey: { in: dependencies },
                status: 'PUBLISHED',
                tenantId: context.tenantId,
              },
            });
          const found = new Set(
            publishedDependencies.map(({ configKey }) => configKey),
          );
          const missing = dependencies.filter(
            (dependency) => !found.has(dependency),
          );
          if (missing.length > 0) {
            throw new AppError(
              'CONFIG_DEPENDENCY_MISSING',
              `Published dependencies are missing: ${missing.join(', ')}`,
              409,
            );
          }
        }
        const previous = await transaction.configVersion.findFirst({
          orderBy: { versionNumber: 'desc' },
          where: {
            configKey: candidate.configKey,
            scopeRef: candidate.scopeRef,
            scopeType: candidate.scopeType,
            status: 'PUBLISHED',
            tenantId: context.tenantId,
          },
        });
        if (previous) {
          await transaction.configVersion.update({
            data: {
              status: 'RETIRED',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: previous.id },
          });
        }
        const nextVersion = candidate.version + 1;
        await transaction.configVersion.update({
          data: {
            effectiveFrom,
            publishedAt: new Date(),
            rolloutPercentage,
            status: 'PUBLISHED',
            supersedesVersionId: previous?.id ?? null,
            updatedBy: context.accountId,
            version: nextVersion,
          },
          where: { id: candidate.id },
        });
        const difference = configurationDifference(
          (previous?.values ?? {}) as JsonObject,
          candidate.values as JsonObject,
        );
        const publishRecordId = randomUUID();
        await transaction.configPublishRecord.create({
          data: {
            action: 'PUBLISH',
            configVersionId: candidate.id,
            createdBy: context.accountId,
            difference,
            id: publishRecordId,
            previousVersionId: previous?.id ?? null,
            rolloutPercentage,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.writeConfigChange(transaction, {
          action: 'configuration.publish',
          configKey: candidate.configKey,
          configVersionId: candidate.id,
          correlationId: metadata.correlationId,
          eventName: 'platform.config-published.v1',
          previousVersionId: previous?.id ?? null,
          context,
          metadata,
          version: nextVersion,
        });
        return {
          accepted: true,
          configVersionId: candidate.id,
          publishRecordId,
          status: 'PUBLISHED',
          version: nextVersion,
        };
      },
    );
  }

  rollbackConfig(
    configVersionId: string,
    input: RollbackConfigInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateExpectedVersion(input.expectedVersion);
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { configVersionId, ...input },
        responseCode: 200,
        scope: `platform.config-version.rollback.v1:${configVersionId}`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const target = await transaction.configVersion.findFirst({
          where: { id: configVersionId, tenantId: context.tenantId },
        });
        if (!target)
          throw new AppError(
            'CONFIG_VERSION_NOT_FOUND',
            'Config version was not found',
            404,
          );
        this.assertScope(context, target.scopeType, target.scopeRef);
        assertConfigTransition(target.status, 'PUBLISHED', 'ROLLBACK');
        if (target.version !== input.expectedVersion) {
          throw new AppError(
            'CONFIG_VERSION_CONFLICT',
            'Config version changed before rollback',
            409,
          );
        }
        const current = await transaction.configVersion.findFirst({
          where: {
            configKey: target.configKey,
            scopeRef: target.scopeRef,
            scopeType: target.scopeType,
            status: 'PUBLISHED',
            tenantId: context.tenantId,
          },
        });
        if (!current) {
          throw new AppError(
            'CONFIG_CURRENT_VERSION_MISSING',
            'No published version can be rolled back',
            409,
          );
        }
        await transaction.configVersion.update({
          data: {
            status: 'RETIRED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: current.id },
        });
        const nextVersion = target.version + 1;
        await transaction.configVersion.update({
          data: {
            effectiveFrom: new Date(),
            publishedAt: new Date(),
            status: 'PUBLISHED',
            supersedesVersionId: current.id,
            updatedBy: context.accountId,
            version: nextVersion,
          },
          where: { id: target.id },
        });
        const publishRecordId = randomUUID();
        await transaction.configPublishRecord.create({
          data: {
            action: 'ROLLBACK',
            configVersionId: target.id,
            createdBy: context.accountId,
            difference: configurationDifference(
              current.values as JsonObject,
              target.values as JsonObject,
            ),
            id: publishRecordId,
            previousVersionId: current.id,
            rolloutPercentage: target.rolloutPercentage,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.writeConfigChange(transaction, {
          action: 'configuration.rollback',
          configKey: target.configKey,
          configVersionId: target.id,
          correlationId: metadata.correlationId,
          eventName: 'platform.config-rolled-back.v1',
          previousVersionId: current.id,
          context,
          metadata,
          version: nextVersion,
        });
        return {
          accepted: true,
          configVersionId: target.id,
          publishRecordId,
          status: 'PUBLISHED',
          version: nextVersion,
        };
      },
    );
  }

  async resolveConfig(input: ResolveConfigInput, context: TenantContext) {
    const configKey = input.configKey?.trim().toLowerCase();
    if (!CONFIG_KEY_PATTERN.test(configKey)) {
      throw new AppError('CONFIG_KEY_INVALID', 'configKey is invalid', 400);
    }
    for (const scopeRef of [
      input.organizationId,
      input.warehouseId,
      input.customerId,
    ]) {
      if (scopeRef && !isUuid(scopeRef)) {
        throw new AppError(
          'CONFIG_SCOPE_INVALID',
          'Configuration scope IDs must be UUIDs',
          400,
        );
      }
    }
    if (input.organizationId) {
      this.assertScope(context, 'ORGANIZATION', input.organizationId);
    }
    if (input.warehouseId) {
      this.assertScope(context, 'WAREHOUSE', input.warehouseId);
    }
    if (input.customerId) {
      this.assertScope(context, 'CUSTOMER', input.customerId);
    }
    const now = new Date();
    const stored = await this.prisma.configVersion.findMany({
      where: {
        configKey,
        effectiveFrom: { lte: now },
        status: 'PUBLISHED',
        tenantId: context.tenantId,
      },
    });
    const resolution = resolveConfigurationLayers(
      stored.map((version) => ({
        id: version.id,
        rolloutPercentage: version.rolloutPercentage,
        scopeRef: version.scopeRef,
        scopeType: version.scopeType,
        values: version.values as JsonObject,
        versionNumber: version.versionNumber,
      })),
      input,
    );
    return { configKey, ...resolution };
  }

  async listDictionaries(context: TenantContext) {
    const [dictionaries, items] = await Promise.all([
      this.prisma.businessDictionary.findMany({
        orderBy: [{ category: 'asc' }, { code: 'asc' }],
        where: { tenantId: context.tenantId },
      }),
      this.prisma.dictionaryItem.findMany({
        orderBy: [
          { dictionaryId: 'asc' },
          { sortOrder: 'asc' },
          { code: 'asc' },
        ],
        where: { tenantId: context.tenantId },
      }),
    ]);
    return dictionaries.map((dictionary) => ({
      ...dictionary,
      items: items.filter((item) => item.dictionaryId === dictionary.id),
    }));
  }

  listDictionaryItems(dictionaryId: string, context: TenantContext) {
    return this.prisma.dictionaryItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      where: { dictionaryId, tenantId: context.tenantId },
    });
  }

  createDictionary(
    input: CreateDictionaryInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.code?.trim().toUpperCase();
    const items = Array.isArray(input.items) ? input.items : [];
    const itemCodes = items.map((item) => item.code?.trim().toUpperCase());
    if (
      !CODE_PATTERN.test(code) ||
      !input.name?.trim() ||
      !input.category?.trim() ||
      items.length === 0 ||
      itemCodes.some((itemCode) => !CODE_PATTERN.test(itemCode)) ||
      new Set(itemCodes).size !== itemCodes.length ||
      items.some(
        (item) => !item.name?.trim() || !isJsonObject(item.metadata ?? {}),
      )
    ) {
      throw new AppError(
        'DICTIONARY_INVALID',
        'Dictionary metadata or items are invalid',
        400,
      );
    }
    return this.idempotency
      .execute(
        {
          actorId: context.accountId,
          key: metadata.idempotencyKey,
          payload: input,
          responseCode: 201,
          scope: 'platform.dictionary.create.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          const dictionaryId = randomUUID();
          const itemIds = items.map(() => randomUUID());
          await transaction.businessDictionary.create({
            data: {
              category: input.category.trim(),
              code,
              createdBy: context.accountId,
              description: input.description?.trim() || null,
              id: dictionaryId,
              name: input.name.trim(),
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.dictionaryItem.createMany({
            data: items.map((item, index) => ({
              code: itemCodes[index]!,
              createdBy: context.accountId,
              dictionaryId,
              id: itemIds[index]!,
              metadata: (item.metadata ?? {}) as Prisma.InputJsonObject,
              name: item.name.trim(),
              requiresAttachment: item.requiresAttachment ?? false,
              requiresRemark: item.requiresRemark ?? false,
              sortOrder: item.sortOrder ?? 100,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            })),
          });
          await transaction.platformAuditLog.create({
            data: {
              action: 'dictionary.create',
              after: { code, itemCount: items.length },
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              deviceId: context.deviceId,
              ipAddress: metadata.ipAddress ?? null,
              resourceId: dictionaryId,
              resourceType: 'BusinessDictionary',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.platformOutbox.create({
            data: {
              aggregateId: dictionaryId,
              aggregateType: 'BusinessDictionary',
              aggregateVersion: 1,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              eventName: 'platform.dictionary-created.v1',
              payload: { code, dictionaryId, itemIds },
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          return {
            accepted: true,
            dictionaryId,
            itemIds,
            status: 'ACTIVE',
            version: 1,
          };
        },
      )
      .catch(mapConfigurationPrismaError);
  }

  changeDictionaryItemStatus(
    itemId: string,
    input: ChangeDictionaryItemStatusInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.validateExpectedVersion(input.expectedVersion);
    if (input.status !== 'ACTIVE' && input.status !== 'INACTIVE') {
      throw new AppError(
        'DICTIONARY_STATUS_INVALID',
        'Dictionary item status is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { itemId, ...input },
        responseCode: 200,
        scope: `platform.dictionary-item.status.v1:${itemId}`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const item = await transaction.dictionaryItem.findFirst({
          where: { id: itemId, tenantId: context.tenantId },
        });
        if (!item)
          throw new AppError(
            'DICTIONARY_ITEM_NOT_FOUND',
            'Dictionary item was not found',
            404,
          );
        if (item.version !== input.expectedVersion) {
          throw new AppError(
            'DICTIONARY_VERSION_CONFLICT',
            'Dictionary item changed before update',
            409,
          );
        }
        assertDictionaryItemTransition(item.status, input.status);
        const version = item.version + 1;
        await transaction.dictionaryItem.update({
          data: { status: input.status, updatedBy: context.accountId, version },
          where: { id: item.id },
        });
        await transaction.platformAuditLog.create({
          data: {
            action: 'dictionary-item.status.change',
            after: { status: input.status, version },
            before: { status: item.status, version: item.version },
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            ipAddress: metadata.ipAddress ?? null,
            resourceId: item.id,
            resourceType: 'DictionaryItem',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await transaction.platformOutbox.create({
          data: {
            aggregateId: item.id,
            aggregateType: 'DictionaryItem',
            aggregateVersion: version,
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            eventName: 'platform.dictionary-item-status-changed.v1',
            payload: {
              code: item.code,
              dictionaryId: item.dictionaryId,
              itemId,
              status: input.status,
            },
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        return {
          accepted: true,
          itemId,
          snapshot: { code: item.code, name: item.name },
          status: input.status,
          version,
        };
      },
    );
  }

  async validateReasonUse(
    itemId: string,
    input: ValidateReasonUseInput,
    context: TenantContext,
  ) {
    const item = await this.prisma.dictionaryItem.findFirst({
      where: { id: itemId, tenantId: context.tenantId },
    });
    if (!item)
      throw new AppError(
        'DICTIONARY_ITEM_NOT_FOUND',
        'Dictionary item was not found',
        404,
      );
    const errors = validateReasonEvidence(item, input);
    return {
      allowed: errors.length === 0,
      errors,
      snapshot: { code: item.code, name: item.name },
    };
  }

  async listNumberRules(context: TenantContext) {
    const rules = await this.prisma.numberRule.findMany({
      orderBy: [{ businessType: 'asc' }, { organizationRef: 'asc' }],
      where: {
        ...(context.accountKind === 'USER'
          ? {
              organizationRef: {
                in: ['*', ...context.organizationIds],
              },
            }
          : {}),
        tenantId: context.tenantId,
      },
    });
    return rules.map((rule) => ({
      ...rule,
      currentSequence: String(rule.currentSequence),
    }));
  }

  createNumberRule(
    input: CreateNumberRuleInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const businessType = input.businessType?.trim().toUpperCase();
    const organizationRef = input.organizationRef?.trim() || '*';
    const sequenceWidth = input.sequenceWidth ?? 6;
    const blockSize = input.blockSize ?? 100;
    const resetPeriod = input.resetPeriod ?? 'DAILY';
    const prefixTemplate = input.prefixTemplate?.trim() ?? '';
    const unknownTokens = [...prefixTemplate.matchAll(/\{([^}]+)\}/g)]
      .map((match) => match[1]!)
      .filter(
        (token) => !['YYYY', 'YY', 'MM', 'DD', 'ORG', 'TYPE'].includes(token),
      );
    if (
      !CODE_PATTERN.test(businessType) ||
      !prefixTemplate ||
      prefixTemplate.length > 150 ||
      unknownTokens.length > 0 ||
      !Number.isInteger(sequenceWidth) ||
      sequenceWidth < 1 ||
      sequenceWidth > 18 ||
      !Number.isInteger(blockSize) ||
      blockSize < 1 ||
      blockSize > 10_000 ||
      !['NEVER', 'DAILY', 'MONTHLY', 'YEARLY'].includes(resetPeriod) ||
      (organizationRef !== '*' && !isUuid(organizationRef))
    ) {
      throw new AppError(
        'NUMBER_RULE_INVALID',
        'Number rule metadata or template is invalid',
        400,
      );
    }
    if (organizationRef !== '*')
      this.assertScope(context, 'ORGANIZATION', organizationRef);
    return this.idempotency
      .execute(
        {
          actorId: context.accountId,
          key: metadata.idempotencyKey,
          payload: input,
          responseCode: 201,
          scope: 'platform.number-rule.create.v1',
          tenantId: context.tenantId,
        },
        async (transaction) => {
          const numberRuleId = randomUUID();
          await transaction.numberRule.create({
            data: {
              blockSize,
              businessType,
              createdBy: context.accountId,
              id: numberRuleId,
              organizationRef,
              prefixTemplate,
              resetPeriod,
              sequenceWidth,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.platformAuditLog.create({
            data: {
              action: 'number-rule.create',
              after: {
                blockSize,
                businessType,
                organizationRef,
                resetPeriod,
                sequenceWidth,
              },
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              deviceId: context.deviceId,
              ipAddress: metadata.ipAddress ?? null,
              resourceId: numberRuleId,
              resourceType: 'NumberRule',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          await transaction.platformOutbox.create({
            data: {
              aggregateId: numberRuleId,
              aggregateType: 'NumberRule',
              aggregateVersion: 1,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              eventName: 'platform.number-rule-created.v1',
              payload: { businessType, numberRuleId, organizationRef },
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          return { accepted: true, numberRuleId, status: 'ACTIVE', version: 1 };
        },
      )
      .catch(mapConfigurationPrismaError);
  }

  reserveSequence(
    numberRuleId: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!isUuid(numberRuleId)) {
      throw new AppError(
        'NUMBER_RULE_ID_INVALID',
        'numberRuleId must be a UUID',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { numberRuleId },
        responseCode: 201,
        scope: `platform.number-rule.reserve.v1:${numberRuleId}`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const rule = await transaction.numberRule.findFirst({
          where: {
            id: numberRuleId,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        if (!rule)
          throw new AppError(
            'NUMBER_RULE_NOT_FOUND',
            'Active number rule was not found',
            404,
          );
        if (rule.organizationRef !== '*') {
          this.assertScope(context, 'ORGANIZATION', rule.organizationRef);
        }
        const allocatedAt = new Date();
        const periodKey = sequencePeriodKey(rule.resetPeriod, allocatedAt);
        const allocated = await transaction.$queryRaw<
          {
            block_size: number;
            business_type: string;
            current_sequence: bigint;
            organization_ref: string;
            prefix_template: string;
            sequence_width: number;
            version: number;
          }[]
        >(Prisma.sql`
          UPDATE "platform"."number_rule"
          SET
            "current_period_key" = ${periodKey},
            "current_sequence" = CASE
              WHEN "current_period_key" = ${periodKey}
              THEN "current_sequence" + "block_size"::bigint
              ELSE "block_size"::bigint
            END,
            "last_allocated_at" = ${allocatedAt},
            "updated_at" = CURRENT_TIMESTAMP,
            "updated_by" = ${context.accountId}::uuid,
            "version" = "version" + 1
          WHERE "id" = ${numberRuleId}::uuid
            AND "tenant_id" = ${context.tenantId}::uuid
            AND "status" = 'ACTIVE'::"platform"."RecordStatus"
          RETURNING
            "current_sequence",
            "block_size",
            "prefix_template",
            "sequence_width",
            "business_type",
            "organization_ref",
            "version"
        `);
        const result = allocated[0];
        if (!result)
          throw new AppError(
            'NUMBER_RULE_ALLOCATION_FAILED',
            'Sequence block could not be allocated',
            409,
          );
        const endValue = result.current_sequence;
        const startValue = endValue - BigInt(result.block_size) + 1n;
        const maximum = 10n ** BigInt(result.sequence_width) - 1n;
        if (endValue > maximum) {
          throw new AppError(
            'NUMBER_SEQUENCE_EXHAUSTED',
            'Number sequence width is exhausted',
            409,
          );
        }
        const reservationId = randomUUID();
        await transaction.sequenceReservation.create({
          data: {
            createdBy: context.accountId,
            endValue,
            expiresAt: new Date(allocatedAt.getTime() + 24 * 60 * 60 * 1000),
            id: reservationId,
            numberRuleId,
            periodKey,
            reservedBy: context.accountId,
            startValue,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        const numberInput = {
          at: allocatedAt,
          businessType: result.business_type,
          organizationRef: result.organization_ref,
          prefixTemplate: result.prefix_template,
          sequenceWidth: result.sequence_width,
        };
        const firstNumber = formatReservedNumber({
          ...numberInput,
          sequence: startValue,
        });
        const lastNumber = formatReservedNumber({
          ...numberInput,
          sequence: endValue,
        });
        await transaction.platformOutbox.create({
          data: {
            aggregateId: numberRuleId,
            aggregateType: 'NumberRule',
            aggregateVersion: result.version,
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            eventName: 'platform.sequence-reserved.v1',
            payload: {
              endValue: String(endValue),
              numberRuleId,
              periodKey,
              reservationId,
              startValue: String(startValue),
            },
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await transaction.platformAuditLog.create({
          data: {
            action: 'number-rule.sequence.reserve',
            after: {
              endValue: String(endValue),
              periodKey,
              reservationId,
              startValue: String(startValue),
            },
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            ipAddress: metadata.ipAddress ?? null,
            resourceId: numberRuleId,
            resourceType: 'NumberRule',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        return {
          accepted: true,
          endValue: String(endValue),
          firstNumber,
          lastNumber,
          periodKey,
          reservationId,
          startValue: String(startValue),
          version: result.version,
        };
      },
    );
  }

  private assertScope(
    context: TenantContext,
    scopeType: ConfigScopeType,
    scopeRef: string,
  ) {
    if (!configurationScopeAllowed(context, scopeType, scopeRef)) {
      throw new AppError(
        'CONFIG_DATA_SCOPE_DENIED',
        'The current account cannot manage this configuration scope',
        403,
      );
    }
  }

  private async findConfig(configVersionId: string, context: TenantContext) {
    if (!isUuid(configVersionId)) {
      throw new AppError(
        'CONFIG_VERSION_ID_INVALID',
        'configVersionId must be a UUID',
        400,
      );
    }
    const config = await this.prisma.configVersion.findFirst({
      where: { id: configVersionId, tenantId: context.tenantId },
    });
    if (!config)
      throw new AppError(
        'CONFIG_VERSION_NOT_FOUND',
        'Config version was not found',
        404,
      );
    this.assertScope(context, config.scopeType, config.scopeRef);
    return config;
  }

  private validateExpectedVersion(expectedVersion: number) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new AppError(
        'EXPECTED_VERSION_INVALID',
        'expectedVersion must be a positive integer',
        400,
      );
    }
  }

  private async writeConfigChange(
    transaction: Prisma.TransactionClient,
    input: {
      readonly action: string;
      readonly configKey: string;
      readonly configVersionId: string;
      readonly context: TenantContext;
      readonly correlationId: string;
      readonly eventName: string;
      readonly metadata: CommandMetadata;
      readonly previousVersionId: string | null;
      readonly version: number;
    },
  ) {
    await transaction.platformAuditLog.create({
      data: {
        action: input.action,
        after: {
          configKey: input.configKey,
          previousVersionId: input.previousVersionId,
          status: 'PUBLISHED',
          version: input.version,
        },
        correlationId: input.correlationId,
        createdBy: input.context.accountId,
        deviceId: input.context.deviceId,
        ipAddress: input.metadata.ipAddress ?? null,
        resourceId: input.configVersionId,
        resourceType: 'ConfigVersion',
        tenantId: input.context.tenantId,
        updatedBy: input.context.accountId,
      },
    });
    await transaction.platformOutbox.create({
      data: {
        aggregateId: input.configVersionId,
        aggregateType: 'ConfigVersion',
        aggregateVersion: input.version,
        correlationId: input.correlationId,
        createdBy: input.context.accountId,
        eventName: input.eventName,
        payload: {
          configKey: input.configKey,
          configVersionId: input.configVersionId,
          previousVersionId: input.previousVersionId,
        },
        tenantId: input.context.tenantId,
        updatedBy: input.context.accountId,
      },
    });
  }
}

export function mapConfigurationPrismaError(error: unknown): never {
  if (isPrismaErrorCode(error, 'P2002')) {
    throw new AppError(
      'CONFIGURATION_DUPLICATE',
      'Configuration code or scope already exists',
      409,
    );
  }
  throw error;
}
