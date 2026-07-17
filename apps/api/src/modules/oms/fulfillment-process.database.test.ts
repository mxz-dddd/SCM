import { randomUUID } from 'node:crypto';
import { PrismaClient, type PlatformOutbox } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { ControlTowerService } from '../control/control-tower.service';
import { CalendarReleaseFacade } from '../mdm/public/calendar-release.facade';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import {
  EventService,
  type BusinessEventInput,
} from '../platform/event.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import { TmsEventConsumerService } from '../tms/tms-event-consumer.service';
import { TransportOrderService } from '../tms/transport-order.service';
import { InventoryService } from '../wms/inventory.service';
import { OutboundService } from '../wms/outbound.service';
import { WmsEventConsumerService } from '../wms/wms-event-consumer.service';
import { FulfillmentProcessService } from './fulfillment-process.service';
import { FulfillmentReleaseService } from './fulfillment-release.service';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

databaseDescribe('V2 OMS to WMS/TMS fulfillment orchestration', () => {
  afterAll(() => prisma.$disconnect());

  function envelope(row: PlatformOutbox): BusinessEventInput {
    return {
      aggregateId: row.aggregateId,
      aggregateType: row.aggregateType,
      aggregateVersion: row.aggregateVersion,
      eventId: row.id,
      eventType: row.eventName,
      occurredAt: row.occurredAt.toISOString(),
      payload: row.payload as Record<string, unknown>,
      schemaVersion: row.schemaVersion,
      traceId: row.traceId ?? row.correlationId,
    };
  }

  async function fixture() {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const warehouseId = randomUUID();
    const ownerId = randomUUID();
    const productId = randomUUID();
    const context: TenantContext = {
      accountId: actorId,
      accountKind: 'TENANT_ADMIN',
      deviceId: 'v2-fulfillment-e2e',
      organizationIds: [],
      permissionVersion: 1,
      tenantId,
      tokenId: randomUUID(),
    };
    const metadata = (key: string = randomUUID()) => ({
      correlationId: randomUUID(),
      idempotencyKey: key,
      ipAddress: '127.0.0.1',
    });
    await prisma.partner.create({
      data: {
        code: 'CUSTOMER',
        createdBy: actorId,
        id: ownerId,
        legalName: 'V2 Customer',
        status: 'ACTIVE',
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.product.create({
      data: {
        baseUom: 'EA',
        createdBy: actorId,
        currentVersionNumber: 1,
        id: productId,
        name: 'V2 Product',
        sku: 'V2-SKU',
        status: 'ACTIVE',
        tenantId,
        updatedBy: actorId,
      },
    });
    await prisma.productVersion.create({
      data: {
        createdBy: actorId,
        productId,
        sku: 'V2-SKU',
        snapshot: { baseUom: 'EA', sku: 'V2-SKU' },
        tenantId,
        updatedBy: actorId,
        versionNumber: 1,
      },
    });
    const calendar = await prisma.businessCalendar.create({
      data: {
        code: 'V2_RELEASE',
        createdBy: actorId,
        effectiveFrom: new Date('2020-01-01'),
        effectiveUntil: new Date('2030-12-31'),
        name: 'V2 release calendar',
        publishedAt: new Date(),
        status: 'ACTIVE',
        tenantId,
        timeZone: 'Asia/Shanghai',
        updatedBy: actorId,
        versionNumber: 1,
        workingDays: [0, 1, 2, 3, 4, 5, 6],
      },
    });
    await prisma.workingWindow.create({
      data: {
        calendarId: calendar.id,
        createdBy: actorId,
        cutoffTime: '23:59',
        resourceId: warehouseId,
        resourceType: 'WAREHOUSE',
        tenantId,
        updatedBy: actorId,
      },
    });
    const eventService = new EventService(
      new IdempotencyService(prisma as never),
      prisma as never,
    );
    const eventFacade = new EventConsumptionFacade(eventService);
    const mdm = new MdmReferenceService(prisma as never);
    const outbound = new OutboundService(
      prisma as never,
      mdm,
      new InventoryService(prisma as never, mdm),
    );
    const transport = new TransportOrderService(prisma as never);
    return {
      actorId,
      context,
      eventFacade,
      metadata,
      ownerId,
      process: new FulfillmentProcessService(prisma as never, eventFacade),
      release: new FulfillmentReleaseService(
        prisma as never,
        new CalendarReleaseFacade(prisma as never),
      ),
      tenantId,
      tms: new TmsEventConsumerService(eventFacade, transport),
      transport,
      warehouseId,
      wms: new WmsEventConsumerService(eventFacade, outbound),
      productId,
    };
  }

  async function allocatedOrder(
    data: Awaited<ReturnType<typeof fixture>>,
    suffix: string,
  ) {
    const rawId = randomUUID();
    await prisma.rawMessageRef.create({
      data: {
        channel: 'API',
        contentHash: suffix.padEnd(64, 'a'),
        createdBy: data.actorId,
        externalOrderNo: `SO-${suffix}`,
        externalVersion: '1',
        id: rawId,
        mappingVersion: 'v2-test',
        rawPayload: {},
        tenantId: data.tenantId,
        updatedBy: data.actorId,
      },
    });
    const order = await prisma.businessOrder.create({
      data: {
        channel: 'API',
        createdBy: data.actorId,
        customerId: data.ownerId,
        customerSnapshot: { code: 'CUSTOMER', legalName: 'V2 Customer' },
        deliveryAddressSnapshot: {
          countryCode: 'CN',
          line1: 'Shanghai destination',
        },
        externalOrderNo: `SO-${suffix}`,
        id: randomUUID(),
        mappingVersion: 'v2-test',
        orderNo: `ORD-${suffix}`,
        rawMessageRefId: rawId,
        requestedFrom: new Date(Date.now() + 3_600_000),
        requestedUntil: new Date(Date.now() + 86_400_000),
        sourcePayloadHash: suffix.padEnd(64, 'b'),
        status: 'ALLOCATED',
        tenantId: data.tenantId,
        type: 'SALES',
        updatedBy: data.actorId,
      },
    });
    const line = await prisma.businessOrderLine.create({
      data: {
        baseUom: 'EA',
        createdBy: data.actorId,
        id: randomUUID(),
        lineNo: 1,
        lineVersion: 1,
        orderId: order.id,
        originalUom: 'BOX',
        productId: data.productId,
        productSnapshot: { baseUom: 'EA', sku: 'V2-SKU' },
        quantityBase: '6',
        quantityOriginal: '1',
        tenantId: data.tenantId,
        updatedBy: data.actorId,
      },
    });
    await prisma.orderAllocation.create({
      data: {
        baseUom: 'EA',
        businessOrderId: order.id,
        createdBy: data.actorId,
        decisionId: randomUUID(),
        id: randomUUID(),
        orderLineId: line.id,
        originalUom: 'BOX',
        ownerId: data.ownerId,
        productId: data.productId,
        projectionId: randomUUID(),
        quantityBase: '6',
        quantityOriginal: '1',
        reservationKey: `${order.id}:1`,
        reservedAt: new Date(),
        status: 'RESERVED',
        tenantId: data.tenantId,
        updatedBy: data.actorId,
        warehouseId: data.warehouseId,
      },
    });
    return order;
  }

  async function releaseEvents(
    data: Awaited<ReturnType<typeof fixture>>,
    suffix: string,
  ) {
    const order = await allocatedOrder(data, suffix);
    const result = await data.release.release(
      order.id,
      {
        calendarCode: 'V2_RELEASE',
        expectedVersion: order.version,
        serviceLevel: 'EXPRESS',
        volume: '2',
        volumeUom: 'M3',
        weight: '12',
        weightUom: 'KG',
      },
      data.context,
      data.metadata(),
    );
    const [fulfillment, shipment] = await Promise.all([
      prisma.platformOutbox.findFirstOrThrow({
        where: {
          aggregateId: result.fulfillmentIds[0]!,
          eventName: 'fulfillment.released.v2',
          tenantId: data.tenantId,
        },
      }),
      prisma.platformOutbox.findFirstOrThrow({
        where: {
          aggregateId: result.shipmentRequestIds[0]!,
          eventName: 'shipment.requested.v2',
          tenantId: data.tenantId,
        },
      }),
    ]);
    return { fulfillment, order, processId: result.processId, shipment };
  }

  async function applyProcessEvents(
    data: Awaited<ReturnType<typeof fixture>>,
    eventNames: readonly string[],
  ) {
    const rows = await prisma.platformOutbox.findMany({
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      where: { eventName: { in: [...eventNames] }, tenantId: data.tenantId },
    });
    for (const row of rows)
      await data.process.consume(
        envelope(row),
        data.context,
        data.metadata(`${row.id}:oms-process`),
      );
  }

  it('creates each downstream object once and survives one TMS retry independently', async () => {
    const data = await fixture();
    const released = await releaseEvents(data, randomUUID().slice(0, 8));
    await data.wms.consume(
      envelope(released.fulfillment),
      data.context,
      data.metadata(`${released.fulfillment.id}:wms`),
    );
    await data.wms.consume(
      envelope(released.fulfillment),
      data.context,
      data.metadata(`${released.fulfillment.id}:wms`),
    );
    let failedOnce = false;
    const flaky = new TmsEventConsumerService(data.eventFacade, {
      findBySource: (
        ...args: Parameters<TransportOrderService['findBySource']>
      ) => data.transport.findBySource(...args),
      receive: (...args: Parameters<TransportOrderService['receive']>) => {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error('simulated TMS outage');
        }
        return data.transport.receive(...args);
      },
    } as never);
    await expect(
      flaky.consume(
        envelope(released.shipment),
        data.context,
        data.metadata(`${released.shipment.id}:tms`),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_HANDLER_FAILED' });
    await flaky.consume(
      envelope(released.shipment),
      data.context,
      data.metadata(`${released.shipment.id}:tms`),
    );
    expect(
      await prisma.outboundOrder.count({ where: { tenantId: data.tenantId } }),
    ).toBe(1);
    expect(
      await prisma.transportOrder.count({ where: { tenantId: data.tenantId } }),
    ).toBe(1);
    await applyProcessEvents(data, [
      'outbound.created.v1',
      'tms.transport-order-received.v1',
    ]);
    const process = await prisma.orderFulfillmentProcess.findUniqueOrThrow({
      where: { id: released.processId },
    });
    expect(process).toMatchObject({
      expectedStepCount: 6,
      status: 'EXECUTING',
      succeededStepCount: 2,
    });
    expect(
      await prisma.crossDomainObjectLink.count({
        where: { processId: process.id, tenantId: data.tenantId },
      }),
    ).toBe(2);
    const outbound = await prisma.outboundOrder.findFirstOrThrow({
      where: {
        sourceRef: released.fulfillment.aggregateId,
        tenantId: data.tenantId,
      },
    });
    const shipmentId = randomUUID();
    for (const lifecycleEvent of [
      {
        aggregateId: outbound.id,
        eventType: 'outbound.ready.v1',
        payload: {
          outboundId: outbound.id,
          outboundNo: outbound.outboundNo,
          sourceRef: released.fulfillment.aggregateId,
        },
      },
      {
        aggregateId: shipmentId,
        eventType: 'shipment.vehicle-assigned.v1',
        payload: {
          shipmentId,
          sourceRefs: [{ sourceRef: released.shipment.aggregateId }],
        },
      },
      {
        aggregateId: shipmentId,
        eventType: 'shipment.delivered.v1',
        payload: {
          shipmentId,
          sourceRefs: [{ sourceRef: released.shipment.aggregateId }],
        },
      },
      {
        aggregateId: shipmentId,
        eventType: 'shipment.pod-confirmed.v1',
        payload: {
          shipmentId,
          sourceRefs: [{ sourceRef: released.shipment.aggregateId }],
        },
      },
    ])
      await data.process.consume(
        {
          aggregateId: lifecycleEvent.aggregateId,
          aggregateType: 'Shipment',
          aggregateVersion: 1,
          eventId: randomUUID(),
          eventType: lifecycleEvent.eventType,
          occurredAt: new Date().toISOString(),
          payload: lifecycleEvent.payload,
          schemaVersion: 1,
          traceId: randomUUID(),
        },
        data.context,
        data.metadata(),
      );
    expect(
      await prisma.orderFulfillmentProcess.findUniqueOrThrow({
        where: { id: released.processId },
      }),
    ).toMatchObject({ status: 'COMPLETED', succeededStepCount: 6 });
  });

  it('makes a permanent failure visible in Control and explicitly retries only that step', async () => {
    const data = await fixture();
    const released = await releaseEvents(data, randomUUID().slice(0, 8));
    await data.wms.consume(
      envelope(released.fulfillment),
      data.context,
      data.metadata(),
    );
    await applyProcessEvents(data, ['outbound.created.v1']);
    const deadLetter: BusinessEventInput = {
      aggregateId: randomUUID(),
      aggregateType: 'EventDelivery',
      aggregateVersion: 1,
      eventId: randomUUID(),
      eventType: 'control.event-delivery-dead-lettered.v1',
      occurredAt: new Date().toISOString(),
      payload: {
        consumer: 'tms.shipment-request.v2',
        error: 'TMS rejected request permanently',
        eventId: released.shipment.id,
      },
      schemaVersion: 1,
      traceId: randomUUID(),
    };
    await data.process.consume(deadLetter, data.context, data.metadata());
    const failed = await prisma.orderFulfillmentProcess.findUniqueOrThrow({
      where: { id: released.processId },
    });
    expect(failed).toMatchObject({
      manualInterventionRequired: true,
      status: 'MANUAL_INTERVENTION',
    });
    const failureEvent = await prisma.platformOutbox.findFirstOrThrow({
      where: {
        aggregateId: failed.id,
        eventName: 'oms.fulfillment-process-failed.v1',
        tenantId: data.tenantId,
      },
    });
    const control = new ControlTowerService(prisma as never, data.eventFacade);
    await control.consume(
      envelope(failureEvent),
      data.context,
      data.metadata(),
    );
    expect(
      await prisma.controlAlertCase.count({
        where: {
          dedupeKey: `FULFILLMENT_PROCESS:${failed.id}`,
          tenantId: data.tenantId,
        },
      }),
    ).toBe(1);
    const step = await prisma.orderFulfillmentStep.findFirstOrThrow({
      where: {
        processId: failed.id,
        stepType: 'CREATE_TMS_ORDER',
        tenantId: data.tenantId,
      },
    });
    const retried = await data.process.retryStep(
      failed.id,
      step.id,
      {
        expectedProcessVersion: failed.version,
        expectedStepVersion: step.version,
      },
      data.context,
      data.metadata(),
    );
    const retryEvent = await prisma.platformOutbox.findUniqueOrThrow({
      where: { id: retried.sourceEventId },
    });
    await data.tms.consume(envelope(retryEvent), data.context, data.metadata());
    const received = await prisma.platformOutbox.findFirstOrThrow({
      where: {
        eventName: 'tms.transport-order-received.v1',
        tenantId: data.tenantId,
      },
    });
    await data.process.consume(
      envelope(received),
      data.context,
      data.metadata(),
    );
    expect(
      await prisma.orderFulfillmentProcess.findUniqueOrThrow({
        where: { id: failed.id },
      }),
    ).toMatchObject({
      manualInterventionRequired: false,
      status: 'EXECUTING',
      succeededStepCount: 2,
    });
    expect(
      await prisma.transportOrder.count({ where: { tenantId: data.tenantId } }),
    ).toBe(1);
  });
});
