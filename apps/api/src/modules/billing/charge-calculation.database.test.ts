import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { RateMatchingFacade } from '../mdm/public/rate-matching.facade';
import { ChargeCalculationService } from './charge-calculation.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('Billing versioned charge calculation', () => {
  afterAll(() => prisma.$disconnect());

  it('calculates tiers, limits, accessorials, tax and FX with immutable recomputation traces', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const partnerId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'billing-calculation-database-test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const metadata = () => ({
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      ipAddress: '127.0.0.1',
    });
    const occurredAt = new Date('2030-06-15T23:00:00.000Z');
    const contract = await prisma.contract.create({
      data: {
        approvalInstanceId: randomUUID(),
        approvedAt: new Date('2029-01-01T00:00:00.000Z'),
        approvedBy: actorId,
        code: `BILL-CAL-${randomUUID().slice(0, 8)}`,
        contractType: 'TRANSPORT',
        createdBy: actorId,
        currency: 'CNY',
        effectiveFrom: new Date('2029-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2040-01-01T00:00:00.000Z'),
        name: 'P4 计费计算合同',
        partnerId,
        partnerSnapshot: { code: 'CARRIER-CALCULATION' },
        status: 'ACTIVE',
        tenantId,
        terms: {},
        updatedBy: actorId,
      },
    });
    const card = await prisma.rateCard.create({
      data: {
        code: `TIER-${randomUUID().slice(0, 8)}`,
        contractId: contract.id,
        createdBy: actorId,
        name: '阶梯与附加费费率',
        serviceType: 'LINEHAUL',
        tenantId,
        updatedBy: actorId,
      },
    });
    const rate = await prisma.rateVersion.create({
      data: {
        baseRate: '1',
        createdBy: actorId,
        currency: 'CNY',
        dimensionHash: '3'.repeat(64),
        dimensions: { region: 'REMOTE' },
        effectiveFrom: new Date('2029-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2040-01-01T00:00:00.000Z'),
        pricing: {
          accessorials: [
            {
              code: 'FUEL',
              method: 'PERCENT_BASE',
              type: 'FUEL',
              value: '10',
            },
            {
              code: 'REMOTE',
              condition: {
                dimension: 'region',
                equals: 'REMOTE',
              },
              method: 'FIXED',
              type: 'REMOTE',
              value: '7.5',
            },
            {
              code: 'NIGHT',
              condition: { fromHour: 22, toHour: 6 },
              method: 'FIXED',
              type: 'NIGHT',
              value: '2',
            },
            {
              code: 'WAITING-NOT-APPLICABLE',
              condition: { dimension: 'waited', equals: true },
              method: 'FIXED',
              type: 'WAITING',
              value: '100',
            },
          ],
          basis: 'BASE_QUANTITY',
          increment: '5',
          maximumCharge: '200',
          minimumCharge: '50',
          rounding: { mode: 'HALF_UP', scale: 2 },
          startingCharge: '5',
          tiers: [
            { from: '0', rate: '2', to: '10' },
            { from: '10', rate: '3' },
          ],
        },
        publishedAt: new Date('2029-01-01T00:00:00.000Z'),
        rateCardId: card.id,
        status: 'PUBLISHED',
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    const fact = await prisma.chargeFact.create({
      data: {
        aggregateRef: 'SHIP-CALCULATION-1',
        businessRef: 'SHIP-CALCULATION-1',
        chargeType: 'TRANSPORT_LINEHAUL',
        contentHash: 'a'.repeat(64),
        createdBy: actorId,
        currency: 'CNY',
        dimensions: { region: 'REMOTE' },
        eventId: `event-${randomUUID()}`,
        occurredAt,
        partyRef: partnerId,
        quantityBase: '10',
        quantityBaseUom: 'KG',
        quantityOriginal: '10',
        quantityUom: 'KG',
        serviceType: 'LINEHAUL',
        sourceDomain: 'TMS',
        sourceEventType: 'shipment.delivered.v1',
        sourceSnapshot: { shipmentNo: 'SHIP-CALCULATION-1' },
        tenantId,
        updatedBy: actorId,
      },
    });
    const correctedSnapshot = {
      aggregateRef: fact.aggregateRef,
      businessRef: fact.businessRef,
      chargeType: fact.chargeType,
      currency: fact.currency,
      dimensions: { region: 'REMOTE' },
      eventId: fact.eventId,
      occurredAt: occurredAt.toISOString(),
      partyRef: partnerId,
      quantityBase: '12',
      quantityBaseUom: 'KG',
      quantityOriginal: '12',
      quantityUom: 'KG',
      serviceType: 'LINEHAUL',
      sourceDomain: 'TMS',
      sourceEventType: fact.sourceEventType,
      sourceSnapshot: fact.sourceSnapshot,
    };
    const correction = await prisma.factCorrection.create({
      data: {
        chargeFactId: fact.id,
        contentHash: 'b'.repeat(64),
        correctedSnapshot,
        correctionNo: `COR-${randomUUID()}`,
        createdBy: actorId,
        previousHash: fact.contentHash,
        reason: '复核计重为 12 KG',
        tenantId,
        updatedBy: actorId,
      },
    });
    const match = await prisma.rateMatch.create({
      data: {
        baseRate: rate.baseRate,
        chargeFactId: fact.id,
        contractRef: contract.id,
        createdBy: actorId,
        currency: 'CNY',
        factCorrectionId: correction.id,
        factOccurredAt: occurredAt,
        matchKey: `CORRECTION:${correction.id}`,
        priority: 10,
        rateCardRef: card.id,
        rateVersionNumber: rate.versionNumber,
        rateVersionRef: rate.id,
        status: 'MATCHED',
        tenantId,
        updatedBy: actorId,
      },
    });
    const service = new ChargeCalculationService(
      prisma as never,
      new RateMatchingFacade(prisma as never),
    );
    const first = await service.calculate(
      {
        chargeFactId: fact.id,
        direction: 'PAYABLE',
        fx: {
          exchangeRate: '0.14',
          rateDate: '2030-06-15',
          source: 'PBOC_TEST_FIXING',
          targetCurrency: 'USD',
        },
        settlementCurrency: 'USD',
        tax: { mode: 'EXCLUSIVE', rate: '6' },
      },
      context,
      metadata(),
    );
    expect(first).toMatchObject({
      accessorialAmount: '2.03',
      accessorialCount: 3,
      calculationVersion: 1,
      currency: 'USD',
      lineCount: 4,
      status: 'CALCULATED',
      subtotalAmount: '7',
      taxAmount: '0.54',
      totalAmount: '9.57',
    });
    const firstLines = await prisma.billingCalculationLine.findMany({
      orderBy: { lineNo: 'asc' },
      where: { calculationId: first.calculationId },
    });
    expect(firstLines.map(({ lineType }) => lineType)).toEqual([
      'STARTING_CHARGE',
      'TIER',
      'TIER',
      'MINIMUM_ADJUSTMENT',
    ]);
    expect(firstLines[1]?.basisQuantity.toString()).toBe('10');
    expect(firstLines[2]?.basisQuantity.toString()).toBe('5');
    const firstFx = await prisma.fxConversion.findFirstOrThrow({
      where: { calculationId: first.calculationId },
    });
    expect(firstFx).toMatchObject({
      sourceCurrency: 'CNY',
      sourceName: 'PBOC_TEST_FIXING',
      targetCurrency: 'USD',
    });
    expect(firstFx.roundingDifference.toString()).toBe('-0.0018');
    const firstTrace = await prisma.calculationTrace.findFirstOrThrow({
      where: { calculationId: first.calculationId },
    });
    expect(firstTrace.correctionSnapshot).toMatchObject({
      correctionId: correction.id,
    });
    expect(firstTrace.rateVersionSnapshot).toMatchObject({
      rateVersionId: rate.id,
      versionNumber: 1,
    });
    expect(firstTrace.outputSnapshot).toMatchObject({ totalAmount: '9.57' });

    const inclusive = await service.calculate(
      {
        chargeFactId: fact.id,
        direction: 'PAYABLE',
        reason: '含税口径重算',
        tax: { mode: 'INCLUSIVE', rate: '6' },
      },
      context,
      metadata(),
    );
    expect(inclusive).toMatchObject({
      calculationVersion: 2,
      currency: 'CNY',
      totalAmount: '64.5',
    });
    const inclusiveTax = await prisma.taxDetail.findFirstOrThrow({
      where: { calculationId: inclusive.calculationId },
    });
    expect(inclusiveTax.taxMode).toBe('INCLUSIVE');
    expect(inclusiveTax.taxAmount.toString()).toBe('3.65');

    const concurrent = await Promise.all(
      [0, 1].map(() =>
        service.calculate(
          {
            chargeFactId: fact.id,
            direction: 'PAYABLE',
            tax: { mode: 'EXCLUSIVE', rate: '0' },
          },
          context,
          metadata(),
        ),
      ),
    );
    expect(
      concurrent.map(({ calculationVersion }) => calculationVersion).sort(),
    ).toEqual([3, 4]);
    expect(
      await prisma.billingCalculation.count({
        where: { chargeFactId: fact.id, direction: 'PAYABLE', tenantId },
      }),
    ).toBe(4);
    const storedFirst = await prisma.billingCalculation.findUniqueOrThrow({
      where: { id: first.calculationId },
    });
    expect(storedFirst.totalAmount.toString()).toBe('9.57');
    await expect(
      prisma.billingCalculation.update({
        data: { totalAmount: '1' },
        where: { id: first.calculationId },
      }),
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.calculationTrace.delete({ where: { id: firstTrace.id } }),
    ).rejects.toThrow(/immutable/i);
    expect(
      await prisma.platformOutbox.count({
        where: {
          aggregateType: 'BillingCalculation',
          eventName: 'billing.charge.calculated.v1',
          tenantId,
        },
      }),
    ).toBe(4);

    const capCard = await prisma.rateCard.create({
      data: {
        code: `CAP-${randomUUID().slice(0, 8)}`,
        contractId: contract.id,
        createdBy: actorId,
        name: '封顶费率',
        serviceType: 'CAP_TEST',
        tenantId,
        updatedBy: actorId,
      },
    });
    const capRate = await prisma.rateVersion.create({
      data: {
        baseRate: '10',
        createdBy: actorId,
        currency: 'CNY',
        dimensionHash: '4'.repeat(64),
        dimensions: {},
        effectiveFrom: new Date('2029-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2040-01-01T00:00:00.000Z'),
        pricing: { maximumCharge: '30', unitRate: '10' },
        publishedAt: new Date('2029-01-01T00:00:00.000Z'),
        rateCardId: capCard.id,
        status: 'PUBLISHED',
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    const capFact = await prisma.chargeFact.create({
      data: {
        aggregateRef: 'SHIP-CAP-1',
        businessRef: 'SHIP-CAP-1',
        chargeType: 'CAP_TEST',
        contentHash: 'c'.repeat(64),
        createdBy: actorId,
        currency: 'CNY',
        dimensions: {},
        eventId: `event-${randomUUID()}`,
        occurredAt,
        partyRef: partnerId,
        quantityBase: '10',
        quantityBaseUom: 'EA',
        quantityOriginal: '10',
        quantityUom: 'EA',
        serviceType: 'CAP_TEST',
        sourceDomain: 'TMS',
        sourceEventType: 'shipment.delivered.v1',
        sourceSnapshot: {},
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.rateMatch.create({
      data: {
        baseRate: capRate.baseRate,
        chargeFactId: capFact.id,
        contractRef: contract.id,
        createdBy: actorId,
        currency: 'CNY',
        factOccurredAt: occurredAt,
        matchKey: `FACT:${capFact.id}`,
        rateCardRef: capCard.id,
        rateVersionNumber: capRate.versionNumber,
        rateVersionRef: capRate.id,
        status: 'MATCHED',
        tenantId,
        updatedBy: actorId,
      },
    });
    const capped = await service.calculate(
      {
        chargeFactId: capFact.id,
        direction: 'RECEIVABLE',
        tax: { mode: 'EXCLUSIVE', rate: '0' },
      },
      context,
      metadata(),
    );
    expect(capped).toMatchObject({ subtotalAmount: '30', totalAmount: '30' });
    expect(
      await prisma.billingCalculationLine.findFirst({
        where: {
          calculationId: capped.calculationId,
          lineType: 'CAP_ADJUSTMENT',
        },
      }),
    ).toMatchObject({ roundedAmount: expect.objectContaining({}) });

    const unmatchedFact = await prisma.chargeFact.create({
      data: {
        aggregateRef: 'SHIP-UNMATCHED-1',
        businessRef: 'SHIP-UNMATCHED-1',
        chargeType: 'NO_RATE',
        contentHash: 'd'.repeat(64),
        createdBy: actorId,
        currency: 'CNY',
        dimensions: {},
        eventId: `event-${randomUUID()}`,
        occurredAt,
        partyRef: partnerId,
        quantityBase: '1',
        quantityBaseUom: 'EA',
        quantityOriginal: '1',
        quantityUom: 'EA',
        serviceType: 'NO_RATE',
        sourceDomain: 'TMS',
        sourceEventType: 'shipment.delivered.v1',
        sourceSnapshot: {},
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.rateMatch.create({
      data: {
        chargeFactId: unmatchedFact.id,
        createdBy: actorId,
        currency: 'CNY',
        factOccurredAt: occurredAt,
        matchKey: `FACT:${unmatchedFact.id}`,
        status: 'UNMATCHED',
        tenantId,
        updatedBy: actorId,
      },
    });
    await expect(
      service.calculate(
        { chargeFactId: unmatchedFact.id, direction: 'PAYABLE' },
        context,
        metadata(),
      ),
    ).rejects.toMatchObject({
      code: 'BILLING_RATE_MATCH_REQUIRED',
      statusCode: 409,
    });
    expect(match.rateVersionRef).toBe(rate.id);
  });
});
