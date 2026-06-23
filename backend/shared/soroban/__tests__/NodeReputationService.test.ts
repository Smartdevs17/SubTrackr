/**
 * Tests for NodeReputationService — Issue #612
 */

import { NodeReputationService } from '../NodeReputationService';
import { NodeScoreCache } from '../../cache/nodeScoreCache';
import type { RedisClient } from '../../../services/subscriptionCacheService';
import { REPUTATION_THRESHOLDS, REPUTATION_WEIGHTS } from '../types';

class FakeRedis implements RedisClient {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _mode: 'EX', _ttl: number): Promise<'OK'> {
    this.store.set(key, value);
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

describe('NodeReputationService', () => {
  let svc: NodeReputationService;
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    svc = new NodeReputationService(undefined, undefined, undefined, () => now);
  });

  afterEach(() => {
    svc.destroy();
  });

  it('assigns neutral score to newly registered nodes', () => {
    svc.registerNode('node-a');
    const score = svc.getScore('node-a');
    expect(score.score).toBe(REPUTATION_THRESHOLDS.neutralScore);
  });

  it('tracks success rate over rolling 24h window', () => {
    svc.registerNode('node-a');
    for (let i = 0; i < 8; i++) {
      svc.recordOutcome({
        nodeId: 'node-a',
        success: i < 6,
        responseTimeMs: 100,
        timestamp: now + i * 1000,
      });
    }
    const metrics = svc.getMetrics('node-a')!;
    expect(metrics.successRate).toBeCloseTo(0.75);
  });

  it('computes latency percentiles p50, p95, p99', () => {
    svc.registerNode('node-a');
    const latencies = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
    for (const ms of latencies) {
      svc.recordOutcome({
        nodeId: 'node-a',
        success: true,
        responseTimeMs: ms,
        timestamp: now,
      });
    }
    const { latency } = svc.getMetrics('node-a')!;
    expect(latency.p50).toBeGreaterThan(0);
    expect(latency.p95).toBeGreaterThanOrEqual(latency.p50);
    expect(latency.p99).toBeGreaterThanOrEqual(latency.p95);
  });

  it('applies reputation formula weights correctly', () => {
    svc.registerNode('node-a');
    for (let i = 0; i < 10; i++) {
      svc.recordOutcome({
        nodeId: 'node-a',
        success: true,
        responseTimeMs: 100,
        blockHeight: 1000,
        timestamp: now + i,
      });
    }
    const score = svc.getScore('node-a');
    const expected =
      score.successRateComponent +
      score.inverseLatencyComponent +
      score.freshnessComponent +
      score.livenessComponent;
    expect(score.score).toBeCloseTo(expected, 5);
    expect(REPUTATION_WEIGHTS.successRate).toBe(0.4);
    expect(REPUTATION_WEIGHTS.inverseLatency).toBe(0.3);
    expect(REPUTATION_WEIGHTS.freshness).toBe(0.2);
    expect(REPUTATION_WEIGHTS.liveness).toBe(0.1);
  });

  it('marks node dead after 5 consecutive failures', () => {
    svc.registerNode('node-a');
    for (let i = 0; i < 5; i++) {
      svc.recordOutcome({
        nodeId: 'node-a',
        success: false,
        responseTimeMs: 500,
        timestamp: now + i,
      });
    }
    const metrics = svc.getMetrics('node-a')!;
    expect(metrics.isDead).toBe(true);
    expect(metrics.consecutiveFailures).toBe(5);
    expect(svc.getAliveNodeIds()).not.toContain('node-a');
  });

  it('opens circuit breaker when all nodes are dead', () => {
    const alerts: string[] = [];
    const alertSvc = new NodeReputationService(
      undefined,
      undefined,
      { alert: (_t, msg) => alerts.push(msg) },
      () => now,
    );
    alertSvc.registerNode('node-a');
    alertSvc.registerNode('node-b');
    for (const id of ['node-a', 'node-b']) {
      for (let i = 0; i < 5; i++) {
        alertSvc.recordOutcome({
          nodeId: id,
          success: false,
          responseTimeMs: 100,
          timestamp: now + i,
        });
      }
    }
    expect(alertSvc.isCircuitOpen()).toBe(true);
    expect(alerts.length).toBeGreaterThan(0);
    alertSvc.destroy();
  });

  it('persists scores to Redis cache with TTL', async () => {
    const cache = new NodeScoreCache(new FakeRedis());
    const cachedSvc = new NodeReputationService(cache, undefined, undefined, () => now);
    cachedSvc.registerNode('node-a');
    cachedSvc.recordOutcome({
      nodeId: 'node-a',
      success: true,
      responseTimeMs: 50,
      blockHeight: 500,
      timestamp: now,
    });
    // Allow async cache write
    await new Promise((r) => setTimeout(r, 10));
    const record = await cache.get('node-a');
    expect(record).not.toBeNull();
    expect(record!.nodeId).toBe('node-a');
    expect(record!.score).toBeGreaterThan(0);
    cachedSvc.destroy();
  });

  it('tracks last block height from outcomes', () => {
    svc.registerNode('node-a');
    svc.recordOutcome({
      nodeId: 'node-a',
      success: true,
      responseTimeMs: 80,
      blockHeight: 12345,
      timestamp: now,
    });
    expect(svc.getMetrics('node-a')!.lastBlockHeight).toBe(12345);
  });

  it('exposes dashboard snapshot', () => {
    svc.registerNode('node-a');
    svc.recordOutcome({
      nodeId: 'node-a',
      success: true,
      responseTimeMs: 100,
      timestamp: now,
    });
    const dash = svc.getDashboard();
    expect(dash.nodes).toHaveLength(1);
    expect(dash.aliveCount).toBe(1);
    expect(dash.deadCount).toBe(0);
  });
});
