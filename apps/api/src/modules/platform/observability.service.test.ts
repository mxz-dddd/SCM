import { describe, expect, it, vi } from 'vitest';
import { ObservabilityService } from './observability.service';

describe('native operational telemetry', () => {
  it('propagates W3C trace context and emits bounded structured logs, metrics and spans', () => {
    const telemetry = new ObservabilityService();
    const traceId = 'a'.repeat(32);
    expect(
      telemetry.traceId(`00-${traceId}-${'b'.repeat(16)}-01`, 'correlation'),
    ).toBe(traceId);
    expect(telemetry.traceId(undefined, 'correlation')).toMatch(
      /^[a-f0-9]{32}$/,
    );
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    telemetry.record({
      businessRef: 'SO-1',
      durationMs: 12,
      event: 'POST /api/v1/orders/10000000-0000-4000-8000-000000000001',
      severity: 'INFO',
      spanId: telemetry.spanId(),
      startedAt: BigInt(Date.now() - 12) * 1_000_000n,
      statusCode: 202,
      tenantId: 'tenant-1',
      traceId,
      userId: 'user-1',
    });
    const snapshot = telemetry.snapshot();
    expect(snapshot.logs[0]).toMatchObject({
      businessRef: 'SO-1',
      tenantId: 'tenant-1',
      traceId,
      userId: 'user-1',
    });
    expect(snapshot.spans[0]?.attributes).toMatchObject({
      'http.response.status_code': 202,
      'scm.business_ref.present': 1,
    });
    expect(telemetry.prometheus()).toContain(
      'scm_http_requests_total{route="POST /api/v:n/orders/:id",outcome="success"} 1',
    );
    write.mockRestore();
  });
});
