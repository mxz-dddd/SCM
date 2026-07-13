export interface RedisConnectionOptions {
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

  return {
    host: environment.REDIS_HOST ?? 'localhost',
    port,
  };
}
