import {
  ProviderCircuitBreakerRegistry,
  executeWithProviderFallback,
  CircuitOpenError,
} from '../providerCircuitBreaker';

describe('ProviderCircuitBreakerRegistry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('maintains independent circuit breaker states per provider', async () => {
    const registry = new ProviderCircuitBreakerRegistry({
      defaultOptions: { failureThreshold: 2, recoveryTimeoutMs: 10_000 },
    });

    const failingStripe = async () => {
      throw new Error('Stripe timeout');
    };
    const healthyPaddle = async () => 'paddle_ok';

    // Trip Stripe breaker
    await expect(registry.execute('stripe', failingStripe)).rejects.toThrow('Stripe timeout');
    await expect(registry.execute('stripe', failingStripe)).rejects.toThrow('Stripe timeout');

    expect(registry.getState('stripe')).toBe('open');
    expect(registry.getState('paddle')).toBe('closed');

    // Paddle remains completely unaffected
    const paddleResult = await registry.execute('paddle', healthyPaddle);
    expect(paddleResult).toBe('paddle_ok');
    expect(registry.getState('paddle')).toBe('closed');
  });

  it('triggers fallback function when provider call fails', async () => {
    const registry = new ProviderCircuitBreakerRegistry({
      defaultOptions: { failureThreshold: 3 },
    });

    const fallback = jest.fn(async (err: Error) => ({
      status: 'fallback_applied',
      cause: err.message,
    }));

    const result = await registry.execute(
      'stripe',
      async () => {
        throw new Error('503 Service Unavailable');
      },
      fallback,
    );

    expect(result).toEqual({
      status: 'fallback_applied',
      cause: '503 Service Unavailable',
    });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('triggers registered default fallback when circuit is open', async () => {
    const registry = new ProviderCircuitBreakerRegistry({
      defaultOptions: { failureThreshold: 1, recoveryTimeoutMs: 5_000 },
    });

    registry.registerFallback('quickbooks', (err) => ({
      degraded: true,
      errorName: err.name,
    }));

    // First call fails and trips circuit
    const res1 = await registry.execute('quickbooks', async () => {
      throw new Error('Network error');
    });
    expect(res1).toEqual({ degraded: true, errorName: 'Error' });
    expect(registry.getState('quickbooks')).toBe('open');

    // Second call is short-circuited and directly uses registered fallback
    const res2 = await registry.execute('quickbooks', async () => 'never_called');
    expect(res2).toEqual({ degraded: true, errorName: 'CircuitOpenError' });
  });

  it('recovers provider circuit breaker after recovery timeout', async () => {
    const registry = new ProviderCircuitBreakerRegistry({
      defaultOptions: { failureThreshold: 1, recoveryTimeoutMs: 5_000, successThreshold: 1 },
    });

    // Trip breaker
    await expect(registry.execute('circle', async () => {
      throw new Error('failed');
    })).rejects.toThrow('failed');

    expect(registry.getState('circle')).toBe('open');

    // Advance time past recovery timeout
    jest.advanceTimersByTime(5_000);

    // Call in half-open succeeds and transitions back to closed
    const res = await registry.execute('circle', async () => 'circle_restored');
    expect(res).toBe('circle_restored');
    expect(registry.getState('circle')).toBe('closed');
  });

  it('supports executeWithProviderFallback convenience function', async () => {
    const fallback = jest.fn(() => 'cached_backup_data');

    const result = await executeWithProviderFallback(
      'freshbooks',
      async () => {
        throw new Error('Gateway timeout');
      },
      fallback,
    );

    expect(result).toBe('cached_backup_data');
    expect(fallback).toHaveBeenCalled();
  });

  it('allows manual reset of individual and all provider breakers', async () => {
    const registry = new ProviderCircuitBreakerRegistry({
      defaultOptions: { failureThreshold: 1 },
    });

    await expect(registry.execute('p1', async () => { throw new Error('e1'); })).rejects.toThrow();
    await expect(registry.execute('p2', async () => { throw new Error('e2'); })).rejects.toThrow();

    expect(registry.getAllStates()).toEqual({ p1: 'open', p2: 'open' });

    registry.reset('p1');
    expect(registry.getState('p1')).toBe('closed');
    expect(registry.getState('p2')).toBe('open');

    registry.resetAll();
    expect(registry.getAllStates()).toEqual({ p1: 'closed', p2: 'closed' });
  });
});
