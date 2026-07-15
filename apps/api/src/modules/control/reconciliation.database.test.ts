import { randomUUID } from 'node:crypto';
import { PrismaClient, type ControlReconciliationType } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { BusinessEventInput } from '../platform/event.service';
import { EventService } from '../platform/event.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { JobService } from '../platform/job.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import { JobSchedulingFacade } from '../platform/public/job-scheduling.facade';
import { ReconciliationService } from './reconciliation.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('Control daily cross-domain reconciliations', () => {
  afterAll(() => prisma.$disconnect());

  it('schedules all four jobs and preserves immutable matched and exception evidence', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'control-reconciliation-database-test',
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
    const queue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      scheduleDefinition: vi.fn().mockResolvedValue(undefined),
    };
    const scheduling = new JobSchedulingFacade(
      new JobService(
        new IdempotencyService(prisma as never),
        queue as never,
        prisma as never,
      ),
    );
    const service = new ReconciliationService(
      prisma as never,
      new EventConsumptionFacade(
        new EventService(
          new IdempotencyService(prisma as never),
          prisma as never,
        ),
      ),
      scheduling,
    );

    const bootstrapped = await service.bootstrapSchedules(context, command());
    expect(bootstrapped.scheduleCount).toBe(4);
    expect(queue.scheduleDefinition).toHaveBeenCalledTimes(4);
    expect(
      await prisma.jobDefinition.findMany({
        orderBy: { code: 'asc' },
        select: {
          code: true,
          cronExpression: true,
          handler: true,
          triggerType: true,
        },
        where: { tenantId },
      }),
    ).toEqual(
      [
        'BILLING_VOUCHER',
        'INVENTORY_MOVEMENT',
        'ORDER_FULFILLMENT',
        'SHIPMENT_POD',
      ].map((type) => ({
        code: `CONTROL.DAILY_RECONCILIATION.${type}`,
        cronExpression: '0 2 * * *',
        handler: 'RECONCILIATION',
        triggerType: 'CRON',
      })),
    );
    const bootstrappedAgain = await service.bootstrapSchedules(
      context,
      command(),
    );
    expect(bootstrappedAgain.scheduleCount).toBe(4);
    expect(queue.scheduleDefinition).toHaveBeenCalledTimes(4);

    const event = (
      type: ControlReconciliationType,
      side: 'SOURCE' | 'TARGET',
      businessRef: string,
      metrics: Record<string, unknown>,
      aggregateId = randomUUID(),
      aggregateVersion = 2,
    ): BusinessEventInput => ({
      aggregateId,
      aggregateType: `${type}.${side}`,
      aggregateVersion,
      eventId: randomUUID(),
      eventType: `${side === 'SOURCE' ? 'oms' : 'wms'}.reconciliation-observed.v1`,
      occurredAt: '2030-07-10T10:00:00.000Z',
      payload: {
        businessRef,
        reconciliation: {
          businessRef,
          metrics,
          side,
          sourceDomain: side === 'SOURCE' ? 'OMS' : 'WMS',
          sourceVersion: aggregateVersion,
          type,
        },
      },
      schemaVersion: 1,
      traceId: 'control-reconciliation-p4-09',
    });
    const types: readonly ControlReconciliationType[] = [
      'ORDER_FULFILLMENT',
      'INVENTORY_MOVEMENT',
      'SHIPMENT_POD',
      'BILLING_VOUCHER',
    ];
    let replayEvent: BusinessEventInput | undefined;
    for (const type of types) {
      const matchedRef = `${type}-MATCHED`;
      const mismatchRef = `${type}-MISMATCH`;
      const matchedMetrics = { amount: '10', count: 1, status: 'COMPLETED' };
      const source = event(type, 'SOURCE', matchedRef, matchedMetrics);
      replayEvent ??= source;
      await service.consumeObservation(source, context, command());
      await service.consumeObservation(
        event(type, 'TARGET', matchedRef, matchedMetrics),
        context,
        command(),
      );
      await service.consumeObservation(
        event(type, 'SOURCE', mismatchRef, {
          amount: '12',
          count: 2,
          status: 'COMPLETED',
        }),
        context,
        command(),
      );
      await service.consumeObservation(
        event(type, 'TARGET', mismatchRef, {
          amount: '11',
          count: 1,
          status: 'PENDING',
        }),
        context,
        command(),
      );
    }
    expect(
      await service.consumeObservation(replayEvent!, context, command()),
    ).toMatchObject({ duplicate: true, status: 'PROCESSED' });
    await expect(
      service.consumeObservation(
        {
          ...replayEvent!,
          payload: { ...replayEvent!.payload, conflict: true },
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_REPLAY_CONFLICT', statusCode: 409 });
    expect(
      await service.consumeObservation(
        {
          ...replayEvent!,
          aggregateVersion: 1,
          eventId: randomUUID(),
          payload: {
            ...replayEvent!.payload,
            reconciliation: {
              ...(replayEvent!.payload.reconciliation as Record<
                string,
                unknown
              >),
              sourceVersion: 1,
            },
          },
        },
        context,
        command(),
      ),
    ).toMatchObject({ status: 'IGNORED' });

    for (const type of types) {
      const input = {
        periodEnd: '2030-07-11T00:00:00.000Z',
        periodStart: '2030-07-10T00:00:00.000Z',
        triggerRef: `daily-2030-07-10-${type}`,
        type,
      };
      expect(await service.run(input, context, command())).toMatchObject({
        differenceCount: 1,
        duplicate: false,
        matchedCount: 1,
        status: 'COMPLETED',
      });
      expect(await service.run(input, context, command())).toMatchObject({
        differenceCount: 1,
        duplicate: true,
        matchedCount: 1,
        status: 'COMPLETED',
      });
      await expect(
        service.run(
          { ...input, periodStart: '2030-07-09T00:00:00.000Z' },
          context,
          command(),
        ),
      ).rejects.toMatchObject({
        code: 'CONTROL_RECONCILIATION_TRIGGER_CONFLICT',
        statusCode: 409,
      });
    }
    expect(
      await prisma.controlReconciliationItem.groupBy({
        _count: { _all: true },
        by: ['outcome'],
        orderBy: { outcome: 'asc' },
        where: { tenantId },
      }),
    ).toEqual([
      { _count: { _all: 4 }, outcome: 'MATCHED' },
      { _count: { _all: 4 }, outcome: 'MISMATCH' },
    ]);
    const cases = await prisma.controlReconciliationCase.findMany({
      orderBy: { reconciliationType: 'asc' },
      where: { tenantId },
    });
    expect(cases).toHaveLength(4);
    expect(cases.every(({ status }) => status === 'OPEN')).toBe(true);
    const resolved = await service.resolveCase(
      cases[0]!.id,
      {
        expectedVersion: cases[0]!.version,
        resolution: '已补齐目标域事实并由责任人复核',
      },
      context,
      command(),
    );
    expect(resolved).toMatchObject({ status: 'RESOLVED', version: 2 });
    await expect(
      service.resolveCase(
        cases[0]!.id,
        { expectedVersion: 2, resolution: '重复关闭' },
        context,
        command(),
      ),
    ).rejects.toMatchObject({
      code: 'CONTROL_RECONCILIATION_CASE_TRANSITION_INVALID',
      statusCode: 409,
    });

    const observation =
      await prisma.controlReconciliationObservation.findFirstOrThrow({
        where: { tenantId },
      });
    const item = await prisma.controlReconciliationItem.findFirstOrThrow({
      where: { tenantId },
    });
    const run = await prisma.controlReconciliationRun.findFirstOrThrow({
      where: { tenantId },
    });
    await expect(
      prisma.controlReconciliationObservation.update({
        data: { sourceDomain: 'MUTATED' },
        where: { id: observation.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.controlReconciliationItem.delete({ where: { id: item.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.controlReconciliationRun.update({
        data: { matchedCount: 99 },
        where: { id: run.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.controlReconciliationCase.update({
        data: { resolution: 'MUTATED' },
        where: { id: cases[0]!.id },
      }),
    ).rejects.toThrow();

    const workbench = await service.workbench(context);
    expect(workbench).toMatchObject({
      cases: expect.any(Array),
      observations: expect.any(Array),
      runs: expect.any(Array),
      schedules: expect.any(Array),
    });
    expect(workbench.runs).toHaveLength(4);
    expect(workbench.schedules).toHaveLength(4);
    const isolated = await service.workbench({
      ...context,
      accountId: randomUUID(),
      tenantId: randomUUID(),
    });
    expect(isolated.runs).toEqual([]);
    expect(isolated.cases).toEqual([]);
    expect(isolated.observations).toEqual([]);
    expect(isolated.schedules).toEqual([]);
  });
});
