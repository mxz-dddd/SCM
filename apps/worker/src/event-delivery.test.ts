import { describe, expect, it, vi } from 'vitest';
import {
  assertDeliveryRoute,
  runEventDeliveriesOnce,
  type ClaimedEventDelivery,
} from './event-delivery';

const delivery: ClaimedEventDelivery = {
  aggregateId: '10000000-0000-4000-8000-000000000001',
  attemptCount: 1,
  consumer: 'oms.order-timeline.v1',
  endpoint: '/api/v1/oms/timeline-events/consume',
  event: {
    aggregateId: '10000000-0000-4000-8000-000000000001',
    aggregateType: 'Order',
    aggregateVersion: 1,
    eventId: '10000000-0000-4000-8000-000000000002',
    eventType: 'order.created.v1',
    occurredAt: '2026-07-16T00:00:00.000Z',
    partitionKey: 'Order:10000000-0000-4000-8000-000000000001',
    payload: { orderId: '10000000-0000-4000-8000-000000000001' },
    schemaVersion: 1,
    tenantId: '10000000-0000-4000-8000-000000000003',
    traceId: 'trace-1',
  },
  eventId: '10000000-0000-4000-8000-000000000002',
  id: '10000000-0000-4000-8000-000000000004',
  mode: 'EVERY_EVENT',
  version: 2,
};

describe('persistent event delivery worker', () => {
  it('accepts only the static consumer route and completes independently', async () => {
    expect(() => assertDeliveryRoute(delivery)).not.toThrow();
    expect(() =>
      assertDeliveryRoute({
        ...delivery,
        endpoint: '/api/v1/platform/events/consume',
      }),
    ).toThrow('EVENT_DELIVERY_ROUTE_REJECTED');

    const request = vi
      .fn()
      .mockResolvedValueOnce({ deliveries: [delivery] })
      .mockResolvedValueOnce({ status: 'PROCESSED' })
      .mockResolvedValueOnce({
        deliveryId: delivery.id,
        status: 'PROCESSED',
      });
    await expect(
      runEventDeliveriesOnce(delivery.event.tenantId, 'delivery-1', {
        request,
      }),
    ).resolves.toEqual([{ deliveryId: delivery.id, status: 'PROCESSED' }]);
    expect(request.mock.calls[1]?.[2]?.headers).toMatchObject({
      'Idempotency-Key': `${delivery.eventId}:${delivery.consumer}`,
    });
    expect(request.mock.calls[2]?.[1]).toContain('/complete');
  });

  it('fails only the claimed subscriber when its handler rejects', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ deliveries: [delivery] })
      .mockRejectedValueOnce(new Error('consumer unavailable'))
      .mockResolvedValueOnce({
        deliveryId: delivery.id,
        status: 'FAILED',
      });
    await expect(
      runEventDeliveriesOnce(delivery.event.tenantId, 'delivery-1', {
        request,
      }),
    ).resolves.toEqual([{ deliveryId: delivery.id, status: 'FAILED' }]);
    expect(request.mock.calls[2]?.[1]).toContain('/fail');
  });
});
