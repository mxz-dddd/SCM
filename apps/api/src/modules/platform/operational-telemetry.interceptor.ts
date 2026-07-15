import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import type { TenantRequest } from './auth/tenant-context.middleware';
import { ObservabilityService } from './observability.service';

@Injectable()
export class OperationalTelemetryInterceptor implements NestInterceptor {
  constructor(
    @Inject(ObservabilityService)
    private readonly telemetry: ObservabilityService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & Partial<TenantRequest>>();
    const response = http.getResponse<Response>();
    const correlationId = String(
      request.header('x-correlation-id') ?? 'missing-correlation-id',
    );
    const traceId = this.telemetry.traceId(
      request.header('traceparent'),
      correlationId,
    );
    const spanId = this.telemetry.spanId();
    response.setHeader('traceparent', `00-${traceId}-${spanId}-01`);
    const startedAt = BigInt(Date.now()) * 1_000_000n;
    const started = Date.now();
    return next.handle().pipe(
      finalize(() => {
        const tenant = request.tenantContext;
        this.telemetry.record({
          businessRef: this.businessRef(request),
          durationMs: Date.now() - started,
          event: `${request.method} ${request.route?.path ?? request.path}`,
          severity:
            response.statusCode >= 500
              ? 'ERROR'
              : response.statusCode >= 400
                ? 'WARN'
                : 'INFO',
          spanId,
          startedAt,
          statusCode: response.statusCode,
          tenantId: tenant?.tenantId ?? null,
          traceId,
          userId: tenant?.accountId ?? null,
        });
      }),
    );
  }

  private businessRef(request: Request): string | null {
    const header = request.header('x-business-ref')?.trim();
    if (header) return header.slice(0, 200);
    const params = request.params as Record<string, unknown> | undefined;
    for (const key of ['businessRef', 'orderId', 'shipmentId', 'id']) {
      const value = params?.[key];
      if (typeof value === 'string' && value) return value.slice(0, 200);
    }
    return null;
  }
}
