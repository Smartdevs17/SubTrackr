/**
 * Shared types for Soroban node reputation and selection.
 * Issue #612
 */

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
}

export interface NodeMetrics {
  nodeId: string;
  /** Rolling 24h success rate (0–1) */
  successRate: number;
  /** Response time percentiles in milliseconds */
  latency: LatencyPercentiles;
  /** Last observed ledger/block height from this node */
  lastBlockHeight: number;
  /** Whether the node responded to the last liveness ping */
  isLive: boolean;
  /** Timestamp of last successful liveness ping */
  lastPingAt: number;
  /** Consecutive request failures */
  consecutiveFailures: number;
  /** Whether the node is marked dead */
  isDead: boolean;
  /** Timestamp when dead status was set */
  deadSince?: number;
  /** Timestamp of last health-check retry for dead nodes */
  lastHealthCheckAt?: number;
}

export interface NodeReputationScore {
  nodeId: string;
  /** Composite score 0–1 */
  score: number;
  successRateComponent: number;
  inverseLatencyComponent: number;
  freshnessComponent: number;
  livenessComponent: number;
  computedAt: number;
}

export interface NodeSelectionResult {
  primary: string;
  secondary: string | null;
  tertiary: string | null;
}

export interface CircuitBreakerState {
  open: boolean;
  openedAt?: number;
  lastRetryAt?: number;
  alertSent: boolean;
}

export interface RpcRequestOutcome {
  nodeId: string;
  success: boolean;
  responseTimeMs: number;
  blockHeight?: number;
  timestamp: number;
}

export interface NodeHealthSnapshot {
  nodeId: string;
  metrics: NodeMetrics;
  score: NodeReputationScore;
}

export interface ReputationDashboardSnapshot {
  nodes: NodeHealthSnapshot[];
  circuitBreaker: CircuitBreakerState;
  aliveCount: number;
  deadCount: number;
}

/** Weight constants for reputation formula */
export const REPUTATION_WEIGHTS = {
  successRate: 0.4,
  inverseLatency: 0.3,
  freshness: 0.2,
  liveness: 0.1,
} as const;

/** Operational thresholds */
export const REPUTATION_THRESHOLDS = {
  /** Consecutive failures before marking a node dead */
  deadNodeFailureCount: 5,
  /** Health-check interval for dead nodes (ms) */
  deadNodeHealthCheckMs: 5 * 60 * 1000,
  /** Liveness ping interval (ms) */
  livenessPingIntervalMs: 30 * 1000,
  /** Circuit breaker retry interval when all nodes dead (ms) */
  circuitBreakerRetryMs: 30 * 1000,
  /** Rolling window for success rate (ms) — 24 hours */
  successRateWindowMs: 24 * 60 * 60 * 1000,
  /** Neutral score for newly registered nodes (50th percentile) */
  neutralScore: 0.5,
} as const;
