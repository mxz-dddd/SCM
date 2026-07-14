import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { FleetAssignmentFacade } from '../mdm/public/fleet-assignment.facade';
import { DispatchService } from './dispatch.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('TMS vehicle assignment and dispatch persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('serializes resource conflicts and blocks dispatch until compliance passes', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const carrierRef = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'dispatch-db-test',
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
    const scheduleFrom = new Date(now - 2 * 3_600_000);
    const pickupAt = new Date(now - 1 * 3_600_000);
    const deliveryAt = new Date(now + 4 * 3_600_000);
    const scheduleTo = new Date(now + 6 * 3_600_000);
    const day = (offset: number) =>
      new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
    const batch = await prisma.planningBatch.create({
      data: {
        batchNo: `PB-${randomUUID()}`,
        createdBy: actorId,
        criteria: {},
        planningDate: new Date(day(1)),
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
    const createShipment = () =>
      prisma.shipment.create({
        data: {
          consolidationPlanId: plan.id,
          createdBy: actorId,
          deliveryWindowTo: deliveryAt,
          destinationSnapshot: { code: 'SHA' },
          mode: 'ROAD_FTL',
          originSnapshot: { code: 'SUZ' },
          pickupWindowFrom: pickupAt,
          requirementSnapshot: {
            dangerousGoods: true,
            equipmentType: 'REEFER_TRUCK',
          },
          shipmentNo: `SHP-${randomUUID()}`,
          status: 'ACCEPTED',
          temperatureMax: 8,
          temperatureMin: 2,
          tenantId,
          totalPallets: 4,
          totalVolumeBase: 12,
          totalWeightBase: 1200,
          updatedBy: actorId,
        },
      });
    const createTender = (shipmentId: string) =>
      prisma.carrierTender.create({
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
          responseReason: 'Accepted for dispatch test',
          shipmentId,
          status: 'ACCEPTED',
          tenantId,
          tenderNo: `CT-${randomUUID()}`,
          updatedBy: actorId,
        },
      });
    const equipment = await prisma.equipmentType.create({
      data: {
        code: 'REEFER_TRUCK',
        createdBy: actorId,
        maxPayload: 5000,
        maxVolume: 50,
        name: 'Reefer truck',
        payloadUom: 'KG',
        serviceCapabilities: {
          dangerousGoodsCapable: true,
          palletCapacity: 20,
        },
        status: 'ACTIVE',
        temperatureControlled: true,
        tenantId,
        updatedBy: actorId,
        volumeUom: 'M3',
      },
    });
    const createFleet = async (suffix: string) => {
      const vehicle = await prisma.vehicle.create({
        data: {
          carrierPartnerId: carrierRef,
          createdBy: actorId,
          equipmentTypeId: equipment.id,
          maxPayload: 5000,
          maxVolume: 50,
          payloadUom: 'KG',
          plateNumber: `沪A-${suffix}-${randomUUID().slice(0, 5)}`,
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
          driverNo: `DRV-${suffix}-${randomUUID()}`,
          name: `Driver ${suffix}`,
          phone: '13800000000',
          status: 'AVAILABLE',
          tenantId,
          updatedBy: actorId,
        },
      });
      for (const certificateType of ['DRIVING_LICENSE', 'DRIVER_HAZMAT'])
        await prisma.driverCertificate.create({
          data: {
            certificateNo: `${certificateType}-${randomUUID()}`,
            certificateType,
            createdBy: actorId,
            driverId: driver.id,
            requiredForAssignment: true,
            tenantId,
            updatedBy: actorId,
            validFrom: new Date(day(-10)),
            validUntil: new Date(day(10)),
          },
        });
      return { driver, vehicle };
    };
    const fleet = await createFleet('PRIMARY');
    const service = new DispatchService(
      prisma as never,
      new FleetAssignmentFacade(prisma as never),
    );
    const shipment1 = await createShipment();
    const shipment2 = await createShipment();
    const tender1 = await createTender(shipment1.id);
    const tender2 = await createTender(shipment2.id);
    const assignmentInput = (carrierTenderId: string) => ({
      backupContactSnapshot: { name: 'Dispatch backup', phone: '13900000000' },
      carrierTenderId,
      driverRef: fleet.driver.id,
      expectedShipmentVersion: 1,
      scheduleFrom: scheduleFrom.toISOString(),
      scheduleTo: scheduleTo.toISOString(),
      vehicleRef: fleet.vehicle.id,
    });
    const concurrent = await Promise.allSettled([
      service.assign(
        shipment1.id,
        assignmentInput(tender1.id),
        context,
        command(),
      ),
      service.assign(
        shipment2.id,
        assignmentInput(tender2.id),
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
    const assignment = await prisma.vehicleAssignment.findFirstOrThrow({
      where: { driverRef: fleet.driver.id, status: 'ASSIGNED', tenantId },
    });
    const assignedShipment = await prisma.shipment.findUniqueOrThrow({
      where: { id: assignment.shipmentId },
    });
    expect(assignedShipment).toMatchObject({
      status: 'DISPATCHED',
      version: 2,
    });
    expect(
      await prisma.shipment.findFirstOrThrow({
        where: { id: { not: assignment.shipmentId }, tenantId },
      }),
    ).toMatchObject({ status: 'ACCEPTED', version: 1 });

    const failedCheck = await service.checkCompliance(
      assignment.id,
      { expectedAssignmentVersion: assignment.version, vehicleDocuments: [] },
      context,
      command(),
    );
    expect(failedCheck.status).toBe('FAILED');
    expect(failedCheck.assignmentVersion).toBe(2);
    expect(failedCheck.failureReasons).toHaveLength(4);
    expect(
      await prisma.transportComplianceException.count({
        where: { status: 'OPEN', vehicleAssignmentId: assignment.id },
      }),
    ).toBe(4);
    const dispatchInput = {
      actualDepartureAt: new Date().toISOString(),
      complianceCheckId: failedCheck.complianceCheckId,
      documentSnapshot: { complete: true },
      expectedAssignmentVersion: failedCheck.assignmentVersion,
      expectedShipmentVersion: assignedShipment.version,
      loadSnapshot: { loaded: true },
      sealSnapshot: { sealNo: 'SEAL-001', sealed: true },
      vehicleAssignmentId: assignment.id,
    };
    await expect(
      service.confirmDispatch(
        assignment.shipmentId,
        dispatchInput,
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_DISPATCH_COMPLIANCE_BLOCKED' });

    const vehicleDocuments = [
      'VEHICLE_REGISTRATION',
      'VEHICLE_INSURANCE',
      'VEHICLE_INSPECTION',
      'VEHICLE_HAZMAT',
    ].map((type) => ({
      documentNo: `${type}-${randomUUID()}`,
      status: 'ACTIVE' as const,
      type,
      validFrom: new Date(now - 10 * 86_400_000).toISOString(),
      validUntil: new Date(now + 10 * 86_400_000).toISOString(),
    }));
    const passedCheck = await service.checkCompliance(
      assignment.id,
      {
        expectedAssignmentVersion: failedCheck.assignmentVersion,
        vehicleDocuments,
      },
      context,
      command(),
    );
    expect(passedCheck).toMatchObject({ failureReasons: [], status: 'PASSED' });
    expect(passedCheck.assignmentVersion).toBe(3);
    expect(
      await prisma.transportComplianceException.count({
        where: { status: 'OPEN', vehicleAssignmentId: assignment.id },
      }),
    ).toBe(0);
    expect(() =>
      service.confirmDispatch(
        assignment.shipmentId,
        {
          ...dispatchInput,
          complianceCheckId: passedCheck.complianceCheckId,
          sealSnapshot: { sealed: false },
        },
        context,
        command(),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'TMS_DISPATCH_PREREQUISITES_INCOMPLETE',
      }),
    );
    const dispatched = await service.confirmDispatch(
      assignment.shipmentId,
      {
        ...dispatchInput,
        complianceCheckId: passedCheck.complianceCheckId,
        expectedAssignmentVersion: passedCheck.assignmentVersion,
      },
      context,
      command(),
    );
    expect(dispatched).toMatchObject({
      shipmentStatus: 'TRACKING',
      shipmentVersion: 3,
      status: 'CONFIRMED',
      vehicleAssignmentVersion: 4,
    });
    await expect(
      service.confirmDispatch(
        assignment.shipmentId,
        {
          ...dispatchInput,
          complianceCheckId: passedCheck.complianceCheckId,
          expectedAssignmentVersion: passedCheck.assignmentVersion,
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_DISPATCH_STATE_CONFLICT' });
    await expect(
      service.revokeAssignment(
        assignment.id,
        { expectedVersion: 4, reason: 'Too late' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'TMS_ASSIGNMENT_REVOKE_CONFLICT' });
    await expect(
      prisma.complianceCheck.update({
        data: { checkedBy: randomUUID() },
        where: { id: passedCheck.complianceCheckId },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.shipmentDispatch.update({
        data: { confirmedBy: randomUUID() },
        where: { id: dispatched.dispatchId },
      }),
    ).rejects.toBeDefined();

    const remainingShipment = await prisma.shipment.findFirstOrThrow({
      where: { id: { not: assignment.shipmentId }, tenantId },
    });
    const remainingTender = await prisma.carrierTender.findFirstOrThrow({
      where: { shipmentId: remainingShipment.id, tenantId },
    });
    const replacementFleet = await createFleet('REPLACEMENT');
    const replacementAssignment = await service.assign(
      remainingShipment.id,
      {
        ...assignmentInput(remainingTender.id),
        driverRef: replacementFleet.driver.id,
        vehicleRef: replacementFleet.vehicle.id,
      },
      context,
      command(),
    );
    const revoked = await service.revokeAssignment(
      replacementAssignment.vehicleAssignmentId,
      {
        expectedVersion: replacementAssignment.version,
        reason: 'Dispatcher selected another resource',
      },
      context,
      command(),
    );
    expect(revoked).toMatchObject({
      shipmentStatus: 'ACCEPTED',
      status: 'REVOKED',
      version: 2,
    });
    expect(
      await prisma.platformOutbox.count({ where: { tenantId } }),
    ).toBeGreaterThanOrEqual(6);
  });
});
