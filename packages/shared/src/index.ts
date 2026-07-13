export const CORRELATION_ID_HEADER = 'X-Correlation-Id' as const;
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key' as const;

export interface ApiError {
  businessRef?: string;
  code: string;
  correlationId: string;
  fieldErrors?: ReadonlyArray<{
    field: string;
    message: string;
  }>;
  message: string;
  retryable: boolean;
}

export interface HealthResponse {
  service: 'api' | 'worker';
  status: 'ok';
}
