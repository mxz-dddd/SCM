import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type FeatureFlagStatus } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

export interface FeatureRule {
  readonly enabled: boolean;
  readonly id: string;
  readonly organizationIds?: readonly string[];
  readonly percentage?: number;
  readonly priority: number;
  readonly roleCodes?: readonly string[];
}

export interface SaveFeatureFlagInput {
  readonly code: string;
  readonly defaultEnabled?: boolean;
  readonly name: string;
  readonly rules: readonly FeatureRule[];
}

export interface FlagVersionInput {
  readonly expectedVersion: number;
}

export interface EvaluateFlagInput {
  readonly code: string;
  readonly organizationId?: string;
  readonly roleCodes?: readonly string[];
  readonly subjectKey: string;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{2,99}$/;

export function assertFeatureFlagTransition(current: FeatureFlagStatus, target: FeatureFlagStatus): void {
  const allowed =
    (current === 'DRAFT' && target === 'PUBLISHED') ||
    (current === 'PUBLISHED' && ['PAUSED', 'RETIRED'].includes(target)) ||
    (current === 'PAUSED' && ['PUBLISHED', 'RETIRED'].includes(target));
  if (!allowed) {
    throw new AppError('FEATURE_FLAG_TRANSITION_INVALID', `Feature flag transition ${current} -> ${target} is not allowed`, 409);
  }
}

function validateRules(rules: readonly FeatureRule[]): void {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (
      !CODE_PATTERN.test(rule.id) ||
      ids.has(rule.id) ||
      !Number.isInteger(rule.priority) ||
      rule.priority < 0 ||
      (rule.percentage !== undefined &&
        (!Number.isInteger(rule.percentage) || rule.percentage < 0 || rule.percentage > 100)) ||
      (rule.organizationIds ?? []).some((id) => !isUuid(id)) ||
      (rule.roleCodes ?? []).some((code) => !CODE_PATTERN.test(code))
    ) {
      throw new AppError('FEATURE_FLAG_RULE_INVALID', 'Feature flag rule is invalid', 400);
    }
    ids.add(rule.id);
  }
}

@Injectable()
export class FeatureFlagService {
  constructor(
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  list(context: TenantContext) {
    return this.prisma.featureFlag.findMany({
      orderBy: [{ code: 'asc' }, { versionNumber: 'desc' }],
      take: 300,
      where: { tenantId: context.tenantId },
    });
  }

  save(input: SaveFeatureFlagInput, context: TenantContext, metadata: CommandMetadata) {
    const code = input.code?.trim().toUpperCase();
    validateRules(input.rules ?? []);
    if (!CODE_PATTERN.test(code) || !input.name?.trim()) {
      throw new AppError('FEATURE_FLAG_INVALID', 'Feature flag input is invalid', 400);
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.feature-flag.save.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const latest = await transaction.featureFlag.findFirst({
          orderBy: { versionNumber: 'desc' },
          where: { code, tenantId: context.tenantId },
        });
        const flag = await transaction.featureFlag.create({
          data: {
            code,
            createdBy: context.accountId,
            defaultEnabled: input.defaultEnabled ?? false,
            id: randomUUID(),
            name: input.name.trim(),
            rules: input.rules as unknown as Prisma.InputJsonArray,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            versionNumber: (latest?.versionNumber ?? 0) + 1,
          },
        });
        return {
          featureFlagId: flag.id,
          status: flag.status,
          version: flag.version,
          versionNumber: flag.versionNumber,
        };
      },
    );
  }

  changeStatus(
    flagId: string,
    target: 'PAUSED' | 'PUBLISHED' | 'RETIRED',
    input: FlagVersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!isUuid(flagId)) throw new AppError('FEATURE_FLAG_NOT_FOUND', 'Feature flag was not found', 404);
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { flagId, target, ...input },
        responseCode: 200,
        scope: 'platform.feature-flag.status.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const flag = await transaction.featureFlag.findFirst({ where: { id: flagId, tenantId: context.tenantId } });
        if (!flag) throw new AppError('FEATURE_FLAG_NOT_FOUND', 'Feature flag was not found', 404);
        if (flag.version !== input.expectedVersion) throw this.versionConflict();
        assertFeatureFlagTransition(flag.status, target);
        if (target === 'PUBLISHED') {
          await transaction.featureFlag.updateMany({
            data: { status: 'RETIRED', updatedBy: context.accountId, version: { increment: 1 } },
            where: { code: flag.code, id: { not: flag.id }, status: 'PUBLISHED', tenantId: context.tenantId },
          });
        }
        const changed = await transaction.featureFlag.update({
          data: {
            publishedAt: target === 'PUBLISHED' ? new Date() : flag.publishedAt,
            status: target,
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: flag.id },
        });
        return { featureFlagId: changed.id, status: changed.status, version: changed.version };
      },
    );
  }

  evaluate(input: EvaluateFlagInput, context: TenantContext, metadata: CommandMetadata) {
    const code = input.code?.trim().toUpperCase();
    if (
      !CODE_PATTERN.test(code) ||
      !input.subjectKey?.trim() ||
      input.subjectKey.length > 200 ||
      (input.organizationId !== undefined && !isUuid(input.organizationId)) ||
      (input.roleCodes ?? []).some((role) => !CODE_PATTERN.test(role))
    ) {
      throw new AppError('FEATURE_FLAG_EVALUATION_INVALID', 'Feature flag evaluation input is invalid', 400);
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 200,
        scope: 'platform.feature-flag.evaluate.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const flag = await transaction.featureFlag.findFirst({
          orderBy: { versionNumber: 'desc' },
          where: { code, status: 'PUBLISHED', tenantId: context.tenantId },
        });
        if (!flag) throw new AppError('FEATURE_FLAG_NOT_PUBLISHED', 'No published feature flag was found', 404);
        const bucket = Number(
          BigInt(`0x${createHash('sha256').update(`${code}:${input.subjectKey}`).digest('hex').slice(0, 12)}`) % 100n,
        );
        const roles = new Set(input.roleCodes ?? []);
        const rules = (flag.rules as unknown as FeatureRule[]).slice().sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
        const matched = rules.find((rule) => {
          const organizationMatch = !rule.organizationIds?.length || Boolean(input.organizationId && rule.organizationIds.includes(input.organizationId));
          const roleMatch = !rule.roleCodes?.length || rule.roleCodes.some((role) => roles.has(role));
          const percentageMatch = rule.percentage === undefined || bucket < rule.percentage;
          return organizationMatch && roleMatch && percentageMatch;
        });
        const enabled = matched?.enabled ?? flag.defaultEnabled;
        const decision = await transaction.featureFlagDecision.create({
          data: {
            bucket,
            createdBy: context.accountId,
            enabled,
            featureFlagId: flag.id,
            flagCode: flag.code,
            flagVersionNumber: flag.versionNumber,
            matchedRule: matched?.id ?? null,
            organizationId: input.organizationId ?? null,
            roleCodes: (input.roleCodes ?? []) as Prisma.InputJsonArray,
            subjectKey: input.subjectKey.trim(),
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        return {
          bucket,
          decisionId: decision.id,
          enabled,
          featureFlagId: flag.id,
          matchedRule: matched?.id ?? null,
          version: flag.versionNumber,
        };
      },
    );
  }

  private versionConflict() {
    return new AppError('FEATURE_FLAG_VERSION_CONFLICT', 'Feature flag changed; refresh and retry', 409, { retryable: true });
  }
}
