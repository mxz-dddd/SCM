import type { ConsumerMode } from './contracts';

export interface EventSubscriptionDefinition {
  readonly baseDelaySeconds: number;
  readonly consumer: string;
  readonly endpoint: `/api/v1/${string}`;
  readonly eventPatterns: readonly string[];
  readonly maxAttempts: number;
  readonly mode: ConsumerMode;
  readonly required: boolean;
}

export const EVENT_SUBSCRIPTIONS = [
  {
    baseDelaySeconds: 2,
    consumer: 'oms.order-timeline.v1',
    endpoint: '/api/v1/oms/timeline-events/consume',
    eventPatterns: [
      'order.*',
      'fulfillment.*',
      'inbound.*',
      'outbound.*',
      'shipment.*',
      'tracking.*',
      'appointment.*',
      'settlement.*',
    ],
    maxAttempts: 10,
    mode: 'EVERY_EVENT',
    required: true,
  },
  {
    baseDelaySeconds: 2,
    consumer: 'control.projection.v1',
    endpoint: '/api/v1/control/events/consume',
    eventPatterns: ['*'],
    maxAttempts: 10,
    mode: 'LATEST_STATE',
    required: false,
  },
  {
    baseDelaySeconds: 5,
    consumer: 'control.alert-engine.v1',
    endpoint: '/api/v1/control/alert-events/consume',
    eventPatterns: ['*'],
    maxAttempts: 8,
    mode: 'EVERY_EVENT',
    required: false,
  },
  {
    baseDelaySeconds: 5,
    consumer: 'control.data-lake.v1',
    endpoint: '/api/v1/control/bi/lake/events/consume',
    eventPatterns: ['*'],
    maxAttempts: 8,
    mode: 'EVERY_EVENT',
    required: false,
  },
  {
    baseDelaySeconds: 5,
    consumer: 'control.reconciliation.v1',
    endpoint: '/api/v1/control/reconciliations/events/consume',
    eventPatterns: [
      'order.*',
      'fulfillment.*',
      'inventory.*',
      'outbound.*',
      'shipment.*',
      'billing.*',
    ],
    maxAttempts: 8,
    mode: 'EVERY_EVENT',
    required: false,
  },
  {
    baseDelaySeconds: 3,
    consumer: 'billing.charge-fact.v1',
    endpoint: '/api/v1/billing/events/consume',
    eventPatterns: [
      '*.charge-fact.v1',
      '*.charge-facts-captured.v1',
      'appointment.completed.v1',
      'appointment.penalty-decided.v1',
      'inbound.completed.v1',
      'outbound.shipped.v1',
      'shipment.delivered.v1',
    ],
    maxAttempts: 12,
    mode: 'EVERY_EVENT',
    required: true,
  },
  {
    baseDelaySeconds: 3,
    consumer: 'integration.portal-projection.v1',
    endpoint: '/api/v1/integration/portal/projections/events',
    eventPatterns: [
      'order.*',
      'inventory.*',
      'appointment.*',
      'shipment.*',
      'tracking.*',
      'billing.*',
    ],
    maxAttempts: 8,
    mode: 'LATEST_STATE',
    required: false,
  },
  {
    baseDelaySeconds: 2,
    consumer: 'wms.fulfillment-command.v2',
    endpoint: '/api/v1/wms/events/fulfillment-released',
    eventPatterns: ['fulfillment.released.v2'],
    maxAttempts: 12,
    mode: 'EVERY_EVENT',
    required: true,
  },
  {
    baseDelaySeconds: 2,
    consumer: 'tms.shipment-request.v2',
    endpoint: '/api/v1/tms/events/shipment-requested',
    eventPatterns: ['shipment.requested.v2'],
    maxAttempts: 12,
    mode: 'EVERY_EVENT',
    required: true,
  },
  {
    baseDelaySeconds: 2,
    consumer: 'oms.order-fulfillment-process.v2',
    endpoint: '/api/v1/oms/fulfillment-process/events',
    eventPatterns: [
      'outbound.*',
      'shipment.*',
      'tracking.*',
      'tms.transport-order-received.v1',
    ],
    maxAttempts: 12,
    mode: 'EVERY_EVENT',
    required: true,
  },
] as const satisfies readonly EventSubscriptionDefinition[];

export type RegisteredEventConsumer =
  (typeof EVENT_SUBSCRIPTIONS)[number]['consumer'];

export function eventMatchesPattern(
  eventType: string,
  pattern: string,
): boolean {
  if (pattern === '*') return true;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(eventType);
}

export function subscriptionsForEvent(eventType: string) {
  return EVENT_SUBSCRIPTIONS.filter((subscription) =>
    subscription.eventPatterns.some((pattern) =>
      eventMatchesPattern(eventType, pattern),
    ),
  );
}

export function subscriptionForConsumer(consumer: string) {
  return EVENT_SUBSCRIPTIONS.find(
    (subscription) => subscription.consumer === consumer,
  );
}

export const INTERNAL_EVENT_ENDPOINT_ALLOWLIST = new Set<
  EventSubscriptionDefinition['endpoint']
>([
  '/api/v1/oms/timeline-events/consume',
  '/api/v1/control/events/consume',
  '/api/v1/control/alert-events/consume',
  '/api/v1/control/bi/lake/events/consume',
  '/api/v1/control/reconciliations/events/consume',
  '/api/v1/billing/events/consume',
  '/api/v1/integration/portal/projections/events',
  '/api/v1/wms/events/fulfillment-released',
  '/api/v1/tms/events/shipment-requested',
  '/api/v1/oms/fulfillment-process/events',
]);
