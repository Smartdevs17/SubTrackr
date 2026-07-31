/**
 * NodeReputationService — tracks RPC node health metrics and computes reputation scores.
 * Issue #612
 *
 * Score formula: 40% success rate + 30% inverse latency + 20% freshness + 10% liveness
 */

import type { SorobanNodeConfig } from '../../config/sorobanNodeRegistry';
import type { NodeScoreCache } from '../cache/nodeScoreCache';
import type {
  CircuitBreakerState,
  NodeMetrics,
  NodeReputationScore,
  ReputationDashboardSnapshot,
  RpcRequestOutcome,
} from './types';
import {
  REPUTATION_THRESHOLDS,
  REPUTATION_WEIGHTS,
} from './types';

export interface LivenessProvider {
  ping(node: SorobanNodeConfig): Promise<{ alive: boolean; blockHeight?: number }>;
}

export interface OpsAlertDispatcher {
  alert(title: string, message: string): void;
}

interface OutcomeRecord {
  success: boolean;
  responseTimeMs: number;
  blockHeight?: number;
  timestamp: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function createDefaultMetrics(nodeId: string): NodeMetrics {
  return {
    nodeId,
    successRate: 1,
    latency: { p50: 0, p95: 0, p99: 0 },
    lastBlockHeight: 0,
    isLive: true,
    lastPingAt: 0,
    consecutiveFailures: 0,
    isDead: false,
  };
}

export class NodeReputationService {
  private metrics = new Map<string, NodeMetrics>();
  private outcomes = new Map<string, OutcomeRecord[]>();
  private scores = new Map<string, NodeReputationScore>();
  private circuitBreaker: CircuitBreakerState = { open: false, alertSent: false };
  private livenessTimer?: ReturnType<typeof setInterval>;
  private circuitRetryTimer?: ReturnType<typeof setInterval>;
  private nowFn: () => number;

  constructor(
    private readonly scoreCache?: NodeScoreCache,
    private readonly livenessProvider?: LivenessProvider,
    private readonly opsAlert?: OpsAlertDispatcher,
    nowFn: () => number = Date.now,
  ) {
    this.nowFn = nowFn;
  }

  // ── Node registration ─────────────────────────────────────────────────────

  registerNode(nodeId: string): void {
    if (!this.metrics.has(nodeId)) {
      this.metrics.set(nodeId, createDefaultMetrics(nodeId));
      this.outcomes.set(nodeId, []);
      this.scores.set(nodeId, this.buildNeutralScore(nodeId));
    }
  }

  registerNodes(nodes: SorobanNodeConfig[]): void {
    for (const node of nodes) {
      this.registerNode(node.id);
    }
  }

  // ── Request outcome recording ───────────────────────────────────────────────

  recordOutcome(outcome: RpcRequestOutcome): void {
    this.registerNode(outcome.nodeId);
    const records = this.outcomes.get(outcome.nodeId)!;
    records.push({
      success: outcome.success,
      responseTimeMs: outcome.responseTimeMs,
      blockHeight: outcome.blockHeight,
      timestamp: outcome.timestamp,
    });
    this.pruneOutcomes(outcome.nodeId);
    this.recomputeMetrics(outcome.nodeId);
    void this.recomputeScore(outcome.nodeId);
  }

  // ── Liveness monitoring ─────────────────────────────────────────────────────

  startLivenessChecks(nodes: SorobanNodeConfig[]): void {
    this.stopLivenessChecks();
    for (const node of nodes) {
      this.registerNode(node.id);
    }
    this.livenessTimer = setInterval(() => {
      void this.runLivenessChecks(nodes);
    }, REPUTATION_THRESHOLDS.livenessPingIntervalMs);
  }

  stopLivenessChecks(): void {
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = undefined;
    }
  }

  async runLivenessChecks(nodes: SorobanNodeConfig[]): Promise<void> {
    if (!this.livenessProvider) return;
    const now = this.nowFn();
    await Promise.all(
      nodes.map(async (node) => {
        this.registerNode(node.id);
        const m = this.metrics.get(node.id)!;
        if (m.isDead) return;

        try {
          const result = await this.livenessProvider!.ping(node);
          m.isLive = result.alive;
          m.lastPingAt = now;
          if (result.blockHeight !== undefined) {
            m.lastBlockHeight = result.blockHeight;
          }
        } catch {
          m.isLive = false;
          m.lastPingAt = now;
        }
        await this.recomputeScore(node.id);
      }),
    );
    this.updateCircuitBreaker();
  }

  // ── Dead node management ────────────────────────────────────────────────────

  async retryDeadNodeHealthCheck(
    nodeId: string,
    node: SorobanNodeConfig,
  ): Promise<boolean> {
    const m = this.metrics.get(nodeId);
    if (!m || !m.isDead) return false;

    const now = this.nowFn();
    if (
      m.lastHealthCheckAt &&
      now - m.lastHealthCheckAt < REPUTATION_THRESHOLDS.deadNodeHealthCheckMs
    ) {
      return false;
    }
    m.lastHealthCheckAt = now;

    if (!this.livenessProvider) return false;

    try {
      const result = await this.livenessProvider.ping(node);
      if (result.alive) {
        m.isDead = false;
        m.deadSince = undefined;
        m.consecutiveFailures = 0;
        m.isLive = true;
        m.lastPingAt = now;
        if (result.blockHeight !== undefined) {
          m.lastBlockHeight = result.blockHeight;
        }
        await this.recomputeScore(nodeId);
        this.updateCircuitBreaker();
        return true;
      }
    } catch {
      // remain dead
    }
    return false;
  }

  // ── Score access ────────────────────────────────────────────────────────────

  getScore(nodeId: string): NodeReputationScore {
    return (
      this.scores.get(nodeId) ?? this.buildNeutralScore(nodeId)
    );
  }

  getAllScores(): NodeReputationScore[] {
    return [...this.scores.values()];
  }

  getMetrics(nodeId: string): NodeMetrics | undefined {
    return this.metrics.get(nodeId);
  }

  getAliveNodeIds(): string[] {
    return [...this.metrics.entries()]
      .filter(([, m]) => !m.isDead)
      .map(([id]) => id);
  }

  getCircuitBreaker(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  isCircuitOpen(): boolean {
    return this.circuitBreaker.open;
  }

  getDashboard(): ReputationDashboardSnapshot {
    const nodes: ReputationDashboardSnapshot['nodes'] = [];
    for (const [nodeId, metrics] of this.metrics) {
      nodes.push({
        nodeId,
        metrics: { ...metrics, latency: { ...metrics.latency } },
        score: this.getScore(nodeId),
      });
    }
    const aliveCount = nodes.filter((n) => !n.metrics.isDead).length;
    return {
      nodes,
      circuitBreaker: this.getCircuitBreaker(),
      aliveCount,
      deadCount: nodes.length - aliveCount,
    };
  }

  async loadScoresFromCache(nodeIds: string[]): Promise<void> {
    if (!this.scoreCache) return;
    const cached = await this.scoreCache.getAll(nodeIds);
    for (const [nodeId, record] of cached) {
      this.registerNode(nodeId);
      this.scores.set(nodeId, {
        nodeId,
        score: record.score,
        successRateComponent: record.successRate * REPUTATION_WEIGHTS.successRate,
        inverseLatencyComponent: record.inverseLatency * REPUTATION_WEIGHTS.inverseLatency,
        freshnessComponent: record.freshness * REPUTATION_WEIGHTS.freshness,
        livenessComponent: record.liveness * REPUTATION_WEIGHTS.liveness,
        computedAt: record.updatedAt,
      });
    }
  }

  destroy(): void {
    this.stopLivenessChecks();
    if (this.circuitRetryTimer) {
      clearInterval(this.circuitRetryTimer);
      this.circuitRetryTimer = undefined;
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private pruneOutcomes(nodeId: string): void {
    const cutoff = this.nowFn() - REPUTATION_THRESHOLDS.successRateWindowMs;
    const records = this.outcomes.get(nodeId)!;
    this.outcomes.set(
      nodeId,
      records.filter((r) => r.timestamp >= cutoff),
    );
  }

  private recomputeMetrics(nodeId: string): void {
    const m = this.metrics.get(nodeId)!;
    const records = this.outcomes.get(nodeId) ?? [];
    const now = this.nowFn();

    if (records.length > 0) {
      const successes = records.filter((r) => r.success).length;
      m.successRate = successes / records.length;

      const latencies = records
        .filter((r) => r.success)
        .map((r) => r.responseTimeMs)
        .sort((a, b) => a - b);
      m.latency = {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
      };

      const heights = records
        .filter((r) => r.blockHeight !== undefined)
        .map((r) => r.blockHeight!);
      if (heights.length > 0) {
        m.lastBlockHeight = Math.max(...heights);
      }

      const last = records[records.length - 1];
      if (last.success) {
        m.consecutiveFailures = 0;
      } else {
        m.consecutiveFailures++;
      }
    }

    if (m.consecutiveFailures >= REPUTATION_THRESHOLDS.deadNodeFailureCount && !m.isDead) {
      m.isDead = true;
      m.deadSince = now;
      m.isLive = false;
    }

    this.updateCircuitBreaker();
  }

  private async recomputeScore(nodeId: string): Promise<void> {
    const m = this.metrics.get(nodeId);
    if (!m) return;

    const maxBlockHeight = this.getMaxBlockHeight();
    const successNorm = m.successRate;

    const maxLatency = this.getMaxP95Latency() || 1;
    const latencyNorm = m.latency.p95 > 0 ? 1 - Math.min(1, m.latency.p95 / maxLatency) : 1;

    const freshnessNorm =
      maxBlockHeight > 0 && m.lastBlockHeight > 0
        ? Math.min(1, m.lastBlockHeight / maxBlockHeight)
        : REPUTATION_THRESHOLDS.neutralScore;

    const livenessNorm = m.isLive ? 1 : 0;

    const successRateComponent = successNorm * REPUTATION_WEIGHTS.successRate;
    const inverseLatencyComponent = latencyNorm * REPUTATION_WEIGHTS.inverseLatency;
    const freshnessComponent = freshnessNorm * REPUTATION_WEIGHTS.freshness;
    const livenessComponent = livenessNorm * REPUTATION_WEIGHTS.liveness;

    const score: NodeReputationScore = {
      nodeId,
      score:
        successRateComponent +
        inverseLatencyComponent +
        freshnessComponent +
        livenessComponent,
      successRateComponent,
      inverseLatencyComponent,
      freshnessComponent,
      livenessComponent,
      computedAt: this.nowFn(),
    };

    this.scores.set(nodeId, score);

    if (this.scoreCache) {
      await this.scoreCache.save({
        nodeId,
        score: score.score,
        successRate: successNorm,
        inverseLatency: latencyNorm,
        freshness: freshnessNorm,
        liveness: livenessNorm,
        updatedAt: score.computedAt,
      });
    }
  }

  private buildNeutralScore(nodeId: string): NodeReputationScore {
    const n = REPUTATION_THRESHOLDS.neutralScore;
    return {
      nodeId,
      score: n,
      successRateComponent: n * REPUTATION_WEIGHTS.successRate,
      inverseLatencyComponent: n * REPUTATION_WEIGHTS.inverseLatency,
      freshnessComponent: n * REPUTATION_WEIGHTS.freshness,
      livenessComponent: n * REPUTATION_WEIGHTS.liveness,
      computedAt: this.nowFn(),
    };
  }

  private getMaxBlockHeight(): number {
    let max = 0;
    for (const m of this.metrics.values()) {
      if (m.lastBlockHeight > max) max = m.lastBlockHeight;
    }
    return max;
  }

  private getMaxP95Latency(): number {
    let max = 0;
    for (const m of this.metrics.values()) {
      if (m.latency.p95 > max) max = m.latency.p95;
    }
    return max;
  }

  private updateCircuitBreaker(): void {
    const alive = this.getAliveNodeIds();
    const now = this.nowFn();

    if (alive.length === 0 && this.metrics.size > 0) {
      if (!this.circuitBreaker.open) {
        this.circuitBreaker = { open: true, openedAt: now, alertSent: false, lastRetryAt: now };
      }
      if (!this.circuitBreaker.alertSent && this.opsAlert) {
        this.opsAlert.alert(
          'Soroban RPC Circuit Breaker Open',
          'All Soroban RPC nodes are marked dead. Transaction routing paused.',
        );
        this.circuitBreaker.alertSent = true;
      }
      this.scheduleCircuitRetry();
    } else if (alive.length > 0 && this.circuitBreaker.open) {
      this.circuitBreaker = { open: false, alertSent: false };
      if (this.circuitRetryTimer) {
        clearInterval(this.circuitRetryTimer);
        this.circuitRetryTimer = undefined;
      }
    }
  }

  private scheduleCircuitRetry(): void {
    if (this.circuitRetryTimer) return;
    this.circuitRetryTimer = setInterval(() => {
      this.circuitBreaker.lastRetryAt = this.nowFn();
      // Dead node health checks are driven externally via retryDeadNodeHealthCheck
    }, REPUTATION_THRESHOLDS.circuitBreakerRetryMs);
  }
}

export const nodeReputationService = new NodeReputationService();
