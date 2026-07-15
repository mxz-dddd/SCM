import type {
  FulfillmentReleasedV2Payload,
  QuantitySnapshot,
  ShipmentRequestedV2Payload,
  SnapshotReference,
} from './contracts';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const object = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value.trim());
const uuid = (value: unknown): value is string =>
  text(value) && UUID.test(value);
const positiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) > 0;
const decimal = (value: unknown): value is string =>
  text(value) && /^\d+(?:\.\d+)?$/.test(value);
const instant = (value: unknown): value is string =>
  text(value) && !Number.isNaN(new Date(value).valueOf());

function snapshot(value: unknown): value is SnapshotReference {
  return (
    object(value) && object(value.snapshot) && (!value.id || uuid(value.id))
  );
}

function quantity(value: unknown): value is QuantitySnapshot {
  return (
    object(value) &&
    decimal(value.originalQuantity) &&
    decimal(value.baseQuantity) &&
    text(value.originalUom) &&
    text(value.baseUom) &&
    (value.packageSpecVersion === undefined ||
      positiveInteger(value.packageSpecVersion))
  );
}

export function isFulfillmentReleasedV2Payload(
  value: unknown,
): value is FulfillmentReleasedV2Payload {
  if (!object(value) || !Array.isArray(value.lines) || value.lines.length === 0)
    return false;
  return (
    uuid(value.fulfillmentId) &&
    text(value.fulfillmentNo) &&
    positiveInteger(value.fulfillmentVersion) &&
    uuid(value.orderId) &&
    text(value.orderNo) &&
    positiveInteger(value.orderVersion) &&
    text(value.sourceRef) &&
    positiveInteger(value.sourceVersion) &&
    snapshot(value.warehouse) &&
    uuid(value.warehouse.id) &&
    snapshot(value.owner) &&
    uuid(value.owner.id) &&
    snapshot(value.customer) &&
    snapshot(value.destination) &&
    object(value.allocationConstraints) &&
    (value.cutoffAt === undefined || instant(value.cutoffAt)) &&
    value.lines.every(
      (line) =>
        object(line) &&
        uuid(line.lineId) &&
        snapshot(line.product) &&
        uuid(line.product.id) &&
        quantity(line),
    )
  );
}

export function isShipmentRequestedV2Payload(
  value: unknown,
): value is ShipmentRequestedV2Payload {
  if (!object(value)) return false;
  const window = (candidate: unknown) =>
    object(candidate) && instant(candidate.from) && instant(candidate.until);
  return (
    uuid(value.shipmentRequestId) &&
    text(value.shipmentRequestNo) &&
    positiveInteger(value.shipmentRequestVersion) &&
    uuid(value.orderId) &&
    text(value.orderNo) &&
    positiveInteger(value.orderVersion) &&
    text(value.sourceRef) &&
    positiveInteger(value.sourceVersion) &&
    snapshot(value.origin) &&
    snapshot(value.destination) &&
    window(value.pickupWindow) &&
    window(value.deliveryWindow) &&
    text(value.type) &&
    positiveInteger(value.priority) &&
    object(value.packageSnapshot) &&
    object(value.vehicleRequirementSnapshot) &&
    object(value.chargeResponsibilitySnapshot) &&
    quantity(value.weight) &&
    quantity(value.volume)
  );
}

export function assertFulfillmentReleasedV2Payload(
  value: unknown,
): asserts value is FulfillmentReleasedV2Payload {
  if (!isFulfillmentReleasedV2Payload(value))
    throw new Error('FULFILLMENT_RELEASED_V2_PAYLOAD_INVALID');
}

export function assertShipmentRequestedV2Payload(
  value: unknown,
): asserts value is ShipmentRequestedV2Payload {
  if (!isShipmentRequestedV2Payload(value))
    throw new Error('SHIPMENT_REQUESTED_V2_PAYLOAD_INVALID');
}
