import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { FleetAssignmentFacade } from '../mdm/public/fleet-assignment.facade';
import { CapacityTenderService } from './capacity-tender.service';
import { DispatchService } from './dispatch.service';
import { FleetInsightsService } from './fleet-insights.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('TMS fleet, IoT, KPI and public tracking persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('removes unavailable fleet capacity, alerts telemetry and serves masked limited tracking', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const carrierRef = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'fleet-insights-db-test',
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
    const scheduleFrom = new Date(now + 60 * 60_000);
    const scheduleTo = new Date(now + 6 * 60 * 60_000);
    const equipment = await prisma.equipmentType.create({
      data: {
        code: `REEFER-${randomUUID().slice(0, 6)}`,
        createdBy: actorId,
        maxPayload: 5000,
        maxVolume: 50,
        name: '冷藏车',
        payloadUom: 'KG',
        serviceCapabilities: { palletCapacity: 20 },
        status: 'ACTIVE',
        temperatureControlled: true,
        tenantId,
        updatedBy: actorId,
        volumeUom: 'M3',
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        carrierPartnerId: carrierRef,
        createdBy: actorId,
        equipmentTypeId: equipment.id,
        maxPayload: 5000,
        maxVolume: 50,
        payloadUom: 'KG',
        plateNumber: `沪A-${randomUUID().slice(0, 8)}`,
        status: 'AVAILABLE',
        temperatureControlled: true,
        temperatureMax: 12,
        temperatureMin: -5,
        tenantId,
        updatedBy: actorId,
        volumeUom: 'M3',
      },
    });
    const driver = await prisma.driver.create({
      data: {
        carrierPartnerId: carrierRef,
        createdBy: actorId,
        driverNo: `DRV-${randomUUID()}`,
        name: '敏感司机姓名',
        phone: '13800000000',
        status: 'AVAILABLE',
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.driverCertificate.create({
      data: {
        certificateNo: `LIC-${randomUUID()}`,
        certificateType: 'DRIVING_LICENSE',
        createdBy: actorId,
        driverId: driver.id,
        requiredForAssignment: true,
        tenantId,
        updatedBy: actorId,
        validFrom: new Date(now - 86_400_000),
        validUntil: new Date(now + 30 * 86_400_000),
      },
    });
    const batch = await prisma.planningBatch.create({
      data: {
        batchNo: `PB-${randomUUID()}`,
        createdBy: actorId,
        criteria: {},
        customerRef: 'CUSTOMER-INSIGHTS',
        plannedAt: new Date(),
        planningDate: new Date(now),
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
        destinationSnapshot: {
          city: '上海',
          line1: '不应公开的精确地址',
          recipientPhone: '13900000000',
        },
        mode: 'ROAD_FTL',
        originSnapshot: { city: '苏州', line1: '内部仓库地址' },
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
    const acceptedShipment = await prisma.shipment.create({
      data: {
        consolidationPlanId: plan.id,
        createdBy: actorId,
        deliveryWindowTo: scheduleTo,
        destinationSnapshot: { city: '上海' },
        mode: 'ROAD_FTL',
        originSnapshot: { city: '苏州' },
        pickupWindowFrom: scheduleFrom,
        requirementSnapshot: {},
        shipmentNo: `SHP-${randomUUID()}`,
        status: 'ACCEPTED',
        tenantId,
        totalPallets: 2,
        totalVolumeBase: 5,
        totalWeightBase: 500,
        updatedBy: actorId,
      },
    });
    const tender = await prisma.carrierTender.create({
      data: {
        capacityReservationId: randomUUID(),
        carrierRef,
        carrierSnapshot: { carrierRef },
        createdBy: actorId,
        currency: 'CNY',
        expiresAt: new Date(now + 86_400_000),
        priceAmount: 1200,
        requirementSnapshot: {},
        respondedAt: new Date(),
        responseReason: 'accepted',
        shipmentId: acceptedShipment.id,
        status: 'ACCEPTED',
        tenantId,
        tenderNo: `CT-${randomUUID()}`,
        updatedBy: actorId,
      },
    });
    await prisma.carrierTender.create({
      data: {
        capacityReservationId: randomUUID(),
        carrierRef,
        carrierSnapshot: { carrierRef },
        createdBy: actorId,
        currency: 'CNY',
        expiresAt: new Date(now + 86_400_000),
        priceAmount: 1300,
        requirementSnapshot: {},
        respondedAt: new Date(),
        responseReason: 'capacity unavailable',
        shipmentId: shipment.id,
        status: 'REJECTED',
        tenantId,
        tenderNo: `CT-${randomUUID()}`,
        updatedBy: actorId,
      },
    });
    const pool = await prisma.capacityPool.create({
      data: {
        calendarSnapshot: {},
        carrierRef,
        carrierSnapshot: {},
        createdBy: actorId,
        poolNo: `CAP-${randomUUID()}`,
        qualificationSnapshot: {},
        regionCode: 'EAST',
        serviceDate: scheduleFrom,
        sourceType: 'OWN_FLEET',
        tenantId,
        totalPallets: 20,
        totalVolumeBase: 50,
        totalWeightBase: 5000,
        updatedBy: actorId,
        vehicleRef: vehicle.id,
        vehicleType: equipment.code,
      },
    });
    const service = new FleetInsightsService(
      prisma as never,
      new FleetAssignmentFacade(prisma as never),
    );
    const maintenance = await service.scheduleMaintenance(
      {
        detailSnapshot: { workshop: '授权维修站' },
        maintenanceType: 'MAINTENANCE',
        odometer: '120000',
        plannedFrom: scheduleFrom.toISOString(),
        plannedTo: scheduleTo.toISOString(),
        reason: '十万公里保养',
        vehicleRef: vehicle.id,
      },
      context,
      command(),
    );
    expect(
      await prisma.capacityPool.findUniqueOrThrow({ where: { id: pool.id } }),
    ).toMatchObject({ status: 'INACTIVE' });
    await expect(
      new CapacityTenderService(prisma as never).createCapacityPool(
        {
          calendarSnapshot: {},
          carrierRef,
          carrierSnapshot: {},
          qualificationSnapshot: {},
          regionCode: 'EAST',
          serviceDate: scheduleFrom.toISOString().slice(0, 10),
          sourceType: 'OWN_FLEET',
          totalPallets: '20',
          totalVolumeBase: '50',
          totalWeightBase: '5000',
          vehicleRef: vehicle.id,
          vehicleType: equipment.code,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_CAPACITY_VEHICLE_UNAVAILABLE' });
    const dispatch = new DispatchService(
      prisma as never,
      new FleetAssignmentFacade(prisma as never),
    );
    await expect(
      dispatch.assign(
        acceptedShipment.id,
        {
          backupContactSnapshot: { phone: '13900000000' },
          carrierTenderId: tender.id,
          driverRef: driver.id,
          expectedShipmentVersion: acceptedShipment.version,
          scheduleFrom: scheduleFrom.toISOString(),
          scheduleTo: scheduleTo.toISOString(),
          vehicleRef: vehicle.id,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_VEHICLE_MAINTENANCE_CONFLICT' });
    const fact = await service.recordOperatingFact(
      {
        detailSnapshot: { liters: 100 },
        factType: 'FUEL',
        occurredAt: new Date(now).toISOString(),
        sourceRef: 'FUEL-001',
        uom: 'L',
        value: '100',
        vehicleRef: vehicle.id,
      },
      context,
      command(),
    );
    await expect(
      service.recordOperatingFact(
        {
          detailSnapshot: { liters: 100 },
          factType: 'FUEL',
          occurredAt: new Date(now).toISOString(),
          sourceRef: 'FUEL-001',
          uom: 'L',
          value: '100',
          vehicleRef: vehicle.id,
        },
        context,
        command(),
      ),
    ).resolves.toMatchObject({
      operatingFactId: fact.operatingFactId,
      replayed: true,
    });
    await expect(
      prisma.vehicleOperatingFact.update({
        data: { value: 1 },
        where: { id: fact.operatingFactId },
      }),
    ).rejects.toBeDefined();
    const started = await service.transitionMaintenance(
      maintenance.maintenancePlanId,
      {
        action: 'START',
        expectedVersion: maintenance.version,
        reason: '车辆进场',
      },
      context,
      command(),
    );
    const completed = await service.transitionMaintenance(
      maintenance.maintenancePlanId,
      {
        action: 'COMPLETE',
        expectedVersion: started.version,
        reason: '保养完成并通过检查',
      },
      context,
      command(),
    );
    expect(completed.status).toBe('COMPLETED');
    expect(
      await prisma.capacityPool.findUniqueOrThrow({ where: { id: pool.id } }),
    ).toMatchObject({ status: 'ACTIVE' });
    await expect(
      prisma.maintenanceEvent.update({
        data: { reason: 'tampered' },
        where: {
          id: (
            await prisma.maintenanceEvent.findFirstOrThrow({
              where: { maintenancePlanId: maintenance.maintenancePlanId },
            })
          ).id,
        },
      }),
    ).rejects.toBeDefined();

    const telemetryInput = {
      deviceRef: 'IOT-REEFER-001',
      externalMessageId: 'MSG-001',
      metricType: 'TEMPERATURE' as const,
      observedAt: new Date(now).toISOString(),
      payloadSnapshot: { sensor: 'cargo' },
      retentionDays: 365,
      uom: 'C',
      value: '12.5',
    };
    const telemetry = await service.ingestTelemetry(
      shipment.id,
      telemetryInput,
      context,
      command(),
    );
    expect(telemetry.alertId).toBeDefined();
    await expect(
      service.ingestTelemetry(shipment.id, telemetryInput, context, command()),
    ).resolves.toMatchObject({
      replayed: true,
      telemetryId: telemetry.telemetryId,
    });
    await expect(
      service.ingestTelemetry(
        shipment.id,
        { ...telemetryInput, value: '13' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_TELEMETRY_REPLAY_CONFLICT' });
    await expect(
      prisma.telemetry.update({
        data: { value: 1 },
        where: { id: telemetry.telemetryId },
      }),
    ).rejects.toBeDefined();
    const alert = await prisma.conditionAlert.findUniqueOrThrow({
      where: { id: telemetry.alertId! },
    });
    const acknowledged = await service.transitionAlert(
      alert.id,
      { action: 'ACKNOWLEDGE', expectedVersion: alert.version },
      context,
      command(),
    );
    const resolved = await service.transitionAlert(
      alert.id,
      {
        action: 'RESOLVE',
        expectedVersion: acknowledged.version,
        resolution: '冷机恢复，货物复核合格',
      },
      context,
      command(),
    );
    expect(resolved.status).toBe('RESOLVED');
    expect(
      await prisma.transportException.findUniqueOrThrow({
        where: { id: alert.transportExceptionId! },
      }),
    ).toMatchObject({ status: 'RESOLVED' });

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
    for (const [index, type] of ['PICKUP', 'DELIVERY'].entries()) {
      const milestone = await prisma.shipmentMilestone.create({
        data: {
          code: type,
          createdBy: actorId,
          locationSnapshot: { city: index ? '上海' : '苏州' },
          mandatory: true,
          milestonePlanId: milestonePlan.id,
          plannedAt: new Date(now + (index + 2) * 60_000),
          requirementSnapshot: {},
          sequence: index + 1,
          shipmentId: shipment.id,
          tenantId,
          type,
          updatedBy: actorId,
        },
      });
      const event = await prisma.trackingEvent.create({
        data: {
          createdBy: actorId,
          eventNo: `TE-${randomUUID()}`,
          eventType: type,
          evidenceSnapshot: {},
          locationSnapshot: { city: index ? '上海' : '苏州' },
          milestoneId: milestone.id,
          occurredAt: new Date(now + (index + 1) * 60_000),
          shipmentId: shipment.id,
          source: 'GPS',
          tenantId,
          updatedBy: actorId,
        },
      });
      await prisma.shipmentMilestone.update({
        data: {
          actualAt: event.occurredAt,
          actualSource: 'GPS',
          status: 'COMPLETED',
          trackingEventId: event.id,
          updatedBy: actorId,
          version: { increment: 1 },
        },
        where: { id: milestone.id },
      });
    }
    const metrics = await service.generateMetrics(
      {
        dimensionType: 'CUSTOMER',
        periodFrom: new Date(now - 86_400_000).toISOString(),
        periodTo: new Date(now + 86_400_000).toISOString(),
      },
      context,
      command(),
    );
    expect(metrics.metricIds.length).toBeGreaterThanOrEqual(9);
    expect(
      await prisma.transportMetric.findFirstOrThrow({
        where: {
          dimensionType: 'CUSTOMER',
          dimensionValue: 'CUSTOMER-INSIGHTS',
          metricCode: 'ON_TIME_PICKUP_RATE',
          tenantId,
        },
      }),
    ).toMatchObject({ uom: 'PERCENT' });
    await expect(
      prisma.transportMetric.update({
        data: { value: 0 },
        where: { id: metrics.metricIds[0]! },
      }),
    ).rejects.toBeDefined();

    await prisma.shipmentMapProjection.create({
      data: {
        createdBy: actorId,
        driverRestrictedSnapshot: {
          driverName: '敏感司机姓名',
          phone: '13800000000',
        },
        etaSnapshot: {},
        exceptionSnapshot: [],
        milestoneSnapshot: [],
        positionSnapshot: {
          latitude: '31.2345678',
          longitude: '121.4567890',
          recordedAt: new Date(now).toISOString(),
        },
        routeSnapshot: {},
        shipmentId: shipment.id,
        shipmentStatus: 'TRACKING',
        sourceVersions: {},
        tenantId,
        updatedBy: actorId,
        vehicleSnapshot: { plateNumber: vehicle.plateNumber },
      },
    });
    const issued = await service.issueTrackingToken(
      shipment.id,
      {
        allowPod: false,
        audienceSnapshot: { recipientPhone: '13900000000' },
        expiresAt: new Date(now + 86_400_000).toISOString(),
        maxViews: 1,
      },
      context,
      command(),
    );
    const publicView = await service.publicTracking(issued.token, '127.0.0.1');
    expect(publicView.map).toMatchObject({
      latitude: 31.23,
      longitude: 121.46,
      precision: 'CITY_LEVEL',
    });
    expect(JSON.stringify(publicView)).not.toMatch(
      /敏感司机姓名|13800000000|13900000000|不应公开的精确地址|内部仓库地址/,
    );
    await expect(
      service.publicTracking(issued.token, '127.0.0.1'),
    ).rejects.toMatchObject({
      code: 'TMS_TRACKING_TOKEN_EXPIRED',
      statusCode: 410,
    });
    const revocable = await service.issueTrackingToken(
      shipment.id,
      {
        allowPod: false,
        audienceSnapshot: {},
        expiresAt: new Date(now + 86_400_000).toISOString(),
        maxViews: 3,
      },
      context,
      command(),
    );
    await service.revokeTrackingToken(
      revocable.trackingAccessTokenId,
      { expectedVersion: revocable.version, reason: '客户撤销分享' },
      context,
      command(),
    );
    await expect(service.publicTracking(revocable.token)).rejects.toMatchObject(
      {
        code: 'TMS_TRACKING_TOKEN_EXPIRED',
        statusCode: 410,
      },
    );
    expect(
      await prisma.publicTrackingAccessLog.count({ where: { tenantId } }),
    ).toBe(1);
  });
});
