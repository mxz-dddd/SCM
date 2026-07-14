import { randomUUID } from 'node:crypto';
import { PrismaClient, type ShipmentStatus } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { CapacityTenderService } from './capacity-tender.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('TMS capacity, approval and tender persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('reserves atomically and preserves approval, tender, award and subcontract facts', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'capacity-tender-db-test',
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
    const service = new CapacityTenderService(prisma as never);
    const future = (hours = 24) =>
      new Date(Date.now() + hours * 3_600_000).toISOString();
    const batch = await prisma.planningBatch.create({
      data: {
        batchNo: `PB-${randomUUID()}`,
        createdBy: actorId,
        criteria: {},
        planningDate: new Date(future(48).slice(0, 10)),
        plannedAt: new Date(),
        regionCode: 'EAST',
        status: 'PLANNED',
        tenantId,
        updatedBy: actorId,
      },
    });
    const createPlan = (status: 'PUBLISHED' | 'APPROVED') =>
      prisma.consolidationPlan.create({
        data: {
          createdBy: actorId,
          planNo: `CP-${randomUUID()}`,
          planningBatchId: batch.id,
          policySnapshot: { maxVariance: 20 },
          publishedAt: new Date(),
          status,
          tenantId,
          updatedBy: actorId,
          validatedAt: new Date(),
        },
      });
    const createShipment = (
      consolidationPlanId: string,
      status: ShipmentStatus,
      weight = '60',
      volume = '6',
    ) =>
      prisma.shipment.create({
        data: {
          consolidationPlanId,
          createdBy: actorId,
          deliveryWindowTo: new Date(future(48)),
          destinationSnapshot: { code: 'SHA' },
          mode: 'ROAD_FTL',
          originSnapshot: { code: 'SUZ' },
          pickupWindowFrom: new Date(future(24)),
          requirementSnapshot: { serviceLevel: 'NEXT_DAY' },
          shipmentNo: `SHP-${randomUUID()}`,
          status,
          tenantId,
          totalPallets: 2,
          totalVolumeBase: volume,
          totalWeightBase: weight,
          updatedBy: actorId,
        },
      });
    const createPool = async (
      carrierRef: string,
      totalWeightBase = '100',
      totalVolumeBase = '20',
    ) => {
      const result = await service.createCapacityPool(
        {
          calendarSnapshot: { available: true },
          carrierRef,
          carrierSnapshot: { carrierRef, name: carrierRef },
          qualificationSnapshot: { qualified: true },
          regionCode: 'EAST',
          serviceDate: future(24).slice(0, 10),
          sourceType: 'CONTRACT',
          totalPallets: '10',
          totalVolumeBase,
          totalWeightBase,
          vehicleType: 'BOX_TRUCK',
        },
        context,
        command(),
      );
      return result;
    };

    const plan = await createPlan('PUBLISHED');
    const shipment = await createShipment(plan.id, 'PLANNED');
    const pool = await createPool('CARRIER-A');
    const approval = await service.approvePlan(
      plan.id,
      {
        costAmount: '1200',
        currency: 'CNY',
        decision: 'APPROVE',
        expectedVersion: plan.version,
        qualificationSnapshot: { qualified: true },
        reason: 'Cost and qualification approved',
        reservations: [
          {
            capacityPoolId: pool.capacityPoolId,
            expectedPoolVersion: pool.version,
            expiresAt: future(48),
            shipmentId: shipment.id,
          },
        ],
        riskSnapshot: { overloaded: false },
        variancePercentage: '5',
      },
      context,
      command(),
    );
    expect(approval).toMatchObject({ status: 'APPROVED', version: 2 });
    expect(
      await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } }),
    ).toMatchObject({ status: 'APPROVED', version: 2 });
    const approvalFact = await prisma.transportPlanApproval.findUniqueOrThrow({
      where: { id: approval.approvalId },
    });
    await expect(
      prisma.transportPlanApproval.update({
        data: { reason: 'attempted mutation' },
        where: { id: approvalFact.id },
      }),
    ).rejects.toBeDefined();

    const blockedPlan = await createPlan('PUBLISHED');
    const blockedShipment = await createShipment(blockedPlan.id, 'PLANNED');
    await expect(
      service.approvePlan(
        blockedPlan.id,
        {
          costAmount: '1500',
          currency: 'CNY',
          decision: 'APPROVE',
          expectedVersion: blockedPlan.version,
          qualificationSnapshot: { qualified: true },
          reason: 'Overload must block',
          reservations: [],
          riskSnapshot: { overloaded: true },
          variancePercentage: '30',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_PLAN_APPROVAL_RISK_BLOCKED' });
    const rejected = await service.approvePlan(
      blockedPlan.id,
      {
        costAmount: '1500',
        currency: 'CNY',
        decision: 'REJECT',
        expectedVersion: blockedPlan.version,
        qualificationSnapshot: { qualified: true },
        reason: 'Variance exceeds budget',
        riskSnapshot: { overloaded: false },
        variancePercentage: '30',
      },
      context,
      command(),
    );
    expect(rejected.status).toBe('REJECTED');
    expect(
      await prisma.shipment.findUniqueOrThrow({
        where: { id: blockedShipment.id },
      }),
    ).toMatchObject({ status: 'REJECTED' });

    const reservation = await prisma.capacityReservation.findFirstOrThrow({
      where: { shipmentId: shipment.id, status: 'ACTIVE', tenantId },
    });
    const tender = await service.createTender(
      shipment.id,
      reservation.id,
      {
        carrierSnapshot: { carrierRef: 'CARRIER-A' },
        currency: 'CNY',
        expiresAt: future(),
        priceAmount: '1200',
        requirementSnapshot: { serviceLevel: 'NEXT_DAY' },
      },
      context,
      command(),
    );
    await expect(
      service.releaseCapacity(
        reservation.id,
        { expectedVersion: reservation.version, reason: 'Bypass revoke' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_TENDER_REVOKE_REQUIRED' });
    const questioned = await service.respondTender(
      tender.carrierTenderId,
      {
        decision: 'QUESTION',
        expectedVersion: tender.version,
        reason: 'Confirm loading time',
      },
      context,
      command(),
    );
    const accepted = await service.respondTender(
      tender.carrierTenderId,
      {
        decision: 'ACCEPT',
        expectedVersion: questioned.version,
        reason: 'Loading time confirmed',
      },
      context,
      command(),
    );
    expect(accepted).toMatchObject({
      shipmentStatus: 'ACCEPTED',
      status: 'ACCEPTED',
    });
    await expect(
      service.respondTender(
        tender.carrierTenderId,
        {
          decision: 'REJECT',
          expectedVersion: accepted.version,
          reason: 'Duplicate response',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_TENDER_CONFLICT' });

    const subcontract = await service.createSubcontract(
      shipment.id,
      {
        actualCarrierRef: 'CARRIER-DOWNSTREAM',
        complianceSnapshot: { qualified: true },
        downstreamCarrierRef: 'CARRIER-DOWNSTREAM',
        feeLayerSnapshot: { currency: 'CNY', upstream: 1200, downstream: 980 },
        parentTenderId: tender.carrierTenderId,
        responsibilityChain: [
          { carrierRef: 'CARRIER-A', role: 'CONTRACTUAL' },
          { carrierRef: 'CARRIER-DOWNSTREAM', role: 'ACTUAL' },
        ],
        upstreamCarrierRef: 'CARRIER-A',
        visibilityScope: { customerVisible: true },
      },
      context,
      command(),
    );
    const subcontractAccepted = await service.respondSubcontract(
      subcontract.subcontractAssignmentId,
      {
        decision: 'ACCEPT',
        expectedVersion: subcontract.version,
        reason: 'Downstream carrier confirmed',
      },
      context,
      command(),
    );
    expect(subcontractAccepted.status).toBe('ACCEPTED');

    const revoked = await service.revokeTender(
      tender.carrierTenderId,
      { expectedVersion: accepted.version, reason: 'Carrier reassignment' },
      context,
      command(),
    );
    expect(revoked).toMatchObject({
      shipmentStatus: 'APPROVED',
      status: 'REVOKED',
    });
    const retenderCase = await prisma.retenderCase.findFirstOrThrow({
      where: {
        originalTenderId: tender.carrierTenderId,
        status: 'OPEN',
        tenantId,
      },
    });
    const replacementPool = await createPool('CARRIER-B');
    const replacement = await service.retender(
      retenderCase.id,
      {
        capacityPoolId: replacementPool.capacityPoolId,
        carrierSnapshot: { carrierRef: 'CARRIER-B' },
        currency: 'CNY',
        expectedPoolVersion: replacementPool.version,
        expiresAt: future(),
        priceAmount: '1600',
        requirementSnapshot: { serviceLevel: 'NEXT_DAY' },
        shipmentId: shipment.id,
      },
      context,
      command(),
    );
    expect(replacement.status).toBe('RESOLVED');
    expect(
      await prisma.retenderCase.findUniqueOrThrow({
        where: { id: retenderCase.id },
      }),
    ).toMatchObject({
      escalationRequired: true,
      replacementTenderId: replacement.carrierTenderId,
      status: 'RESOLVED',
    });

    const directPlan = await createPlan('APPROVED');
    const quoteShipment = await createShipment(directPlan.id, 'APPROVED');
    const quote = await service.createQuoteRequest(
      quoteShipment.id,
      {
        candidateCarriers: ['CARRIER-C', 'CARRIER-D'],
        deadlineAt: future(),
        requestType: 'BID',
        requirementSnapshot: { serviceLevel: 'NEXT_DAY' },
      },
      context,
      command(),
    );
    await expect(
      service.submitBid(
        quote.quoteRequestId,
        {
          carrierRef: 'NOT-INVITED',
          carrierSnapshot: {},
          conditions: {},
          currency: 'CNY',
          priceAmount: '100',
          promisedAt: future(30),
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_BID_CARRIER_NOT_INVITED' });
    await service.submitBid(
      quote.quoteRequestId,
      {
        carrierRef: 'CARRIER-C',
        carrierSnapshot: { carrierRef: 'CARRIER-C' },
        conditions: { fuelIncluded: true },
        currency: 'CNY',
        priceAmount: '900',
        promisedAt: future(28),
      },
      context,
      command(),
    );
    const bestBid = await service.submitBid(
      quote.quoteRequestId,
      {
        carrierRef: 'CARRIER-D',
        carrierSnapshot: { carrierRef: 'CARRIER-D' },
        conditions: { fuelIncluded: true },
        currency: 'CNY',
        priceAmount: '700',
        promisedAt: future(26),
      },
      context,
      command(),
    );
    const award = await service.recommendAward(
      quote.quoteRequestId,
      { expectedVersion: quote.version, priceWeight: 70, serviceWeight: 30 },
      context,
      command(),
    );
    expect(award.carrierBidId).toBe(bestBid.carrierBidId);
    const awardPool = await createPool('CARRIER-D');
    const awarded = await service.decideAward(
      award.awardDecisionId,
      {
        capacityPoolId: awardPool.capacityPoolId,
        decision: 'APPROVE',
        expectedPoolVersion: awardPool.version,
        expectedVersion: award.version,
        expiresAt: future(),
        reason: 'Best total score',
      },
      context,
      command(),
    );
    expect(awarded).toMatchObject({ status: 'APPROVED' });
    expect(
      await prisma.shipment.findUniqueOrThrow({
        where: { id: quoteShipment.id },
      }),
    ).toMatchObject({ status: 'TENDERED' });

    const expiryShipment = await createShipment(directPlan.id, 'APPROVED');
    const expiryPool = await createPool('CARRIER-E');
    const expiryReservation = await service.reserveCapacity(
      {
        capacityPoolId: expiryPool.capacityPoolId,
        expectedPoolVersion: expiryPool.version,
        expiresAt: future(48),
        shipmentId: expiryShipment.id,
      },
      context,
      command(),
    );
    const expiringTender = await service.createTender(
      expiryShipment.id,
      expiryReservation.capacityReservationId,
      {
        carrierSnapshot: { carrierRef: 'CARRIER-E' },
        currency: 'CNY',
        expiresAt: future(),
        priceAmount: '800',
        requirementSnapshot: {},
      },
      context,
      command(),
    );
    await prisma.carrierTender.update({
      data: {
        expiresAt: new Date(Date.now() - 3_600_000),
        sentAt: new Date(Date.now() - 7_200_000),
      },
      where: { id: expiringTender.carrierTenderId },
    });
    const expired = await service.expireTenders(context, command());
    expect(expired.expiredCount).toBe(1);
    expect(
      await prisma.capacityReservation.findUniqueOrThrow({
        where: { id: expiryReservation.capacityReservationId },
      }),
    ).toMatchObject({ status: 'RELEASED' });

    const idleShipment = await createShipment(directPlan.id, 'APPROVED');
    const idlePool = await createPool('CARRIER-IDLE');
    const idleReservation = await service.reserveCapacity(
      {
        capacityPoolId: idlePool.capacityPoolId,
        expectedPoolVersion: idlePool.version,
        expiresAt: future(),
        shipmentId: idleShipment.id,
      },
      context,
      command(),
    );
    await prisma.capacityReservation.update({
      data: {
        createdAt: new Date(Date.now() - 7_200_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      },
      where: { id: idleReservation.capacityReservationId },
    });
    const expiredReservations = await service.expireReservations(
      context,
      command(),
    );
    expect(expiredReservations.expiredCount).toBe(1);
    expect(
      await prisma.capacityReservation.findUniqueOrThrow({
        where: { id: idleReservation.capacityReservationId },
      }),
    ).toMatchObject({ status: 'EXPIRED' });

    const concurrentShipment1 = await createShipment(directPlan.id, 'APPROVED');
    const concurrentShipment2 = await createShipment(directPlan.id, 'APPROVED');
    const constrainedPool = await createPool('CARRIER-F', '100', '10');
    const concurrent = await Promise.allSettled([
      service.reserveCapacity(
        {
          capacityPoolId: constrainedPool.capacityPoolId,
          expectedPoolVersion: constrainedPool.version,
          expiresAt: future(),
          shipmentId: concurrentShipment1.id,
        },
        context,
        command(),
      ),
      service.reserveCapacity(
        {
          capacityPoolId: constrainedPool.capacityPoolId,
          expectedPoolVersion: constrainedPool.version,
          expiresAt: future(),
          shipmentId: concurrentShipment2.id,
        },
        context,
        command(),
      ),
    ]);
    expect(
      concurrent.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      concurrent.filter(({ status }) => status === 'rejected'),
    ).toHaveLength(1);
    const constrained = await prisma.capacityPool.findUniqueOrThrow({
      where: { id: constrainedPool.capacityPoolId },
    });
    expect(constrained.reservedWeightBase.toString()).toBe('60');
    expect(constrained.reservedVolumeBase.toString()).toBe('6');

    expect(
      await prisma.platformOutbox.count({
        where: { aggregateType: 'TransportCapacityTender', tenantId },
      }),
    ).toBeGreaterThan(15);
  });
});
