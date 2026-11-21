/**
 * Observability for developer-portal server actions.
 *
 * Issue #2061 — Refactor developer portal onto typed server actions.
 *
 * Wires the backend's structured logger and a lightweight metrics counter
 * into every portal action so invocations, successes, failures, and latency
 * are visible in logs and Prometheus without coupling actions to the
 * monitoring internals.
 */

import { createLoggerFor, type Logger } from '../../backend/services/shared/logging';

// ─────────────────────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────────────────────

/** Module-scoped logger for the developer portal. */
export const portalLogger: Logger = createLoggerFor('developer-portal');

// ─────────────────────────────────────────────────────────────────────────────
// Metrics — in-memory counters + Prometheus text export
// ─────────────────────────────────────────────────────────────────────────────

interface ActionMetric {
  total: number;
  success: number;
  failure: number;
  /** Sum of durations in ms, for average computation. */
  totalDurationMs: number;
}

class PortalMetrics {
  private readonly actions = new Map<string, ActionMetric>();

  /**
   * Record a single action invocation.
   *
   * @param actionName  Stable, dotted name (e.g. "apiKey.create").
   * @param success     Whether the action returned `{ ok: true }`.
   * @param durationMs  Wall-clock duration of the action.
   */
  record(actionName: string, success: boolean, durationMs: number): void {
    let metric = this.actions.get(actionName);
    if (!metric) {
      metric = { total: 0, success: 0, failure: 0, totalDurationMs: 0 };
      this.actions.set(actionName, metric);
    }
    metric.total++;
    if (success) metric.success++;
    else metric.failure++;
    metric.totalDurationMs += durationMs;
  }

  /** Get a snapshot of all metrics (for tests / introspection). */
  snapshot(): Record<string, ActionMetric> {
    const result: Record<string, ActionMetric> = {};
    for (const [key, value] of Array.from(this.actions)) {
      result[key] = value;
    }
    return result;
  }

  /** Reset all metrics — useful in test beforeEach hooks. */
  reset(): void {
    this.actions.clear();
  }

  /**
   * Format all metrics in Prometheus text exposition format.
   * Register this as a collector with the default PrometheusMetricsExporter.
   */
  toPrometheus(): string {
    const lines: string[] = [
      '# HELP developer_portal_action_total Total invocations per action',
      '# TYPE developer_portal_action_total counter',
      '# HELP developer_portal_action_success_total Successful invocations per action',
      '# TYPE developer_portal_action_success_total counter',
      '# HELP developer_portal_action_failure_total Failed invocations per action',
      '# TYPE developer_portal_action_failure_total counter',
      '# HELP developer_portal_action_duration_ms_total Cumulative duration per action in ms',
      '# TYPE developer_portal_action_duration_ms_total counter',
    ];

    for (const [name, metric] of Array.from(this.actions)) {
      const label = `action="${name}"`;
      lines.push(`developer_portal_action_total{${label}} ${metric.total}`);
      lines.push(`developer_portal_action_success_total{${label}} ${metric.success}`);
      lines.push(`developer_portal_action_failure_total{${label}} ${metric.failure}`);
      lines.push(`developer_portal_action_duration_ms_total{${label}} ${metric.totalDurationMs}`);
    }

    return lines.join('\n') + (lines.length > 5 ? '\n' : '');
  }
}

/** Singleton metrics instance — import and call `record()` from each action. */
export const portalMetrics = new PortalMetrics();

// ─────────────────────────────────────────────────────────────────────────────
// Prometheus registration
// ─────────────────────────────────────────────────────────────────────────────
//
// Register the portal metrics collector with the backend's default
// PrometheusMetricsExporter so it is automatically included in the unified
// /metrics scrape.  The registration is wrapped in a try/catch so importing
// this module in an environment without the backend server (e.g. a React
// Native bundle) does not crash.

try {
  // Lazy require to avoid pulling the exporter into the React Native bundle
  // at import time — it is only needed when the backend server is running.
  const { defaultExporter } = require('../../backend/monitoring/prometheusMetricsExporter');
  defaultExporter.register({
    name: 'developer-portal-actions',
    collector: () => portalMetrics.toPrometheus(),
  });
} catch {
  // Exporter not available (e.g. RN bundle) — metrics are still recorded
  // in-memory and accessible via portalMetrics.snapshot().
}

// ─────────────────────────────────────────────────────────────────────────────
// Action wrapper — standardises logging + metrics + error capture
// ─────────────────────────────────────────────────────────────────────────────

import { ok, fail, INTERNAL_ERROR, type ActionResult, type ActionFailure } from './result';

/**
 * Run an action body with standardised observability.
 *
 * Wraps the business logic so every action gets:
 *  - A structured log line at start and end (with duration).
 *  - A metrics counter increment (success or failure).
 *  - An INTERNAL_ERROR result if the body throws unexpectedly.
 *
 * Usage:
 *   export async function createApiKeyAction(input: unknown): Promise<ActionResult<ApiKey>> {
 *     return withAction('apiKey.create', async () => { ... });
 *   }
 */
export async function withAction<T>(
  actionName: string,
  body: () => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  const start = Date.now();
  portalLogger.info(`action.start: ${actionName}`);

  try {
    const result = await body();
    const durationMs = Date.now() - start;

    if (result.ok) {
      portalLogger.info(`action.success: ${actionName}`, { durationMs });
    } else {
      portalLogger.warn(`action.failure: ${actionName}`, {
        durationMs,
        code: result.error.code,
        message: result.error.message,
      });
    }

    portalMetrics.record(actionName, result.ok, durationMs);
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    portalLogger.error(`action.error: ${actionName}`, { durationMs, error: message });
    portalMetrics.record(actionName, false, durationMs);
    return fail(INTERNAL_ERROR, `Unexpected error in ${actionName}: ${message}`);
  }
}

/**
 * Convert zod error issues into ActionFieldError[] for the result envelope.
 */
import type { ActionFieldError } from './result';

export function zodIssuesToFieldErrors(error: {
  issues: Array<{ path: Array<string | number | symbol>; message: string }>;
}): ActionFieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}
