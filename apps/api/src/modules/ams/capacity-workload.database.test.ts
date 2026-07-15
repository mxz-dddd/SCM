import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { CapacityWorkloadService } from './capacity-workload.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('AMS capacity calendar and workload persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('publishes capacity, generates governed slots, serializes competing changes and preserves workload versions', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'ams-database-test',
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
    const calendarFacade = {
      evaluate: async () => ({
        calendarId: randomUUID(),
        calendarVersion: 3,
        cutoffTime: '18:00',
        date: '2035-01-02',
        exceptionReason: null,
        localTime: '08:00',
        timeZone: 'UTC',
        withinCutoff: true,
        working: true,
      }),
    };
    const service = new CapacityWorkloadService(
      prisma as never,
      calendarFacade as never,
    );
    const profile = await service.createProfile(
      {
        blacklistDates: ['2035-01-03'],
        calendarCode: 'CN-WORKDAY',
        capacity: {
          laborHours: '8',
          pallets: '20',
          quantity: '1000',
          quantityUom: 'EA',
          vehicles: '2',
        },
        effectiveFrom: '2035-01-01',
        effectiveUntil: '2035-01-31',
        internalReserve: {
          laborHours: '1',
          pallets: '2',
          quantity: '100',
          vehicles: '0',
        },
        leadTimeMinutes: 120,
        profileCode: `DOCK-${randomUUID().slice(0, 8)}`,
        resourceRef: randomUUID(),
        resourceSnapshot: { dockCode: 'D-01', warehouseCode: 'WH-01' },
        resourceType: 'DOCK',
        revision: 1,
        serviceType: 'INBOUND',
        shiftCode: 'DAY',
        shiftEndTime: '10:00',
        shiftStartTime: '08:00',
        slotMinutes: 60,
        warehouseRef: randomUUID(),
      },
      context,
      command(),
    );
    const published = await service.publishProfile(
      profile.capacityProfileId,
      { expectedVersion: profile.version },
      context,
      command(),
    );
    expect(published).toMatchObject({ status: 'PUBLISHED', version: 2 });
    const generation = await service.generateSlots(
      {
        dateFrom: '2035-01-02',
        dateTo: '2035-01-03',
        profileId: profile.capacityProfileId,
      },
      context,
      command(),
    );
    expect(generation.generatedCount).toBe(2);
    expect(generation.skipped).toContainEqual({
      date: '2035-01-03',
      reason: 'BLACKLISTED',
    });
    const slotId = generation.slotIds[0]!;
    const competing = await Promise.allSettled([
      service.changeSlot(
        slotId,
        { action: 'CLOSE', expectedVersion: 1, reason: '设备检修' },
        context,
        command(),
      ),
      service.changeSlot(
        slotId,
        { action: 'CLOSE', expectedVersion: 1, reason: '临时封控' },
        context,
        command(),
      ),
    ]);
    expect(competing.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const closed = await prisma.timeSlot.findUniqueOrThrow({ where: { id: slotId } });
    expect(closed).toMatchObject({ status: 'CLOSED', version: 2 });
    await service.changeSlot(
      slotId,
      { action: 'REOPEN', expectedVersion: 2, reason: '检修完成' },
      context,
      command(),
    );
    await service.changeSlot(
      slotId,
      {
        action: 'EXPAND',
        delta: {
          laborHours: '2',
          pallets: '5',
          quantity: '200',
          vehicles: '1',
        },
        expectedVersion: 3,
        reason: '加开临时作业线',
      },
      context,
      command(),
    );
    await service.changeSlot(
      slotId,
      {
        action: 'RESERVE_INTERNAL',
        delta: {
          laborHours: '1',
          pallets: '1',
          quantity: '50',
          vehicles: '0',
        },
        expectedVersion: 4,
        reason: '预留应急到货容量',
      },
      context,
      command(),
    );
    const changes = await prisma.capacityChange.findMany({
      orderBy: { sequence: 'asc' },
      where: { tenantId, timeSlotId: slotId },
    });
    expect(changes.map(({ changeType }) => changeType)).toEqual([
      'GENERATED',
      'CLOSED',
      'REOPENED',
      'EXPANDED',
      'RESERVED_INTERNAL',
    ]);
    await expect(
      prisma.capacityChange.delete({ where: { id: changes[0]!.id } }),
    ).rejects.toThrow(/immutable/i);

    const rule = await service.createWorkloadRule(
      {
        baseMinutes: '15',
        effectiveFrom: '2034-01-01T00:00:00.000Z',
        historicalEfficiency: '0.8',
        loadingMethodFactors: { DEFAULT: '1', MANUAL: '1.2' },
        packagingFactors: { CARTON: '1.1', DEFAULT: '1' },
        perOrderLineMinutes: '2',
        perPalletMinutes: '3',
        perQuantityMinutes: '0.1',
        perVehicleMinutes: '10',
        revision: 1,
        ruleCode: `WL-${randomUUID().slice(0, 8)}`,
        serviceType: 'INBOUND',
      },
      context,
      command(),
    );
    await service.publishWorkloadRule(
      rule.workloadRuleId,
      { expectedVersion: rule.version },
      context,
      command(),
    );
    const estimate = await service.estimate(
      {
        asOf: '2035-01-02T08:00:00.000Z',
        loadingMethod: 'MANUAL',
        orderLineCount: 5,
        packagingType: 'CARTON',
        pallets: '10',
        quantity: '100',
        quantityUom: 'EA',
        ruleCode: (
          await prisma.workloadRule.findUniqueOrThrow({
            where: { id: rule.workloadRuleId },
          })
        ).ruleCode,
        sourceRef: 'ORDER-AMS-001',
        vehicles: '1',
      },
      context,
      command(),
    );
    const adjusted = await service.adjustEstimate(
      estimate.workloadEstimateId,
      {
        laborHours: '3.5',
        pallets: '10',
        quantity: '100',
        quantityUom: 'EA',
        reason: '历史效率样本不足，现场主管修正',
        vehicles: '1',
      },
      context,
      command(),
    );
    expect(adjusted).toMatchObject({
      originalEstimateId: estimate.workloadEstimateId,
      status: 'ADJUSTED',
    });
    expect(
      await prisma.workloadEstimate.count({
        where: { sourceRef: 'ORDER-AMS-001', tenantId },
      }),
    ).toBe(2);
    await expect(
      prisma.workloadRule.update({
        data: { baseMinutes: 20 },
        where: { id: rule.workloadRuleId },
      }),
    ).rejects.toThrow(/immutable/i);
  });
});
