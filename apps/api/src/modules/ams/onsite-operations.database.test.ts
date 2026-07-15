import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { OnsiteOperationsService } from './onsite-operations.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('AMS gate, queue, calling and dock persistence', () => {
  afterAll(() => prisma.$disconnect());
  it('rejects invalid arrivals, consumes passes once, escalates calls and serializes one dock', async () => {
    const tenantId = randomUUID(); const actorId = randomUUID(); const warehouseRef = randomUUID(); const dockRef = randomUUID(); const alternateDockRef = randomUUID();
    const context: TenantContext = { accountId: actorId, accountKind: 'TENANT_ADMIN', deviceId: 'onsite-db-test', organizationIds: [], permissionVersion: 1, tenantId, tokenId: randomUUID() };
    const command = () => ({ correlationId: randomUUID(), idempotencyKey: randomUUID(), ipAddress: '127.0.0.1' });
    const dockFacade = { listActive: async () => [
      { code: 'D-01', id: dockRef, maxVehicleLength: '20', maxVehicleWeight: '50000', name: '一号月台', serviceCapabilities: { serviceTypes: ['INBOUND'] }, temperatureCapabilities: ['AMBIENT'], version: 1, warehouseRef },
      { code: 'D-02', id: alternateDockRef, maxVehicleLength: '20', maxVehicleWeight: '50000', name: '二号月台', serviceCapabilities: { serviceTypes: ['INBOUND'] }, temperatureCapabilities: ['AMBIENT'], version: 1, warehouseRef },
    ] };
    const service = new OnsiteOperationsService(prisma as never, dockFacade as never);
    const createAppointment = () => prisma.appointment.create({ data: { appointmentNo: `APT-${randomUUID()}`, approvalPolicySnapshot: {}, createdBy: actorId, decidedAt: new Date(), requestedWindowFrom: new Date(Date.now() - 30 * 60_000), requestedWindowTo: new Date(Date.now() + 30 * 60_000), requesterPartyRef: 'PARTNER', requesterSnapshot: {}, serviceType: 'INBOUND', status: 'CONFIRMED', submittedAt: new Date(), tenantId, timeSlotId: randomUUID(), type: 'ORDER_LINKED', updatedBy: actorId, urgent: true, vehicleSnapshot: { plateNumber: '沪A12345' }, warehouseRef, workloadLaborHours: 1, workloadPallets: 1, workloadQuantity: 1, workloadQuantityUom: 'EA', workloadVehicles: 1 } });
    const first = await createAppointment(); const second = await createAppointment();
    const early = await service.verifyGate({ appointmentId: first.id, evidence: { credentialsValid: true, driverMatches: true, ordersValid: true, vehicleMatches: true }, identityType: 'APPOINTMENT_NO', identityValue: first.appointmentNo, manualRelease: false, observedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), policy: { allowEarly: false, allowLate: false, allowWalkIn: false, earlyGraceMinutes: 30, lateGraceMinutes: 30 } }, context, command());
    expect(early).toMatchObject({ arrivalClass: 'EARLY', status: 'REJECTED' });
    const walkIn = await service.verifyGate({ evidence: { credentialsValid: true, driverMatches: true, ordersValid: true, vehicleMatches: true }, identityType: 'PLATE', identityValue: '沪WALKIN', manualRelease: false, observedAt: new Date().toISOString(), policy: { allowEarly: false, allowLate: false, allowWalkIn: false, earlyGraceMinutes: 30, lateGraceMinutes: 30 } }, context, command());
    expect(walkIn.status).toBe('MANUAL_REVIEW');

    async function prepare(appointment: typeof first) {
      const verification = await service.verifyGate({ appointmentId: appointment.id, evidence: { credentialsValid: true, driverMatches: true, ordersValid: true, vehicleMatches: true }, identityType: 'QR_CODE', identityValue: `QR-${appointment.id}`, manualRelease: false, observedAt: new Date().toISOString(), policy: { allowEarly: false, allowLate: false, allowWalkIn: false, earlyGraceMinutes: 60, lateGraceMinutes: 60 } }, context, command());
      const pass = await service.issuePass(appointment.id, { gateVerificationId: verification.gateVerificationId, plateNumber: '沪A12345', validMinutes: 60 }, context, command());
      const entered = await service.access({ eventType: 'ENTRY', evidenceSnapshot: { gate: 'G1' }, token: pass.token }, context, command());
      expect(entered.decision).toBe('ALLOWED');
      const duplicate = await service.access({ eventType: 'ENTRY', evidenceSnapshot: { gate: 'G1' }, token: pass.token }, context, command());
      expect(duplicate).toMatchObject({ decision: 'DENIED', reason: 'DUPLICATE_ENTRY' });
      const current = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      const queued = await service.enqueue(appointment.id, { expectedVersion: current.version, onsiteAdjustment: 5, temperatureControlled: true }, context, command());
      const called = await service.call(queued.queueTicketId, { channels: ['DISPLAY','APP'], expectedVersion: 1, timeoutMinutes: 1 }, context, command());
      await prisma.queueTicket.update({ data: { callDeadlineAt: new Date(Date.now() - 1000) }, where: { id: queued.queueTicketId } });
      const timedOut = await service.timeoutCall(queued.queueTicketId, { escalationEvery: 1, expectedVersion: called.version }, context, command());
      expect(timedOut).toMatchObject({ escalationLevel: 1, status: 'DEFERRED' });
      const recalled = await service.call(queued.queueTicketId, { channels: ['VOICE'], expectedVersion: timedOut.version, timeoutMinutes: 1 }, context, command());
      const acknowledged = await service.acknowledgeCall(queued.queueTicketId, { expectedVersion: recalled.version }, context, command());
      return { appointmentVersion: queued.version, queueTicketId: queued.queueTicketId, queueVersion: acknowledged.version };
    }
    const [preparedFirst, preparedSecond] = [await prepare(first), await prepare(second)];
    const from = new Date(); const until = new Date(from.getTime() + 60 * 60_000);
    const assignments = await Promise.allSettled([
      service.assignDock(first.id, { assignedFrom: from.toISOString(), assignedUntil: until.toISOString(), expectedVersion: preparedFirst.appointmentVersion, requirements: { serviceType: 'INBOUND', temperatureZone: 'AMBIENT', vehicleLength: '12', vehicleWeight: '10000' } }, context, command()),
      service.assignDock(second.id, { assignedFrom: from.toISOString(), assignedUntil: until.toISOString(), expectedVersion: preparedSecond.appointmentVersion, requirements: { serviceType: 'INBOUND', temperatureZone: 'AMBIENT', vehicleLength: '12', vehicleWeight: '10000' } }, context, command()),
    ]);
    expect(assignments.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(assignments.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const active = await prisma.dockAssignment.findFirstOrThrow({ where: { dockRef, status: 'ACTIVE', tenantId } });
    const runtime = await prisma.dockRuntime.findUniqueOrThrow({ where: { tenantId_dockRef: { dockRef, tenantId } } });
    const fault = await service.setDockFault(dockRef, { expectedVersion: runtime.version, faulted: true, reason: '月台升降设备故障' }, context, command());
    expect(fault.status).toBe('FAULT');
    const switched = await service.switchDock(active.appointmentId, { expectedAssignmentVersion: active.version, reason: '故障转移', requirements: { serviceType: 'INBOUND', temperatureZone: 'AMBIENT', vehicleLength: '12', vehicleWeight: '10000' }, toDockRef: alternateDockRef }, context, command());
    expect(switched).toMatchObject({ dockRef: alternateDockRef, previousAssignmentId: active.id, status: 'ACTIVE' });
    expect(await prisma.dockAssignment.findUniqueOrThrow({ where: { id: active.id } })).toMatchObject({ releaseReason: '故障转移', status: 'SWITCHED' });
    expect(await prisma.dockRuntime.findUniqueOrThrow({ where: { tenantId_dockRef: { dockRef, tenantId } } })).toMatchObject({ status: 'FAULT' });
    expect(await prisma.dockRuntime.findUniqueOrThrow({ where: { tenantId_dockRef: { dockRef: alternateDockRef, tenantId } } })).toMatchObject({ status: 'OCCUPIED' });
    const accessFact = await prisma.gateAccessEvent.findFirstOrThrow({ where: { tenantId } });
    await expect(prisma.gateAccessEvent.delete({ where: { id: accessFact.id } })).rejects.toThrow(/immutable/i);
    const assignmentFact = await prisma.dockAssignmentEvent.findFirstOrThrow({ where: { dockAssignmentId: active.id, eventType: 'ASSIGNED' } });
    await expect(prisma.dockAssignmentEvent.delete({ where: { id: assignmentFact.id } })).rejects.toThrow(/immutable/i);
  });
});
