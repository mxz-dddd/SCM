import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { RateMatchingFacade } from '../mdm/public/rate-matching.facade';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

@Injectable()
export class FreightBillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateMatchingFacade) private readonly rates: RateMatchingFacade,
  ) {}

  async workbench(context: TenantContext) {
    const query = {
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: 300,
      where: { tenantId: context.tenantId },
    };
    const [
      facts,
      calculations,
      exceptions,
      accruals,
      carrierStatements,
      customerStatements,
      lines,
      apVouchers,
      arVouchers,
      shipments,
      rateSources,
    ] = await Promise.all([
      this.prisma.freightChargeFact.findMany(query),
      this.prisma.chargeCalculation.findMany(query),
      this.prisma.billingException.findMany(query),
      this.prisma.accrualVoucher.findMany(query),
      this.prisma.carrierStatement.findMany(query),
      this.prisma.customerStatement.findMany(query),
      this.prisma.settlementStatementLine.findMany(query),
      this.prisma.aPVoucher.findMany(query),
      this.prisma.aRVoucher.findMany(query),
      this.prisma.shipment.findMany({
        ...query,
        where: {
          status: { in: ['POD', 'SETTLED'] },
          tenantId: context.tenantId,
        },
      }),
      this.rates.listActiveSources(context),
    ]);
    return toHttpJson({
      accruals,
      apVouchers,
      arVouchers,
      calculations,
      carrierStatements,
      customerStatements,
      exceptions,
      facts,
      lines,
      rateSources,
      shipments,
    });
  }

  captureFacts(
    shipmentId: string,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${shipmentId}:charge-facts`);
      const shipment = await tx.shipment.findFirst({
        where: {
          id: shipmentId,
          status: { in: ['POD', 'SETTLED'] },
          tenantId: context.tenantId,
        },
      });
      if (!shipment)
        throw new AppError(
          'TMS_BILLING_POD_REQUIRED',
          'POD shipment is required for confirmed charge facts',
          409,
        );
      const [segments, delivery, assignment, exceptions, milestones] =
        await Promise.all([
          tx.trackSegment.findMany({
            where: { shipmentId, tenantId: context.tenantId },
          }),
          tx.deliveryConfirmation.findUnique({
            where: {
              tenantId_shipmentId: { shipmentId, tenantId: context.tenantId },
            },
          }),
          tx.vehicleAssignment.findFirst({
            orderBy: { createdAt: 'desc' },
            where: { shipmentId, tenantId: context.tenantId },
          }),
          tx.transportException.findMany({
            where: { shipmentId, tenantId: context.tenantId },
          }),
          tx.shipmentMilestone.findMany({
            where: { shipmentId, tenantId: context.tenantId },
          }),
        ]);
      const plannedDuration = new Prisma.Decimal(
        (shipment.deliveryWindowTo.getTime() -
          shipment.pickupWindowFrom.getTime()) /
          3_600_000,
      );
      const confirmedDistance = segments.reduce(
        (sum, segment) => sum.plus(segment.distanceMeters),
        new Prisma.Decimal(0),
      );
      const confirmedDuration = segments
        .reduce(
          (sum, segment) => sum.plus(segment.durationSeconds),
          new Prisma.Decimal(0),
        )
        .div(3600);
      const handlingHours = delivery
        ? new Prisma.Decimal(
            (delivery.unloadingCompletedAt.getTime() -
              delivery.unloadingStartedAt.getTime()) /
              3_600_000,
          )
        : new Prisma.Decimal(0);
      const waitingHours = delivery
        ? new Prisma.Decimal(
            (delivery.unloadingStartedAt.getTime() -
              delivery.arrivedAt.getTime()) /
              3_600_000,
          )
        : new Prisma.Decimal(0);
      const inputs = [
        {
          factType: 'WEIGHT',
          source: 'PLANNED',
          sourceReference: 'SHIPMENT_WEIGHT',
          uom: 'KG',
          value: shipment.totalWeightBase,
        },
        {
          factType: 'VOLUME',
          source: 'PLANNED',
          sourceReference: 'SHIPMENT_VOLUME',
          uom: 'M3',
          value: shipment.totalVolumeBase,
        },
        {
          factType: 'DURATION',
          source: 'PLANNED',
          sourceReference: 'PLANNED_WINDOW',
          uom: 'HOUR',
          value: plannedDuration,
        },
        {
          factType: 'EQUIPMENT',
          source: 'PLANNED',
          sourceReference: 'ASSIGNMENT_EQUIPMENT',
          uom: 'UNIT',
          value: new Prisma.Decimal(assignment ? 1 : 0),
        },
        {
          factType: 'DISTANCE',
          source: 'CONFIRMED',
          sourceReference: 'TRACK_SEGMENTS',
          uom: 'M',
          value: confirmedDistance,
        },
        {
          factType: 'DURATION',
          source: 'CONFIRMED',
          sourceReference: 'TRACK_SEGMENTS',
          uom: 'HOUR',
          value: confirmedDuration,
        },
        {
          factType: 'WAITING',
          source: 'CONFIRMED',
          sourceReference: 'ARRIVAL_TO_UNLOADING',
          uom: 'HOUR',
          value: waitingHours,
        },
        {
          factType: 'HANDLING',
          source: 'CONFIRMED',
          sourceReference: 'DELIVERY_UNLOADING',
          uom: 'HOUR',
          value: handlingHours,
        },
        {
          factType: 'MILESTONE',
          source: 'CONFIRMED',
          sourceReference: 'COMPLETED_MILESTONES',
          uom: 'COUNT',
          value: new Prisma.Decimal(
            milestones.filter(({ status }) => status === 'COMPLETED').length,
          ),
        },
        {
          factType: 'EXCEPTION',
          source: 'CONFIRMED',
          sourceReference: 'TRANSPORT_EXCEPTIONS',
          uom: 'COUNT',
          value: new Prisma.Decimal(exceptions.length),
        },
      ] as const;
      const factIds: string[] = [];
      for (const input of inputs) {
        const existing = await tx.freightChargeFact.findUnique({
          where: {
            tenantId_shipmentId_source_factType_sourceReference: {
              factType: input.factType,
              shipmentId,
              source: input.source,
              sourceReference: input.sourceReference,
              tenantId: context.tenantId,
            },
          },
        });
        if (existing) {
          factIds.push(existing.id);
          continue;
        }
        const id = randomUUID();
        const fact = await tx.freightChargeFact.create({
          data: {
            createdBy: context.accountId,
            factNo: `FCF-${Date.now()}-${id.slice(0, 6)}`,
            factSnapshot: json({ shipmentVersion: shipment.version }),
            factType: input.factType,
            id,
            occurredAt: delivery?.signedAt ?? new Date(),
            shipmentId,
            source: input.source,
            sourceReference: input.sourceReference,
            tenantId: context.tenantId,
            uom: input.uom,
            updatedBy: context.accountId,
            value: input.value,
          },
        });
        factIds.push(fact.id);
      }
      await this.emit(
        tx,
        shipmentId,
        shipment.version,
        'shipment.charge-facts-captured.v1',
        context,
        metadata,
        { factIds, shipmentId },
      );
      return { factIds, shipmentId };
    });
  }

  async calculate(
    shipmentId: string,
    input: {
      contractId: string;
      dimensions: Readonly<Record<string, unknown>>;
      direction: 'PAYABLE' | 'RECEIVABLE';
      freightChargeFactId: string;
      serviceType: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    this.uuid(input.contractId, 'contractId');
    this.uuid(input.freightChargeFactId, 'freightChargeFactId');
    const fact = await this.prisma.freightChargeFact.findFirst({
      where: {
        id: input.freightChargeFactId,
        shipmentId,
        tenantId: context.tenantId,
      },
    });
    if (!fact)
      throw new AppError(
        'TMS_BILLING_FACT_INVALID',
        'Charge fact does not belong to shipment',
        409,
      );
    const candidates = await this.rates.match(
      {
        contractId: input.contractId,
        dimensions: input.dimensions,
        occurredAt: fact.occurredAt,
        serviceType: input.serviceType,
      },
      context,
    );
    return this.prisma.$transaction(async (tx) => {
      await this.lock(
        tx,
        `${context.tenantId}:${shipmentId}:${input.direction}:calculation`,
      );
      const latest = await tx.chargeCalculation.findFirst({
        orderBy: { calculationVersion: 'desc' },
        where: {
          direction: input.direction,
          shipmentId,
          tenantId: context.tenantId,
        },
      });
      const calculationVersion = (latest?.calculationVersion ?? 0) + 1;
      const id = randomUUID();
      if (candidates.length !== 1) {
        const exceptionCode = candidates.length
          ? 'MULTIPLE_RATE_MATCHES'
          : 'RATE_NOT_FOUND';
        const calculation = await tx.chargeCalculation.create({
          data: {
            baseAmount: 0,
            calculatedAt: new Date(),
            calculationNo: `CAL-${Date.now()}-${id.slice(0, 6)}`,
            calculationTrace: json({
              candidates,
              dimensions: input.dimensions,
              rule: 'UNIQUE_EFFECTIVE_RATE',
            }),
            calculationVersion,
            contractId: input.contractId,
            createdBy: context.accountId,
            currency: 'XXX',
            direction: input.direction,
            exceptionCode,
            freightChargeFactId: fact.id,
            id,
            shipmentId,
            status: 'EXCEPTION',
            surchargeAmount: 0,
            taxAmount: 0,
            tenantId: context.tenantId,
            totalAmount: 0,
            updatedBy: context.accountId,
          },
        });
        await tx.billingException.create({
          data: {
            candidateSnapshot: json(candidates),
            chargeCalculationId: calculation.id,
            code: exceptionCode,
            createdBy: context.accountId,
            reason: candidates.length
              ? 'More than one effective rate matched'
              : 'No effective rate matched; zero price is forbidden',
            shipmentId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
        await this.emit(
          tx,
          calculation.id,
          calculation.version,
          'charge.exception-opened.v1',
          context,
          metadata,
          { calculationId: calculation.id, code: exceptionCode, shipmentId },
          'ChargeCalculation',
        );
        return {
          calculationId: calculation.id,
          exceptionCode,
          status: calculation.status,
          version: calculation.version,
        };
      }
      const rate = candidates[0]!;
      const pricing = record(rate.pricing);
      const number = (key: string, fallback = 0) =>
        new Prisma.Decimal(String(pricing[key] ?? fallback));
      const baseRate = new Prisma.Decimal(rate.baseRate);
      const unitAmount = fact.value.mul(number('unitRate'));
      let baseAmount = baseRate.plus(unitAmount);
      const minimum = number('minimumCharge');
      if (baseAmount.lessThan(minimum)) baseAmount = minimum;
      const markup =
        input.direction === 'RECEIVABLE'
          ? baseAmount.mul(number('markupPercent')).div(100)
          : new Prisma.Decimal(0);
      const fuel = baseAmount.mul(number('fuelPercent')).div(100);
      const waiting =
        fact.factType === 'WAITING'
          ? fact.value.mul(number('waitingRate')).plus(number('waitingFee'))
          : new Prisma.Decimal(0);
      const surchargeAmount = markup.plus(fuel).plus(waiting);
      const taxAmount = baseAmount
        .plus(surchargeAmount)
        .mul(number('taxRate'))
        .div(100);
      const totalAmount = baseAmount.plus(surchargeAmount).plus(taxAmount);
      const calculation = await tx.chargeCalculation.create({
        data: {
          baseAmount,
          calculationNo: `CAL-${Date.now()}-${id.slice(0, 6)}`,
          calculationTrace: json({
            candidates,
            formula: 'BASE_PLUS_UNIT_MINIMUM_SURCHARGE_TAX_V1',
            inputs: {
              factType: fact.factType,
              factValue: fact.value.toString(),
              fuelPercent: number('fuelPercent').toString(),
              markupPercent: number('markupPercent').toString(),
              minimumCharge: minimum.toString(),
              taxRate: number('taxRate').toString(),
              unitRate: number('unitRate').toString(),
              waitingRate: number('waitingRate').toString(),
            },
            outputs: {
              baseAmount: baseAmount.toString(),
              surchargeAmount: surchargeAmount.toString(),
              taxAmount: taxAmount.toString(),
              totalAmount: totalAmount.toString(),
            },
            rounding: 'DECIMAL_EXACT_6',
          }),
          calculationVersion,
          contractId: input.contractId,
          createdBy: context.accountId,
          currency: rate.currency,
          direction: input.direction,
          freightChargeFactId: fact.id,
          id,
          rateVersionId: rate.rateVersionId,
          rateVersionNumber: rate.versionNumber,
          shipmentId,
          status: 'CALCULATED',
          surchargeAmount,
          taxAmount,
          tenantId: context.tenantId,
          totalAmount,
          updatedBy: context.accountId,
        },
      });
      const supersededExceptions = await tx.chargeCalculation.findMany({
        select: { id: true },
        where: {
          direction: input.direction,
          id: { not: calculation.id },
          shipmentId,
          status: 'EXCEPTION',
          tenantId: context.tenantId,
        },
      });
      if (supersededExceptions.length)
        await tx.billingException.updateMany({
          data: {
            resolvedAt: new Date(),
            status: 'RESOLVED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: {
            chargeCalculationId: {
              in: supersededExceptions.map(({ id }) => id),
            },
            status: 'OPEN',
            tenantId: context.tenantId,
          },
        });
      await this.emit(
        tx,
        calculation.id,
        calculation.version,
        'charge.calculated.v1',
        context,
        metadata,
        {
          amount: totalAmount.toString(),
          calculationId: calculation.id,
          rateVersion: rate.versionNumber,
          shipmentId,
          tax: taxAmount.toString(),
        },
        'ChargeCalculation',
      );
      return {
        calculationId: calculation.id,
        status: calculation.status,
        totalAmount: totalAmount.toString(),
        version: calculation.version,
      };
    });
  }

  createAccrual(
    calculationId: string,
    input: { accountingDate: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(calculationId, 'calculationId');
    const accountingDate = this.date(input.accountingDate);
    return this.prisma.$transaction(async (tx) => {
      const calculation = await tx.chargeCalculation.findFirst({
        where: {
          direction: 'PAYABLE',
          id: calculationId,
          status: 'CALCULATED',
          tenantId: context.tenantId,
        },
      });
      if (!calculation)
        throw new AppError(
          'TMS_ACCRUAL_CALCULATION_INVALID',
          'Calculated payable is required',
          409,
        );
      const existing = await tx.accrualVoucher.findFirst({
        where: {
          chargeCalculationId: calculation.id,
          reversalOfId: null,
          tenantId: context.tenantId,
        },
      });
      if (existing)
        return {
          accrualVoucherId: existing.id,
          replayed: true,
          status: existing.status,
          version: existing.version,
        };
      const id = randomUUID();
      const voucher = await tx.accrualVoucher.create({
        data: {
          accountingDate,
          amount: calculation.totalAmount,
          basisSnapshot: json({
            calculationTrace: calculation.calculationTrace,
            rateVersionId: calculation.rateVersionId,
          }),
          chargeCalculationId: calculation.id,
          createdBy: context.accountId,
          currency: calculation.currency,
          id,
          shipmentId: calculation.shipmentId,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          voucherNo: `ACR-${Date.now()}-${id.slice(0, 6)}`,
        },
      });
      await this.emit(
        tx,
        voucher.id,
        voucher.version,
        'charge.accrued.v1',
        context,
        metadata,
        {
          calculationId,
          shipmentId: calculation.shipmentId,
          voucherId: voucher.id,
        },
        'AccrualVoucher',
      );
      return {
        accrualVoucherId: voucher.id,
        status: voucher.status,
        version: voucher.version,
      };
    });
  }

  createStatement(
    direction: 'PAYABLE' | 'RECEIVABLE',
    input: {
      calculationIds: readonly string[];
      contractId: string;
      partnerRef: string;
      periodFrom: string;
      periodTo: string;
      pricingSnapshot?: Readonly<Record<string, unknown>>;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.contractId, 'contractId');
    const from = this.date(input.periodFrom);
    const to = this.date(input.periodTo);
    if (
      !input.calculationIds.length ||
      !input.partnerRef?.trim() ||
      to < from ||
      input.calculationIds.some((id) => !isUuid(id))
    )
      this.invalid('Statement input is invalid');
    return this.prisma.$transaction(async (tx) => {
      const calculations = await tx.chargeCalculation.findMany({
        where: {
          calculatedAt: { gte: from, lte: new Date(to.getTime() + 86_399_999) },
          contractId: input.contractId,
          direction,
          id: { in: [...new Set(input.calculationIds)] },
          status: 'CALCULATED',
          tenantId: context.tenantId,
        },
      });
      if (
        calculations.length !== new Set(input.calculationIds).size ||
        new Set(calculations.map(({ currency }) => currency)).size !== 1
      )
        throw new AppError(
          'TMS_STATEMENT_CALCULATION_INVALID',
          'All calculations must be eligible and share a currency',
          409,
        );
      for (const calculation of calculations)
        await this.assertSettlementEligible(
          tx,
          calculation.shipmentId,
          context.tenantId,
        );
      const subtotal = calculations.reduce(
        (sum, calculation) =>
          sum.plus(calculation.baseAmount).plus(calculation.surchargeAmount),
        new Prisma.Decimal(0),
      );
      const taxAmount = calculations.reduce(
        (sum, calculation) => sum.plus(calculation.taxAmount),
        new Prisma.Decimal(0),
      );
      const totalAmount = subtotal.plus(taxAmount);
      const id = randomUUID();
      const statement =
        direction === 'PAYABLE'
          ? await tx.carrierStatement.create({
              data: {
                carrierRef: input.partnerRef.trim(),
                contractId: input.contractId,
                createdBy: context.accountId,
                currency: calculations[0]!.currency,
                id,
                periodFrom: from,
                periodTo: to,
                statementNo: `CST-${Date.now()}-${id.slice(0, 6)}`,
                subtotal,
                taxAmount,
                tenantId: context.tenantId,
                totalAmount,
                updatedBy: context.accountId,
              },
            })
          : await tx.customerStatement.create({
              data: {
                contractId: input.contractId,
                createdBy: context.accountId,
                currency: calculations[0]!.currency,
                customerRef: input.partnerRef.trim(),
                id,
                periodFrom: from,
                periodTo: to,
                pricingSnapshot: json(input.pricingSnapshot),
                statementNo: `UST-${Date.now()}-${id.slice(0, 6)}`,
                subtotal,
                taxAmount,
                tenantId: context.tenantId,
                totalAmount,
                updatedBy: context.accountId,
              },
            });
      for (const calculation of calculations)
        await tx.settlementStatementLine.create({
          data: {
            amount: calculation.baseAmount.plus(calculation.surchargeAmount),
            chargeCalculationId: calculation.id,
            createdBy: context.accountId,
            currency: calculation.currency,
            direction,
            lineSnapshot: json({
              calculationVersion: calculation.calculationVersion,
              rateVersionId: calculation.rateVersionId,
            }),
            shipmentId: calculation.shipmentId,
            statementId: statement.id,
            taxAmount: calculation.taxAmount,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      await this.emit(
        tx,
        statement.id,
        statement.version,
        `charge.${direction === 'PAYABLE' ? 'carrier' : 'customer'}-statement-created.v1`,
        context,
        metadata,
        {
          calculationIds: calculations.map(
            ({ id: calculationId }) => calculationId,
          ),
          statementId: statement.id,
        },
        direction === 'PAYABLE' ? 'CarrierStatement' : 'CustomerStatement',
      );
      return {
        statementId: statement.id,
        status: statement.status,
        totalAmount: totalAmount.toString(),
        version: statement.version,
      };
    });
  }

  transitionStatement(
    direction: 'PAYABLE' | 'RECEIVABLE',
    id: string,
    input: {
      decision: 'CONFIRM' | 'DISPUTE' | 'ADJUST';
      disputeSnapshot: Readonly<Record<string, unknown>>;
      expectedVersion: number;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'statementId');
    return this.prisma.$transaction(async (tx) => {
      const statement =
        direction === 'PAYABLE'
          ? await tx.carrierStatement.findFirst({
              where: { id, tenantId: context.tenantId },
            })
          : await tx.customerStatement.findFirst({
              where: { id, tenantId: context.tenantId },
            });
      if (!statement || statement.version !== input.expectedVersion)
        throw this.conflict('TMS_STATEMENT_VERSION_CONFLICT');
      const next =
        input.decision === 'DISPUTE' && statement.status === 'DRAFT'
          ? 'DISPUTED'
          : input.decision === 'ADJUST' && statement.status === 'DISPUTED'
            ? 'ADJUSTED'
            : input.decision === 'CONFIRM' &&
                ['DRAFT', 'ADJUSTED'].includes(statement.status)
              ? 'VOUCHERED'
              : null;
      if (!next)
        throw new AppError(
          'TMS_STATEMENT_TRANSITION_INVALID',
          `Cannot ${input.decision} from ${statement.status}`,
          409,
        );
      const update = {
        confirmedAt: next === 'VOUCHERED' ? new Date() : statement.confirmedAt,
        disputeSnapshot: json(input.disputeSnapshot),
        status: next,
        updatedBy: context.accountId,
        version: { increment: 1 },
      } as const;
      const changed =
        direction === 'PAYABLE'
          ? await tx.carrierStatement.update({ data: update, where: { id } })
          : await tx.customerStatement.update({ data: update, where: { id } });
      let voucherId: string | undefined;
      if (next === 'VOUCHERED') {
        const voucher =
          direction === 'PAYABLE'
            ? await tx.aPVoucher.create({
                data: {
                  amount: statement.subtotal,
                  carrierStatementId: id,
                  createdBy: context.accountId,
                  currency: statement.currency,
                  sourceSnapshot: json({ statementVersion: changed.version }),
                  taxAmount: statement.taxAmount,
                  tenantId: context.tenantId,
                  updatedBy: context.accountId,
                  voucherNo: `AP-${Date.now()}-${id.slice(0, 6)}`,
                },
              })
            : await tx.aRVoucher.create({
                data: {
                  amount: statement.subtotal,
                  createdBy: context.accountId,
                  currency: statement.currency,
                  customerStatementId: id,
                  sourceSnapshot: json({ statementVersion: changed.version }),
                  taxAmount: statement.taxAmount,
                  tenantId: context.tenantId,
                  updatedBy: context.accountId,
                  voucherNo: `AR-${Date.now()}-${id.slice(0, 6)}`,
                },
              });
        voucherId = voucher.id;
      }
      await this.emit(
        tx,
        changed.id,
        changed.version,
        `charge.statement-${next.toLowerCase()}.v1`,
        context,
        metadata,
        { direction, statementId: id, voucherId: voucherId ?? null },
        direction === 'PAYABLE' ? 'CarrierStatement' : 'CustomerStatement',
      );
      return {
        statementId: id,
        status: changed.status,
        version: changed.version,
        voucherId,
      };
    });
  }

  settleShipment(
    shipmentId: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(shipmentId, 'shipmentId');
    return this.prisma.$transaction(async (tx) => {
      await this.assertSettlementEligible(tx, shipmentId, context.tenantId);
      const shipment = await tx.shipment.findFirst({
        where: {
          id: shipmentId,
          status: 'POD',
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (!shipment) throw this.conflict('TMS_SETTLEMENT_SHIPMENT_CONFLICT');
      const lines = await tx.settlementStatementLine.findMany({
        where: { shipmentId, tenantId: context.tenantId },
      });
      if (
        !lines.some(({ direction }) => direction === 'PAYABLE') ||
        !lines.some(({ direction }) => direction === 'RECEIVABLE')
      )
        throw new AppError(
          'TMS_SETTLEMENT_BOTH_SIDES_REQUIRED',
          'Independent payable and receivable statements are required',
          409,
        );
      const [ap, ar] = await Promise.all([
        tx.aPVoucher.count({
          where: {
            carrierStatementId: {
              in: lines
                .filter(({ direction }) => direction === 'PAYABLE')
                .map(({ statementId }) => statementId),
            },
            tenantId: context.tenantId,
          },
        }),
        tx.aRVoucher.count({
          where: {
            customerStatementId: {
              in: lines
                .filter(({ direction }) => direction === 'RECEIVABLE')
                .map(({ statementId }) => statementId),
            },
            tenantId: context.tenantId,
          },
        }),
      ]);
      if (!ap || !ar)
        throw new AppError(
          'TMS_SETTLEMENT_VOUCHERS_REQUIRED',
          'AP and AR vouchers are required',
          409,
        );
      const changed = await tx.shipment.update({
        data: {
          status: 'SETTLED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: shipmentId },
      });
      await this.emit(
        tx,
        changed.id,
        changed.version,
        'shipment.settled.v1',
        context,
        metadata,
        { shipmentId },
        'Shipment',
      );
      return { shipmentId, status: changed.status, version: changed.version };
    });
  }

  private async assertSettlementEligible(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    tenantId: string,
  ) {
    const [pod, openExceptions, openClaims, openBillingExceptions] =
      await Promise.all([
        tx.proofOfDelivery.count({
          where: { shipmentId, status: 'CONFIRMED', tenantId },
        }),
        tx.transportException.count({
          where: {
            shipmentId,
            status: { in: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] },
            tenantId,
          },
        }),
        tx.claimCase.count({
          where: {
            shipmentId,
            status: { notIn: ['REJECTED', 'CLOSED'] },
            tenantId,
          },
        }),
        tx.billingException.count({
          where: { shipmentId, status: 'OPEN', tenantId },
        }),
      ]);
    if (!pod || openExceptions || openClaims || openBillingExceptions)
      throw new AppError(
        'TMS_SETTLEMENT_POLICY_BLOCKED',
        'Confirmed POD and resolved exceptions/claims are required',
        409,
      );
  }
  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
  }
  private date(value: string) {
    const result = new Date(value);
    if (!value || Number.isNaN(result.getTime()))
      this.invalid('Date is invalid');
    return result;
  }
  private uuid(value: string, field: string) {
    if (!isUuid(value)) this.invalid(`${field} is invalid`);
  }
  private invalid(message: string): never {
    throw new AppError('TMS_BILLING_INPUT_INVALID', message, 400);
  }
  private conflict(code: string) {
    return new AppError(code, 'Resource version or state changed', 409, {
      retryable: true,
    });
  }
  private async emit(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: Prisma.InputJsonObject,
    aggregateType = 'Shipment',
  ) {
    await Promise.all([
      tx.platformAuditLog.create({
        data: {
          action: eventName,
          after: payload,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: id,
          resourceType: aggregateType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType,
          aggregateVersion: version,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          partitionKey: id,
          payload: { ...payload, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
}
