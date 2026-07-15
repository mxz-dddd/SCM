import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { RateMatchingFacade } from '../mdm/public/rate-matching.facade';
import { EventService } from '../platform/event.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import { ChargeFactRateService } from './charge-fact-rate.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('Billing charge fact and historical rate matching', () => {
  afterAll(() => prisma.$disconnect());

  it('deduplicates immutable facts, appends corrections and traces occurrence-time rate decisions', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const partnerId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'billing-fact-database-test',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const command = () => ({
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      ipAddress: '127.0.0.1',
    });
    const occurredAt = new Date('2030-06-15T08:00:00.000Z');
    const contract = await prisma.contract.create({
      data: {
        approvalInstanceId: randomUUID(),
        approvedAt: new Date('2029-01-01T00:00:00.000Z'),
        approvedBy: actorId,
        code: `BILLING-${randomUUID().slice(0, 8)}`,
        contractType: 'TRANSPORT',
        createdBy: actorId,
        currency: 'CNY',
        effectiveFrom: new Date('2029-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2040-01-01T00:00:00.000Z'),
        name: 'P4 计费事实验收合同',
        partnerId,
        partnerSnapshot: { code: 'CARRIER-P4' },
        status: 'ACTIVE',
        tenantId,
        terms: { organizationRef: context.tenantId, priority: 1 },
        updatedBy: actorId,
      },
    });
    const primaryCard = await prisma.rateCard.create({
      data: {
        code: `LINEHAUL-${randomUUID().slice(0, 8)}`,
        contractId: contract.id,
        createdBy: actorId,
        name: '干线主费率',
        serviceType: 'LINEHAUL',
        tenantId,
        updatedBy: actorId,
      },
    });
    const historicalRate = await prisma.rateVersion.create({
      data: {
        baseRate: '12.50',
        createdBy: actorId,
        currency: 'CNY',
        dimensionHash: '1'.repeat(64),
        dimensions: { equipmentType: 'VAN', route: 'SHA-SUZ' },
        effectiveFrom: new Date('2029-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2032-01-01T00:00:00.000Z'),
        pricing: { priority: 100 },
        publishedAt: new Date('2029-01-01T00:00:00.000Z'),
        rateCardId: primaryCard.id,
        status: 'PUBLISHED',
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    await prisma.rateVersion.create({
      data: {
        baseRate: '99.00',
        createdBy: actorId,
        currency: 'CNY',
        dimensionHash: '1'.repeat(64),
        dimensions: { equipmentType: 'VAN', route: 'SHA-SUZ' },
        effectiveFrom: new Date('2032-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2040-01-01T00:00:00.000Z'),
        pricing: { priority: 999 },
        publishedAt: new Date('2032-01-01T00:00:00.000Z'),
        rateCardId: primaryCard.id,
        status: 'PUBLISHED',
        tenantId,
        updatedBy: actorId,
        versionNumber: 2,
      },
    });
    const fallbackCard = await prisma.rateCard.create({
      data: {
        code: `FALLBACK-${randomUUID().slice(0, 8)}`,
        contractId: contract.id,
        createdBy: actorId,
        name: '干线低优先级费率',
        serviceType: 'LINEHAUL',
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.rateVersion.create({
      data: {
        baseRate: '8.00',
        createdBy: actorId,
        currency: 'CNY',
        dimensionHash: '2'.repeat(64),
        dimensions: { equipmentType: 'VAN', route: 'SHA-SUZ' },
        effectiveFrom: new Date('2029-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2040-01-01T00:00:00.000Z'),
        pricing: { priority: 10 },
        publishedAt: new Date('2029-01-01T00:00:00.000Z'),
        rateCardId: fallbackCard.id,
        status: 'PUBLISHED',
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    const events = new EventConsumptionFacade(
      new EventService(
        new IdempotencyService(prisma as never),
        prisma as never,
      ),
    );
    const service = new ChargeFactRateService(
      prisma as never,
      new RateMatchingFacade(prisma as never),
      events,
    );
    const input = {
      aggregateRef: 'SHIPMENT-P4-001',
      businessRef: 'SHIPMENT-P4-001',
      chargeType: 'TRANSPORT_LINEHAUL',
      currency: 'CNY',
      dimensions: { equipmentType: 'VAN', route: 'SHA-SUZ' },
      eventId: `event-${randomUUID()}`,
      occurredAt: occurredAt.toISOString(),
      organizationRef: context.tenantId,
      partyRef: partnerId,
      quantityBase: '1000',
      quantityBaseUom: 'KG',
      quantityOriginal: '1',
      quantityUom: 'TON',
      routeRef: 'SHA-SUZ',
      serviceType: 'LINEHAUL',
      sourceDomain: 'TMS' as const,
      sourceEventType: 'shipment.delivered.v1',
      sourceSnapshot: { shipmentNo: 'SHP-P4-001' },
    };
    const received = await service.receive(input, context, command());
    expect(received).toMatchObject({
      duplicate: false,
      matchStatus: 'MATCHED',
      selectedRateVersionId: historicalRate.id,
      status: 'ACTIVE',
    });
    const sameEventReplay = await service.receive(input, context, command());
    expect(sameEventReplay).toMatchObject({
      chargeFactId: received.chargeFactId,
      duplicate: true,
      rateMatchId: received.rateMatchId,
    });
    const sameBusinessReplay = await service.receive(
      { ...input, eventId: `event-${randomUUID()}` },
      context,
      command(),
    );
    expect(sameBusinessReplay).toMatchObject({
      chargeFactId: received.chargeFactId,
      duplicate: true,
    });
    await expect(
      service.receive({ ...input, quantityBase: '1001' }, context, command()),
    ).rejects.toMatchObject({
      code: 'BILLING_CHARGE_FACT_CONFLICT',
      statusCode: 409,
    });
    const correction = await service.correct(
      received.chargeFactId,
      {
        corrected: { quantityBase: '1001', quantityOriginal: '1.001' },
        reason: '承运商复核称重后更正',
      },
      context,
      command(),
    );
    expect(correction).toMatchObject({
      duplicate: false,
      matchStatus: 'MATCHED',
      originalContentHash: expect.any(String),
      selectedRateVersionId: historicalRate.id,
    });
    const replayedCorrection = await service.correct(
      received.chargeFactId,
      {
        corrected: { quantityBase: '1001', quantityOriginal: '1.001' },
        reason: '相同更正内容重放',
      },
      context,
      command(),
    );
    expect(replayedCorrection).toMatchObject({
      correctionId: correction.correctionId,
      duplicate: true,
    });
    const storedFact = await prisma.chargeFact.findUniqueOrThrow({
      where: { id: received.chargeFactId },
    });
    expect(storedFact.quantityBase.toString()).toBe('1000');
    expect(
      await prisma.factCorrection.count({
        where: { chargeFactId: storedFact.id },
      }),
    ).toBe(1);
    const trace = await prisma.matchTrace.findFirstOrThrow({
      where: { rateMatchId: received.rateMatchId! },
    });
    expect(trace.decisionSnapshot).toMatchObject({
      rule: 'HIGHEST_PRIORITY_THEN_LATEST_VERSION',
      selected: { rateVersionId: historicalRate.id },
    });
    expect(trace.candidateSnapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eligible: true, priority: 100 }),
        expect.objectContaining({ eligible: true, priority: 10 }),
      ]),
    );

    const unmatchedEvent = {
      aggregateId: randomUUID(),
      aggregateType: 'Shipment',
      aggregateVersion: 1,
      eventId: randomUUID(),
      eventType: 'tms.charge-fact.v1',
      occurredAt: occurredAt.toISOString(),
      payload: {
        businessRef: 'SHIPMENT-P4-NO-RATE',
        chargeType: input.chargeType,
        currency: input.currency,
        dimensions: input.dimensions,
        occurredAt: input.occurredAt,
        organizationRef: input.organizationRef,
        partyRef: randomUUID(),
        quantityBase: input.quantityBase,
        quantityBaseUom: input.quantityBaseUom,
        quantityOriginal: input.quantityOriginal,
        quantityUom: input.quantityUom,
        routeRef: input.routeRef,
        serviceType: input.serviceType,
      },
      schemaVersion: 1,
      traceId: randomUUID(),
    };
    const unmatched = await service.consume(unmatchedEvent, context, command());
    expect(unmatched).toMatchObject({ duplicate: false, status: 'PROCESSED' });
    const unmatchedFact = await prisma.chargeFact.findFirstOrThrow({
      where: { businessRef: 'SHIPMENT-P4-NO-RATE', tenantId },
    });
    const unmatchedRate = await prisma.rateMatch.findFirstOrThrow({
      where: { chargeFactId: unmatchedFact.id, tenantId },
    });
    expect(unmatchedRate.status).toBe('UNMATCHED');
    const unmatchedException = await prisma.rateMatchException.findFirstOrThrow(
      {
        where: { rateMatchId: unmatchedRate.id, tenantId },
      },
    );
    expect(unmatchedException).toMatchObject({
      code: 'BILLING_RATE_NOT_FOUND',
      status: 'OPEN',
    });
    expect(
      await service.consume(unmatchedEvent, context, command()),
    ).toMatchObject({ duplicate: true, status: 'PROCESSED' });
    await expect(
      service.consume(
        {
          ...unmatchedEvent,
          payload: { ...unmatchedEvent.payload, quantityBase: '9999' },
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_REPLAY_CONFLICT', statusCode: 409 });
    expect(
      await prisma.eventInbox.count({
        where: { consumer: 'billing.charge-fact.v1', tenantId },
      }),
    ).toBe(1);
    await expect(
      prisma.chargeFact.update({
        data: { quantityBase: '1' },
        where: { id: received.chargeFactId },
      }),
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.factCorrection.delete({
        where: { id: correction.correctionId! },
      }),
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.rateMatch.update({
        data: { priority: 999 },
        where: { id: received.rateMatchId! },
      }),
    ).rejects.toThrow(/immutable/i);
    expect(
      await prisma.platformOutbox.count({
        where: { aggregateType: 'ChargeFact', tenantId },
      }),
    ).toBe(3);
  });
});
