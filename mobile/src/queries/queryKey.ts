/** Stable query-key helpers shared by the cache, client and hooks. */

import type { QueryKey } from './types';

/** Serialise a key deterministically; key order is significant. */
export function serializeQueryKey(key: QueryKey): string {
  if (!Array.isArray(key) || key.length === 0) {
    throw new Error('Query key must be a non-empty array');
  }
  for (const part of key) {
    if (
      typeof part !== 'string' &&
      typeof part !== 'number' &&
      typeof part !== 'boolean' &&
      part !== null
    ) {
      throw new Error('Query key parts must be strings, numbers, booleans or null');
    }
  }
  return JSON.stringify(key);
}

/** True when `key` begins with every part of `prefix`. */
export function isQueryKeyPrefix(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.length <= key.length && prefix.every((part, index) => key[index] === part);
}

/** Human-readable label for logs and traces. */
export function describeQueryKey(key: QueryKey): string {
  return key
    .map((part) => (part === null ? '*' : String(part)))
    .join('/');
}
