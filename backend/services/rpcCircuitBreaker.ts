/**
 * RPC Circuit Breaker Service
 *
 * Implements the circuit-breaker pattern for external RPC calls with:
 *   - Configurable per-endpoint timeout
 *   - Circuit breaker (failure threshold → open → half-open → closed)
 *   - RPC provider fallback on failure
 *   - Circuit state monitoring (for dashboard)
 *   - Graceful degradation when circuit is open
 *   - Manual circuit reset
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

/** Configuration for a single RPC endpoint / provider. */
export interface RpcProviderConfig {
  /** Unique identifier for this provider (e.g. "alchemy-mainnet"). */
  id: string;
  /** Human-readable label shown in monitoring output. */
  label: string;
  /** Base URL or identifier used to make calls. Passed through to your fetch fn. */
  url: string;
  /**
   * Request timeout in milliseconds for this endpoint.
   * Defaults to RpcCircuitBreakerOptions.defaultTimeoutMs if omitted.
   */
  timeoutMs?: number;
  /** Lower priority = tried first when selecting a provider. Default 0. */
  priority?: number;
}

/** Options for the circuit breaker behaviour. */
export interface RpcCircuitBreakerOptions {
  /**
   * Number of consecutive failures that trip a circuit to OPEN.
   * Default: 5
   */
  failureThreshold?: number;
  /**
   * How long (ms) the circuit stays OPEN before moving to HALF-OPEN.
   * Default: 30_000 (30 s)
   */
  recoveryTimeoutMs?: number;
  /**
   * Number of consecutive successes in HALF-OPEN state needed to close the circuit.
   * Default: 2
   */
  successThreshold?: number;
  /**
   * Default timeout (ms) applied to providers that don't set their own.
   * Default: 5_000 (5 s)
   */
  defaultTimeoutMs?: number;
  /**
   * Maximum number of events kept in the audit log.
   * Default: 500
   */
  maxAuditEvents?: number;
}

/** Per-provider runtime state tracked by the service. */
export interface CircuitStatus {
  providerId: string;
  label: string;
  url: string;
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalCalls: number;
  totalFailures: number;
  totalTimeouts: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  /** Timestamp after which the circuit may move to HALF-OPEN (only when state === 'open'). */
  openUntil: number | null;
  /** Calculated success rate over all calls, 0–1. */
  successRate: number;
  /** Average latency in ms over completed calls. */
  avgLatencyMs: number;
}

/** Structured event written to the audit log on state transitions and errors. */
export interface CircuitAuditEvent {
  timestamp: number;
  providerId: string;
  type:
    | 'call_success'
    | 'call_failure'
    | 'call_timeout'
    | 'state_change'
    | 'fallback_used'
    | 'manual_reset'
    | 'all_open';
  previousState?: CircuitState;
  newState?: CircuitState;
  latencyMs?: number;
  error?: string;
  detail?: string;
}

/** Summary used by the monitoring dashboard. */
export interface RpcDashboardSnapshot {
  totalProviders: number;
  closedCount: number;
  openCount: number;
  halfOpenCount: number;
  totalCallsAllTime: number;
  overallSuccessRate: number;
  providers: CircuitStatus[];
  recentEvents: CircuitAuditEvent[];
}

/** The function signature callers provide to actually make RPC requests. */
export type RpcCallFn<T> = (providerUrl: string, signal: AbortSignal) => Promise<T>;

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class RpcTimeoutError extends Error {
  constructor(public readonly providerId: string, public readonly timeoutMs: number) {
    super(`RPC call to provider "${providerId}" timed out after ${timeoutMs} ms`);
    this.name = 'RpcTimeoutError';
  }
}

export class RpcCircuitOpenError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly openUntil: number,
  ) {
    super(
      `Circuit for provider "${providerId}" is OPEN. ` +
        `Will attempt recovery at ${new Date(openUntil).toISOString()}`,
    );
    this.name = 'RpcCircuitOpenError';
  }
}

export class RpcAllProvidersFailedError extends Error {
  constructor(public readonly errors: Array<{ providerId: string; error: Error }>) {
    super(
      `All RPC providers failed or have open circuits. Errors: ` +
        errors.map((e) => `[${e.providerId}] ${e.error.message}`).join(' | '),
    );
    this.name = 'RpcAllProvidersFailedError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal per-provider tracker
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderTracker {
  config: RpcProviderConfig;
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalCalls: number;
  totalFailures: number;
  totalTimeouts: number;
  totalLatencyMs: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  openUntil: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RpcCircuitBreakerService
// ─────────────────────────────────────────────────────────────────────────────

export class RpcCircuitBreakerService {
  private readonly providers: Map<string, ProviderTracker> = new Map();
  private readonly auditLog: CircuitAuditEvent[] = [];

  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly successThreshold: number;
  private readonly defaultTimeoutMs: number;
  private readonly maxAuditEvents: number;

  constructor(
    providers: RpcProviderConfig[],
    options: RpcCircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 30_000;
    this.successThreshold = options.successThreshold ?? 2;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;
    this.maxAuditEvents = options.maxAuditEvents ?? 500;

    // Register providers sorted by priority ascending (lower = higher preference).
    const sorted = [...providers].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    for (const cfg of sorted) {
      this.providers.set(cfg.id, {
        config: cfg,
        state: 'closed',
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        totalCalls: 0,
        totalFailures: 0,
        totalTimeouts: 0,
        totalLatencyMs: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        openUntil: null,
      });
    }
  }

  // ── Public call interface ─────────────────────────────────────────────────

  /**
   * Execute `fn` against the first available (non-open) provider.
   * Automatically falls back through the provider list on failure.
   * Throws `RpcAllProvidersFailedError` if every provider fails.
   */
  async call<T>(fn: RpcCallFn<T>): Promise<T> {
    const errors: Array<{ providerId: string; error: Error }> = [];

    for (const tracker of this.providers.values()) {
      // Transition OPEN → HALF-OPEN if the recovery window has elapsed.
      this.maybeTransitionToHalfOpen(tracker);

      if (tracker.state === 'open') {
        const err = new RpcCircuitOpenError(tracker.config.id, tracker.openUntil!);
        errors.push({ providerId: tracker.config.id, error: err });
        this.writeAudit({ type: 'fallback_used', providerId: tracker.config.id, detail: 'skipped — circuit open' });
        continue;
      }

      const timeoutMs = tracker.config.timeoutMs ?? this.defaultTimeoutMs;
      const start = Date.now();

      try {
        const result = await this.callWithTimeout(fn, tracker.config.url, timeoutMs, tracker.config.id);
        const latencyMs = Date.now() - start;

        this.recordSuccess(tracker, latencyMs);
        return result;
      } catch (err) {
        const latencyMs = Date.now() - start;
        const error = err instanceof Error ? err : new Error(String(err));
        const isTimeout = error instanceof RpcTimeoutError;

        this.recordFailure(tracker, error, latencyMs, isTimeout);

        errors.push({ providerId: tracker.config.id, error });

        // Log fallback if there are more providers to try.
        const providerIds = Array.from(this.providers.keys());
        const currentIndex = providerIds.indexOf(tracker.config.id);
        if (currentIndex < providerIds.length - 1) {
          this.writeAudit({
            type: 'fallback_used',
            providerId: tracker.config.id,
            detail: `falling back after: ${error.message}`,
          });
        }
      }
    }

    // All providers exhausted.
    this.writeAudit({ type: 'all_open', providerId: '__all__', detail: 'all providers failed or open' });
    throw new RpcAllProvidersFailedError(errors);
  }

  // ── Manual circuit reset ──────────────────────────────────────────────────

  /**
   * Manually reset a circuit to CLOSED state.
   * Useful for operator intervention after investigating a failure.
   */
  resetCircuit(providerId: string): void {
    const tracker = this.getTracker(providerId);
    const previous = tracker.state;
    tracker.state = 'closed';
    tracker.consecutiveFailures = 0;
    tracker.consecutiveSuccesses = 0;
    tracker.openUntil = null;

    this.writeAudit({
      type: 'manual_reset',
      providerId,
      previousState: previous,
      newState: 'closed',
      detail: 'operator-initiated reset',
    });
  }

  /** Reset all circuits simultaneously. */
  resetAllCircuits(): void {
    for (const id of this.providers.keys()) {
      this.resetCircuit(id);
    }
  }

  // ── Provider management ───────────────────────────────────────────────────

  /** Register a new provider at runtime. */
  addProvider(config: RpcProviderConfig): void {
    if (this.providers.has(config.id)) return;
    this.providers.set(config.id, {
      config,
      state: 'closed',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      totalCalls: 0,
      totalFailures: 0,
      totalTimeouts: 0,
      totalLatencyMs: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      openUntil: null,
    });
  }

  /** Remove a provider by id. */
  removeProvider(providerId: string): void {
    this.providers.delete(providerId);
  }

  // ── Monitoring ────────────────────────────────────────────────────────────

  /** Get a snapshot of all provider circuit states. */
  getDashboard(): RpcDashboardSnapshot {
    const statuses = this.getCircuitStatuses();
    const totalCalls = statuses.reduce((s, p) => s + p.totalCalls, 0);
    const totalSuccesses = statuses.reduce(
      (s, p) => s + (p.totalCalls - p.totalFailures),
      0,
    );

    return {
      totalProviders: statuses.length,
      closedCount: statuses.filter((p) => p.state === 'closed').length,
      openCount: statuses.filter((p) => p.state === 'open').length,
      halfOpenCount: statuses.filter((p) => p.state === 'half-open').length,
      totalCallsAllTime: totalCalls,
      overallSuccessRate: totalCalls === 0 ? 1 : totalSuccesses / totalCalls,
      providers: statuses,
      recentEvents: this.auditLog.slice(-50),
    };
  }

  /** Get the current status of a single provider. */
  getCircuitStatus(providerId: string): CircuitStatus {
    const tracker = this.getTracker(providerId);
    return this.trackerToStatus(tracker);
  }

  /** Get statuses of all providers. */
  getCircuitStatuses(): CircuitStatus[] {
    return Array.from(this.providers.values()).map((t) => this.trackerToStatus(t));
  }

  /** Get the full audit log. */
  getAuditLog(): CircuitAuditEvent[] {
    return [...this.auditLog];
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async callWithTimeout<T>(
    fn: RpcCallFn<T>,
    url: string,
    timeoutMs: number,
    providerId: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await fn(url, controller.signal);
      return result;
    } catch (err) {
      if (controller.signal.aborted) {
        throw new RpcTimeoutError(providerId, timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private recordSuccess(tracker: ProviderTracker, latencyMs: number): void {
    tracker.totalCalls += 1;
    tracker.totalLatencyMs += latencyMs;
    tracker.lastSuccessAt = Date.now();
    tracker.consecutiveFailures = 0;

    this.writeAudit({ type: 'call_success', providerId: tracker.config.id, latencyMs });

    if (tracker.state === 'half-open') {
      tracker.consecutiveSuccesses += 1;
      if (tracker.consecutiveSuccesses >= this.successThreshold) {
        this.transitionState(tracker, 'closed');
        tracker.openUntil = null;
      }
    }
  }

  private recordFailure(
    tracker: ProviderTracker,
    error: Error,
    latencyMs: number,
    isTimeout: boolean,
  ): void {
    tracker.totalCalls += 1;
    tracker.totalLatencyMs += latencyMs;
    tracker.totalFailures += 1;
    tracker.lastFailureAt = Date.now();
    tracker.consecutiveSuccesses = 0;

    if (isTimeout) {
      tracker.totalTimeouts += 1;
      this.writeAudit({ type: 'call_timeout', providerId: tracker.config.id, latencyMs, error: error.message });
    } else {
      this.writeAudit({ type: 'call_failure', providerId: tracker.config.id, latencyMs, error: error.message });
    }

    if (tracker.state === 'half-open') {
      // Any failure in HALF-OPEN immediately re-opens the circuit.
      this.transitionState(tracker, 'open');
      tracker.openUntil = Date.now() + this.recoveryTimeoutMs;
      tracker.consecutiveFailures = 0;
      return;
    }

    tracker.consecutiveFailures += 1;
    if (
      tracker.state === 'closed' &&
      tracker.consecutiveFailures >= this.failureThreshold
    ) {
      this.transitionState(tracker, 'open');
      tracker.openUntil = Date.now() + this.recoveryTimeoutMs;
    }
  }

  private maybeTransitionToHalfOpen(tracker: ProviderTracker): void {
    if (
      tracker.state === 'open' &&
      tracker.openUntil !== null &&
      Date.now() >= tracker.openUntil
    ) {
      this.transitionState(tracker, 'half-open');
      tracker.consecutiveSuccesses = 0;
    }
  }

  private transitionState(tracker: ProviderTracker, next: CircuitState): void {
    const previous = tracker.state;
    tracker.state = next;
    this.writeAudit({
      type: 'state_change',
      providerId: tracker.config.id,
      previousState: previous,
      newState: next,
      detail: `${previous} → ${next}`,
    });
  }

  private trackerToStatus(tracker: ProviderTracker): CircuitStatus {
    const successfulCalls = tracker.totalCalls - tracker.totalFailures;
    return {
      providerId: tracker.config.id,
      label: tracker.config.label,
      url: tracker.config.url,
      state: tracker.state,
      consecutiveFailures: tracker.consecutiveFailures,
      consecutiveSuccesses: tracker.consecutiveSuccesses,
      totalCalls: tracker.totalCalls,
      totalFailures: tracker.totalFailures,
      totalTimeouts: tracker.totalTimeouts,
      lastFailureAt: tracker.lastFailureAt,
      lastSuccessAt: tracker.lastSuccessAt,
      openUntil: tracker.openUntil,
      successRate: tracker.totalCalls === 0 ? 1 : successfulCalls / tracker.totalCalls,
      avgLatencyMs:
        tracker.totalCalls === 0 ? 0 : Math.round(tracker.totalLatencyMs / tracker.totalCalls),
    };
  }

  private getTracker(providerId: string): ProviderTracker {
    const tracker = this.providers.get(providerId);
    if (!tracker) {
      throw new Error(`RpcCircuitBreakerService: unknown provider "${providerId}"`);
    }
    return tracker;
  }

  private writeAudit(
    event: Omit<CircuitAuditEvent, 'timestamp'>,
  ): void {
    this.auditLog.push({ ...event, timestamp: Date.now() });
    if (this.auditLog.length > this.maxAuditEvents) {
      this.auditLog.splice(0, this.auditLog.length - this.maxAuditEvents);
    }
  }
}
