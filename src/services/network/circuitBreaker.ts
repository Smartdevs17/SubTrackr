import { mobileTracer, MobileTracer } from './trace';

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
  /** Optional tracer for telemetry */
  tracer?: MobileTracer;
}

export class CircuitOpenError extends Error {
  constructor(public readonly name: string, public readonly openUntil: number) {
    super(`Circuit breaker "${name}" is OPEN. Recovery attempt allowed at ${new Date(openUntil).toISOString()}`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  public state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private openUntil: number | null = null;
  
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly successThreshold: number;
  public readonly name: string;
  private readonly tracer: MobileTracer;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 30_000;
    this.successThreshold = options.successThreshold ?? 2;
    this.name = options.name ?? 'default';
    this.tracer = options.tracer ?? mobileTracer;
  }

  /**
   * Wraps an async action with the circuit breaker logic.
   */
  async execute<T>(action: () => Promise<T>): Promise<T> {
    this.checkState();

    if (this.state === 'open') {
      const error = new CircuitOpenError(this.name, this.openUntil!);
      
      // Optionally trace the fast-failure
      const span = this.tracer.startClientSpan(`CircuitBreaker ${this.name} fast-fail`, {
        'circuit.state': 'open',
      });
      this.tracer.endSpan(span, 'error', { 'error.message': error.message });
      
      throw error;
    }

    try {
      const result = await action();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
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

  private recordFailure(error: unknown): void {
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
    const previous = this.state;
    this.state = newState;
    
    if (newState === 'open') {
      this.openUntil = Date.now() + this.recoveryTimeoutMs;
      this.consecutiveFailures = 0;
    } else if (newState === 'half-open') {
      this.consecutiveSuccesses = 0;
      this.openUntil = null;
    } else if (newState === 'closed') {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      this.openUntil = null;
    }

    const span = this.tracer.startClientSpan(`CircuitBreaker ${this.name} state change`, {
      'circuit.previous_state': previous,
      'circuit.new_state': newState,
    });
    this.tracer.endSpan(span, 'ok');
  }

  // Allow manual resets
  public reset(): void {
    this.transitionTo('closed');
  }
}
