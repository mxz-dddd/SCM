import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const operationTypes = [
  'DOCKED',
  'STARTED',
  'PAUSED',
  'RESUMED',
  'COMPLETED',
  'DEPARTED',
] as const;
type OperationType = (typeof operationTypes)[number];

@Injectable()
export class OperationClosureService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const [
      appointments,
      events,
      completions,
      noShows,
      penalties,
      appeals,
      decisions,
    ] = await Promise.all([
      this.prisma.appointment.findMany({
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 300,
        where: {
          status: {
            in: [
              'CONFIRMED',
              'DOCKED',
              'OPERATING',
              'CHECKED_OUT',
              'COMPLETED',
              'NO_SHOW',
            ],
          },
          ...where,
        },
      }),
      this.prisma.operationEvent.findMany({
        orderBy: [{ occurredAt: 'desc' }, { sequence: 'desc' }],
        take: 500,
        where,
      }),
      this.prisma.appointmentCompletion.findMany({
        orderBy: { checkedOutAt: 'desc' },
        take: 300,
        where,
      }),
      this.prisma.noShowCase.findMany({
        orderBy: { detectedAt: 'desc' },
        take: 300,
        where,
      }),
      this.prisma.penaltyChargeFact.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 300,
        where,
      }),
      this.prisma.noShowAppeal.findMany({
        orderBy: { submittedAt: 'desc' },
        take: 300,
        where,
      }),
      this.prisma.penaltyWaiverDecision.findMany({
        orderBy: { decidedAt: 'desc' },
        take: 300,
        where,
      }),
    ]);
    return toHttpJson({
      appeals,
      appointments,
      completions,
      decisions,
      events,
      noShows,
      penalties,
    });
  }

  async dashboard(
    query: {
      requesterPartyRef?: string;
      serviceType?: string;
      warehouseRef?: string;
    },
    context: TenantContext,
  ) {
    if (query.warehouseRef) this.uuid(query.warehouseRef, 'warehouseRef');
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    const futureEnd = new Date(end.getTime() + 7 * 86_400_000);
    const appointmentWhere = {
      ...(query.requesterPartyRef
        ? { requesterPartyRef: query.requesterPartyRef }
        : {}),
      ...(query.serviceType ? { serviceType: query.serviceType } : {}),
      ...(query.warehouseRef ? { warehouseRef: query.warehouseRef } : {}),
      tenantId: context.tenantId,
    };
    const appointments = await this.prisma.appointment.findMany({
      orderBy: [{ requestedWindowFrom: 'asc' }, { id: 'asc' }],
      take: 1000,
      where: {
        ...appointmentWhere,
        requestedWindowFrom: { lt: end },
        requestedWindowTo: { gte: start },
      },
    });
    const appointmentIds = appointments.map(({ id }) => id);
    const [verifications, tickets, runtimes, completions, noShows, slots] =
      await Promise.all([
        this.prisma.gateVerification.findMany({
          where: {
            appointmentId: { in: appointmentIds },
            arrivalClass: { in: ['EARLY', 'LATE'] },
            observedAt: { gte: start, lt: end },
            tenantId: context.tenantId,
          },
        }),
        this.prisma.queueTicket.findMany({
          where: {
            appointmentId: { in: appointmentIds },
            queuedAt: { gte: start, lt: end },
            tenantId: context.tenantId,
          },
        }),
        this.prisma.dockRuntime.findMany({
          where: {
            tenantId: context.tenantId,
            ...(query.warehouseRef ? { warehouseRef: query.warehouseRef } : {}),
          },
        }),
        this.prisma.appointmentCompletion.findMany({
          where: {
            appointmentId: { in: appointmentIds },
            checkedOutAt: { gte: start, lt: end },
            tenantId: context.tenantId,
          },
        }),
        this.prisma.noShowCase.findMany({
          where: {
            appointmentId: { in: appointmentIds },
            detectedAt: { gte: start, lt: end },
            tenantId: context.tenantId,
          },
        }),
        this.prisma.timeSlot.findMany({
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          take: 1000,
          where: {
            endsAt: { gt: end },
            startsAt: { lt: futureEnd },
            tenantId: context.tenantId,
            ...(query.serviceType ? { serviceType: query.serviceType } : {}),
            ...(query.warehouseRef ? { warehouseRef: query.warehouseRef } : {}),
          },
        }),
      ]);
    const average = (values: number[]) =>
      values.length
        ? Math.round(
            values.reduce((sum, value) => sum + value, 0) / values.length,
          )
        : 0;
    const futureCapacity = slots.map((slot) => ({
      endsAt: slot.endsAt,
      laborHours: {
        capacity: slot.capacityLaborHours,
        used: slot.usedLaborHours,
      },
      pallets: { capacity: slot.capacityPallets, used: slot.usedPallets },
      quantity: { capacity: slot.capacityQuantity, used: slot.usedQuantity },
      serviceType: slot.serviceType,
      slotId: slot.id,
      startsAt: slot.startsAt,
      status: slot.status,
      vehicles: { capacity: slot.capacityVehicles, used: slot.usedVehicles },
      version: slot.version,
    }));
    return toHttpJson({
      drilldown: { appointments, completions, noShows, tickets },
      filters: query,
      generatedAt: new Date(),
      metrics: {
        appointments: appointments.length,
        arrived: appointments.filter(({ status }) =>
          [
            'CHECKED_IN',
            'QUEUED',
            'DOCKED',
            'OPERATING',
            'CHECKED_OUT',
            'COMPLETED',
          ].includes(status),
        ).length,
        averageOperatingMinutes: average(
          completions.map(({ operatingMinutes }) => operatingMinutes),
        ),
        averageWaitingMinutes: average(
          completions.map(({ waitingMinutes }) => waitingMinutes),
        ),
        dockAvailable: runtimes.filter(({ status }) => status === 'AVAILABLE')
          .length,
        dockFaulted: runtimes.filter(({ status }) => status === 'FAULT').length,
        dockOccupied: runtimes.filter(({ status }) => status === 'OCCUPIED')
          .length,
        early: verifications.filter(
          ({ arrivalClass }) => arrivalClass === 'EARLY',
        ).length,
        late: verifications.filter(
          ({ arrivalClass }) => arrivalClass === 'LATE',
        ).length,
        noShows: noShows.length,
        operating: appointments.filter(({ status }) => status === 'OPERATING')
          .length,
        queued: tickets.filter(({ status }) =>
          ['WAITING', 'CALLED', 'ACKNOWLEDGED', 'DEFERRED'].includes(status),
        ).length,
      },
      futureCapacity,
    });
  }

  recordEvent(
    appointmentId: string,
    input: {
      businessLinks: Readonly<Record<string, unknown>>;
      eventType: OperationType;
      evidenceSnapshot: Readonly<Record<string, unknown>>;
      expectedVersion: number;
      occurredAt: string;
      quantity: string;
      quantityUom: string;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(appointmentId, 'appointmentId');
    if (
      !operationTypes.includes(input.eventType) ||
      !input.reason?.trim() ||
      !input.quantityUom?.trim()
    )
      this.invalid('Operation event is invalid');
    const occurredAt = this.date(input.occurredAt);
    const quantity = this.decimal(input.quantity);
    if (quantity.isNegative())
      this.invalid('Operation quantity cannot be negative');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${appointmentId}:appointment`);
      const appointment = await tx.appointment.findFirst({
        where: {
          id: appointmentId,
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (!appointment) throw this.conflict('AMS_APPOINTMENT_VERSION_CONFLICT');
      const assignment = await tx.dockAssignment.findFirst({
        where: { appointmentId, status: 'ACTIVE', tenantId: context.tenantId },
      });
      if (!assignment)
        throw new AppError(
          'AMS_ACTIVE_DOCK_REQUIRED',
          'An active dock assignment is required',
          409,
        );
      const previous = await tx.operationEvent.findFirst({
        orderBy: { sequence: 'desc' },
        where: { appointmentId, tenantId: context.tenantId },
      });
      const expected: Record<string, readonly OperationType[]> = {
        NONE: ['DOCKED'],
        DOCKED: ['STARTED'],
        STARTED: ['PAUSED', 'COMPLETED'],
        PAUSED: ['RESUMED'],
        RESUMED: ['PAUSED', 'COMPLETED'],
        COMPLETED: ['DEPARTED'],
        DEPARTED: [],
      };
      if (!expected[previous?.eventType ?? 'NONE']?.includes(input.eventType))
        throw new AppError(
          'AMS_OPERATION_SEQUENCE_INVALID',
          'Operation event does not follow the required sequence',
          409,
        );
      if (previous && occurredAt < previous.occurredAt)
        throw new AppError(
          'AMS_OPERATION_TIME_NOT_MONOTONIC',
          'Operation event time must be monotonic',
          409,
        );
      if (
        (input.eventType === 'DOCKED' || input.eventType === 'STARTED') &&
        appointment.status !== 'DOCKED'
      )
        throw this.conflict('AMS_APPOINTMENT_STATE_CONFLICT');
      if (
        !['DOCKED', 'STARTED'].includes(input.eventType) &&
        appointment.status !== 'OPERATING'
      )
        throw this.conflict('AMS_APPOINTMENT_STATE_CONFLICT');
      const event = await tx.operationEvent.create({
        data: {
          appointmentId,
          businessLinks: json(input.businessLinks),
          createdBy: context.accountId,
          dockAssignmentId: assignment.id,
          eventType: input.eventType,
          evidenceSnapshot: json(input.evidenceSnapshot),
          occurredAt,
          quantity,
          quantityUom: input.quantityUom.trim().toUpperCase(),
          reason: input.reason.trim(),
          sequence: (previous?.sequence ?? 0) + 1,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const changed =
        input.eventType === 'STARTED'
          ? await tx.appointment.update({
              data: {
                status: 'OPERATING',
                updatedBy: context.accountId,
                version: { increment: 1 },
              },
              where: { id: appointmentId },
            })
          : appointment;
      const durations = await this.durations(
        tx,
        appointmentId,
        context.tenantId,
      );
      await this.emit(
        tx,
        event.id,
        event.version,
        'appointment.operation-event.v1',
        context,
        metadata,
        {
          appointmentId,
          businessLinks: json(input.businessLinks),
          durations,
          eventType: event.eventType,
          operationEventId: event.id,
          occurredAt: event.occurredAt.toISOString(),
          quantity: event.quantity.toString(),
          quantityUom: event.quantityUom,
        },
        'OperationEvent',
      );
      return toHttpJson({
        appointmentId,
        durations,
        eventType: event.eventType,
        operationEventId: event.id,
        sequence: event.sequence,
        status: changed.status,
        version: changed.version,
      });
    });
  }

  checkOut(
    appointmentId: string,
    input: {
      documents: { valid: boolean; refs: readonly string[] };
      evidenceSnapshot: Readonly<Record<string, unknown>>;
      exceptions: { openCount: number };
      expectedVersion: number;
      occurredAt: string;
      seal: { valid: boolean; sealNo?: string };
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(appointmentId, 'appointmentId');
    const occurredAt = this.date(input.occurredAt);
    if (
      !input.documents.valid ||
      !input.seal.valid ||
      !Number.isInteger(input.exceptions.openCount) ||
      input.exceptions.openCount !== 0
    )
      throw new AppError(
        'AMS_CHECKOUT_CONTROL_BLOCKED',
        'Completed work, valid documents and seal, and no open exceptions are required',
        409,
      );
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${appointmentId}:appointment`);
      const appointment = await tx.appointment.findFirst({
        where: {
          id: appointmentId,
          status: 'OPERATING',
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (!appointment) throw this.conflict('AMS_APPOINTMENT_VERSION_CONFLICT');
      const last = await tx.operationEvent.findFirst({
        orderBy: { sequence: 'desc' },
        where: { appointmentId, tenantId: context.tenantId },
      });
      if (
        !last ||
        last.eventType !== 'DEPARTED' ||
        occurredAt < last.occurredAt
      )
        throw new AppError(
          'AMS_OPERATION_NOT_DEPARTED',
          'A monotonic DEPARTED operation event is required before checkout',
          409,
        );
      const assignment = await tx.dockAssignment.findFirst({
        where: { appointmentId, status: 'ACTIVE', tenantId: context.tenantId },
      });
      if (!assignment)
        throw new AppError(
          'AMS_ACTIVE_DOCK_REQUIRED',
          'An active dock assignment is required',
          409,
        );
      await this.lock(tx, `${context.tenantId}:${assignment.dockRef}:dock`);
      const gatePass = await tx.gatePass.findFirst({
        orderBy: { usedAt: 'desc' },
        where: { appointmentId, entryCount: 1, tenantId: context.tenantId },
      });
      if (!gatePass)
        throw new AppError(
          'AMS_ENTRY_PASS_REQUIRED',
          'A consumed entry pass is required for checkout',
          409,
        );
      await tx.dockAssignment.update({
        data: {
          releasedAt: occurredAt,
          releaseReason: 'Appointment checked out',
          status: 'RELEASED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: assignment.id },
      });
      const runtime = await tx.dockRuntime.findUnique({
        where: {
          tenantId_dockRef: {
            dockRef: assignment.dockRef,
            tenantId: context.tenantId,
          },
        },
      });
      if (runtime?.status === 'OCCUPIED')
        await tx.dockRuntime.update({
          data: {
            status: 'AVAILABLE',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: runtime.id },
        });
      await tx.dockAssignmentEvent.create({
        data: {
          appointmentId,
          createdBy: context.accountId,
          dockAssignmentId: assignment.id,
          eventType: 'RELEASED',
          fromDockRef: assignment.dockRef,
          reason: 'Appointment checked out',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      await tx.queueTicket.updateMany({
        data: {
          status: 'CANCELLED',
          transitionReason: 'Appointment checked out',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          appointmentId,
          status: { in: ['WAITING', 'CALLED', 'ACKNOWLEDGED', 'DEFERRED'] },
          tenantId: context.tenantId,
        },
      });
      const access = await tx.gateAccessEvent.create({
        data: {
          appointmentId,
          createdBy: context.accountId,
          decision: 'ALLOWED',
          eventType: 'EXIT',
          evidenceSnapshot: json({
            ...input.evidenceSnapshot,
            documents: input.documents,
            exceptions: input.exceptions,
            seal: input.seal,
          }),
          gatePassId: gatePass.id,
          occurredAt,
          reason: 'CHECKOUT_CONTROLS_PASSED',
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const changed = await tx.appointment.update({
        data: {
          status: 'CHECKED_OUT',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: appointmentId },
      });
      await this.emit(
        tx,
        appointmentId,
        changed.version,
        'appointment.checked-out.v1',
        context,
        metadata,
        {
          accessEventId: access.id,
          appointmentId,
          checkedOutAt: occurredAt.toISOString(),
          dockAssignmentId: assignment.id,
          dockRef: assignment.dockRef,
        },
        'Appointment',
      );
      return {
        accessEventId: access.id,
        appointmentId,
        dockAssignmentId: assignment.id,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  complete(
    appointmentId: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(appointmentId, 'appointmentId');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${appointmentId}:appointment`);
      const appointment = await tx.appointment.findFirst({
        where: {
          id: appointmentId,
          status: 'CHECKED_OUT',
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (!appointment) throw this.conflict('AMS_APPOINTMENT_VERSION_CONFLICT');
      const events = await tx.operationEvent.findMany({
        orderBy: { sequence: 'asc' },
        where: { appointmentId, tenantId: context.tenantId },
      });
      const byType = (type: OperationType) =>
        events.find(({ eventType }) => eventType === type);
      const docked = byType('DOCKED');
      const started = byType('STARTED');
      const completed = byType('COMPLETED');
      const departed = byType('DEPARTED');
      const verification = await tx.gateVerification.findFirst({
        orderBy: { observedAt: 'asc' },
        where: { appointmentId, status: 'PASSED', tenantId: context.tenantId },
      });
      const exit = await tx.gateAccessEvent.findFirst({
        where: {
          appointmentId,
          decision: 'ALLOWED',
          eventType: 'EXIT',
          tenantId: context.tenantId,
        },
      });
      const assignment = await tx.dockAssignment.findFirst({
        orderBy: { releasedAt: 'desc' },
        where: {
          appointmentId,
          status: 'RELEASED',
          tenantId: context.tenantId,
        },
      });
      if (
        !docked ||
        !started ||
        !completed ||
        !departed ||
        !verification ||
        !exit ||
        !assignment
      )
        throw new AppError(
          'AMS_COMPLETION_FACTS_INCOMPLETE',
          'Operation, gate and dock completion facts are incomplete',
          409,
        );
      const durations = this.durationValues(events, verification.observedAt);
      const overrunMinutes = Math.max(
        0,
        Math.floor(
          (exit.occurredAt.getTime() -
            appointment.requestedWindowTo.getTime()) /
            60_000,
        ),
      );
      const fact = await tx.appointmentCompletion.create({
        data: {
          actualQuantity: completed.quantity,
          actualQuantityUom: completed.quantityUom,
          appointmentId,
          checkedInAt: verification.observedAt,
          checkedOutAt: exit.occurredAt,
          controlSnapshot: json(exit.evidenceSnapshot),
          createdBy: context.accountId,
          departedAt: departed.occurredAt,
          dockAssignmentId: assignment.id,
          dockedAt: docked.occurredAt,
          operatingMinutes: durations.operatingMinutes,
          operationCompletedAt: completed.occurredAt,
          operationStartedAt: started.occurredAt,
          overrunMinutes,
          pausedMinutes: durations.pausedMinutes,
          performanceSnapshot: json({
            onTime: verification.arrivalClass === 'ON_TIME',
            overrun: overrunMinutes > 0,
            waitingMinutes: durations.waitingMinutes,
          }),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
          waitingMinutes: durations.waitingMinutes,
          workloadSnapshot: json({
            laborHours: appointment.workloadLaborHours.toString(),
            pallets: appointment.workloadPallets.toString(),
            quantity: appointment.workloadQuantity.toString(),
            quantityUom: appointment.workloadQuantityUom,
            vehicles: appointment.workloadVehicles.toString(),
          }),
        },
      });
      const reservation = await tx.appointmentCapacityReservation.findFirst({
        where: { appointmentId, status: 'ACTIVE', tenantId: context.tenantId },
      });
      if (reservation) {
        const slot = await tx.timeSlot.findFirst({
          where: { id: reservation.timeSlotId, tenantId: context.tenantId },
        });
        if (!slot) throw this.conflict('AMS_TIME_SLOT_VERSION_CONFLICT');
        const used = reservation.allocationType === 'USED';
        const released = await tx.timeSlot.updateMany({
          data: used
            ? {
                updatedBy: context.accountId,
                usedLaborHours: { decrement: reservation.laborHours },
                usedPallets: { decrement: reservation.pallets },
                usedQuantity: { decrement: reservation.quantity },
                usedVehicles: { decrement: reservation.vehicles },
                version: { increment: 1 },
              }
            : {
                reservedLaborHours: { decrement: reservation.laborHours },
                reservedPallets: { decrement: reservation.pallets },
                reservedQuantity: { decrement: reservation.quantity },
                reservedVehicles: { decrement: reservation.vehicles },
                updatedBy: context.accountId,
                version: { increment: 1 },
              },
          where: {
            id: slot.id,
            tenantId: context.tenantId,
            version: slot.version,
          },
        });
        if (released.count !== 1)
          throw this.conflict('AMS_TIME_SLOT_VERSION_CONFLICT');
        await tx.appointmentCapacityReservation.update({
          data: {
            releasedAt: exit.occurredAt,
            releaseReason: 'COMPLETED',
            status: 'RELEASED',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: reservation.id },
        });
      }
      const changed = await tx.appointment.update({
        data: {
          status: 'COMPLETED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: appointmentId },
      });
      await this.emit(
        tx,
        appointmentId,
        changed.version,
        'appointment.completed.v1',
        context,
        metadata,
        {
          actualTimes: {
            checkedInAt: verification.observedAt.toISOString(),
            checkedOutAt: exit.occurredAt.toISOString(),
            completedAt: completed.occurredAt.toISOString(),
            dockedAt: docked.occurredAt.toISOString(),
            startedAt: started.occurredAt.toISOString(),
          },
          appointmentCompletionId: fact.id,
          appointmentId,
          capacityReservationId: reservation?.id ?? null,
          noShow: false,
          overrun: overrunMinutes > 0,
          workload: {
            actualQuantity: completed.quantity.toString(),
            actualQuantityUom: completed.quantityUom,
            operatingMinutes: durations.operatingMinutes,
            pausedMinutes: durations.pausedMinutes,
            waitingMinutes: durations.waitingMinutes,
          },
        },
        'Appointment',
      );
      return toHttpJson({
        appointmentCompletionId: fact.id,
        appointmentId,
        operatingMinutes: fact.operatingMinutes,
        overrunMinutes,
        pausedMinutes: fact.pausedMinutes,
        status: changed.status,
        version: changed.version,
        waitingMinutes: fact.waitingMinutes,
      });
    });
  }

  markNoShow(
    appointmentId: string,
    input: {
      contractSnapshot: Readonly<Record<string, unknown>>;
      expectedVersion: number;
      graceMinutes: number;
      notificationSnapshot: Readonly<Record<string, unknown>>;
      observedAt: string;
      penalty: { amount: string; currency: string; shouldCharge: boolean };
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(appointmentId, 'appointmentId');
    if (
      !Number.isInteger(input.graceMinutes) ||
      input.graceMinutes < 0 ||
      !input.reason?.trim() ||
      !/^[A-Z]{3}$/.test(input.penalty.currency)
    )
      this.invalid('No-show policy input is invalid');
    const observedAt = this.date(input.observedAt);
    const amount = this.decimal(input.penalty.amount);
    if (amount.isNegative()) this.invalid('Penalty amount cannot be negative');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${appointmentId}:appointment`);
      const appointment = await tx.appointment.findFirst({
        where: {
          id: appointmentId,
          status: 'CONFIRMED',
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (!appointment) throw this.conflict('AMS_APPOINTMENT_VERSION_CONFLICT');
      if (
        observedAt.getTime() <=
        appointment.requestedWindowTo.getTime() + input.graceMinutes * 60_000
      )
        throw new AppError(
          'AMS_NO_SHOW_GRACE_ACTIVE',
          'Appointment is still inside the no-show grace period',
          409,
        );
      const passed = await tx.gateVerification.count({
        where: { appointmentId, status: 'PASSED', tenantId: context.tenantId },
      });
      if (passed)
        throw new AppError(
          'AMS_NO_SHOW_CHECKED_IN',
          'Checked-in appointment cannot be marked no-show',
          409,
        );
      const reservation = await tx.appointmentCapacityReservation.findFirst({
        where: { appointmentId, status: 'ACTIVE', tenantId: context.tenantId },
      });
      if (!reservation)
        throw this.conflict('AMS_APPOINTMENT_RESERVATION_CONFLICT');
      const slot = await tx.timeSlot.findFirst({
        where: { id: reservation.timeSlotId, tenantId: context.tenantId },
      });
      if (!slot) throw this.conflict('AMS_TIME_SLOT_VERSION_CONFLICT');
      const used = reservation.allocationType === 'USED';
      const released = await tx.timeSlot.updateMany({
        data: used
          ? {
              updatedBy: context.accountId,
              usedLaborHours: { decrement: reservation.laborHours },
              usedPallets: { decrement: reservation.pallets },
              usedQuantity: { decrement: reservation.quantity },
              usedVehicles: { decrement: reservation.vehicles },
              version: { increment: 1 },
            }
          : {
              reservedLaborHours: { decrement: reservation.laborHours },
              reservedPallets: { decrement: reservation.pallets },
              reservedQuantity: { decrement: reservation.quantity },
              reservedVehicles: { decrement: reservation.vehicles },
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
        where: {
          id: slot.id,
          tenantId: context.tenantId,
          version: slot.version,
        },
      });
      if (released.count !== 1)
        throw this.conflict('AMS_TIME_SLOT_VERSION_CONFLICT');
      await tx.appointmentCapacityReservation.update({
        data: {
          releasedAt: observedAt,
          releaseReason: `NO_SHOW: ${input.reason.trim()}`,
          status: 'RELEASED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: reservation.id },
      });
      await tx.reminderSchedule.updateMany({
        data: {
          cancelReason: 'Appointment marked no-show',
          cancelledAt: observedAt,
          status: 'CANCELLED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          appointmentId,
          status: 'SCHEDULED',
          tenantId: context.tenantId,
        },
      });
      const noShow = await tx.noShowCase.create({
        data: {
          appointmentId,
          capacityWasteSnapshot: json({
            laborHours: reservation.laborHours.toString(),
            pallets: reservation.pallets.toString(),
            quantity: reservation.quantity.toString(),
            timeSlotId: reservation.timeSlotId,
            vehicles: reservation.vehicles.toString(),
          }),
          contractSnapshot: json(input.contractSnapshot),
          createdBy: context.accountId,
          detectedAt: observedAt,
          graceMinutes: input.graceMinutes,
          notificationSnapshot: json(input.notificationSnapshot),
          reason: input.reason.trim(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const penalty = input.penalty.shouldCharge
        ? await tx.penaltyChargeFact.create({
            data: {
              amount,
              appointmentId,
              calculationTrace: json({
                contractSnapshot: input.contractSnapshot,
                graceMinutes: input.graceMinutes,
                policy: 'NO_SHOW',
              }),
              createdBy: context.accountId,
              currency: input.penalty.currency,
              noShowCaseId: noShow.id,
              reason: input.reason.trim(),
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          })
        : null;
      const changed = await tx.appointment.update({
        data: {
          status: 'NO_SHOW',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: appointmentId },
      });
      await this.emit(
        tx,
        appointmentId,
        changed.version,
        'appointment.completed.v1',
        context,
        metadata,
        {
          actualTimes: { noShowDetectedAt: observedAt.toISOString() },
          appointmentId,
          capacityWaste: noShow.capacityWasteSnapshot,
          noShow: true,
          noShowCaseId: noShow.id,
          penaltyChargeFactId: penalty?.id ?? null,
          workload: null,
        },
        'Appointment',
      );
      return toHttpJson({
        appointmentId,
        noShowCaseId: noShow.id,
        penaltyAmount: penalty?.amount ?? 0,
        penaltyChargeFactId: penalty?.id ?? null,
        penaltyCurrency: input.penalty.currency,
        status: changed.status,
        version: changed.version,
      });
    });
  }

  appeal(
    noShowCaseId: string,
    input: {
      evidenceSnapshot: Readonly<Record<string, unknown>>;
      expectedVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(noShowCaseId, 'noShowCaseId');
    if (!input.reason?.trim()) this.invalid('Appeal reason is required');
    return this.prisma.$transaction(async (tx) => {
      const noShow = await tx.noShowCase.findFirst({
        where: {
          id: noShowCaseId,
          status: 'OPEN',
          tenantId: context.tenantId,
          version: input.expectedVersion,
        },
      });
      if (!noShow) throw this.conflict('AMS_NO_SHOW_CASE_VERSION_CONFLICT');
      const appeal = await tx.noShowAppeal.create({
        data: {
          appointmentId: noShow.appointmentId,
          createdBy: context.accountId,
          evidenceSnapshot: json(input.evidenceSnapshot),
          noShowCaseId,
          reason: input.reason.trim(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const changed = await tx.noShowCase.update({
        data: {
          status: 'APPEALED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: noShowCaseId },
      });
      await this.emit(
        tx,
        appeal.id,
        appeal.version,
        'appointment.no-show-appealed.v1',
        context,
        metadata,
        {
          appealId: appeal.id,
          appointmentId: noShow.appointmentId,
          noShowCaseId,
        },
        'NoShowAppeal',
      );
      return {
        appealId: appeal.id,
        noShowCaseId,
        status: changed.status,
        version: changed.version,
      };
    });
  }

  decideAppeal(
    appealId: string,
    input: {
      decision: 'WAIVED' | 'UPHELD';
      expectedCaseVersion: number;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(appealId, 'appealId');
    if (!['WAIVED', 'UPHELD'].includes(input.decision) || !input.reason?.trim())
      this.invalid('Appeal decision is invalid');
    return this.prisma.$transaction(async (tx) => {
      const appeal = await tx.noShowAppeal.findFirst({
        where: { id: appealId, tenantId: context.tenantId },
      });
      if (!appeal)
        throw new AppError(
          'AMS_NO_SHOW_APPEAL_NOT_FOUND',
          'No-show appeal was not found',
          404,
        );
      const noShow = await tx.noShowCase.findFirst({
        where: {
          id: appeal.noShowCaseId,
          status: 'APPEALED',
          tenantId: context.tenantId,
          version: input.expectedCaseVersion,
        },
      });
      if (!noShow) throw this.conflict('AMS_NO_SHOW_CASE_VERSION_CONFLICT');
      const penalty = await tx.penaltyChargeFact.findFirst({
        where: { noShowCaseId: noShow.id, tenantId: context.tenantId },
      });
      const originalAmount = penalty?.amount ?? new Prisma.Decimal(0);
      const currency = penalty?.currency ?? 'CNY';
      const decision = await tx.penaltyWaiverDecision.create({
        data: {
          appealId,
          createdBy: context.accountId,
          currency,
          decision: input.decision,
          effectiveAmount: input.decision === 'WAIVED' ? 0 : originalAmount,
          noShowCaseId: noShow.id,
          originalAmount,
          ...(penalty ? { penaltyChargeFactId: penalty.id } : {}),
          reason: input.reason.trim(),
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      });
      const changed = await tx.noShowCase.update({
        data: {
          status: input.decision,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: noShow.id },
      });
      await this.emit(
        tx,
        decision.id,
        decision.version,
        'appointment.penalty-decided.v1',
        context,
        metadata,
        {
          appealId,
          appointmentId: noShow.appointmentId,
          decision: input.decision,
          effectiveAmount: decision.effectiveAmount.toString(),
          noShowCaseId: noShow.id,
        },
        'PenaltyWaiverDecision',
      );
      return toHttpJson({
        decision: input.decision,
        decisionId: decision.id,
        effectiveAmount: decision.effectiveAmount,
        noShowCaseId: noShow.id,
        status: changed.status,
        version: changed.version,
      });
    });
  }

  private async durations(
    tx: Prisma.TransactionClient,
    appointmentId: string,
    tenantId: string,
  ) {
    const events = await tx.operationEvent.findMany({
      orderBy: { sequence: 'asc' },
      where: { appointmentId, tenantId },
    });
    const verification = await tx.gateVerification.findFirst({
      orderBy: { observedAt: 'asc' },
      where: { appointmentId, status: 'PASSED', tenantId },
    });
    return this.durationValues(events, verification?.observedAt);
  }
  private durationValues(
    events: readonly { eventType: string; occurredAt: Date }[],
    checkedInAt?: Date,
  ) {
    const started = events.find(
      ({ eventType }) => eventType === 'STARTED',
    )?.occurredAt;
    const completed = events.find(
      ({ eventType }) => eventType === 'COMPLETED',
    )?.occurredAt;
    let pausedMs = 0;
    let pauseStart: Date | undefined;
    for (const event of events) {
      if (event.eventType === 'PAUSED') pauseStart = event.occurredAt;
      if (event.eventType === 'RESUMED' && pauseStart) {
        pausedMs += event.occurredAt.getTime() - pauseStart.getTime();
        pauseStart = undefined;
      }
    }
    if (completed && pauseStart)
      pausedMs += completed.getTime() - pauseStart.getTime();
    return {
      operatingMinutes:
        started && completed
          ? Math.max(
              0,
              Math.floor(
                (completed.getTime() - started.getTime() - pausedMs) / 60_000,
              ),
            )
          : 0,
      pausedMinutes: Math.max(0, Math.floor(pausedMs / 60_000)),
      waitingMinutes:
        checkedInAt && started
          ? Math.max(
              0,
              Math.floor((started.getTime() - checkedInAt.getTime()) / 60_000),
            )
          : 0,
    };
  }
  private decimal(value: string) {
    try {
      return new Prisma.Decimal(value);
    } catch {
      this.invalid('Decimal value is invalid');
    }
  }
  private date(value: string) {
    const result = new Date(value);
    if (!value || Number.isNaN(result.getTime()))
      this.invalid('Date is invalid');
    return result;
  }
  private uuid(value: string, field: string) {
    if (!isUuid(value)) this.invalid(`${field} is invalid`);
  }
  private invalid(message: string): never {
    throw new AppError('AMS_OPERATION_INPUT_INVALID', message, 400);
  }
  private conflict(code: string) {
    return new AppError(code, 'Resource version or state changed', 409, {
      retryable: true,
    });
  }
  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
  }
  private async emit(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    eventName: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: Prisma.InputJsonObject,
    aggregateType: string,
  ) {
    await Promise.all([
      tx.platformAuditLog.create({
        data: {
          action: eventName,
          after: payload,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: id,
          resourceType: aggregateType,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType,
          aggregateVersion: version,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName,
          partitionKey: id,
          payload: { ...payload, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
}
