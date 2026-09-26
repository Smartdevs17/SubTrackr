/**
 * Redis-backed persistence for Soroban node reputation scores.
 * Issue #612 — 5-minute TTL per node score.
 */

import type { RedisClient } from '../../services/subscriptionCacheService';

export interface NodeScoreRecord {
  nodeId: string;
  score: number;
  successRate: number;
  inverseLatency: number;
  freshness: number;
  liveness: number;
  updatedAt: number;
}

export interface NodeScoreCacheConfig {
  /** TTL for score entries in seconds. Default: 300 (5 min). */
  ttlSeconds?: number;
  /** Redis key prefix. Default: 'subtrackr:soroban:score:'. */
  keyPrefix?: string;
}

const DEFAULTS = {
  ttlSeconds: 300,
  keyPrefix: 'subtrackr:soroban:score:',
} as const;

export class NodeScoreCache {
  private readonly ttl: number;
  private readonly prefix: string;
  private writes = 0;
  private reads = 0;
  private errors = 0;

  constructor(
    private readonly redis: RedisClient,
    config: NodeScoreCacheConfig = {},
  ) {
    this.ttl = config.ttlSeconds ?? DEFAULTS.ttlSeconds;
    this.prefix = config.keyPrefix ?? DEFAULTS.keyPrefix;
  }

  private key(nodeId: string): string {
    return `${this.prefix}${nodeId}`;
  }

  async save(record: NodeScoreRecord): Promise<void> {
    try {
      await this.redis.set(this.key(record.nodeId), JSON.stringify(record), 'EX', this.ttl);
      this.writes++;
    } catch {
      this.errors++;
    }
  }

  async get(nodeId: string): Promise<NodeScoreRecord | null> {
    try {
      const raw = await this.redis.get(this.key(nodeId));
      this.reads++;
      if (!raw) return null;
      return JSON.parse(raw) as NodeScoreRecord;
    } catch {
      this.errors++;
      return null;
    }
  }

  async getAll(nodeIds: string[]): Promise<Map<string, NodeScoreRecord>> {
    const result = new Map<string, NodeScoreRecord>();
    await Promise.all(
      nodeIds.map(async (id) => {
        const record = await this.get(id);
        if (record) result.set(id, record);
      }),
    );
    return result;
  }

  async invalidate(nodeId: string): Promise<void> {
    try {
      await this.redis.del(this.key(nodeId));
    } catch {
      this.errors++;
    }
  }

  getMetrics(): { writes: number; reads: number; errors: number } {
    return { writes: this.writes, reads: this.reads, errors: this.errors };
  }
}
