import { Queue, type Job } from 'bullmq';
import { getRedisConnection } from './connection';
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

interface EventPublisher {
  publish(event: BusinessEvent): Promise<void>;
}

export class BullEventPublisher implements EventPublisher {
  private readonly queue = new Queue('scm-events', { connection: getRedisConnection() });

  async publish(event: BusinessEvent): Promise<void> {
    await this.queue.add(event.eventType, event, {
      jobId: event.eventId,
      removeOnComplete: 5000,
      removeOnFail: 5000,
    });
  }

  close() {
    return this.queue.close();
  }
}

export async function runRelayOnce(
  tenantId: string,
  leaseOwner: string,
  api: WorkerApi = new HttpWorkerApi(),
  publisher: EventPublisher = new BullEventPublisher(),
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
      await publisher.publish(event);
      results.push(
        await api.request(
          tenantId,
          `/api/v1/platform/events/outbox/${event.eventId}/ack`,
          {
            body: JSON.stringify({
              expectedVersion: event.version,
              leaseOwner,
            }),
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
              error: error instanceof Error ? error.message : 'EVENT_PUBLISH_FAILED',
              expectedVersion: event.version,
              leaseOwner,
            }),
            method: 'POST',
          },
        ),
      );
    }
  }
  return results;
}

export function consumeBusinessEvent(
  job: Job<BusinessEvent>,
  api: WorkerApi = new HttpWorkerApi(),
) {
  const event = job.data;
  return api.request(event.tenantId, '/api/v1/platform/events/consume', {
    body: JSON.stringify({ consumer: 'control.projection', event }),
    method: 'POST',
  });
}
