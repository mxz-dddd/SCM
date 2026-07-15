import type { WorkerApi } from './job-runner';

interface ClaimedDelivery {
  readonly attemptId: string;
  readonly endpointUrl: string;
  readonly messageId: string;
  readonly payload: unknown;
  readonly signature: string;
  readonly version: number;
}

interface ClaimResponse {
  readonly deliveries: readonly ClaimedDelivery[];
  readonly leaseOwner: string;
}

export async function deliverWebhooksOnce(
  tenantId: string,
  leaseOwner: string,
  api: WorkerApi,
  fetcher: typeof fetch = fetch,
) {
  const claimed = await api.request<ClaimResponse>(
    tenantId,
    '/api/v1/integration/exchange/deliveries/claim',
    {
      body: JSON.stringify({ leaseOwner, leaseSeconds: 60, limit: 20 }),
      method: 'POST',
    },
  );
  const results = [];
  for (const delivery of claimed.deliveries) {
    try {
      const response = await fetcher(delivery.endpointUrl, {
        body: JSON.stringify(delivery.payload),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': delivery.messageId,
          'X-SCM-Delivery-Id': delivery.attemptId,
          'X-SCM-Signature-256': `sha256=${delivery.signature}`,
        },
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
      });
      const responseBody = (await response.text()).slice(0, 4096);
      results.push(
        await api.request(
          tenantId,
          `/api/v1/integration/exchange/deliveries/${delivery.attemptId}/complete`,
          {
            body: JSON.stringify({
              expectedVersion: delivery.version,
              leaseOwner,
              responseBody,
              responseStatus: response.status,
              ...(!response.ok
                ? { errorMessage: `Webhook returned HTTP ${response.status}` }
                : {}),
            }),
            method: 'POST',
          },
        ),
      );
    } catch (error) {
      results.push(
        await api.request(
          tenantId,
          `/api/v1/integration/exchange/deliveries/${delivery.attemptId}/complete`,
          {
            body: JSON.stringify({
              errorMessage:
                error instanceof Error
                  ? error.message
                  : 'Webhook request failed',
              expectedVersion: delivery.version,
              leaseOwner,
            }),
            method: 'POST',
          },
        ),
      );
    }
  }
  return { claimed: claimed.deliveries.length, results };
}
