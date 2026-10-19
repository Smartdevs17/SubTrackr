/**
 * Materialized View Refresh Job
 *
 * Incrementally refreshes each materialized view using
 * REFRESH MATERIALIZED VIEW CONCURRENTLY so reads are never blocked.
 *
 * Runs on a configurable interval (default 60 s for real-time views).
 * Exposes a Prometheus-style metric for view freshness monitoring.
 *
 * Queue priority: low (analytics / maintenance class).
 */

import { QueryClient } from '../../../backend/shared/query/queryRouter';
import type { PriorityClass } from '../../shared/queue';

/** Background queue priority for MV refresh work. */
export const MV_REFRESH_JOB_PRIORITY: PriorityClass = 'low';

interface ViewConfig {
  name: string;
  intervalMs: number;
  lastRefreshedAt: Date | null;
  isRefreshing: boolean;
}

const DEFAULT_VIEWS: ViewConfig[] = [
  { name: 'active_subscriptions_summary', intervalMs: 60_000,  lastRefreshedAt: null, isRefreshing: false },
  { name: 'subscriber_balance_mv',        intervalMs: 60_000,  lastRefreshedAt: null, isRefreshing: false },
  { name: 'monthly_revenue_mv',           intervalMs: 300_000, lastRefreshedAt: null, isRefreshing: false },
  { name: 'churn_summary_mv',             intervalMs: 300_000, lastRefreshedAt: null, isRefreshing: false },
  { name: 'mrr_mv',                       intervalMs: 300_000, lastRefreshedAt: null, isRefreshing: false },
  { name: 'cohort_retention_mv',          intervalMs: 3_600_000, lastRefreshedAt: null, isRefreshing: false },
  { name: 'ltv_mv',                       intervalMs: 86_400_000, lastRefreshedAt: null, isRefreshing: false },
];

/**
 * Pre-built parameterised-safe SQL strings for REFRESH MATERIALIZED VIEW.
 * REFRESH MATERIALIZED VIEW is DDL and does not support parameterised identifiers.
 * We store one static SQL string per known view so that no runtime string
 * interpolation ever appears in a query() call.
 */
const REFRESH_SQL: ReadonlyMap<string, string> = new Map([
  ['active_subscriptions_summary', 'REFRESH MATERIALIZED VIEW CONCURRENTLY active_subscriptions_summary'],
  ['subscriber_balance_mv',        'REFRESH MATERIALIZED VIEW CONCURRENTLY subscriber_balance_mv'],
  ['monthly_revenue_mv',           'REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_revenue_mv'],
  ['churn_summary_mv',             'REFRESH MATERIALIZED VIEW CONCURRENTLY churn_summary_mv'],
  ['mrr_mv',                       'REFRESH MATERIALIZED VIEW CONCURRENTLY mrr_mv'],
  ['cohort_retention_mv',          'REFRESH MATERIALIZED VIEW CONCURRENTLY cohort_retention_mv'],
  ['ltv_mv',                       'REFRESH MATERIALIZED VIEW CONCURRENTLY ltv_mv'],
]);

export interface RefreshMetric {
  viewName: string;
  lastRefreshedAt: Date | null;
  lagMs: number;
  isStale: boolean;
}

export class MVRefreshJob {
  private db: QueryClient;
  private views: ViewConfig[];
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(db: QueryClient, views?: ViewConfig[]) {
    this.db = db;
    this.views = views ?? DEFAULT_VIEWS.map((v) => ({ ...v }));
  }

  start(): void {
    for (const view of this.views) {
      if (this.timers.has(view.name)) continue;
      void this.refresh(view.name);
      const timer = setInterval(
        () => void this.refresh(view.name),
        view.intervalMs,
      );
      this.timers.set(view.name, timer);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  async refresh(viewName: string): Promise<void> {
    const view = this.views.find((v) => v.name === viewName);
    if (!view || view.isRefreshing) return;

    // Look up the pre-built static SQL string for this view.
    // REFRESH MATERIALIZED VIEW is DDL with no parameterised-identifier support;
    // using a static map ensures no runtime string interpolation reaches query().
    const sql = REFRESH_SQL.get(viewName);
    if (!sql) {
      console.error(`[MVRefreshJob] No refresh SQL registered for view: ${viewName}`);
      return;
    }

    view.isRefreshing = true;
    const start = Date.now();

    try {
      await this.db.query(sql);
      view.lastRefreshedAt = new Date();
      console.info(`[MVRefreshJob] Refreshed ${viewName} in ${Date.now() - start}ms`);
    } catch (err) {
      console.error(`[MVRefreshJob] Failed to refresh ${viewName}:`, err);
    } finally {
      view.isRefreshing = false;
    }
  }

  getMetrics(): RefreshMetric[] {
    return this.views.map((view) => {
      const lagMs = view.lastRefreshedAt
        ? Date.now() - view.lastRefreshedAt.getTime()
        : Infinity;
      return {
        viewName: view.name,
        lastRefreshedAt: view.lastRefreshedAt,
        lagMs,
        isStale: lagMs > view.intervalMs * 1.5,
      };
    });
  }

  prometheusMetrics(): string {
    const lines: string[] = [
      '# HELP subtrackr_mv_lag_ms Materialized view refresh lag in milliseconds',
      '# TYPE subtrackr_mv_lag_ms gauge',
    ];

    for (const m of this.getMetrics()) {
      const lag = isFinite(m.lagMs) ? m.lagMs : -1;
      lines.push(`subtrackr_mv_lag_ms{view="${m.viewName}"} ${lag}`);
    }

    lines.push('# HELP subtrackr_mv_is_stale Whether the view is stale (1=stale, 0=fresh)');
    lines.push('# TYPE subtrackr_mv_is_stale gauge');
    for (const m of this.getMetrics()) {
      lines.push(`subtrackr_mv_is_stale{view="${m.viewName}"} ${m.isStale ? 1 : 0}`);
    }

    return lines.join('\n');
  }
}
