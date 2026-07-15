import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import type { BusinessEventInput } from '../platform/event.service';
import { EventService } from '../platform/event.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import { ControlTowerService } from './control-tower.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('Control tower event projections', () => {
  afterAll(() => prisma.$disconnect());

  it('projects cross-domain views exactly once with immutable tenant-scoped drill-downs', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'control-tower-database-test',
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
    const service = new ControlTowerService(
      prisma as never,
      new EventConsumptionFacade(
        new EventService(
          new IdempotencyService(prisma as never),
          prisma as never,
        ),
      ),
    );
    const businessRef = 'ORDER-P4-06-001';
    const occurredAt = new Date('2030-07-01T08:00:00.000Z').toISOString();
    const event = (
      aggregateType: string,
      aggregateId: string,
      aggregateVersion: number,
      eventType: string,
      controlView: Record<string, unknown>,
    ): BusinessEventInput => ({
      aggregateId,
      aggregateType,
      aggregateVersion,
      eventId: randomUUID(),
      eventType,
      occurredAt,
      payload: {
        attachments: ['proof://control/p4-06'],
        businessRef,
        causationId: randomUUID(),
        controlView: { ...controlView, businessRef },
        replayStatus: 'LIVE',
        summary: `${aggregateType} projected`,
      },
      schemaVersion: 1,
      traceId: 'control-tower-trace-p4-06',
    });

    const orderAggregateId = randomUUID();
    const orderEvent = event(
      'BusinessOrder',
      orderAggregateId,
      2,
      'oms.order-released.v1',
      {
        blockers: [{ code: 'POD_PENDING', severity: 'MEDIUM' }],
        completionRate: '0.65',
        currentStage: 'TRANSPORT',
        currentStatus: 'IN_TRANSIT',
        orderRef: businessRef,
        promisedAt: '2030-07-03T08:00:00.000Z',
        sourceVersions: { OMS: 2, WMS: 7 },
        stages: [
          { completed: true, name: 'CONFIRMATION' },
          { completed: false, name: 'TRANSPORT' },
        ],
        type: 'ORDER',
      },
    );
    const first = await service.consume(orderEvent, context, command());
    expect(first).toMatchObject({ duplicate: false, status: 'PROCESSED' });
    const duplicate = await service.consume(orderEvent, context, command());
    expect(duplicate).toMatchObject({ duplicate: true, status: 'PROCESSED' });
    await expect(
      service.consume(
        {
          ...orderEvent,
          payload: { ...orderEvent.payload, summary: 'conflicting replay' },
        },
        context,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_REPLAY_CONFLICT', statusCode: 409 });
    const ignoredOrder = await service.consume(
      {
        ...orderEvent,
        aggregateVersion: 1,
        eventId: randomUUID(),
      },
      context,
      command(),
    );
    expect(ignoredOrder).toMatchObject({ duplicate: false, status: 'IGNORED' });

    await service.consume(
      event('InventoryBalance', randomUUID(), 5, 'wms.inventory-changed.v1', {
        agingDays: 38,
        availableQuantity: '12',
        baseUom: 'EA',
        holdQuantity: '4',
        inTransitQuantity: '3',
        ownerRef: 'OWNER-01',
        productRef: 'SKU-01',
        regionRef: 'EAST',
        stockoutRisk: '0.82',
        turnoverDays: '31.5',
        type: 'INVENTORY',
        warehouseRef: 'WH-SHA',
      }),
      context,
      command(),
    );

    const shipmentAggregateId = randomUUID();
    const transportV1 = event(
      'Shipment',
      shipmentAggregateId,
      1,
      'tms.shipment-dispatched.v1',
      {
        currentNodeRef: 'NODE-SHA',
        delayed: false,
        etaAt: '2030-07-02T10:00:00.000Z',
        heatWeight: '2.5',
        latitude: '31.230416',
        longitude: '121.473701',
        nodes: ['NODE-SHA', 'NODE-SUZ'],
        routeRef: 'SHA-SUZ',
        shipmentRef: 'SHIP-P4-06-001',
        temperatureAlert: false,
        type: 'TRANSPORT',
        vehicleRef: '沪A-P406',
      },
    );
    await service.consume(transportV1, context, command());
    await service.consume(
      {
        ...transportV1,
        aggregateVersion: 2,
        eventId: randomUUID(),
        eventType: 'tms.shipment-delayed.v1',
        payload: {
          ...transportV1.payload,
          controlView: {
            ...(transportV1.payload.controlView as Record<string, unknown>),
            delayed: true,
            etaAt: '2030-07-02T13:00:00.000Z',
            temperatureAlert: true,
          },
          summary: 'Shipment delay projected',
        },
      },
      context,
      command(),
    );
    const ignoredTransport = await service.consume(
      { ...transportV1, eventId: randomUUID() },
      context,
      command(),
    );
    expect(ignoredTransport.status).toBe('IGNORED');

    await service.consume(
      event('AppointmentDock', randomUUID(), 3, 'ams.dock-updated.v1', {
        arrivedToday: 14,
        dockRef: 'DOCK-08',
        futureCapacity: '24',
        lateCount: 2,
        noShowCount: 1,
        occupied: true,
        operationMinutes: 47,
        queueCount: 5,
        tmsReferences: ['SHIP-P4-06-001'],
        type: 'YARD',
        warehouseRef: 'WH-SHA',
        wmsReferences: ['ASN-P4-06-001'],
      }),
      context,
      command(),
    );

    const approximate = await service.workbench(context);
    expect(approximate.orders[0]).toMatchObject({
      businessRef,
      currentStage: 'TRANSPORT',
      currentStatus: 'IN_TRANSIT',
    });
    expect(approximate.inventory[0]).toMatchObject({
      productRef: 'SKU-01',
      stockoutRisk: '0.82',
      warehouseRef: 'WH-SHA',
    });
    expect(approximate.transport[0]).toMatchObject({
      delayed: true,
      latitude: '31.23',
      locationPrecision: 'APPROXIMATE',
      longitude: '121.47',
      sourceVersion: 2,
      temperatureAlert: true,
    });
    expect(approximate.transportHeat).toEqual([
      { routeRef: 'SHA-SUZ', weight: 2.5 },
    ]);
    expect(approximate.yards[0]).toMatchObject({
      dockRef: 'DOCK-08',
      queueCount: 5,
    });
    const exact = await service.workbench(context, true);
    expect(exact.transport[0]).toMatchObject({
      latitude: '31.230416',
      locationPrecision: 'EXACT',
      longitude: '121.473701',
    });

    const timeline = await service.timeline(businessRef, context);
    expect(timeline.items).toHaveLength(5);
    expect(timeline.items[0]).toMatchObject({
      attachmentSnapshot: { attachments: ['proof://control/p4-06'] },
      causationId: expect.any(String),
      replayStatus: 'LIVE',
      traceId: 'control-tower-trace-p4-06',
    });
    expect(new Set(timeline.items.map((item) => item.sourceDomain))).toEqual(
      new Set(['AMS', 'OMS', 'TMS', 'WMS']),
    );

    const otherTenant: TenantContext = {
      ...context,
      tenantId: randomUUID(),
      tokenId: randomUUID(),
    };
    const isolated = await service.workbench(otherTenant);
    expect(isolated).toMatchObject({
      inventory: [],
      orders: [],
      timeline: [],
      transport: [],
      yards: [],
    });

    await expect(
      prisma.controlTimelineEvent.update({
        data: { summary: 'illegal mutation' },
        where: { id: timeline.items[0]!.id },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.transportNetworkView.delete({
        where: {
          tenantId_shipmentRef: {
            shipmentRef: 'SHIP-P4-06-001',
            tenantId,
          },
        },
      }),
    ).rejects.toThrow(/cannot be deleted/);
  });
});
