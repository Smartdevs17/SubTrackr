/**
 * Materialized View Refresh Job
 *
 * Incrementally refreshes each materialized view using
 * REFRESH MATERIALIZED VIEW CONCURRENTLY so reads are never blocked.
 *
 * Runs on a configurable interval (default 60 s for real-time views).
 * Exposes a Prometheus-style metric for view freshness monitoring.
 */

import { QueryClient } from '../../../backend/shared/query/queryRouter';

// ── View definitions ──────────────────────────────────────────────────────────

interface ViewConfig {
  name: string;
  /** Refresh interval in ms. */
  intervalMs: number;
  /** Last successful refresh timestamp. */
  lastRefreshedAt: Date | null;
  isRefreshing: boolean;
}

const DEFAULT_VIEWS: ViewConfig[] = [
  { name: 'active_subscriptions_summary', intervalMs: 60_000,  lastRefreshedAt: null, isRefreshing: false },
  { name: 'subscriber_balance_mv',        intervalMs: 60_000,  lastRefreshedAt: null, isRefreshing: false },
  { name: 'monthly_revenue_mv',           intervalMs: 300_000, lastRefreshedAt: null, isRefreshing: false },
  { name: 'churn_summary_mv',             intervalMs: 300_000, lastRefreshedAt: null, isRefreshing: false },
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RefreshMetric {
  viewName: string;
  lastRefreshedAt: Date | null;
  lagMs: number;
  isStale: boolean;
}

// ── Job ───────────────────────────────────────────────────────────────────────

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

      // Run immediately on start, then on interval
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

  /** Refresh a single view by name. Skips if already refreshing. */
  async refresh(viewName: string): Promise<void> {
    const view = this.views.find((v) => v.name === viewName);
    if (!view || view.isRefreshing) return;

    view.isRefreshing = true;
    const start = Date.now();

    try {
      // CONCURRENTLY requires a unique index on the view — see migration 002
      await this.db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`);
      view.lastRefreshedAt = new Date();
      console.info(`[MVRefreshJob] Refreshed ${viewName} in ${Date.now() - start}ms`);
    } catch (err) {
      console.error(`[MVRefreshJob] Failed to refresh ${viewName}:`, err);
    } finally {
      view.isRefreshing = false;
    }
  }

  /** Return freshness metrics for all views (used by monitoring service). */
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

  /**
   * Prometheus-style text format for scraping.
   *
   * Metrics exposed:
   *   subtrackr_mv_lag_ms{view="..."}   – lag in milliseconds
   *   subtrackr_mv_is_stale{view="..."}  – 1 if stale, 0 if fresh
   */
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
