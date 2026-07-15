import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { subscriptionForConsumer } from '@scm/shared';
import { EventService, type BusinessEventInput } from '../event.service';
import type { CommandMetadata } from '../tenant.service';

@Injectable()
export class EventConsumptionFacade {
  constructor(@Inject(EventService) private readonly events: EventService) {}
  private definition(consumer: string) {
    const definition = subscriptionForConsumer(consumer);
    if (!definition)
      throw new Error(`Event consumer ${consumer} is not registered`);
    return definition;
  }
  consumeBillingFact(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
    handler: (
      event: BusinessEventInput,
      transaction: Prisma.TransactionClient,
    ) => Promise<Readonly<Record<string, unknown>>>,
  ) {
    return this.events.consume(
      {
        consumer: 'billing.charge-fact.v1',
        event,
        mode: this.definition('billing.charge-fact.v1').mode,
      },
      context,
      metadata,
      handler,
    );
  }
  consumeOrderTimeline(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
    handler: (
      event: BusinessEventInput,
      transaction: Prisma.TransactionClient,
    ) => Promise<Readonly<Record<string, unknown>>>,
  ) {
    return this.events.consume(
      {
        consumer: 'oms.order-timeline.v1',
        event,
        mode: this.definition('oms.order-timeline.v1').mode,
      },
      context,
      metadata,
      handler,
    );
  }
  consumeControlProjection(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
    handler: (
      event: BusinessEventInput,
      transaction: Prisma.TransactionClient,
    ) => Promise<Readonly<Record<string, unknown>>>,
  ) {
    return this.events.consume(
      {
        consumer: 'control.projection.v1',
        event,
        mode: this.definition('control.projection.v1').mode,
      },
      context,
      metadata,
      handler,
    );
  }
  consumeControlAlert(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
    handler: (
      event: BusinessEventInput,
      transaction: Prisma.TransactionClient,
    ) => Promise<Readonly<Record<string, unknown>>>,
  ) {
    return this.events.consume(
      {
        consumer: 'control.alert-engine.v1',
        event,
        mode: this.definition('control.alert-engine.v1').mode,
      },
      context,
      metadata,
      handler,
    );
  }
  consumeControlLake(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
    handler: (
      event: BusinessEventInput,
      transaction: Prisma.TransactionClient,
    ) => Promise<Readonly<Record<string, unknown>>>,
  ) {
    return this.events.consume(
      {
        consumer: 'control.data-lake.v1',
        event,
        mode: this.definition('control.data-lake.v1').mode,
      },
      context,
      metadata,
      handler,
    );
  }
  consumeControlReconciliation(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
    handler: (
      event: BusinessEventInput,
      transaction: Prisma.TransactionClient,
    ) => Promise<Readonly<Record<string, unknown>>>,
  ) {
    return this.events.consume(
      {
        consumer: 'control.reconciliation.v1',
        event,
        mode: this.definition('control.reconciliation.v1').mode,
      },
      context,
      metadata,
      handler,
    );
  }
  consumePortalProjection(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
    handler: (
      event: BusinessEventInput,
      transaction: Prisma.TransactionClient,
    ) => Promise<Readonly<Record<string, unknown>>>,
  ) {
    return this.events.consume(
      {
        consumer: 'integration.portal-projection.v1',
        event,
        mode: this.definition('integration.portal-projection.v1').mode,
      },
      context,
      metadata,
      handler,
    );
  }

  consumeWmsFulfillmentCommand(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
    handler: (
      event: BusinessEventInput,
    ) => Promise<Readonly<Record<string, unknown>>>,
  ) {
    return this.events.consume(
      {
        consumer: 'wms.fulfillment-command.v2',
        event,
        mode: this.definition('wms.fulfillment-command.v2').mode,
      },
      context,
      metadata,
      async (message) => handler(message),
    );
  }

  consumeTmsShipmentRequest(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
    handler: (
      event: BusinessEventInput,
    ) => Promise<Readonly<Record<string, unknown>>>,
  ) {
    return this.events.consume(
      {
        consumer: 'tms.shipment-request.v2',
        event,
        mode: this.definition('tms.shipment-request.v2').mode,
      },
      context,
      metadata,
      async (message) => handler(message),
    );
  }

  consumeOmsFulfillmentProcess(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
    handler: (
      event: BusinessEventInput,
      transaction: Prisma.TransactionClient,
    ) => Promise<Readonly<Record<string, unknown>>>,
  ) {
    return this.events.consume(
      {
        consumer: 'oms.order-fulfillment-process.v2',
        event,
        mode: this.definition('oms.order-fulfillment-process.v2').mode,
      },
      context,
      metadata,
      handler,
    );
  }
}
