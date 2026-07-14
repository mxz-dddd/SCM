import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { InTransitOperationsService } from './in-transit-operations.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('TMS in-transit operations persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('masks maps, deduplicates detection, escalates and coordinates appointment events', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'in-transit-db-test',
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
        deliveryWindowTo: new Date(now + 8 * 3_600_000),
        destinationSnapshot: {},
        mode: 'ROAD_FTL',
        originSnapshot: {},
        pickupWindowFrom: new Date(now - 3_600_000),
        requirementSnapshot: {},
        shipmentNo: `SHP-${randomUUID()}`,
        status: 'TRACKING',
        temperatureMax: 8,
        temperatureMin: 2,
        tenantId,
        totalPallets: 2,
        totalVolumeBase: 5,
        totalWeightBase: 500,
        updatedBy: actorId,
      },
    });
    await prisma.vehicleAssignment.create({
      data: {
        assignedBy: actorId,
        assignmentNo: `VA-${randomUUID()}`,
        backupContactSnapshot: {},
        carrierTenderId: randomUUID(),
        createdBy: actorId,
        driverRef: randomUUID(),
        driverSnapshot: { licenseNo: 'SECRET-LICENSE', name: '敏感司机姓名' },
        eligibilitySnapshot: {},
        requirementSnapshot: {},
        scheduleFrom: new Date(now - 2 * 3_600_000),
        scheduleTo: new Date(now + 8 * 3_600_000),
        shipmentId: shipment.id,
        status: 'DISPATCHED',
        tenantId,
        updatedBy: actorId,
        vehicleRef: randomUUID(),
        vehicleSnapshot: { plateNumber: '沪A12345' },
      },
    });
    const route = await prisma.routePlan.create({
      data: {
        constraintSnapshot: {},
        createdBy: actorId,
        inputSnapshot: {},
        optimizedAt: new Date(),
        routePlanNo: `RP-${randomUUID()}`,
        shipmentId: shipment.id,
        status: 'OPTIMIZED',
        tenantId,
        updatedBy: actorId,
      },
    });
    for (const [index, latitude] of [31.2, 31.25, 31.3].entries())
      await prisma.routeStop.create({
        data: {
          createdBy: actorId,
          locationSnapshot: { latitude, longitude: 121.4 + index * 0.05 },
          plannedArrival: new Date(now + (index + 1) * 3_600_000),
          plannedDeparture: new Date(now + (index + 1) * 3_600_000 + 600_000),
          routePlanId: route.id,
          sequence: index + 1,
          serviceMinutes: 10,
          stopRef: `STOP-${index + 1}`,
          stopType: index === 2 ? 'DELIVERY' : 'PICKUP',
          tenantId,
          updatedBy: actorId,
          windowFrom: new Date(now + index * 3_600_000),
          windowTo: new Date(now + (index + 2) * 3_600_000),
        },
      });
    const milestonePlan = await prisma.milestonePlan.create({
      data: {
        createdBy: actorId,
        planNo: `MP-${randomUUID()}`,
        shipmentId: shipment.id,
        templateSnapshot: {},
        tenantId,
        timeZone: 'Asia/Shanghai',
        updatedBy: actorId,
      },
    });
    const milestones = [];
    for (const [index, code] of ['PICKUP', 'ARRIVAL', 'DELIVERY'].entries())
      milestones.push(
        await prisma.shipmentMilestone.create({
          data: {
            code,
            createdBy: actorId,
            locationSnapshot: {
              latitude: 31.2 + index * 0.05,
              longitude: 121.4 + index * 0.05,
            },
            mandatory: true,
            milestonePlanId: milestonePlan.id,
            plannedAt: new Date(now + (index + 1) * 3_600_000),
            requirementSnapshot: {},
            sequence: index + 1,
            shipmentId: shipment.id,
            tenantId,
            type: code,
            updatedBy: actorId,
          },
        }),
      );
    await prisma.positionPoint.create({
      data: {
        accuracyMeters: 8,
        createdBy: actorId,
        latitude: '31.2345678',
        longitude: '121.4567890',
        rawSnapshot: {},
        recordedAt: new Date(now),
        shipmentId: shipment.id,
        source: 'GPS',
        sourceEventId: randomUUID(),
        status: 'ACCEPTED',
        tenantId,
        updatedBy: actorId,
        vehicleAssignmentId: (
          await prisma.vehicleAssignment.findFirstOrThrow({
            where: { shipmentId: shipment.id },
          })
        ).id,
      },
    });
    const service = new InTransitOperationsService(prisma as never);
    const map = await service.refreshMap(shipment.id, context, command());
    expect(map.positionSnapshot).toMatchObject({
      latitude: 31.23,
      longitude: 121.46,
      precision: 'COARSE',
    });
    expect(map).not.toHaveProperty('driverRestrictedSnapshot');
    const precise = await service.preciseMap(shipment.id, context);
    expect(precise.positionSnapshot).toMatchObject({
      latitude: 31.2345678,
      longitude: 121.456789,
      precision: 'EXACT',
    });
    expect(JSON.stringify(precise)).not.toContain('敏感司机姓名');

    const detection = {
      asOf: new Date(now).toISOString(),
      currentTemperature: '12',
      delayMinutes: 75,
      detectedBy: 'SYSTEM' as const,
    };
    const [left, right] = await Promise.all([
      service.detectExceptions(shipment.id, detection, context, command()),
      service.detectExceptions(shipment.id, detection, context, command()),
    ]);
    expect(left.detected).toBe(2);
    expect(right.detected).toBe(2);
    expect(
      await prisma.transportException.count({
        where: { shipmentId: shipment.id },
      }),
    ).toBe(2);
    expect(
      [...left.results, ...right.results].filter(({ replayed }) => !replayed),
    ).toHaveLength(2);

    let temperature = await prisma.transportException.findFirstOrThrow({
      where: { shipmentId: shipment.id, type: 'TEMPERATURE' },
    });
    const action = (
      actionType: 'ACKNOWLEDGE' | 'PLAN' | 'RESOLVE' | 'CLOSE',
      extra: Record<string, unknown> = {},
    ) => ({
      actionType,
      evidenceSnapshot: {},
      expectedVersion: temperature.version,
      handlingPlan: '隔离货物并恢复温控，持续通知客户',
      ownerId: actorId,
      ...extra,
    });
    await service.actOnException(
      temperature.id,
      action('ACKNOWLEDGE'),
      context,
      command(),
    );
    temperature = await prisma.transportException.findUniqueOrThrow({
      where: { id: temperature.id },
    });
    await service.actOnException(
      temperature.id,
      action('PLAN'),
      context,
      command(),
    );
    temperature = await prisma.transportException.findUniqueOrThrow({
      where: { id: temperature.id },
    });
    await service.actOnException(
      temperature.id,
      action('RESOLVE', {
        resolutionSummary: '温控已恢复且货物复核无损',
        rootCause: '制冷机临时断电',
      }),
      context,
      command(),
    );
    temperature = await prisma.transportException.findUniqueOrThrow({
      where: { id: temperature.id },
    });
    await expect(
      service.actOnException(
        temperature.id,
        action('CLOSE'),
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_EXCEPTION_CLOSE_BLOCKED' });
    const closed = await service.actOnException(
      temperature.id,
      action('CLOSE', {
        businessVerified: true,
        customerCommunicatedAt: new Date(now + 1_000).toISOString(),
      }),
      context,
      command(),
    );
    expect(closed.status).toBe('CLOSED');

    const escalated = await service.escalateDue(
      {
        asOf: new Date(now + 5 * 3_600_000).toISOString(),
        toOwnerId: randomUUID(),
      },
      context,
      command(),
    );
    expect(escalated.escalated).toBe(1);
    const immutableAction = await prisma.exceptionAction.findFirstOrThrow({
      where: { transportExceptionId: temperature.id },
    });
    await expect(
      prisma.exceptionAction.update({
        data: { handlingPlan: 'tampered' },
        where: { id: immutableAction.id },
      }),
    ).rejects.toBeDefined();

    const requested = await service.requestAppointment(
      shipment.id,
      {
        milestoneId: milestones[1]!.id,
        plannedAt: milestones[1]!.plannedAt.toISOString(),
        siteRequirementSnapshot: { dockType: 'COLD' },
      },
      context,
      command(),
    );
    const confirmedInput = {
      appointmentRef: `APT-${randomUUID()}`,
      appointmentSnapshot: { slot: 'SLOT-1' },
      eventType: 'CONFIRMED' as const,
      plannedAt: milestones[1]!.plannedAt.toISOString(),
      sourceVersion: 1,
    };
    const confirmed = await service.applyAppointmentEvent(
      requested.appointmentLinkId,
      confirmedInput,
      context,
      command(),
    );
    expect(confirmed.status).toBe('LINKED');
    const change = await service.requestAppointmentChange(
      requested.appointmentLinkId,
      {
        expectedVersion: confirmed.version,
        plannedAt: new Date(now + 2.5 * 3_600_000).toISOString(),
        reason: '场地拥堵改期',
        type: 'RESCHEDULE',
      },
      context,
      command(),
    );
    expect(change.status).toBe('RESCHEDULE_REQUESTED');
    const rescheduledInput = {
      ...confirmedInput,
      appointmentSnapshot: { slot: 'SLOT-2' },
      eventType: 'RESCHEDULED' as const,
      plannedAt: new Date(now + 2.5 * 3_600_000).toISOString(),
      sourceVersion: 2,
    };
    const rescheduled = await service.applyAppointmentEvent(
      requested.appointmentLinkId,
      rescheduledInput,
      context,
      command(),
    );
    expect(rescheduled.status).toBe('LINKED');
    expect(
      (
        await prisma.shipmentMilestone.findUniqueOrThrow({
          where: { id: milestones[1]!.id },
        })
      ).plannedAt.toISOString(),
    ).toBe(rescheduledInput.plannedAt);
    expect(
      await prisma.etaPrediction.count({
        where: { milestoneId: milestones[1]!.id },
      }),
    ).toBe(1);
    expect(
      (
        await service.applyAppointmentEvent(
          requested.appointmentLinkId,
          rescheduledInput,
          context,
          command(),
        )
      ).replayed,
    ).toBe(true);
    await expect(
      service.applyAppointmentEvent(
        requested.appointmentLinkId,
        { ...rescheduledInput, appointmentSnapshot: { changed: true } },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_APPOINTMENT_EVENT_STALE' });
    const cancellation = await service.requestAppointmentChange(
      requested.appointmentLinkId,
      {
        expectedVersion: rescheduled.version,
        reason: '运输取消，请 AMS 释放时隙',
        type: 'CANCEL',
      },
      context,
      command(),
    );
    expect(cancellation.status).toBe('CANCELLATION_REQUESTED');
    const cancelled = await service.applyAppointmentEvent(
      requested.appointmentLinkId,
      {
        ...rescheduledInput,
        eventType: 'CANCELLED',
        sourceVersion: 3,
      },
      context,
      command(),
    );
    expect(cancelled.status).toBe('CANCELLED');
  });
});
