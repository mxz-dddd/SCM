import { Inject, Injectable } from '@nestjs/common';
import type { TransportOrderType } from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { assertShipmentRequestedV2Payload } from '@scm/shared';
import type { BusinessEventInput } from '../platform/event.service';
import { EventConsumptionFacade } from '../platform/public/event-consumption.facade';
import type { CommandMetadata } from '../platform/tenant.service';
import { TransportOrderService } from './transport-order.service';

@Injectable()
export class TmsEventConsumerService {
  constructor(
    @Inject(EventConsumptionFacade)
    private readonly events: EventConsumptionFacade,
    @Inject(TransportOrderService)
    private readonly orders: TransportOrderService,
  ) {}

  consume(
    event: BusinessEventInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    return this.events.consumeTmsShipmentRequest(
      event,
      context,
      metadata,
      async (message) => {
        if (message.eventType !== 'shipment.requested.v2')
          return { eventId: message.eventId, status: 'IGNORED' };
        assertShipmentRequestedV2Payload(message.payload);
        const payload = message.payload;
        const sourceType = 'OMS_SHIPMENT_REQUEST';
        const sourceVersion = String(payload.sourceVersion);
        const existing = await this.orders.findBySource(
          sourceType,
          payload.sourceRef,
          sourceVersion,
          context,
        );
        if (existing)
          return {
            duplicate: true,
            status: existing.status,
            transportOrderId: existing.id,
            transportOrderNo: existing.orderNo,
          };
        const temperature = payload.temperatureSnapshot ?? {};
        const result = await this.orders.receive(
          {
            ...(payload.carrierSnapshot
              ? { carrierRequirementSnapshot: payload.carrierSnapshot.snapshot }
              : {}),
            chargeResponsibilitySnapshot: payload.chargeResponsibilitySnapshot,
            deliveryWindowFrom: payload.deliveryWindow.from,
            deliveryWindowTo: payload.deliveryWindow.until,
            ...(payload.destination.id
              ? { destinationAddressRef: payload.destination.id }
              : {}),
            destinationAddressSnapshot: payload.destination.snapshot,
            externalOrderNo: payload.orderNo,
            ...(payload.origin.id
              ? { originAddressRef: payload.origin.id }
              : {}),
            originAddressSnapshot: payload.origin.snapshot,
            packagingSnapshot: payload.packageSnapshot,
            pickupWindowFrom: payload.pickupWindow.from,
            pickupWindowTo: payload.pickupWindow.until,
            priority: payload.priority,
            serviceLevel: payload.serviceLevel ?? 'STANDARD',
            sourceRef: payload.sourceRef,
            sourceSnapshot: payload,
            sourceType,
            sourceVersion,
            ...(typeof temperature.max === 'string'
              ? { temperatureMax: temperature.max }
              : {}),
            ...(typeof temperature.min === 'string'
              ? { temperatureMin: temperature.min }
              : {}),
            ...(typeof temperature.uom === 'string'
              ? { temperatureUom: temperature.uom }
              : {}),
            type: this.type(payload.type),
            vehicleRequirementSnapshot: payload.vehicleRequirementSnapshot,
            volume: payload.volume.originalQuantity,
            volumeBase: payload.volume.baseQuantity,
            volumeBaseUom: payload.volume.baseUom,
            volumeUom: payload.volume.originalUom,
            weight: payload.weight.originalQuantity,
            weightBase: payload.weight.baseQuantity,
            weightBaseUom: payload.weight.baseUom,
            weightUom: payload.weight.originalUom,
          },
          context,
          metadata,
        );
        const row = await this.orders.findBySource(
          sourceType,
          payload.sourceRef,
          sourceVersion,
          context,
        );
        return { ...result, transportOrderNo: row?.orderNo };
      },
    );
  }

  private type(value: string): TransportOrderType {
    return ['PURCHASE', 'RETURN', 'SALES', 'STANDALONE', 'TRANSFER'].includes(
      value,
    )
      ? (value as TransportOrderType)
      : 'STANDALONE';
  }
}
