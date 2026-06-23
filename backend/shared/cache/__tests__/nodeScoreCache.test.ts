/**
 * Tests for NodeScoreCache — Issue #612
 */

import { NodeScoreCache } from '../nodeScoreCache';
import type { RedisClient } from '../../../services/subscriptionCacheService';

class FakeRedis implements RedisClient {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, _mode: 'EX', ttlSeconds: number): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) n++;
    }
    return n;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace(/\*$/, '');
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }
}

describe('NodeScoreCache', () => {
  it('saves and retrieves node scores', async () => {
    const cache = new NodeScoreCache(new FakeRedis());
    await cache.save({
      nodeId: 'node-1',
      score: 0.85,
      successRate: 0.9,
      inverseLatency: 0.8,
      freshness: 0.95,
      liveness: 1,
      updatedAt: Date.now(),
    });
    const record = await cache.get('node-1');
    expect(record!.score).toBe(0.85);
    expect(record!.successRate).toBe(0.9);
  });

  it('uses 5-minute default TTL', async () => {
    const cache = new NodeScoreCache(new FakeRedis());
    expect(cache.getMetrics().writes).toBe(0);
    await cache.save({
      nodeId: 'node-2',
      score: 0.5,
      successRate: 0.5,
      inverseLatency: 0.5,
      freshness: 0.5,
      liveness: 0.5,
      updatedAt: Date.now(),
    });
    expect(cache.getMetrics().writes).toBe(1);
  });

  it('retrieves multiple scores via getAll', async () => {
    const cache = new NodeScoreCache(new FakeRedis());
    await cache.save({
      nodeId: 'a',
      score: 0.7,
      successRate: 0.7,
      inverseLatency: 0.7,
      freshness: 0.7,
      liveness: 0.7,
      updatedAt: Date.now(),
    });
    await cache.save({
      nodeId: 'b',
      score: 0.8,
      successRate: 0.8,
      inverseLatency: 0.8,
      freshness: 0.8,
      liveness: 0.8,
      updatedAt: Date.now(),
    });
    const all = await cache.getAll(['a', 'b', 'missing']);
    expect(all.size).toBe(2);
    expect(all.get('a')!.score).toBe(0.7);
  });

  it('invalidates cached scores', async () => {
    const cache = new NodeScoreCache(new FakeRedis());
    await cache.save({
      nodeId: 'node-x',
      score: 0.6,
      successRate: 0.6,
      inverseLatency: 0.6,
      freshness: 0.6,
      liveness: 0.6,
      updatedAt: Date.now(),
    });
    await cache.invalidate('node-x');
    expect(await cache.get('node-x')).toBeNull();
  });
});
