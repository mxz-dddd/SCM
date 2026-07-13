import { describe, expect, it } from 'vitest';
import { CORRELATION_ID_HEADER, IDEMPOTENCY_KEY_HEADER } from './index';

describe('shared HTTP contracts', () => {
  it('uses the headers required by the API convention', () => {
    expect(CORRELATION_ID_HEADER).toBe('X-Correlation-Id');
    expect(IDEMPOTENCY_KEY_HEADER).toBe('Idempotency-Key');
  });
});
