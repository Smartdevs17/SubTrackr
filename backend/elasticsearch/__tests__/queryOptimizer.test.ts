/**
 * Unit tests for QueryOptimizer — ElasticSearch query optimisation layer.
 *
 * Run:
 *   npx jest --config jest.backend.config.js --testPathPatterns queryOptimizer
 */

import {
  QueryOptimizer,
  FieldIndex,
  createSubscriptionQueryOptimizer,
} from '../queryOptimizer';

// ─── FieldIndex ───────────────────────────────────────────────────────────────

interface Doc {
  id: string;
  userId?: string;
  price?: number;
  active?: boolean;
  createdAt?: number;
}

describe('FieldIndex', () => {
  it('returns empty array for unknown value', () => {
    const idx = new FieldIndex<Doc>('userId');
    expect(idx.get('u1')).toEqual([]);
  });

  it('upsert and get — exact match', () => {
    const idx = new FieldIndex<Doc>('userId');
    const doc: Doc = { id: '1', userId: 'u1' };
    idx.upsert(doc);
    expect(idx.get('u1')).toContain(doc);
  });

  it('get returns all docs with the same key', () => {
    const idx = new FieldIndex<Doc>('userId');
    const d1: Doc = { id: '1', userId: 'u1' };
    const d2: Doc = { id: '2', userId: 'u1' };
    const d3: Doc = { id: '3', userId: 'u2' };
    idx.upsert(d1);
    idx.upsert(d2);
    idx.upsert(d3);
    const results = idx.get('u1');
    expect(results).toHaveLength(2);
    expect(results).toContain(d1);
    expect(results).toContain(d2);
  });

  it('removes a document', () => {
    const idx = new FieldIndex<Doc>('userId');
    const doc: Doc = { id: '1', userId: 'u1' };
    idx.upsert(doc);
    idx.remove(doc);
    expect(idx.get('u1')).toHaveLength(0);
  });

  it('range returns docs within bounds', () => {
    const idx = new FieldIndex<Doc>('price');
    const docs: Doc[] = [
      { id: '1', price: 100 },
      { id: '2', price: 200 },
      { id: '3', price: 300 },
      { id: '4', price: 400 },
    ];
    docs.forEach((d) => idx.upsert(d));
    const result = idx.range(150, 350);
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.price).sort()).toEqual([200, 300]);
  });

  it('range with only gte', () => {
    const idx = new FieldIndex<Doc>('price');
    [{ id: '1', price: 50 }, { id: '2', price: 150 }].forEach((d) => idx.upsert(d));
    expect(idx.range(100, undefined)).toHaveLength(1);
  });

  it('range with only lte', () => {
    const idx = new FieldIndex<Doc>('price');
    [{ id: '1', price: 50 }, { id: '2', price: 150 }].forEach((d) => idx.upsert(d));
    expect(idx.range(undefined, 100)).toHaveLength(1);
  });

  it('size reflects document count', () => {
    const idx = new FieldIndex<Doc>('userId');
    expect(idx.size).toBe(0);
    idx.upsert({ id: '1', userId: 'u1' });
    idx.upsert({ id: '2', userId: 'u2' });
    expect(idx.size).toBe(2);
  });

  it('upsert updates an existing document in place', () => {
    const idx = new FieldIndex<Doc>('userId');
    const doc: Doc = { id: '1', userId: 'u1' };
    idx.upsert(doc);
    idx.upsert(doc); // same reference → update, not add
    expect(idx.size).toBe(1);
  });
});

// ─── QueryOptimizer — basic operations ───────────────────────────────────────

describe('QueryOptimizer — document management', () => {
  it('indexes and retrieves a document', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: ['userId'] });
    const doc: Doc = { id: '1', userId: 'u1' };
    opt.index('doc:1', doc);
    const { results } = opt.search({ field: 'userId', value: 'u1' });
    expect(results).toContain(doc);
  });

  it('deletes a document', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: ['userId'] });
    opt.index('doc:1', { id: '1', userId: 'u1' });
    opt.delete('doc:1');
    const { results } = opt.search({ field: 'userId', value: 'u1' });
    expect(results).toHaveLength(0);
  });

  it('delete returns false for unknown id', () => {
    const opt = new QueryOptimizer<Doc>();
    expect(opt.delete('nonexistent')).toBe(false);
  });

  it('size reflects indexed document count', () => {
    const opt = new QueryOptimizer<Doc>();
    expect(opt.size).toBe(0);
    opt.index('a', { id: 'a' });
    opt.index('b', { id: 'b' });
    expect(opt.size).toBe(2);
    opt.delete('a');
    expect(opt.size).toBe(1);
  });

  it('re-indexing a document updates it in field indexes', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: ['userId'] });
    opt.index('doc:1', { id: '1', userId: 'u1' });
    opt.index('doc:1', { id: '1', userId: 'u2' }); // update userId

    const { results: old } = opt.search({ field: 'userId', value: 'u1' });
    const { results: updated } = opt.search({ field: 'userId', value: 'u2' });
    expect(old).toHaveLength(0);
    expect(updated).toHaveLength(1);
  });
});

// ─── QueryOptimizer — search ──────────────────────────────────────────────────

describe('QueryOptimizer — search', () => {
  function buildOptimizer() {
    const opt = new QueryOptimizer<Doc>(undefined, {
      autoIndexFields: ['userId', 'price'],
      slowQueryThresholdMs: 1, // surface slow query records easily
    });
    opt.index('1', { id: '1', userId: 'u1', price: 10, active: true });
    opt.index('2', { id: '2', userId: 'u1', price: 20, active: false });
    opt.index('3', { id: '3', userId: 'u2', price: 30, active: true });
    return opt;
  }

  it('uses index for indexed fields', () => {
    const opt = buildOptimizer();
    const { results, plan } = opt.search({ field: 'userId', value: 'u1' });
    expect(plan.usedIndex).toBe(true);
    expect(results).toHaveLength(2);
  });

  it('falls back to full scan for unindexed fields', () => {
    const opt = buildOptimizer();
    const { results, plan } = opt.search({ field: 'active', value: true });
    expect(plan.usedIndex).toBe(false);
    expect(results).toHaveLength(2);
  });

  it('range query uses index', () => {
    const opt = buildOptimizer();
    const { results, plan } = opt.search({
      field: 'price',
      value: undefined,
      range: { gte: 15, lte: 25 },
    });
    expect(plan.usedIndex).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]?.price).toBe(20);
  });

  it('sorts results ascending', () => {
    const opt = buildOptimizer();
    const { results } = opt.search({
      field: 'userId',
      value: 'u1',
      sortField: 'price',
      sortDirection: 'asc',
    });
    expect(results[0]?.price).toBe(10);
    expect(results[1]?.price).toBe(20);
  });

  it('sorts results descending', () => {
    const opt = buildOptimizer();
    const { results } = opt.search({
      field: 'userId',
      value: 'u1',
      sortField: 'price',
      sortDirection: 'desc',
    });
    expect(results[0]?.price).toBe(20);
  });

  it('applies limit and offset', () => {
    const opt = buildOptimizer();
    const { results } = opt.search({
      field: 'userId',
      value: 'u1',
      limit: 1,
      offset: 0,
    });
    expect(results).toHaveLength(1);

    const { results: page2 } = opt.search({
      field: 'userId',
      value: 'u1',
      limit: 1,
      offset: 1,
    });
    expect(page2).toHaveLength(1);
    // The two pages should return different documents
    expect(results[0]?.id).not.toBe(page2[0]?.id);
  });

  it('full-text searchTerm on unindexed field', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: [] });
    opt.index('1', { id: '1', userId: 'alice-at-example' });
    opt.index('2', { id: '2', userId: 'bob-at-example' });

    const { results } = opt.search({ field: 'userId', value: undefined, searchTerm: 'alice' });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('1');
  });

  it('plan includes recommendation for unindexed field', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: [] });
    // Add enough docs to trigger a recommendation
    for (let i = 0; i < 20; i++) {
      opt.index(`${i}`, { id: `${i}`, userId: `u${i}` });
    }
    // Query the unindexed field enough times
    for (let i = 0; i < 15; i++) {
      opt.search({ field: 'userId', value: 'u1' });
    }
    const { plan } = opt.search({ field: 'userId', value: 'u1' });
    expect(plan.usedIndex).toBe(false);
    expect(plan.recommendation).toBeDefined();
    expect(plan.recommendation?.field).toBe('userId');
    expect(plan.recommendation?.priority).toMatch(/critical|high|medium/);
  });
});

// ─── QueryOptimizer — index management ───────────────────────────────────────

describe('QueryOptimizer — index management', () => {
  it('createIndex builds a covering index for existing docs', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: [] });
    opt.index('1', { id: '1', userId: 'u1' });
    opt.index('2', { id: '2', userId: 'u2' });

    // No index yet — full scan
    const { plan: before } = opt.search({ field: 'userId', value: 'u1' });
    expect(before.usedIndex).toBe(false);

    // Create index
    opt.createIndex('userId');

    // Now uses index
    const { plan: after } = opt.search({ field: 'userId', value: 'u1' });
    expect(after.usedIndex).toBe(true);
  });

  it('createIndex is idempotent', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: ['userId'] });
    opt.createIndex('userId'); // second call should not throw
    expect(opt.listIndexes()).toContain('userId');
  });

  it('dropIndex removes the index and falls back to scan', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: ['userId'] });
    opt.index('1', { id: '1', userId: 'u1' });

    opt.dropIndex('userId');
    const { plan } = opt.search({ field: 'userId', value: 'u1' });
    expect(plan.usedIndex).toBe(false);
  });

  it('listIndexes returns all active indexes', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: ['userId', 'price'] });
    expect(opt.listIndexes()).toEqual(expect.arrayContaining(['userId', 'price']));
  });
});

// ─── QueryOptimizer — index analysis ─────────────────────────────────────────

describe('QueryOptimizer — getIndexAnalysis', () => {
  it('returns zeroed metrics when no queries have run', () => {
    const opt = new QueryOptimizer<Doc>();
    const report = opt.getIndexAnalysis();
    expect(report.totalQueries).toBe(0);
    expect(report.indexedQueries).toBe(0);
    expect(report.unindexedQueries).toBe(0);
    expect(report.overallHitRate).toBe(0);
  });

  it('tracks indexed vs unindexed queries correctly', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: ['userId'] });
    opt.index('1', { id: '1', userId: 'u1', active: true });

    opt.search({ field: 'userId', value: 'u1' }); // indexed
    opt.search({ field: 'active', value: true });  // unindexed

    const report = opt.getIndexAnalysis();
    expect(report.totalQueries).toBe(2);
    expect(report.indexedQueries).toBe(1);
    expect(report.unindexedQueries).toBe(1);
    expect(report.overallHitRate).toBe(0.5);
  });

  it('includes fieldStats sorted by queryCount descending', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: ['userId'] });
    opt.index('1', { id: '1', userId: 'u1', active: true });

    // Query userId 3 times, active once
    for (let i = 0; i < 3; i++) opt.search({ field: 'userId', value: 'u1' });
    opt.search({ field: 'active', value: true });

    const report = opt.getIndexAnalysis();
    expect(report.fieldStats[0]?.field).toBe('userId');
    expect(report.fieldStats[0]?.queryCount).toBe(3);
  });

  it('includes recommendations for unindexed frequently-queried fields', () => {
    const opt = new QueryOptimizer<Doc>(undefined, {
      autoIndexFields: [],
      slowQueryThresholdMs: 1,
    });
    for (let i = 0; i < 100; i++) opt.index(`${i}`, { id: `${i}`, userId: `u${i % 5}` });
    for (let i = 0; i < 60; i++) opt.search({ field: 'userId', value: 'u1' });

    const report = opt.getIndexAnalysis();
    const rec = report.recommendations.find((r) => r.field === 'userId');
    expect(rec).toBeDefined();
    expect(rec?.priority).toMatch(/critical|high/);
    expect(rec?.estimatedSpeedup).toBeGreaterThan(1);
  });

  it('resetMetrics clears counters', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: ['userId'] });
    opt.index('1', { id: '1', userId: 'u1' });
    opt.search({ field: 'userId', value: 'u1' });

    opt.resetMetrics();
    const report = opt.getIndexAnalysis();
    expect(report.totalQueries).toBe(0);
  });
});

// ─── QueryOptimizer — Prometheus metrics ─────────────────────────────────────

describe('QueryOptimizer — prometheusMetrics', () => {
  it('produces valid Prometheus text format', () => {
    const opt = new QueryOptimizer<Doc>(undefined, { autoIndexFields: ['userId'] });
    opt.index('1', { id: '1', userId: 'u1' });
    opt.search({ field: 'userId', value: 'u1' });

    const text = opt.prometheusMetrics();
    expect(text).toContain('subtrackr_es_query_total_queries');
    expect(text).toContain('subtrackr_es_query_index_hit_rate');
    expect(text).toContain('subtrackr_es_query_document_count');
  });

  it('respects custom namespace', () => {
    const opt = new QueryOptimizer<Doc>();
    expect(opt.prometheusMetrics('myns')).toContain('myns_total_queries');
  });
});

// ─── createSubscriptionQueryOptimizer ────────────────────────────────────────

describe('createSubscriptionQueryOptimizer', () => {
  it('creates indexes for keyword/float/boolean/date fields', () => {
    const opt = createSubscriptionQueryOptimizer();
    const indexes = opt.listIndexes();
    // keyword fields from SUBSCRIPTION_INDEX_MAPPING
    expect(indexes).toContain('category');
    expect(indexes).toContain('billingCycle');
    expect(indexes).toContain('currency');
    // float
    expect(indexes).toContain('price');
    // boolean
    expect(indexes).toContain('isActive');
    // dates
    expect(indexes).toContain('nextBillingDate');
  });

  it('does NOT create indexes for text fields', () => {
    const opt = createSubscriptionQueryOptimizer();
    const indexes = opt.listIndexes();
    // text fields should NOT have indexes (full-text search handled differently)
    expect(indexes).not.toContain('customerName');
    expect(indexes).not.toContain('notes');
  });

  it('pre-populates from provided docs', () => {
    const docs = new Map<string, Record<string, unknown>>();
    docs.set('s:1', { id: 's1', category: 'saas', price: 99 });
    const opt = createSubscriptionQueryOptimizer(docs);
    expect(opt.size).toBe(1);
    const { results } = opt.search({ field: 'category', value: 'saas' });
    expect(results).toHaveLength(1);
  });
});
