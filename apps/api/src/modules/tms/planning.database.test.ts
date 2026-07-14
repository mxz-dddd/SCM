import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { type BuildPlanInput, PlanningService } from './planning.service';
import { TransportOrderService } from './transport-order.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('TMS planning persistence and concurrency', () => {
  afterAll(() => prisma.$disconnect());

  it('locks the pool atomically, conserves split mappings and rejects incompatible equipment', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'tms-planning-db-test',
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
    const transport = new TransportOrderService(prisma as never);
    const planning = new PlanningService(prisma as never);
    const receive = async (suffix: string, weight: string, volume: string) => {
      const created = await transport.receive(
        {
          chargeResponsibilitySnapshot: { payerRef: `C-${suffix}` },
          deliveryWindowFrom: '2026-07-17T08:00:00.000Z',
          deliveryWindowTo: '2026-07-17T12:00:00.000Z',
          destinationAddressSnapshot: {
            countryCode: 'CN',
            line1: '上海交付站',
          },
          originAddressSnapshot: { countryCode: 'CN', line1: '苏州提货站' },
          packagingSnapshot: { packageSpecVersion: 'V1', palletCount: 2 },
          pickupWindowFrom: '2026-07-17T01:00:00.000Z',
          pickupWindowTo: '2026-07-17T03:00:00.000Z',
          serviceLevel: 'NEXT_DAY',
          sourceRef: `PLAN-${suffix}`,
          sourceSnapshot: { lines: [{ lineRef: 'L1', quantityBase: '10' }] },
          sourceType: 'OMS_SALES_ORDER',
          temperatureMax: '8',
          temperatureMin: '2',
          temperatureUom: 'C',
          type: 'SALES',
          vehicleRequirementSnapshot: { refrigerated: true },
          volume,
          volumeBase: volume,
          volumeUom: 'M3',
          weight,
          weightBase: weight,
          weightUom: 'KG',
        },
        context,
        command(),
      );
      const reviewed = await transport.review(
        created.transportOrderId,
        {
          addressConfirmed: true,
          carrierQualified: true,
          chargeResponsibilityConfirmed: true,
          decision: 'APPROVE',
          expectedVersion: created.version,
          prohibitedGoodsDetected: false,
          reason: '计划测试审核通过',
          timeWindowFeasible: true,
          vehicleCompatible: true,
        },
        context,
        command(),
      );
      return { id: created.transportOrderId, version: reviewed.version };
    };
    const expiresAt = () => new Date(Date.now() + 3_600_000).toISOString();
    const createBatch = () =>
      planning.createBatch(
        {
          criteria: { serviceLevel: 'NEXT_DAY' },
          planningDate: '2026-07-17',
          priorityFrom: 1,
          priorityTo: 999,
          regionCode: 'EAST',
        },
        context,
        command(),
      );

    const order1 = await receive('ORDER-1', '1200', '2.5');
    const order2 = await receive('ORDER-2', '800', '1.5');
    const batch = await createBatch();
    const firstLock = await planning.claimOrder(
      batch.planningBatchId,
      order1.id,
      { expectedBatchVersion: batch.version, expiresAt: expiresAt() },
      context,
      command(),
    );
    expect(firstLock).toMatchObject({
      batchStatus: 'PLANNING',
      batchVersion: 2,
      status: 'ACTIVE',
    });
    const secondLock = await planning.claimOrder(
      batch.planningBatchId,
      order2.id,
      { expectedBatchVersion: firstLock.batchVersion, expiresAt: expiresAt() },
      context,
      command(),
    );
    expect(secondLock.status).toBe('ACTIVE');

    const baseShipment = (
      items: BuildPlanInput['shipments'][number]['items'],
      weight: string,
      volume: string,
    ): BuildPlanInput['shipments'][number] => ({
      deliveryWindowTo: '2026-07-17T12:00:00.000Z',
      destinationSnapshot: { code: 'SHA', countryCode: 'CN' },
      items,
      legs: [
        {
          carrierRef: 'CARRIER-ROAD',
          carrierSnapshot: { code: 'ROAD-01' },
          destinationSnapshot: { code: 'HUB-1' },
          equipment: {
            capacityPallets: '10',
            capacityVolumeBase: '20',
            capacityWeightBase: '5000',
            equipmentSnapshot: {
              dangerousGoodsCapable: true,
              loadingMethods: ['REAR'],
              temperatureControlled: true,
            },
            equipmentType: 'REFRIGERATED_TRUCK',
          },
          mode: 'ROAD_FTL',
          originNodeSnapshot: { code: 'SUZ' },
          plannedEndAt: '2026-07-17T04:00:00.000Z',
          plannedStartAt: '2026-07-17T01:00:00.000Z',
          sequence: 1,
          slaSnapshot: { transitHours: 3 },
        },
        {
          carrierRef: 'CARRIER-RAIL',
          carrierSnapshot: { code: 'RAIL-01' },
          destinationSnapshot: { code: 'SHA' },
          equipment: {
            capacityPallets: '10',
            capacityVolumeBase: '20',
            capacityWeightBase: '5000',
            equipmentSnapshot: {
              dangerousGoodsCapable: true,
              loadingMethods: ['REAR'],
              temperatureControlled: true,
            },
            equipmentType: 'REEFER_CONTAINER',
          },
          mode: 'RAIL',
          originNodeSnapshot: { code: 'HUB-1' },
          plannedEndAt: '2026-07-17T09:00:00.000Z',
          plannedStartAt: '2026-07-17T04:00:00.000Z',
          sequence: 2,
          slaSnapshot: { transitHours: 5 },
        },
      ],
      mode: 'MULTIMODAL',
      modeDecision: {
        candidates: [
          { mode: 'ROAD_FTL', score: 72 },
          { mode: 'MULTIMODAL', score: 91 },
        ],
        explanation: { selectedBecause: 'COST_AND_SLA' },
        ruleVersion: 'MODE-V1',
      },
      originSnapshot: { code: 'SUZ', countryCode: 'CN' },
      pickupWindowFrom: '2026-07-17T01:00:00.000Z',
      requirementSnapshot: { loadingMethod: 'REAR', refrigerated: true },
      temperatureMax: '8',
      temperatureMin: '2',
      totalPallets: '2',
      totalVolumeBase: volume,
      totalWeightBase: weight,
    });
    const item = (
      orderId: string,
      ratio: string,
      weight: string,
      volume: string,
      line: string,
    ) => ({
      allocationRatio: ratio,
      itemSnapshot: { packageSpecVersion: 'V1' },
      quantity: ratio === '1' ? '10' : '5',
      quantityBase: ratio === '1' ? '10' : '5',
      quantityBaseUom: 'EA',
      quantityUom: 'EA',
      sourceLineRef: line,
      transportOrderId: orderId,
      volumeBase: volume,
      weightBase: weight,
    });
    const first = baseShipment(
      [
        item(order1.id, '0.5', '600', '1.25', 'L1-A'),
        item(order2.id, '1', '800', '1.5', 'L1'),
      ],
      '1400',
      '2.75',
    );
    const second = {
      ...baseShipment(
        [item(order1.id, '0.5', '600', '1.25', 'L1-B')],
        '600',
        '1.25',
      ),
      legs: [
        {
          ...baseShipment([], '600', '1.25').legs[0]!,
          carrierRef: 'CARRIER-EXPRESS',
          mode: 'EXPRESS' as const,
        },
      ],
      mode: 'EXPRESS' as const,
      modeDecision: {
        candidates: [{ mode: 'EXPRESS', score: 88 }],
        explanation: { selectedBecause: 'SPLIT_URGENT_LINE' },
        ruleVersion: 'MODE-V1',
      },
    };
    const built = await planning.buildPlan(
      batch.planningBatchId,
      {
        expectedBatchVersion: secondLock.batchVersion,
        policySnapshot: { allowSplit: true, ruleVersion: 'CONSOLIDATE-V1' },
        shipments: [first, second],
      },
      context,
      command(),
    );
    expect(built.shipmentIds).toHaveLength(2);
    expect(await prisma.shipmentItem.count({ where: { tenantId } })).toBe(3);
    expect(await prisma.transportLeg.count({ where: { tenantId } })).toBe(3);
    const validated = await planning.validatePlan(
      built.consolidationPlanId,
      { expectedVersion: built.version },
      context,
      command(),
    );
    expect(validated.status).toBe('VALIDATED');
    const published = await planning.publishPlan(
      built.consolidationPlanId,
      {
        expectedBatchVersion: secondLock.batchVersion,
        expectedVersion: validated.version,
      },
      context,
      command(),
    );
    expect(published).toMatchObject({
      batchStatus: 'PLANNED',
      status: 'PUBLISHED',
    });
    await expect(
      planning.publishPlan(
        built.consolidationPlanId,
        {
          expectedBatchVersion: published.batchVersion,
          expectedVersion: published.version,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_CONSOLIDATION_PLAN_CONFLICT' });

    const warmup = await receive('WARMUP', '100', '0.5');
    const contested = await receive('CONTESTED', '100', '0.5');
    const concurrentBatch = await createBatch();
    const warmupLock = await planning.claimOrder(
      concurrentBatch.planningBatchId,
      warmup.id,
      { expectedBatchVersion: concurrentBatch.version, expiresAt: expiresAt() },
      context,
      command(),
    );
    const released = await planning.releaseLock(
      warmupLock.planningLockId,
      { expectedVersion: 1, reason: '并发测试预热释放' },
      context,
      command(),
    );
    expect(released.status).toBe('RELEASED');
    const attempts = await Promise.allSettled([
      planning.claimOrder(
        concurrentBatch.planningBatchId,
        contested.id,
        {
          expectedBatchVersion: warmupLock.batchVersion,
          expiresAt: expiresAt(),
        },
        context,
        command(),
      ),
      planning.claimOrder(
        concurrentBatch.planningBatchId,
        contested.id,
        {
          expectedBatchVersion: warmupLock.batchVersion,
          expiresAt: expiresAt(),
        },
        context,
        command(),
      ),
    ]);
    expect(
      attempts.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(
      await prisma.planningLock.count({
        where: { status: 'ACTIVE', tenantId, transportOrderId: contested.id },
      }),
    ).toBe(1);

    const overloadOrder = await receive('OVERLOAD', '1000', '5');
    const overloadBatch = await createBatch();
    const overloadLock = await planning.claimOrder(
      overloadBatch.planningBatchId,
      overloadOrder.id,
      { expectedBatchVersion: overloadBatch.version, expiresAt: expiresAt() },
      context,
      command(),
    );
    const overloadShipment = baseShipment(
      [item(overloadOrder.id, '1', '1000', '5', 'L1')],
      '1000',
      '5',
    );
    const overloadedLeg = {
      ...overloadShipment.legs[0]!,
      equipment: {
        ...overloadShipment.legs[0]!.equipment,
        capacityWeightBase: '500',
      },
    };
    const overloadPlan = await planning.buildPlan(
      overloadBatch.planningBatchId,
      {
        expectedBatchVersion: overloadLock.batchVersion,
        policySnapshot: { ruleVersion: 'OVERLOAD-V1' },
        shipments: [{ ...overloadShipment, legs: [overloadedLeg] }],
      },
      context,
      command(),
    );
    await expect(
      planning.validatePlan(
        overloadPlan.consolidationPlanId,
        { expectedVersion: overloadPlan.version },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_EQUIPMENT_INCOMPATIBLE' });
    const selection = await prisma.equipmentSelection.findFirstOrThrow({
      where: { compatible: false, tenantId },
    });
    expect(selection.exclusionReasons).toContain('WEIGHT_OVERLOAD');
    const decision = await prisma.modeDecision.findFirstOrThrow({
      where: { tenantId },
    });
    await expect(
      prisma.modeDecision.update({
        data: { ruleVersion: 'MUTATED' },
        where: { id: decision.id },
      }),
    ).rejects.toBeDefined();
  });
});
