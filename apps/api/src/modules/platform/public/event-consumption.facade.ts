import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { EventService, type BusinessEventInput } from '../event.service';
import type { CommandMetadata } from '../tenant.service';

@Injectable()
export class EventConsumptionFacade {
  constructor(@Inject(EventService) private readonly events: EventService) {}
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
      { consumer: 'billing.charge-fact.v1', event },
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
      { consumer: 'oms.order-timeline.v1', event },
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
      { consumer: 'control.projection.v1', event },
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
      { consumer: 'control.alert-engine.v1', event },
      context,
      metadata,
      handler,
    );
  }
}
