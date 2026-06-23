/**
 * Node reputation and health metrics for monitoring dashboards.
 * Issue #612
 */

import type { NodeReputationService } from '../shared/soroban/NodeReputationService';
import type { NodeMetrics, NodeReputationScore } from '../shared/soroban/types';

export interface NodeMetricEntry {
  name: string;
  value: number;
  nodeId: string;
  timestamp: number;
}

export interface NodeReputationMetricsSnapshot {
  entries: NodeMetricEntry[];
  totalNodes: number;
  aliveNodes: number;
  deadNodes: number;
  avgScore: number;
  circuitBreakerOpen: boolean;
}

export class NodeReputationMetrics {
  constructor(private readonly reputation: NodeReputationService) {}

  collect(): NodeReputationMetricsSnapshot {
    const dashboard = this.reputation.getDashboard();
    const now = Date.now();
    const entries: NodeMetricEntry[] = [];

    for (const { nodeId, metrics, score } of dashboard.nodes) {
      entries.push(
        this.entry('node_success_rate', metrics.successRate, nodeId, now),
        this.entry('node_latency_p50_ms', metrics.latency.p50, nodeId, now),
        this.entry('node_latency_p95_ms', metrics.latency.p95, nodeId, now),
        this.entry('node_latency_p99_ms', metrics.latency.p99, nodeId, now),
        this.entry('node_last_block_height', metrics.lastBlockHeight, nodeId, now),
        this.entry('node_liveness', metrics.isLive ? 1 : 0, nodeId, now),
        this.entry('node_reputation_score', score.score, nodeId, now),
        this.entry('node_consecutive_failures', metrics.consecutiveFailures, nodeId, now),
        this.entry('node_is_dead', metrics.isDead ? 1 : 0, nodeId, now),
      );
    }

    const scores = dashboard.nodes.map((n) => n.score.score);
    const avgScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    return {
      entries,
      totalNodes: dashboard.nodes.length,
      aliveNodes: dashboard.aliveCount,
      deadNodes: dashboard.deadCount,
      avgScore,
      circuitBreakerOpen: dashboard.circuitBreaker.open,
    };
  }

  getNodeMetrics(nodeId: string): NodeMetrics | undefined {
    return this.reputation.getMetrics(nodeId);
  }

  getNodeScore(nodeId: string): NodeReputationScore {
    return this.reputation.getScore(nodeId);
  }

  private entry(
    name: string,
    value: number,
    nodeId: string,
    timestamp: number,
  ): NodeMetricEntry {
    return { name, value, nodeId, timestamp };
  }
}

import { nodeReputationService } from '../shared/soroban/NodeReputationService';

export const nodeReputationMetrics = new NodeReputationMetrics(nodeReputationService);
