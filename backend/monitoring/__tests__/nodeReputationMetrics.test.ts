/**
 * Tests for node reputation monitoring metrics — Issue #612
 */

import { NodeReputationMetrics } from '../nodeReputationMetrics';
import { NodeReputationService } from '../../shared/soroban/NodeReputationService';

describe('NodeReputationMetrics', () => {
  let reputation: NodeReputationService;
  let metrics: NodeReputationMetrics;
  let now: number;

  beforeEach(() => {
    now = 3_000_000;
    reputation = new NodeReputationService(undefined, undefined, undefined, () => now);
    metrics = new NodeReputationMetrics(reputation);
  });

  afterEach(() => {
    reputation.destroy();
  });

  it('collects per-node metrics including latency percentiles and score', () => {
    reputation.registerNode('node-1');
    for (let i = 0; i < 5; i++) {
      reputation.recordOutcome({
        nodeId: 'node-1',
        success: true,
        responseTimeMs: 100 + i * 10,
        blockHeight: 5000,
        timestamp: now + i,
      });
    }

    const snapshot = metrics.collect();
    expect(snapshot.totalNodes).toBe(1);
    expect(snapshot.aliveNodes).toBe(1);
    expect(snapshot.avgScore).toBeGreaterThan(0);

    const names = snapshot.entries.map((e) => e.name);
    expect(names).toContain('node_latency_p50_ms');
    expect(names).toContain('node_latency_p95_ms');
    expect(names).toContain('node_latency_p99_ms');
    expect(names).toContain('node_success_rate');
    expect(names).toContain('node_reputation_score');
    expect(names).toContain('node_last_block_height');
    expect(names).toContain('node_liveness');
  });

  it('reports circuit breaker state', () => {
    reputation.registerNode('dead-node');
    for (let i = 0; i < 5; i++) {
      reputation.recordOutcome({
        nodeId: 'dead-node',
        success: false,
        responseTimeMs: 100,
        timestamp: now + i,
      });
    }
    const snapshot = metrics.collect();
    expect(snapshot.circuitBreakerOpen).toBe(true);
    expect(snapshot.deadNodes).toBe(1);
  });
});
