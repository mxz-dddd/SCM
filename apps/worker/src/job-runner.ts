import type { Job } from 'bullmq';

interface JobRunData {
  readonly jobRunId: string;
  readonly tenantId: string;
}

interface ScheduleTriggerData {
  readonly jobDefinitionId: string;
  readonly tenantId: string;
}

interface RunState {
  readonly payload: Record<string, unknown>;
  readonly status: string;
  readonly version: number;
}

export interface WorkerApi {
  request<T>(tenantId: string, path: string, init?: RequestInit): Promise<T>;
}

export class HttpWorkerApi implements WorkerApi {
  constructor(
    private readonly baseUrl = process.env.WORKER_API_URL ??
      'http://localhost:3000',
    private readonly token = process.env.WORKER_API_TOKEN,
  ) {}

  async request<T>(
    tenantId: string,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    if (!this.token) throw new Error('WORKER_API_TOKEN is required');
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
        'X-Correlation-Id': crypto.randomUUID(),
        'X-Tenant-Id': tenantId,
        ...init?.headers,
      },
    });
    const body = (await response.json()) as T & {
      code?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new Error(
        `${body.code ?? 'WORKER_API_FAILED'}: ${body.message ?? response.statusText}`,
      );
    }
    return body;
  }
}

export async function processSystemJob(
  job: Job<JobRunData | ScheduleTriggerData>,
  api: WorkerApi = new HttpWorkerApi(),
) {
  if (job.name === 'SCHEDULE_TRIGGER') {
    const data = job.data as ScheduleTriggerData;
    return api.request(
      data.tenantId,
      `/api/v1/platform/jobs/definitions/${data.jobDefinitionId}/runs`,
      {
        body: JSON.stringify({ triggerRef: `bullmq:${job.id ?? 'scheduler'}` }),
        method: 'POST',
      },
    );
  }
  const data = job.data as JobRunData;
  const owner = `worker:${process.pid}:${job.id ?? data.jobRunId}`;
  const run = await api.request<RunState>(
    data.tenantId,
    `/api/v1/platform/jobs/runs/${data.jobRunId}`,
  );
  const claimed = await api.request<RunState & { timeoutSeconds: number }>(
    data.tenantId,
    `/api/v1/platform/jobs/runs/${data.jobRunId}/claim`,
    {
      body: JSON.stringify({ expectedVersion: run.version, leaseOwner: owner }),
      method: 'POST',
    },
  );
  try {
    const result = await withTimeout(
      executeRoutedHandler(
        job.name,
        claimed.payload,
        data.tenantId,
        data.jobRunId,
        api,
      ),
      claimed.timeoutSeconds * 1000,
    );
    const progressed = await api.request<RunState>(
      data.tenantId,
      `/api/v1/platform/jobs/runs/${data.jobRunId}/progress`,
      {
        body: JSON.stringify({
          expectedVersion: claimed.version,
          leaseOwner: owner,
          message: 'Handler completed',
          progress: 90,
        }),
        method: 'POST',
      },
    );
    return api.request(
      data.tenantId,
      `/api/v1/platform/jobs/runs/${data.jobRunId}/complete`,
      {
        body: JSON.stringify({
          expectedVersion: progressed.version,
          leaseOwner: owner,
          result,
          success: true,
        }),
        method: 'POST',
      },
    );
  } catch (error) {
    const latest = await api.request<RunState>(
      data.tenantId,
      `/api/v1/platform/jobs/runs/${data.jobRunId}`,
    );
    const timedOut = error instanceof Error && error.message === 'JOB_TIMEOUT';
    const completion = await api.request<{ retryScheduled?: boolean }>(
      data.tenantId,
      `/api/v1/platform/jobs/runs/${data.jobRunId}/complete`,
      {
        body: JSON.stringify({
          expectedVersion: latest.version,
          failureCode: timedOut ? 'JOB_TIMEOUT' : 'JOB_HANDLER_FAILED',
          leaseOwner: owner,
          success: false,
          timedOut,
        }),
        method: 'POST',
      },
    );
    if (completion.retryScheduled) throw error;
    return completion;
  }
}

export async function executeRoutedHandler(
  handler: string,
  payload: Record<string, unknown>,
  tenantId: string,
  jobRunId: string,
  api: WorkerApi,
): Promise<Record<string, unknown>> {
  if (handler === 'AI_OPTIMIZATION') {
    return api.request(tenantId, '/api/v1/control/ai/jobs/execute', {
      body: JSON.stringify({ ...payload, jobRunId }),
      method: 'POST',
    });
  }
  if (handler !== 'RECONCILIATION') return routeHandler(handler, payload);
  const periodEnd = payload.periodEnd
    ? new Date(String(payload.periodEnd))
    : new Date();
  if (!payload.periodEnd) periodEnd.setUTCHours(0, 0, 0, 0);
  const periodStart = payload.periodStart
    ? new Date(String(payload.periodStart))
    : new Date(periodEnd.getTime() - 86_400_000);
  return api.request(tenantId, '/api/v1/control/reconciliations/runs', {
    body: JSON.stringify({
      periodEnd: periodEnd.toISOString(),
      periodStart: periodStart.toISOString(),
      triggerRef: jobRunId,
      type: payload.type,
    }),
    method: 'POST',
  });
}

export async function routeHandler(
  handler: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const allowed = new Set([
    'AI_OPTIMIZATION',
    'EXPORT',
    'IMPORT',
    'NOTIFICATION_RETRY',
    'RECONCILIATION',
    'REPORT',
    'SYSTEM_CLEANUP',
  ]);
  if (!allowed.has(handler)) throw new Error('JOB_HANDLER_UNKNOWN');
  return { accepted: true, handler, payload };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('JOB_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
