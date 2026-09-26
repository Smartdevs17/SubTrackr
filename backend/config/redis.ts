/**
 * Redis connection configuration for distributed caching.
 *
 * Environment variables:
 *   REDIS_HOST     – default: localhost
 *   REDIS_PORT     – default: 6379
 *   REDIS_PASSWORD – optional
 *   REDIS_DB       – default: 0
 *   REDIS_DEFAULT_TTL_SECONDS – default plan cache TTL: 3600 (1 hour)
 */

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  /** Default TTL for plan metadata entries in seconds. */
  defaultTtlSeconds: number;
  /** Connection timeout in milliseconds. */
  connectTimeoutMs: number;
}

export const DEFAULT_REDIS_CONFIG: Readonly<RedisConfig> = {
  host: 'localhost',
  port: 6379,
  db: 0,
  defaultTtlSeconds: 3600,
  connectTimeoutMs: 5_000,
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Load Redis configuration from environment variables. */
export function loadRedisConfig(env: NodeJS.ProcessEnv = process.env): RedisConfig {
  const password = env.REDIS_PASSWORD?.trim();
  return {
    host: env.REDIS_HOST?.trim() || DEFAULT_REDIS_CONFIG.host,
    port: parsePositiveInt(env.REDIS_PORT, DEFAULT_REDIS_CONFIG.port),
    password: password || undefined,
    db: parsePositiveInt(env.REDIS_DB, DEFAULT_REDIS_CONFIG.db),
    defaultTtlSeconds: parsePositiveInt(
      env.REDIS_DEFAULT_TTL_SECONDS,
      DEFAULT_REDIS_CONFIG.defaultTtlSeconds,
    ),
    connectTimeoutMs: parsePositiveInt(
      env.REDIS_CONNECT_TIMEOUT_MS,
      DEFAULT_REDIS_CONFIG.connectTimeoutMs,
    ),
  };
}

/** Build a redis:// connection URL from config (password omitted when unset). */
export function redisConnectionUrl(config: RedisConfig = loadRedisConfig()): string {
  const auth = config.password ? `:${encodeURIComponent(config.password)}@` : '';
  return `redis://${auth}${config.host}:${config.port}/${config.db}`;
}
