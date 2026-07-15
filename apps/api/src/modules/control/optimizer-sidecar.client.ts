import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error';

type JsonObject = Readonly<Record<string, unknown>>;

@Injectable()
export class OptimizerSidecarClient {
  private readonly baseUrl = (
    process.env.OPTIMIZER_URL ?? 'http://localhost:8090'
  ).replace(/\/$/, '');

  solveRoutes(input: JsonObject) {
    return this.request('/v1/solve/routes', input);
  }

  solveLoad(input: JsonObject) {
    return this.request('/v1/solve/load', input);
  }

  private async request(path: string, input: JsonObject): Promise<JsonObject> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(35_000),
      });
    } catch {
      throw new AppError(
        'CONTROL_AI_OPTIMIZER_UNAVAILABLE',
        'The optimization sidecar is unavailable',
        503,
        { retryable: true },
      );
    }
    const body = (await response.json().catch(() => ({}))) as JsonObject;
    if (!response.ok) {
      throw new AppError(
        String(body.code ?? 'CONTROL_AI_OPTIMIZER_FAILED'),
        String(body.message ?? 'The optimization sidecar rejected the request'),
        response.status >= 500 ? 503 : 400,
        { retryable: response.status >= 500 },
      );
    }
    if (
      !['FEASIBLE', 'INFEASIBLE', 'OPTIMAL'].includes(String(body.status)) ||
      typeof body.solverVersion !== 'string' ||
      typeof body.explanation !== 'string' ||
      !Array.isArray(body.constraints)
    ) {
      throw new AppError(
        'CONTROL_AI_OPTIMIZER_CONTRACT_INVALID',
        'The optimization sidecar returned an invalid contract',
        503,
        { retryable: true },
      );
    }
    return body;
  }
}
