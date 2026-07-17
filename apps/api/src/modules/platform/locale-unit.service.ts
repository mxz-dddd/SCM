import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import type { CommandMetadata } from './tenant.service';

export interface LocalePreferenceInput {
  readonly currency: string;
  readonly expectedVersion?: number;
  readonly language: string;
  readonly timeZone: string;
  readonly unitSystem: 'IMPERIAL' | 'METRIC';
}

export interface UnitConversionInput {
  readonly code: string;
  readonly dimension: string;
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string;
  readonly factor: string;
  readonly fromUom: string;
  readonly offset?: string;
  readonly toUom: string;
}

export interface ConvertQuantityInput {
  readonly amount: string;
  readonly at?: string;
  readonly dimension: string;
  readonly fromUom: string;
  readonly toUom: string;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{2,99}$/;
const UOM_PATTERN = /^[A-Z][A-Z0-9_.-]{0,19}$/;

function parseDate(value: string | undefined, field: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new AppError('LOCALE_DATE_INVALID', `${field} is invalid`, 400);
  return date;
}

function decimal(value: string, field: string): Prisma.Decimal {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new AppError(
      'UNIT_DECIMAL_INVALID',
      `${field} must be a decimal string`,
      400,
    );
  }
}

@Injectable()
export class LocaleUnitService {
  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async getLocale(context: TenantContext) {
    return (
      (await this.prisma.localePreference.findUnique({
        where: {
          tenantId_accountId: {
            accountId: context.accountId,
            tenantId: context.tenantId,
          },
        },
      })) ?? {
        accountId: context.accountId,
        currency: 'CNY',
        language: 'zh-CN',
        status: 'ACTIVE',
        timeZone: 'Asia/Shanghai',
        unitSystem: 'METRIC',
        version: 0,
      }
    );
  }

  saveLocale(
    input: LocalePreferenceInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    try {
      new Intl.DateTimeFormat(input.language, {
        timeZone: input.timeZone,
      }).format(new Date());
    } catch {
      throw new AppError(
        'LOCALE_CONTEXT_INVALID',
        'Language or IANA time zone is invalid',
        400,
      );
    }
    if (
      !['en-US', 'zh-CN'].includes(input.language) ||
      !/^[A-Z]{3}$/.test(input.currency) ||
      !['IMPERIAL', 'METRIC'].includes(input.unitSystem)
    ) {
      throw new AppError(
        'LOCALE_CONTEXT_INVALID',
        'Locale context is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 200,
        scope: 'platform.locale.save.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const existing = await transaction.localePreference.findUnique({
          where: {
            tenantId_accountId: {
              accountId: context.accountId,
              tenantId: context.tenantId,
            },
          },
        });
        if (existing && existing.version !== input.expectedVersion)
          throw this.versionConflict();
        const preference = existing
          ? await transaction.localePreference.update({
              data: {
                currency: input.currency,
                language: input.language,
                timeZone: input.timeZone,
                unitSystem: input.unitSystem,
                updatedBy: context.accountId,
                version: { increment: 1 },
              },
              where: { id: existing.id },
            })
          : await transaction.localePreference.create({
              data: {
                accountId: context.accountId,
                createdBy: context.accountId,
                currency: input.currency,
                language: input.language,
                tenantId: context.tenantId,
                timeZone: input.timeZone,
                unitSystem: input.unitSystem,
                updatedBy: context.accountId,
              },
            });
        return {
          localePreferenceId: preference.id,
          timeZone: preference.timeZone,
          version: preference.version,
        };
      },
    );
  }

  async formatInstant(instant: string, context: TenantContext) {
    const date = parseDate(instant, 'instant');
    if (!date)
      throw new AppError('LOCALE_DATE_INVALID', 'instant is required', 400);
    const locale = await this.getLocale(context);
    return {
      instant: date.toISOString(),
      localized: new Intl.DateTimeFormat(locale.language, {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZone: locale.timeZone,
      }).format(date),
      timeZone: locale.timeZone,
    };
  }

  listConversions(context: TenantContext) {
    return this.prisma.unitConversion.findMany({
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
      take: 300,
      where: { tenantId: context.tenantId },
    });
  }

  createConversion(
    input: UnitConversionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const code = input.code?.trim().toUpperCase();
    const fromUom = input.fromUom?.trim().toUpperCase();
    const toUom = input.toUom?.trim().toUpperCase();
    const factor = decimal(input.factor, 'factor');
    const offset = decimal(input.offset ?? '0', 'offset');
    const effectiveFrom =
      parseDate(input.effectiveFrom, 'effectiveFrom') ?? new Date();
    const effectiveUntil = parseDate(input.effectiveUntil, 'effectiveUntil');
    if (
      !CODE_PATTERN.test(code) ||
      !CODE_PATTERN.test(input.dimension?.trim().toUpperCase()) ||
      !UOM_PATTERN.test(fromUom) ||
      !UOM_PATTERN.test(toUom) ||
      fromUom === toUom ||
      factor.lte(0) ||
      (effectiveUntil && effectiveUntil <= effectiveFrom)
    ) {
      throw new AppError(
        'UNIT_CONVERSION_INVALID',
        'Unit conversion is invalid',
        400,
      );
    }
    return this.idempotency.execute(
      {
        actorId: context.accountId,
        key: metadata.idempotencyKey,
        payload: input,
        responseCode: 201,
        scope: 'platform.unit-conversion.create.v1',
        tenantId: context.tenantId,
      },
      async (transaction) => {
        const current = await transaction.unitConversion.findFirst({
          orderBy: { version: 'desc' },
          where: { code, tenantId: context.tenantId },
        });
        const conversion = await transaction.unitConversion.create({
          data: {
            code,
            createdBy: context.accountId,
            dimension: input.dimension.trim().toUpperCase(),
            effectiveFrom,
            effectiveUntil,
            factor,
            fromUom,
            id: randomUUID(),
            offset,
            tenantId: context.tenantId,
            toUom,
            updatedBy: context.accountId,
            version: (current?.version ?? 0) + 1,
          },
        });
        return {
          conversionId: conversion.id,
          status: conversion.status,
          version: conversion.version,
        };
      },
    );
  }

  async convert(input: ConvertQuantityInput, context: TenantContext) {
    const amount = decimal(input.amount, 'amount');
    const at = parseDate(input.at, 'at') ?? new Date();
    const conversion = await this.prisma.unitConversion.findFirst({
      orderBy: { version: 'desc' },
      where: {
        dimension: input.dimension.trim().toUpperCase(),
        effectiveFrom: { lte: at },
        fromUom: input.fromUom.trim().toUpperCase(),
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
        status: 'ACTIVE',
        tenantId: context.tenantId,
        toUom: input.toUom.trim().toUpperCase(),
      },
    });
    if (!conversion)
      throw new AppError(
        'UNIT_CONVERSION_NOT_FOUND',
        'No effective conversion was found',
        404,
      );
    const baseAmount = amount.mul(conversion.factor).add(conversion.offset);
    return {
      baseAmount: baseAmount.toFixed(),
      baseUom: conversion.toUom,
      conversionId: conversion.id,
      conversionVersion: conversion.version,
      originalAmount: amount.toFixed(),
      originalUom: conversion.fromUom,
    };
  }

  private versionConflict() {
    return new AppError(
      'LOCALE_VERSION_CONFLICT',
      'Locale preference changed; refresh and retry',
      409,
      {
        retryable: true,
      },
    );
  }
}
