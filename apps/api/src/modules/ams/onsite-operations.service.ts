import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { toHttpJson } from '../../common/http-json';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { DockSchedulingFacade } from '../mdm/public/dock-scheduling.facade';
import type { CommandMetadata } from '../platform/tenant.service';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

@Injectable()
export class OnsiteOperationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DockSchedulingFacade)
    private readonly docks: DockSchedulingFacade,
  ) {}

  async workbench(context: TenantContext) {
    const where = { tenantId: context.tenantId };
    const appointments = await this.prisma.appointment.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 300,
      where: {
        status: { in: ['CONFIRMED', 'CHECKED_IN', 'QUEUED', 'DOCKED'] },
        tenantId: context.tenantId,
      },
    });
    const [verifications, passes, accessEvents, tickets, calls, runtimes, assignments, assignmentEvents] = await Promise.all([
      this.prisma.gateVerification.findMany({ orderBy: { observedAt: 'desc' }, take: 200, where }),
      this.prisma.gatePass.findMany({ orderBy: { createdAt: 'desc' }, take: 200, where }),
      this.prisma.gateAccessEvent.findMany({ orderBy: { occurredAt: 'desc' }, take: 300, where }),
      this.prisma.queueTicket.findMany({ orderBy: [{ priorityScore: 'desc' }, { queuedAt: 'asc' }], take: 300, where }),
      this.prisma.callEvent.findMany({ orderBy: { occurredAt: 'desc' }, take: 300, where }),
      this.prisma.dockRuntime.findMany({ orderBy: { createdAt: 'asc' }, take: 200, where }),
      this.prisma.dockAssignment.findMany({ orderBy: { createdAt: 'desc' }, take: 300, where }),
      this.prisma.dockAssignmentEvent.findMany({ orderBy: { occurredAt: 'desc' }, take: 300, where }),
    ]);
    return toHttpJson({ accessEvents, appointments, assignmentEvents, assignments, calls, passes: passes.map(({ plateHash, tokenHash, ...pass }) => ({ ...pass, protected: plateHash.length === 64 && tokenHash.length === 64 })), runtimes, tickets, verifications });
  }

  verifyGate(
    input: {
      appointmentId?: string;
      evidence: { credentialsValid: boolean; driverMatches: boolean; ordersValid: boolean; vehicleMatches: boolean };
      identityType: 'APPOINTMENT_NO' | 'QR_CODE' | 'PLATE';
      identityValue: string;
      manualRelease: boolean;
      observedAt: string;
      policy: { allowEarly: boolean; allowLate: boolean; allowWalkIn: boolean; earlyGraceMinutes: number; lateGraceMinutes: number };
    },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!input.identityValue?.trim() || !Number.isInteger(input.policy.earlyGraceMinutes) || input.policy.earlyGraceMinutes < 0 || !Number.isInteger(input.policy.lateGraceMinutes) || input.policy.lateGraceMinutes < 0)
      this.invalid('Gate identity or arrival policy is invalid');
    if (input.appointmentId) this.uuid(input.appointmentId, 'appointmentId');
    const observedAt = this.date(input.observedAt);
    return this.prisma.$transaction(async (tx) => {
      const appointment = input.appointmentId
        ? await tx.appointment.findFirst({ where: { id: input.appointmentId, tenantId: context.tenantId } })
        : null;
      let arrivalClass = 'WALK_IN';
      const reasons: string[] = [];
      if (appointment) {
        if (appointment.status !== 'CONFIRMED') reasons.push('APPOINTMENT_STATUS_INVALID');
        const earlyBoundary = new Date(appointment.requestedWindowFrom.getTime() - input.policy.earlyGraceMinutes * 60_000);
        const lateBoundary = new Date(appointment.requestedWindowTo.getTime() + input.policy.lateGraceMinutes * 60_000);
        arrivalClass = observedAt < earlyBoundary ? 'EARLY' : observedAt > lateBoundary ? 'LATE' : 'ON_TIME';
        if (arrivalClass === 'EARLY' && !input.policy.allowEarly) reasons.push('EARLY_ARRIVAL_BLOCKED');
        if (arrivalClass === 'LATE' && !input.policy.allowLate) reasons.push('LATE_ARRIVAL_BLOCKED');
      } else if (!input.policy.allowWalkIn) reasons.push('WALK_IN_REQUIRES_APPROVAL');
      for (const [key, passed] of Object.entries(input.evidence)) if (!passed) reasons.push(key.toUpperCase());
      const status = reasons.length === 0 ? 'PASSED' : input.manualRelease ? 'PASSED' : arrivalClass === 'WALK_IN' ? 'MANUAL_REVIEW' : 'REJECTED';
      const id = randomUUID();
      const verification = await tx.gateVerification.create({ data: { ...(appointment ? { appointmentId: appointment.id } : {}), arrivalClass, createdBy: context.accountId, evidenceSnapshot: json(input.evidence), id, identityHash: this.hash(input.identityValue), identityType: input.identityType, manuallyReleased: input.manualRelease && reasons.length > 0, observedAt, policySnapshot: json(input.policy), reasons, status, tenantId: context.tenantId, updatedBy: context.accountId, verificationNo: `GVR-${Date.now()}-${id.slice(0, 6)}` } });
      if (status === 'PASSED' && appointment) await tx.appointment.update({ data: { status: 'CHECKED_IN', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: appointment.id } });
      await this.emit(tx, verification.id, verification.version, 'gate.verification-completed.v1', context, metadata, { appointmentId: appointment?.id ?? null, arrivalClass, gateVerificationId: verification.id, reasons, status }, 'GateVerification');
      return { appointmentId: appointment?.id ?? null, arrivalClass, gateVerificationId: verification.id, reasons, status, version: verification.version };
    });
  }

  issuePass(
    appointmentId: string,
    input: { gateVerificationId: string; plateNumber: string; validMinutes: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(appointmentId, 'appointmentId'); this.uuid(input.gateVerificationId, 'gateVerificationId');
    if (!input.plateNumber?.trim() || !Number.isInteger(input.validMinutes) || input.validMinutes < 1 || input.validMinutes > 1440) this.invalid('Gate pass plate or validity is invalid');
    return this.prisma.$transaction(async (tx) => {
      const [appointment, verification] = await Promise.all([
        tx.appointment.findFirst({ where: { id: appointmentId, status: 'CHECKED_IN', tenantId: context.tenantId } }),
        tx.gateVerification.findFirst({ where: { appointmentId, id: input.gateVerificationId, status: 'PASSED', tenantId: context.tenantId } }),
      ]);
      if (!appointment || !verification) throw new AppError('AMS_GATE_PASS_PREREQUISITE_INVALID', 'Passed gate verification and checked-in appointment are required', 409);
      const token = `${randomBytes(24).toString('base64url')}.${randomUUID()}`;
      const validFrom = new Date();
      const pass = await tx.gatePass.create({ data: { appointmentId, createdBy: context.accountId, gateVerificationId: verification.id, plateHash: this.hash(input.plateNumber.trim().toUpperCase()), tenantId: context.tenantId, tokenHash: this.hash(token), updatedBy: context.accountId, validFrom, validUntil: new Date(validFrom.getTime() + input.validMinutes * 60_000) } });
      await this.emit(tx, pass.id, pass.version, 'gate.pass-issued.v1', context, metadata, { appointmentId, gatePassId: pass.id, validUntil: pass.validUntil.toISOString() }, 'GatePass');
      return { appointmentId, gatePassId: pass.id, status: pass.status, token, validUntil: pass.validUntil.toISOString(), version: pass.version };
    });
  }

  access(
    input: { eventType: 'ENTRY' | 'EXIT'; evidenceSnapshot: Readonly<Record<string, unknown>>; token: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!input.token || input.token.length < 40) this.invalid('Gate token is invalid');
    return this.prisma.$transaction(async (tx) => {
      const pass = await tx.gatePass.findFirst({ where: { tenantId: context.tenantId, tokenHash: this.hash(input.token) } });
      if (!pass) throw new AppError('AMS_GATE_PASS_INVALID', 'Gate pass was not found', 404);
      await this.lock(tx, `${context.tenantId}:${pass.id}:gate-access`);
      const current = await tx.gatePass.findUniqueOrThrow({ where: { id: pass.id } });
      const expired = current.validUntil <= new Date();
      const allowed = input.eventType === 'ENTRY' && current.status === 'ACTIVE' && !expired && current.entryCount === 0;
      const reason = allowed ? 'ENTRY_ALLOWED' : expired ? 'PASS_EXPIRED' : current.status === 'USED' ? 'DUPLICATE_ENTRY' : 'PASS_NOT_ACTIVE';
      if (allowed) await tx.gatePass.update({ data: { entryCount: 1, status: 'USED', updatedBy: context.accountId, usedAt: new Date(), version: { increment: 1 } }, where: { id: current.id } });
      else if (expired && current.status === 'ACTIVE') await tx.gatePass.update({ data: { status: 'EXPIRED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: current.id } });
      const event = await tx.gateAccessEvent.create({ data: { appointmentId: current.appointmentId, createdBy: context.accountId, decision: allowed ? 'ALLOWED' : 'DENIED', eventType: input.eventType, evidenceSnapshot: json(input.evidenceSnapshot), gatePassId: current.id, reason, tenantId: context.tenantId, updatedBy: context.accountId } });
      await this.emit(tx, event.id, event.version, 'gate.access-recorded.v1', context, metadata, { accessEventId: event.id, appointmentId: current.appointmentId, decision: event.decision, reason }, 'GateAccessEvent');
      return { accessEventId: event.id, appointmentId: current.appointmentId, decision: event.decision, reason, version: event.version };
    });
  }

  enqueue(
    appointmentId: string,
    input: { expectedVersion: number; onsiteAdjustment: number; temperatureControlled: boolean },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(appointmentId, 'appointmentId');
    if (!Number.isInteger(input.onsiteAdjustment) || input.onsiteAdjustment < -100 || input.onsiteAdjustment > 100) this.invalid('On-site priority adjustment is invalid');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${appointmentId}:queue`);
      const appointment = await tx.appointment.findFirst({ where: { id: appointmentId, status: 'CHECKED_IN', tenantId: context.tenantId, version: input.expectedVersion } });
      if (!appointment) throw this.conflict('AMS_APPOINTMENT_VERSION_CONFLICT');
      const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const sequence = await tx.queueTicket.count({ where: { tenantId: context.tenantId, queuedAt: { gte: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) } } }) + 1;
      const score = (appointment.urgent ? 100 : 0) + (input.temperatureControlled ? 50 : 0) + input.onsiteAdjustment - Math.max(0, Math.floor((new Date().getTime() - appointment.requestedWindowFrom.getTime()) / 60_000));
      const ticket = await tx.queueTicket.create({ data: { appointmentId, createdBy: context.accountId, priorityScore: score, prioritySnapshot: json({ onsiteAdjustment: input.onsiteAdjustment, temperatureControlled: input.temperatureControlled, urgent: appointment.urgent }), tenantId: context.tenantId, ticketNo: `Q-${day}-${String(sequence).padStart(4, '0')}`, updatedBy: context.accountId, warehouseRef: appointment.warehouseRef } });
      const changed = await tx.appointment.update({ data: { status: 'QUEUED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: appointmentId } });
      await this.emit(tx, ticket.id, ticket.version, 'queue.ticket-created.v1', context, metadata, { appointmentId, priorityScore: score, queueTicketId: ticket.id, ticketNo: ticket.ticketNo }, 'QueueTicket');
      return { appointmentId, priorityScore: score, queueTicketId: ticket.id, status: ticket.status, ticketNo: ticket.ticketNo, version: changed.version };
    });
  }

  call(
    id: string,
    input: { channels: readonly string[]; expectedVersion: number; timeoutMinutes: number },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'queueTicketId');
    if (!input.channels.length || !Number.isInteger(input.timeoutMinutes) || input.timeoutMinutes < 1) this.invalid('Call channels or timeout is invalid');
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.queueTicket.findFirst({ where: { id, status: { in: ['WAITING', 'DEFERRED'] }, tenantId: context.tenantId, version: input.expectedVersion } });
      if (!ticket) throw this.conflict('AMS_QUEUE_TICKET_VERSION_CONFLICT');
      const now = new Date(); const deadline = new Date(now.getTime() + input.timeoutMinutes * 60_000);
      const changed = await tx.queueTicket.update({ data: { calledAt: now, callDeadlineAt: deadline, status: 'CALLED', transitionReason: 'Dock ready', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      const event = await this.callEvent(tx, changed, ticket.status === 'DEFERRED' ? 'RECALLED' : 'CALLED', input.channels, 'Dock ready call', context, deadline);
      await this.emit(tx, event.id, event.version, 'queue.driver-called.v1', context, metadata, { appointmentId: ticket.appointmentId, channels: input.channels, deadlineAt: deadline.toISOString(), queueTicketId: id }, 'CallEvent');
      return { deadlineAt: deadline.toISOString(), queueTicketId: id, status: changed.status, version: changed.version };
    });
  }

  acknowledgeCall(id: string, input: { expectedVersion: number }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(id, 'queueTicketId');
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.queueTicket.findFirst({ where: { id, status: 'CALLED', tenantId: context.tenantId, version: input.expectedVersion } });
      if (!ticket) throw this.conflict('AMS_QUEUE_TICKET_VERSION_CONFLICT');
      const changed = await tx.queueTicket.update({ data: { acknowledgedAt: new Date(), status: 'ACKNOWLEDGED', transitionReason: 'Driver acknowledged', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      const event = await this.callEvent(tx, changed, 'ACKNOWLEDGED', [], 'Driver acknowledged', context);
      await this.emit(tx, event.id, event.version, 'queue.driver-acknowledged.v1', context, metadata, { appointmentId: ticket.appointmentId, queueTicketId: id }, 'CallEvent');
      return { queueTicketId: id, status: changed.status, version: changed.version };
    });
  }

  timeoutCall(id: string, input: { expectedVersion: number; escalationEvery: number }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(id, 'queueTicketId');
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.queueTicket.findFirst({ where: { callDeadlineAt: { lte: new Date() }, id, status: 'CALLED', tenantId: context.tenantId, version: input.expectedVersion } });
      if (!ticket || !Number.isInteger(input.escalationEvery) || input.escalationEvery < 1) throw this.conflict('AMS_QUEUE_CALL_NOT_DUE');
      const retryCount = ticket.retryCount + 1; const escalationLevel = retryCount % input.escalationEvery === 0 ? ticket.escalationLevel + 1 : ticket.escalationLevel;
      const changed = await tx.queueTicket.update({ data: { escalationLevel, retryCount, status: 'DEFERRED', transitionReason: 'Driver call timeout', updatedBy: context.accountId, version: { increment: 1 } }, where: { id } });
      const event = await this.callEvent(tx, changed, escalationLevel > ticket.escalationLevel ? 'ESCALATED' : 'TIMEOUT', [], 'Driver did not acknowledge before deadline', context);
      await this.emit(tx, event.id, event.version, 'queue.call-timeout.v1', context, metadata, { escalationLevel, queueTicketId: id, retryCount }, 'CallEvent');
      return { escalationLevel, queueTicketId: id, retryCount, status: changed.status, version: changed.version };
    });
  }

  async assignDock(
    appointmentId: string,
    input: { assignedFrom: string; assignedUntil: string; expectedVersion: number; manualDockRef?: string; requirements: Readonly<Record<string, unknown>> },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(appointmentId, 'appointmentId'); if (input.manualDockRef) this.uuid(input.manualDockRef, 'manualDockRef');
    const assignedFrom = this.date(input.assignedFrom); const assignedUntil = this.date(input.assignedUntil);
    if (assignedUntil <= assignedFrom) this.invalid('Dock assignment window is invalid');
    const appointment = await this.prisma.appointment.findFirst({ where: { id: appointmentId, status: 'QUEUED', tenantId: context.tenantId, version: input.expectedVersion } });
    if (!appointment) throw this.conflict('AMS_APPOINTMENT_VERSION_CONFLICT');
    const masters = await this.docks.listActive(appointment.warehouseRef, context);
    const eligible = masters.filter((dock) => this.dockEligible(dock, input.requirements));
    const selected = input.manualDockRef ? eligible.find(({ id }) => id === input.manualDockRef) : eligible[0];
    if (!selected) throw new AppError('AMS_DOCK_CANDIDATE_NOT_FOUND', 'No dock satisfies the hard requirements', 409);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${context.tenantId}:${selected.id}:dock`);
      const ticket = await tx.queueTicket.findFirst({ where: { appointmentId, status: 'ACKNOWLEDGED', tenantId: context.tenantId } });
      if (!ticket) throw new AppError('AMS_QUEUE_ACK_REQUIRED', 'Driver call acknowledgement is required before docking', 409);
      const runtime = await tx.dockRuntime.upsert({ create: { createdBy: context.accountId, dockRef: selected.id, dockSnapshot: json(selected), tenantId: context.tenantId, updatedBy: context.accountId, warehouseRef: appointment.warehouseRef }, update: {}, where: { tenantId_dockRef: { dockRef: selected.id, tenantId: context.tenantId } } });
      if (runtime.status !== 'AVAILABLE') throw new AppError('AMS_DOCK_UNAVAILABLE', 'Dock is occupied or faulted', 409, { retryable: true });
      const overlap = await tx.dockAssignment.count({ where: { assignedFrom: { lt: assignedUntil }, assignedUntil: { gt: assignedFrom }, dockRef: selected.id, status: 'ACTIVE', tenantId: context.tenantId } });
      if (overlap) throw new AppError('AMS_DOCK_CONFLICT', 'Dock assignment overlaps an active assignment', 409, { retryable: true });
      const assignmentId = randomUUID();
      const assignment = await tx.dockAssignment.create({ data: { appointmentId, assignedFrom, assignedUntil, assignmentMode: input.manualDockRef ? 'MANUAL' : 'AUTO', assignmentNo: `DAS-${Date.now()}-${assignmentId.slice(0, 6)}`, createdBy: context.accountId, dockRef: selected.id, dockSnapshot: json(selected), id: assignmentId, queueTicketId: ticket.id, requirementSnapshot: json(input.requirements), tenantId: context.tenantId, updatedBy: context.accountId } });
      await tx.dockRuntime.update({ data: { status: 'OCCUPIED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: runtime.id } });
      const changed = await tx.appointment.update({ data: { status: 'DOCKED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: appointmentId } });
      await tx.dockAssignmentEvent.create({ data: { appointmentId, createdBy: context.accountId, dockAssignmentId: assignment.id, eventType: 'ASSIGNED', reason: input.manualDockRef ? 'Manual selection passed hard constraints' : 'Automatic best eligible dock', tenantId: context.tenantId, toDockRef: selected.id, updatedBy: context.accountId } });
      await this.emit(tx, assignment.id, assignment.version, 'dock.assigned.v1', context, metadata, { appointmentId, dockAssignmentId: assignment.id, dockRef: selected.id }, 'DockAssignment');
      return { appointmentId, dockAssignmentId: assignment.id, dockRef: selected.id, status: changed.status, version: changed.version };
    });
  }

  async switchDock(
    appointmentId: string,
    input: { expectedAssignmentVersion: number; reason: string; requirements: Readonly<Record<string, unknown>>; toDockRef: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(appointmentId, 'appointmentId'); this.uuid(input.toDockRef, 'toDockRef');
    if (!input.reason?.trim()) this.invalid('Dock switch reason is required');
    const appointment = await this.prisma.appointment.findFirst({ where: { id: appointmentId, status: 'DOCKED', tenantId: context.tenantId } });
    if (!appointment) throw this.conflict('AMS_APPOINTMENT_STATE_CONFLICT');
    const masters = await this.docks.listActive(appointment.warehouseRef, context);
    const selected = masters.find(({ id }) => id === input.toDockRef);
    if (!selected || !this.dockEligible(selected, input.requirements)) throw new AppError('AMS_DOCK_CANDIDATE_NOT_FOUND', 'Target dock does not satisfy the hard requirements', 409);
    const current = await this.prisma.dockAssignment.findFirst({ where: { appointmentId, status: 'ACTIVE', tenantId: context.tenantId, version: input.expectedAssignmentVersion } });
    if (!current) throw this.conflict('AMS_DOCK_ASSIGNMENT_VERSION_CONFLICT');
    if (current.dockRef === selected.id) this.invalid('Target dock must differ from the current dock');
    return this.prisma.$transaction(async (tx) => {
      for (const dockRef of [current.dockRef, selected.id].sort()) await this.lock(tx, `${context.tenantId}:${dockRef}:dock`);
      const active = await tx.dockAssignment.findFirst({ where: { appointmentId, id: current.id, status: 'ACTIVE', tenantId: context.tenantId, version: input.expectedAssignmentVersion } });
      if (!active) throw this.conflict('AMS_DOCK_ASSIGNMENT_VERSION_CONFLICT');
      const targetRuntime = await tx.dockRuntime.upsert({ create: { createdBy: context.accountId, dockRef: selected.id, dockSnapshot: json(selected), tenantId: context.tenantId, updatedBy: context.accountId, warehouseRef: appointment.warehouseRef }, update: {}, where: { tenantId_dockRef: { dockRef: selected.id, tenantId: context.tenantId } } });
      if (targetRuntime.status !== 'AVAILABLE') throw new AppError('AMS_DOCK_UNAVAILABLE', 'Target dock is occupied or faulted', 409, { retryable: true });
      const overlap = await tx.dockAssignment.count({ where: { assignedFrom: { lt: active.assignedUntil }, assignedUntil: { gt: active.assignedFrom }, dockRef: selected.id, status: 'ACTIVE', tenantId: context.tenantId } });
      if (overlap) throw new AppError('AMS_DOCK_CONFLICT', 'Target dock assignment overlaps an active assignment', 409, { retryable: true });
      const switchedAt = new Date();
      await tx.dockAssignment.update({ data: { releaseReason: input.reason.trim(), releasedAt: switchedAt, status: 'SWITCHED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: active.id } });
      const sourceRuntime = await tx.dockRuntime.findUnique({ where: { tenantId_dockRef: { dockRef: active.dockRef, tenantId: context.tenantId } } });
      if (sourceRuntime && sourceRuntime.status !== 'FAULT') await tx.dockRuntime.update({ data: { status: 'AVAILABLE', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: sourceRuntime.id } });
      await tx.dockRuntime.update({ data: { status: 'OCCUPIED', updatedBy: context.accountId, version: { increment: 1 } }, where: { id: targetRuntime.id } });
      const assignmentId = randomUUID();
      const replacement = await tx.dockAssignment.create({ data: { appointmentId, assignedFrom: switchedAt, assignedUntil: active.assignedUntil, assignmentMode: 'MANUAL', assignmentNo: `DAS-${Date.now()}-${assignmentId.slice(0, 6)}`, createdBy: context.accountId, dockRef: selected.id, dockSnapshot: json(selected), id: assignmentId, queueTicketId: active.queueTicketId, requirementSnapshot: json(input.requirements), tenantId: context.tenantId, updatedBy: context.accountId } });
      await tx.dockAssignmentEvent.create({ data: { appointmentId, createdBy: context.accountId, dockAssignmentId: active.id, eventType: 'SWITCHED', fromDockRef: active.dockRef, reason: input.reason.trim(), tenantId: context.tenantId, toDockRef: selected.id, updatedBy: context.accountId } });
      await tx.dockAssignmentEvent.create({ data: { appointmentId, createdBy: context.accountId, dockAssignmentId: replacement.id, eventType: 'ASSIGNED', fromDockRef: active.dockRef, reason: `Switched: ${input.reason.trim()}`, tenantId: context.tenantId, toDockRef: selected.id, updatedBy: context.accountId } });
      await this.emit(tx, replacement.id, replacement.version, 'dock.switched.v1', context, metadata, { appointmentId, fromDockRef: active.dockRef, previousAssignmentId: active.id, toDockRef: selected.id }, 'DockAssignment');
      return { appointmentId, dockAssignmentId: replacement.id, dockRef: selected.id, previousAssignmentId: active.id, status: replacement.status, version: replacement.version };
    });
  }

  setDockFault(dockRef: string, input: { expectedVersion: number; faulted: boolean; reason: string }, context: TenantContext, metadata: CommandMetadata) {
    this.uuid(dockRef, 'dockRef'); if (!input.reason?.trim()) this.invalid('Dock fault reason is required');
    return this.prisma.$transaction(async (tx) => {
      const runtime = await tx.dockRuntime.findFirst({ where: { dockRef, tenantId: context.tenantId, version: input.expectedVersion } });
      if (!runtime || (input.faulted && runtime.status === 'FAULT')) throw this.conflict('AMS_DOCK_RUNTIME_VERSION_CONFLICT');
      const active = await tx.dockAssignment.findFirst({ where: { dockRef, status: 'ACTIVE', tenantId: context.tenantId } });
      const next = input.faulted ? 'FAULT' : active ? 'OCCUPIED' : 'AVAILABLE';
      const changed = await tx.dockRuntime.update({ data: { faultReason: input.faulted ? input.reason.trim() : null, status: next, updatedBy: context.accountId, version: { increment: 1 } }, where: { id: runtime.id } });
      if (active && input.faulted) await tx.dockAssignmentEvent.create({ data: { appointmentId: active.appointmentId, createdBy: context.accountId, dockAssignmentId: active.id, eventType: 'FAULTED', fromDockRef: dockRef, reason: input.reason.trim(), tenantId: context.tenantId, updatedBy: context.accountId } });
      await this.emit(tx, dockRef, changed.version, 'dock.runtime-changed.v1', context, metadata, { dockRef, status: changed.status }, 'DockRuntime');
      return { dockRef, status: changed.status, version: changed.version };
    });
  }

  private dockEligible(dock: { maxVehicleLength: string | null; maxVehicleWeight: string | null; serviceCapabilities: unknown; temperatureCapabilities: unknown }, requirements: Readonly<Record<string, unknown>>) {
    const services = object(dock.serviceCapabilities); const requiredService = String(requirements.serviceType ?? '').toUpperCase();
    const serviceTypes = Array.isArray(services.serviceTypes) ? services.serviceTypes.map(String).map((value) => value.toUpperCase()) : [];
    const temperatures = Array.isArray(dock.temperatureCapabilities) ? dock.temperatureCapabilities.map(String).map((value) => value.toUpperCase()) : [];
    const requiredTemperature = String(requirements.temperatureZone ?? '').toUpperCase();
    return (!requiredService || serviceTypes.length === 0 || serviceTypes.includes(requiredService)) && (!requiredTemperature || temperatures.includes(requiredTemperature)) && (!requirements.vehicleWeight || !dock.maxVehicleWeight || new Prisma.Decimal(String(requirements.vehicleWeight)).lte(dock.maxVehicleWeight)) && (!requirements.vehicleLength || !dock.maxVehicleLength || new Prisma.Decimal(String(requirements.vehicleLength)).lte(dock.maxVehicleLength));
  }
  private async callEvent(tx: Prisma.TransactionClient, ticket: { id: string }, eventType: string, channels: readonly string[], reason: string, context: TenantContext, deadlineAt?: Date) { const sequence = await tx.callEvent.count({ where: { queueTicketId: ticket.id, tenantId: context.tenantId } }) + 1; return tx.callEvent.create({ data: { channels: [...channels], createdBy: context.accountId, ...(deadlineAt ? { deadlineAt } : {}), eventType, queueTicketId: ticket.id, reason, sequence, tenantId: context.tenantId, updatedBy: context.accountId } }); }
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private date(value: string) { const result = new Date(value); if (!value || Number.isNaN(result.getTime())) this.invalid('Date is invalid'); return result; }
  private uuid(value: string, field: string) { if (!isUuid(value)) this.invalid(`${field} is invalid`); }
  private invalid(message: string): never { throw new AppError('AMS_ONSITE_INPUT_INVALID', message, 400); }
  private conflict(code: string) { return new AppError(code, 'Resource version or state changed', 409, { retryable: true }); }
  private async lock(tx: Prisma.TransactionClient, key: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; }
  private async emit(tx: Prisma.TransactionClient, id: string, version: number, eventName: string, context: TenantContext, metadata: CommandMetadata, payload: Prisma.InputJsonObject, aggregateType: string) { await Promise.all([tx.platformAuditLog.create({ data: { action: eventName, after: payload, category: 'BUSINESS_CHANGE', correlationId: metadata.correlationId, createdBy: context.accountId, deviceId: context.deviceId, ipAddress: metadata.ipAddress ?? null, resourceId: id, resourceType: aggregateType, tenantId: context.tenantId, updatedBy: context.accountId } }), tx.platformOutbox.create({ data: { aggregateId: id, aggregateType, aggregateVersion: version, correlationId: metadata.correlationId, createdBy: context.accountId, eventName, partitionKey: id, payload: { ...payload, tenantId: context.tenantId }, tenantId: context.tenantId, updatedBy: context.accountId } })]); }
}
