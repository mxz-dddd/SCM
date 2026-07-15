import type { Job } from 'bullmq';
import { HttpWorkerApi, type WorkerApi } from './job-runner';

interface PrintJobData {
  readonly printJobId: string;
  readonly tenantId: string;
}
interface PrintState {
  readonly version: number;
}

export async function processPrintJob(
  job: Job<PrintJobData>,
  api: WorkerApi = new HttpWorkerApi(),
) {
  const { printJobId, tenantId } = job.data;
  const leaseOwner = `print-worker:${process.pid}:${job.id ?? printJobId}`;
  const current = await api.request<PrintState>(
    tenantId,
    `/api/v1/platform/finalization/print-jobs/${printJobId}`,
  );
  const claimed = await api.request<
    PrintState & { routeSnapshot: unknown; templateSnapshot: unknown }
  >(tenantId, `/api/v1/platform/finalization/print-jobs/${printJobId}/claim`, {
    body: JSON.stringify({ expectedVersion: current.version, leaseOwner }),
    method: 'POST',
  });
  try {
    if (!claimed.routeSnapshot || !claimed.templateSnapshot)
      throw new Error('PRINT_ROUTE_INVALID');
    return await api.request(
      tenantId,
      `/api/v1/platform/finalization/print-jobs/${printJobId}/complete`,
      {
        body: JSON.stringify({
          expectedVersion: claimed.version,
          leaseOwner,
          success: true,
        }),
        method: 'POST',
      },
    );
  } catch (error) {
    const completion = await api.request<{ retryable: boolean }>(
      tenantId,
      `/api/v1/platform/finalization/print-jobs/${printJobId}/complete`,
      {
        body: JSON.stringify({
          expectedVersion: claimed.version,
          failureCode: 'PRINT_DELIVERY_FAILED',
          leaseOwner,
          success: false,
        }),
        method: 'POST',
      },
    );
    if (completion.retryable) throw error;
    return completion;
  }
}
