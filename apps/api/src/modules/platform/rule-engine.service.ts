import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type RuleEvaluationMode } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

type JsonObject = Readonly<Record<string, unknown>>;
type RuleOperator =
  | 'CONTAINS'
  | 'EQ'
  | 'EXISTS'
  | 'GT'
  | 'GTE'
  | 'IN'
  | 'LT'
  | 'LTE'
  | 'NE'
  | 'NOT_IN';

export interface RuleCondition {
  readonly field: string;
  readonly operator: RuleOperator;
  readonly source: 'CANDIDATE' | 'INPUT';
  readonly value?: unknown;
}

export interface RuleResult {
  readonly effect: 'DECIDE' | 'EXCLUDE' | 'INCLUDE';
  readonly reason?: string;
  readonly score?: number;
  readonly values?: JsonObject;
}

export interface RuleInput {
  readonly code: string;
  readonly conditions: readonly RuleCondition[];
  readonly enabled?: boolean;
  readonly name: string;
  readonly priority: number;
  readonly result: RuleResult;
  readonly stopOnMatch?: boolean;
}

export interface SaveRuleSetInput {
  readonly code: string;
  readonly description?: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
  readonly expectedVersion?: number;
  readonly name: string;
  readonly ruleSetId?: string;
  readonly rules: readonly RuleInput[];
  readonly scenario: string;
}

export interface EvaluateRuleInput {
  readonly candidates?: readonly (JsonObject & { readonly id: string })[];
  readonly facts: JsonObject;
  readonly ruleSetCode?: string;
  readonly scenario: string;
}

export interface RuleVersionInput {
  readonly expectedVersion: number;
}

interface RuntimeRule extends RuleInput {
  readonly id: string;
}

interface EvaluationStep {
  readonly candidateIds: readonly string[];
  readonly matched: boolean;
  readonly priority: number;
  readonly ruleCode: string;
  readonly ruleId: string;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{2,99}$/;
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,149}$/;
export const RULE_SCENARIOS = [
  'ALLOCATION',
  'CARRIER_SELECTION',
  'CHARGING',
  'PUTAWAY',
  'SLOT',
  'WAVE',
] as const;

function valueAt(source: JsonObject, field: string): unknown {
  return field
    .split('.')
    .reduce<unknown>(
      (value, segment) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[segment]
          : undefined,
      source,
    );
}

function conditionMatches(
  condition: RuleCondition,
  source: JsonObject,
): boolean {
  const actual = valueAt(source, condition.field);
  const expected = condition.value;
  if (condition.operator === 'EXISTS')
    return actual !== undefined && actual !== null;
  if (condition.operator === 'EQ') return actual === expected;
  if (condition.operator === 'NE') return actual !== expected;
  if (condition.operator === 'IN')
    return Array.isArray(expected) && expected.includes(actual);
  if (condition.operator === 'NOT_IN') {
    return Array.isArray(expected) && !expected.includes(actual);
  }
  if (condition.operator === 'CONTAINS') {
    return (
      typeof actual === 'string' &&
      typeof expected === 'string' &&
      actual.includes(expected)
    );
  }
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  if (condition.operator === 'GT') return actual > expected;
  if (condition.operator === 'GTE') return actual >= expected;
  if (condition.operator === 'LT') return actual < expected;
  return actual <= expected;
}

export function validateRuleSet(rules: readonly RuleInput[]): void {
  if (
    !Array.isArray(rules) ||
    rules.length < 1 ||
    rules.length > 500 ||
    new Set(rules.map(({ code }) => code)).size !== rules.length ||
    rules.some(
      (rule) =>
        !CODE_PATTERN.test(rule.code) ||
        !rule.name?.trim() ||
        !Number.isInteger(rule.priority) ||
        rule.priority < 1 ||
        rule.priority > 1_000_000 ||
        !Array.isArray(rule.conditions) ||
        rule.conditions.length > 50 ||
        !['DECIDE', 'EXCLUDE', 'INCLUDE'].includes(rule.result?.effect) ||
        (rule.result.score !== undefined &&
          !Number.isFinite(rule.result.score)) ||
        (rule.conditions as readonly RuleCondition[]).some(
          (condition: RuleCondition) =>
            !FIELD_PATTERN.test(condition.field) ||
            !['CANDIDATE', 'INPUT'].includes(condition.source) ||
            ![
              'CONTAINS',
              'EQ',
              'EXISTS',
              'GT',
              'GTE',
              'IN',
              'LT',
              'LTE',
              'NE',
              'NOT_IN',
            ].includes(condition.operator),
        ),
    )
  ) {
    throw new AppError(
      'RULE_SET_INVALID',
      'Rule set or rule definition is invalid',
      400,
    );
  }
}

export function evaluateRuleSet(
  rules: readonly RuntimeRule[],
  facts: JsonObject,
  candidates: readonly (JsonObject & { readonly id: string })[],
) {
  const active = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const scores = new Map(candidates.map(({ id }) => [id, 0]));
  const candidateValues = new Map<string, Record<string, unknown>>();
  const values: Record<string, unknown> = {};
  const exclusions: { candidateId: string; reason: string; ruleId: string }[] =
    [];
  const matchedRuleIds: string[] = [];
  const evaluatedRules: EvaluationStep[] = [];
  for (const rule of [...rules]
    .filter(({ enabled }) => enabled !== false)
    .sort(
      (left, right) =>
        left.priority - right.priority || left.code.localeCompare(right.code),
    )) {
    const inputConditions = rule.conditions.filter(
      ({ source }) => source === 'INPUT',
    );
    const candidateConditions = rule.conditions.filter(
      ({ source }) => source === 'CANDIDATE',
    );
    const inputMatched = inputConditions.every((condition) =>
      conditionMatches(condition, facts),
    );
    const candidateIds = inputMatched
      ? [...active.values()]
          .filter((candidate) =>
            candidateConditions.every((condition) =>
              conditionMatches(condition, candidate),
            ),
          )
          .map(({ id }) => id)
      : [];
    const matched =
      inputMatched &&
      (candidateConditions.length === 0 || candidateIds.length > 0);
    evaluatedRules.push({
      candidateIds,
      matched,
      priority: rule.priority,
      ruleCode: rule.code,
      ruleId: rule.id,
    });
    if (!matched) continue;
    matchedRuleIds.push(rule.id);
    if (rule.result.effect === 'DECIDE') {
      Object.assign(values, rule.result.values ?? {});
    } else if (rule.result.effect === 'EXCLUDE') {
      for (const candidateId of candidateIds) {
        active.delete(candidateId);
        exclusions.push({
          candidateId,
          reason: rule.result.reason ?? rule.name,
          ruleId: rule.id,
        });
      }
    } else {
      for (const candidateId of candidateIds) {
        scores.set(
          candidateId,
          (scores.get(candidateId) ?? 0) + (rule.result.score ?? 0),
        );
        candidateValues.set(candidateId, {
          ...(candidateValues.get(candidateId) ?? {}),
          ...(rule.result.values ?? {}),
        });
      }
    }
    if (rule.stopOnMatch) break;
  }
  const rankedCandidates = [...active.values()]
    .map((candidate) => ({
      ...candidate,
      ruleScore: scores.get(candidate.id) ?? 0,
      ruleValues: candidateValues.get(candidate.id) ?? {},
    }))
    .sort(
      (left, right) =>
        right.ruleScore - left.ruleScore || left.id.localeCompare(right.id),
    );
  return {
    decision: {
      candidates: rankedCandidates,
      selectedCandidateId: rankedCandidates[0]?.id ?? null,
      values,
    },
    evaluatedRules,
    exclusions,
    matchedRuleIds,
    outcome: matchedRuleIds.length
      ? ('MATCHED' as const)
      : ('NO_MATCH' as const),
  };
}

@Injectable()
export class RuleEngineService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  listRuleSets(context: TenantContext) {
    return this.prisma.ruleSet.findMany({
      orderBy: [
        { scenario: 'asc' },
        { code: 'asc' },
        { versionNumber: 'desc' },
      ],
      take: 300,
      where: { tenantId: context.tenantId },
    });
  }

  listTraces(context: TenantContext, scenario?: string) {
    if (scenario && !RULE_SCENARIOS.includes(scenario as never)) {
      throw new AppError(
        'RULE_SCENARIO_INVALID',
        'Rule scenario is invalid',
        400,
      );
    }
    return this.prisma.evaluationTrace.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      where: { ...(scenario ? { scenario } : {}), tenantId: context.tenantId },
    });
  }

  saveRuleSet(
    input: SaveRuleSetInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.code?.trim().toUpperCase();
    const scenario = input.scenario?.trim().toUpperCase();
    const effectiveFrom = input.effectiveFrom
      ? new Date(input.effectiveFrom)
      : null;
    const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
    if (
      !CODE_PATTERN.test(code) ||
      !RULE_SCENARIOS.includes(scenario as never) ||
      !input.name?.trim() ||
      (input.ruleSetId !== undefined && !isUuid(input.ruleSetId)) ||
      (effectiveFrom && Number.isNaN(effectiveFrom.getTime())) ||
      (effectiveTo && Number.isNaN(effectiveTo.getTime())) ||
      (effectiveFrom && effectiveTo && effectiveFrom >= effectiveTo)
    ) {
      throw new AppError('RULE_SET_INVALID', 'Rule set input is invalid', 400);
    }
    validateRuleSet(input.rules);
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: input.ruleSetId ? 200 : 201,
        scope: 'platform.rule-set.save.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const existing = input.ruleSetId
          ? await transaction.ruleSet.findFirst({
              where: {
                id: input.ruleSetId,
                status: 'DRAFT',
                tenantId: context.tenantId,
              },
            })
          : null;
        if (input.ruleSetId && !existing) {
          throw new AppError(
            'RULE_SET_DRAFT_NOT_FOUND',
            'Editable rule set draft was not found',
            404,
          );
        }
        if (existing && existing.version !== input.expectedVersion)
          throw this.versionConflict();
        if (
          existing &&
          (existing.code !== code || existing.scenario !== scenario)
        ) {
          throw new AppError(
            'RULE_SET_IDENTITY_IMMUTABLE',
            'Rule set code and scenario cannot change',
            409,
          );
        }
        const latest = existing
          ? null
          : await transaction.ruleSet.findFirst({
              orderBy: { versionNumber: 'desc' },
              where: { code, tenantId: context.tenantId },
            });
        const ruleSet = existing
          ? await transaction.ruleSet.update({
              data: {
                description: input.description?.trim() || null,
                effectiveFrom,
                effectiveTo,
                name: input.name.trim(),
                updatedBy: context.accountId,
                version: { increment: 1 },
              },
              where: { id: existing.id },
            })
          : await transaction.ruleSet.create({
              data: {
                code,
                createdBy: context.accountId,
                description: input.description?.trim() || null,
                effectiveFrom,
                effectiveTo,
                id: randomUUID(),
                name: input.name.trim(),
                scenario,
                supersedesVersionId: latest?.id ?? null,
                tenantId: context.tenantId,
                updatedBy: context.accountId,
                versionNumber: (latest?.versionNumber ?? 0) + 1,
              },
            });
        if (existing) {
          await transaction.ruleDefinition.deleteMany({
            where: { ruleSetId: ruleSet.id, tenantId: context.tenantId },
          });
        }
        await transaction.ruleDefinition.createMany({
          data: input.rules.map((rule) => ({
            code: rule.code,
            conditions: rule.conditions as unknown as Prisma.InputJsonArray,
            createdBy: context.accountId,
            enabled: rule.enabled ?? true,
            name: rule.name.trim(),
            priority: rule.priority,
            result: rule.result as unknown as Prisma.InputJsonObject,
            ruleSetId: ruleSet.id,
            stopOnMatch: rule.stopOnMatch ?? false,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          })),
        });
        await this.record(
          transaction,
          ruleSet.id,
          ruleSet.version,
          existing ? 'rule-set.updated' : 'rule-set.created',
          'platform.rule-set-saved.v1',
          context,
          metadata,
          {
            code,
            ruleCount: input.rules.length,
            scenario,
            status: ruleSet.status,
          },
        );
        return {
          ruleSetId: ruleSet.id,
          status: ruleSet.status,
          version: ruleSet.version,
          versionNumber: ruleSet.versionNumber,
        };
      },
    );
  }

  publish(
    ruleSetId: string,
    input: RuleVersionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { ruleSetId, ...input },
        responseCode: 200,
        scope: 'platform.rule-set.publish.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const ruleSet = await transaction.ruleSet.findFirst({
          where: { id: ruleSetId, tenantId: context.tenantId },
        });
        if (!ruleSet)
          throw new AppError(
            'RULE_SET_NOT_FOUND',
            'Rule set was not found',
            404,
          );
        if (
          ruleSet.status !== 'DRAFT' ||
          ruleSet.version !== input.expectedVersion
        ) {
          throw this.versionConflict();
        }
        const count = await transaction.ruleDefinition.count({
          where: { enabled: true, ruleSetId, tenantId: context.tenantId },
        });
        if (!count)
          throw new AppError(
            'RULE_SET_EMPTY',
            'Rule set has no enabled rules',
            409,
          );
        const published = await transaction.ruleSet.update({
          data: {
            publishedAt: new Date(),
            status: 'PUBLISHED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: ruleSet.id },
        });
        await this.record(
          transaction,
          published.id,
          published.version,
          'rule-set.published',
          'platform.rule-set-published.v1',
          context,
          metadata,
          {
            code: published.code,
            scenario: published.scenario,
            status: published.status,
          },
          { status: ruleSet.status },
        );
        return {
          ruleSetId: published.id,
          status: published.status,
          version: published.version,
          versionNumber: published.versionNumber,
        };
      },
    );
  }

  evaluate(
    mode: RuleEvaluationMode,
    input: EvaluateRuleInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const scenario = input.scenario?.trim().toUpperCase();
    const ruleSetCode = input.ruleSetCode?.trim().toUpperCase();
    if (
      !RULE_SCENARIOS.includes(scenario as never) ||
      (ruleSetCode !== undefined && !CODE_PATTERN.test(ruleSetCode)) ||
      !input.facts ||
      !Array.isArray(input.candidates ?? []) ||
      (input.candidates ?? []).length > 10_000 ||
      (input.candidates ?? []).some(
        ({ id }, index, values) =>
          !id?.trim() ||
          values.findIndex((candidate) => candidate.id === id) !== index,
      )
    ) {
      throw new AppError(
        'RULE_EVALUATION_INVALID',
        'Rule evaluation input is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: { mode, ...input },
        responseCode: 200,
        scope: `platform.rule-evaluation.${mode.toLowerCase()}.v1`,
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const now = new Date();
        const ruleSet = await transaction.ruleSet.findFirst({
          orderBy: { versionNumber: 'desc' },
          where: {
            ...(ruleSetCode ? { code: ruleSetCode } : {}),
            AND: [
              {
                OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
              },
              { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
            ],
            scenario,
            status: 'PUBLISHED',
            tenantId: context.tenantId,
          },
        });
        if (!ruleSet)
          throw new AppError(
            'RULE_SET_ACTIVE_NOT_FOUND',
            'No active published rule set was found',
            404,
          );
        const storedRules = await transaction.ruleDefinition.findMany({
          orderBy: [{ priority: 'asc' }, { code: 'asc' }],
          where: {
            enabled: true,
            ruleSetId: ruleSet.id,
            tenantId: context.tenantId,
          },
        });
        const rules: RuntimeRule[] = storedRules.map((rule) => ({
          code: rule.code,
          conditions: rule.conditions as unknown as RuleCondition[],
          enabled: rule.enabled,
          id: rule.id,
          name: rule.name,
          priority: rule.priority,
          result: rule.result as unknown as RuleResult,
          stopOnMatch: rule.stopOnMatch,
        }));
        const result = evaluateRuleSet(
          rules,
          input.facts,
          input.candidates ?? [],
        );
        const evaluationTraceId = randomUUID();
        await transaction.evaluationTrace.create({
          data: {
            candidateSnapshot: (input.candidates ??
              []) as unknown as Prisma.InputJsonArray,
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            decision: result.decision as unknown as Prisma.InputJsonObject,
            evaluatedRules:
              result.evaluatedRules as unknown as Prisma.InputJsonArray,
            exclusions: result.exclusions as unknown as Prisma.InputJsonArray,
            id: evaluationTraceId,
            inputSnapshot: input.facts as Prisma.InputJsonObject,
            matchedRuleIds: result.matchedRuleIds,
            mode,
            outcome: result.outcome,
            ruleSetCode: ruleSet.code,
            ruleSetId: ruleSet.id,
            ruleSetVersionNumber: ruleSet.versionNumber,
            scenario,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await transaction.platformAuditLog.create({
          data: {
            action: `rule-evaluation.${mode.toLowerCase()}`,
            after: {
              evaluationTraceId,
              matchedRuleCount: result.matchedRuleIds.length,
              outcome: result.outcome,
              ruleSetVersionNumber: ruleSet.versionNumber,
            },
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            ipAddress: metadata.ipAddress ?? null,
            resourceId: evaluationTraceId,
            resourceType: 'EvaluationTrace',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        if (mode === 'EXECUTION') {
          await transaction.platformOutbox.create({
            data: {
              aggregateId: evaluationTraceId,
              aggregateType: 'EvaluationTrace',
              aggregateVersion: 1,
              correlationId: metadata.correlationId,
              createdBy: context.accountId,
              eventName: 'platform.rule-evaluated.v1',
              payload: {
                evaluationTraceId,
                outcome: result.outcome,
                scenario,
                tenantId: context.tenantId,
              },
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
        }
        return {
          ...result,
          evaluationTraceId,
          mode,
          ruleSetCode: ruleSet.code,
          ruleSetVersionNumber: ruleSet.versionNumber,
        };
      },
    );
  }

  private async record(
    transaction: Prisma.TransactionClient,
    aggregateId: string,
    aggregateVersion: number,
    action: string,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    after: Prisma.InputJsonObject,
    before?: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      transaction.platformAuditLog.create({
        data: {
          action,
          after,
          ...(before ? { before } : {}),
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: aggregateId,
          resourceType: 'RuleSet',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      transaction.platformOutbox.create({
        data: {
          aggregateId,
          aggregateType: 'RuleSet',
          aggregateVersion,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          payload: {
            ruleSetId: aggregateId,
            tenantId: context.tenantId,
            version: aggregateVersion,
          },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }

  private versionConflict() {
    return new AppError(
      'RULE_SET_VERSION_CONFLICT',
      'Rule set version or status changed; refresh and retry',
      409,
      { retryable: true },
    );
  }
}
