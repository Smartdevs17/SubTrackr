/**
 * backend/src/sla/calculator.ts
 *
 * Pure SLA arithmetic: measurement periods, interval maths for downtime and
 * maintenance, a bounded latency histogram, period evaluation and credit
 * calculation. No state, no I/O — the monitor in ./monitor.ts owns those.
 */

import type { SlaMetric, SlaPeriodReport, SlaTierPolicy } from './types';

// ── Measurement periods (calendar months, UTC) ──────────────────────────────

/** `[start, end)` of the UTC calendar month containing `at` (ms). */
export function periodBounds(at: number): { start: number; end: number } {
  const d = new Date(at);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start, end };
}

// ── Intervals ───────────────────────────────────────────────────────────────

export interface Interval {
  start: number;
  end: number;
}

/** Clips intervals to `[from, to)`, drops empties, and merges overlaps. */
export function normalizeIntervals(intervals: Interval[], from: number, to: number): Interval[] {
  const clipped = intervals
    .map((i) => ({ start: Math.max(i.start, from), end: Math.min(i.end, to) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);

  const merged: Interval[] = [];
  for (const interval of clipped) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/** Total length of normalized (sorted, non-overlapping) intervals. */
export function totalLength(intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
}

/** Overlap length between two normalized interval lists. */
export function overlapLength(a: Interval[], b: Interval[]): number {
  let i = 0;
  let j = 0;
  let overlap = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) overlap += end - start;
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return overlap;
}

// ── Latency histogram ───────────────────────────────────────────────────────

/** Upper bounds (ms) of the latency buckets; the last bucket is unbounded. */
export const LATENCY_BUCKETS_MS: readonly number[] = [
  25, 50, 100, 200, 300, 500, 750, 1_000, 1_500, 2_000, 3_000, 5_000, 10_000,
];

/** Fixed-size request stats for one subscription and period. */
export interface RequestStats {
  count: number;
  errors: number;
  /** `LATENCY_BUCKETS_MS.length + 1` counters; the last one is overflow. */
  buckets: number[];
  maxLatencyMs: number;
}

export function emptyRequestStats(): RequestStats {
  return {
    count: 0,
    errors: 0,
    buckets: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0),
    maxLatencyMs: 0,
  };
}

export function observeRequest(stats: RequestStats, latencyMs: number, ok: boolean): void {
  stats.count += 1;
  if (!ok) stats.errors += 1;
  stats.maxLatencyMs = Math.max(stats.maxLatencyMs, latencyMs);
  let idx = LATENCY_BUCKETS_MS.findIndex((bound) => latencyMs <= bound);
  if (idx === -1) idx = LATENCY_BUCKETS_MS.length;
  stats.buckets[idx] += 1;
}

/**
 * Percentile estimate from the histogram: the upper bound of the bucket that
 * contains the requested rank (the observed maximum for the overflow bucket).
 * Conservative — it never under-reports latency.
 */
export function estimatePercentile(stats: RequestStats, quantile: number): number | null {
  if (stats.count === 0) return null;
  const rank = Math.ceil(stats.count * quantile);
  let seen = 0;
  for (let i = 0; i < stats.buckets.length; i++) {
    seen += stats.buckets[i];
    if (seen >= rank) {
      return i < LATENCY_BUCKETS_MS.length
        ? Math.min(LATENCY_BUCKETS_MS[i], stats.maxLatencyMs)
        : stats.maxLatencyMs;
    }
  }
  return stats.maxLatencyMs;
}

// ── Evaluation ──────────────────────────────────────────────────────────────

export interface EvaluationInput {
  subscriptionId: string;
  policy: SlaTierPolicy;
  periodStart: number;
  periodEnd: number;
  /** Measurement begins at enrolment if that falls inside the period. */
  registeredAt: number;
  /** Evaluate up to here (`periodEnd` when closing, now for live status). */
  evaluatedUntil: number;
  outages: Interval[];
  maintenance: Interval[];
  requests: RequestStats;
  /** Below this many requests, latency and error rate are not judged. */
  minRequests: number;
}

const round = (value: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/**
 * Evaluates one subscription's window.
 *
 * Uptime is judged against the downtime budget of the *whole* period, so a
 * live evaluation reports a breach exactly when the period can no longer
 * meet its target, not when an early outage briefly dents the ratio.
 */
export function evaluatePeriod(input: EvaluationInput): SlaPeriodReport {
  const { policy } = input;
  const from = Math.max(input.periodStart, input.registeredAt);
  const until = Math.max(from, Math.min(input.evaluatedUntil, input.periodEnd));

  const windowMaintenance = normalizeIntervals(input.maintenance, from, until);
  const windowOutages = normalizeIntervals(input.outages, from, until);
  const measuredMs = until - from - totalLength(windowMaintenance);
  const downtimeMs = totalLength(windowOutages) - overlapLength(windowOutages, windowMaintenance);

  const periodMaintenance = normalizeIntervals(input.maintenance, from, input.periodEnd);
  const periodMeasurableMs = input.periodEnd - from - totalLength(periodMaintenance);
  const downtimeBudgetMs = Math.max(
    0,
    Math.floor((periodMeasurableMs * (100 - policy.uptimeTargetPercent)) / 100)
  );

  const uptimePercent =
    measuredMs > 0 ? round(((measuredMs - downtimeMs) / measuredMs) * 100, 4) : 100;
  let budgetConsumedPercent: number;
  if (downtimeBudgetMs > 0) budgetConsumedPercent = round((downtimeMs / downtimeBudgetMs) * 100, 2);
  else budgetConsumedPercent = downtimeMs > 0 ? 100 : 0;

  const enoughRequests = input.requests.count >= input.minRequests && input.requests.count > 0;
  const errorRatePercent = enoughRequests
    ? round((input.requests.errors / input.requests.count) * 100, 4)
    : null;
  const p95LatencyMs = enoughRequests ? estimatePercentile(input.requests, 0.95) : null;

  const breaches: SlaMetric[] = [];
  if (downtimeMs > downtimeBudgetMs) breaches.push('uptime');
  if (p95LatencyMs !== null && p95LatencyMs > policy.p95LatencyTargetMs) breaches.push('latency');
  if (errorRatePercent !== null && errorRatePercent > policy.errorRateTargetPercent) {
    breaches.push('error_rate');
  }

  return {
    subscriptionId: input.subscriptionId,
    tier: policy.tier,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    evaluatedUntil: until,
    measuredMs,
    downtimeMs,
    uptimePercent,
    downtimeBudgetMs,
    budgetConsumedPercent,
    requestCount: input.requests.count,
    errorCount: input.requests.errors,
    errorRatePercent,
    p95LatencyMs,
    breaches,
    compliant: breaches.length === 0,
  };
}

// ── Credits ─────────────────────────────────────────────────────────────────

/**
 * Credit percentage owed for a closed period: the most severe matching
 * uptime step, plus the latency / error-rate remedies for those breaches,
 * capped at the tier's maximum.
 */
export function creditPercentFor(policy: SlaTierPolicy, report: SlaPeriodReport): number {
  let percent = 0;
  if (report.breaches.includes('uptime')) {
    for (const step of policy.creditSchedule) {
      if (report.uptimePercent < step.belowUptimePercent) {
        percent = Math.max(percent, step.creditPercent);
      }
    }
  }
  if (report.breaches.includes('latency')) percent += policy.latencyBreachCreditPercent;
  if (report.breaches.includes('error_rate')) percent += policy.errorRateBreachCreditPercent;
  return Math.min(percent, policy.maxCreditPercent);
}

/** Credit amount in currency, rounded to cents. */
export function creditAmountFor(periodFee: number, creditPercent: number): number {
  return round((periodFee * creditPercent) / 100, 2);
}
