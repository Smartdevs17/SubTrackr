import {
  createProviderOutageMonitor,
  createProviderStatusHandler,
  noopOutageMetrics,
  type ProviderOutageMetrics,
  type ProviderStatusSignal,
  type ProviderStatusSnapshot,
} from '../providerStatus';

function harness(overrides: Record<string, unknown> = {}) {
  let clock = 1_700_000_000_000;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const metrics: ProviderOutageMetrics = {
    increment: jest.fn(),
    gauge: jest.fn(),
    ...(overrides.metrics as Partial<ProviderOutageMetrics> | undefined),
  };
  const monitor = createProviderOutageMonitor({
    providers: ['stripe', 'paypal'],
    now: () => clock,
    logger,
    metrics,
    ...overrides,
  });
  return {
    monitor,
    metrics,
    logger,
    advance(ms: number) {
      clock += ms;
    },
    now: () => clock,
  };
}

function operationalSnapshot(overrides: Partial<ProviderStatusSnapshot> = {}): ProviderStatusSnapshot {
  return {
    overall: 'operational',
    providers: [],
    activeOutages: [],
    updatedAt: new Date(1_700_000_000_000).toISOString(),
    ...overrides,
  };
}

describe('createProviderOutageMonitor', () => {
  it('starts preconfigured providers as unknown', () => {
    const { monitor } = harness();
    const snapshot = monitor.getSnapshot();

    expect(snapshot.overall).toBe('unknown');
    expect(snapshot.providers.map((provider) => provider.providerId)).toEqual(['paypal', 'stripe']);
    expect(snapshot.providers.every((provider) => provider.status === 'unknown')).toBe(true);
    expect(monitor.getStatus('missing')).toBeUndefined();
  });

  it('detects an outage after the configured consecutive failures', () => {
    const { monitor, advance } = harness({ failureThreshold: 3, transitionDebounceMs: 0 });

    monitor.recordFailure('stripe', 'HTTP 503');
    monitor.recordFailure('stripe', 'HTTP 503');
    expect(monitor.getStatus('stripe')?.status).not.toBe('outage');

    advance(1);
    const outage = monitor.recordFailure('stripe', 'timeout');

    expect(outage.status).toBe('outage');
    expect(outage.consecutiveFailures).toBe(3);
    expect(outage.reason).toBe('timeout');
    expect(outage.detectedAt).toBe(new Date(1_700_000_000_001).toISOString());
    expect(monitor.getSnapshot().activeOutages).toEqual(['stripe']);
    expect(monitor.getSnapshot().overall).toBe('outage');
  });

  it('degrades on a rolling failure rate with enough samples', () => {
    const { monitor, advance } = harness({
      failureThreshold: 10,
      degradedFailureRate: 0.5,
      minSamplesForDegraded: 2,
      transitionDebounceMs: 0,
    });

    monitor.recordFailure('paypal');
    advance(1);
    const degraded = monitor.recordSuccess('paypal');

    expect(degraded.status).toBe('degraded');
    expect(degraded.failureRate).toBe(0.5);
    expect(monitor.getSnapshot().overall).toBe('degraded');
  });

  it('maps webhook status signals into the same state machine', () => {
    const { monitor, advance } = harness({
      failureThreshold: 1,
      transitionDebounceMs: 0,
      source: {
        getAllStatuses(): ProviderStatusSignal[] {
          return [
            { providerId: 'stripe', status: 'maintenance', description: 'Scheduled work' },
            {
              providerId: 'paypal',
              status: 'major_outage',
              description: 'Cannot process payments',
              updatedAt: 1_700_000_000_000,
            },
          ];
        },
      },
    });

    monitor.refresh();
    advance(1);
    monitor.refresh();

    expect(monitor.getStatus('stripe')?.status).toBe('degraded');
    expect(monitor.getStatus('paypal')?.status).toBe('outage');
    expect(monitor.getSnapshot().activeOutages).toEqual(['paypal']);
  });

  it('requires repeated successes and a low failure rate to recover', () => {
    const { monitor, advance } = harness({
      failureThreshold: 2,
      recoveryThreshold: 2,
      degradedFailureRate: 0.5,
      transitionDebounceMs: 0,
    });

    monitor.recordFailure('stripe');
    advance(1);
    monitor.recordFailure('stripe');
    advance(1);
    monitor.recordSuccess('stripe');
    advance(1);

    expect(monitor.getStatus('stripe')?.status).toBe('outage');

    const recovered = monitor.recordSuccess('stripe');
    expect(recovered.status).toBe('degraded');
    expect(recovered.recoveredAt).toBeUndefined();

    advance(1);
    const operational = monitor.recordSuccess('stripe');
    expect(operational.status).toBe('operational');
    expect(operational.recoveredAt).toBe(new Date(1_700_000_000_004).toISOString());
    expect(operational.consecutiveFailures).toBe(0);
  });

  it('honours transition debouncing', () => {
    const { monitor, advance } = harness({
      failureThreshold: 1,
      recoveryThreshold: 1,
      degradedFailureRate: 1,
      transitionDebounceMs: 1000,
    });

    monitor.recordFailure('stripe');
    advance(500);
    expect(monitor.recordSuccess('stripe').status).toBe('outage');

    advance(1000);
    expect(monitor.recordSuccess('stripe').status).toBe('operational');
  });

  it('prunes events outside the rolling window', () => {
    const { monitor, advance } = harness({
      windowMs: 1000,
      failureThreshold: 2,
      transitionDebounceMs: 0,
    });

    monitor.recordFailure('stripe');
    advance(2000);
    const afterWindow = monitor.recordFailure('stripe');

    expect(afterWindow.consecutiveFailures).toBe(1);
    expect(monitor.getSnapshot().overall).not.toBe('outage');
  });

  it('notifies subscribers only when a transition is committed', () => {
    const { monitor, advance } = harness({
      failureThreshold: 1,
      recoveryThreshold: 1,
      degradedFailureRate: 1,
      transitionDebounceMs: 0,
    });
    const listener = jest.fn();
    const unsubscribe = monitor.subscribe(listener);

    monitor.recordFailure('stripe');
    advance(1);
    monitor.recordFailure('stripe');
    monitor.recordFailure('stripe');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].activeOutages).toEqual(['stripe']);
    expect(listener.mock.calls[0][1].overall).not.toBe('outage');

    unsubscribe();
    advance(1);
    monitor.recordSuccess('stripe');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates subscribers from listener errors', () => {
    const { monitor, advance } = harness({ failureThreshold: 1, transitionDebounceMs: 0 });
    monitor.subscribe(() => {
      throw new Error('broken subscriber');
    });

    expect(() => {
      advance(1);
      monitor.recordFailure('stripe');
    }).not.toThrow();
  });

  it('emits structured telemetry for transitions and failure rate', () => {
    const { monitor, metrics, logger, advance } = harness({
      failureThreshold: 1,
      transitionDebounceMs: 0,
    });

    advance(1);
    monitor.recordFailure('stripe', 'HTTP 500');

    expect(metrics.increment).toHaveBeenCalledWith('provider_outage_transition', {
      provider: 'stripe',
      from: 'unknown',
      to: 'outage',
    });
    expect(metrics.gauge).toHaveBeenCalledWith('provider_failure_rate', 1, {
      provider: 'stripe',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('stripe: unknown -> outage'),
      'HTTP 500',
    );
  });

  it('can reset a single provider or all state', () => {
    const { monitor } = harness();

    monitor.recordFailure('stripe');
    monitor.recordFailure('paypal');
    monitor.reset('stripe');

    expect(monitor.getStatus('stripe')).toBeUndefined();
    expect(monitor.getStatus('paypal')).toBeDefined();

    monitor.reset();
    expect(monitor.getSnapshot().providers).toEqual([]);
    expect(monitor.getSnapshot().overall).toBe('unknown');
  });
});

describe('createProviderStatusHandler', () => {
  it('returns the full snapshot and per-provider status', () => {
    const { monitor } = harness();
    const handler = createProviderStatusHandler(monitor);
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));

    handler.getSnapshot({}, { json, status });
    expect(json).toHaveBeenCalledWith(monitor.getSnapshot());

    handler.getProvider({ params: { providerId: 'stripe' } }, { json, status });
    expect(json).toHaveBeenLastCalledWith(monitor.getStatus('stripe'));
  });

  it('returns 404 for an unknown provider', () => {
    const { monitor } = harness();
    const handler = createProviderStatusHandler(monitor);
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));

    handler.getProvider({ params: { providerId: 'missing' } }, { json, status });

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'Unknown provider' });
  });
});

describe('noopOutageMetrics', () => {
  it('is safe to call', () => {
    expect(() => {
      noopOutageMetrics.increment('name');
      noopOutageMetrics.gauge('name', 1);
    }).not.toThrow();
  });
});

// Keep an explicit reference to the snapshot type so future response changes
// are caught at compile time in this test file.
const _snapshotType: ProviderStatusSnapshot = operationalSnapshot();
void _snapshotType;
