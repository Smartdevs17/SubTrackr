/**
 * Circuit breaker for the SubTrackr client SDK.
 *
 * Issue #2216: Robust client SDK with circuit breaker and backoff retry.
 *
 * When the API is consistently failing, the circuit breaker stops sending
 * requests entirely — failing fast instead of waiting for each one to time out
 * or retry. This prevents cascading failures and gives the downstream service
 * time to recover.
 *
 * ## States
 *
 *  CLOSED  --(N consecutive failures)-->  OPEN
 *     ^                                      |
 *     |                                      | wait recoveryTimeoutMs
 *     |                                      v
 *     +--(M successes in half-open)--  HALF-OPEN
 *                                      |
 *                                      +--(any failure)--> OPEN
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before tripping to OPEN. Default: 5 */
  failureThreshold?: number;
  /** Time (ms) to wait in OPEN before moving to HALF-OPEN. Default: 30000 */
  recoveryTimeoutMs?: number;
  /** Number of successful calls in HALF-OPEN before moving to CLOSED. Default: 2 */
  successThreshold?: number;
  /** A name or identifier for this circuit breaker. */
  name?: string;
}

/** Thrown when the circuit is OPEN and a request is rejected. */
export class CircuitOpenError extends Error {
  readonly circuitName: string;
  readonly openUntil: number;

  constructor(name: string, openUntil: number) {
    super(
      `Circuit breaker "${name}" is OPEN. Recovery attempt allowed at ${new Date(openUntil).toISOString()}`,
    );
    this.name = 'CircuitOpenError';
    this.circuitName = name;
    this.openUntil = openUntil;
  }
}

export class CircuitBreaker {
  state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private openUntil: number | null = null;

  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly successThreshold: number;
  readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 30_000;
    this.successThreshold = options.successThreshold ?? 2;
    this.name = options.name ?? 'default';
  }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    this.checkState();

    if (this.state === 'open') {
      throw new CircuitOpenError(this.name, this.openUntil!);
    }

    try {
      const result = await action();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  isOpen(): boolean {
    this.checkState();
    return this.state === 'open';
  }

  isClosed(): boolean {
    this.checkState();
    return this.state === 'closed';
  }

  isHalfOpen(): boolean {
    this.checkState();
    return this.state === 'half-open';
  }

  reset(): void {
    this.transitionTo('closed');
  }

  private checkState(): void {
    if (this.state === 'open' && this.openUntil !== null && Date.now() >= this.openUntil) {
      this.transitionTo('half-open');
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state === 'half-open') {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.transitionTo('closed');
      }
    }
  }

  private recordFailure(): void {
    this.consecutiveSuccesses = 0;
    if (this.state === 'half-open') {
      this.transitionTo('open');
      return;
    }
    this.consecutiveFailures += 1;
    if (this.state === 'closed' && this.consecutiveFailures >= this.failureThreshold) {
      this.transitionTo('open');
    }
  }

  private transitionTo(newState: CircuitState): void {
    this.state = newState;
    if (newState === 'open') {
      this.openUntil = Date.now() + this.recoveryTimeoutMs;
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
    } else if (newState === 'half-open') {
      this.consecutiveSuccesses = 0;
      this.openUntil = null;
    } else if (newState === 'closed') {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      this.openUntil = null;
    }
  }
}
