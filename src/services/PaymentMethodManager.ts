/**
 * PaymentMethodManager
 *
 * A higher-level orchestrator that wraps PaymentMethodService with:
 *   - Per-method circuit breaker (open after N consecutive failures)
 *   - Health score tracking (0-100) based on recent attempt history
 *   - Automatic failover routing that prefers historically reliable methods
 *   - Rate limiting per method (max charges per rolling window)
 *   - Global and per-method metrics snapshots
 *
 * Usage:
 *   const manager = PaymentMethodManager.getInstance();
 *   const result = await manager.charge(methods, attempts, subscriptionId, amount, chainId);
 */

import {
  PaymentMethod,
  PaymentAttempt,
  FallbackChain,
  PaymentPriority,
} from '../types/wallet';
import {
  PaymentMethodService,
  PaymentMethodError,
  PaymentMethodErrorCode,
  ChainPaymentResult,
} from './paymentMethodService';

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerState {
  methodId: string;
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  openedAt: number | null;
  /** When half-open, how many test requests have been allowed through */
  halfOpenAttempts: number;
}

const CIRCUIT_OPEN_THRESHOLD = 3;       // consecutive failures before opening
const CIRCUIT_RESET_MS = 60_000;        // 1 min before switching to half-open
const HALF_OPEN_MAX_ATTEMPTS = 1;       // probes allowed while half-open

// ---------------------------------------------------------------------------
// Health scoring
// ---------------------------------------------------------------------------

export interface MethodHealthScore {
  methodId: string;
  score: number;          // 0-100; higher is better
  successRate: number;    // 0-1
  recentAttempts: number;
  averageLatencyMs: number;
  lastUpdated: number;
}

/** Window of recent attempts considered for health scoring */
const HEALTH_WINDOW_MS = 10 * 60 * 1000;   // last 10 minutes
const MAX_SCORE = 100;

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  maxAttemptsPerWindow: number;
  windowMs: number;
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxAttemptsPerWindow: 10,
  windowMs: 60_000,
};

// ---------------------------------------------------------------------------
// Manager result types
// ---------------------------------------------------------------------------

export interface ManagedChargeResult extends ChainPaymentResult {
  /** Health-ordered sequence of methods that were tried */
  triedMethodIds: string[];
  /** Methods skipped because their circuit was open */
  skippedDueToCircuit: string[];
  /** Methods skipped because they hit the rate limit */
  skippedDueToRateLimit: string[];
  /** Health scores at the time of the charge */
  healthScores: Record<string, number>;
}

export interface ManagerSnapshot {
  circuits: CircuitBreakerState[];
  healthScores: MethodHealthScore[];
  rateLimitStates: Record<string, { used: number; windowEndsAt: number }>;
}

// ---------------------------------------------------------------------------
// PaymentMethodManager
// ---------------------------------------------------------------------------

export class PaymentMethodManager {
  private static _instance: PaymentMethodManager;

  private readonly _service: PaymentMethodService;
  private readonly _circuits = new Map<string, CircuitBreakerState>();
  private readonly _healthScores = new Map<string, MethodHealthScore>();
  private readonly _rateLimitWindows = new Map<string, number[]>(); // methodId → timestamps
  private readonly _rateLimitConfig: RateLimitConfig;

  constructor(
    service?: PaymentMethodService,
    rateLimitConfig: RateLimitConfig = DEFAULT_RATE_LIMIT
  ) {
    this._service = service ?? PaymentMethodService.getInstance();
    this._rateLimitConfig = rateLimitConfig;
  }

  static getInstance(service?: PaymentMethodService): PaymentMethodManager {
    if (!PaymentMethodManager._instance) {
      PaymentMethodManager._instance = new PaymentMethodManager(service);
    }
    return PaymentMethodManager._instance;
  }

  /** Reset the singleton (useful in tests). */
  static resetInstance(): void {
    PaymentMethodManager._instance = undefined as unknown as PaymentMethodManager;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Charge a subscription through the best available payment method.
   *
   * The method order is determined by health score (desc), then PaymentPriority,
   * then last-used recency. Methods whose circuits are open or that have hit
   * their rate limit are skipped.
   */
  async charge(
    methods: PaymentMethod[],
    attempts: PaymentAttempt[],
    subscriptionId: string,
    amount: string,
    chainId: number,
    maxGasPriceGwei = 500
  ): Promise<ManagedChargeResult> {
    // Refresh health scores from existing attempt history
    this._updateHealthScores(methods, attempts);

    const skippedCircuit: string[] = [];
    const skippedRate: string[] = [];

    // Sort active+verified methods by health score (best first)
    const candidates = this._service
      .getActiveVerifiedMethods(methods)
      .sort((a, b) => this._rankMethod(b) - this._rankMethod(a));

    // Filter out circuit-open and rate-limited methods
    const eligible = candidates.filter((m) => {
      if (!this._canAttempt(m.id)) {
        const circuit = this._getCircuit(m.id);
        if (circuit.state === 'open') {
          skippedCircuit.push(m.id);
        } else {
          skippedRate.push(m.id);
        }
        return false;
      }
      return true;
    });

    if (eligible.length === 0) {
      throw new PaymentMethodError(
        PaymentMethodErrorCode.FALLBACK_FAILED,
        'All payment methods are currently unavailable (circuit open or rate limited).',
        'Wait a moment and try again, or add a new payment method.'
      );
    }

    // Build a synthetic chain from the eligible methods
    const syntheticChain: FallbackChain = {
      id: `managed_${Date.now()}`,
      name: 'Managed charge',
      methodIds: eligible.map((m) => m.id),
      subscriptionId,
      maxAttempts: 0,
      stopOnHardDecline: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this._service.processPaymentWithChain(
      syntheticChain,
      eligible,
      subscriptionId,
      amount,
      chainId,
      maxGasPriceGwei
    );

    // Record timestamps for rate limiting and update circuit states
    const now = Date.now();
    for (const attempt of [...result.fallbackAttempts, ...(result.attempt ? [result.attempt] : [])]) {
      this._recordRateLimitTimestamp(attempt.paymentMethodId, now);
      if (attempt.status === 'failed') {
        this._recordFailure(attempt.paymentMethodId);
      } else if (attempt.status === 'success') {
        this._recordSuccess(attempt.paymentMethodId);
      }
    }

    const healthScores: Record<string, number> = {};
    for (const m of methods) {
      healthScores[m.id] = this._healthScores.get(m.id)?.score ?? MAX_SCORE;
    }

    return {
      ...result,
      triedMethodIds: eligible.map((m) => m.id),
      skippedDueToCircuit: skippedCircuit,
      skippedDueToRateLimit: skippedRate,
      healthScores,
    };
  }

  /**
   * Returns the health score for a single method (0-100).
   * A method with no history returns 100 (assumed healthy).
   */
  getHealthScore(methodId: string): number {
    return this._healthScores.get(methodId)?.score ?? MAX_SCORE;
  }

  /** Returns the circuit state for a method. */
  getCircuitState(methodId: string): CircuitState {
    return this._getCircuit(methodId).state;
  }

  /** Manually reset a method's circuit to closed. */
  resetCircuit(methodId: string): void {
    this._circuits.set(methodId, this._freshCircuit(methodId));
  }

  /** Manually force a method's circuit open (e.g. after manual intervention). */
  tripCircuit(methodId: string): void {
    const circuit = this._getCircuit(methodId);
    circuit.state = 'open';
    circuit.openedAt = Date.now();
    this._circuits.set(methodId, circuit);
  }

  /** Check whether a method is currently blocked (circuit open or rate limited). */
  isBlocked(methodId: string): boolean {
    return !this._canAttempt(methodId);
  }

  /** Returns a full manager snapshot (for debugging / monitoring dashboards). */
  getSnapshot(): ManagerSnapshot {
    const now = Date.now();
    const rateLimitStates: Record<string, { used: number; windowEndsAt: number }> = {};
    for (const [id, timestamps] of this._rateLimitWindows) {
      const windowStart = now - this._rateLimitConfig.windowMs;
      const recent = timestamps.filter((t) => t > windowStart);
      rateLimitStates[id] = {
        used: recent.length,
        windowEndsAt: recent.length > 0 ? (recent[0] + this._rateLimitConfig.windowMs) : now,
      };
    }

    return {
      circuits: [...this._circuits.values()],
      healthScores: [...this._healthScores.values()],
      rateLimitStates,
    };
  }

  /**
   * Refresh all health scores from an external attempts array.
   * Call this after loading persisted state.
   */
  refreshHealthScores(methods: PaymentMethod[], attempts: PaymentAttempt[]): void {
    this._updateHealthScores(methods, attempts);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _getCircuit(methodId: string): CircuitBreakerState {
    if (!this._circuits.has(methodId)) {
      this._circuits.set(methodId, this._freshCircuit(methodId));
    }
    return this._circuits.get(methodId)!;
  }

  private _freshCircuit(methodId: string): CircuitBreakerState {
    return {
      methodId,
      state: 'closed',
      consecutiveFailures: 0,
      lastFailureAt: null,
      openedAt: null,
      halfOpenAttempts: 0,
    };
  }

  private _canAttempt(methodId: string): boolean {
    const circuit = this._getCircuit(methodId);
    const now = Date.now();

    // Check circuit
    if (circuit.state === 'open') {
      if (circuit.openedAt !== null && now - circuit.openedAt >= CIRCUIT_RESET_MS) {
        // Transition to half-open for a probe
        circuit.state = 'half-open';
        circuit.halfOpenAttempts = 0;
        this._circuits.set(methodId, circuit);
      } else {
        return false;
      }
    }
    if (circuit.state === 'half-open' && circuit.halfOpenAttempts >= HALF_OPEN_MAX_ATTEMPTS) {
      return false;
    }
    if (circuit.state === 'half-open') {
      circuit.halfOpenAttempts += 1;
      this._circuits.set(methodId, circuit);
    }

    // Check rate limit
    const timestamps = this._rateLimitWindows.get(methodId) ?? [];
    const windowStart = now - this._rateLimitConfig.windowMs;
    const recent = timestamps.filter((t) => t > windowStart);
    if (recent.length >= this._rateLimitConfig.maxAttemptsPerWindow) {
      return false;
    }

    return true;
  }

  private _recordFailure(methodId: string): void {
    const circuit = this._getCircuit(methodId);
    circuit.consecutiveFailures += 1;
    circuit.lastFailureAt = Date.now();

    if (circuit.state === 'half-open') {
      // Failed probe — reopen
      circuit.state = 'open';
      circuit.openedAt = Date.now();
    } else if (circuit.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD) {
      circuit.state = 'open';
      circuit.openedAt = Date.now();
    }
    this._circuits.set(methodId, circuit);
  }

  private _recordSuccess(methodId: string): void {
    const circuit = this._getCircuit(methodId);
    circuit.consecutiveFailures = 0;
    if (circuit.state === 'half-open') {
      // Successful probe — close circuit
      circuit.state = 'closed';
      circuit.openedAt = null;
      circuit.halfOpenAttempts = 0;
    }
    this._circuits.set(methodId, circuit);
  }

  private _recordRateLimitTimestamp(methodId: string, now: number): void {
    const timestamps = this._rateLimitWindows.get(methodId) ?? [];
    // Prune old entries
    const windowStart = now - this._rateLimitConfig.windowMs;
    const pruned = timestamps.filter((t) => t > windowStart);
    pruned.push(now);
    this._rateLimitWindows.set(methodId, pruned);
  }

  private _updateHealthScores(methods: PaymentMethod[], attempts: PaymentAttempt[]): void {
    const now = Date.now();
    const windowStart = now - HEALTH_WINDOW_MS;

    const recentAttempts = attempts.filter((a) => a.attemptedAt.getTime() > windowStart);

    for (const method of methods) {
      const methodAttempts = recentAttempts.filter((a) => a.paymentMethodId === method.id);
      const successes = methodAttempts.filter((a) => a.status === 'success').length;
      const total = methodAttempts.length;
      const successRate = total === 0 ? 1 : successes / total;

      // Penalise open circuits heavily
      const circuitPenalty = this._getCircuit(method.id).state === 'open' ? 50 : 0;

      // Score: 60% success rate + 40% priority weighting - circuit penalty
      const priorityBonus =
        method.priority === PaymentPriority.PRIMARY ? 20
          : method.priority === PaymentPriority.BACKUP ? 10
            : 0;

      const raw = Math.round(successRate * 60 + priorityBonus - circuitPenalty);
      const score = Math.max(0, Math.min(MAX_SCORE, raw));

      this._healthScores.set(method.id, {
        methodId: method.id,
        score,
        successRate,
        recentAttempts: total,
        averageLatencyMs: 0, // latency not tracked at this layer
        lastUpdated: now,
      });
    }
  }

  private _rankMethod(method: PaymentMethod): number {
    return this._healthScores.get(method.id)?.score ?? MAX_SCORE;
  }
}
