/**
 * QueryPerformanceMonitor
 *
 * Extends SlowQueryMonitor with:
 *   - Index usage statistics (tracks SEQ SCAN vs INDEX SCAN via EXPLAIN JSON)
 *   - Index recommendation engine (flags frequently slow queries lacking indexes)
 *   - Query plan analysis (EXPLAIN ANALYZE via optional explain client)
 *   - Performance alerting with configurable thresholds
 *   - Prometheus-compatible metrics export
 *   - Database performance dashboard snapshot
 *
 * This is the acceptance-criteria implementation for issue #418 (runtime part).
 * The offline part (pg_stat_statements + composite indexes) is in
 * db/QUERY_OPTIMIZATION.md.
 *
 * Usage:
 *   const monitor = new QueryPerformanceMonitor(pool, {
 *     slowThresholdMs: 100,
 *     onSlowQuery: (e) => alertingService.fire(e),
 *   });
 *   // Drop-in for pool.query:
 *   await monitor.query('SELECT ...', [userId]);
 *
 *   // Pull index recommendations:
 *   const recs = monitor.getIndexRecommendations();
 *
 *   // Get dashboard snapshot:
 *   const dash = monitor.getDashboardSnapshot();
 */

import { SlowQueryMonitor } from './slowQueryMonitor';
import type { QueryClient, QueryStat, SlowQueryEvent, SlowQueryMonitorOptions } from './slowQueryMonitor';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExplainNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Startup Cost'?: number;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Actual Rows'?: number;
  'Actual Total Time'?: number;
  Plans?: ExplainNode[];
}

export interface ExplainResult {
  Plan: ExplainNode;
  'Planning Time'?: number;
  'Execution Time'?: number;
}

export interface IndexUsageStat {
  fingerprint: string;
  sample: string;
  seqScanCount: number;
  indexScanCount: number;
  /** Ratio of index scans to total scans (0–1). Lower = more seq scans = index needed. */
  indexUsageRatio: number;
}

export interface IndexRecommendation {
  fingerprint: string;
  sample: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
  /** Tables mentioned in the query that likely lack a suitable index. */
  affectedTables: string[];
  p95Ms: number;
  seqScanRatio: number;
}

export interface QueryPlanAnalysis {
  fingerprint: string;
  sql: string;
  planningTimeMs: number;
  executionTimeMs: number;
  hasSeqScan: boolean;
  hasIndexScan: boolean;
  hasSortNode: boolean;
  hasHashJoin: boolean;
  nodes: string[];
  suggestion: string | null;
}

export interface QueryPerformanceAlert {
  type: 'slow_query' | 'seq_scan' | 'missing_index' | 'high_p95';
  fingerprint: string;
  message: string;
  durationMs?: number;
  threshold?: number;
  timestamp: number;
}

export interface DatabasePerformanceDashboard {
  /** Snapshot timestamp (Unix ms). */
  capturedAt: number;
  totalQueries: number;
  totalSlowQueries: number;
  /** Slow query rate (0–1). */
  slowQueryRate: number;
  topSlowByP95: QueryStat[];
  topSlowByCount: QueryStat[];
  indexUsageStats: IndexUsageStat[];
  indexRecommendations: IndexRecommendation[];
  recentAlerts: QueryPerformanceAlert[];
  /** Overall health: 'healthy' | 'degraded' | 'critical'. */
  health: 'healthy' | 'degraded' | 'critical';
}

export interface QueryPerformanceMonitorOptions extends SlowQueryMonitorOptions {
  /**
   * When true, runs EXPLAIN ANALYZE on slow queries to collect plan stats.
   * Requires a database client that supports EXPLAIN (use in staging/dev only
   * or with a low sampling rate in production).
   * Default: false.
   */
  explainSlowQueries?: boolean;
  /**
   * Sampling rate for EXPLAIN (0.0–1.0). Default: 0.1 (10% of slow queries).
   */
  explainSampleRate?: number;
  /**
   * P95 threshold (ms) above which an index recommendation is emitted.
   * Default: 200ms.
   */
  indexRecommendationThresholdMs?: number;
  /**
   * Minimum slow-count before considering index recommendation.
   * Default: 5.
   */
  indexRecommendationMinSlowCount?: number;
  /**
   * Max alerts to retain in memory. Default: 200.
   */
  maxAlerts?: number;
  /**
   * Called whenever a performance alert fires.
   */
  onAlert?: (alert: QueryPerformanceAlert) => void;
}

// ── EXPLAIN plan walker ───────────────────────────────────────────────────────

function collectNodeTypes(node: ExplainNode, result: string[] = []): string[] {
  result.push(node['Node Type']);
  for (const child of node.Plans ?? []) {
    collectNodeTypes(child, result);
  }
  return result;
}

function hasNodeType(node: ExplainNode, type: string): boolean {
  if (node['Node Type'] === type) return true;
  return (node.Plans ?? []).some((child) => hasNodeType(child, type));
}

function suggestFromPlan(nodes: string[]): string | null {
  if (nodes.includes('Seq Scan')) {
    return 'Query plan contains Seq Scan — consider adding a composite index on the filtered columns.';
  }
  if (nodes.includes('Sort')) {
    return 'Query plan contains an explicit Sort node — add an index that matches the ORDER BY columns.';
  }
  if (nodes.includes('Hash Join') && nodes.filter((n) => n === 'Seq Scan').length >= 2) {
    return 'Hash Join between two Seq Scans — add indexes on both join columns.';
  }
  return null;
}

// ── Simple table name extractor ───────────────────────────────────────────────

// NOTE: These patterns must be created fresh per call (not module-level) because
// the `g` flag maintains `lastIndex` state across calls on the same regex object.
const TABLE_PATTERN_SRC = /\bFROM\s+([a-z_][a-z0-9_]*)/gi.source;
const JOIN_PATTERN_SRC = /\bJOIN\s+([a-z_][a-z0-9_]*)/gi.source;

function extractTables(sql: string): string[] {
  const tables = new Set<string>();
  // Create fresh RegExp instances each call to avoid stale lastIndex state
  const tablePattern = new RegExp(TABLE_PATTERN_SRC, 'gi');
  const joinPattern = new RegExp(JOIN_PATTERN_SRC, 'gi');
  let m: RegExpExecArray | null;
  while ((m = tablePattern.exec(sql)) !== null) tables.add(m[1]!.toLowerCase());
  while ((m = joinPattern.exec(sql)) !== null) tables.add(m[1]!.toLowerCase());
  return [...tables];
}

// ── QueryPerformanceMonitor ───────────────────────────────────────────────────

export class QueryPerformanceMonitor extends SlowQueryMonitor {
  private readonly explainSlowQueries: boolean;
  private readonly explainSampleRate: number;
  private readonly indexRecommendationThresholdMs: number;
  private readonly indexRecommendationMinSlowCount: number;
  private readonly maxAlerts: number;
  private readonly onAlert?: (alert: QueryPerformanceAlert) => void;

  /** fingerprint → { seqScanCount, indexScanCount } */
  private readonly scanStats = new Map<string, { seqScanCount: number; indexScanCount: number; sample: string }>();
  /** Ring buffer of recent alerts. */
  private readonly alerts: QueryPerformanceAlert[] = [];
  /** fingerprint → last plan analysis */
  private readonly planCache = new Map<string, QueryPlanAnalysis>();

  private readonly db: QueryClient;
  private readonly nowFn: () => number;

  constructor(client: QueryClient, options: QueryPerformanceMonitorOptions = {}) {
    super(client, {
      ...options,
      onSlowQuery: (event) => {
        options.onSlowQuery?.(event);
        void this.handleSlowQuery(event);
      },
    });
    this.db = client;
    this.nowFn = options.now ?? Date.now;
    this.explainSlowQueries = options.explainSlowQueries ?? false;
    this.explainSampleRate = Math.min(1, Math.max(0, options.explainSampleRate ?? 0.1));
    this.indexRecommendationThresholdMs = options.indexRecommendationThresholdMs ?? 200;
    this.indexRecommendationMinSlowCount = options.indexRecommendationMinSlowCount ?? 5;
    this.maxAlerts = options.maxAlerts ?? 200;
    this.onAlert = options.onAlert;
  }

  // ── Slow query handler ────────────────────────────────────────────────────

  private async handleSlowQuery(event: SlowQueryEvent): Promise<void> {
    this.fireAlert({
      type: 'slow_query',
      fingerprint: event.fingerprint,
      message: `Slow query detected: ${event.durationMs}ms (fingerprint: ${event.fingerprint.slice(0, 60)}…)`,
      durationMs: event.durationMs,
      threshold: this.explainSampleRate,
      timestamp: event.timestamp,
    });

    // EXPLAIN ANALYZE with sampling
    if (
      this.explainSlowQueries &&
      Math.random() < this.explainSampleRate
    ) {
      try {
        const plan = await this.runExplain(event.sql);
        if (plan) {
          this.planCache.set(event.fingerprint, plan);
          if (plan.hasSeqScan) {
            this.recordScanStat(event.fingerprint, event.sql, 'seq');
            this.fireAlert({
              type: 'seq_scan',
              fingerprint: event.fingerprint,
              message: `Seq Scan detected on slow query (${event.durationMs}ms): ${event.fingerprint.slice(0, 60)}…`,
              durationMs: event.durationMs,
              timestamp: this.nowFn(),
            });
          }
          if (plan.hasIndexScan) {
            this.recordScanStat(event.fingerprint, event.sql, 'index');
          }
        }
      } catch {
        // EXPLAIN failures are non-fatal
      }
    }
  }

  // ── EXPLAIN runner ────────────────────────────────────────────────────────

  async runExplain(sql: string, params?: unknown[]): Promise<QueryPlanAnalysis | null> {
    // Only run EXPLAIN on SELECT queries (safety guard)
    const normalized = sql.trimStart().toLowerCase();
    if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
      return null;
    }

    try {
      const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
      const result = await this.db.query<Record<string, unknown>>(explainSql, params);
      const raw = result.rows[0]?.['QUERY PLAN'] as ExplainResult[] | undefined;
      if (!raw || raw.length === 0) return null;

      const plan = raw[0];
      const nodes = collectNodeTypes(plan.Plan);
      const fingerprint = sql.replace(/\s+/g, ' ').trim().slice(0, 64);

      const analysis: QueryPlanAnalysis = {
        fingerprint,
        sql,
        planningTimeMs: plan['Planning Time'] ?? 0,
        executionTimeMs: plan['Execution Time'] ?? 0,
        hasSeqScan: hasNodeType(plan.Plan, 'Seq Scan'),
        hasIndexScan: hasNodeType(plan.Plan, 'Index Scan') || hasNodeType(plan.Plan, 'Index Only Scan'),
        hasSortNode: hasNodeType(plan.Plan, 'Sort'),
        hasHashJoin: hasNodeType(plan.Plan, 'Hash Join'),
        nodes,
        suggestion: suggestFromPlan(nodes),
      };

      return analysis;
    } catch {
      return null;
    }
  }

  // ── Index usage stats ─────────────────────────────────────────────────────

  private recordScanStat(fingerprint: string, sql: string, type: 'seq' | 'index'): void {
    let stat = this.scanStats.get(fingerprint);
    if (!stat) {
      stat = { seqScanCount: 0, indexScanCount: 0, sample: sql };
      this.scanStats.set(fingerprint, stat);
    }
    if (type === 'seq') stat.seqScanCount += 1;
    else stat.indexScanCount += 1;
  }

  getIndexUsageStats(): IndexUsageStat[] {
    const result: IndexUsageStat[] = [];
    for (const [fingerprint, stat] of this.scanStats) {
      const total = stat.seqScanCount + stat.indexScanCount;
      result.push({
        fingerprint,
        sample: stat.sample,
        seqScanCount: stat.seqScanCount,
        indexScanCount: stat.indexScanCount,
        indexUsageRatio: total === 0 ? 1 : stat.indexScanCount / total,
      });
    }
    return result.sort((a, b) => a.indexUsageRatio - b.indexUsageRatio);
  }

  // ── Index recommendations ─────────────────────────────────────────────────

  getIndexRecommendations(): IndexRecommendation[] {
    const stats = this.getStats();
    const recommendations: IndexRecommendation[] = [];

    for (const stat of stats) {
      const isSlowEnough = stat.p95Ms >= this.indexRecommendationThresholdMs;
      const hasEnoughSlowCalls = stat.slowCount >= this.indexRecommendationMinSlowCount;
      if (!isSlowEnough && !hasEnoughSlowCalls) continue;

      const scanStat = this.scanStats.get(stat.fingerprint);
      const seqScanRatio = scanStat
        ? scanStat.seqScanCount / (scanStat.seqScanCount + scanStat.indexScanCount || 1)
        : 0;

      const affectedTables = extractTables(stat.sample);
      let reason = '';
      let severity: 'high' | 'medium' | 'low' = 'low';

      if (seqScanRatio > 0.8) {
        reason = `High sequential scan ratio (${(seqScanRatio * 100).toFixed(0)}%) with p95=${stat.p95Ms}ms. Add a composite index on WHERE/ORDER BY columns.`;
        severity = 'high';
      } else if (stat.p95Ms >= 500) {
        reason = `p95 latency ${stat.p95Ms}ms exceeds 500ms threshold — review query plan and consider index.`;
        severity = 'high';
      } else if (stat.p95Ms >= this.indexRecommendationThresholdMs) {
        reason = `p95 latency ${stat.p95Ms}ms exceeds ${this.indexRecommendationThresholdMs}ms threshold — possible index opportunity.`;
        severity = stat.slowCount >= 20 ? 'medium' : 'low';
      }

      if (reason) {
        recommendations.push({
          fingerprint: stat.fingerprint,
          sample: stat.sample,
          reason,
          severity,
          affectedTables,
          p95Ms: stat.p95Ms,
          seqScanRatio,
        });

        if (severity === 'high') {
          this.fireAlert({
            type: 'missing_index',
            fingerprint: stat.fingerprint,
            message: reason,
            timestamp: this.nowFn(),
          });
        }
      }
    }

    return recommendations.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity] || b.p95Ms - a.p95Ms;
    });
  }

  // ── Alerts ────────────────────────────────────────────────────────────────

  private fireAlert(alert: QueryPerformanceAlert): void {
    this.alerts.push(alert);
    if (this.alerts.length > this.maxAlerts) {
      this.alerts.shift();
    }
    this.onAlert?.(alert);
  }

  getRecentAlerts(limit = 50): QueryPerformanceAlert[] {
    return this.alerts.slice(-limit);
  }

  // ── Query plan cache ──────────────────────────────────────────────────────

  getCachedPlan(fingerprint: string): QueryPlanAnalysis | undefined {
    return this.planCache.get(fingerprint);
  }

  getAllCachedPlans(): QueryPlanAnalysis[] {
    return [...this.planCache.values()];
  }

  // ── Dashboard snapshot ────────────────────────────────────────────────────

  getDashboardSnapshot(
    options: { topN?: number; alertsLimit?: number } = {},
  ): DatabasePerformanceDashboard {
    const topN = options.topN ?? 20;
    const alertsLimit = options.alertsLimit ?? 50;

    const stats = this.getStats();
    const totalQueries = stats.reduce((s, q) => s + q.count, 0);
    const totalSlowQueries = stats.reduce((s, q) => s + q.slowCount, 0);
    const slowQueryRate = totalQueries > 0 ? totalSlowQueries / totalQueries : 0;

    const topSlowByP95 = this.getTopSlow(topN);
    const topSlowByCount = [...stats]
      .sort((a, b) => b.slowCount - a.slowCount)
      .slice(0, topN);

    const indexUsageStats = this.getIndexUsageStats();
    const indexRecommendations = this.getIndexRecommendations();
    const recentAlerts = this.getRecentAlerts(alertsLimit);

    let health: DatabasePerformanceDashboard['health'] = 'healthy';
    if (indexRecommendations.some((r) => r.severity === 'high') || slowQueryRate > 0.1) {
      health = 'degraded';
    }
    if (slowQueryRate > 0.3 || indexRecommendations.filter((r) => r.severity === 'high').length >= 3) {
      health = 'critical';
    }

    return {
      capturedAt: this.nowFn(),
      totalQueries,
      totalSlowQueries,
      slowQueryRate,
      topSlowByP95,
      topSlowByCount,
      indexUsageStats,
      indexRecommendations,
      recentAlerts,
      health,
    };
  }

  // ── Prometheus export ─────────────────────────────────────────────────────

  prometheusMetrics(namespace = 'subtrackr_db'): string {
    const dash = this.getDashboardSnapshot();
    const topSlow = this.getTopSlow(5);

    const lines = [
      `# HELP ${namespace}_queries_total Total number of queries executed`,
      `# TYPE ${namespace}_queries_total counter`,
      `${namespace}_queries_total ${dash.totalQueries}`,

      `# HELP ${namespace}_slow_queries_total Total slow queries (>${this.explainSampleRate * 100}ms)`,
      `# TYPE ${namespace}_slow_queries_total counter`,
      `${namespace}_slow_queries_total ${dash.totalSlowQueries}`,

      `# HELP ${namespace}_slow_query_rate Slow query ratio (0-1)`,
      `# TYPE ${namespace}_slow_query_rate gauge`,
      `${namespace}_slow_query_rate ${dash.slowQueryRate.toFixed(4)}`,

      `# HELP ${namespace}_index_recommendations_total Pending index recommendations`,
      `# TYPE ${namespace}_index_recommendations_total gauge`,
      `${namespace}_index_recommendations_total{severity="high"} ${dash.indexRecommendations.filter((r) => r.severity === 'high').length}`,
      `${namespace}_index_recommendations_total{severity="medium"} ${dash.indexRecommendations.filter((r) => r.severity === 'medium').length}`,
      `${namespace}_index_recommendations_total{severity="low"} ${dash.indexRecommendations.filter((r) => r.severity === 'low').length}`,

      `# HELP ${namespace}_query_p95_ms P95 latency for top slow queries (ms)`,
      `# TYPE ${namespace}_query_p95_ms gauge`,
      ...topSlow.map((s) =>
        `${namespace}_query_p95_ms{fingerprint="${s.fingerprint.slice(0, 40).replace(/"/g, "'")}"}  ${s.p95Ms}`,
      ),

      `# HELP ${namespace}_health Database performance health (0=healthy, 1=degraded, 2=critical)`,
      `# TYPE ${namespace}_health gauge`,
      `${namespace}_health ${dash.health === 'healthy' ? 0 : dash.health === 'degraded' ? 1 : 2}`,
    ];

    return lines.join('\n');
  }

  override reset(): void {
    super.reset();
    this.scanStats.clear();
    this.planCache.clear();
    this.alerts.length = 0;
  }
}
