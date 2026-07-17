import type { HttpWorkerApi, WorkerTenantPage } from './job-runner';

export interface WorkerBacklog {
  readonly eventDeliveries: number;
  readonly jobs: number;
  readonly outbox: number;
  readonly printJobs: number;
  readonly webhooks: number;
}

export class TenantSupervisor {
  private tenants: readonly string[] = [];
  private readonly running = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly failures = new Map<string, string>();
  private backlog: Record<string, WorkerBacklog> = {};
  private refreshedAt?: string;

  constructor(
    private readonly api: HttpWorkerApi,
    private readonly concurrency = 4,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32)
      throw new Error('WORKER_TENANT_CONCURRENCY must be between 1 and 32');
  }

  async refresh() {
    const discovered: WorkerTenantPage['items'][number][] = [];
    let cursor: string | undefined;
    do {
      const page = await this.api.discoverTenants(cursor);
      discovered.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    this.tenants = discovered.map(({ tenantId }) => tenantId);
    this.refreshedAt = new Date().toISOString();
    await this.refreshBacklog();
    return this.tenants;
  }

  async run(
    operation: string,
    handler: (tenantId: string) => Promise<unknown>,
  ) {
    const queue = [...this.tenants];
    const workers = Array.from(
      { length: Math.min(this.concurrency, queue.length) },
      async () => {
        for (;;) {
          const tenantId = queue.shift();
          if (!tenantId) return;
          const key = `${operation}:${tenantId}`;
          if (this.running.has(key)) continue;
          this.running.add(key);
          const task = handler(tenantId)
            .then(() => this.failures.delete(key))
            .catch((error: unknown) => {
              this.failures.set(
                key,
                error instanceof Error ? error.message : String(error),
              );
            })
            .finally(() => this.running.delete(key));
          const tracked = task.then(() => undefined);
          this.inFlight.add(tracked);
          await tracked.finally(() => this.inFlight.delete(tracked));
        }
      },
    );
    await Promise.all(workers);
  }

  health() {
    return {
      backlog: this.backlog,
      discoveredTenantCount: this.tenants.length,
      failedTenants: [...this.failures.entries()].map(([key, message]) => ({
        key,
        message,
      })),
      inFlight: this.inFlight.size,
      refreshedAt: this.refreshedAt,
    };
  }

  async shutdown() {
    await Promise.allSettled([...this.inFlight]);
  }

  private async refreshBacklog() {
    const queue = [...this.tenants];
    const entries: [string, WorkerBacklog][] = [];
    await Promise.all(
      Array.from(
        { length: Math.min(this.concurrency, queue.length) },
        async () => {
          for (;;) {
            const tenantId = queue.shift();
            if (!tenantId) return;
            try {
              const backlog = await this.api.request<WorkerBacklog>(
                tenantId,
                '/api/v1/internal/worker/backlog',
              );
              entries.push([tenantId, backlog]);
            } catch (error) {
              this.failures.set(
                `backlog:${tenantId}`,
                error instanceof Error ? error.message : String(error),
              );
            }
          }
        },
      ),
    );
    this.backlog = Object.fromEntries(entries);
  }
}
