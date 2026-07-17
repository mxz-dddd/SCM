import { describe, expect, it, vi } from 'vitest';
import { runRelayOnce, type BusinessEvent } from './outbox-relay';

const event: BusinessEvent = {
  aggregateId: '10000000-0000-4000-8000-000000000001',
  aggregateType: 'Order',
  aggregateVersion: 1,
  attemptCount: 1,
  eventId: '10000000-0000-4000-8000-000000000002',
  eventType: 'order.created.v1',
  occurredAt: new Date().toISOString(),
  partitionKey: 'Order:10000000-0000-4000-8000-000000000001',
  payload: { orderId: 'order-1' },
  schemaVersion: 1,
  tenantId: '10000000-0000-4000-8000-000000000003',
  traceId: 'trace-1',
  version: 2,
};

describe('outbox relay', () => {
  it('publishes a claimed event into persistent deliveries', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ events: [event] })
      .mockResolvedValueOnce({
        deliveryCount: 2,
        eventId: event.eventId,
        status: 'PUBLISHED',
      });

    await expect(
      runRelayOnce(event.tenantId, 'relay-1', { request } as never),
    ).resolves.toEqual([
      {
        deliveryCount: 2,
        eventId: event.eventId,
        status: 'PUBLISHED',
      },
    ]);
    expect(request.mock.calls[1]?.[1]).toContain('/publish');
  });

  it('records a retry failure when fan-out publishing fails', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ events: [event] })
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ eventId: event.eventId, status: 'FAILED' });

    await expect(
      runRelayOnce(event.tenantId, 'relay-1', { request } as never),
    ).resolves.toEqual([{ eventId: event.eventId, status: 'FAILED' }]);
    expect(request.mock.calls[2]?.[1]).toContain('/fail');
  });
});
