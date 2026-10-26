/**
 * No-op Redis client for DB-only fallback when Redis is unavailable at startup.
 */

import type { RedisClient } from './types';

export function createNullRedisClient(): RedisClient {
  return {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 0,
    keys: async () => [],
    ping: async () => {
      throw new Error('Redis not configured');
    },
    quit: async () => 'OK',
  };
}
