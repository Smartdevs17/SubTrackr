/**
 * Tests for PrometheusMetricsExporter
 *
 * Covers:
 *  - Collector registration / unregistration
 *  - Successful single and multi-collector scrape
 *  - Async and sync collector support
 *  - Collector timeout handling
 *  - Error recovery (one failing collector does not block others)
 *  - Self-metrics are always present
 *  - HTTP handler 200 / 500 paths
 *  - Label sanitisation
 *  - `defaultExporter` singleton export
 */

import {
  PrometheusMetricsExporter,
  createUnifiedMetricsHandler,
  defaultExporter,
} from '../prometheusMetricsExporter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRes() {
  const headers: Record<string, string> = {};
  let body = '';
  let statusCode: number | undefined;
  return {
    setHeader: jest.fn((k: string, v: string) => { headers[k] = v; }),
    end: jest.fn((b: string) => { body = b; }),
    get headers() { return headers; },
    get body() { return body; },
    get statusCode() { return statusCode; },
    set statusCode(v: number | undefined) { statusCode = v; },
  };
}

// ---------------------------------------------------------------------------
// PrometheusMetricsExporter
// ---------------------------------------------------------------------------

describe('PrometheusMetricsExporter', () => {
  let exporter: PrometheusMetricsExporter;

  beforeEach(() => {
    exporter = new PrometheusMetricsExporter();
  });

  // ── registration ──────────────────────────────────────────────────────────

  it('starts with no collectors', () => {
    expect(exporter.registeredNames()).toEqual([]);
  });

  it('registers a collector and lists its name', () => {
    exporter.register({ name: 'test', collector: () => '# test\n' });
    expect(exporter.registeredNames()).toEqual(['test']);
  });

  it('supports chaining register()', () => {
    const result = exporter
      .register({ name: 'a', collector: () => '' })
      .register({ name: 'b', collector: () => '' });
    expect(result).toBe(exporter);
    expect(exporter.registeredNames()).toEqual(['a', 'b']);
  });

  it('unregister() removes the first matching collector', () => {
    exporter.register({ name: 'a', collector: () => '' });
    exporter.register({ name: 'b', collector: () => '' });
    expect(exporter.unregister('a')).toBe(true);
    expect(exporter.registeredNames()).toEqual(['b']);
  });

  it('unregister() returns false for unknown name', () => {
    expect(exporter.unregister('missing')).toBe(false);
  });

  // ── sync collector ────────────────────────────────────────────────────────

  it('collects text from a synchronous collector', async () => {
    exporter.register({
      name: 'queue',
      collector: () =>
        '# HELP subtrackr_queue_depth Current queue depth\n# TYPE subtrackr_queue_depth gauge\nsubtrackr_queue_depth{priority="high"} 3\n',
    });

    const result = await exporter.collect();
    expect(result.body).toContain('subtrackr_queue_depth{priority="high"} 3');
    expect(result.errors).toBe(0);
  });

  // ── async collector ───────────────────────────────────────────────────────

  it('collects text from an async collector', async () => {
    exporter.register({
      name: 'async_collector',
      collector: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 'subtrackr_async_gauge 42\n';
      },
    });

    const result = await exporter.collect();
    expect(result.body).toContain('subtrackr_async_gauge 42');
  });

  // ── multi-collector ───────────────────────────────────────────────────────

  it('concatenates multiple collectors separated by blank lines', async () => {
    exporter
      .register({ name: 'a', collector: () => 'metric_a 1' })
      .register({ name: 'b', collector: () => 'metric_b 2' });

    const result = await exporter.collect();
    expect(result.body).toContain('metric_a 1');
    expect(result.body).toContain('metric_b 2');
    // Blank line separator between blocks
    expect(result.body).toMatch(/metric_a 1\n\nmetric_b 2/);
  });

  // ── timeout ───────────────────────────────────────────────────────────────

  it('times out a slow collector and emits a collector_error metric', async () => {
    jest.useFakeTimers();

    const slowCollector = () =>
      new Promise<string>((resolve) => setTimeout(() => resolve('too late'), 10_000));

    exporter.register({ name: 'slow', collector: slowCollector, timeoutMs: 100 });

    const collectPromise = exporter.collect();
    // Advance past the 100 ms timeout
    jest.advanceTimersByTime(200);
    const result = await collectPromise;

    expect(result.errors).toBe(1);
    expect(result.body).toContain('subtrackr_collector_error{collector="slow"} 1');
    expect(exporter.getScrapeErrorTotal()).toBe(1);

    jest.useRealTimers();
  });

  // ── error recovery ────────────────────────────────────────────────────────

  it('continues collecting after one collector throws', async () => {
    exporter
      .register({
        name: 'bad',
        collector: () => { throw new Error('boom'); },
      })
      .register({ name: 'good', collector: () => 'metric_good 99' });

    const result = await exporter.collect();
    expect(result.errors).toBe(1);
    expect(result.body).toContain('subtrackr_collector_error{collector="bad"} 1');
    expect(result.body).toContain('metric_good 99');
  });

  it('records per-collector results including error messages', async () => {
    exporter.register({
      name: 'failing',
      collector: () => { throw new Error('test error'); },
    });

    const result = await exporter.collect();
    const cr = result.collectionResults.find((r) => r.name === 'failing');
    expect(cr).toBeDefined();
    expect(cr!.error).toBe('test error');
  });

  // ── self-metrics ──────────────────────────────────────────────────────────

  it('always includes self-metrics', async () => {
    const result = await exporter.collect();
    expect(result.body).toContain('subtrackr_metrics_scrape_total');
    expect(result.body).toContain('subtrackr_metrics_scrape_error_total');
    expect(result.body).toContain('subtrackr_metrics_scrape_duration_ms');
    expect(result.body).toContain('subtrackr_metrics_collectors_registered 0');
    expect(result.body).toContain('subtrackr_metrics_last_scrape_timestamp_ms');
  });

  it('increments scrape counter on each collect()', async () => {
    await exporter.collect();
    await exporter.collect();
    expect(exporter.getScrapeTotal()).toBe(2);
  });

  it('reports collector count in self-metrics', async () => {
    exporter.register({ name: 'x', collector: () => '' });
    exporter.register({ name: 'y', collector: () => '' });
    const result = await exporter.collect();
    expect(result.body).toContain('subtrackr_metrics_collectors_registered 2');
  });

  // ── ScrapeResult shape ────────────────────────────────────────────────────

  it('returns durationMs >= 0', async () => {
    const result = await exporter.collect();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns collectionResult for each registered collector', async () => {
    exporter
      .register({ name: 'alpha', collector: () => 'a 1' })
      .register({ name: 'beta', collector: () => 'b 2' });

    const { collectionResults } = await exporter.collect();
    const names = collectionResults.map((r) => r.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  // ── label sanitisation ────────────────────────────────────────────────────

  it('sanitises label chars in collector names containing quotes', async () => {
    exporter.register({
      name: 'has"quote',
      collector: () => { throw new Error('fail'); },
    });
    const result = await exporter.collect();
    // The label value should escape the double-quote
    expect(result.body).toContain('subtrackr_collector_error{collector="has\\"quote"} 1');
  });

  // ── renderSelfMetrics ─────────────────────────────────────────────────────

  it('renderSelfMetrics() returns Prometheus-formatted text', () => {
    const text = exporter.renderSelfMetrics();
    expect(text).toContain('# HELP subtrackr_metrics_scrape_total');
    expect(text).toContain('# TYPE subtrackr_metrics_scrape_total counter');
  });
});

// ---------------------------------------------------------------------------
// createUnifiedMetricsHandler
// ---------------------------------------------------------------------------

describe('createUnifiedMetricsHandler', () => {
  it('responds 200 with Prometheus content-type on success', async () => {
    const exporter = new PrometheusMetricsExporter();
    exporter.register({ name: 'test', collector: () => 'metric_ok 1' });

    const handler = createUnifiedMetricsHandler(exporter);
    const res = mockRes();

    await handler(undefined, res);

    expect(res.headers['Content-Type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(res.body).toContain('metric_ok 1');
  });

  it('sets X-Metrics-Scrape-Duration-Ms header', async () => {
    const exporter = new PrometheusMetricsExporter();
    const handler = createUnifiedMetricsHandler(exporter);
    const res = mockRes();

    await handler(undefined, res);
    expect(res.headers['X-Metrics-Scrape-Duration-Ms']).toBeDefined();
  });

  it('sets X-Metrics-Collector-Errors header when errors occurred', async () => {
    const exporter = new PrometheusMetricsExporter();
    exporter.register({ name: 'bad', collector: () => { throw new Error('fail'); } });

    const handler = createUnifiedMetricsHandler(exporter);
    const res = mockRes();

    await handler(undefined, res);
    expect(res.headers['X-Metrics-Collector-Errors']).toBe('1');
  });

  it('does not set X-Metrics-Collector-Errors when no errors', async () => {
    const exporter = new PrometheusMetricsExporter();
    exporter.register({ name: 'ok', collector: () => 'ok 1' });

    const handler = createUnifiedMetricsHandler(exporter);
    const res = mockRes();

    await handler(undefined, res);
    expect(res.headers['X-Metrics-Collector-Errors']).toBeUndefined();
  });

  it('ends the response even when collect() throws', async () => {
    // Force collect to throw by replacing its method
    const exporter = new PrometheusMetricsExporter();
    jest.spyOn(exporter, 'collect').mockRejectedValueOnce(new Error('internal'));

    const handler = createUnifiedMetricsHandler(exporter);
    const res = mockRes();

    await handler(undefined, res);
    expect(res.body).toContain('# ERROR:');
  });
});

// ---------------------------------------------------------------------------
// defaultExporter singleton
// ---------------------------------------------------------------------------

describe('defaultExporter', () => {
  it('is a PrometheusMetricsExporter instance', () => {
    expect(defaultExporter).toBeInstanceOf(PrometheusMetricsExporter);
  });
});
