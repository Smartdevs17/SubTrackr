/**
 * Circuit Breaker — Issue #RPC-CB
 *
 * Implements the circuit breaker pattern for external blockchain RPC calls.
 *
 * States:
 *   CLOSED    — Normal operation; requests are passed through.
 *   OPEN      — Circuit is tripped; requests fail fast without calling the endpoint.
 *   HALF_OPEN — Probing; a limited number of test requests are allowed through.
 *
 * Transitions:
 *   CLOSED  → OPEN     : when consecutive failures reach failureThreshold
 *   OPEN    → HALF_OPEN : after recoveryTimeoutMs elapses
 *   HALF_OPEN → CLOSED : if a probe request succeeds
 *   HALF_OPEN → OPEN   : if a probe request fails
 */

import { EventEmitter } from 'events';
import {
  type CircuitBreakerConfig,
  type RpcEndpointConfig,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from './rpcConfig';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitStateSnapshot {
  endpointUrl: string;
  endpointLabel: string;
  chainId: number;
  state: CircuitState;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  lastStateChangeAt: number;
  openedAt: number | null;
  recoveryScheduledAt: number | null;
  halfOpenProbeCount: number;
  pendingProbeRequests: number;
  cumulativeDowntimeMs: number;
  /** Whether a manual reset was the cause of the current state. */
  manuallyReset: boolean;
}

export interface CircuitBreakerEvent {
  endpoint: string;
  chainId: number;
  previousState: CircuitState;
  newState: CircuitState;
  timestamp: number;
  reason: string;
  failuresAtTransition?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit Breaker Class
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CircuitBreakerConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG };

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastStateChangeAt: number = Date.now();
  private openedAt: number | null = null;
  private recoveryScheduledAt: number | null = null;
  private halfOpenProbeCount = 0;
  private pendingProbeRequests = 0;
  private cumulativeDowntimeMs = 0;
  private _manuallyReset = false;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly config: CircuitBreakerConfig;
  public readonly chainId: number;
  public readonly endpointUrl: string;
  public readonly endpointLabel: string;

  constructor(endpoint: Pick<RpcEndpointConfig, 'chainId' | 'url' | 'label' | 'circuitBreaker'>) {
    super();
    this.chainId = endpoint.chainId;
    this.endpointUrl = endpoint.url;
    this.endpointLabel = endpoint.label;
    this.config = { ...DEFAULT_CONFIG, ...endpoint.circuitBreaker };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Returns the current state of the circuit. */
  getState(): CircuitState {
    // Lazy transition: if OPEN and recovery timeout has elapsed, move to HALF_OPEN
    if (this.state === 'OPEN' && this.recoveryScheduledAt !== null) {
      const elapsed = Date.now() - this.recoveryScheduledAt;
      if (elapsed >= this.config.recoveryTimeoutMs) {
        this.transitionTo('HALF_OPEN', 'Recovery timeout elapsed');
      }
    }
    return this.state;
  }

  /**
   * Should be called BEFORE making an RPC call.
   * Returns true if the request is allowed to proceed.
   * Throws CircuitOpenError if the circuit is OPEN.
   */
  allowRequest(): boolean {
    const currentState = this.getState();

    if (currentState === 'CLOSED') {
      return true;
    }

    if (currentState === 'OPEN') {
      throw new CircuitOpenError(this.endpointUrl, this.chainId, currentState);
    }

    // HALF_OPEN: limit concurrent probe requests
    if (this.halfOpenProbeCount >= this.config.halfOpenMaxRequests) {
      return false;
    }

    this.halfOpenProbeCount++;
    this.pendingProbeRequests++;
    return true;
  }

  /**
   * Record a successful RPC call.
   * @param wasProbe Whether this was a half-open probe request.
   */
  recordSuccess(wasProbe = false): void {
    this.totalSuccesses++;
    this.lastSuccessAt = Date.now();
    this.consecutiveFailures = 0;

    if (wasProbe) {
      this.pendingProbeRequests--;
    }

    if (this.state === 'HALF_OPEN') {
      // Probe succeeded — close the circuit
      this.transitionTo('CLOSED', 'Half-open probe succeeded');
    } else if (this.state === 'CLOSED' && this.consecutiveFailures > 0) {
      // Reset consecutive failures on success
      this.consecutiveFailures = 0;
    }
  }

  /**
   * Record a failed RPC call.
   * @param wasProbe Whether this was a half-open probe request.
   */
  recordFailure(wasProbe = false): void {
    this.totalFailures++;
    this.lastFailureAt = Date.now();
    this.consecutiveFailures++;

    if (wasProbe) {
      this.pendingProbeRequests--;
    }

    if (this.state === 'HALF_OPEN') {
      // Probe failed — open the circuit again
      this.transitionTo('OPEN', 'Half-open probe failed');
    } else if (
      this.state === 'CLOSED' &&
      this.consecutiveFailures >= this.config.failureThreshold
    ) {
      // Threshold reached — open the circuit
      this.transitionTo('OPEN', `Failure threshold reached (${this.consecutiveFailures} consecutive)`);
    }
  }

  /**
   * Manually reset the circuit to CLOSED state.
   * Clears all failure counts and cancels any pending recovery timer.
   */
  manualReset(): void {
    this.cancelRecoveryTimer();
    this.consecutiveFailures = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.halfOpenProbeCount = 0;
    this.pendingProbeRequests = 0;
    this._manuallyReset = true;
    this.transitionTo('CLOSED', 'Manual reset by operator');
  }

  /**
   * Manually open the circuit (force trip).
   */
  manualOpen(): void {
    this.cancelRecoveryTimer();
    this._manuallyReset = true;
    this.transitionTo('OPEN', 'Manually opened by operator');
  }

  /** Returns a snapshot of the current circuit state. */
  snapshot(): CircuitStateSnapshot {
    const now = Date.now();
    // Compute current downtime duration without mutating the stored value.
    const currentDowntime = this.state === 'OPEN' && this.openedAt !== null
      ? this.cumulativeDowntimeMs + (now - this.openedAt)
      : this.cumulativeDowntimeMs;

    return {
      endpointUrl: this.endpointUrl,
      endpointLabel: this.endpointLabel,
      chainId: this.chainId,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      lastStateChangeAt: this.lastStateChangeAt,
      openedAt: this.openedAt,
      recoveryScheduledAt: this.recoveryScheduledAt,
      halfOpenProbeCount: this.halfOpenProbeCount,
      pendingProbeRequests: this.pendingProbeRequests,
      cumulativeDowntimeMs: currentDowntime,
      manuallyReset: this._manuallyReset,
    };
  }

  /** Resets metrics counters (keeps state). */
  resetMetrics(): void {
    this.consecutiveFailures = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.halfOpenProbeCount = 0;
    this.pendingProbeRequests = 0;
    this.cumulativeDowntimeMs = 0;
    this._manuallyReset = false;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private transitionTo(newState: CircuitState, reason: string): void {
    const previousState = this.state;
    this.state = newState;
    this.lastStateChangeAt = Date.now();

    if (newState === 'OPEN') {
      this.openedAt = Date.now();
      this.recoveryScheduledAt = Date.now();
      this.halfOpenProbeCount = 0;
      this.pendingProbeRequests = 0;

      if (this.config.autoReset) {
        this.scheduleRecovery();
      }
    } else if (newState === 'HALF_OPEN') {
      this.openedAt = null;
      this.recoveryScheduledAt = null;
      this.halfOpenProbeCount = 0;
      this.pendingProbeRequests = 0;
    } else if (newState === 'CLOSED') {
      // Accumulate downtime if transitioning from OPEN to CLOSED
      if (previousState === 'OPEN' && this.openedAt !== null) {
        this.cumulativeDowntimeMs += Date.now() - this.openedAt;
      }
      this.openedAt = null;
      this.recoveryScheduledAt = null;
      this.halfOpenProbeCount = 0;
      this.pendingProbeRequests = 0;
      this.consecutiveFailures = 0;
      this.cancelRecoveryTimer();
    }

    const event: CircuitBreakerEvent = {
      endpoint: this.endpointUrl,
      chainId: this.chainId,
      previousState,
      newState,
      timestamp: Date.now(),
      reason,
      failuresAtTransition: this.consecutiveFailures,
    };

    this.emit('stateChange', event);
  }

  private scheduleRecovery(): void {
    this.cancelRecoveryTimer();
    this.recoveryTimer = setTimeout(() => {
      if (this.state === 'OPEN') {
        this.transitionTo('HALF_OPEN', 'Recovery timer fired');
      }
    }, this.config.recoveryTimeoutMs);
  }

  private cancelRecoveryTimer(): void {
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  readonly endpointUrl: string;
  readonly chainId: number;
  readonly circuitState: CircuitState;
  readonly code = 'RPC_CIRCUIT_OPEN';

  constructor(endpointUrl: string, chainId: number, circuitState: CircuitState) {
    super(
      `Circuit breaker is ${circuitState} for RPC endpoint ${endpointUrl} (chain ${chainId}). ` +
      'Request blocked to prevent cascading failure.',
    );
    this.name = 'CircuitOpenError';
    this.endpointUrl = endpointUrl;
    this.chainId = chainId;
    this.circuitState = circuitState;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RpcTimeoutError extends Error {
  readonly endpointUrl: string;
  readonly chainId: number;
  readonly timeoutMs: number;
  readonly code = 'RPC_TIMEOUT';

  constructor(endpointUrl: string, chainId: number, timeoutMs: number) {
    super(
      `RPC call to ${endpointUrl} (chain ${chainId}) timed out after ${timeoutMs}ms.`,
    );
    this.name = 'RpcTimeoutError';
    this.endpointUrl = endpointUrl;
    this.chainId = chainId;
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AllProvidersFailedError extends Error {
  readonly chainId: number;
  readonly attemptedEndpoints: string[];
  readonly code = 'RPC_ALL_PROVIDERS_FAILED';

  constructor(chainId: number, attemptedEndpoints: string[]) {
    super(
      `All RPC providers failed for chain ${chainId}. Attempted endpoints: ${attemptedEndpoints.join(', ')}`,
    );
    this.name = 'AllProvidersFailedError';
    this.chainId = chainId;
    this.attemptedEndpoints = attemptedEndpoints;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
