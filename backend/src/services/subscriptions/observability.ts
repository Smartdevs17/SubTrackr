/**
 * Observability hooks for the subscriptions service.
 *
 * Provides structured logging, Prometheus-compatible counters/histograms,
 * and OpenTelemetry-ready span helpers. All three modules (pricing,
 * lifecycle, sync) import from here to keep instrumentation consistent.
 *
 * Design decisions:
 *  - No hard dependency on a Prometheus or OTEL client. The module exposes
 *    an `IMetricsRecorder` interface; callers inject a real implementation
 *    in production and a no-op double in tests.
 *  - The default export (`metrics`) is a no-op implementation so services
 *    work correctly even when no metrics backend is wired.
 *  - `withSpan` is a thin wrapper that starts/ends a logical span and always
 *    records duration, letting the trace backend be swapped without touching
 *    service code.
 */

import { createPiiSafeLogger } from '../../utils/logger';

export type MetricLabels = Record<string, string | number>;

// ── Metrics interface ─────────────────────────────────────────────────────────

export interface IMetricsRecorder {
  /** Increment a counter by `delta` (default 1). */
  increment(name: string, labels?: MetricLabels, delta?: number): void;
  /** Record a duration in milliseconds. */
  timing(name: string, durationMs: number, labels?: MetricLabels): void;
  /** Set a gauge to an absolute value. */
  gauge(name: string, value: number, labels?: MetricLabels): void;
}

// ── No-op default ─────────────────────────────────────────────────────────────

class NoopMetricsRecorder implements IMetricsRecorder {
  increment(): void {}
  timing(): void {}
  gauge(): void {}
}

/** Process-wide metrics recorder. Replace in production. */
export let metrics: IMetricsRecorder = new NoopMetricsRecorder();

export function setMetricsRecorder(recorder: IMetricsRecorder): void {
  metrics = recorder;
}

// ── Span helper ───────────────────────────────────────────────────────────────

export interface SpanResult<T> {
  result: T;
  durationMs: number;
  error?: Error;
}

/**
 * Run `fn` inside a logical span. Always records duration via `metrics.timing`
 * and logs the outcome at the appropriate level.
 *
 * @example
 * const { result } = await withSpan('pricing.proration.calculate', async () =>
 *   prorationService.calculate(input)
 * );
 */
export async function withSpan<T>(
  spanName: string,
  fn: () => T | Promise<T>,
  labels: MetricLabels = {},
): Promise<SpanResult<T>> {
  const log = createPiiSafeLogger(`subscriptions.span.${spanName}`);
  const start = Date.now();
  let error: Error | undefined;

  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    metrics.timing(spanName, durationMs, { ...labels, status: 'ok' });
    metrics.increment(`${spanName}.count`, { ...labels, status: 'ok' });
    log.info(`${spanName}.ok`, { durationMs, ...labels });
    return { result, durationMs };
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    const durationMs = Date.now() - start;
    metrics.timing(spanName, durationMs, { ...labels, status: 'error' });
    metrics.increment(`${spanName}.count`, { ...labels, status: 'error' });
    metrics.increment(`${spanName}.errors`, labels);
    log.error(`${spanName}.error`, { durationMs, error: error.message, ...labels });
    throw error;
  }
}

// ── Well-known metric names ───────────────────────────────────────────────────
// Using constants avoids typos in call sites.

export const MetricName = {
  // Pricing
  PRICING_CALCULATION:         'subscriptions.pricing.calculation',
  PRICING_PRORATION:           'subscriptions.pricing.proration',
  PRICING_CACHE_HIT:           'subscriptions.pricing.cache.hit',
  PRICING_CACHE_MISS:          'subscriptions.pricing.cache.miss',

  // Lifecycle
  LIFECYCLE_CANCEL:            'subscriptions.lifecycle.cancel',
  LIFECYCLE_PAUSE:             'subscriptions.lifecycle.pause',
  LIFECYCLE_RESUME:            'subscriptions.lifecycle.resume',
  LIFECYCLE_TRIAL_START:       'subscriptions.lifecycle.trial.start',
  LIFECYCLE_TRIAL_CONVERT:     'subscriptions.lifecycle.trial.convert',
  LIFECYCLE_TRIAL_EXPIRE:      'subscriptions.lifecycle.trial.expire',
  LIFECYCLE_SLA_BREACH:        'subscriptions.lifecycle.sla.breach',
  LIFECYCLE_SLA_RESOLVED:      'subscriptions.lifecycle.sla.resolved',
  LIFECYCLE_EVENT_APPENDED:    'subscriptions.lifecycle.event.appended',

  // Sync
  SYNC_REQUEST:                'subscriptions.sync.request',
  SYNC_OPS_APPLIED:            'subscriptions.sync.ops.applied',
  SYNC_DUPLICATE_OPS:          'subscriptions.sync.ops.duplicate',
  SYNC_CONFLICTS:              'subscriptions.sync.conflicts',
  SYNC_ERROR:                  'subscriptions.sync.error',
} as const;
