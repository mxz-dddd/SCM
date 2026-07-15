import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface OperationalLog {
  readonly businessRef: string | null;
  readonly durationMs: number;
  readonly event: string;
  readonly severity: 'ERROR' | 'INFO' | 'WARN';
  readonly spanId: string;
  readonly statusCode: number;
  readonly tenantId: string | null;
  readonly timestamp: string;
  readonly traceId: string;
  readonly userId: string | null;
}

export interface SpanRecord extends OperationalLog {
  readonly attributes: Readonly<Record<string, string | number>>;
  readonly endedAtUnixNano: string;
  readonly startedAtUnixNano: string;
}

const MAX_RECENT = 500;

@Injectable()
export class ObservabilityService {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<
    string,
    { count: number; sum: number; max: number }
  >();
  private readonly logs: OperationalLog[] = [];
  private readonly spans: SpanRecord[] = [];

  traceId(traceparent: string | undefined, correlationId: string): string {
    const match = traceparent?.match(
      /^00-([a-f0-9]{32})-[a-f0-9]{16}-[a-f0-9]{2}$/i,
    );
    return (
      match?.[1]?.toLowerCase() ??
      createHash('sha256').update(correlationId).digest('hex').slice(0, 32)
    );
  }

  spanId(): string {
    return randomBytes(8).toString('hex');
  }

  record(
    input: Omit<OperationalLog, 'timestamp'> & { readonly startedAt: bigint },
  ): void {
    const timestamp = new Date().toISOString();
    const { startedAt, ...logInput } = input;
    const log: OperationalLog = { ...logInput, timestamp };
    const route = this.metricRoute(input.event);
    const outcome =
      input.statusCode >= 500
        ? 'server_error'
        : input.statusCode >= 400
          ? 'client_error'
          : 'success';
    this.increment(
      `http_requests_total{route="${route}",outcome="${outcome}"}`,
    );
    const duration = this.durations.get(route) ?? { count: 0, max: 0, sum: 0 };
    duration.count += 1;
    duration.sum += input.durationMs;
    duration.max = Math.max(duration.max, input.durationMs);
    this.durations.set(route, duration);
    this.logs.push(log);
    const endedAt = BigInt(Date.now()) * 1_000_000n;
    const span: SpanRecord = {
      ...log,
      attributes: {
        'http.response.status_code': input.statusCode,
        'http.route': route,
        'scm.business_ref.present': input.businessRef ? 1 : 0,
      },
      endedAtUnixNano: endedAt.toString(),
      startedAtUnixNano: startedAt.toString(),
    };
    this.spans.push(span);
    this.trim(this.logs);
    this.trim(this.spans);
    process.stdout.write(`${JSON.stringify(log)}\n`);
    void this.exportSpan(span);
  }

  increment(metric: string, value = 1): void {
    this.counters.set(metric, (this.counters.get(metric) ?? 0) + value);
  }

  snapshot() {
    return {
      counters: Object.fromEntries(
        [...this.counters].sort(([left], [right]) => left.localeCompare(right)),
      ),
      durations: Object.fromEntries(
        [...this.durations]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([route, value]) => [
            route,
            {
              count: value.count,
              maxMs: value.max,
              meanMs:
                value.count === 0
                  ? 0
                  : Number((value.sum / value.count).toFixed(3)),
            },
          ]),
      ),
      logs: this.logs.slice(-100),
      spans: this.spans.slice(-100),
    };
  }

  prometheus(): string {
    const lines = ['# TYPE scm_http_requests_total counter'];
    for (const [metric, value] of [...this.counters].sort(([left], [right]) =>
      left.localeCompare(right),
    ))
      lines.push(`scm_${metric} ${value}`);
    lines.push('# TYPE scm_http_request_duration_ms summary');
    for (const [route, value] of [...this.durations].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      lines.push(
        `scm_http_request_duration_ms_count{route="${route}"} ${value.count}`,
      );
      lines.push(
        `scm_http_request_duration_ms_sum{route="${route}"} ${value.sum}`,
      );
      lines.push(
        `scm_http_request_duration_ms_max{route="${route}"} ${value.max}`,
      );
    }
    return `${lines.join('\n')}\n`;
  }

  private metricRoute(event: string): string {
    return event
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
      .replace(/\d+/g, ':n')
      .slice(0, 200);
  }

  private trim<T>(values: T[]): void {
    if (values.length > MAX_RECENT)
      values.splice(0, values.length - MAX_RECENT);
  }

  private async exportSpan(span: SpanRecord): Promise<void> {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(
      /\/$/,
      '',
    );
    if (!endpoint) return;
    try {
      await fetch(`${endpoint}/v1/traces`, {
        body: JSON.stringify({
          resourceSpans: [
            {
              resource: {
                attributes: [
                  { key: 'service.name', value: { stringValue: 'scm-api' } },
                ],
              },
              scopeSpans: [
                {
                  scope: { name: 'scm.native-telemetry', version: '1.0.0' },
                  spans: [
                    {
                      attributes: Object.entries(span.attributes).map(
                        ([key, value]) => ({
                          key,
                          value:
                            typeof value === 'number'
                              ? { intValue: String(value) }
                              : { stringValue: value },
                        }),
                      ),
                      endTimeUnixNano: span.endedAtUnixNano,
                      name: span.event,
                      parentSpanId: '',
                      spanId: span.spanId,
                      startTimeUnixNano: span.startedAtUnixNano,
                      status: { code: span.statusCode >= 500 ? 2 : 1 },
                      traceId: span.traceId,
                    },
                  ],
                },
              ],
            },
          ],
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      this.increment('otel_export_failures_total');
    }
  }
}
