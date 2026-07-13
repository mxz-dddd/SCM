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
  it('publishes a claimed event then acknowledges its lease', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ events: [event] })
      .mockResolvedValueOnce({ eventId: event.eventId, status: 'PUBLISHED' });
    const publish = vi.fn().mockResolvedValue(undefined);

    await expect(
      runRelayOnce(event.tenantId, 'relay-1', { request } as never, { publish }),
    ).resolves.toEqual([{ eventId: event.eventId, status: 'PUBLISHED' }]);
    expect(publish).toHaveBeenCalledWith(event);
    expect(request.mock.calls[1]?.[1]).toContain('/ack');
  });

  it('records a retry failure when publishing fails', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ events: [event] })
      .mockResolvedValueOnce({ eventId: event.eventId, status: 'FAILED' });
    const publish = vi.fn().mockRejectedValue(new Error('broker unavailable'));

    await expect(
      runRelayOnce(event.tenantId, 'relay-1', { request } as never, { publish }),
    ).resolves.toEqual([{ eventId: event.eventId, status: 'FAILED' }]);
    expect(request.mock.calls[1]?.[1]).toContain('/fail');
  });
});
