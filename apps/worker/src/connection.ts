export interface RedisConnectionOptions {
  db: number;
  host: string;
  port: number;
}

export function getRedisConnection(
  environment: NodeJS.ProcessEnv = process.env,
): RedisConnectionOptions {
  const port = Number(environment.REDIS_PORT ?? 6379);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('REDIS_PORT must be a valid TCP port');
  }
  const db = Number(environment.REDIS_DB ?? 0);
  if (!Number.isInteger(db) || db < 0 || db > 15) {
    throw new Error('REDIS_DB must be an integer between 0 and 15');
  }

  return {
    db,
    host: environment.REDIS_HOST ?? 'localhost',
    port,
  };
}
