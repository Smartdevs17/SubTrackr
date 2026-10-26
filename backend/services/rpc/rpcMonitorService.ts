/**
 * RPC Monitor Service — Issue #RPC-CB
 *
 * Central monitoring service for all RPC circuit breakers.
 * Provides:
 *   - Per-endpoint circuit state tracking
 *   - Aggregated chain health summaries
 *   - Prometheus-style metrics
 *   - Alerting on circuit state changes
 *   - Manual circuit reset
 *   - Historical event log
 */

import type { CircuitBreakerEvent, CircuitStateSnapshot } from './circuitBreaker';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RpcMonitorMetrics {
  /** Total RPC calls made. */
  totalCalls: number;
  /** Successful RPC calls. */
  successfulCalls: number;
  /** Failed RPC calls. */
  failedCalls: number;
  /** Calls skipped due to open circuit. */
  skippedCalls: number;
  /** Degraded responses served from cache/fallback. */
  degradedResponses: number;
  /** Average response time in ms. */
  avgResponseTimeMs: number;
  /** P50 response time in ms. */
  p50ResponseTimeMs: number;
  /** P95 response time in ms. */
  p95ResponseTimeMs: number;
  /** P99 response time in ms. */
  p99ResponseTimeMs: number;
}

export interface ChainHealthSummary {
  chainId: number;
  chainName: string;
  totalEndpoints: number;
  healthyEndpoints: number;
  degradedEndpoints: number;
  openEndpoints: number;
  halfOpenEndpoints: number;
  closedEndpoints: number;
  overallHealth: 'healthy' | 'degraded' | 'unhealthy';
  metrics: RpcMonitorMetrics;
  circuits: CircuitStateSnapshot[];
}

export interface RpcMonitorDashboard {
  timestamp: string;
  totalChains: number;
  healthyChains: number;
  degradedChains: number;
  unhealthyChains: number;
  globalMetrics: RpcMonitorMetrics;
  chains: ChainHealthSummary[];
  recentEvents: CircuitBreakerEvent[];
}

export interface RpcDashboardQuery {
  chainId?: number;
  endpointUrl?: string;
  eventLimit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC Monitor Service
// ─────────────────────────────────────────────────────────────────────────────

export class RpcMonitorService {
  private circuits = new Map<string, CircuitStateSnapshot>();
  private events: CircuitBreakerEvent[] = [];
  private readonly maxEvents = 10_000;

  // Per-endpoint call metrics
  private callMetrics = new Map<string, {
    totalCalls: number;
    successes: number;
    failures: number;
    skipped: number;
    degraded: number;
    responseTimes: number[];
    lastError: string | null;
    lastErrorAt: number | null;
  }>();

  // Chain-level degraded response tracking
  private degradedResponses: {
    chainId: number;
    method: string;
    mode: string;
    timestamp: number;
  }[] = [];

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Record a circuit breaker state change event.
   */
  recordCircuitEvent(event: CircuitBreakerEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  /**
   * Record a successful RPC call.
   */
  recordSuccess(endpointUrl: string, chainId: number, durationMs: number): void {
    const key = this.metricKey(endpointUrl, chainId);
    const metrics = this.getOrCreateMetrics(key);
    metrics.totalCalls++;
    metrics.successes++;
    metrics.responseTimes.push(durationMs);

    // Keep last 1000 response times for percentile calculation
    if (metrics.responseTimes.length > 1000) {
      metrics.responseTimes = metrics.responseTimes.slice(-1000);
    }

  }

  /**
   * Record a failed RPC call.
   */
  recordFailure(endpointUrl: string, chainId: number, error: string, durationMs: number): void {
    const key = this.metricKey(endpointUrl, chainId);
    const metrics = this.getOrCreateMetrics(key);
    metrics.totalCalls++;
    metrics.failures++;
    metrics.responseTimes.push(durationMs);
    metrics.lastError = error;
    metrics.lastErrorAt = Date.now();

    if (metrics.responseTimes.length > 1000) {
      metrics.responseTimes = metrics.responseTimes.slice(-1000);
    }

  }

  /**
   * Record a call that was skipped due to open circuit.
   */
  recordSkippedCall(endpointUrl: string, chainId: number, circuitState: string): void {
    const key = this.metricKey(endpointUrl, chainId);
    const metrics = this.getOrCreateMetrics(key);
    metrics.totalCalls++;
    metrics.skipped++;
    metrics.lastError = `Skipped (circuit ${circuitState})`;
    metrics.lastErrorAt = Date.now();
  }

  /**
   * Record a degraded response (served from cache or fallback).
   */
  recordDegradedResponse(chainId: number, method: string, mode: string): void {
    this.degradedResponses.push({ chainId, method, mode, timestamp: Date.now() });
    if (this.degradedResponses.length > 1000) {
      this.degradedResponses = this.degradedResponses.slice(-1000);
    }
  }

  /**
   * Update or register a circuit state snapshot.
   */
  registerCircuit(snapshot: CircuitStateSnapshot): void {
    const key = this.circuitKey(snapshot.chainId, snapshot.endpointUrl);
    this.circuits.set(key, snapshot);
  }

  /**
   * Get the full dashboard of all RPC circuit states and metrics.
   */
  getDashboard(query: RpcDashboardQuery = {}): RpcMonitorDashboard {
    const now = Date.now();
    const chainGroups = this.groupCircuitsByChain();

    const chains: ChainHealthSummary[] = [];

    for (const [chainIdStr, chainCircuits] of chainGroups) {
      const chainId = Number(chainIdStr);
      const healthSummary = this.computeChainHealth(chainId, chainCircuits);
      chains.push(healthSummary);
    }

    // Apply chain filter
    const filteredChains = query.chainId
      ? chains.filter((c) => c.chainId === query.chainId)
      : chains;

    // Apply endpoint filter to circuits within chains
    const endpointFiltered = query.endpointUrl
      ? filteredChains.map((ch) => ({
          ...ch,
          circuits: ch.circuits.filter((c) => c.endpointUrl.includes(query.endpointUrl!)),
        }))
      : filteredChains;

    const totalChains = endpointFiltered.length;
    const healthyChains = endpointFiltered.filter((c) => c.overallHealth === 'healthy').length;
    const degradedChains = endpointFiltered.filter((c) => c.overallHealth === 'degraded').length;
    const unhealthyChains = endpointFiltered.filter((c) => c.overallHealth === 'unhealthy').length;

    const globalMetrics = this.computeGlobalMetrics();

    const eventLimit = query.eventLimit ?? 100;
    const recentEvents = this.events.slice(-eventLimit);

    return {
      timestamp: new Date(now).toISOString(),
      totalChains,
      healthyChains,
      degradedChains,
      unhealthyChains,
      globalMetrics,
      chains: endpointFiltered,
      recentEvents,
    };
  }

  /**
   * Get health summary for a specific chain.
   */
  getChainHealth(chainId: number): ChainHealthSummary | null {
    const dashboard = this.getDashboard({ chainId });
    return dashboard.chains[0] ?? null;
  }

  /**
   * Get recent circuit events.
   */
  getRecentEvents(limit = 50): CircuitBreakerEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Get Prometheus-formatted metrics for all circuits.
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];

    for (const snapshot of this.circuits.values()) {
      const labels = `chain="${snapshot.chainId}",endpoint="${snapshot.endpointLabel}",url="${snapshot.endpointUrl}"`;

      lines.push(`# HELP rpc_circuit_state Current circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)`);
      lines.push(`# TYPE rpc_circuit_state gauge`);
      const stateValue = snapshot.state === 'CLOSED' ? 0 : snapshot.state === 'OPEN' ? 1 : 2;
      lines.push(`rpc_circuit_state{${labels}} ${stateValue}`);

      lines.push(`# HELP rpc_circuit_consecutive_failures Consecutive failures count`);
      lines.push(`# TYPE rpc_circuit_consecutive_failures gauge`);
      lines.push(`rpc_circuit_consecutive_failures{${labels}} ${snapshot.consecutiveFailures}`);

      lines.push(`# HELP rpc_circuit_total_failures Total failures since last reset`);
      lines.push(`# TYPE rpc_circuit_total_failures counter`);
      lines.push(`rpc_circuit_total_failures{${labels}} ${snapshot.totalFailures}`);

      lines.push(`# HELP rpc_circuit_total_successes Total successes since last reset`);
      lines.push(`# TYPE rpc_circuit_total_successes counter`);
      lines.push(`rpc_circuit_total_successes{${labels}} ${snapshot.totalSuccesses}`);

      lines.push(`# HELP rpc_circuit_downtime_ms Cumulative downtime in ms`);
      lines.push(`# TYPE rpc_circuit_downtime_ms gauge`);
      lines.push(`rpc_circuit_downtime_ms{${labels}} ${snapshot.cumulativeDowntimeMs}`);

      // Per-endpoint call metrics
      const key = this.circuitKey(snapshot.chainId, snapshot.endpointUrl);
      const metric = this.callMetrics.get(key);
      if (metric) {
        lines.push(`# HELP rpc_call_total Total RPC calls`);
        lines.push(`# TYPE rpc_call_total counter`);
        lines.push(`rpc_call_total{${labels}} ${metric.totalCalls}`);

        lines.push(`# HELP rpc_call_successes Successful RPC calls`);
        lines.push(`# TYPE rpc_call_successes counter`);
        lines.push(`rpc_call_successes{${labels}} ${metric.successes}`);

        lines.push(`# HELP rpc_call_failures Failed RPC calls`);
        lines.push(`# TYPE rpc_call_failures counter`);
        lines.push(`rpc_call_failures{${labels}} ${metric.failures}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get total aggregated metrics across all chains.
   */
  getAggregatedMetrics(): RpcMonitorMetrics {
    return this.computeGlobalMetrics();
  }

  /**
   * Reset metrics for all circuits.
   */
  resetAllMetrics(): void {
    this.callMetrics.clear();
    this.degradedResponses = [];
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private metricKey(endpointUrl: string, chainId: number): string {
    return `${chainId}:${endpointUrl}`;
  }

  private circuitKey(chainId: number, endpointUrl: string): string {
    return `${chainId}:${endpointUrl}`;
  }

  private getOrCreateMetrics(key: string): {
    totalCalls: number;
    successes: number;
    failures: number;
    skipped: number;
    degraded: number;
    responseTimes: number[];
    lastError: string | null;
    lastErrorAt: number | null;
  } {
    if (!this.callMetrics.has(key)) {
      this.callMetrics.set(key, {
        totalCalls: 0,
        successes: 0,
        failures: 0,
        skipped: 0,
        degraded: 0,
        responseTimes: [],
        lastError: null,
        lastErrorAt: null,
      });
    }
    return this.callMetrics.get(key)!;
  }



  private groupCircuitsByChain(): Map<string, CircuitStateSnapshot[]> {
    const groups = new Map<string, CircuitStateSnapshot[]>();
    for (const snapshot of this.circuits.values()) {
      const key = String(snapshot.chainId);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(snapshot);
    }
    return groups;
  }

  private computeChainHealth(
    chainId: number,
    circuits: CircuitStateSnapshot[],
  ): ChainHealthSummary {
    const totalEndpoints = circuits.length;
    let openEndpoints = 0;
    let halfOpenEndpoints = 0;
    let closedEndpoints = 0;
    let degradedEndpoints = 0;

    for (const c of circuits) {
      if (c.state === 'OPEN') openEndpoints++;
      else if (c.state === 'HALF_OPEN') halfOpenEndpoints++;
      else if (c.state === 'CLOSED') closedEndpoints++;

      if (c.consecutiveFailures > 0) degradedEndpoints++;
    }

    const healthyEndpoints = closedEndpoints;

    let overallHealth: 'healthy' | 'degraded' | 'unhealthy';
    if (openEndpoints > 0 && closedEndpoints === 0) {
      overallHealth = 'unhealthy';
    } else if (openEndpoints > 0 || halfOpenEndpoints > 0 || degradedEndpoints > 0) {
      overallHealth = 'degraded';
    } else {
      overallHealth = 'healthy';
    }

    // Compute per-chain metrics
    const chainKey = String(chainId);
    let totalCalls = 0;
    let successes = 0;
    let failures = 0;
    let skipped = 0;
    let degraded = 0;
    const allResponseTimes: number[] = [];

    for (const [key, metrics] of this.callMetrics) {
      if (key.startsWith(chainKey + ':')) {
        totalCalls += metrics.totalCalls;
        successes += metrics.successes;
        failures += metrics.failures;
        skipped += metrics.skipped;
        degraded += metrics.degraded;
        allResponseTimes.push(...metrics.responseTimes);
      }
    }

    // Count degraded responses for this chain
    const chainDegradedCount = this.degradedResponses.filter(
      (d) => d.chainId === chainId,
    ).length;

    return {
      chainId,
      chainName: circuits[0]?.endpointLabel ?? `Chain ${chainId}`,
      totalEndpoints,
      healthyEndpoints,
      degradedEndpoints,
      openEndpoints,
      halfOpenEndpoints,
      closedEndpoints,
      overallHealth,
      metrics: this.computeMetrics(totalCalls, successes, failures, skipped, degraded + chainDegradedCount, allResponseTimes),
      circuits,
    };
  }

  private computeMetrics(
    totalCalls: number,
    successes: number,
    failures: number,
    skipped: number,
    degraded: number,
    responseTimes: number[],
  ): RpcMonitorMetrics {
    const sorted = [...responseTimes].sort((a, b) => a - b);
    const len = sorted.length;

    const avg = len > 0 ? sorted.reduce((a, b) => a + b, 0) / len : 0;
    const p50 = len > 0 ? sorted[Math.floor(len * 0.5)] : 0;
    const p95 = len > 0 ? sorted[Math.floor(len * 0.95)] : 0;
    const p99 = len > 0 ? sorted[Math.floor(len * 0.99)] : 0;

    return {
      totalCalls,
      successfulCalls: successes,
      failedCalls: failures,
      skippedCalls: skipped,
      degradedResponses: degraded,
      avgResponseTimeMs: Math.round(avg),
      p50ResponseTimeMs: p50,
      p95ResponseTimeMs: p95,
      p99ResponseTimeMs: p99,
    };
  }

  private computeGlobalMetrics(): RpcMonitorMetrics {
    let totalCalls = 0;
    let totalSuccesses = 0;
    let totalFailures = 0;
    let totalSkipped = 0;
    let totalDegraded = 0;
    const allResponseTimes: number[] = [];

    for (const metrics of this.callMetrics.values()) {
      totalCalls += metrics.totalCalls;
      totalSuccesses += metrics.successes;
      totalFailures += metrics.failures;
      totalSkipped += metrics.skipped;
      totalDegraded += metrics.degraded;
      allResponseTimes.push(...metrics.responseTimes);
    }

    totalDegraded += this.degradedResponses.length;

    return this.computeMetrics(
      totalCalls,
      totalSuccesses,
      totalFailures,
      totalSkipped,
      totalDegraded,
      allResponseTimes,
    );
  }
}

/** Singleton instance. */
export const rpcMonitorService = new RpcMonitorService();
