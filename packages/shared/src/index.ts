export const CORRELATION_ID_HEADER = 'X-Correlation-Id' as const;
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key' as const;

export * from './domain/value-objects';
export * from './events';
export * from './platform/tenant';
export * from './platform/rbac';
export * from './platform/data-scope';
export * from './platform/workspace';

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
