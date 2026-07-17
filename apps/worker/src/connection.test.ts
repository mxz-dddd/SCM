import { describe, expect, it } from 'vitest';
import { getRedisConnection } from './connection';

describe('getRedisConnection', () => {
  it('uses explicit Redis connection values', () => {
    expect(
      getRedisConnection({
        REDIS_DB: '12',
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: '6380',
      }),
    ).toEqual({ db: 12, host: 'redis.internal', port: 6380 });
  });

  it('rejects an invalid Redis port', () => {
    expect(() => getRedisConnection({ REDIS_PORT: 'invalid' })).toThrow(
      'REDIS_PORT must be a valid TCP port',
    );
  });

  it('rejects an invalid Redis database', () => {
    expect(() => getRedisConnection({ REDIS_DB: '16' })).toThrow(
      'REDIS_DB must be an integer between 0 and 15',
    );
  });
});
