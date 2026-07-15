import { randomUUID } from 'node:crypto';
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

interface WorkloadInput {
  laborHours: string;
  pallets: string;
  quantity: string;
  quantityUom: string;
  vehicles: string;
  workloadEstimateId?: string;
}

interface OrderLinkInput {
  bookableQuantityBase: string;
  packageSpecSnapshot: Readonly<Record<string, unknown>>;
  quantity: string;
  quantityBase: string;
  quantityBaseUom: string;
  quantityUom: string;
  sourceLineRef: string;
  sourceRef: string;
  sourceSnapshot: Readonly<Record<string, unknown>>;
  sourceType: string;
}

interface AppointmentDraftInput {
  approvalPolicy: {
    customerRequiresApproval: boolean;
    requiresApprovalServiceTypes: readonly string[];
  };
  orderLinks: readonly OrderLinkInput[];
  requesterPartyRef: string;
  requesterSnapshot: Readonly<Record<string, unknown>>;
  requestedWindowFrom: string;
  requestedWindowTo: string;
  serviceType: string;
  timeSlotId: string;
  type: 'ORDER_LINKED' | 'UNLINKED';
  urgent: boolean;
  vehicleSnapshot: Readonly<Record<string, unknown>>;
  warehouseRef: string;
  workload: WorkloadInput;
}

@Injectable()
export class AppointmentIntakeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const [appointments, orderLinks, reservations, decisions, recurring, occurrences, reschedules, cancellations, reminders] =
      await Promise.all([
        this.prisma.appointment.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 300, where }),
        this.prisma.amsAppointmentOrderLink.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500, where }),
        this.prisma.appointmentCapacityReservation.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 300, where }),
        this.prisma.appointmentDecision.findMany({ orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 500, where }),
        this.prisma.recurringAppointment.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, where }),
        this.prisma.appointmentOccurrence.findMany({ orderBy: [{ occurrenceDate: 'asc' }, { id: 'asc' }], take: 500, where }),
        this.prisma.rescheduleRecord.findMany({ orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 300, where }),
        this.prisma.appointmentCancellation.findMany({ orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 300, where }),
        this.prisma.reminderSchedule.findMany({ orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: 300, where }),
      ]);
    return toHttpJson({ appointments, cancellations, decisions, occurrences, orderLinks, recurring, reminders, reschedules, reservations });
  }

  async availability(
    query: {
      from: string;
      requesterPartyRef: string;
      serviceType: string;
      to: string;
      warehouseRef: string;
      workloadLaborHours: string;
      workloadPallets: string;
      workloadQuantity: string;
      workloadVehicles: string;
    },
    context: TenantContext,
  ) {
    this.uuid(query.warehouseRef, 'warehouseRef');
    const from = this.date(query.from);
    const to = this.date(query.to);
    if (to <= from || !query.requesterPartyRef?.trim())
      this.invalid('Availability range or requester is invalid');
    const workload = this.workload({
      laborHours: query.workloadLaborHours,
      pallets: query.workloadPallets,
      quantity: query.workloadQuantity,
      quantityUom: 'BASE',
      vehicles: query.workloadVehicles,
    });
    const slots = await this.prisma.timeSlot.findMany({
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: 100,
      where: {
        endsAt: { lte: to },
        serviceType: query.serviceType.trim().toUpperCase(),
        startsAt: { gte: from },
        status: 'OPEN',
        tenantId: context.tenantId,
        warehouseRef: query.warehouseRef,
      },
    });
    return toHttpJson({
      items: slots
        .map((slot) => ({
          endsAt: slot.endsAt,
          remaining: {
            laborHours: slot.capacityLaborHours.sub(slot.internalLaborHours).sub(slot.usedLaborHours).sub(slot.reservedLaborHours),
            pallets: slot.capacityPallets.sub(slot.internalPallets).sub(slot.usedPallets).sub(slot.reservedPallets),
            quantity: slot.capacityQuantity.sub(slot.internalQuantity).sub(slot.usedQuantity).sub(slot.reservedQuantity),
            vehicles: slot.capacityVehicles.sub(slot.internalVehicles).sub(slot.usedVehicles).sub(slot.reservedVehicles),
          },
          slotId: slot.id,
          slotVersion: slot.version,
          startsAt: slot.startsAt,
        }))
        .filter(({ remaining }) =>
          remaining.quantity.gte(workload.quantity) &&
          remaining.pallets.gte(workload.pallets) &&
          remaining.vehicles.gte(workload.vehicles) &&
          remaining.laborHours.gte(workload.laborHours),
        ),
      requesterPartyRef: query.requesterPartyRef,
      snapshotAt: new Date().toISOString(),
    });
  }

  saveDraft(
    input: AppointmentDraftInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const validated = await this.validateDraft(tx, input, context);
      const appointment = await this.createDraftRecord(tx, input, validated, context);
      await this.emit(tx, appointment.id, appointment.version, 'appointment.draft-saved.v1', context, metadata, { appointmentId: appointment.id, appointmentNo: appointment.appointmentNo, type: appointment.type }, 'Appointment');
      return { appointmentId: appointment.id, status: appointment.status, version: appointment.version };
    });
  }

  async createAndSubmit(
    input: AppointmentDraftInput & { slotVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const validated = await this.validateDraft(tx, input, context);
      const appointment = await this.createDraftRecord(tx, input, validated, context);
      return this.submitInTransaction(tx, appointment.id, { expectedVersion: appointment.version, slotVersion: input.slotVersion }, context, metadata);
    });
  }

  submit(
    id: string,
    input: { expectedVersion: number; slotVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'appointmentId');
    return this.prisma.$transaction((tx) =>
      this.submitInTransaction(tx, id, input, context, metadata),
    );
  }

  decide(
    id: string,
    input: {
      decision: 'APPROVE' | 'REJECT' | 'SUGGEST_RESCHEDULE';
      expectedVersion: number;
      reason: string;
      suggestedTimeSlotId?: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'appointmentId');
    if (!input.reason?.trim()) this.invalid('Approval decision reason is required');
    if (input.decision === 'SUGGEST_RESCHEDULE' && !input.suggestedTimeSlotId)
      this.invalid('Suggested slot is required');
    if (input.suggestedTimeSlotId) this.uuid(input.suggestedTimeSlotId, 'suggestedTimeSlotId');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${id}:appointment`);
      const appointment = await tx.appointment.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!appointment || appointment.status !== 'PENDING' || appointment.version !== input.expectedVersion)
        throw this.conflict('AMS_APPOINTMENT_VERSION_CONFLICT');
      const reservation = await tx.appointmentCapacityReservation.findFirst({ where: { appointmentId: id, status: 'ACTIVE', tenantId: context.tenantId } });
      if (!reservation || reservation.allocationType !== 'RESERVED')
        throw this.conflict('AMS_APPOINTMENT_RESERVATION_CONFLICT');
      if (input.decision === 'SUGGEST_RESCHEDULE') {
        const candidate = await tx.timeSlot.findFirst({ where: { ...(input.suggestedTimeSlotId ? { id: input.suggestedTimeSlotId } : {}), serviceType: appointment.serviceType, status: 'OPEN', tenantId: context.tenantId, warehouseRef: appointment.warehouseRef } });
        if (!candidate) throw new AppError('AMS_SUGGESTED_SLOT_INVALID', 'Suggested slot is unavailable', 409);
        await this.recordDecision(tx, appointment, 'PENDING', input.decision, input.reason, context, input.suggestedTimeSlotId);
        await this.emit(tx, id, appointment.version, 'appointment.reschedule-suggested.v1', context, metadata, { appointmentId: id, suggestedTimeSlotId: input.suggestedTimeSlotId }, 'Appointment');
        return { appointmentId: id, status: appointment.status, suggestedTimeSlotId: input.suggestedTimeSlotId, version: appointment.version };
      }
      await this.lock(tx, `${context.tenantId}:${reservation.timeSlotId}:slot-allocation`);
      const slot = await tx.timeSlot.findFirst({ where: { id: reservation.timeSlotId, tenantId: context.tenantId } });
      if (!slot) throw this.conflict('AMS_TIME_SLOT_VERSION_CONFLICT');
      if (input.decision === 'APPROVE') {
        const changed = await tx.timeSlot.updateMany({
          data: {
            reservedLaborHours: { decrement: reservation.laborHours },
            reservedPallets: { decrement: reservation.pallets },
            reservedQuantity: { decrement: reservation.quantity },
            reservedVehicles: { decrement: reservation.vehicles },
            updatedBy: context.accountId,
            usedLaborHours: { increment: reservation.laborHours },
            usedPallets: { increment: reservation.pallets },
            usedQuantity: { increment: reservation.quantity },
            usedVehicles: { increment: reservation.vehicles },
            version: { increment: 1 },
          },
          where: { id: slot.id, reservedLaborHours: { gte: reservation.laborHours }, reservedPallets: { gte: reservation.pallets }, reservedQuantity: { gte: reservation.quantity }, reservedVehicles: { gte: reservation.vehicles }, tenantId: context.tenantId, version: slot.version },
        });
        if (changed.count !== 1) throw this.conflict('AMS_TIME_SLOT_VERSION_CONFLICT');
        await tx.appointmentCapacityReservation.update({ data: { allocationType: 'USED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: reservation.id } });
      } else {
        const released = await tx.timeSlot.updateMany({
          data: { reservedLaborHours: { decrement: reservation.laborHours }, reservedPallets: { decrement: reservation.pallets }, reservedQuantity: { decrement: reservation.quantity }, reservedVehicles: { decrement: reservation.vehicles }, updatedBy: context.accountId, version: { increment: 1 } },
          where: { id: slot.id, reservedLaborHours: { gte: reservation.laborHours }, reservedPallets: { gte: reservation.pallets }, reservedQuantity: { gte: reservation.quantity }, reservedVehicles: { gte: reservation.vehicles }, tenantId: context.tenantId, version: slot.version },
        });
        if (released.count !== 1) throw this.conflict('AMS_TIME_SLOT_VERSION_CONFLICT');
        await tx.appointmentCapacityReservation.update({ data: { releaseReason: input.reason.trim(), releasedAt: new Date(), status: 'RELEASED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: reservation.id } });
      }
      const next = input.decision === 'APPROVE' ? 'CONFIRMED' : 'REJECTED';
      const changed = await tx.appointment.update({ data: { decidedAt: new Date(), status: next, updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      await this.recordDecision(tx, appointment, next, input.decision, input.reason, context);
      await this.emit(tx, id, changed.version, next === 'CONFIRMED' ? 'appointment.confirmed.v1' : 'appointment.rejected.v1', context, metadata, { appointmentId: id, orderLinks: await this.eventOrderLinks(tx, id, context.tenantId), slot: { timeSlotId: appointment.timeSlotId }, vehicle: appointment.vehicleSnapshot }, 'Appointment');
      return { appointmentId: id, status: changed.status, version: changed.version };
    });
  }

  reschedule(
    id: string,
    input: {
      expectedVersion: number;
      newRequestedWindowFrom: string;
      newRequestedWindowTo: string;
      newSlotVersion: number;
      newTimeSlotId: string;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'appointmentId');
    this.uuid(input.newTimeSlotId, 'newTimeSlotId');
    if (!input.reason?.trim()) this.invalid('Reschedule reason is required');
    const newWindowFrom = this.date(input.newRequestedWindowFrom);
    const newWindowTo = this.date(input.newRequestedWindowTo);
    if (newWindowTo <= newWindowFrom) this.invalid('New requested window is invalid');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${id}:appointment`);
      const appointment = await tx.appointment.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!appointment || appointment.status !== 'CONFIRMED' || appointment.version !== input.expectedVersion)
        throw this.conflict('AMS_APPOINTMENT_VERSION_CONFLICT');
      if (appointment.timeSlotId === input.newTimeSlotId)
        this.invalid('New slot must differ from current slot');
      const oldReservation = await tx.appointmentCapacityReservation.findFirst({ where: { allocationType: 'USED', appointmentId: id, status: 'ACTIVE', tenantId: context.tenantId } });
      if (!oldReservation) throw this.conflict('AMS_APPOINTMENT_RESERVATION_CONFLICT');
      const newSlot = await tx.timeSlot.findFirst({ where: { id: input.newTimeSlotId, serviceType: appointment.serviceType, status: 'OPEN', tenantId: context.tenantId, warehouseRef: appointment.warehouseRef } });
      if (!newSlot || newSlot.startsAt < newWindowFrom || newSlot.endsAt > newWindowTo)
        throw new AppError('AMS_RESCHEDULE_SLOT_INVALID', 'New slot does not match appointment constraints', 409);
      const workload = { laborHours: oldReservation.laborHours, pallets: oldReservation.pallets, quantity: oldReservation.quantity, vehicles: oldReservation.vehicles };
      const newClaim = await this.claimCapacity(tx, newSlot.id, input.newSlotVersion, workload, 'USED', context);
      if (!newClaim) {
        const candidates = await this.candidates(tx, { ...appointment, requestedWindowFrom: newWindowFrom, requestedWindowTo: newWindowTo, timeSlotId: input.newTimeSlotId }, context);
        throw new AppError('AMS_RESCHEDULE_CAPACITY_CONFLICT', 'New slot could not be reserved; original appointment remains unchanged', 409, { fieldErrors: candidates.map((candidate) => ({ field: 'newTimeSlotId', message: JSON.stringify(candidate) })), retryable: true });
      }
      const oldSlot = await tx.timeSlot.findFirst({ where: { id: appointment.timeSlotId, tenantId: context.tenantId } });
      if (!oldSlot) throw this.conflict('AMS_RESCHEDULE_OLD_SLOT_CONFLICT');
      const released = await tx.timeSlot.updateMany({
        data: { updatedBy: context.accountId, usedLaborHours: { decrement: oldReservation.laborHours }, usedPallets: { decrement: oldReservation.pallets }, usedQuantity: { decrement: oldReservation.quantity }, usedVehicles: { decrement: oldReservation.vehicles }, version: { increment: 1 } },
        where: { id: oldSlot.id, tenantId: context.tenantId, usedLaborHours: { gte: oldReservation.laborHours }, usedPallets: { gte: oldReservation.pallets }, usedQuantity: { gte: oldReservation.quantity }, usedVehicles: { gte: oldReservation.vehicles }, version: oldSlot.version },
      });
      if (released.count !== 1) throw this.conflict('AMS_RESCHEDULE_OLD_SLOT_CONFLICT');
      await tx.appointmentCapacityReservation.update({ data: { releaseReason: `RESCHEDULE: ${input.reason.trim()}`, releasedAt: new Date(), status: 'RELEASED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: oldReservation.id } });
      const newReservation = await tx.appointmentCapacityReservation.create({ data: { allocationType: 'USED', appointmentId: id, createdBy: context.accountId, laborHours: workload.laborHours, pallets: workload.pallets, quantity: workload.quantity, slotVersionAtReserve: newClaim.version, tenantId: context.tenantId, timeSlotId: newSlot.id, updatedBy: context.accountId, vehicles: workload.vehicles } });
      const changed = await tx.appointment.update({ data: { requestedWindowFrom: newWindowFrom, requestedWindowTo: newWindowTo, timeSlotId: newSlot.id, updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      const sequence = await tx.rescheduleRecord.count({ where: { appointmentId: id, tenantId: context.tenantId } }) + 1;
      const record = await tx.rescheduleRecord.create({ data: { appointmentId: id, createdBy: context.accountId, newReservationId: newReservation.id, newSlotVersion: newClaim.version, newTimeSlotId: newSlot.id, oldReservationId: oldReservation.id, oldSlotVersion: oldSlot.version, oldTimeSlotId: oldSlot.id, reason: input.reason.trim(), sequence, tenantId: context.tenantId, updatedBy: context.accountId, workloadSnapshot: json({ laborHours: workload.laborHours.toString(), pallets: workload.pallets.toString(), quantity: workload.quantity.toString(), vehicles: workload.vehicles.toString() }) } });
      await this.emit(tx, id, changed.version, 'appointment.rescheduled.v1', context, metadata, { appointmentId: id, newTimeSlotId: newSlot.id, oldTimeSlotId: oldSlot.id, rescheduleRecordId: record.id }, 'Appointment');
      return { appointmentId: id, rescheduleRecordId: record.id, status: changed.status, timeSlotId: changed.timeSlotId, version: changed.version };
    });
  }

  cancel(
    id: string,
    input: {
      allowWithinLead: boolean;
      cancellationLeadMinutes: number;
      expectedVersion: number;
      feeAmountWithinLead: string;
      feeCurrency: string;
      notificationSnapshot: Readonly<Record<string, unknown>>;
      policySnapshot: Readonly<Record<string, unknown>>;
      reason: string;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'appointmentId');
    if (!input.reason?.trim() || !Number.isInteger(input.cancellationLeadMinutes) || input.cancellationLeadMinutes < 0 || !/^[A-Z]{3}$/.test(input.feeCurrency))
      this.invalid('Cancellation reason, lead time or currency is invalid');
    const feeWithinLead = this.decimal(input.feeAmountWithinLead);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${id}:appointment`);
      const appointment = await tx.appointment.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!appointment || appointment.status !== 'CONFIRMED' || appointment.version !== input.expectedVersion)
        throw this.conflict('AMS_APPOINTMENT_VERSION_CONFLICT');
      const now = new Date();
      const minutesUntil = Math.floor((appointment.requestedWindowFrom.getTime() - now.getTime()) / 60_000);
      const withinLead = minutesUntil < input.cancellationLeadMinutes;
      if (withinLead && !input.allowWithinLead)
        throw new AppError('AMS_CANCELLATION_LEAD_TIME_BLOCKED', 'Cancellation is not allowed inside the policy lead time', 409);
      const reservation = await tx.appointmentCapacityReservation.findFirst({ where: { appointmentId: id, status: 'ACTIVE', tenantId: context.tenantId } });
      if (!reservation) throw this.conflict('AMS_APPOINTMENT_RESERVATION_CONFLICT');
      const slot = await tx.timeSlot.findFirst({ where: { id: reservation.timeSlotId, tenantId: context.tenantId } });
      if (!slot) throw this.conflict('AMS_TIME_SLOT_VERSION_CONFLICT');
      const used = reservation.allocationType === 'USED';
      const released = await tx.timeSlot.updateMany({
        data: used
          ? { updatedBy: context.accountId, usedLaborHours: { decrement: reservation.laborHours }, usedPallets: { decrement: reservation.pallets }, usedQuantity: { decrement: reservation.quantity }, usedVehicles: { decrement: reservation.vehicles }, version: { increment: 1 } }
          : { reservedLaborHours: { decrement: reservation.laborHours }, reservedPallets: { decrement: reservation.pallets }, reservedQuantity: { decrement: reservation.quantity }, reservedVehicles: { decrement: reservation.vehicles }, updatedBy: context.accountId, version: { increment: 1 } },
        where: { id: slot.id, tenantId: context.tenantId, version: slot.version },
      });
      if (released.count !== 1) throw this.conflict('AMS_TIME_SLOT_VERSION_CONFLICT');
      await tx.appointmentCapacityReservation.update({ data: { releaseReason: `CANCEL: ${input.reason.trim()}`, releasedAt: now, status: 'RELEASED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: reservation.id } });
      await tx.reminderSchedule.updateMany({ data: { cancelReason: 'Appointment cancelled', cancelledAt: now, status: 'CANCELLED', updatedBy: context.accountId, version: { increment: 1 } }, where: { appointmentId: id, status: 'SCHEDULED', tenantId: context.tenantId } });
      const changed = await tx.appointment.update({ data: { status: 'CANCELLED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      await this.recordDecision(tx, appointment, 'CANCELLED', 'CANCEL', input.reason, context);
      const cancellation = await tx.appointmentCancellation.create({ data: { appointmentId: id, createdBy: context.accountId, feeAmount: withinLead ? feeWithinLead : 0, feeCurrency: input.feeCurrency, leadMinutes: input.cancellationLeadMinutes, notificationSnapshot: json(input.notificationSnapshot), policySnapshot: json({ ...input.policySnapshot, allowWithinLead: input.allowWithinLead, withinLead }), reason: input.reason.trim(), requestedAt: now, reservationId: reservation.id, tenantId: context.tenantId, updatedBy: context.accountId } });
      await this.emit(tx, id, changed.version, 'appointment.cancelled.v1', context, metadata, { appointmentId: id, cancellationId: cancellation.id, fee: { amount: cancellation.feeAmount.toString(), currency: cancellation.feeCurrency }, notify: ['OMS', 'TMS', 'GATE'], timeSlotId: slot.id }, 'Appointment');
      return toHttpJson({ appointmentId: id, cancellationId: cancellation.id, feeAmount: cancellation.feeAmount, feeCurrency: cancellation.feeCurrency, status: changed.status, version: changed.version });
    });
  }

  scheduleReminders(
    id: string,
    input: {
      expectedVersion: number;
      preparationSnapshot: Readonly<Record<string, unknown>>;
      reminders: readonly { channel: string; leadMinutes: number; reminderType: string }[];
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'appointmentId');
    if (!input.reminders.length || input.reminders.some(({ channel, leadMinutes, reminderType }) => !channel?.trim() || !reminderType?.trim() || !Number.isInteger(leadMinutes) || leadMinutes < 0))
      this.invalid('Reminder rules are invalid');
    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!appointment || appointment.status !== 'CONFIRMED' || appointment.version !== input.expectedVersion)
        throw this.conflict('AMS_APPOINTMENT_VERSION_CONFLICT');
      const schedules = [];
      for (const reminder of input.reminders) {
        const scheduledAt = new Date(appointment.requestedWindowFrom.getTime() - reminder.leadMinutes * 60_000);
        const dispatchKey = `${id}:${reminder.reminderType.trim().toUpperCase()}:${scheduledAt.toISOString()}`;
        const schedule = await tx.reminderSchedule.upsert({
          create: { appointmentId: id, channel: reminder.channel.trim().toUpperCase(), createdBy: context.accountId, dispatchKey, payloadSnapshot: json({ appointmentNo: appointment.appointmentNo, preparation: input.preparationSnapshot, qrCode: `APT:${id}:${randomUUID()}`, requestedWindow: { from: appointment.requestedWindowFrom, to: appointment.requestedWindowTo }, serviceType: appointment.serviceType, vehicle: appointment.vehicleSnapshot, warehouseRef: appointment.warehouseRef }), reminderType: reminder.reminderType.trim().toUpperCase(), scheduledAt, tenantId: context.tenantId, updatedBy: context.accountId },
          update: {},
          where: { tenantId_dispatchKey: { dispatchKey, tenantId: context.tenantId } },
        });
        schedules.push(schedule);
      }
      await this.emit(tx, id, appointment.version, 'appointment.reminders-scheduled.v1', context, metadata, { appointmentId: id, reminderScheduleIds: schedules.map(({ id: scheduleId }) => scheduleId) }, 'Appointment');
      return { appointmentId: id, reminderScheduleIds: schedules.map(({ id: scheduleId }) => scheduleId), status: 'SCHEDULED' as const, version: appointment.version };
    });
  }

  sendReminder(
    id: string,
    input: { expectedVersion: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'reminderScheduleId');
    return this.prisma.$transaction(async (tx) => {
      const schedule = await tx.reminderSchedule.findFirst({ where: { id, tenantId: context.tenantId } });
      if (!schedule || schedule.status !== 'SCHEDULED' || schedule.version !== input.expectedVersion)
        throw this.conflict('AMS_REMINDER_VERSION_CONFLICT');
      if (schedule.scheduledAt > new Date())
        throw new AppError('AMS_REMINDER_NOT_DUE', 'Reminder is not due yet', 409);
      const changed = await tx.reminderSchedule.update({ data: { sentAt: new Date(), status: 'SENT', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      await this.emit(tx, id, changed.version, 'notification.requested.v1', context, metadata, { appointmentId: schedule.appointmentId, channel: schedule.channel, dispatchKey: schedule.dispatchKey, payload: schedule.payloadSnapshot, reminderScheduleId: id }, 'ReminderSchedule');
      return { appointmentId: schedule.appointmentId, reminderScheduleId: id, status: changed.status, version: changed.version };
    });
  }

  async createRecurring(
    input: {
      effectiveFrom: string;
      effectiveUntil: string;
      intervalWeeks: number;
      requesterPartyRef: string;
      requesterSnapshot: Readonly<Record<string, unknown>>;
      serviceType: string;
      slotStartTime: string;
      vehicleSnapshot: Readonly<Record<string, unknown>>;
      warehouseRef: string;
      weekdays: readonly number[];
      workload: WorkloadInput;
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.warehouseRef, 'warehouseRef');
    const effectiveFrom = this.day(input.effectiveFrom);
    const effectiveUntil = this.day(input.effectiveUntil);
    const weekdays = [...new Set(input.weekdays)].sort();
    if (effectiveUntil < effectiveFrom || effectiveUntil.getTime() - effectiveFrom.getTime() > 366 * 86_400_000 || !Number.isInteger(input.intervalWeeks) || input.intervalWeeks < 1 || !weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.slotStartTime))
      this.invalid('Recurring appointment rule is invalid');
    const workload = this.workload(input.workload);
    const recurringId = randomUUID();
    const recurring = await this.prisma.recurringAppointment.create({
      data: { createdBy: context.accountId, effectiveFrom, effectiveUntil, id: recurringId, intervalWeeks: input.intervalWeeks, recurringNo: `REC-${Date.now()}-${recurringId.slice(0, 6)}`, requesterPartyRef: input.requesterPartyRef.trim(), requesterSnapshot: json(input.requesterSnapshot), serviceType: input.serviceType.trim().toUpperCase(), slotStartTime: input.slotStartTime, tenantId: context.tenantId, updatedBy: context.accountId, vehicleSnapshot: json(input.vehicleSnapshot), warehouseRef: input.warehouseRef, weekdays, workloadSnapshot: json({ laborHours: workload.laborHours.toString(), pallets: workload.pallets.toString(), quantity: workload.quantity.toString(), quantityUom: input.workload.quantityUom, vehicles: workload.vehicles.toString() }) },
    });
    let reserved = 0;
    let pending = 0;
    for (let date = effectiveFrom; date <= effectiveUntil; date = new Date(date.getTime() + 86_400_000)) {
      const week = Math.floor((date.getTime() - effectiveFrom.getTime()) / (7 * 86_400_000));
      if (!weekdays.includes(date.getUTCDay()) || week % input.intervalWeeks !== 0) continue;
      const occurrenceDate = new Date(date);
      const startsAt = new Date(`${date.toISOString().slice(0, 10)}T${input.slotStartTime}:00.000Z`);
      try {
        await this.prisma.$transaction(async (tx) => {
          const slot = await tx.timeSlot.findFirst({ where: { serviceType: recurring.serviceType, startsAt, status: 'OPEN', tenantId: context.tenantId, warehouseRef: recurring.warehouseRef } });
          if (!slot) throw new AppError('AMS_RECURRING_SLOT_UNAVAILABLE', 'Holiday or matching slot unavailable', 409);
          const appointmentId = randomUUID();
          const claimed = await this.claimCapacity(tx, slot.id, slot.version, workload, 'USED', context);
          if (!claimed) throw new AppError('AMS_RECURRING_CAPACITY_CONFLICT', 'Recurring occurrence capacity conflict', 409);
          const appointment = await tx.appointment.create({ data: { appointmentNo: `APT-${Date.now()}-${appointmentId.slice(0, 6)}`, approvalPolicySnapshot: { recurringAutoConfirm: true }, createdBy: context.accountId, decidedAt: new Date(), id: appointmentId, recurringAppointmentId: recurring.id, requestedWindowFrom: slot.startsAt, requestedWindowTo: slot.endsAt, requesterPartyRef: recurring.requesterPartyRef, requesterSnapshot: json(recurring.requesterSnapshot), serviceType: recurring.serviceType, status: 'CONFIRMED', submittedAt: new Date(), tenantId: context.tenantId, timeSlotId: slot.id, type: 'RECURRING', updatedBy: context.accountId, urgent: false, vehicleSnapshot: json(recurring.vehicleSnapshot), warehouseRef: recurring.warehouseRef, ...(input.workload.workloadEstimateId ? { workloadEstimateId: input.workload.workloadEstimateId } : {}), workloadLaborHours: workload.laborHours, workloadPallets: workload.pallets, workloadQuantity: workload.quantity, workloadQuantityUom: input.workload.quantityUom.trim().toUpperCase(), workloadVehicles: workload.vehicles } });
          await tx.appointmentCapacityReservation.create({ data: { allocationType: 'USED', appointmentId, createdBy: context.accountId, laborHours: workload.laborHours, pallets: workload.pallets, quantity: workload.quantity, slotVersionAtReserve: claimed.version, tenantId: context.tenantId, timeSlotId: slot.id, updatedBy: context.accountId, vehicles: workload.vehicles } });
          await tx.appointmentOccurrence.create({ data: { appointmentId, createdBy: context.accountId, occurrenceDate, recurringAppointmentId: recurring.id, status: 'RESERVED', tenantId: context.tenantId, timeSlotId: slot.id, updatedBy: context.accountId } });
          await this.recordDecision(tx, appointment, 'CONFIRMED', 'RECURRING_AUTO_CONFIRM', 'Recurring occurrence reserved', context);
        });
        reserved++;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        await this.prisma.appointmentOccurrence.create({ data: { conflictReason: error.code, createdBy: context.accountId, occurrenceDate, recurringAppointmentId: recurring.id, tenantId: context.tenantId, updatedBy: context.accountId } });
        pending++;
      }
    }
    await this.prisma.$transaction((tx) => this.emit(tx, recurring.id, recurring.version, 'appointment.recurring-created.v1', context, metadata, { pending, recurringAppointmentId: recurring.id, reserved }, 'RecurringAppointment'));
    return { pending, recurringAppointmentId: recurring.id, reserved, status: recurring.status, version: recurring.version };
  }

  private async validateDraft(tx: Prisma.TransactionClient, input: AppointmentDraftInput, context: TenantContext) {
    this.uuid(input.warehouseRef, 'warehouseRef');
    this.uuid(input.timeSlotId, 'timeSlotId');
    if (!input.requesterPartyRef?.trim() || !input.serviceType?.trim()) this.invalid('Requester and service type are required');
    if ((input.type === 'ORDER_LINKED' && input.orderLinks.length === 0) || (input.type === 'UNLINKED' && input.orderLinks.length > 0)) this.invalid('Order links do not match appointment type');
    if (input.type === 'UNLINKED' && !String(input.vehicleSnapshot.plateNumber ?? '').trim()) this.invalid('Unlinked appointment requires vehicle plate for on-site identity');
    const requestedWindowFrom = this.date(input.requestedWindowFrom);
    const requestedWindowTo = this.date(input.requestedWindowTo);
    if (requestedWindowTo <= requestedWindowFrom) this.invalid('Requested window is invalid');
    const workload = this.workload(input.workload);
    const slot = await tx.timeSlot.findFirst({ where: { id: input.timeSlotId, serviceType: input.serviceType.trim().toUpperCase(), status: 'OPEN', tenantId: context.tenantId, warehouseRef: input.warehouseRef } });
    if (!slot || slot.startsAt < requestedWindowFrom || slot.endsAt > requestedWindowTo) throw new AppError('AMS_APPOINTMENT_SLOT_INVALID', 'Slot does not match warehouse, service type or order window', 409);
    for (const link of input.orderLinks) {
      if (!link.sourceType?.trim() || !link.sourceRef?.trim() || !link.sourceLineRef?.trim()) this.invalid('Order source identity is required');
      const quantityBase = this.decimal(link.quantityBase, true);
      const bookable = this.decimal(link.bookableQuantityBase);
      if (quantityBase.gt(bookable)) this.invalid('Appointment quantity exceeds source bookable quantity');
      this.decimal(link.quantity, true);
    }
    return { requestedWindowFrom, requestedWindowTo, slot, workload };
  }

  private async createDraftRecord(tx: Prisma.TransactionClient, input: AppointmentDraftInput, validated: Awaited<ReturnType<AppointmentIntakeService['validateDraft']>>, context: TenantContext) {
    const id = randomUUID();
    const appointment = await tx.appointment.create({ data: { appointmentNo: `APT-${Date.now()}-${id.slice(0, 6)}`, approvalPolicySnapshot: json(input.approvalPolicy), createdBy: context.accountId, id, requestedWindowFrom: validated.requestedWindowFrom, requestedWindowTo: validated.requestedWindowTo, requesterPartyRef: input.requesterPartyRef.trim(), requesterSnapshot: json(input.requesterSnapshot), serviceType: input.serviceType.trim().toUpperCase(), tenantId: context.tenantId, timeSlotId: validated.slot.id, type: input.type, updatedBy: context.accountId, urgent: input.urgent, vehicleSnapshot: json(input.vehicleSnapshot), warehouseRef: input.warehouseRef, ...(input.workload.workloadEstimateId ? { workloadEstimateId: input.workload.workloadEstimateId } : {}), workloadLaborHours: validated.workload.laborHours, workloadPallets: validated.workload.pallets, workloadQuantity: validated.workload.quantity, workloadQuantityUom: input.workload.quantityUom.trim().toUpperCase(), workloadVehicles: validated.workload.vehicles } });
    for (const link of input.orderLinks)
      await tx.amsAppointmentOrderLink.create({ data: { appointmentId: id, bookableQuantityBase: this.decimal(link.bookableQuantityBase), createdBy: context.accountId, packageSpecSnapshot: json(link.packageSpecSnapshot), quantity: this.decimal(link.quantity, true), quantityBase: this.decimal(link.quantityBase, true), quantityBaseUom: link.quantityBaseUom.trim().toUpperCase(), quantityUom: link.quantityUom.trim().toUpperCase(), sourceLineRef: link.sourceLineRef.trim(), sourceRef: link.sourceRef.trim(), sourceSnapshot: json(link.sourceSnapshot), sourceType: link.sourceType.trim().toUpperCase(), tenantId: context.tenantId, updatedBy: context.accountId } });
    return appointment;
  }

  private async submitInTransaction(tx: Prisma.TransactionClient, id: string, input: { expectedVersion: number; slotVersion: number }, context: TenantContext, metadata: CommandMetadata) {
    await this.lock(tx, `${context.tenantId}:${id}:appointment`);
    const appointment = await tx.appointment.findFirst({ where: { id, tenantId: context.tenantId } });
    if (!appointment || appointment.status !== 'DRAFT' || appointment.version !== input.expectedVersion) throw this.conflict('AMS_APPOINTMENT_VERSION_CONFLICT');
    const links = await tx.amsAppointmentOrderLink.findMany({ where: { appointmentId: id, tenantId: context.tenantId } });
    for (const link of links) {
      await this.lock(tx, `${context.tenantId}:${link.sourceType}:${link.sourceRef}:${link.sourceLineRef}`);
      const totals = await tx.$queryRaw<Array<{ total: Prisma.Decimal }>>`
        SELECT COALESCE(SUM(l.quantity_base),0)::decimal AS total
        FROM ams.appointment_order_link l
        JOIN ams.appointment a ON a.id=l.appointment_id AND a.tenant_id=l.tenant_id
        WHERE l.tenant_id=${context.tenantId}::uuid AND l.source_type=${link.sourceType}
          AND l.source_ref=${link.sourceRef} AND l.source_line_ref=${link.sourceLineRef}
          AND a.status IN ('SUBMITTED','PENDING','CONFIRMED')`;
      if (new Prisma.Decimal(totals[0]?.total ?? 0).add(link.quantityBase).gt(link.bookableQuantityBase))
        throw new AppError('AMS_ORDER_UNAPPOINTED_QUANTITY_EXCEEDED', 'Appointment quantity exceeds remaining source quantity', 409, { businessRef: link.sourceRef, fieldErrors: [{ field: link.sourceLineRef, message: 'Cumulative appointment quantity exceeds bookable quantity' }] });
    }
    const policy = appointment.approvalPolicySnapshot as Record<string, unknown>;
    const serviceApprovals = Array.isArray(policy.requiresApprovalServiceTypes) ? policy.requiresApprovalServiceTypes.map(String).map((value) => value.toUpperCase()) : [];
    const pending = appointment.type === 'UNLINKED' || appointment.urgent || policy.customerRequiresApproval === true || serviceApprovals.includes(appointment.serviceType);
    const allocationType = pending ? 'RESERVED' : 'USED';
    const workload = { laborHours: appointment.workloadLaborHours, pallets: appointment.workloadPallets, quantity: appointment.workloadQuantity, vehicles: appointment.workloadVehicles };
    const claimed = await this.claimCapacity(tx, appointment.timeSlotId, input.slotVersion, workload, allocationType, context);
    if (!claimed) {
      const candidates = await this.candidates(tx, appointment, context);
      throw new AppError('AMS_TIME_SLOT_CAPACITY_CONFLICT', 'Slot capacity or version changed; choose a new candidate', 409, { businessRef: appointment.appointmentNo, fieldErrors: candidates.map((candidate) => ({ field: 'timeSlotId', message: JSON.stringify(candidate) })), retryable: true });
    }
    const submitted = await tx.appointment.update({ data: { status: 'SUBMITTED', submittedAt: new Date(), updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
    await this.recordDecision(tx, appointment, 'SUBMITTED', 'SUBMIT', 'Appointment submitted', context);
    const next = pending ? 'PENDING' : 'CONFIRMED';
    const final = await tx.appointment.update({ data: { ...(next === 'CONFIRMED' ? { decidedAt: new Date() } : {}), status: next, updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
    await this.recordDecision(tx, submitted, next, pending ? 'ROUTE_APPROVAL' : 'AUTO_CONFIRM', pending ? 'Approval policy requires manual decision' : 'Appointment passed automatic confirmation', context);
    await tx.appointmentCapacityReservation.create({ data: { allocationType, appointmentId: id, createdBy: context.accountId, laborHours: workload.laborHours, pallets: workload.pallets, quantity: workload.quantity, slotVersionAtReserve: claimed.version, tenantId: context.tenantId, timeSlotId: appointment.timeSlotId, updatedBy: context.accountId, vehicles: workload.vehicles } });
    await this.emit(tx, id, final.version, next === 'CONFIRMED' ? 'appointment.confirmed.v1' : 'appointment.submitted.v1', context, metadata, { appointmentId: id, orderLinks: links.map((link) => ({ quantityBase: link.quantityBase.toString(), sourceLineRef: link.sourceLineRef, sourceRef: link.sourceRef, sourceType: link.sourceType })), slot: { slotVersion: claimed.version, timeSlotId: appointment.timeSlotId }, vehicle: appointment.vehicleSnapshot }, 'Appointment');
    return { appointmentId: id, reservationId: (await tx.appointmentCapacityReservation.findFirstOrThrow({ where: { appointmentId: id, status: 'ACTIVE', tenantId: context.tenantId } })).id, status: final.status, version: final.version };
  }

  private async claimCapacity(tx: Prisma.TransactionClient, slotId: string, slotVersion: number, workload: { laborHours: Prisma.Decimal; pallets: Prisma.Decimal; quantity: Prisma.Decimal; vehicles: Prisma.Decimal }, allocationType: 'USED' | 'RESERVED', context: TenantContext) {
    const rows = allocationType === 'USED'
      ? await tx.$queryRaw<Array<{ version: number }>>`UPDATE ams.time_slot SET used_quantity=used_quantity+${workload.quantity},used_pallets=used_pallets+${workload.pallets},used_vehicles=used_vehicles+${workload.vehicles},used_labor_hours=used_labor_hours+${workload.laborHours},version=version+1,updated_at=now(),updated_by=${context.accountId}::uuid WHERE id=${slotId}::uuid AND tenant_id=${context.tenantId}::uuid AND status='OPEN' AND version=${slotVersion} AND internal_quantity+used_quantity+reserved_quantity+${workload.quantity}<=capacity_quantity AND internal_pallets+used_pallets+reserved_pallets+${workload.pallets}<=capacity_pallets AND internal_vehicles+used_vehicles+reserved_vehicles+${workload.vehicles}<=capacity_vehicles AND internal_labor_hours+used_labor_hours+reserved_labor_hours+${workload.laborHours}<=capacity_labor_hours RETURNING version`
      : await tx.$queryRaw<Array<{ version: number }>>`UPDATE ams.time_slot SET reserved_quantity=reserved_quantity+${workload.quantity},reserved_pallets=reserved_pallets+${workload.pallets},reserved_vehicles=reserved_vehicles+${workload.vehicles},reserved_labor_hours=reserved_labor_hours+${workload.laborHours},version=version+1,updated_at=now(),updated_by=${context.accountId}::uuid WHERE id=${slotId}::uuid AND tenant_id=${context.tenantId}::uuid AND status='OPEN' AND version=${slotVersion} AND internal_quantity+used_quantity+reserved_quantity+${workload.quantity}<=capacity_quantity AND internal_pallets+used_pallets+reserved_pallets+${workload.pallets}<=capacity_pallets AND internal_vehicles+used_vehicles+reserved_vehicles+${workload.vehicles}<=capacity_vehicles AND internal_labor_hours+used_labor_hours+reserved_labor_hours+${workload.laborHours}<=capacity_labor_hours RETURNING version`;
    return rows[0];
  }

  private async candidates(tx: Prisma.TransactionClient, appointment: { requestedWindowFrom: Date; requestedWindowTo: Date; serviceType: string; timeSlotId: string; warehouseRef: string; workloadLaborHours: Prisma.Decimal; workloadPallets: Prisma.Decimal; workloadQuantity: Prisma.Decimal; workloadVehicles: Prisma.Decimal }, context: TenantContext) {
    const slots = await tx.timeSlot.findMany({ orderBy: { startsAt: 'asc' }, take: 5, where: { endsAt: { lte: appointment.requestedWindowTo }, id: { not: appointment.timeSlotId }, serviceType: appointment.serviceType, startsAt: { gte: appointment.requestedWindowFrom }, status: 'OPEN', tenantId: context.tenantId, warehouseRef: appointment.warehouseRef } });
    return slots.filter((slot) => slot.capacityQuantity.sub(slot.internalQuantity).sub(slot.usedQuantity).sub(slot.reservedQuantity).gte(appointment.workloadQuantity) && slot.capacityPallets.sub(slot.internalPallets).sub(slot.usedPallets).sub(slot.reservedPallets).gte(appointment.workloadPallets) && slot.capacityVehicles.sub(slot.internalVehicles).sub(slot.usedVehicles).sub(slot.reservedVehicles).gte(appointment.workloadVehicles) && slot.capacityLaborHours.sub(slot.internalLaborHours).sub(slot.usedLaborHours).sub(slot.reservedLaborHours).gte(appointment.workloadLaborHours)).map((slot) => ({ endsAt: slot.endsAt.toISOString(), slotId: slot.id, slotVersion: slot.version, startsAt: slot.startsAt.toISOString() }));
  }

  private async recordDecision(tx: Prisma.TransactionClient, appointment: { id: string; status: 'DRAFT' | 'SUBMITTED' | 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'CHECKED_IN' | 'QUEUED' | 'DOCKED'; approvalPolicySnapshot: Prisma.JsonValue }, toStatus: 'SUBMITTED' | 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED', decision: string, reason: string, context: TenantContext, suggestedTimeSlotId?: string) {
    const sequence = await tx.appointmentDecision.count({ where: { appointmentId: appointment.id, tenantId: context.tenantId } }) + 1;
    await tx.appointmentDecision.create({ data: { appointmentId: appointment.id, createdBy: context.accountId, decision, fromStatus: appointment.status, policySnapshot: json(appointment.approvalPolicySnapshot), reason, sequence, ...(suggestedTimeSlotId ? { suggestedTimeSlotId } : {}), tenantId: context.tenantId, toStatus, updatedBy: context.accountId } });
  }
  private async eventOrderLinks(tx: Prisma.TransactionClient, appointmentId: string, tenantId: string) { return (await tx.amsAppointmentOrderLink.findMany({ where: { appointmentId, tenantId } })).map((link) => ({ quantityBase: link.quantityBase.toString(), sourceLineRef: link.sourceLineRef, sourceRef: link.sourceRef, sourceType: link.sourceType })); }
  private workload(input: WorkloadInput) { return { laborHours: this.decimal(input.laborHours), pallets: this.decimal(input.pallets), quantity: this.decimal(input.quantity), vehicles: this.decimal(input.vehicles) }; }
  private decimal(value: string, positive = false) { try { const result = new Prisma.Decimal(value); if (!result.isFinite() || result.isNegative() || (positive && result.isZero())) throw new Error(); return result; } catch { this.invalid('Decimal value is invalid'); } }
  private date(value: string) { const result = new Date(value); if (!value || Number.isNaN(result.getTime())) this.invalid('Date is invalid'); return result; }
  private day(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) this.invalid('Date must use YYYY-MM-DD'); return this.date(`${value}T00:00:00.000Z`); }
  private uuid(value: string, field: string) { if (!isUuid(value)) this.invalid(`${field} is invalid`); }
  private invalid(message: string): never { throw new AppError('AMS_APPOINTMENT_INPUT_INVALID', message, 400); }
  private conflict(code: string) { return new AppError(code, 'Resource version or state changed', 409, { retryable: true }); }
  private async lock(tx: Prisma.TransactionClient, key: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; }
  private async emit(tx: Prisma.TransactionClient, id: string, version: number, eventName: string, context: TenantContext, metadata: CommandMetadata, payload: Prisma.InputJsonObject, aggregateType: string) {
    await Promise.all([
      tx.platformAuditLog.create({ data: { action: eventName, after: payload, category: 'BUSINESS_CHANGE', correlationId: metadata.correlationId, createdBy: context.accountId, deviceId: context.deviceId, ipAddress: metadata.ipAddress ?? null, resourceId: id, resourceType: aggregateType, tenantId: context.tenantId, updatedBy: context.accountId } }),
      tx.platformOutbox.create({ data: { aggregateId: id, aggregateType, aggregateVersion: version, correlationId: metadata.correlationId, createdBy: context.accountId, eventName, partitionKey: id, payload: { ...payload, tenantId: context.tenantId }, tenantId: context.tenantId, updatedBy: context.accountId } }),
    ]);
  }
}
