export type ConsumerMode = 'EVERY_EVENT' | 'LATEST_STATE';

export interface BusinessEventEnvelope<
  TPayload extends object = Readonly<Record<string, unknown>>,
> {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateVersion: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly partitionKey: string;
  readonly payload: TPayload;
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly traceId: string;
}

export interface SnapshotReference {
  readonly id?: string;
  readonly snapshot: Readonly<Record<string, unknown>>;
}

export interface QuantitySnapshot {
  readonly baseQuantity: string;
  readonly baseUom: string;
  readonly originalQuantity: string;
  readonly originalUom: string;
  readonly packageSpecVersion?: number;
}

export interface FulfillmentReleasedV2Payload {
  readonly allocationConstraints: Readonly<Record<string, unknown>>;
  readonly carrierSnapshot?: SnapshotReference;
  readonly customer: SnapshotReference;
  readonly cutoffAt?: string;
  readonly destination: SnapshotReference;
  readonly fulfillmentId: string;
  readonly fulfillmentNo: string;
  readonly fulfillmentVersion: number;
  readonly lines: readonly (QuantitySnapshot & {
    readonly lineId: string;
    readonly product: SnapshotReference;
  })[];
  readonly orderId: string;
  readonly orderNo: string;
  readonly orderVersion: number;
  readonly owner: SnapshotReference;
  readonly routeSnapshot?: Readonly<Record<string, unknown>>;
  readonly serviceLevel?: string;
  readonly sourceRef: string;
  readonly sourceVersion: number;
  readonly temperatureSnapshot?: Readonly<Record<string, unknown>>;
  readonly warehouse: SnapshotReference;
}

export interface ShipmentRequestedV2Payload {
  readonly carrierSnapshot?: SnapshotReference;
  readonly chargeResponsibilitySnapshot: Readonly<Record<string, unknown>>;
  readonly deliveryWindow: Readonly<{ from: string; until: string }>;
  readonly destination: SnapshotReference;
  readonly orderId: string;
  readonly orderNo: string;
  readonly orderVersion: number;
  readonly origin: SnapshotReference;
  readonly packageSnapshot: Readonly<Record<string, unknown>>;
  readonly pickupWindow: Readonly<{ from: string; until: string }>;
  readonly priority: number;
  readonly serviceLevel?: string;
  readonly shipmentRequestId: string;
  readonly shipmentRequestNo: string;
  readonly shipmentRequestVersion: number;
  readonly sourceRef: string;
  readonly sourceVersion: number;
  readonly temperatureSnapshot?: Readonly<Record<string, unknown>>;
  readonly type: string;
  readonly vehicleRequirementSnapshot: Readonly<Record<string, unknown>>;
  readonly volume: QuantitySnapshot;
  readonly weight: QuantitySnapshot;
}

export interface AmsAppointmentEventV1Payload {
  readonly appointmentId: string;
  readonly orderLinks?: readonly string[];
  readonly slotId?: string;
  readonly status: string;
}

export interface BillingChargeFactEventV1Payload {
  readonly businessRef: string;
  readonly chargeType: string;
  readonly occurredAt: string;
  readonly quantity: QuantitySnapshot;
}

export interface ControlExceptionEventV1Payload {
  readonly businessRef: string;
  readonly code: string;
  readonly message: string;
  readonly severity: 'CRITICAL' | 'HIGH' | 'LOW' | 'MEDIUM';
}

export interface IntegrationPortalEventV1Payload {
  readonly businessRef: string;
  readonly projectionType: string;
  readonly snapshot: Readonly<Record<string, unknown>>;
}

export type OmsBusinessEvent =
  | BusinessEventEnvelope<FulfillmentReleasedV2Payload>
  | BusinessEventEnvelope<ShipmentRequestedV2Payload>;
export type WmsBusinessEvent = BusinessEventEnvelope<
  Readonly<Record<string, unknown>>
>;
export type TmsBusinessEvent = BusinessEventEnvelope<
  Readonly<Record<string, unknown>>
>;
export type AmsBusinessEvent =
  BusinessEventEnvelope<AmsAppointmentEventV1Payload>;
export type BillingBusinessEvent =
  BusinessEventEnvelope<BillingChargeFactEventV1Payload>;
export type ControlBusinessEvent =
  BusinessEventEnvelope<ControlExceptionEventV1Payload>;
export type IntegrationBusinessEvent =
  BusinessEventEnvelope<IntegrationPortalEventV1Payload>;
