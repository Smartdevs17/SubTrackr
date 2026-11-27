/**
 * backend/src/services/__tests__/search.test.ts
 *
 * Tests for the composable subscription-search filter DSL (issue #2257).
 */

import {
  parseFilterDsl,
  compileFilter,
  evaluateFilter,
  stringifyFilter,
  countPredicates,
  createSearchEngine,
  validateSearchConfig,
  SearchError,
  SearchErrorCode,
  FilterDslError,
  FilterDslErrorCode,
  FilterOp,
  FieldKind,
  DEFAULT_SEARCH_CONFIG,
  noopSearchMetrics,
  noopSearchLogger,
  type FilterExpr,
  type FilterPredicate,
  type SearchRecord,
  type SearchConfig,
  type SearchMetrics,
  type SearchLogger,
} from '../search';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const RECORDS: readonly SearchRecord[] = Object.freeze([
  Object.freeze({
    id: 'a1',
    name: 'Netflix Premium',
    provider: 'Netflix',
    status: 'active',
    amount: 15.49,
    category: 'streaming',
    cancelled: false,
    createdAt: '2026-01-10T00:00:00Z',
    tags: ['entertainment', 'video'],
    billing: Object.freeze({ amount: 15.49, currency: 'USD' }),
  }),
  Object.freeze({
    id: 'a2',
    name: 'Spotify',
    provider: 'Spotify',
    status: 'trialing',
    amount: 9.99,
    category: 'streaming',
    cancelled: false,
    createdAt: '2026-02-20T00:00:00Z',
    tags: ['music'],
    billing: Object.freeze({ amount: 9.99, currency: 'EUR' }),
  }),
  Object.freeze({
    id: 'a3',
    name: 'GitHub Copilot',
    provider: 'GitHub',
    status: 'active',
    amount: 10,
    category: 'developer',
    cancelled: false,
    createdAt: '2026-03-05T00:00:00Z',
    tags: ['code'],
    billing: Object.freeze({ amount: 10, currency: 'USD' }),
  }),
  Object.freeze({
    id: 'a4',
    name: 'Café ñ',
    provider: 'Café',
    status: 'cancelled',
    amount: 5,
    category: 'food',
    cancelled: true,
    createdAt: '2026-04-01T00:00:00Z',
    tags: ['drink'],
    billing: Object.freeze({ amount: 5, currency: 'USD' }),
  }),
]);

// ─── parseFilterDsl: happy path ──────────────────────────────────────────────

describe('parseFilterDsl', () => {
  it('parses a colon predicate', () => {
    const expr = parseFilterDsl('status:active') as FilterPredicate;
    expect(expr.field).toBe('status');
    expect(expr.op).toBe(FilterOp.EQ);
    expect(expr.value).toBe('active');
  });

  it('parses numeric and boolean comparisons', () => {
    const expr = parseFilterDsl('amount>100 AND cancelled:false') as { and: FilterPredicate[] };
    expect(expr.and).toHaveLength(2);
    expect(expr.and[0]!.op).toBe(FilterOp.GT);
    expect(expr.and[0]!.value).toBe(100);
    expect(expr.and[1]!.value).toBe(false);
  });

  it('parses OR, NOT and groups', () => {
    const expr = parseFilterDsl('(category:streaming OR category:developer) AND NOT status:cancelled');
    expect('and' in expr).toBe(true);
    expect(countPredicates(expr)).toBe(3);
  });

  it('parses word operators including contains and in', () => {
    const expr = parseFilterDsl('name contains Netflix') as FilterPredicate;
    expect(expr.op).toBe(FilterOp.CONTAINS);
    const listExpr = parseFilterDsl('status in [active, trialing]') as FilterPredicate;
    expect(listExpr.op).toBe(FilterOp.IN);
    expect(listExpr.value).toEqual(['active', 'trialing']);
  });

  it('parses quoted unicode values', () => {
    const expr = parseFilterDsl('name:"Café ñ"') as FilterPredicate;
    expect(expr.value).toBe('Café ñ');
  });

  it('parses dotted field paths', () => {
    const expr = parseFilterDsl('billing.amount>=10') as FilterPredicate;
    expect(expr.field).toBe('billing.amount');
    expect(expr.value).toBe(10);
  });

  it('parses implicit AND between predicates', () => {
    const expr = parseFilterDsl('status:active amount>10') as { and: FilterPredicate[] };
    expect('and' in expr).toBe(true);
    expect(expr.and).toHaveLength(2);
  });

  it('round-trips through stringifyFilter', () => {
    const text = 'status:active AND amount>100';
    expect(stringifyFilter(parseFilterDsl(text))).toBe('(status:active AND amount>100)');
  });
});

// ─── parseFilterDsl: failure modes ──────────────────────────────────────────

describe('parseFilterDsl errors', () => {
  it('rejects empty input', () => {
    try {
      parseFilterDsl('   ');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchError);
      expect((error as SearchError).code).toBe(SearchErrorCode.EMPTY_QUERY);
    }
  });

  it('rejects unknown fields', () => {
    try {
      parseFilterDsl('bogus:1');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as SearchError).code).toBe(SearchErrorCode.UNKNOWN_FIELD);
    }
  });

  it('rejects malformed syntax', () => {
    try {
      parseFilterDsl('status : ');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as SearchError).code).toBe(SearchErrorCode.SYNTAX_ERROR);
    }
  });

  it('rejects invalid numbers', () => {
    try {
      parseFilterDsl('amount>abc');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as SearchError).code).toBe(SearchErrorCode.INVALID_VALUE);
    }
  });

  it('rejects invalid booleans', () => {
    try {
      parseFilterDsl('cancelled:maybe');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as SearchError).code).toBe(SearchErrorCode.TYPE_MISMATCH);
    }
  });

  it('exposes FilterDslError alias', () => {
    expect(FilterDslError).toBe(SearchError);
    expect(FilterDslErrorCode).toBe(SearchErrorCode);
  });
});

// ─── compileFilter / evaluateFilter ─────────────────────────────────────────

describe('compileFilter and evaluateFilter', () => {
  it('evaluates a predicate against a record', () => {
    const compiled = compileFilter({ field: 'status', op: FilterOp.EQ, value: 'active' });
    expect(compiled(RECORDS[0]!)).toBe(true);
    expect(compiled(RECORDS[3]!)).toBe(false);
  });

  it('evaluateFilter accepts a compiled function', () => {
    const compiled = compileFilter({ field: 'amount', op: FilterOp.GT, value: 10 });
    expect(evaluateFilter(compiled, RECORDS[0]!)).toBe(true);
    expect(evaluateFilter(compiled, RECORDS[1]!)).toBe(false);
  });

  it('evaluates boolean combinations', () => {
    const expr: FilterExpr = {
      and: [
        { field: 'status', op: FilterOp.EQ, value: 'active' },
        { or: [
          { field: 'amount', op: FilterOp.GT, value: 12 },
          { field: 'amount', op: FilterOp.LT, value: 11 },
        ] },
      ],
    };
    expect(evaluateFilter(expr, RECORDS[0]!)).toBe(true);
    expect(evaluateFilter(expr, RECORDS[1]!)).toBe(false);
  });

  it('handles contains and startsWith', () => {
    expect(evaluateFilter({ field: 'name', op: FilterOp.CONTAINS, value: 'net' }, RECORDS[0]!)).toBe(true);
    expect(evaluateFilter({ field: 'name', op: FilterOp.STARTS_WITH, value: 'spot' }, RECORDS[1]!)).toBe(true);
  });

  it('handles in and notIn', () => {
    expect(evaluateFilter({ field: 'status', op: FilterOp.IN, value: ['active', 'trialing'] }, RECORDS[1]!)).toBe(true);
    expect(evaluateFilter({ field: 'status', op: FilterOp.NOT_IN, value: ['cancelled'] }, RECORDS[0]!)).toBe(true);
  });

  it('handles unicode and case-insensitive comparison', () => {
    expect(evaluateFilter({ field: 'name', op: FilterOp.EQ, value: 'CAFÉ Ñ' }, RECORDS[3]!)).toBe(true);
  });

  it('resolves dotted field paths', () => {
    expect(evaluateFilter({ field: 'billing.currency', op: FilterOp.EQ, value: 'eur' }, RECORDS[1]!)).toBe(true);
  });

  it('treats missing values as non-matching for eq', () => {
    expect(evaluateFilter({ field: 'name', op: FilterOp.EQ, value: 'x' }, {})).toBe(false);
  });

  it('validates unknown operators in structured expressions', () => {
    try {
      compileFilter({ field: 'status', op: 'bogus' as FilterOp, value: 'active' });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as SearchError).code).toBe(SearchErrorCode.UNKNOWN_OPERATOR);
    }
  });

  it('validates type mismatches in structured expressions', () => {
    try {
      compileFilter({ field: 'amount', op: FilterOp.EQ, value: 'not-a-number' });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as SearchError).code).toBe(SearchErrorCode.TYPE_MISMATCH);
    }
  });
});

// ─── Configuration ───────────────────────────────────────────────────────────

describe('validateSearchConfig', () => {
  it('returns frozen resolved config with defaults', () => {
    const cfg = validateSearchConfig();
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(cfg.maxDepth).toBe(DEFAULT_SEARCH_CONFIG.maxDepth);
  });

  it('rejects invalid maxDepth', () => {
    try {
      validateSearchConfig({ maxDepth: 0 });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as SearchError).code).toBe(SearchErrorCode.INVALID_CONFIG);
    }
  });

  it('rejects unknown sortField', () => {
    try {
      validateSearchConfig({ sortField: 'bogus' });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as SearchError).code).toBe(SearchErrorCode.INVALID_CONFIG);
    }
  });
});

// ─── createSearchEngine ──────────────────────────────────────────────────────

describe('createSearchEngine', () => {
  it('filters and sorts deterministically with an injectable clock', () => {
    let tick = 0;
    const engine = createSearchEngine({
      nowMs: () => {
        tick += 5;
        return tick;
      },
      sortField: 'amount',
      sortDirection: 'asc',
    });
    const result = engine.search(RECORDS, 'status:active');
    expect(result.matched).toBe(2);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]!.id).toBe('a3');
    expect(result.records[1]!.id).toBe('a1');
    expect(result.durationMs).toBe(5);
    expect(result.predicateCount).toBe(1);
  });

  it('supports DSL strings and structured expressions', () => {
    const engine = createSearchEngine({ sortField: null });
    expect(engine.search(RECORDS, 'cancelled:false').matched).toBe(3);
    expect(
      engine.search(RECORDS, { field: 'status', op: FilterOp.EQ, value: 'cancelled' }).matched
    ).toBe(1);
  });

  it('parse emits metrics through hooks', () => {
    const calls: Array<[number, number]> = [];
    const metrics: Partial<SearchMetrics> = {
      recordParse: (length: number, count: number) => calls.push([length, count]),
    };
    const engine = createSearchEngine({}, metrics);
    engine.parse('status:active');
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe(1);
  });

  it('search emits metrics and logs on success', () => {
    const events: string[] = [];
    const metrics: Partial<SearchMetrics> = {
      recordSearch: () => events.push('search'),
    };
    const logger: Partial<SearchLogger> = {
      info: () => events.push('info'),
      warn: () => events.push('warn'),
    };
    const engine = createSearchEngine({ sortField: null }, metrics, logger);
    engine.search(RECORDS, 'status:active');
    expect(events.indexOf('search') >= 0).toBe(true);
    expect(events.indexOf('info') >= 0).toBe(true);
  });

  it('emits empty-result metric and warning', () => {
    const events: string[] = [];
    const engine = createSearchEngine(
      { sortField: null },
      { recordEmptyResult: () => events.push('empty') },
      { warn: () => events.push('warn') }
    );
    const result = engine.search(RECORDS, 'status:nonexistent');
    expect(result.matched).toBe(0);
    expect(events).toEqual(['empty', 'warn']);
  });

  it('emits rejection metric and rethrows typed errors', () => {
    const events: string[] = [];
    const engine = createSearchEngine(
      {},
      { recordRejected: (code: string) => events.push(code) },
      { warn: () => events.push('warn') }
    );
    try {
      engine.search(RECORDS, 'bogus:1');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchError);
      expect((error as SearchError).code).toBe(SearchErrorCode.UNKNOWN_FIELD);
    }
    expect(events).toEqual([SearchErrorCode.UNKNOWN_FIELD, 'warn']);
  });

  it('evaluate works with expressions, DSL strings and compiled predicates', () => {
    const engine = createSearchEngine();
    expect(engine.evaluate('status:active', RECORDS[0]!)).toBe(true);
    const expr = parseFilterDsl('status:active');
    expect(engine.evaluate(expr, RECORDS[0]!)).toBe(true);
    const compiled = engine.compile(expr);
    expect(engine.evaluate(compiled, RECORDS[0]!)).toBe(true);
  });

  it('rejects non-array records', () => {
    const engine = createSearchEngine();
    try {
      engine.search(null as unknown as readonly SearchRecord[], 'status:active');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as SearchError).code).toBe(SearchErrorCode.INVALID_INPUT);
    }
  });

  it('exposes no-op hooks', () => {
    expect(() => noopSearchMetrics.recordSearch(1, 1, 1)).not.toThrow();
    expect(() => noopSearchLogger.info('x', {})).not.toThrow();
  });

  it('uses case-sensitive mode when configured', () => {
    const cfg: Partial<SearchConfig> = { caseSensitive: true, sortField: null };
    expect(evaluateFilter({ field: 'status', op: FilterOp.EQ, value: 'active' }, RECORDS[0]!, cfg)).toBe(true);
    expect(evaluateFilter({ field: 'status', op: FilterOp.EQ, value: 'ACTIVE' }, RECORDS[0]!, cfg)).toBe(false);
  });

  it('supports FieldKind vocabulary', () => {
    expect(FieldKind.STRING).toBe('string');
    expect(FieldKind.NUMBER).toBe('number');
  });
});
