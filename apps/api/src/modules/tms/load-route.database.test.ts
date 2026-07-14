import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { LoadRouteService } from './load-route.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('TMS load, route and optimization persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('revalidates manual loading and compares explainable locked-node routes', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'load-route-db-test',
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
    const batch = await prisma.planningBatch.create({
      data: {
        batchNo: `PB-${randomUUID()}`,
        createdBy: actorId,
        criteria: {},
        planningDate: new Date('2026-07-18'),
        plannedAt: new Date(),
        regionCode: 'EAST',
        status: 'PLANNED',
        tenantId,
        updatedBy: actorId,
      },
    });
    const consolidation = await prisma.consolidationPlan.create({
      data: {
        createdBy: actorId,
        planningBatchId: batch.id,
        planNo: `CP-${randomUUID()}`,
        policySnapshot: {},
        publishedAt: new Date(),
        status: 'PUBLISHED',
        tenantId,
        updatedBy: actorId,
        validatedAt: new Date(),
      },
    });
    const shipment = await prisma.shipment.create({
      data: {
        consolidationPlanId: consolidation.id,
        createdBy: actorId,
        deliveryWindowTo: new Date('2026-07-18T14:00:00Z'),
        destinationSnapshot: { code: 'D' },
        mode: 'ROAD_FTL',
        originSnapshot: { code: 'A' },
        pickupWindowFrom: new Date('2026-07-18T01:00:00Z'),
        requirementSnapshot: { valueUtilization: 60 },
        shipmentNo: `SHP-${randomUUID()}`,
        temperatureMax: 8,
        temperatureMin: 2,
        tenantId,
        totalPallets: 5,
        totalVolumeBase: 10,
        totalWeightBase: 1000,
        updatedBy: actorId,
      },
    });
    const order = await prisma.transportOrder.create({
      data: {
        chargeResponsibilitySnapshot: { payer: 'CUSTOMER' },
        createdBy: actorId,
        deliveryWindowFrom: new Date('2026-07-18T10:00:00Z'),
        deliveryWindowTo: new Date('2026-07-18T14:00:00Z'),
        destinationAddressSnapshot: { countryCode: 'CN', line1: 'D' },
        orderNo: `TO-${randomUUID()}`,
        originAddressSnapshot: { countryCode: 'CN', line1: 'A' },
        packagingSnapshot: { palletCount: 5 },
        pickupWindowFrom: new Date('2026-07-18T01:00:00Z'),
        pickupWindowTo: new Date('2026-07-18T03:00:00Z'),
        serviceLevel: 'NEXT_DAY',
        sourceRef: randomUUID(),
        sourceSnapshot: { lines: 1 },
        sourceType: 'TEST',
        status: 'PLANNED',
        tenantId,
        type: 'SALES',
        updatedBy: actorId,
        volume: 10,
        volumeBase: 10,
        volumeUom: 'M3',
        weight: 1000,
        weightBase: 1000,
        weightUom: 'KG',
      },
    });
    const item = await prisma.shipmentItem.create({
      data: {
        allocationRatio: 1,
        createdBy: actorId,
        itemSnapshot: { dangerousGoods: true, temperatureZone: 'COLD' },
        quantity: 10,
        quantityBase: 10,
        quantityBaseUom: 'EA',
        quantityUom: 'EA',
        shipmentId: shipment.id,
        sourceLineRef: 'L1',
        tenantId,
        transportOrderId: order.id,
        updatedBy: actorId,
        volumeBase: 10,
        weightBase: 1000,
      },
    });
    const leg = await prisma.transportLeg.create({
      data: {
        carrierSnapshot: { code: 'C1' },
        createdBy: actorId,
        destinationSnapshot: { code: 'D' },
        mode: 'ROAD_FTL',
        originNodeSnapshot: { code: 'A' },
        plannedEndAt: new Date('2026-07-18T10:00:00Z'),
        plannedStartAt: new Date('2026-07-18T01:00:00Z'),
        sequence: 1,
        shipmentId: shipment.id,
        slaSnapshot: { hours: 9 },
        tenantId,
        updatedBy: actorId,
      },
    });
    const equipment = await prisma.equipmentSelection.create({
      data: {
        capacityPallets: 10,
        capacityVolumeBase: 20,
        capacityWeightBase: 2000,
        compatible: true,
        createdBy: actorId,
        equipmentSnapshot: {
          dangerousGoodsCapable: true,
          temperatureControlled: true,
        },
        equipmentType: 'REEFER',
        exclusionReasons: [],
        requiredPallets: 5,
        requiredVolumeBase: 10,
        requiredWeightBase: 1000,
        requirementSnapshot: { cold: true },
        tenantId,
        transportLegId: leg.id,
        updatedBy: actorId,
      },
    });
    const service = new LoadRouteService(prisma as never);
    const load = await service.createLoadPlan(
      {
        equipmentSelectionId: equipment.id,
        layoutSnapshot: { decks: 1 },
        shipmentId: shipment.id,
      },
      context,
      command(),
    );
    expect(load).toMatchObject({
      compatible: true,
      status: 'DRAFT',
      version: 1,
    });
    const metric = await prisma.utilizationMetric.findFirstOrThrow({
      where: { loadPlanId: load.loadPlanId, tenantId },
    });
    expect(metric.weightUtilization.toString()).toBe('50');
    expect(metric.volumeUtilization.toString()).toBe('50');
    expect(metric.palletUtilization.toString()).toBe('50');
    await expect(
      service.adjustLoad(
        load.loadPlanId,
        {
          expectedVersion: load.version,
          position: { dangerousAllowed: false, temperatureZone: 'COLD' },
          shipmentItemId: item.id,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_LOAD_ADJUSTMENT_INCOMPATIBLE' });
    const adjusted = await service.adjustLoad(
      load.loadPlanId,
      {
        expectedVersion: load.version,
        position: {
          column: 2,
          dangerousAllowed: true,
          temperatureZone: 'COLD',
        },
        shipmentItemId: item.id,
      },
      context,
      command(),
    );
    expect(adjusted.version).toBe(2);
    expect(
      await prisma.loadAssignment.count({
        where: { loadPlanId: load.loadPlanId },
      }),
    ).toBe(2);
    const validated = await service.transitionLoad(
      load.loadPlanId,
      { expectedVersion: adjusted.version, targetStatus: 'VALIDATED' },
      context,
      command(),
    );
    const published = await service.transitionLoad(
      load.loadPlanId,
      { expectedVersion: validated.version, targetStatus: 'PUBLISHED' },
      context,
      command(),
    );
    expect(published).toMatchObject({ status: 'PUBLISHED', version: 4 });
    await expect(
      service.adjustLoad(
        load.loadPlanId,
        {
          expectedVersion: published.version,
          position: {},
          shipmentItemId: item.id,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_LOAD_PLAN_CONFLICT' });

    const routeInput = {
      constraintSnapshot: {
        costPerKm: 2,
        shiftEnd: '2026-07-18T16:00:00Z',
        shiftStart: '2026-07-18T01:00:00Z',
      },
      distanceMatrix: {
        'A|B': 40,
        'A|C': 45,
        'B|C': 30,
        'B|D': 45,
        'C|B': 30,
        'C|D': 40,
      },
      objectiveWeights: [
        { cost: 0.7, distance: 0.3, onTime: 1 },
        { cost: 0.2, distance: 0.8, onTime: 2 },
      ],
      speedKph: 60,
      stops: [
        {
          locationSnapshot: { code: 'A' },
          serviceMinutes: 15,
          stopRef: 'A',
          stopType: 'PICKUP',
          windowFrom: '2026-07-18T01:00:00Z',
          windowTo: '2026-07-18T03:00:00Z',
        },
        {
          locationSnapshot: { code: 'B' },
          serviceMinutes: 20,
          stopRef: 'B',
          stopType: 'DELIVERY',
          windowFrom: '2026-07-18T02:00:00Z',
          windowTo: '2026-07-18T08:00:00Z',
        },
        {
          locationSnapshot: { code: 'C' },
          serviceMinutes: 20,
          stopRef: 'C',
          stopType: 'DELIVERY',
          windowFrom: '2026-07-18T03:00:00Z',
          windowTo: '2026-07-18T10:00:00Z',
        },
        {
          locationSnapshot: { code: 'D' },
          serviceMinutes: 15,
          stopRef: 'D',
          stopType: 'DELIVERY',
          windowFrom: '2026-07-18T05:00:00Z',
          windowTo: '2026-07-18T14:00:00Z',
        },
      ],
    } as const;
    const optimized = await service.optimizeRoute(
      shipment.id,
      routeInput,
      context,
      command(),
    );
    expect(optimized).toMatchObject({ status: 'OPTIMIZED', version: 2 });
    expect(optimized.scenarioCount).toBeGreaterThanOrEqual(2);
    const scenarios = await prisma.optimizationScenario.findMany({
      orderBy: { score: 'desc' },
      where: { routePlanId: optimized.routePlanId, tenantId },
    });
    expect(scenarios[0]?.scoreBreakdown).toMatchObject({ vehicles: 1 });
    const selected = await service.selectScenario(
      optimized.routePlanId,
      scenarios[0]!.id,
      { expectedVersion: optimized.version },
      context,
      command(),
    );
    expect(selected).toMatchObject({ status: 'SELECTED', version: 3 });
    expect(
      await prisma.optimizationScenario.count({
        where: {
          routePlanId: optimized.routePlanId,
          status: 'SELECTED',
          tenantId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.optimizationScenario.count({
        where: {
          routePlanId: optimized.routePlanId,
          status: 'REJECTED',
          tenantId,
        },
      }),
    ).toBe(scenarios.length - 1);
    const routeStops = await prisma.routeStop.findMany({
      orderBy: { sequence: 'asc' },
      where: { routePlanId: optimized.routePlanId, tenantId },
    });
    expect(routeStops).toHaveLength(4);
    expect(
      routeStops.every(
        (stop, index) =>
          !index ||
          stop.plannedArrival >= routeStops[index - 1]!.plannedDeparture,
      ),
    ).toBe(true);
    const reoptimized = await service.optimizeRoute(
      shipment.id,
      {
        ...routeInput,
        lockedStopRefs: ['B'],
        objectiveWeights: [{ cost: 1, distance: 1 }],
        parentScenarioId: scenarios[0]!.id,
        stops: [
          routeInput.stops[0],
          routeInput.stops[2],
          routeInput.stops[1],
          routeInput.stops[3],
        ],
      },
      context,
      command(),
    );
    const lockedScenarios = await prisma.optimizationScenario.findMany({
      where: { routePlanId: reoptimized.routePlanId, tenantId },
    });
    expect(
      lockedScenarios.every(
        (candidate) =>
          (candidate.stopSequence as string[]).indexOf('B') ===
          (scenarios[0]!.stopSequence as string[]).indexOf('B'),
      ),
    ).toBe(true);
    await expect(
      prisma.utilizationMetric.update({
        data: { weightUtilization: 99 },
        where: { id: metric.id },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.routeStop.update({
        data: { sequence: 99 },
        where: { id: routeStops[0]!.id },
      }),
    ).rejects.toBeDefined();
  });
});
