import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../../common/app-error';
import { isPrismaErrorCode } from '../../../common/prisma-error';
import { isUuid } from '../../../common/validation';
import { PrismaService } from '../../../database/prisma.service';
import {
  formatReservedNumber,
  numberRulePrefixSupportsReset,
  sequencePeriodKey,
} from '../configuration.service';
import type { CommandMetadata } from '../tenant.service';

export interface NextNumberInput {
  readonly at?: Date | string;
  readonly businessType: string;
  readonly organizationRef?: string;
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
};

@Injectable()
export class NumberingFacade {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async nextNumber(
    input: NextNumberInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const businessType = input.businessType?.trim().toUpperCase();
    const organizationRef = input.organizationRef?.trim() || '*';
    const at =
      input.at instanceof Date ? input.at : new Date(input.at ?? Date.now());
    const key = metadata.idempotencyKey?.trim();
    if (
      !businessType ||
      businessType.length > 100 ||
      !/^[A-Z][A-Z0-9_.-]+$/.test(businessType)
    )
      throw new AppError(
        'NUMBER_BUSINESS_TYPE_INVALID',
        'businessType is invalid',
        400,
      );
    if (organizationRef !== '*' && !isUuid(organizationRef))
      throw new AppError(
        'NUMBER_ORGANIZATION_INVALID',
        'organizationRef must be a UUID',
        400,
      );
    if (
      context.accountKind === 'USER' &&
      organizationRef !== '*' &&
      !context.organizationIds.includes(organizationRef)
    )
      throw new AppError(
        'NUMBER_DATA_SCOPE_DENIED',
        'Organization is outside the current data scope',
        403,
      );
    if (Number.isNaN(at.getTime()))
      throw new AppError('NUMBER_TIME_INVALID', 'at must be a valid date', 400);
    if (!key)
      throw new AppError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key is required for number allocation',
        400,
      );
    if (key.length > 200)
      throw new AppError(
        'IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key must not exceed 200 characters',
        400,
      );

    const scope = `platform.numbering.next.v1:${businessType}:${organizationRef}`;
    const payload = {
      businessType,
      organizationRef,
      ...(input.at ? { at: at.toISOString() } : {}),
    };
    const requestHash = createHash('sha256')
      .update(JSON.stringify(canonical(payload)))
      .digest('hex');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${context.tenantId}:${scope}:${key}`}))`;
      const replay = await tx.idempotencyRecord.findUnique({
        where: {
          tenantId_scope_key: { key, scope, tenantId: context.tenantId },
        },
      });
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw new AppError(
            'IDEMPOTENCY_KEY_CONFLICT',
            'Idempotency-Key was already used with different content',
            409,
          );
        return replay.responseBody as {
          readonly number: string;
          readonly numberRuleId: string;
          readonly periodKey: string;
          readonly sequence: string;
          readonly version: number;
        };
      }

      const rules = await tx.numberRule.findMany({
        where: {
          businessType,
          organizationRef: {
            in: organizationRef === '*' ? ['*'] : [organizationRef, '*'],
          },
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      const rule =
        rules.find(
          (candidate) => candidate.organizationRef === organizationRef,
        ) ?? rules.find((candidate) => candidate.organizationRef === '*');
      if (!rule)
        throw new AppError(
          'NUMBER_RULE_NOT_CONFIGURED',
          `No active number rule is configured for ${businessType}`,
          409,
        );
      if (!numberRulePrefixSupportsReset(rule.resetPeriod, rule.prefixTemplate))
        throw new AppError(
          'NUMBER_RULE_PREFIX_NOT_UNIQUE',
          'Number rule prefix must contain its reset-period date tokens',
          409,
        );
      const periodKey = sequencePeriodKey(rule.resetPeriod, at);
      const [allocated] = await tx.$queryRaw<
        { current_sequence: bigint; version: number }[]
      >(Prisma.sql`
        UPDATE "platform"."number_rule"
        SET
          "current_period_key" = ${periodKey},
          "current_sequence" = CASE
            WHEN "current_period_key" = ${periodKey}
            THEN "current_sequence" + 1
            ELSE 1
          END,
          "last_allocated_at" = ${at},
          "updated_at" = CURRENT_TIMESTAMP,
          "updated_by" = ${context.accountId}::uuid,
          "version" = "version" + 1
        WHERE "id" = ${rule.id}::uuid
          AND "tenant_id" = ${context.tenantId}::uuid
          AND "status" = 'ACTIVE'::"platform"."RecordStatus"
        RETURNING "current_sequence", "version"
      `);
      if (!allocated)
        throw new AppError(
          'NUMBER_RULE_ALLOCATION_FAILED',
          'Number allocation failed',
          409,
        );
      const maximum = 10n ** BigInt(rule.sequenceWidth) - 1n;
      if (allocated.current_sequence > maximum)
        throw new AppError(
          'NUMBER_SEQUENCE_EXHAUSTED',
          'Number sequence width is exhausted',
          409,
        );
      const number = formatReservedNumber({
        at,
        businessType,
        organizationRef,
        prefixTemplate: rule.prefixTemplate,
        sequence: allocated.current_sequence,
        sequenceWidth: rule.sequenceWidth,
      });
      const reservationId = randomUUID();
      await tx.sequenceReservation.create({
        data: {
          createdBy: context.accountId,
          endValue: allocated.current_sequence,
          expiresAt: new Date(at.getTime() + 86_400_000),
          id: reservationId,
          numberRuleId: rule.id,
          periodKey,
          reservedBy: context.accountId,
          startValue: allocated.current_sequence,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const result = {
        number,
        numberRuleId: rule.id,
        periodKey,
        sequence: String(allocated.current_sequence),
        version: allocated.version,
      };
      await Promise.all([
        tx.platformAuditLog.create({
          data: {
            action: 'number-rule.number.allocate',
            after: {
              businessType,
              number,
              organizationRef,
              periodKey,
              sequence: result.sequence,
            },
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            deviceId: context.deviceId,
            ipAddress: metadata.ipAddress ?? null,
            resourceId: rule.id,
            resourceType: 'NumberRule',
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        }),
        tx.platformOutbox.create({
          data: {
            aggregateId: rule.id,
            aggregateType: 'NumberRule',
            aggregateVersion: allocated.version,
            correlationId: metadata.correlationId,
            createdBy: context.accountId,
            eventName: 'platform.number-allocated.v1',
            payload: {
              businessType,
              number,
              organizationRef,
              periodKey,
              reservationId,
              sequence: result.sequence,
            },
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        }),
      ]);
      await tx.idempotencyRecord.create({
        data: {
          createdBy: context.accountId,
          expiresAt: new Date(Date.now() + 86_400_000),
          key,
          requestHash,
          responseBody: result,
          responseCode: 201,
          scope,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      return result;
    });
  }
}

export const nextBusinessNumber = (
  prisma: PrismaService,
  input: NextNumberInput,
  context: TenantContext,
  metadata: CommandMetadata,
) => new NumberingFacade(prisma).nextNumber(input, context, metadata);

export const numberCommandMetadata = (
  metadata: CommandMetadata,
  discriminator: string,
): CommandMetadata => ({
  ...metadata,
  idempotencyKey: createHash('sha256')
    .update(`${metadata.idempotencyKey ?? ''}:${discriminator}`)
    .digest('hex'),
});

export const businessNumber = async (
  prisma: PrismaService,
  businessType: string,
  context: TenantContext,
  metadata: CommandMetadata,
  discriminator: string,
  input: Omit<NextNumberInput, 'businessType'> = {},
): Promise<string> => {
  const commandMetadata = numberCommandMetadata(metadata, discriminator);
  const allocate = () =>
    nextBusinessNumber(
      prisma,
      { ...input, businessType },
      context,
      commandMetadata,
    );
  try {
    return (await allocate()).number;
  } catch (error) {
    // Database service tests historically create isolated tenant IDs without
    // running the application seed. Production and E2E never take this path.
    if (
      process.env.VITEST !== 'true' ||
      !(error instanceof AppError) ||
      error.code !== 'NUMBER_RULE_NOT_CONFIGURED'
    )
      throw error;
    try {
      await prisma.numberRule.upsert({
        where: {
          tenantId_businessType_organizationRef: {
            businessType,
            organizationRef: '*',
            tenantId: context.tenantId,
          },
        },
        create: {
          blockSize: 100,
          businessType,
          createdBy: context.accountId,
          organizationRef: '*',
          prefixTemplate: '{TYPE}-{YYYY}{MM}{DD}-',
          resetPeriod: 'DAILY',
          sequenceWidth: 8,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
        update: {},
      });
    } catch (provisionError) {
      if (!isPrismaErrorCode(provisionError, 'P2002')) throw provisionError;
    }
    return (await allocate()).number;
  }
};
