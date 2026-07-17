import { HttpWorkerApi, type WorkerApi } from './job-runner';

export interface BusinessEvent {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateVersion: number;
  readonly attemptCount: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly partitionKey: string;
  readonly payload: Record<string, unknown>;
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly traceId: string;
  readonly version: number;
}

export async function runRelayOnce(
  tenantId: string,
  leaseOwner: string,
  api: WorkerApi = new HttpWorkerApi(),
) {
  const claimed = await api.request<{ events: BusinessEvent[] }>(
    tenantId,
    '/api/v1/platform/events/relay/claim',
    {
      body: JSON.stringify({ leaseOwner, leaseSeconds: 60, limit: 20 }),
      method: 'POST',
    },
  );
  const results = [];
  for (const event of claimed.events) {
    try {
      results.push(
        await api.request(
          tenantId,
          `/api/v1/platform/events/outbox/${event.eventId}/publish`,
          {
            body: JSON.stringify({
              expectedVersion: event.version,
              leaseOwner,
            }),
            headers: {
              'Idempotency-Key': `${event.eventId}:publish:${event.version}`,
            },
            method: 'POST',
          },
        ),
      );
    } catch (error) {
      results.push(
        await api.request(
          tenantId,
          `/api/v1/platform/events/outbox/${event.eventId}/fail`,
          {
            body: JSON.stringify({
              error:
                error instanceof Error ? error.message : 'EVENT_PUBLISH_FAILED',
              expectedVersion: event.version,
              leaseOwner,
            }),
            headers: {
              'Idempotency-Key': `${event.eventId}:publish-fail:${event.version}`,
            },
            method: 'POST',
          },
        ),
      );
    }
  }
  return results;
}
