import { performanceMonitor } from '../performanceMonitor';

describe('performanceMonitor', () => {
  beforeEach(() => {
    performanceMonitor.reset();
    performanceMonitor.configureBudget({
      renderMs: 100,
      apiLatencyMs: 200,
      memoryBytes: 10,
    });
  });

  it('aggregates render and network metrics', async () => {
    performanceMonitor.track({
      type: 'render',
      name: 'HomeScreen',
      durationMs: 50,
      timestamp: Date.now(),
    });

    await performanceMonitor.trackApiCall('subscriptions.list', async () => 'ok');

    const summary = performanceMonitor.getSummary();

    expect(summary.totalMetrics).toBe(2);
    expect(summary.averages.render).toBe(50);
    expect(summary.averages.network).toBeGreaterThanOrEqual(0);
  });

  it('flags metrics that exceed configured budgets', () => {
    performanceMonitor.track({
      type: 'memory',
      name: 'runtime',
      value: 12,
      unit: 'bytes',
      timestamp: Date.now(),
    });

    expect(performanceMonitor.getSummary().slowMetrics).toHaveLength(1);
  });
});
