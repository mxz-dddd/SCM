import { createServer } from 'node:http';

export function startWorkerHealthServer(
  snapshot: () => Record<string, unknown>,
  port = Number(process.env.WORKER_HEALTH_PORT ?? 3001),
) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('WORKER_HEALTH_PORT must be a valid TCP port');
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    const health = snapshot();
    const ready = Boolean(health.refreshedAt);
    response
      .writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ ...health, status: ready ? 'ok' : 'refreshing' }));
  });
  server.listen(port);
  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    port,
  };
}
