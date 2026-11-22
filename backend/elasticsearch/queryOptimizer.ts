/**
 * Elasticsearch Query Optimizer — SubTrackr
 *
 * Analyses in-process index queries, recommends missing indexes, detects
 * slow/expensive scan patterns, and exposes Prometheus-compatible metrics.
 *
 * Architecture note:
 * SubTrackr's "Elasticsearch" layer is an in-process index backed by
 * AsyncStorage (mobile) or an in-memory Map (server). This optimizer:
 *   1. Intercepts query execution and measures wall-clock latency.
 *   2. Classifies each query as indexed (fast) or unindexed (slow scan).
 *   3. Maintains a sorted index structure for the most-queried fields.
 *   4. Generates actionable index recommendations and benchmark reports.
 *
 * Usage:
 * ```ts
 * const optimizer = new QueryOptimizer(subscriptionIndex);
 * const results = await optimizer.search({ field: 'userId', value: 'u123' });
 * console.log(optimizer.getIndexAnalysis());
 * ```
 */

import { SUBSCRIPTION_INDEX_MAPPING, type ElasticsearchConfig } from './config';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FieldType = 'text' | 'keyword' | 'float' | 'boolean' | 'date';
export type SortDirection = 'asc' | 'desc';

export interface QuerySpec {
  /** Primary field to filter on */
  field: string;
  value: unknown;
  /** Optional secondary sort field */
  sortField?: string;
  sortDirection?: SortDirection;
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Range filter (inclusive). Only for numeric/date fields. */
  range?: { gte?: unknown; lte?: unknown };
  /** Full-text search term (applied to text fields only) */
  searchTerm?: string;
}

export interface QueryPlan {
  /** Whether a covering index was used (or will be used after creation). */
  usedIndex: boolean;
  /** Estimated cardinality of the scanned dataset before filtering. */
  estimatedScanCount: number;
  /** Milliseconds the query took (populated after execution). */
  latencyMs: number;
  /** Index recommendation, if relevant. */
  recommendation?: IndexRecommendation;
}

export interface IndexRecommendation {
  field: string;
  fieldType: FieldType;
  /** Estimated query speedup factor. */
  estimatedSpeedup: number;
  reason: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface IndexStats {
  field: string;
  queryCount: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  hitCount: number; // queries that used an index
  missCount: number; // queries that fell back to full scan
  hitRate: number; // hitCount / queryCount
}

export interface IndexAnalysisReport {
  totalQueries: number;
  indexedQueries: number;
  unindexedQueries: number;
  overallHitRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  fieldStats: IndexStats[];
  recommendations: IndexRecommendation[];
  slowQueries: SlowQueryRecord[];
}

export interface SlowQueryRecord {
  field: string;
  value: string;
  latencyMs: number;
  usedIndex: boolean;
  timestamp: number;
  scanCount: number;
}

// ─── In-process B-tree index (sorted array) ───────────────────────────────────

/**
 * Lightweight sorted-array index for a single field.
 *
 * Provides O(log n) range lookups and O(1) equality lookups for low-
 * to-medium cardinality datasets (≤ 50 000 docs typical for this app).
 * For larger datasets this would be replaced by a real ES cluster.
 */
export class FieldIndex<T extends Record<string, unknown>> {
  private entries: Array<{ key: unknown; doc: T }> = [];
  private dirty = false;

  constructor(readonly field: string) {}

  /** Insert or update a document in the index. */
  upsert(doc: T): void {
    const key = doc[this.field];
    const pos = this.entries.findIndex((e) => e.doc === doc);
    if (pos >= 0) {
      this.entries[pos] = { key, doc };
    } else {
      this.entries.push({ key, doc });
    }
    this.dirty = true;
  }

  /** Remove a document from the index. */
  remove(doc: T): void {
    const pos = this.entries.findIndex((e) => e.doc === doc);
    if (pos >= 0) {
      this.entries.splice(pos, 1);
    }
  }

  /** Rebuild the sorted order (lazy — only when dirty). */
  private ensureSorted(): void {
    if (!this.dirty) return;
    this.entries.sort((a, b) => {
      if (a.key === b.key) return 0;
      if (a.key == null) return -1;
      if (b.key == null) return 1;
      return a.key < b.key ? -1 : 1;
    });
    this.dirty = false;
  }

  /** Exact equality lookup — O(log n) after sort. */
  get(value: unknown): T[] {
    this.ensureSorted();
    // Binary search for the value
    let lo = 0;
    let hi = this.entries.length - 1;
    const results: T[] = [];

    // Find any occurrence
    let mid = -1;
    while (lo <= hi) {
      mid = (lo + hi) >>> 1;
      const k = this.entries[mid]!.key;
      if (k === value) break;
      if (k == null || k < value!) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (mid < 0 || this.entries[mid]?.key !== value) return results;

    // Expand left and right
    let i = mid;
    while (i >= 0 && this.entries[i]!.key === value) i--;
    i++;
    while (i < this.entries.length && this.entries[i]!.key === value) {
      results.push(this.entries[i]!.doc);
      i++;
    }
    return results;
  }

  /** Range lookup — O(log n + k) where k = result size. */
  range(gte: unknown, lte: unknown): T[] {
    this.ensureSorted();
    const results: T[] = [];
    for (const { key, doc } of this.entries) {
      if (gte != null && key != null && key < gte) continue;
      if (lte != null && key != null && key > lte) continue;
      results.push(doc);
    }
    return results;
  }

  get size(): number {
    return this.entries.length;
  }
}

// ─── Query Optimizer ─────────────────────────────────────────────────────────

export interface QueryOptimizerConfig {
  /** Latency (ms) above which a query is classified as slow. Default: 50. */
  slowQueryThresholdMs?: number;
  /** Max slow query records to retain. Default: 200. */
  maxSlowQueryRecords?: number;
  /** Fields to automatically build indexes on. Default: derived from mappings. */
  autoIndexFields?: string[];
}

const DEFAULT_CONFIG: Required<QueryOptimizerConfig> = {
  slowQueryThresholdMs: 50,
  maxSlowQueryRecords: 200,
  autoIndexFields: Object.keys(SUBSCRIPTION_INDEX_MAPPING.properties),
};

/**
 * Query optimizer wrapping an in-process document store.
 *
 * @example
 * ```ts
 * const docs = new Map<string, Subscription>();
 * const optimizer = new QueryOptimizer(docs, { slowQueryThresholdMs: 30 });
 *
 * // Index new documents
 * optimizer.index('sub:1', subscription);
 *
 * // Execute an optimized query
 * const results = optimizer.search({ field: 'userId', value: 'u42' });
 *
 * // Inspect index health
 * const report = optimizer.getIndexAnalysis();
 * ```
 */
export class QueryOptimizer<T extends Record<string, unknown> = Record<string, unknown>> {
  private readonly cfg: Required<QueryOptimizerConfig>;

  // In-memory document store (id → doc)
  private readonly docs = new Map<string, T>();

  // Field indexes keyed by field name
  private readonly indexes = new Map<string, FieldIndex<T>>();

  // Metrics
  private totalQueries = 0;
  private indexedQueries = 0;
  private unindexedQueries = 0;
  private latencies: number[] = [];
  private readonly fieldHits = new Map<string, number>();
  private readonly fieldMisses = new Map<string, number>();
  private readonly fieldLatencies = new Map<string, number[]>();
  private readonly fieldQueryCounts = new Map<string, number>();
  private readonly slowQueryLog: SlowQueryRecord[] = [];

  constructor(
    initialDocs?: Map<string, T>,
    config: QueryOptimizerConfig = {},
  ) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };

    // Build indexes for auto-index fields
    for (const field of this.cfg.autoIndexFields) {
      this.indexes.set(field, new FieldIndex<T>(field));
    }

    if (initialDocs) {
      for (const [id, doc] of initialDocs) {
        this.indexDoc(id, doc);
      }
    }
  }

  // ── Document management ─────────────────────────────────────────────────────

  /** Index or re-index a document. */
  index(id: string, doc: T): void {
    const existing = this.docs.get(id);
    if (existing) {
      // Remove from all field indexes first
      for (const idx of this.indexes.values()) {
        idx.remove(existing);
      }
    }
    this.docs.set(id, doc);
    this.indexDoc(id, doc);
  }

  /** Remove a document from the store and all field indexes. */
  delete(id: string): boolean {
    const doc = this.docs.get(id);
    if (!doc) return false;
    for (const idx of this.indexes.values()) {
      idx.remove(doc);
    }
    this.docs.delete(id);
    return true;
  }

  /** Total document count. */
  get size(): number {
    return this.docs.size;
  }

  // ── Query execution ─────────────────────────────────────────────────────────

  /**
   * Execute an optimized query. Uses a field index when available,
   * falls back to a full scan otherwise.
   */
  search(spec: QuerySpec): { results: T[]; plan: QueryPlan } {
    const start = Date.now();
    const limit = spec.limit ?? 100;
    const offset = spec.offset ?? 0;

    this.totalQueries++;
    this.recordFieldQuery(spec.field);

    let candidates: T[];
    let usedIndex = false;

    const idx = this.indexes.get(spec.field);

    if (idx) {
      // ── Index path ──────────────────────────────────────────────────────────
      usedIndex = true;
      this.indexedQueries++;
      this.recordFieldHit(spec.field);

      if (spec.range) {
        candidates = idx.range(spec.range.gte, spec.range.lte);
      } else {
        candidates = idx.get(spec.value);
      }
    } else {
      // ── Full-scan path ───────────────────────────────────────────────────────
      this.unindexedQueries++;
      this.recordFieldMiss(spec.field);

      candidates = [];
      for (const doc of this.docs.values()) {
        const val = doc[spec.field];

        if (spec.range) {
          const gte = spec.range.gte;
          const lte = spec.range.lte;
          if (gte != null && (val == null || val < gte)) continue;
          if (lte != null && (val == null || val > lte)) continue;
          candidates.push(doc);
        } else if (spec.searchTerm) {
          const term = spec.searchTerm.toLowerCase();
          const raw = val == null ? '' : String(val).toLowerCase();
          if (raw.includes(term)) candidates.push(doc);
        } else {
          if (val === spec.value) candidates.push(doc);
        }
      }
    }

    // Apply full-text search filter on top of index results
    if (spec.searchTerm && usedIndex) {
      const term = spec.searchTerm.toLowerCase();
      candidates = candidates.filter((doc) => {
        const raw = doc[spec.field] == null ? '' : String(doc[spec.field]).toLowerCase();
        return raw.includes(term);
      });
    }

    // Sort if requested
    if (spec.sortField) {
      const dir = spec.sortDirection === 'desc' ? -1 : 1;
      candidates = [...candidates].sort((a, b) => {
        const av = a[spec.sortField!];
        const bv = b[spec.sortField!];
        if (av == null && bv == null) return 0;
        if (av == null) return -1 * dir;
        if (bv == null) return 1 * dir;
        return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
      });
    }

    // Paginate
    const results = candidates.slice(offset, offset + limit);

    const latencyMs = Date.now() - start;
    this.recordLatency(spec.field, latencyMs);

    // Record slow queries
    if (latencyMs >= this.cfg.slowQueryThresholdMs || (!usedIndex && this.docs.size > 100)) {
      this.recordSlowQuery(spec, latencyMs, usedIndex, candidates.length + offset);
    }

    const plan: QueryPlan = {
      usedIndex,
      estimatedScanCount: usedIndex ? candidates.length : this.docs.size,
      latencyMs,
      recommendation: usedIndex ? undefined : this.buildRecommendation(spec.field),
    };

    return { results, plan };
  }

  // ── Index management ────────────────────────────────────────────────────────

  /**
   * Explicitly create an index on a field (idempotent).
   * All existing documents are indexed immediately.
   */
  createIndex(field: string): void {
    if (this.indexes.has(field)) return;
    const idx = new FieldIndex<T>(field);
    for (const doc of this.docs.values()) {
      idx.upsert(doc);
    }
    this.indexes.set(field, idx);
  }

  /** Drop a field index. */
  dropIndex(field: string): boolean {
    return this.indexes.delete(field);
  }

  /** Returns the names of all active field indexes. */
  listIndexes(): string[] {
    return Array.from(this.indexes.keys());
  }

  // ── Analysis ────────────────────────────────────────────────────────────────

  /**
   * Generate a comprehensive index analysis report.
   *
   * Includes per-field stats, latency percentiles, and prioritised
   * recommendations for fields that lack indexes but are queried frequently.
   */
  getIndexAnalysis(): IndexAnalysisReport {
    const sortedLatencies = [...this.latencies].sort((a, b) => a - b);
    const p95 = percentile(sortedLatencies, 95);
    const p99 = percentile(sortedLatencies, 99);
    const avg = this.latencies.length > 0
      ? this.latencies.reduce((s, v) => s + v, 0) / this.latencies.length
      : 0;

    const fieldStats: IndexStats[] = [];
    for (const [field, qc] of this.fieldQueryCounts) {
      const hits = this.fieldHits.get(field) ?? 0;
      const misses = this.fieldMisses.get(field) ?? 0;
      const fLatencies = this.fieldLatencies.get(field) ?? [];
      const totalMs = fLatencies.reduce((s, v) => s + v, 0);
      fieldStats.push({
        field,
        queryCount: qc,
        totalLatencyMs: totalMs,
        avgLatencyMs: qc > 0 ? totalMs / qc : 0,
        hitCount: hits,
        missCount: misses,
        hitRate: qc > 0 ? hits / qc : 0,
      });
    }
    fieldStats.sort((a, b) => b.queryCount - a.queryCount);

    // Recommendations for unindexed fields with query activity
    const recommendations: IndexRecommendation[] = [];
    for (const stat of fieldStats) {
      if (stat.missCount > 0 && !this.indexes.has(stat.field)) {
        const rec = this.buildRecommendation(stat.field, stat);
        if (rec) recommendations.push(rec);
      }
    }
    recommendations.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.priority] - order[b.priority];
    });

    return {
      totalQueries: this.totalQueries,
      indexedQueries: this.indexedQueries,
      unindexedQueries: this.unindexedQueries,
      overallHitRate: this.totalQueries > 0 ? this.indexedQueries / this.totalQueries : 0,
      avgLatencyMs: Math.round(avg * 100) / 100,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      fieldStats,
      recommendations,
      slowQueries: [...this.slowQueryLog],
    };
  }

  /** Reset all metrics (does not affect indexes or documents). */
  resetMetrics(): void {
    this.totalQueries = 0;
    this.indexedQueries = 0;
    this.unindexedQueries = 0;
    this.latencies = [];
    this.fieldHits.clear();
    this.fieldMisses.clear();
    this.fieldLatencies.clear();
    this.fieldQueryCounts.clear();
    this.slowQueryLog.splice(0);
  }

  /** Prometheus-compatible metrics text. */
  prometheusMetrics(namespace = 'subtrackr_es_query'): string {
    const analysis = this.getIndexAnalysis();
    const lines: string[] = [
      `# HELP ${namespace}_total_queries Total queries executed`,
      `# TYPE ${namespace}_total_queries counter`,
      `${namespace}_total_queries ${analysis.totalQueries}`,
      `# HELP ${namespace}_indexed_queries Queries served from an index`,
      `# TYPE ${namespace}_indexed_queries counter`,
      `${namespace}_indexed_queries ${analysis.indexedQueries}`,
      `# HELP ${namespace}_unindexed_queries Queries requiring full scan`,
      `# TYPE ${namespace}_unindexed_queries counter`,
      `${namespace}_unindexed_queries ${analysis.unindexedQueries}`,
      `# HELP ${namespace}_index_hit_rate Fraction of queries using an index`,
      `# TYPE ${namespace}_index_hit_rate gauge`,
      `${namespace}_index_hit_rate ${analysis.overallHitRate.toFixed(4)}`,
      `# HELP ${namespace}_avg_latency_ms Average query latency`,
      `# TYPE ${namespace}_avg_latency_ms gauge`,
      `${namespace}_avg_latency_ms ${analysis.avgLatencyMs}`,
      `# HELP ${namespace}_p95_latency_ms p95 query latency`,
      `# TYPE ${namespace}_p95_latency_ms gauge`,
      `${namespace}_p95_latency_ms ${analysis.p95LatencyMs}`,
      `# HELP ${namespace}_p99_latency_ms p99 query latency`,
      `# TYPE ${namespace}_p99_latency_ms gauge`,
      `${namespace}_p99_latency_ms ${analysis.p99LatencyMs}`,
      `# HELP ${namespace}_slow_queries Total slow query events`,
      `# TYPE ${namespace}_slow_queries counter`,
      `${namespace}_slow_queries ${analysis.slowQueries.length}`,
      `# HELP ${namespace}_recommendation_count Number of index recommendations`,
      `# TYPE ${namespace}_recommendation_count gauge`,
      `${namespace}_recommendation_count ${analysis.recommendations.length}`,
      `# HELP ${namespace}_document_count Total documents in the in-process index`,
      `# TYPE ${namespace}_document_count gauge`,
      `${namespace}_document_count ${this.docs.size}`,
      `# HELP ${namespace}_index_count Number of active field indexes`,
      `# TYPE ${namespace}_index_count gauge`,
      `${namespace}_index_count ${this.indexes.size}`,
    ];

    // Per-field hit rates
    for (const stat of analysis.fieldStats) {
      const safe = stat.field.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(
        `# TYPE ${namespace}_field_hit_rate gauge`,
        `${namespace}_field_hit_rate{field="${safe}"} ${stat.hitRate.toFixed(4)}`,
      );
    }

    return lines.join('\n');
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private indexDoc(_id: string, doc: T): void {
    for (const idx of this.indexes.values()) {
      idx.upsert(doc);
    }
  }

  private recordFieldQuery(field: string): void {
    this.fieldQueryCounts.set(field, (this.fieldQueryCounts.get(field) ?? 0) + 1);
  }

  private recordFieldHit(field: string): void {
    this.fieldHits.set(field, (this.fieldHits.get(field) ?? 0) + 1);
  }

  private recordFieldMiss(field: string): void {
    this.fieldMisses.set(field, (this.fieldMisses.get(field) ?? 0) + 1);
  }

  private recordLatency(field: string, ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 20_000) this.latencies.shift();

    const fl = this.fieldLatencies.get(field) ?? [];
    fl.push(ms);
    if (fl.length > 5_000) fl.shift();
    this.fieldLatencies.set(field, fl);
  }

  private recordSlowQuery(spec: QuerySpec, latencyMs: number, usedIndex: boolean, scanCount: number): void {
    const record: SlowQueryRecord = {
      field: spec.field,
      value: String(spec.value ?? ''),
      latencyMs,
      usedIndex,
      timestamp: Date.now(),
      scanCount,
    };
    this.slowQueryLog.push(record);
    if (this.slowQueryLog.length > this.cfg.maxSlowQueryRecords) {
      this.slowQueryLog.shift();
    }
  }

  private buildRecommendation(field: string, stats?: IndexStats): IndexRecommendation | undefined {
    const mapping = SUBSCRIPTION_INDEX_MAPPING.properties[field as keyof typeof SUBSCRIPTION_INDEX_MAPPING.properties];
    const fieldType: FieldType = (mapping?.type as FieldType) ?? 'keyword';

    const queryCount = stats?.queryCount ?? (this.fieldQueryCounts.get(field) ?? 0);
    if (queryCount === 0) return undefined;

    const docCount = this.docs.size;

    // Priority: how much time is being wasted on full scans?
    let priority: IndexRecommendation['priority'];
    let estimatedSpeedup: number;

    if (queryCount >= 100 && docCount >= 1000) {
      priority = 'critical';
      estimatedSpeedup = Math.min(docCount / 10, 500);
    } else if (queryCount >= 50) {
      priority = 'high';
      estimatedSpeedup = Math.min(docCount / 20, 100);
    } else if (queryCount >= 10) {
      priority = 'medium';
      estimatedSpeedup = Math.min(docCount / 50, 20);
    } else {
      priority = 'low';
      estimatedSpeedup = 2;
    }

    return {
      field,
      fieldType,
      estimatedSpeedup,
      priority,
      reason: `Field "${field}" is queried ${queryCount}× but has no index. ` +
        `${docCount} documents require full scan on each miss. ` +
        `Adding an index could yield ~${estimatedSpeedup}× speedup.`,
    };
  }
}

// ─── Percentile helper ────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]!;
}

// ─── Singleton for subscription index ────────────────────────────────────────

/**
 * Pre-configured QueryOptimizer for the subscription index.
 *
 * Automatically builds indexes for all keyword/float/date fields from
 * the canonical SUBSCRIPTION_INDEX_MAPPING.
 */
export function createSubscriptionQueryOptimizer<T extends Record<string, unknown>>(
  docs?: Map<string, T>,
): QueryOptimizer<T> {
  const autoIndexFields = Object.entries(SUBSCRIPTION_INDEX_MAPPING.properties)
    .filter(([, mapping]) => mapping.type !== 'text') // keyword, float, boolean, date
    .map(([field]) => field);

  return new QueryOptimizer<T>(docs, {
    slowQueryThresholdMs: 50,
    maxSlowQueryRecords: 200,
    autoIndexFields,
  });
}
