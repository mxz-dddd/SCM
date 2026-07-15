import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '@scm/shared';
import { assertFulfillmentReleasedV2Payload } from '@scm/shared';
import type { BusinessEventInput } from '../platform/event.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import type { CommandMetadata } from '../platform/tenant.service';
import { OutboundService } from './outbound.service';

@Injectable()
export class WmsEventConsumerService {
  constructor(
    @Inject(EventConsumptionFacade)
    private readonly events: EventConsumptionFacade,
    @Inject(OutboundService) private readonly outbounds: OutboundService,
  ) {}

  consume(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.events.consumeWmsFulfillmentCommand(
      event,
      context,
      metadata,
      async (message) => {
        if (message.eventType !== 'fulfillment.released.v2')
          return { eventId: message.eventId, status: 'IGNORED' };
        assertFulfillmentReleasedV2Payload(message.payload);
        const payload = message.payload;
        const existing = await this.outbounds.findBySource(
          payload.sourceRef,
          payload.sourceVersion,
          context,
        );
        if (existing)
          return {
            duplicate: true,
            outboundId: existing.id,
            outboundNo: existing.outboundNo,
            status: existing.status,
          };
        const created = await this.outbounds.createOutbound(
          {
            ...(typeof payload.carrierSnapshot?.snapshot.mode === 'string'
              ? { carrierMode: payload.carrierSnapshot.snapshot.mode }
              : {}),
            ...(payload.customer.id ? { customerId: payload.customer.id } : {}),
            cutoffAt:
              payload.cutoffAt && new Date(payload.cutoffAt) > new Date()
                ? payload.cutoffAt
                : new Date(Date.now() + 86_400_000).toISOString(),
            destinationSnapshot: payload.destination.snapshot,
            lines: payload.lines.map((line, index) => ({
              allocationConstraints: payload.allocationConstraints,
              baseUom: line.baseUom,
              lineNo: index + 1,
              originalUom: line.originalUom,
              productId: line.product.id!,
              quantityBase: line.baseQuantity,
              quantityOriginal: line.originalQuantity,
            })),
            ownerId: payload.owner.id!,
            ...(typeof payload.routeSnapshot?.code === 'string'
              ? { routeCode: payload.routeSnapshot.code }
              : {}),
            serviceLevel: payload.serviceLevel ?? 'STANDARD',
            sourceRef: payload.sourceRef,
            sourceSnapshot: payload,
            sourceVersion: payload.sourceVersion,
            ...(typeof payload.temperatureSnapshot?.zone === 'string'
              ? { temperatureZone: payload.temperatureSnapshot.zone }
              : {}),
            type: payload.fulfillmentNo.includes('RETURN')
              ? 'RETURN_VENDOR'
              : 'SALES',
            warehouseId: payload.warehouse.id!,
          },
          context,
          metadata,
        );
        const released = await this.outbounds.releaseOutbound(
          created.outboundId,
          { expectedVersion: created.version },
          context,
          metadata,
        );
        const row = await this.outbounds.findBySource(
          payload.sourceRef,
          payload.sourceVersion,
          context,
        );
        return {
          outboundId: created.outboundId,
          outboundNo: row?.outboundNo,
          status: released.status,
          version: released.version,
        };
      },
    );
  }
}
