/**
 * Creates an ioredis-backed RedisClient for the backend cache layer.
 * Uses dynamic import so the mobile bundle never loads ioredis.
 */

import { loadRedisConfig } from '../../config/redis';
import type { RedisClient } from './types';

export interface IORedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: string, time: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  ping(): Promise<string>;
  quit(): Promise<string>;
}

/** Wraps an ioredis instance in the minimal RedisClient interface. */
export function wrapIORedis(client: IORedisLike): RedisClient {
  return {
    get: (key) => client.get(key),
    set: (key, value, mode, time) => client.set(key, value, mode, time),
    del: (...keys) => client.del(...keys),
    keys: (pattern) => client.keys(pattern),
    ping: () => client.ping(),
    quit: () => client.quit(),
  };
}

/**
 * Connect to Redis using environment configuration.
 * Throws when ioredis is not installed or connection fails.
 */
export async function createRedisClient(): Promise<RedisClient> {
  const config = loadRedisConfig();

  const ioredisModule = (await import('ioredis')) as {
    default: new (url: string, options?: Record<string, unknown>) => IORedisLike;
  };

  const Redis = ioredisModule.default;
  const client = new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    connectTimeout: config.connectTimeoutMs,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  await client.ping();
  return wrapIORedis(client);
}
