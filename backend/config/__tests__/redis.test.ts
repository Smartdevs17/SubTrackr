import {
  DEFAULT_REDIS_CONFIG,
  loadRedisConfig,
  redisConnectionUrl,
} from '../redis';

describe('redis config', () => {
  it('loads defaults when env vars are unset', () => {
    const config = loadRedisConfig({});
    expect(config.host).toBe(DEFAULT_REDIS_CONFIG.host);
    expect(config.port).toBe(6379);
    expect(config.db).toBe(0);
    expect(config.defaultTtlSeconds).toBe(3600);
  });

  it('reads custom env values', () => {
    const config = loadRedisConfig({
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: '6380',
      REDIS_PASSWORD: 'secret',
      REDIS_DB: '2',
      REDIS_DEFAULT_TTL_SECONDS: '7200',
    });
    expect(config.host).toBe('redis.internal');
    expect(config.port).toBe(6380);
    expect(config.password).toBe('secret');
    expect(config.db).toBe(2);
    expect(config.defaultTtlSeconds).toBe(7200);
  });

  it('builds connection URL without password', () => {
    expect(redisConnectionUrl({ ...DEFAULT_REDIS_CONFIG })).toBe(
      'redis://localhost:6379/0',
    );
  });

  it('builds connection URL with password', () => {
    const url = redisConnectionUrl({
      ...DEFAULT_REDIS_CONFIG,
      password: 'p@ss',
    });
    expect(url).toBe('redis://:p%40ss@localhost:6379/0');
  });

  it('falls back for invalid numeric env values', () => {
    const config = loadRedisConfig({
      REDIS_PORT: 'not-a-number',
      REDIS_DB: '-5',
    });
    expect(config.port).toBe(DEFAULT_REDIS_CONFIG.port);
    expect(config.db).toBe(0);
  });
});
