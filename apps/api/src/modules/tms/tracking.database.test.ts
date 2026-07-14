import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { TrackingService } from './tracking.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('TMS driver tracking and ETA persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('orders offline nodes, preserves geofence conflicts and cleans positions', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'tracking-db-test',
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
    const now = Date.now();
    const batch = await prisma.planningBatch.create({
      data: {
        batchNo: `PB-${randomUUID()}`,
        createdBy: actorId,
        criteria: {},
        planningDate: new Date(now),
        plannedAt: new Date(),
        regionCode: 'EAST',
        status: 'PLANNED',
        tenantId,
        updatedBy: actorId,
      },
    });
    const plan = await prisma.consolidationPlan.create({
      data: {
        createdBy: actorId,
        planNo: `CP-${randomUUID()}`,
        planningBatchId: batch.id,
        policySnapshot: {},
        publishedAt: new Date(),
        status: 'APPROVED',
        tenantId,
        updatedBy: actorId,
        validatedAt: new Date(),
      },
    });
    const shipment = await prisma.shipment.create({
      data: {
        consolidationPlanId: plan.id,
        createdBy: actorId,
        deliveryWindowTo: new Date(now + 6 * 3_600_000),
        destinationSnapshot: {},
        mode: 'ROAD_FTL',
        originSnapshot: {},
        pickupWindowFrom: new Date(now - 3_600_000),
        requirementSnapshot: {},
        shipmentNo: `SHP-${randomUUID()}`,
        status: 'TRACKING',
        tenantId,
        totalPallets: 2,
        totalVolumeBase: 5,
        totalWeightBase: 500,
        updatedBy: actorId,
      },
    });
    const assignment = await prisma.vehicleAssignment.create({
      data: {
        assignedBy: actorId,
        assignmentNo: `VA-${randomUUID()}`,
        backupContactSnapshot: {},
        carrierTenderId: randomUUID(),
        createdBy: actorId,
        driverRef: randomUUID(),
        driverSnapshot: {},
        eligibilitySnapshot: {},
        requirementSnapshot: {},
        scheduleFrom: new Date(now - 2 * 3_600_000),
        scheduleTo: new Date(now + 8 * 3_600_000),
        shipmentId: shipment.id,
        status: 'DISPATCHED',
        tenantId,
        updatedBy: actorId,
        vehicleRef: randomUUID(),
        vehicleSnapshot: {},
      },
    });
    const service = new TrackingService(prisma as never);
    const milestonePlan = await service.createMilestonePlan(
      shipment.id,
      {
        milestones: [
          {
            code: 'PICKUP',
            locationSnapshot: {
              latitude: 31.2,
              longitude: 121.4,
              radiusMeters: 200,
            },
            mandatory: true,
            plannedAt: new Date(now + 3_600_000).toISOString(),
            requirementSnapshot: {},
            type: 'PICKUP',
          },
          {
            code: 'DEPARTURE',
            locationSnapshot: {
              latitude: 31.21,
              longitude: 121.41,
              radiusMeters: 200,
            },
            mandatory: true,
            plannedAt: new Date(now + 2 * 3_600_000).toISOString(),
            requirementSnapshot: {},
            type: 'DEPARTURE',
          },
          {
            code: 'DELIVERY',
            locationSnapshot: {
              latitude: 31.3,
              longitude: 121.5,
              radiusMeters: 200,
            },
            mandatory: true,
            plannedAt: new Date(now + 5 * 3_600_000).toISOString(),
            requirementSnapshot: {},
            type: 'DELIVERY',
          },
        ],
        templateSnapshot: { mode: 'ROAD_FTL' },
        timeZone: 'Asia/Shanghai',
      },
      context,
      command(),
    );
    const milestones = await prisma.shipmentMilestone.findMany({
      orderBy: { sequence: 'asc' },
      where: { milestonePlanId: milestonePlan.milestonePlanId },
    });
    const task = await service.createDriverTask(
      assignment.id,
      { deviceId: 'DEVICE-001', deviceSnapshot: { platform: 'IOS' } },
      context,
      command(),
    );
    const accepted = await service.acceptTask(
      task.driverTaskId,
      { deviceId: 'DEVICE-001', expectedVersion: task.version },
      context,
      command(),
    );
    const node = (
      sequence: number,
      milestoneId: string,
      occurredAt: number,
    ) => ({
      commandType: 'MILESTONE' as const,
      deviceSequence: sequence,
      payload: {
        evidenceSnapshot: { photo: true },
        locationSnapshot: { latitude: 31.2, longitude: 121.4 },
        milestoneId,
        occurredAt: new Date(occurredAt).toISOString(),
      },
    });
    await expect(
      service.syncOffline(
        task.driverTaskId,
        {
          commands: [node(2, milestones[1]!.id, now)],
          deviceId: 'DEVICE-001',
          expectedVersion: accepted.version,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_OFFLINE_SEQUENCE_GAP' });
    const first = await service.syncOffline(
      task.driverTaskId,
      {
        commands: [node(1, milestones[0]!.id, now - 2 * 60_000)],
        deviceId: 'DEVICE-001',
        expectedVersion: accepted.version,
      },
      context,
      command(),
    );
    expect(first).toMatchObject({
      status: 'IN_PROGRESS',
      syncedThrough: 1,
      version: 3,
    });
    const replay = await service.syncOffline(
      task.driverTaskId,
      {
        commands: [node(1, milestones[0]!.id, now - 2 * 60_000)],
        deviceId: 'DEVICE-001',
        expectedVersion: first.version,
      },
      context,
      command(),
    );
    expect(replay.syncedThrough).toBe(1);
    await expect(
      service.syncOffline(
        task.driverTaskId,
        {
          commands: [node(1, milestones[0]!.id, now - 60_000)],
          deviceId: 'DEVICE-001',
          expectedVersion: replay.version,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_OFFLINE_SEQUENCE_CONFLICT' });
    await expect(
      service.syncOffline(
        task.driverTaskId,
        {
          commands: [node(2, milestones[2]!.id, now)],
          deviceId: 'DEVICE-001',
          expectedVersion: replay.version,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_MILESTONE_ORDER_INVALID' });
    const second = await service.syncOffline(
      task.driverTaskId,
      {
        commands: [node(2, milestones[1]!.id, now - 30_000)],
        deviceId: 'DEVICE-001',
        expectedVersion: replay.version,
      },
      context,
      command(),
    );
    expect(second.syncedThrough).toBe(2);

    const outside = await service.ingestPosition(
      shipment.id,
      {
        accuracyMeters: '10',
        latitude: '31.1975',
        longitude: '121.4',
        rawSnapshot: { lat: 31.1975, lng: 121.4 },
        recordedAt: new Date(now - 20_000).toISOString(),
        source: 'GPS',
        sourceEventId: 'GPS-1',
        speedKph: '50',
        vehicleAssignmentId: assignment.id,
      },
      context,
      command(),
    );
    expect(outside.status).toBe('ACCEPTED');
    const insideInput = {
      accuracyMeters: '8',
      latitude: '31.3',
      longitude: '121.5',
      rawSnapshot: { lat: 31.3, lng: 121.5 },
      recordedAt: new Date(now).toISOString(),
      source: 'GPS' as const,
      sourceEventId: 'GPS-2',
      speedKph: '60',
      vehicleAssignmentId: assignment.id,
    };
    const inside = await service.ingestPosition(
      shipment.id,
      insideInput,
      context,
      command(),
    );
    expect(inside.status).toBe('REJECTED');
    const nearInput = {
      ...insideInput,
      latitude: '31.2001',
      longitude: '121.4001',
      rawSnapshot: { lat: 31.2001, lng: 121.4001 },
      recordedAt: new Date(now + 60_000).toISOString(),
      sourceEventId: 'GPS-3',
      speedKph: '40',
    };
    const near = await service.ingestPosition(
      shipment.id,
      nearInput,
      context,
      command(),
    );
    expect(near.status).toBe('ACCEPTED');
    expect(
      (
        await prisma.geofenceEvent.findFirstOrThrow({
          where: { positionPointId: near.positionPointId },
        })
      ).status,
    ).toBe('CONFLICT');
    expect(
      await prisma.trackSegment.count({ where: { shipmentId: shipment.id } }),
    ).toBe(1);
    const replayPosition = await service.ingestPosition(
      shipment.id,
      nearInput,
      context,
      command(),
    );
    expect(replayPosition.replayed).toBe(true);
    await expect(
      service.ingestPosition(
        shipment.id,
        { ...nearInput, rawSnapshot: { changed: true } },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_POSITION_REPLAY_CONFLICT' });

    const eta = await service.predictEta(
      shipment.id,
      {
        averageSpeedKph: '60',
        milestoneId: milestones[2]!.id,
        trafficFactor: '1.2',
      },
      context,
      command(),
    );
    expect(Number(eta.confidence)).toBeGreaterThanOrEqual(0.5);
    await expect(
      prisma.trackingEvent.update({
        data: { eventType: 'MUTATED' },
        where: {
          id: String((first.results[0] as { eventId: string }).eventId),
        },
      }),
    ).rejects.toBeDefined();
  });
});
