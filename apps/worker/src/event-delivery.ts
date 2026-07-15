import {
  INTERNAL_EVENT_ENDPOINT_ALLOWLIST,
  eventMatchesPattern,
  subscriptionForConsumer,
  type BusinessEventEnvelope,
  type ConsumerMode,
} from '@scm/shared';
import { HttpWorkerApi, type WorkerApi } from './job-runner';

export interface ClaimedEventDelivery {
  readonly aggregateId: string;
  readonly attemptCount: number;
  readonly consumer: string;
  readonly endpoint: `/api/v1/${string}`;
  readonly event: BusinessEventEnvelope;
  readonly eventId: string;
  readonly id: string;
  readonly mode: ConsumerMode;
  readonly version: number;
}

interface ConsumerResponse extends Record<string, unknown> {
  readonly status?: string;
}

export function assertDeliveryRoute(delivery: ClaimedEventDelivery): void {
  const subscription = subscriptionForConsumer(delivery.consumer);
  if (
    !subscription ||
    subscription.endpoint !== delivery.endpoint ||
    subscription.mode !== delivery.mode ||
    !INTERNAL_EVENT_ENDPOINT_ALLOWLIST.has(delivery.endpoint) ||
    !subscription.eventPatterns.some((pattern) =>
      eventMatchesPattern(delivery.event.eventType, pattern),
    )
  ) {
    throw new Error('EVENT_DELIVERY_ROUTE_REJECTED');
  }
}

export async function runEventDeliveriesOnce(
  tenantId: string,
  leaseOwner: string,
  api: WorkerApi = new HttpWorkerApi(),
) {
  const claimed = await api.request<{
    deliveries: ClaimedEventDelivery[];
  }>(tenantId, '/api/v1/platform/events/deliveries/claim', {
    body: JSON.stringify({ leaseOwner, leaseSeconds: 60, limit: 20 }),
    method: 'POST',
  });
  const results = [];
  for (const delivery of claimed.deliveries) {
    try {
      assertDeliveryRoute(delivery);
      const response = await api.request<ConsumerResponse>(
        tenantId,
        delivery.endpoint,
        {
          body: JSON.stringify(delivery.event),
          headers: {
            'Idempotency-Key': `${delivery.eventId}:${delivery.consumer}`,
          },
          method: 'POST',
        },
      );
      results.push(
        await api.request(
          tenantId,
          `/api/v1/platform/events/deliveries/${delivery.id}/complete`,
          {
            body: JSON.stringify({
              expectedVersion: delivery.version,
              leaseOwner,
              outcome: response.status === 'IGNORED' ? 'IGNORED' : 'PROCESSED',
              responseSnapshot: response,
            }),
            headers: {
              'Idempotency-Key': `${delivery.id}:complete:${delivery.version}`,
            },
            method: 'POST',
          },
        ),
      );
      console.info('worker.event-delivery.processed', {
        aggregateId: delivery.aggregateId,
        attempt: delivery.attemptCount,
        consumer: delivery.consumer,
        eventId: delivery.eventId,
        tenantId,
        traceId: delivery.event.traceId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'EVENT_DELIVERY_FAILED';
      results.push(
        await api.request(
          tenantId,
          `/api/v1/platform/events/deliveries/${delivery.id}/fail`,
          {
            body: JSON.stringify({
              error: message,
              expectedVersion: delivery.version,
              leaseOwner,
            }),
            headers: {
              'Idempotency-Key': `${delivery.id}:fail:${delivery.version}`,
            },
            method: 'POST',
          },
        ),
      );
      console.error('worker.event-delivery.failed', {
        aggregateId: delivery.aggregateId,
        attempt: delivery.attemptCount,
        consumer: delivery.consumer,
        eventId: delivery.eventId,
        message,
        tenantId,
        traceId: delivery.event.traceId,
      });
    }
  }
  return results;
}
