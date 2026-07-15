import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { RateMatchingFacade } from '../mdm/public/rate-matching.facade';
import { businessNumber } from '../platform/public/numbering.facade';
import type { CommandMetadata } from '../platform/tenant.service';

type Direction = 'PAYABLE' | 'RECEIVABLE';
type RoundingMode = 'CEIL' | 'FLOOR' | 'HALF_EVEN' | 'HALF_UP';
type TaxMode = 'EXCLUSIVE' | 'INCLUSIVE';

export type CalculateChargeInput = {
  chargeFactId: string;
  direction: Direction;
  fx?: {
    exchangeRate: string;
    rateDate: string;
    source: string;
    targetCurrency: string;
  };
  reason?: string;
  rounding?: { mode: RoundingMode; scale: number };
  settlementCurrency?: string;
  tax?: { mode: TaxMode; rate: string };
};

type CalculationLine = {
  basisQuantity: Prisma.Decimal;
  basisType: string;
  basisUom: string;
  expression: Record<string, unknown>;
  lineType: string;
  rate: Prisma.Decimal;
  rounded: Prisma.Decimal;
  tier: Record<string, unknown>;
  tierFrom?: Prisma.Decimal;
  tierTo?: Prisma.Decimal;
  unrounded: Prisma.Decimal;
};

type AccessorialResult = {
  amount: Prisma.Decimal;
  basis: Record<string, unknown>;
  code: string;
  condition: Record<string, unknown>;
  method: string;
  type: string;
  unrounded: Prisma.Decimal;
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const array = (value: unknown): readonly Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(object) : [];

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

const optionalText = (value: unknown): string | undefined => {
  const result = typeof value === 'string' ? value.trim() : '';
  return result || undefined;
};

@Injectable()
export class ChargeCalculationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateMatchingFacade) private readonly rates: RateMatchingFacade,
  ) {}

  calculate(
    rawInput: CalculateChargeInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const input = this.normalizeInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:calculation:${input.chargeFactId}:${input.direction}`}, 0))`;
      const fact = await tx.chargeFact.findFirst({
        where: { id: input.chargeFactId, tenantId: context.tenantId },
      });
      if (!fact)
        throw new AppError(
          'BILLING_CHARGE_FACT_NOT_FOUND',
          'Charge fact was not found',
          404,
        );
      const closedPeriod = await tx.billingAccountingPeriod.findFirst({
        where: {
          periodFrom: { lte: fact.occurredAt },
          periodTo: { gte: fact.occurredAt },
          status: 'CLOSED',
          tenantId: context.tenantId,
        },
      });
      if (closedPeriod)
        throw new AppError(
          'BILLING_PERIOD_CLOSED',
          `Accounting period ${closedPeriod.periodKey} is closed`,
          409,
        );
      const correction = await tx.factCorrection.findFirst({
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        where: { chargeFactId: fact.id, tenantId: context.tenantId },
      });
      const effective = correction
        ? object(correction.correctedSnapshot)
        : this.factSnapshot(fact);
      const match = await tx.rateMatch.findFirst({
        orderBy: [{ matchedAt: 'desc' }, { id: 'desc' }],
        where: {
          chargeFactId: fact.id,
          ...(correction ? { factCorrectionId: correction.id } : {}),
          tenantId: context.tenantId,
        },
      });
      if (!match || match.status !== 'MATCHED' || !match.rateVersionRef)
        throw new AppError(
          'BILLING_RATE_MATCH_REQUIRED',
          'A matched rate is required before calculation',
          409,
          { businessRef: fact.businessRef },
        );
      const source = await this.rates.getCalculationSource(
        match.rateVersionRef,
        new Date(String(effective.occurredAt)),
        context,
      );
      const pricing = object(source.pricing);
      const rounding = this.rounding(input.rounding, pricing.rounding);
      const basis = this.basis(effective, pricing);
      const lines = this.baseLines(basis, pricing, source.baseRate, rounding);
      const subtotal = lines.reduce(
        (sum, line) => sum.plus(line.rounded),
        new Prisma.Decimal(0),
      );
      const accessorials = this.accessorials(
        effective,
        basis.quantity,
        subtotal,
        pricing,
        rounding,
      );
      const accessorialTotal = accessorials.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0),
      );
      const preTax = subtotal.plus(accessorialTotal);
      const taxConfig = this.taxConfig(input.tax, pricing.tax);
      const tax = this.tax(preTax, taxConfig.mode, taxConfig.rate, rounding);
      const sourceTotal = tax.total;
      const fx = this.fx(
        sourceTotal,
        source.currency,
        input.settlementCurrency,
        input.fx,
        rounding,
      );
      const factor = fx.rate;
      const settlementSubtotal = this.round(subtotal.times(factor), rounding);
      const settlementAccessorial = this.round(
        accessorialTotal.times(factor),
        rounding,
      );
      const settlementTax = this.round(tax.amount.times(factor), rounding);
      const settlementTotal = settlementSubtotal
        .plus(settlementAccessorial)
        .plus(
          taxConfig.mode === 'EXCLUSIVE'
            ? settlementTax
            : new Prisma.Decimal(0),
        );
      const latest = await tx.billingCalculation.findFirst({
        orderBy: { calculationVersion: 'desc' },
        where: {
          chargeFactId: fact.id,
          direction: input.direction,
          tenantId: context.tenantId,
        },
      });
      const calculationVersion = (latest?.calculationVersion ?? 0) + 1;
      const calculation = await tx.billingCalculation.create({
        data: {
          accessorialAmount: settlementAccessorial,
          businessRef: fact.businessRef,
          calculatedAt: new Date(),
          calculationNo: await businessNumber(
            this.prisma,
            'BILLING_CHARGE_CALCULATION',
            context,
            metadata,
            `billing-charge-calculation:${fact.id}:${input.direction}:${calculationVersion}`,
          ),
          calculationVersion,
          chargeFactId: fact.id,
          chargeType: fact.chargeType,
          createdBy: context.accountId,
          direction: input.direction,
          ...(correction ? { factCorrectionId: correction.id } : {}),
          rateMatchId: match.id,
          rateVersionNumber: source.versionNumber,
          rateVersionRef: source.rateVersionId,
          settlementCurrency: fx.targetCurrency,
          sourceCurrency: source.currency,
          subtotalAmount: settlementSubtotal,
          taxAmount: settlementTax,
          tenantId: context.tenantId,
          totalAmount: settlementTotal,
          updatedBy: context.accountId,
        },
      });
      for (const [index, line] of lines.entries())
        await tx.billingCalculationLine.create({
          data: {
            basisQuantity: line.basisQuantity,
            basisType: line.basisType,
            basisUom: line.basisUom,
            calculationId: calculation.id,
            createdBy: context.accountId,
            currency: source.currency,
            expressionSnapshot: json(line.expression),
            lineNo: index + 1,
            lineType: line.lineType,
            rateAmount: line.rate,
            roundedAmount: line.rounded,
            roundingDifference: line.rounded.minus(line.unrounded),
            tenantId: context.tenantId,
            tierSnapshot: json(line.tier),
            ...(line.tierFrom ? { tierFrom: line.tierFrom } : {}),
            ...(line.tierTo ? { tierTo: line.tierTo } : {}),
            unroundedAmount: line.unrounded,
            updatedBy: context.accountId,
          },
        });
      for (const [index, item] of accessorials.entries())
        await tx.accessorialCharge.create({
          data: {
            amount: item.amount,
            basisSnapshot: json(item.basis),
            calculationId: calculation.id,
            chargeType: item.type,
            code: item.code,
            conditionSnapshot: json(item.condition),
            createdBy: context.accountId,
            currency: source.currency,
            lineNo: index + 1,
            method: item.method,
            roundingDifference: item.amount.minus(item.unrounded),
            tenantId: context.tenantId,
            unroundedAmount: item.unrounded,
            updatedBy: context.accountId,
          },
        });
      const taxDetail = await tx.taxDetail.create({
        data: {
          calculationId: calculation.id,
          createdBy: context.accountId,
          currency: source.currency,
          roundingSnapshot: json({ ...rounding, unroundedTax: tax.unrounded }),
          taxAmount: tax.amount,
          taxableAmount: tax.taxable,
          taxMode: taxConfig.mode,
          taxRate: taxConfig.rate,
          tenantId: context.tenantId,
          totalWithTax: tax.total,
          updatedBy: context.accountId,
        },
      });
      const fxDetail = await tx.fxConversion.create({
        data: {
          calculationId: calculation.id,
          createdBy: context.accountId,
          exchangeRate: fx.rate,
          rateDate: fx.rateDate,
          roundingDifference: settlementTotal.minus(sourceTotal.times(fx.rate)),
          roundingMode: rounding.mode,
          roundingScale: rounding.scale,
          sourceAmount: sourceTotal,
          sourceCurrency: source.currency,
          sourceName: fx.source,
          targetAmount: settlementTotal,
          targetCurrency: fx.targetCurrency,
          tenantId: context.tenantId,
          unroundedTargetAmount: sourceTotal.times(fx.rate),
          updatedBy: context.accountId,
        },
      });
      const output = {
        accessorialAmount: settlementAccessorial.toString(),
        calculationId: calculation.id,
        calculationVersion,
        currency: fx.targetCurrency,
        subtotalAmount: settlementSubtotal.toString(),
        taxAmount: settlementTax.toString(),
        totalAmount: settlementTotal.toString(),
      };
      const trace = await tx.calculationTrace.create({
        data: {
          accessorialSnapshot: json(accessorials),
          calculationId: calculation.id,
          correctionSnapshot: json(
            correction
              ? {
                  correctedSnapshot: correction.correctedSnapshot,
                  correctionId: correction.id,
                  reason: correction.reason,
                }
              : {},
          ),
          createdBy: context.accountId,
          expressionSnapshot: json({
            basis,
            reason: input.reason,
            rounding,
            startingCharge: pricing.startingCharge,
            unitRate: pricing.unitRate ?? source.baseRate,
          }),
          factSnapshot: json(this.factSnapshot(fact)),
          fxSnapshot: json(fxDetail),
          outputSnapshot: json(output),
          rateMatchSnapshot: json(match),
          rateVersionSnapshot: json(source),
          taxSnapshot: json(taxDetail),
          tenantId: context.tenantId,
          tierSnapshot: json(array(pricing.tiers)),
          traceVersion: 1,
          updatedBy: context.accountId,
        },
      });
      await tx.platformOutbox.create({
        data: {
          aggregateId: calculation.id,
          aggregateType: 'BillingCalculation',
          aggregateVersion: calculationVersion,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName: 'billing.charge.calculated.v1',
          payload: json({
            amount: settlementTotal.toString(),
            businessRef: fact.businessRef,
            calculationId: calculation.id,
            currency: fx.targetCurrency,
            rateVersion: source.versionNumber,
            tax: settlementTax.toString(),
          }),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      return toHttpJson({
        ...output,
        calculationNo: calculation.calculationNo,
        direction: calculation.direction,
        lineCount: lines.length,
        accessorialCount: accessorials.length,
        status: calculation.status,
        traceId: trace.id,
      });
    });
  }

  private normalizeInput(input: CalculateChargeInput) {
    if (!isUuid(input.chargeFactId))
      throw new AppError(
        'BILLING_CALCULATION_INVALID',
        'chargeFactId is invalid',
        400,
      );
    if (!['PAYABLE', 'RECEIVABLE'].includes(input.direction))
      throw new AppError(
        'BILLING_CALCULATION_INVALID',
        'direction is invalid',
        400,
      );
    const settlementCurrency = (
      input.settlementCurrency ??
      input.fx?.targetCurrency ??
      ''
    )
      .trim()
      .toUpperCase();
    if (settlementCurrency && !/^[A-Z]{3}$/.test(settlementCurrency))
      throw new AppError(
        'BILLING_CALCULATION_INVALID',
        'settlementCurrency is invalid',
        400,
      );
    if (input.reason && input.reason.trim().length > 1000)
      throw new AppError(
        'BILLING_CALCULATION_INVALID',
        'reason is too long',
        400,
      );
    return {
      ...input,
      direction: input.direction as Direction,
      reason: optionalText(input.reason),
      settlementCurrency,
    };
  }

  private basis(
    effective: Record<string, unknown>,
    pricing: Record<string, unknown>,
  ) {
    const type = String(pricing.basis ?? 'BASE_QUANTITY').toUpperCase();
    const options: Record<string, { quantity: unknown; uom: unknown }> = {
      BASE_QUANTITY: {
        quantity: effective.quantityBase,
        uom: effective.quantityBaseUom,
      },
      FACT_AMOUNT: { quantity: effective.amount, uom: effective.currency },
      ORIGINAL_QUANTITY: {
        quantity: effective.quantityOriginal,
        uom: effective.quantityUom,
      },
    };
    const selected = options[type];
    if (!selected)
      throw new AppError(
        'BILLING_PRICING_INVALID',
        `Unsupported pricing basis ${type}`,
        409,
      );
    const quantity = this.decimal(selected.quantity, `pricing basis ${type}`);
    const increment = this.decimal(pricing.increment ?? 0, 'increment');
    if (quantity.isNegative() || increment.isNegative())
      throw new AppError(
        'BILLING_PRICING_INVALID',
        'Pricing basis and increment cannot be negative',
        409,
      );
    const billedQuantity = increment.isZero()
      ? quantity
      : quantity.div(increment).ceil().times(increment);
    return {
      billedQuantity: billedQuantity.toString(),
      increment: increment.toString(),
      quantity,
      type,
      uom: String(selected.uom ?? 'EA'),
    };
  }

  private baseLines(
    basis: ReturnType<ChargeCalculationService['basis']>,
    pricing: Record<string, unknown>,
    baseRate: string,
    rounding: { mode: RoundingMode; scale: number },
  ): CalculationLine[] {
    const quantity = new Prisma.Decimal(basis.billedQuantity);
    const lines: CalculationLine[] = [];
    const startingCharge = this.decimal(
      pricing.startingCharge ?? 0,
      'startingCharge',
    );
    if (startingCharge.isNegative()) this.invalidPricing('startingCharge');
    if (!startingCharge.isZero())
      lines.push(
        this.line(
          'STARTING_CHARGE',
          basis,
          new Prisma.Decimal(1),
          startingCharge,
          startingCharge,
          rounding,
          { formula: 'startingCharge' },
          {},
        ),
      );
    const tiers = array(pricing.tiers)
      .map((tier) => ({
        flatAmount: tier.flatAmount,
        from: this.decimal(tier.from ?? 0, 'tier.from'),
        rate: this.decimal(tier.rate ?? 0, 'tier.rate'),
        to:
          tier.to === undefined ? undefined : this.decimal(tier.to, 'tier.to'),
      }))
      .sort((left, right) => left.from.comparedTo(right.from));
    if (tiers.length) {
      for (const tier of tiers) {
        if (
          tier.from.isNegative() ||
          tier.rate.isNegative() ||
          (tier.to && tier.to.lte(tier.from))
        )
          this.invalidPricing('tiers');
        const upper = tier.to
          ? Prisma.Decimal.min(quantity, tier.to)
          : quantity;
        const tierQuantity = Prisma.Decimal.max(
          new Prisma.Decimal(0),
          upper.minus(tier.from),
        );
        if (tierQuantity.isZero()) continue;
        const flat = this.decimal(tier.flatAmount ?? 0, 'tier.flatAmount');
        const amount = tierQuantity.times(tier.rate).plus(flat);
        lines.push(
          this.line(
            'TIER',
            basis,
            tierQuantity,
            tier.rate,
            amount,
            rounding,
            { formula: 'tierQuantity * rate + flatAmount' },
            {
              flatAmount: flat.toString(),
              from: tier.from.toString(),
              rate: tier.rate.toString(),
              to: tier.to?.toString(),
            },
            tier.from,
            tier.to,
          ),
        );
      }
    } else {
      const rate = this.decimal(pricing.unitRate ?? baseRate, 'unitRate');
      if (rate.isNegative()) this.invalidPricing('unitRate');
      lines.push(
        this.line(
          'BASE',
          basis,
          quantity,
          rate,
          quantity.times(rate),
          rounding,
          { formula: 'billedQuantity * unitRate' },
          {},
        ),
      );
    }
    let current = lines.reduce(
      (sum, line) => sum.plus(line.rounded),
      new Prisma.Decimal(0),
    );
    const minimum = this.optionalDecimal(
      pricing.minimumCharge,
      'minimumCharge',
    );
    if (minimum && current.lt(minimum)) {
      const adjustment = minimum.minus(current);
      lines.push(
        this.line(
          'MINIMUM_ADJUSTMENT',
          basis,
          new Prisma.Decimal(1),
          adjustment,
          adjustment,
          rounding,
          { formula: 'minimumCharge - subtotal' },
          { minimumCharge: minimum.toString() },
        ),
      );
      current = minimum;
    }
    const maximum = this.optionalDecimal(
      pricing.maximumCharge,
      'maximumCharge',
    );
    if (maximum && current.gt(maximum)) {
      const adjustment = maximum.minus(current);
      lines.push(
        this.line(
          'CAP_ADJUSTMENT',
          basis,
          new Prisma.Decimal(1),
          adjustment,
          adjustment,
          rounding,
          { formula: 'maximumCharge - subtotal' },
          { maximumCharge: maximum.toString() },
        ),
      );
    }
    return lines;
  }

  private line(
    lineType: string,
    basis: ReturnType<ChargeCalculationService['basis']>,
    basisQuantity: Prisma.Decimal,
    rate: Prisma.Decimal,
    unrounded: Prisma.Decimal,
    rounding: { mode: RoundingMode; scale: number },
    expression: Record<string, unknown>,
    tier: Record<string, unknown>,
    tierFrom?: Prisma.Decimal,
    tierTo?: Prisma.Decimal,
  ): CalculationLine {
    return {
      basisQuantity,
      basisType: basis.type,
      basisUom: basis.uom,
      expression,
      lineType,
      rate,
      rounded: this.round(unrounded, rounding),
      tier,
      ...(tierFrom ? { tierFrom } : {}),
      ...(tierTo ? { tierTo } : {}),
      unrounded,
    };
  }

  private accessorials(
    effective: Record<string, unknown>,
    quantity: Prisma.Decimal,
    subtotal: Prisma.Decimal,
    pricing: Record<string, unknown>,
    rounding: { mode: RoundingMode; scale: number },
  ): AccessorialResult[] {
    return array(pricing.accessorials).flatMap((configuration, index) => {
      const condition = object(configuration.condition);
      if (!this.conditionMatches(condition, effective, quantity)) return [];
      const method = String(configuration.method ?? 'FIXED').toUpperCase();
      const value = this.decimal(configuration.value ?? 0, 'accessorial.value');
      if (value.isNegative()) this.invalidPricing('accessorial.value');
      let unrounded: Prisma.Decimal;
      if (method === 'FIXED') unrounded = value;
      else if (method === 'PERCENT_BASE')
        unrounded = subtotal.times(value).div(100);
      else if (method === 'PER_UNIT') unrounded = quantity.times(value);
      else this.invalidPricing(`accessorial method ${method}`);
      return [
        {
          amount: this.round(unrounded!, rounding),
          basis: {
            billedQuantity: quantity.toString(),
            subtotal: subtotal.toString(),
            value: value.toString(),
          },
          code: String(configuration.code ?? `ACCESSORIAL-${index + 1}`),
          condition,
          method,
          type: String(configuration.type ?? 'OTHER').toUpperCase(),
          unrounded: unrounded!,
        },
      ];
    });
  }

  private conditionMatches(
    condition: Record<string, unknown>,
    effective: Record<string, unknown>,
    quantity: Prisma.Decimal,
  ): boolean {
    const facts = { ...object(effective.dimensions), ...effective };
    if (
      condition.chargeType !== undefined &&
      String(condition.chargeType) !== String(effective.chargeType)
    )
      return false;
    if (
      condition.serviceType !== undefined &&
      String(condition.serviceType) !== String(effective.serviceType)
    )
      return false;
    if (
      condition.minBasis !== undefined &&
      quantity.lt(this.decimal(condition.minBasis, 'condition.minBasis'))
    )
      return false;
    if (
      condition.maxBasis !== undefined &&
      quantity.gt(this.decimal(condition.maxBasis, 'condition.maxBasis'))
    )
      return false;
    const field = optionalText(condition.field ?? condition.dimension);
    if (field) {
      const actual = facts[field];
      if (
        condition.equals !== undefined &&
        JSON.stringify(actual) !== JSON.stringify(condition.equals)
      )
        return false;
      if (
        Array.isArray(condition.in) &&
        !condition.in.some(
          (expected) => JSON.stringify(expected) === JSON.stringify(actual),
        )
      )
        return false;
    }
    if (condition.fromHour !== undefined || condition.toHour !== undefined) {
      const hour = new Date(String(effective.occurredAt)).getUTCHours();
      const from = Number(condition.fromHour ?? 0);
      const to = Number(condition.toHour ?? 24);
      if (from <= to ? hour < from || hour >= to : hour < from && hour >= to)
        return false;
    }
    return true;
  }

  private taxConfig(input: CalculateChargeInput['tax'], pricingTax: unknown) {
    const configured = object(pricingTax);
    const mode = String(
      input?.mode ?? configured.mode ?? 'EXCLUSIVE',
    ).toUpperCase();
    if (!['EXCLUSIVE', 'INCLUSIVE'].includes(mode))
      this.invalidPricing('tax.mode');
    const rate = this.decimal(input?.rate ?? configured.rate ?? 0, 'tax.rate');
    if (rate.isNegative() || rate.gt(100)) this.invalidPricing('tax.rate');
    return { mode: mode as TaxMode, rate };
  }

  private tax(
    amount: Prisma.Decimal,
    mode: TaxMode,
    rate: Prisma.Decimal,
    rounding: { mode: RoundingMode; scale: number },
  ) {
    if (mode === 'INCLUSIVE') {
      const taxable = this.round(amount.div(rate.div(100).plus(1)), rounding);
      const unrounded = amount.minus(taxable);
      const taxAmount = this.round(unrounded, rounding);
      return { amount: taxAmount, taxable, total: amount, unrounded };
    }
    const unrounded = amount.times(rate).div(100);
    const taxAmount = this.round(unrounded, rounding);
    return {
      amount: taxAmount,
      taxable: amount,
      total: amount.plus(taxAmount),
      unrounded,
    };
  }

  private fx(
    sourceAmount: Prisma.Decimal,
    sourceCurrency: string,
    requestedCurrency: string,
    input: CalculateChargeInput['fx'],
    rounding: { mode: RoundingMode; scale: number },
  ) {
    const targetCurrency = (requestedCurrency || sourceCurrency).toUpperCase();
    if (targetCurrency === sourceCurrency) {
      if (input && !this.decimal(input.exchangeRate, 'fx.exchangeRate').eq(1))
        throw new AppError(
          'BILLING_FX_INVALID',
          'Same-currency conversion must use exchange rate 1',
          400,
        );
      return {
        rate: new Prisma.Decimal(1),
        rateDate: input ? this.date(input.rateDate, 'fx.rateDate') : new Date(),
        source: input?.source?.trim() || 'IDENTITY',
        sourceAmount,
        targetCurrency,
      };
    }
    if (!input || input.targetCurrency.toUpperCase() !== targetCurrency)
      throw new AppError(
        'BILLING_FX_REQUIRED',
        'An exchange-rate source and date are required for cross-currency calculation',
        400,
      );
    const rate = this.decimal(input.exchangeRate, 'fx.exchangeRate');
    if (rate.lte(0) || !input.source?.trim())
      throw new AppError(
        'BILLING_FX_INVALID',
        'exchangeRate and source are required',
        400,
      );
    return {
      rate,
      rateDate: this.date(input.rateDate, 'fx.rateDate'),
      rounding,
      source: input.source.trim(),
      sourceAmount,
      targetCurrency,
    };
  }

  private rounding(
    input: CalculateChargeInput['rounding'],
    pricingRounding: unknown,
  ) {
    const configured = object(pricingRounding);
    const mode = String(
      input?.mode ?? configured.mode ?? 'HALF_UP',
    ).toUpperCase();
    const scale = Number(input?.scale ?? configured.scale ?? 2);
    if (
      !['CEIL', 'FLOOR', 'HALF_EVEN', 'HALF_UP'].includes(mode) ||
      !Number.isInteger(scale) ||
      scale < 0 ||
      scale > 6
    )
      throw new AppError(
        'BILLING_ROUNDING_INVALID',
        'Rounding mode or scale is invalid',
        400,
      );
    return { mode: mode as RoundingMode, scale };
  }

  private round(
    value: Prisma.Decimal,
    config: { mode: RoundingMode; scale: number },
  ) {
    const modes: Record<RoundingMode, Prisma.Decimal.Rounding> = {
      CEIL: Prisma.Decimal.ROUND_CEIL,
      FLOOR: Prisma.Decimal.ROUND_FLOOR,
      HALF_EVEN: Prisma.Decimal.ROUND_HALF_EVEN,
      HALF_UP: Prisma.Decimal.ROUND_HALF_UP,
    };
    return value.toDecimalPlaces(config.scale, modes[config.mode]);
  }

  private decimal(value: unknown, field: string) {
    try {
      const result = new Prisma.Decimal(String(value ?? ''));
      if (!result.isFinite()) throw new Error('not finite');
      return result;
    } catch {
      throw new AppError(
        'BILLING_PRICING_INVALID',
        `${field} is not a valid decimal`,
        409,
      );
    }
  }

  private optionalDecimal(value: unknown, field: string) {
    if (value === undefined || value === null || value === '') return undefined;
    const result = this.decimal(value, field);
    if (result.isNegative()) this.invalidPricing(field);
    return result;
  }

  private invalidPricing(field: string): never {
    throw new AppError(
      'BILLING_PRICING_INVALID',
      `Published rate pricing is invalid: ${field}`,
      409,
    );
  }

  private date(value: string, field: string) {
    const result = new Date(value);
    if (Number.isNaN(result.getTime()))
      throw new AppError(
        'BILLING_CALCULATION_INVALID',
        `${field} is invalid`,
        400,
      );
    return result;
  }

  private factSnapshot(fact: {
    aggregateRef: string;
    amount: Prisma.Decimal | null;
    businessRef: string;
    chargeType: string;
    currency: string;
    dimensions: Prisma.JsonValue;
    eventId: string;
    occurredAt: Date;
    organizationRef: string | null;
    partyRef: string;
    quantityBase: Prisma.Decimal;
    quantityBaseUom: string;
    quantityOriginal: Prisma.Decimal;
    quantityUom: string;
    routeRef: string | null;
    serviceType: string;
    sourceDomain: string;
    sourceEventType: string;
    sourceSnapshot: Prisma.JsonValue;
  }) {
    return {
      aggregateRef: fact.aggregateRef,
      ...(fact.amount ? { amount: fact.amount.toString() } : {}),
      businessRef: fact.businessRef,
      chargeType: fact.chargeType,
      currency: fact.currency,
      dimensions: fact.dimensions,
      eventId: fact.eventId,
      occurredAt: fact.occurredAt.toISOString(),
      ...(fact.organizationRef
        ? { organizationRef: fact.organizationRef }
        : {}),
      partyRef: fact.partyRef,
      quantityBase: fact.quantityBase.toString(),
      quantityBaseUom: fact.quantityBaseUom,
      quantityOriginal: fact.quantityOriginal.toString(),
      quantityUom: fact.quantityUom,
      ...(fact.routeRef ? { routeRef: fact.routeRef } : {}),
      serviceType: fact.serviceType,
      sourceDomain: fact.sourceDomain,
      sourceEventType: fact.sourceEventType,
      sourceSnapshot: fact.sourceSnapshot,
    };
  }
}
