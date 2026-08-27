/**
 * Query Optimizer with Index Analysis — SubTrackr
 *
 * Provides query analysis, index recommendation, and performance
 * monitoring for database queries.
 */

export interface QueryAnalysis {
  query: string;
  tables: string[];
  hasIndex: boolean;
  scanType: 'index' | 'sequential' | 'unknown';
  estimatedRows: number;
  issues: QueryIssue[];
  recommendations: IndexRecommendation[];
  score: number;
}

export interface QueryIssue {
  type: 'missing_index' | 'full_scan' | 'n_plus_one' | 'cartesian_join' | 'select_star' | 'or_condition' | 'function_on_column' | 'implicit_cast';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  suggestion: string;
}

export interface IndexRecommendation {
  table: string;
  columns: string[];
  type: 'btree' | 'hash' | 'gin' | 'gist';
  reason: string;
  estimatedImprovement: string;
  createStatement: string;
}

export interface TableStats {
  tableName: string;
  rowCount: number;
  avgRowSize: number;
  indexCount: number;
  seqScans: number;
  idxScans: number;
  lastVacuum: string | null;
  lastAnalyze: string | null;
}

export interface IndexStats {
  indexName: string;
  tableName: string;
  columns: string[];
  type: string;
  sizeBytes: number;
  scans: number;
  tuplesRead: number;
  tuplesFetched: number;
}

const KNOWN_SLOW_PATTERNS = [
  { pattern: /SELECT\s+\*/gi, issue: 'select_star' as const, severity: 'medium' as const, message: 'SELECT * retrieves all columns', suggestion: 'Select only needed columns' },
  { pattern: /LIKE\s+['"]%/gi, issue: 'function_on_column' as const, severity: 'medium' as const, message: 'Leading wildcard in LIKE prevents index usage', suggestion: 'Use full-text search or suffix indexing instead' },
  { pattern: /OR\s+1\s*=\s*1/gi, issue: 'or_condition' as const, severity: 'high' as const, message: 'Always-true OR condition detected', suggestion: 'Review query logic' },
  { pattern: /ORDER\s+BY\s+.*\b(LIMIT\s+\d+\s*,\s*\d+|OFFSET\s+\d+)/gi, issue: 'n_plus_one' as const, severity: 'medium' as const, message: 'OFFSET pagination degrades with large offsets', suggestion: 'Use cursor-based pagination' },
];

function extractTables(query: string): string[] {
  const tables = new Set<string>();
  const fromMatch = query.match(/FROM\s+(\w+)/gi);
  const joinMatch = query.match(/JOIN\s+(\w+)/gi);

  if (fromMatch) {
    for (const match of fromMatch) {
      const table = match.replace(/FROM\s+/i, '').trim();
      if (table && !table.startsWith('(')) tables.add(table.toLowerCase());
    }
  }

  if (joinMatch) {
    for (const match of joinMatch) {
      const table = match.replace(/JOIN\s+/i, '').trim();
      if (table && !table.startsWith('(')) tables.add(table.toLowerCase());
    }
  }

  return Array.from(tables);
}

function hasWhereClause(query: string): boolean {
  return /\bWHERE\b/i.test(query);
}

function hasLimitClause(query: string): boolean {
  return /\bLIMIT\b/i.test(query);
}

function hasOrderByIndex(query: string, columns: string[]): boolean {
  const orderByMatch = query.match(/ORDER\s+BY\s+([\w\s,.-]+)/i);
  if (!orderByMatch) return false;
  const orderCols = orderByMatch[1].split(',').map((c) => c.trim().split(/\s+/)[0].toLowerCase());
  return orderCols.some((col) => columns.includes(col));
}

export class QueryOptimizer {
  private knownIndexes = new Map<string, IndexStats[]>();
  private queryLog: { query: string; durationMs: number; timestamp: number }[] = [];

  analyzeQuery(query: string): QueryAnalysis {
    const normalizedQuery = query.trim();
    const tables = extractTables(normalizedQuery);
    const issues: QueryIssue[] = [];
    const recommendations: IndexRecommendation[] = [];

    for (const { pattern, issue, severity, message, suggestion } of KNOWN_SLOW_PATTERNS) {
      if (pattern.test(normalizedQuery)) {
        issues.push({ type: issue, severity, message, suggestion });
      }
    }

    if (!hasWhereClause(normalizedQuery) && tables.length > 0) {
      issues.push({
        type: 'full_scan',
        severity: 'high',
        message: 'Query has no WHERE clause - will perform full table scan',
        suggestion: 'Add a WHERE clause to filter results',
      });
    }

    if (tables.length === 0 && !hasLimitClause(normalizedQuery)) {
      issues.push({
        type: 'n_plus_one',
        severity: 'low',
        message: 'Query lacks LIMIT clause',
        suggestion: 'Add LIMIT to prevent unbounded result sets',
      });
    }

    for (const table of tables) {
      const indexes = this.knownIndexes.get(table) ?? [];
      if (indexes.length === 0) {
        const whereMatch = normalizedQuery.match(new RegExp(`WHERE\\s+(\\w+)`, 'i'));
        if (whereMatch) {
          const column = whereMatch[1].toLowerCase();
          recommendations.push({
            table,
            columns: [column],
            type: 'btree',
            reason: `No indexes found on table "${table}" for WHERE clause column "${column}"`,
            estimatedImprovement: 'Query time reduced from sequential scan to index lookup',
            createStatement: `CREATE INDEX idx_${table}_${column} ON ${table} (${column});`,
          });
        }
      }
    }

    const criticalCount = issues.filter((i) => i.severity === 'critical' || i.severity === 'high').length;
    const mediumCount = issues.filter((i) => i.severity === 'medium').length;
    const score = Math.max(0, 100 - criticalCount * 30 - mediumCount * 10 - issues.length * 5);

    return {
      query: normalizedQuery,
      tables,
      hasIndex: tables.every((t) => (this.knownIndexes.get(t) ?? []).length > 0),
      scanType: tables.every((t) => (this.knownIndexes.get(t) ?? []).length > 0) ? 'index' : 'sequential',
      estimatedRows: 0,
      issues,
      recommendations,
      score,
    };
  }

  registerIndex(table: string, index: IndexStats): void {
    const existing = this.knownIndexes.get(table) ?? [];
    existing.push(index);
    this.knownIndexes.set(table, existing);
  }

  logQuery(query: string, durationMs: number): void {
    this.queryLog.push({ query, durationMs, timestamp: Date.now() });
    if (this.queryLog.length > 10000) {
      this.queryLog = this.queryLog.slice(-5000);
    }
  }

  getSlowQueries(thresholdMs: number = 1000): { query: string; durationMs: number; timestamp: number }[] {
    return this.queryLog.filter((q) => q.durationMs > thresholdMs).sort((a, b) => b.durationMs - a.durationMs);
  }

  getQueryStats(): {
    totalQueries: number;
    avgDurationMs: number;
    p95DurationMs: number;
    slowQueryCount: number;
  } {
    if (this.queryLog.length === 0) {
      return { totalQueries: 0, avgDurationMs: 0, p95DurationMs: 0, slowQueryCount: 0 };
    }

    const durations = this.queryLog.map((q) => q.durationMs).sort((a, b) => a - b);
    const total = durations.reduce((a, b) => a + b, 0);
    const p95Index = Math.floor(durations.length * 0.95);

    return {
      totalQueries: this.queryLog.length,
      avgDurationMs: Math.round(total / durations.length),
      p95DurationMs: durations[p95Index],
      slowQueryCount: this.queryLog.filter((q) => q.durationMs > 1000).length,
    };
  }

  getIndexRecommendations(): IndexRecommendation[] {
    const recommendations: IndexRecommendation[] = [];

    for (const slowQuery of this.getSlowQueries()) {
      const analysis = this.analyzeQuery(slowQuery.query);
      recommendations.push(...analysis.recommendations);
    }

    const seen = new Set<string>();
    return recommendations.filter((r) => {
      const key = `${r.table}:${r.columns.join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

export const queryOptimizer = new QueryOptimizer();
