import {
  CircuitBreaker,
  CircuitBreakerOptions,
  CircuitOpenError,
  type CircuitState,
} from './circuitBreaker';

export type ProviderFallback<T> = (error: Error) => Promise<T> | T;

export interface ProviderCircuitBreakerRegistryOptions {
  /** Default options applied to all lazily-created provider breakers. */
  defaultOptions?: CircuitBreakerOptions;
}

/**
 * Manages isolated circuit breakers per external provider (e.g. Stripe, Paddle, QuickBooks)
 * with graceful fallback execution to prevent cascading outages across downstream services.
 */
export class ProviderCircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly fallbacks = new Map<string, ProviderFallback<unknown>>();
  private readonly defaultOptions: CircuitBreakerOptions;

  constructor(options: ProviderCircuitBreakerRegistryOptions = {}) {
    this.defaultOptions = options.defaultOptions ?? {
      failureThreshold: 5,
      recoveryTimeoutMs: 30_000,
      successThreshold: 2,
    };
  }

  private normalizeKey(provider: string): string {
    return provider.trim().toLowerCase();
  }

  /**
   * Retrieves or lazily creates a dedicated CircuitBreaker instance for the named provider.
   */
  getBreaker(provider: string, options?: CircuitBreakerOptions): CircuitBreaker {
    const key = this.normalizeKey(provider);
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new CircuitBreaker({
        name: key,
        ...this.defaultOptions,
        ...options,
      });
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  /**
   * Registers a default fallback handler for a specific provider.
   */
  registerFallback<T>(provider: string, fallback: ProviderFallback<T>): void {
    const key = this.normalizeKey(provider);
    this.fallbacks.set(key, fallback as ProviderFallback<unknown>);
  }

  /**
   * Removes a registered fallback handler for a provider.
   */
  unregisterFallback(provider: string): void {
    const key = this.normalizeKey(provider);
    this.fallbacks.delete(key);
  }

  /**
   * Executes a provider action protected by its dedicated circuit breaker.
   * If the circuit is open or trips, the fallback handler is called to prevent
   * cascading outages.
   */
  async execute<T>(
    provider: string,
    action: () => Promise<T>,
    fallback?: ProviderFallback<T>,
    options?: CircuitBreakerOptions,
  ): Promise<T> {
    const key = this.normalizeKey(provider);
    const breaker = this.getBreaker(key, options);
    const activeFallback = (fallback ?? this.fallbacks.get(key)) as ProviderFallback<T> | undefined;

    try {
      return await breaker.execute(action);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (activeFallback) {
        return await activeFallback(error);
      }
      throw error;
    }
  }

  /**
   * Returns the current circuit state for a provider.
   */
  getState(provider: string): CircuitState {
    const key = this.normalizeKey(provider);
    const breaker = this.breakers.get(key);
    return breaker ? breaker.state : 'closed';
  }

  /**
   * Returns current states for all registered providers.
   */
  getAllStates(): Record<string, CircuitState> {
    const result: Record<string, CircuitState> = {};
    for (const [provider, breaker] of this.breakers.entries()) {
      result[provider] = breaker.state;
    }
    return result;
  }

  /**
   * Manually resets a provider's circuit breaker to closed state.
   */
  reset(provider: string): void {
    const key = this.normalizeKey(provider);
    this.breakers.get(key)?.reset();
  }

  /**
   * Resets all provider circuit breakers.
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Clears all registered breakers and fallbacks (primarily for testing).
   */
  clear(): void {
    this.breakers.clear();
    this.fallbacks.clear();
  }
}

export const providerCircuitBreakerRegistry = new ProviderCircuitBreakerRegistry();

/**
 * Convenience helper to execute a call with per-provider circuit breaker and fallback.
 */
export async function executeWithProviderFallback<T>(
  provider: string,
  action: () => Promise<T>,
  fallback?: ProviderFallback<T>,
  options?: CircuitBreakerOptions,
): Promise<T> {
  return providerCircuitBreakerRegistry.execute(provider, action, fallback, options);
}

export { CircuitOpenError };
