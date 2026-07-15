import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { CalendarReleaseFacade } from '../mdm/public/calendar-release.facade';
import type { BusinessEventInput } from '../platform/event.service';
import { EventService } from '../platform/event.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import {
  AlertGovernanceService,
  type PublishAlertRuleInput,
} from './alert-governance.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('Control SLA and alert governance', () => {
  afterAll(() => prisma.$disconnect());

  it('governs clocks, rule windows, routed cases, escalation and immutable knowledge', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const customerRef = 'CUSTOMER-P4-07';
    const ownerRef = randomUUID();
    const supervisorRef = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'control-alert-database-test',
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
    await prisma.businessCalendar.create({
      data: {
        code: 'CONTROL_SLA',
        createdBy: actorId,
        effectiveFrom: new Date('2020-01-01'),
        name: 'Control SLA calendar',
        publishedAt: new Date(),
        status: 'ACTIVE',
        tenantId,
        timeZone: 'UTC',
        updatedBy: actorId,
        versionNumber: 1,
        workingDays: [0, 1, 2, 3, 4, 5, 6],
      },
    });
    const service = new AlertGovernanceService(
      prisma as never,
      new CalendarReleaseFacade(prisma as never),
      new EventConsumptionFacade(
        new EventService(
          new IdempotencyService(prisma as never),
          prisma as never,
        ),
      ),
    );

    const started = await service.startSla(
      {
        businessRef: 'ORDER-P4-07-SLA',
        calendarCode: 'CONTROL_SLA',
        customerRef,
        durationMinutes: 10,
        milestone: 'DELIVERY',
        organizationRef: 'OPS-EAST',
        responsibleDomain: 'TMS',
        sourceVersion: 1,
        startedAt: '2030-07-07T08:00:00.000Z',
        warningLeadMinutes: 2,
      },
      context,
      command(),
    );
    expect(started).toMatchObject({
      applied: true,
      status: 'ACTIVE',
      version: 1,
    });
    const staleStart = await service.startSla(
      {
        businessRef: 'ORDER-P4-07-SLA',
        calendarCode: 'CONTROL_SLA',
        customerRef,
        durationMinutes: 10,
        milestone: 'DELIVERY',
        responsibleDomain: 'TMS',
        sourceVersion: 1,
        warningLeadMinutes: 2,
      },
      context,
      command(),
    );
    expect(staleStart).toMatchObject({ applied: false, version: 1 });
    const paused = await service.transitionSla(
      started.clockId,
      {
        expectedVersion: 1,
        reason: '等待客户卸货窗口',
        sourceVersion: 2,
        targetStatus: 'PAUSED',
      },
      context,
      command(),
    );
    expect(paused).toMatchObject({ status: 'PAUSED', version: 2 });
    const stalePause = await service.transitionSla(
      started.clockId,
      {
        expectedVersion: 2,
        reason: '重复暂停事件',
        sourceVersion: 2,
        targetStatus: 'PAUSED',
      },
      context,
      command(),
    );
    expect(stalePause).toMatchObject({ applied: false, status: 'PAUSED' });
    const resumed = await service.transitionSla(
      started.clockId,
      {
        expectedVersion: 2,
        sourceVersion: 3,
        targetStatus: 'ACTIVE',
      },
      context,
      command(),
    );
    expect(resumed).toMatchObject({ status: 'ACTIVE', version: 3 });
    const monitored = await service.monitorSla(
      { now: '2030-07-07T09:00:00.000Z' },
      context,
      command(),
    );
    expect(monitored).toEqual({ breached: 1, warned: 0 });
    const breachedClock = await prisma.controlSlaClock.findUniqueOrThrow({
      where: { id: started.clockId },
    });
    expect(breachedClock.status).toBe('BREACHED');
    await expect(
      service.transitionSla(
        started.clockId,
        {
          expectedVersion: breachedClock.version,
          reason: 'terminal pause',
          sourceVersion: 4,
          targetStatus: 'PAUSED',
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'CONTROL_SLA_TRANSITION_INVALID' });
    const reopened = await service.reopenSla(
      started.clockId,
      {
        calendarCode: 'CONTROL_SLA',
        durationMinutes: 30,
        expectedVersion: breachedClock.version,
        reason: '客户重新开放收货窗口',
        sourceVersion: 4,
        warningLeadMinutes: 5,
      },
      context,
      command(),
    );
    expect(reopened).toMatchObject({ applied: true, status: 'ACTIVE' });

    const commonRule: PublishAlertRuleInput = {
      channels: ['IN_APP', 'EMAIL'],
      code: 'SHIPMENT_DELAY',
      condition: {
        attributes: { region: 'EAST' },
        eventTypes: ['tms.shipment-delayed.v1'],
        metrics: [{ field: 'temperature', operator: 'GT', value: '8' }],
        minimumDurationSeconds: 60,
        statuses: ['DELAYED'],
      },
      debounceSeconds: 0,
      dueMinutes: 1,
      escalationMinutes: 1,
      mergeWindowSeconds: 3600,
      name: 'Shipment delay and temperature alert',
      organizationRef: 'OPS-EAST',
      ownerRef,
      responsibleDomain: 'TMS',
      severity: 'HIGH',
      shiftCode: 'DAY',
      supervisorRef,
      suppressionSeconds: 0,
    };
    const ruleV1 = await service.publishRule(commonRule, context, command());
    const ruleV2 = await service.publishRule(
      { ...commonRule, severity: 'CRITICAL' },
      context,
      command(),
    );
    expect(ruleV2).toMatchObject({ versionNumber: 2 });
    await service.publishRule(
      {
        ...commonRule,
        code: 'SHIPMENT_DELAY_SUPPRESSED',
        name: 'Suppressed duplicate shipment delay',
        suppressionSeconds: 3600,
      },
      context,
      command(),
    );
    await service.publishRule(
      {
        ...commonRule,
        code: 'SHIPMENT_DELAY_DEBOUNCED',
        debounceSeconds: 60,
        name: 'Debounced shipment delay',
      },
      context,
      command(),
    );
    await service.publishRule(
      {
        ...commonRule,
        code: 'CUSTOMER_OVERRIDE',
        name: 'Tenant default',
        severity: 'LOW',
      },
      context,
      command(),
    );
    await service.publishRule(
      {
        ...commonRule,
        code: 'CUSTOMER_OVERRIDE',
        customerRef,
        name: 'Customer override',
        severity: 'CRITICAL',
      },
      context,
      command(),
    );

    const aggregateId = randomUUID();
    const alertEvent = (
      aggregateVersion: number,
      occurredAt: string,
      eventAggregateId = aggregateId,
    ): BusinessEventInput => ({
      aggregateId: eventAggregateId,
      aggregateType: 'Shipment',
      aggregateVersion,
      eventId: randomUUID(),
      eventType: 'tms.shipment-delayed.v1',
      occurredAt,
      payload: {
        alertContext: {
          attributes: { region: 'EAST' },
          businessRef: 'SHIP-P4-07-001',
          customerRef,
          dedupeKey: 'SHIPMENT:SHIP-P4-07-001',
          description: 'Temperature excursion with ETA delay',
          durationSeconds: 180,
          metrics: { temperature: '9.5' },
          organizationRef: 'OPS-EAST',
          status: 'DELAYED',
          title: '运输延误与温控异常',
        },
      },
      schemaVersion: 1,
      traceId: 'control-alert-trace-p4-07',
    });
    const firstEvent = alertEvent(2, '2030-07-07T10:00:00.000Z');
    const first = await service.consumeAlertEvent(
      firstEvent,
      context,
      command(),
    );
    expect(first).toMatchObject({ duplicate: false, status: 'PROCESSED' });
    const duplicate = await service.consumeAlertEvent(
      firstEvent,
      context,
      command(),
    );
    expect(duplicate).toMatchObject({ duplicate: true, status: 'PROCESSED' });
    await expect(
      service.consumeAlertEvent(
        { ...firstEvent, payload: { alertContext: { status: 'CONFLICT' } } },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_REPLAY_CONFLICT', statusCode: 409 });
    const old = await service.consumeAlertEvent(
      alertEvent(1, '2030-07-07T10:00:30.000Z'),
      context,
      command(),
    );
    expect(old.status).toBe('PROCESSED');
    const second = await service.consumeAlertEvent(
      alertEvent(3, '2030-07-07T10:01:01.000Z'),
      context,
      command(),
    );
    expect(second.status).toBe('PROCESSED');
    const concurrent = await Promise.all([
      service.consumeAlertEvent(
        alertEvent(1, '2030-07-07T10:02:00.000Z', randomUUID()),
        context,
        command(),
      ),
      service.consumeAlertEvent(
        alertEvent(1, '2030-07-07T10:03:00.000Z', randomUUID()),
        context,
        command(),
      ),
    ]);
    expect(concurrent.every((result) => result.status === 'PROCESSED')).toBe(
      true,
    );

    const cases = await prisma.controlAlertCase.findMany({
      where: { businessRef: 'SHIP-P4-07-001', tenantId },
    });
    expect(cases.filter(({ ruleVersionId }) => ruleVersionId).length).toBe(4);
    const mergeCase = cases.find(
      ({ ruleVersionId }) => ruleVersionId === ruleV2.ruleVersionId,
    )!;
    expect(mergeCase).toMatchObject({
      ownerRef,
      responsibleDomain: 'TMS',
      severity: 'CRITICAL',
      status: 'OPEN',
      supervisorRef,
      triggerCount: 5,
    });
    const overrideCase = cases.find(({ severity }) => severity === 'CRITICAL');
    expect(overrideCase).toBeDefined();
    expect(
      await prisma.controlAlertCase.count({
        where: {
          businessRef: 'SHIP-P4-07-001',
          severity: 'LOW',
          tenantId,
        },
      }),
    ).toBe(0);
    const suppressedRule = await prisma.controlAlertRule.findFirstOrThrow({
      where: {
        code: 'SHIPMENT_DELAY_SUPPRESSED',
        tenantId,
      },
    });
    const suppressedVersion =
      await prisma.controlAlertRuleVersion.findFirstOrThrow({
        where: { ruleId: suppressedRule.id, tenantId },
      });
    const suppressedSignal = await prisma.controlAlertSignal.findFirstOrThrow({
      where: {
        ruleVersionId: suppressedVersion.id,
        tenantId,
      },
    });
    expect(suppressedSignal.occurrenceCount).toBeGreaterThan(1);

    const reassignedOwner = randomUUID();
    const assigned = await service.assignCase(
      mergeCase.id,
      {
        expectedVersion: mergeCase.version,
        ownerRef: reassignedOwner,
        reason: '夜班责任路由调整',
      },
      context,
      command(),
    );
    expect(assigned.ownerRef).toBe(reassignedOwner);
    const remediation = await service.requestRemediation(
      mergeCase.id,
      {
        command: { expectedVersion: 7, newEta: '2030-07-07T12:00:00.000Z' },
        commandType: 'tms.shipment.update-eta.v1',
        reason: '按领域命令重新计算 ETA',
        targetDomain: 'TMS',
        targetRef: 'SHIP-P4-07-001',
      },
      context,
      command(),
    );
    expect(remediation.status).toBe('REQUESTED');
    let current = await prisma.controlAlertCase.findUniqueOrThrow({
      where: { id: mergeCase.id },
    });
    const acknowledged = await service.actionCase(
      current.id,
      { action: 'ACKNOWLEDGE', expectedVersion: current.version },
      context,
      command(),
    );
    expect(acknowledged.status).toBe('ACKNOWLEDGED');
    current = await prisma.controlAlertCase.findUniqueOrThrow({
      where: { id: current.id },
    });
    await service.actionCase(
      current.id,
      { action: 'START', expectedVersion: current.version },
      context,
      command(),
    );
    current = await prisma.controlAlertCase.findUniqueOrThrow({
      where: { id: current.id },
    });
    await expect(
      service.actionCase(
        current.id,
        {
          action: 'CLOSE',
          expectedVersion: current.version,
          responsibleParty: 'Carrier',
          rootCauseCode: 'TEMP_SENSOR',
          solution: 'Replace sensor',
          verification: { passed: true },
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'CONTROL_ALERT_TRANSITION_INVALID' });
    await service.actionCase(
      current.id,
      {
        action: 'RESOLVE',
        expectedVersion: current.version,
        resolution: '更换传感器并重新计算 ETA',
        verified: true,
      },
      context,
      command(),
    );
    current = await prisma.controlAlertCase.findUniqueOrThrow({
      where: { id: current.id },
    });
    const closed = await service.actionCase(
      current.id,
      {
        action: 'CLOSE',
        expectedVersion: current.version,
        improvement: { supplierTraining: true },
        responsibleParty: 'CARRIER-OPS',
        rootCauseCode: 'TEMP_SENSOR',
        solution: '更换传感器并增加发车前自检',
        verification: { passed: true, reviewer: actorId },
      },
      context,
      command(),
    );
    expect(closed.status).toBe('CLOSED');

    const articleV1 = await service.publishKnowledge(
      {
        articleCode: 'KB-TEMP-SENSOR',
        content: { diagnosis: '先校验设备心跳，再比对外部温度计' },
        recommendations: { rule: '发车前设备自检' },
        rootCauseCode: 'TEMP_SENSOR',
        sourceCaseIds: [mergeCase.id],
        title: '温控传感器异常处置',
      },
      context,
      command(),
    );
    const articleV2 = await service.publishKnowledge(
      {
        articleCode: 'KB-TEMP-SENSOR',
        content: { diagnosis: '增加连续三点比对' },
        recommendations: { training: '承运商设备培训' },
        rootCauseCode: 'TEMP_SENSOR',
        sourceCaseIds: [mergeCase.id],
        title: '温控传感器异常处置 V2',
      },
      context,
      command(),
    );
    expect(articleV1.versionNumber).toBe(1);
    expect(articleV2.versionNumber).toBe(2);

    const escalationTarget = cases.find(
      ({ id, status }) => id !== mergeCase.id && status === 'OPEN',
    )!;
    const escalated = await service.monitorEscalations(
      { now: '2030-07-07T10:10:00.000Z' },
      context,
      command(),
    );
    expect(escalated.escalated).toBeGreaterThan(0);
    expect(
      await prisma.controlEscalationEvent.count({
        where: { alertCaseId: escalationTarget.id, tenantId },
      }),
    ).toBeGreaterThanOrEqual(1);

    const view = await service.workbench(context, 'TEMP');
    expect(view.rootCauses).toHaveLength(1);
    expect(view.knowledge).toHaveLength(2);
    expect(view.remediations).toHaveLength(1);
    const isolated = await service.workbench(
      { ...context, tenantId: randomUUID(), tokenId: randomUUID() },
      'TEMP',
    );
    expect(isolated).toMatchObject({
      cases: [],
      clocks: [],
      knowledge: [],
      rootCauses: [],
      rules: [],
    });

    await expect(
      prisma.controlAlertRuleVersion.update({
        data: { debounceSeconds: 999 },
        where: { id: ruleV1.ruleVersionId },
      }),
    ).rejects.toThrow(/immutable/);
    const rootCause = await prisma.controlRootCauseRecord.findFirstOrThrow({
      where: { alertCaseId: mergeCase.id, tenantId },
    });
    await expect(
      prisma.controlRootCauseRecord.delete({ where: { id: rootCause.id } }),
    ).rejects.toThrow(/immutable/);
    const slaEvent = await prisma.controlSlaEvent.findFirstOrThrow({
      where: { slaClockId: started.clockId, tenantId },
    });
    await expect(
      prisma.controlSlaEvent.update({
        data: { reason: 'illegal mutation' },
        where: { id: slaEvent.id },
      }),
    ).rejects.toThrow(/immutable/);
  });
});
