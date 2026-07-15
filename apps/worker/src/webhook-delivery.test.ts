import { describe, expect, it, vi } from 'vitest';
import { deliverWebhooksOnce } from './webhook-delivery';

describe('Webhook delivery worker', () => {
  it('claims signed attempts and reports successful HTTP delivery', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        deliveries: [
          {
            attemptId: 'attempt-1',
            endpointUrl: 'https://partner.example.test/hooks',
            messageId: 'message-1',
            payload: { orderId: 'order-1' },
            signature: 'a'.repeat(64),
            version: 2,
          },
        ],
        leaseOwner: 'worker-1',
      })
      .mockResolvedValueOnce({ status: 'DELIVERED' });
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('accepted', { status: 202 }));
    await expect(
      deliverWebhooksOnce(
        'tenant-1',
        'worker-1',
        { request } as never,
        fetcher,
      ),
    ).resolves.toMatchObject({ claimed: 1 });
    expect(fetcher).toHaveBeenCalledWith(
      'https://partner.example.test/hooks',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'message-1',
          'X-SCM-Signature-256': `sha256=${'a'.repeat(64)}`,
        }),
      }),
    );
    expect(request).toHaveBeenLastCalledWith(
      'tenant-1',
      '/api/v1/integration/exchange/deliveries/attempt-1/complete',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports transport failures so the API can schedule a retry', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        deliveries: [
          {
            attemptId: 'attempt-2',
            endpointUrl: 'https://partner.example.test/hooks',
            messageId: 'message-2',
            payload: {},
            signature: 'b'.repeat(64),
            version: 3,
          },
        ],
        leaseOwner: 'worker-2',
      })
      .mockResolvedValueOnce({ status: 'FAILED' });
    const fetcher = vi.fn().mockRejectedValue(new Error('connection reset'));
    await deliverWebhooksOnce(
      'tenant-1',
      'worker-2',
      { request } as never,
      fetcher,
    );
    expect(JSON.parse(request.mock.calls[1]![2].body)).toMatchObject({
      errorMessage: 'connection reset',
      expectedVersion: 3,
      leaseOwner: 'worker-2',
    });
  });
});
