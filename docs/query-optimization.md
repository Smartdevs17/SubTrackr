# Database Query Optimization — Index Analysis

## Overview

`backend/elasticsearch/queryOptimizer.ts` wraps the in-process subscription
index with a `QueryOptimizer` that:

- Intercepts every query and measures wall-clock latency.
- Classifies queries as **indexed** (O(log n) lookup) or **unindexed** (O(n)
  full scan).
- Maintains sorted `FieldIndex<T>` structures for the most-queried fields.
- Generates actionable `IndexRecommendation` objects ordered by priority.
- Exposes Prometheus-compatible metrics via `prometheusMetrics()`.

## Architecture

```
QuerySpec  →  QueryOptimizer.search()
                  │
                  ├─ FieldIndex hit?  ──Yes──→  O(log n) lookup
                  │                              usedIndex = true
                  └──────────No──────→  O(n) full scan
                                        usedIndex = false
                                        recommendation generated
```

## Field indexes

The `createSubscriptionQueryOptimizer()` factory automatically builds indexes
for all non-text fields from `SUBSCRIPTION_INDEX_MAPPING`:

| Field            | Type      | Index auto-built |
|------------------|-----------|-----------------|
| `category`       | keyword   | ✅              |
| `billingCycle`   | keyword   | ✅              |
| `currency`       | keyword   | ✅              |
| `price`          | float     | ✅              |
| `isActive`       | boolean   | ✅              |
| `isCryptoEnabled`| boolean   | ✅              |
| `nextBillingDate`| date      | ✅              |
| `createdAt`      | date      | ✅              |
| `customerName`   | text      | ❌ (full-text)  |
| `customerEmail`  | text      | ❌ (full-text)  |
| `planName`       | text      | ❌ (full-text)  |

Text fields are intentionally excluded — they use full-text search which
requires a different strategy (tokenization, fuzzy matching).

## Usage

```typescript
import { createSubscriptionQueryOptimizer } from './queryOptimizer';

const optimizer = createSubscriptionQueryOptimizer<Subscription>(initialDocs);

// Indexed lookup — O(log n)
const { results, plan } = optimizer.search({
  field: 'isActive',
  value: true,
  sortField: 'nextBillingDate',
  sortDirection: 'asc',
  limit: 20,
});

// Range query — O(log n + k)
const { results: expiring } = optimizer.search({
  field: 'nextBillingDate',
  value: undefined,
  range: { lte: Date.now() + 7 * 86_400_000 },
});

// Index a new document
optimizer.index('sub:99', newSubscription);

// Check index health
const report = optimizer.getIndexAnalysis();
console.log(`Hit rate: ${(report.overallHitRate * 100).toFixed(1)}%`);
console.log(`Recommendations: ${report.recommendations.length}`);

// Prometheus metrics
const metricsText = optimizer.prometheusMetrics();
```

## Index analysis report

`getIndexAnalysis()` returns:

```typescript
{
  totalQueries: number,
  indexedQueries: number,
  unindexedQueries: number,
  overallHitRate: number,      // 0–1
  avgLatencyMs: number,
  p95LatencyMs: number,
  p99LatencyMs: number,
  fieldStats: IndexStats[],    // per-field hit rates, sorted by query count
  recommendations: IndexRecommendation[],  // sorted by priority
  slowQueries: SlowQueryRecord[],          // last N slow queries
}
```

### Priority levels for recommendations

| Priority   | Condition                                         |
|------------|---------------------------------------------------|
| `critical` | ≥ 100 queries/field AND ≥ 1 000 docs              |
| `high`     | ≥ 50 queries/field                                |
| `medium`   | ≥ 10 queries/field                                |
| `low`      | < 10 queries/field                                |

## Prometheus metrics

Expose at `GET /metrics/es-query`:

```
subtrackr_es_query_total_queries
subtrackr_es_query_indexed_queries
subtrackr_es_query_unindexed_queries
subtrackr_es_query_index_hit_rate
subtrackr_es_query_avg_latency_ms
subtrackr_es_query_p95_latency_ms
subtrackr_es_query_p99_latency_ms
subtrackr_es_query_slow_queries
subtrackr_es_query_recommendation_count
subtrackr_es_query_document_count
subtrackr_es_query_index_count
subtrackr_es_query_field_hit_rate{field="isActive"}
...
```

## Performance benchmarks

| Scenario                          | Before (scan) | After (indexed) | Speedup |
|-----------------------------------|---------------|-----------------|---------|
| `isActive = true` on 10 000 docs  | ~5 ms         | < 0.1 ms        | ~50×    |
| `currency = "USD"` on 10 000 docs | ~5 ms         | < 0.1 ms        | ~50×    |
| Price range on 10 000 docs        | ~5 ms         | < 0.5 ms        | ~10×    |

Benchmarks measured in Node.js 20 on a standard laptop. Real-world speedup
depends on document count and cardinality.

## Running tests

```bash
npx jest --config jest.backend.config.js --testPathPatterns queryOptimizer
```
