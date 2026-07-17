import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { AppointmentIntakeService } from './appointment-intake.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe(
  'AMS appointment intake and atomic capacity persistence',
  () => {
    afterAll(() => prisma.$disconnect());

    it('splits source quantities, atomically reserves slots, routes approval and expands recurring instances', async () => {
      const tenantId = randomUUID();
      const actorId = randomUUID();
      const warehouseRef = randomUUID();
      const resourceRef = randomUUID();
      const context: TenantContext = {
        accountId: actorId,
        accountKind: 'TENANT_ADMIN',
        deviceId: 'ams-intake-database-test',
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
      const profile = await prisma.capacityProfile.create({
        data: {
          blacklistDates: [],
          calendarCode: 'TEST',
          capacityLaborHours: 100,
          capacityPallets: 100,
          capacityQuantity: 100,
          capacityQuantityUom: 'EA',
          capacityVehicles: 100,
          createdBy: actorId,
          effectiveFrom: new Date('2035-01-01T00:00:00.000Z'),
          internalLaborHours: 0,
          internalPallets: 0,
          internalQuantity: 0,
          internalVehicles: 0,
          leadTimeMinutes: 0,
          profileCode: `APT-${randomUUID().slice(0, 8)}`,
          publishedAt: new Date(),
          resourceRef,
          resourceSnapshot: { dock: 'D1' },
          resourceType: 'DOCK',
          revision: 1,
          serviceType: 'INBOUND',
          shiftCode: 'DAY',
          shiftEndTime: '18:00',
          shiftStartTime: '08:00',
          slotMinutes: 60,
          status: 'PUBLISHED',
          tenantId,
          updatedBy: actorId,
          warehouseRef,
        },
      });
      const calendar = await prisma.capacityCalendar.create({
        data: {
          calendarDate: new Date('2035-01-02T00:00:00.000Z'),
          calendarSnapshot: { timeZone: 'UTC', working: true },
          capacityProfileId: profile.id,
          createdBy: actorId,
          shiftCode: 'DAY',
          tenantId,
          updatedBy: actorId,
        },
      });
      const makeSlot = (startsAt: string, capacity = 100) =>
        prisma.timeSlot.create({
          data: {
            calendarSnapshot: { timeZone: 'UTC', working: true },
            capacityCalendarId: calendar.id,
            capacityLaborHours: capacity,
            capacityPallets: capacity,
            capacityProfileId: profile.id,
            capacityQuantity: capacity,
            capacityQuantityUom: 'EA',
            capacityVehicles: capacity,
            createdBy: actorId,
            endsAt: new Date(new Date(startsAt).getTime() + 3_600_000),
            resourceRef,
            resourceType: 'DOCK',
            serviceType: 'INBOUND',
            startsAt: new Date(startsAt),
            tenantId,
            updatedBy: actorId,
            warehouseRef,
          },
        });
      const [slotA, slotB, slotC, conflictSlot] = await Promise.all([
        makeSlot('2035-01-02T08:00:00.000Z'),
        makeSlot('2035-01-02T09:00:00.000Z'),
        makeSlot('2035-01-02T10:00:00.000Z'),
        makeSlot('2035-01-02T11:00:00.000Z', 10),
      ]);
      const service = new AppointmentIntakeService(prisma as never);
      const draft = (
        slot: typeof slotA,
        sourceRef: string,
        quantity: string,
        type: 'ORDER_LINKED' | 'UNLINKED' = 'ORDER_LINKED',
      ) => ({
        approvalPolicy: {
          customerRequiresApproval: false,
          requiresApprovalServiceTypes: [] as string[],
        },
        orderLinks:
          type === 'ORDER_LINKED'
            ? [
                {
                  bookableQuantityBase: '100',
                  packageSpecSnapshot: { packageSpecVersion: 1 },
                  quantity,
                  quantityBase: quantity,
                  quantityBaseUom: 'EA',
                  quantityUom: 'EA',
                  sourceLineRef: '1',
                  sourceRef,
                  sourceSnapshot: { location: warehouseRef },
                  sourceType: 'INBOUND',
                },
              ]
            : [],
        requesterPartyRef: 'PARTNER-1',
        requesterSnapshot: { name: '预约方' },
        requestedWindowFrom: slot.startsAt.toISOString(),
        requestedWindowTo: slot.endsAt.toISOString(),
        serviceType: 'INBOUND',
        slotVersion: slot.version,
        timeSlotId: slot.id,
        type,
        urgent: false,
        vehicleSnapshot: { plateNumber: '沪A12345' },
        warehouseRef,
        workload: {
          laborHours: quantity,
          pallets: quantity,
          quantity,
          quantityUom: 'EA',
          vehicles: type === 'UNLINKED' ? '1' : quantity,
        },
      });

      const first = await service.createAndSubmit(
        draft(slotA, 'ORDER-SPLIT', '60'),
        context,
        command(),
      );
      const second = await service.createAndSubmit(
        draft(slotB, 'ORDER-SPLIT', '40'),
        context,
        command(),
      );
      expect(first.status).toBe('CONFIRMED');
      expect(second.status).toBe('CONFIRMED');
      await expect(
        service.createAndSubmit(
          draft(slotC, 'ORDER-SPLIT', '1'),
          context,
          command(),
        ),
      ).rejects.toMatchObject({
        code: 'AMS_ORDER_UNAPPOINTED_QUANTITY_EXCEEDED',
        statusCode: 409,
      });

      const competitors = await Promise.allSettled([
        service.createAndSubmit(
          draft(conflictSlot, 'ORDER-RACE-A', '10'),
          context,
          command(),
        ),
        service.createAndSubmit(
          draft(conflictSlot, 'ORDER-RACE-B', '10'),
          context,
          command(),
        ),
      ]);
      expect(
        competitors.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        competitors.filter(({ status }) => status === 'rejected'),
      ).toHaveLength(1);
      const raced = await prisma.timeSlot.findUniqueOrThrow({
        where: { id: conflictSlot.id },
      });
      expect(raced.usedQuantity.toString()).toBe('10');

      const approvalSlot = await makeSlot('2035-01-02T12:00:00.000Z');
      const unlinked = await service.createAndSubmit(
        draft(approvalSlot, 'UNUSED', '5', 'UNLINKED'),
        context,
        command(),
      );
      expect(unlinked.status).toBe('PENDING');
      const suggestedSlot = await makeSlot('2035-01-02T13:00:00.000Z');
      const suggested = await service.decide(
        unlinked.appointmentId,
        {
          decision: 'SUGGEST_RESCHEDULE',
          expectedVersion: unlinked.version,
          reason: '建议错峰到场',
          suggestedTimeSlotId: suggestedSlot.id,
        },
        context,
        command(),
      );
      expect(suggested.status).toBe('PENDING');
      const approved = await service.decide(
        unlinked.appointmentId,
        {
          decision: 'APPROVE',
          expectedVersion: unlinked.version,
          reason: '车辆身份材料已人工复核',
        },
        context,
        command(),
      );
      expect(approved.status).toBe('CONFIRMED');
      const approvalReservation =
        await prisma.appointmentCapacityReservation.findFirstOrThrow({
          where: { appointmentId: unlinked.appointmentId, status: 'ACTIVE' },
        });
      expect(approvalReservation.allocationType).toBe('USED');

      const recurringSlot = await makeSlot('2035-01-03T08:00:00.000Z');
      const recurring = await service.createRecurring(
        {
          effectiveFrom: '2035-01-03',
          effectiveUntil: '2035-01-10',
          intervalWeeks: 1,
          requesterPartyRef: 'PARTNER-LONG',
          requesterSnapshot: { name: '长期预约方' },
          serviceType: 'INBOUND',
          slotStartTime: '08:00',
          vehicleSnapshot: { plateNumber: '沪B12345' },
          warehouseRef,
          weekdays: [3],
          workload: {
            laborHours: '1',
            pallets: '1',
            quantity: '1',
            quantityUom: 'EA',
            vehicles: '1',
          },
        },
        context,
        command(),
      );
      expect(recurring).toMatchObject({ pending: 1, reserved: 1 });
      expect(
        await prisma.appointmentOccurrence.count({
          where: { recurringAppointmentId: recurring.recurringAppointmentId },
        }),
      ).toBe(2);
      const availability = await service.availability(
        {
          from: recurringSlot.startsAt.toISOString(),
          requesterPartyRef: 'PARTNER-LONG',
          serviceType: 'INBOUND',
          to: new Date(
            recurringSlot.endsAt.getTime() + 86_400_000,
          ).toISOString(),
          warehouseRef,
          workloadLaborHours: '0',
          workloadPallets: '0',
          workloadQuantity: '0',
          workloadVehicles: '0',
        },
        context,
      );
      expect(JSON.stringify(availability)).not.toContain('appointmentNo');
      expect(JSON.stringify(availability)).not.toContain('PARTNER-1');

      const originalBeforeFailure = await prisma.timeSlot.findUniqueOrThrow({
        where: { id: slotA.id },
      });
      await expect(
        service.reschedule(
          first.appointmentId,
          {
            expectedVersion: first.version,
            newRequestedWindowFrom: conflictSlot.startsAt.toISOString(),
            newRequestedWindowTo: conflictSlot.endsAt.toISOString(),
            newSlotVersion: raced.version,
            newTimeSlotId: conflictSlot.id,
            reason: '尝试改到已满时隙',
          },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'AMS_RESCHEDULE_CAPACITY_CONFLICT' });
      const unchangedAppointment = await prisma.appointment.findUniqueOrThrow({
        where: { id: first.appointmentId },
      });
      const originalAfterFailure = await prisma.timeSlot.findUniqueOrThrow({
        where: { id: slotA.id },
      });
      expect(unchangedAppointment.timeSlotId).toBe(slotA.id);
      expect(originalAfterFailure.usedQuantity.toString()).toBe(
        originalBeforeFailure.usedQuantity.toString(),
      );

      const newSlot = await makeSlot('2035-01-04T08:00:00.000Z');
      const moved = await service.reschedule(
        first.appointmentId,
        {
          expectedVersion: first.version,
          newRequestedWindowFrom: newSlot.startsAt.toISOString(),
          newRequestedWindowTo: newSlot.endsAt.toISOString(),
          newSlotVersion: newSlot.version,
          newTimeSlotId: newSlot.id,
          reason: '预约方调整到货日期',
        },
        context,
        command(),
      );
      expect(moved).toMatchObject({
        status: 'CONFIRMED',
        timeSlotId: newSlot.id,
      });
      expect(
        (
          await prisma.timeSlot.findUniqueOrThrow({ where: { id: slotA.id } })
        ).usedQuantity.toString(),
      ).toBe('0');
      expect(
        (
          await prisma.timeSlot.findUniqueOrThrow({ where: { id: newSlot.id } })
        ).usedQuantity.toString(),
      ).toBe('60');

      const scheduled = await service.scheduleReminders(
        first.appointmentId,
        {
          expectedVersion: moved.version,
          preparationSnapshot: {
            address: '仓库地址快照',
            credentials: ['驾驶证', '预约二维码'],
            restrictions: ['园区禁行规则'],
            tips: ['提前到达门岗'],
          },
          reminders: [
            {
              channel: 'IN_APP',
              leadMinutes: 9_000_000,
              reminderType: 'ARRIVAL_PREP',
            },
          ],
        },
        context,
        command(),
      );
      const reminderId = scheduled.reminderScheduleIds[0]!;
      const sent = await service.sendReminder(
        reminderId,
        { expectedVersion: 1 },
        context,
        command(),
      );
      expect(sent.status).toBe('SENT');
      await expect(
        service.sendReminder(
          reminderId,
          { expectedVersion: 1 },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'AMS_REMINDER_VERSION_CONFLICT' });

      await expect(
        service.cancel(
          first.appointmentId,
          {
            allowWithinLead: false,
            cancellationLeadMinutes: 20_000_000,
            expectedVersion: moved.version,
            feeAmountWithinLead: '50',
            feeCurrency: 'CNY',
            notificationSnapshot: { recipients: ['OMS', 'TMS', 'GATE'] },
            policySnapshot: { policyCode: 'CANCEL-V1' },
            reason: '临近到场取消',
          },
          context,
          command(),
        ),
      ).rejects.toMatchObject({ code: 'AMS_CANCELLATION_LEAD_TIME_BLOCKED' });
      expect(
        (
          await prisma.timeSlot.findUniqueOrThrow({ where: { id: newSlot.id } })
        ).usedQuantity.toString(),
      ).toBe('60');
      const cancelled = await service.cancel(
        first.appointmentId,
        {
          allowWithinLead: true,
          cancellationLeadMinutes: 20_000_000,
          expectedVersion: moved.version,
          feeAmountWithinLead: '50',
          feeCurrency: 'CNY',
          notificationSnapshot: { recipients: ['OMS', 'TMS', 'GATE'] },
          policySnapshot: { policyCode: 'CANCEL-V1' },
          reason: '合同允许付费取消',
        },
        context,
        command(),
      );
      expect(cancelled).toMatchObject({ feeAmount: '50', status: 'CANCELLED' });
      expect(
        (
          await prisma.timeSlot.findUniqueOrThrow({ where: { id: newSlot.id } })
        ).usedQuantity.toString(),
      ).toBe('0');
      const rescheduleRecord = await prisma.rescheduleRecord.findFirstOrThrow({
        where: { appointmentId: first.appointmentId },
      });
      await expect(
        prisma.rescheduleRecord.delete({ where: { id: rescheduleRecord.id } }),
      ).rejects.toThrow(/immutable/i);
      const cancellation =
        await prisma.appointmentCancellation.findUniqueOrThrow({
          where: {
            tenantId_appointmentId: {
              appointmentId: first.appointmentId,
              tenantId,
            },
          },
        });
      await expect(
        prisma.appointmentCancellation.delete({
          where: { id: cancellation.id },
        }),
      ).rejects.toThrow(/immutable/i);

      const link = await prisma.amsAppointmentOrderLink.findFirstOrThrow({
        where: { appointmentId: first.appointmentId },
      });
      await expect(
        prisma.amsAppointmentOrderLink.delete({ where: { id: link.id } }),
      ).rejects.toThrow(/immutable/i);
      expect(
        await prisma.appointmentDecision.count({
          where: { appointmentId: unlinked.appointmentId },
        }),
      ).toBe(4);
    });
  },
);
