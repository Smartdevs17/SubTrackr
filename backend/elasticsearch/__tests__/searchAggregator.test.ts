/**
 * Tests for Issue #916 — Advanced Search Aggregator, FacetManager, AutoComplete.
 */

import {
  SubscriptionSearchAggregator,
  SearchFacetManager,
  SearchAutoComplete,
  advancedSearchService,
} from '../searchService';

// ── Mock the underlying AdvancedSearchService ────────────────────────────

const mockSearch = jest.fn();
const mockGetSuggestions = jest.fn();

jest.mock('../searchService', () => {
  const original = jest.requireActual('../searchService');
  return {
    ...original,
    advancedSearchService: {
      search: (...args: unknown[]) => mockSearch(...args),
      getSuggestions: (...args: unknown[]) => mockGetSuggestions(...args),
    },
  };
});

// ── Fixture subscriptions ─────────────────────────────────────────────────

const makeSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: `sub_${Math.random().toString(36).slice(2)}`,
  name: 'Test Service',
  category: 'productivity',
  billingCycle: 'monthly',
  price: '9.99',
  status: 'active',
  ...overrides,
});

const baseResult = {
  items: [
    makeSubscription({ category: 'productivity', billingCycle: 'monthly', status: 'active' }),
    makeSubscription({ category: 'streaming', billingCycle: 'annual', status: 'active' }),
    makeSubscription({ category: 'productivity', billingCycle: 'monthly', status: 'paused' }),
  ],
  total: 3,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

// ── SubscriptionSearchAggregator ──────────────────────────────────────────

describe('SubscriptionSearchAggregator', () => {
  let aggregator: SubscriptionSearchAggregator;

  beforeEach(() => {
    mockSearch.mockClear();
    mockGetSuggestions.mockClear();
    mockSearch.mockResolvedValue(baseResult);
    mockGetSuggestions.mockResolvedValue([]);
    aggregator = new SubscriptionSearchAggregator(advancedSearchService as never);
  });

  it('should return facets with correct counts', async () => {
    const result = await aggregator.searchWithFacets({ query: 'test' });

    const categoryFacet = result.facets.find((f) => f.field === 'category');
    expect(categoryFacet).toBeDefined();

    const productivityBucket = categoryFacet!.buckets.find((b) => b.value === 'productivity');
    expect(productivityBucket?.count).toBe(2);

    const streamingBucket = categoryFacet!.buckets.find((b) => b.value === 'streaming');
    expect(streamingBucket?.count).toBe(1);
  });

  it('should narrow results by category filter', async () => {
    const result = await aggregator.searchWithFacets(
      { query: 'test' },
      { categories: ['streaming' as never] }
    );

    expect(result.hits.items).toHaveLength(1);
    expect(result.hits.items[0].category).toBe('streaming');
    expect(result.totalHits).toBe(1);
  });

  it('should narrow results by status filter', async () => {
    const result = await aggregator.searchWithFacets(
      { query: '' },
      { statuses: ['paused'] }
    );

    expect(result.hits.items).toHaveLength(1);
    expect(result.hits.items[0].status).toBe('paused');
  });

  it('should narrow results by price range', async () => {
    mockSearch.mockResolvedValue({
      ...baseResult,
      items: [
        makeSubscription({ price: '5.00' }),
        makeSubscription({ price: '15.00' }),
        makeSubscription({ price: '25.00' }),
      ],
    });

    const result = await aggregator.searchWithFacets(
      { query: '' },
      { priceRange: { min: 10, max: 20 } }
    );

    expect(result.hits.items).toHaveLength(1);
    expect(result.hits.items[0].price).toBe('15.00');
  });

  it('should populate suggestions from the service', async () => {
    const mockSuggestions = [{ source: 'index', label: 'Netflix', value: 'netflix' }];
    mockGetSuggestions.mockResolvedValue(mockSuggestions);

    const result = await aggregator.searchWithFacets({ query: 'net' });

    expect(result.suggestions).toEqual(mockSuggestions);
  });

  it('should include facets for billing cycle', async () => {
    const result = await aggregator.searchWithFacets({ query: '' });

    const cycleFacet = result.facets.find((f) => f.field === 'billingCycle');
    expect(cycleFacet).toBeDefined();

    const monthlyBucket = cycleFacet!.buckets.find((b) => b.value === 'monthly');
    expect(monthlyBucket?.count).toBe(2);
  });

  it('should record query time', async () => {
    const result = await aggregator.searchWithFacets({ query: 'perf' });
    expect(result.queryTimeMs).toBeGreaterThanOrEqual(0);
  });
});

// ── SearchFacetManager ────────────────────────────────────────────────────

describe('SearchFacetManager', () => {
  let manager: SearchFacetManager;

  beforeEach(() => {
    manager = new SearchFacetManager();
  });

  it('should start with empty filters', () => {
    expect(manager.hasActiveFilters()).toBe(false);
    expect(manager.activeFilterCount()).toBe(0);
  });

  it('should toggle category on and off', () => {
    manager.toggleCategory('productivity' as never);
    expect(manager.getFilters().categories).toContain('productivity');

    manager.toggleCategory('productivity' as never);
    expect(manager.getFilters().categories).not.toContain('productivity');
  });

  it('should toggle billing cycle', () => {
    manager.toggleBillingCycle('monthly' as never);
    expect(manager.getFilters().billingCycles).toContain('monthly');
  });

  it('should toggle status', () => {
    manager.toggleStatus('paused');
    expect(manager.getFilters().statuses).toContain('paused');

    manager.toggleStatus('paused');
    expect(manager.getFilters().statuses).not.toContain('paused');
  });

  it('should set and clear price range', () => {
    manager.setPriceRange(5, 50);
    expect(manager.getFilters().priceRange).toEqual({ min: 5, max: 50 });

    manager.setPriceRange(undefined, undefined);
    expect(manager.getFilters().priceRange).toBeUndefined();
  });

  it('should count active filters correctly', () => {
    manager.toggleCategory('productivity' as never);
    manager.toggleCategory('streaming' as never);
    manager.toggleStatus('active');
    manager.setPriceRange(0, 100);

    expect(manager.activeFilterCount()).toBe(4);
  });

  it('should clear all filters', () => {
    manager.toggleCategory('productivity' as never);
    manager.toggleStatus('active');
    manager.clearFilters();

    expect(manager.hasActiveFilters()).toBe(false);
  });
});

// ── SearchAutoComplete ────────────────────────────────────────────────────

describe('SearchAutoComplete', () => {
  let autoComplete: SearchAutoComplete;

  beforeEach(() => {
    mockGetSuggestions.mockClear();
    mockSearch.mockClear();
    mockGetSuggestions.mockResolvedValue([
      { source: 'index', label: 'Netflix', value: 'netflix' },
    ]);
    autoComplete = new SearchAutoComplete(advancedSearchService as never, 500);
  });

  it('should return suggestions for a valid prefix', async () => {
    const suggestions = await autoComplete.getSuggestions('net');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].value).toBe('netflix');
  });

  it('should return an empty array for an empty prefix', async () => {
    const suggestions = await autoComplete.getSuggestions('');
    expect(suggestions).toHaveLength(0);
    expect(mockGetSuggestions).not.toHaveBeenCalled();
  });

  it('should cache results and avoid duplicate API calls', async () => {
    await autoComplete.getSuggestions('net');
    await autoComplete.getSuggestions('net');

    expect(mockGetSuggestions).toHaveBeenCalledTimes(1);
  });

  it('should re-fetch after cache TTL expires', async () => {
    // Create an instance with a 1 ms TTL so the cache expires immediately.
    const shortTtl = new SearchAutoComplete(advancedSearchService as never, 1);
    mockGetSuggestions.mockResolvedValue([]);

    await shortTtl.getSuggestions('net');
    await new Promise((r) => setTimeout(r, 5));
    await shortTtl.getSuggestions('net');

    expect(mockGetSuggestions).toHaveBeenCalledTimes(2);
  });

  it('should evict expired cache entries', async () => {
    const shortTtl = new SearchAutoComplete(advancedSearchService as never, 1);
    await shortTtl.getSuggestions('abc');
    await new Promise((r) => setTimeout(r, 5));

    const evicted = shortTtl.evictExpired();
    expect(evicted).toBe(1);
  });

  it('should clear the cache on invalidate', async () => {
    await autoComplete.getSuggestions('net');
    autoComplete.invalidate();

    await autoComplete.getSuggestions('net');

    expect(mockGetSuggestions).toHaveBeenCalledTimes(2);
  });
});
