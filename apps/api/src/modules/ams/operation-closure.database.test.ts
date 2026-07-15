import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { OperationClosureService } from './operation-closure.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('AMS operation, checkout, no-show and dashboard persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('closes operation once and preserves immutable operation performance facts', async () => {
    const tenantId = randomUUID(); const actorId = randomUUID(); const warehouseRef = randomUUID(); const dockRef = randomUUID(); const appointmentId = randomUUID(); const queueTicketId = randomUUID(); const assignmentId = randomUUID(); const gatePassId = randomUUID();
    const context: TenantContext = { accountId: actorId, accountKind: 'TENANT_ADMIN', deviceId: 'operation-db-test', organizationIds: [], permissionVersion: 1, tenantId, tokenId: randomUUID() };
    const command = () => ({ correlationId: randomUUID(), idempotencyKey: randomUUID(), ipAddress: '127.0.0.1' }); const service = new OperationClosureService(prisma as never);
    const base = new Date(); base.setUTCHours(0,0,0,0); const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);
    await prisma.appointment.create({ data: { appointmentNo: `APT-${randomUUID()}`, approvalPolicySnapshot: {}, createdBy: actorId, decidedAt: base, id: appointmentId, requestedWindowFrom: base, requestedWindowTo: at(90), requesterPartyRef: 'CUSTOMER-01', requesterSnapshot: { role: 'CUSTOMER' }, serviceType: 'INBOUND', status: 'DOCKED', submittedAt: base, tenantId, timeSlotId: randomUUID(), type: 'ORDER_LINKED', updatedBy: actorId, urgent: false, vehicleSnapshot: { plateNumber: '沪A12345' }, warehouseRef, workloadLaborHours: 2, workloadPallets: 4, workloadQuantity: 20, workloadQuantityUom: 'EA', workloadVehicles: 1 } });
    const verification = await prisma.gateVerification.create({ data: { appointmentId, arrivalClass: 'ON_TIME', createdBy: actorId, evidenceSnapshot: { valid: true }, identityHash: 'a'.repeat(64), identityType: 'QR_CODE', observedAt: at(5), policySnapshot: {}, reasons: [], status: 'PASSED', tenantId, updatedBy: actorId, verificationNo: `GVR-${randomUUID()}` } });
    await prisma.gatePass.create({ data: { appointmentId, createdBy: actorId, entryCount: 1, gateVerificationId: verification.id, id: gatePassId, plateHash: 'b'.repeat(64), status: 'USED', tenantId, tokenHash: 'c'.repeat(64), updatedBy: actorId, usedAt: at(6), validFrom: base, validUntil: at(180) } });
    await prisma.queueTicket.create({ data: { acknowledgedAt: at(7), appointmentId, createdBy: actorId, id: queueTicketId, priorityScore: 1, prioritySnapshot: {}, status: 'ACKNOWLEDGED', tenantId, ticketNo: `Q-${randomUUID()}`, updatedBy: actorId, warehouseRef } });
    await prisma.dockRuntime.create({ data: { createdBy: actorId, dockRef, dockSnapshot: { code: 'D-01' }, status: 'OCCUPIED', tenantId, updatedBy: actorId, warehouseRef } });
    await prisma.dockAssignment.create({ data: { appointmentId, assignedFrom: at(8), assignedUntil: at(180), assignmentMode: 'AUTO', assignmentNo: `DAS-${randomUUID()}`, createdBy: actorId, dockRef, dockSnapshot: { code: 'D-01' }, id: assignmentId, queueTicketId, requirementSnapshot: { serviceType: 'INBOUND' }, tenantId, updatedBy: actorId } });
    const event = (eventType: 'DOCKED'|'STARTED'|'PAUSED'|'RESUMED'|'COMPLETED'|'DEPARTED', minutes: number, expectedVersion: number, quantity = '0') => service.recordEvent(appointmentId, { businessLinks: { tmsTaskRefs: ['SHIP-01'], wmsTaskRefs: ['REC-01'] }, eventType, evidenceSnapshot: { source: 'RF' }, expectedVersion, occurredAt: at(minutes).toISOString(), quantity, quantityUom: 'EA', reason: eventType }, context, command());
    await event('DOCKED', 10, 1);
    await expect(event('RESUMED', 11, 1)).rejects.toMatchObject({ code: 'AMS_OPERATION_SEQUENCE_INVALID' });
    const started = await event('STARTED', 20, 1); expect(started).toMatchObject({ status: 'OPERATING', version: 2 });
    await event('PAUSED', 40, 2); await event('RESUMED', 50, 2); const completedEvent = await event('COMPLETED', 80, 2, '18'); expect(completedEvent.durations).toMatchObject({ operatingMinutes: 50, pausedMinutes: 10, waitingMinutes: 15 }); await event('DEPARTED', 85, 2, '18');
    const checkoutInput = { documents: { refs: ['DOC-01'], valid: true }, evidenceSnapshot: { gate: 'G-OUT' }, exceptions: { openCount: 0 }, expectedVersion: 2, occurredAt: at(86).toISOString(), seal: { sealNo: 'SEAL-01', valid: true } };
    const checkouts = await Promise.allSettled([service.checkOut(appointmentId, checkoutInput, context, command()), service.checkOut(appointmentId, checkoutInput, context, command())]);
    expect(checkouts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1); expect(checkouts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const checkedOut = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } }); expect(checkedOut).toMatchObject({ status: 'CHECKED_OUT', version: 3 });
    expect(await prisma.dockRuntime.findUniqueOrThrow({ where: { tenantId_dockRef: { dockRef, tenantId } } })).toMatchObject({ status: 'AVAILABLE' });
    const completed = await service.complete(appointmentId, { expectedVersion: checkedOut.version }, context, command()); expect(completed).toMatchObject({ operatingMinutes: 50, pausedMinutes: 10, status: 'COMPLETED', waitingMinutes: 15 });
    const fact = await prisma.appointmentCompletion.findFirstOrThrow({ where: { appointmentId, tenantId } }); await expect(prisma.appointmentCompletion.delete({ where: { id: fact.id } })).rejects.toThrow(/immutable/i);
    expect(await prisma.platformOutbox.findFirst({ where: { aggregateId: appointmentId, eventName: 'appointment.completed.v1', tenantId } })).toBeTruthy();
    const dashboard = await service.dashboard({ requesterPartyRef: 'CUSTOMER-01', serviceType: 'INBOUND', warehouseRef }, context); expect(dashboard.metrics).toMatchObject({ averageOperatingMinutes: 50, averageWaitingMinutes: 15 });
  });

  it('marks no-show once, releases capacity and appends appeal waiver facts', async () => {
    const tenantId = randomUUID(); const actorId = randomUUID(); const warehouseRef = randomUUID(); const resourceRef = randomUUID(); const appointmentId = randomUUID();
    const context: TenantContext = { accountId: actorId, accountKind: 'TENANT_ADMIN', deviceId: 'no-show-db-test', organizationIds: [], permissionVersion: 1, tenantId, tokenId: randomUUID() }; const command = () => ({ correlationId: randomUUID(), idempotencyKey: randomUUID(), ipAddress: '127.0.0.1' }); const service = new OperationClosureService(prisma as never);
    const endedAt = new Date(Date.now() - 120 * 60_000); const startedAt = new Date(endedAt.getTime() - 60 * 60_000);
    const profile = await prisma.capacityProfile.create({ data: { blacklistDates: [], calendarCode: 'TEST', capacityLaborHours: 10, capacityPallets: 10, capacityQuantity: 10, capacityQuantityUom: 'EA', capacityVehicles: 10, createdBy: actorId, effectiveFrom: new Date('2020-01-01'), internalLaborHours: 0, internalPallets: 0, internalQuantity: 0, internalVehicles: 0, leadTimeMinutes: 0, profileCode: `P-${randomUUID()}`, publishedAt: new Date(), resourceRef, resourceSnapshot: {}, resourceType: 'DOCK', revision: 1, serviceType: 'INBOUND', shiftCode: 'DAY', shiftEndTime: '18:00', shiftStartTime: '08:00', slotMinutes: 60, status: 'PUBLISHED', tenantId, updatedBy: actorId, warehouseRef } });
    const calendar = await prisma.capacityCalendar.create({ data: { calendarDate: startedAt, calendarSnapshot: {}, capacityProfileId: profile.id, createdBy: actorId, shiftCode: 'DAY', tenantId, updatedBy: actorId } });
    const slot = await prisma.timeSlot.create({ data: { calendarSnapshot: {}, capacityCalendarId: calendar.id, capacityLaborHours: 10, capacityPallets: 10, capacityProfileId: profile.id, capacityQuantity: 10, capacityQuantityUom: 'EA', capacityVehicles: 10, createdBy: actorId, endsAt: endedAt, resourceRef, resourceType: 'DOCK', serviceType: 'INBOUND', startsAt: startedAt, tenantId, updatedBy: actorId, usedLaborHours: 1, usedPallets: 1, usedQuantity: 1, usedVehicles: 1, warehouseRef } });
    await prisma.appointment.create({ data: { appointmentNo: `APT-${randomUUID()}`, approvalPolicySnapshot: {}, createdBy: actorId, decidedAt: startedAt, id: appointmentId, requestedWindowFrom: startedAt, requestedWindowTo: endedAt, requesterPartyRef: 'CARRIER-01', requesterSnapshot: { role: 'CARRIER' }, serviceType: 'INBOUND', status: 'CONFIRMED', submittedAt: startedAt, tenantId, timeSlotId: slot.id, type: 'ORDER_LINKED', updatedBy: actorId, urgent: false, vehicleSnapshot: {}, warehouseRef, workloadLaborHours: 1, workloadPallets: 1, workloadQuantity: 1, workloadQuantityUom: 'EA', workloadVehicles: 1 } });
    await prisma.appointmentCapacityReservation.create({ data: { allocationType: 'USED', appointmentId, createdBy: actorId, laborHours: 1, pallets: 1, quantity: 1, slotVersionAtReserve: slot.version, tenantId, timeSlotId: slot.id, updatedBy: actorId, vehicles: 1 } });
    const input = { contractSnapshot: { contractRef: 'CTR-01', version: 2 }, expectedVersion: 1, graceMinutes: 30, notificationSnapshot: { channels: ['APP'] }, observedAt: new Date().toISOString(), penalty: { amount: '100', currency: 'CNY', shouldCharge: true }, reason: '车辆未到场' };
    const marked = await service.markNoShow(appointmentId, input, context, command()); expect(marked).toMatchObject({ penaltyAmount: '100', status: 'NO_SHOW', version: 2 });
    await expect(service.markNoShow(appointmentId, input, context, command())).rejects.toMatchObject({ code: 'AMS_APPOINTMENT_VERSION_CONFLICT' });
    expect((await prisma.timeSlot.findUniqueOrThrow({ where: { id: slot.id } })).usedQuantity.toString()).toBe('0');
    const noShow = await prisma.noShowCase.findUniqueOrThrow({ where: { tenantId_appointmentId: { appointmentId, tenantId } } }); const appeal = await service.appeal(noShow.id, { evidenceSnapshot: { trafficReport: 'ATT-01' }, expectedVersion: noShow.version, reason: '道路封闭' }, context, command()); const decision = await service.decideAppeal(appeal.appealId, { decision: 'WAIVED', expectedCaseVersion: appeal.version, reason: '不可抗力证据有效' }, context, command()); expect(decision).toMatchObject({ decision: 'WAIVED', effectiveAmount: '0', status: 'WAIVED' });
    const penalty = await prisma.penaltyChargeFact.findFirstOrThrow({ where: { noShowCaseId: noShow.id } }); await expect(prisma.penaltyChargeFact.update({ data: { amount: 0 }, where: { id: penalty.id } })).rejects.toThrow(/immutable/i);
    const waiver = await prisma.penaltyWaiverDecision.findFirstOrThrow({ where: { noShowCaseId: noShow.id } }); expect({ effectiveAmount: waiver.effectiveAmount.toString(), originalAmount: waiver.originalAmount.toString() }).toEqual({ originalAmount: '100', effectiveAmount: '0' });
  });
});
