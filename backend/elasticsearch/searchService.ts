/**
 * Elasticsearch search service — SubTrackr.
 *
 * Issue #916: Advanced search for subscriptions with Elasticsearch.
 *
 * Production-grade search layer built on top of the in-process index
 * (`ElasticsearchService`) that mirrors a remote ELK cluster. It:
 *
 *  - routes every search/index operation through the connection pool so the
 *    work is visible in cluster metrics and tuning reports,
 *  - exposes read routing (replica-preferred) and write routing (primary),
 *  - keeps subscription documents searchable across CRM, plan, category,
 *    billing-cycle, pricing and status facets,
 *  - maintains saved searches with new-match detection,
 *  - emits a cluster health / diagnostics snapshot for ops.
 */

import { Subscription, SubscriptionCategory, BillingCycle } from '../../src/types/subscription';
import {
  ElasticsearchService,
  type SearchAnalyticsEvent,
  type SearchQuery,
  type SearchResult,
  type SavedSearchDefinition,
  type SavedSearchMatchNotification,
} from '../services/search/ElasticsearchService';
import { DEFAULT_ES_CONFIG, type ElasticsearchConfig } from './config';
import {
  ElasticsearchConnectionPool,
  getDefaultPool,
  type ConnectionPoolConfig,
} from './connectionPool';

export type {
  SearchQuery,
  SearchResult,
  SavedSearchDefinition,
  SavedSearchMatchNotification,
  SearchAnalyticsEvent,
};

export interface SearchClusterHealth {
  status: 'green' | 'yellow' | 'red';
  documents: number;
  indexLagMs: number;
  pool: {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    peakUtilisation: number;
    acquireTimeouts: number;
    leaksDetected: number;
  };
  tuning: string[];
  updatedAt: string;
}

export interface AdvancedSearchSuggestion {
  source: 'index' | 'category' | 'top-query' | 'plan';
  label: string;
  value: string;
}

export interface AdvancedSearchOptions {
  /** Read from replicas when the pool has them; default true. */
  readOnly?: boolean;
}

const SUGGESTION_LIMIT = 8;

function normalizeForSuggestions(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * Search service facade for subscription search, backed by a connection pool.
 *
 * The service is intentionally small: heavy lifting (scoring, facets, saved
 * searches, analytics) stays in `ElasticsearchService`; this layer owns the
 * cluster lifecycle and the read/write routing story.
 */
export class AdvancedSearchService {
  private readonly peer: ElasticsearchService;
  private readonly pool: ElasticsearchConnectionPool;
  private readonly config: ElasticsearchConfig;

  constructor(options?: {
    peer?: ElasticsearchService;
    pool?: ElasticsearchConnectionPool;
    config?: ElasticsearchConfig;
  }) {
    this.config = options?.config ?? DEFAULT_ES_CONFIG;
    this.peer = options?.peer ?? new ElasticsearchService(this.config);
    this.pool =
      options?.pool ??
      (() => {
        const poolConfig: ConnectionPoolConfig | undefined = this.config.pool;
        if (poolConfig) {
          return getDefaultPool(poolConfig);
        }
        throw new Error(
          'AdvancedSearchService: no connection pool available. Provide a pool or config.pool.'
        );
      })();
  }

  // ── Index management (writes route to primary) ───────────────────────────

  indexDocument(subscription: Subscription): Promise<void> {
    return this.pool.withConnection(async () => {
      this.peer.indexDocument(subscription);
    });
  }

  bulkIndex(subscriptions: Subscription[]): Promise<void> {
    return this.pool.withConnection(async () => {
      this.peer.bulkIndex(subscriptions);
    });
  }

  reindexForSchemaChange(subscriptions: Subscription[]): Promise<void> {
    return this.pool.withConnection(async () => {
      this.peer.reindexForSchemaChange(subscriptions);
    });
  }

  deleteDocument(id: string): Promise<void> {
    return this.pool.withConnection(async () => {
      this.peer.deleteDocument(id);
    });
  }

  get documentCount(): number {
    return this.peer.documentCount;
  }

  // ── Search (reads prefer replicas) ───────────────────────────────────────

  search(query: SearchQuery, options?: AdvancedSearchOptions): Promise<SearchResult> {
    const readOnly = options?.readOnly ?? true;
    return this.pool.withConnection(async () => this.peer.search(query), readOnly);
  }

  // ── Suggestions ──────────────────────────────────────────────────────────

  /**
   * Build a ranked suggestion list from the indexed documents, the category
   * vocabulary, top queries and plan names.
   */
  async suggest(partial: string): Promise<AdvancedSearchSuggestion[]> {
    const q = normalizeForSuggestions(partial);
    if (!q) return [];

    const readOnly = true;
    return this.pool.withConnection(
      async () => {
        const suggestions = new Map<string, AdvancedSearchSuggestion>();
        const add = (label: string, value: string, source: AdvancedSearchSuggestion['source']) => {
          const key = `${source}:${normalizeForSuggestions(value)}`;
          if (!suggestions.has(key)) {
            suggestions.set(key, { label, value, source });
          }
        };

        // Candidate fields from the indexed source.
        const fields = ['customerName', 'customerEmail', 'planName', 'name', 'notes', 'description'];
        for (const doc of this.allDocs()) {
          for (const field of fields) {
            const value = (doc as unknown as Record<string, unknown>)[field];
            if (typeof value === 'string' && normalizeForSuggestions(value).includes(q)) {
              add(value, value, field === 'planName' ? 'plan' : 'index');
            }
          }
        }

        for (const category of Object.values(SubscriptionCategory)) {
          if (normalizeForSuggestions(category).includes(q)) {
            add(category, category, 'category');
          }
        }

        for (const top of this.peer.getTopQueries(5)) {
          if (normalizeForSuggestions(top.query).includes(q)) {
            add(top.query, top.query, 'top-query');
          }
        }

        return Array.from(suggestions.values()).slice(0, SUGGESTION_LIMIT);
      },
      readOnly
    );
  }

  private allDocs(): Subscription[] {
    // The peer exposes its source documents through a lightweight search with
    // no query, which returns every indexed subscription.
    const result = this.peer.search({ size: this.config.maxResults });
    return result.hits.map((hit) => hit.subscription);
  }

  // ── Saved searches ───────────────────────────────────────────────────────

  registerSavedSearch(savedSearch: SavedSearchDefinition): Promise<void> {
    return this.pool.withConnection(async () => {
      this.peer.registerSavedSearch(savedSearch);
    });
  }

  removeSavedSearch(id: string): Promise<void> {
    return this.pool.withConnection(async () => {
      this.peer.removeSavedSearch(id);
    });
  }

  loadSavedSearches(savedSearches: SavedSearchDefinition[]): Promise<void> {
    return this.pool.withConnection(async () => {
      this.peer.loadSavedSearches(savedSearches);
    });
  }

  listSavedSearches(): Promise<SavedSearchDefinition[]> {
    return this.pool.withConnection(async () => this.peer.listSavedSearches(), true);
  }

  checkSavedSearchNotifications(): Promise<SavedSearchMatchNotification[]> {
    return this.pool.withConnection(
      async () => this.peer.checkSavedSearchNotifications(),
      true
    );
  }

  // ── Analytics ────────────────────────────────────────────────────────────

  getTopQueries(limit = 10): { query: string; count: number }[] {
    return this.peer.getTopQueries(limit);
  }

  getAnalyticsEvents(): SearchAnalyticsEvent[] {
    return this.peer.getAnalyticsEvents();
  }

  clearAnalytics(): void {
    this.peer.clearAnalytics();
  }

  // ── Cluster health / diagnostics ─────────────────────────────────────────

  async health(): Promise<SearchClusterHealth> {
    const pool = await this.pool.withConnection(async () => this.pool.getMetrics(), true);
    return {
      status: pool.totalConnections > 0 && pool.acquireTimeouts === 0 ? 'green' : 'yellow',
      documents: this.peer.documentCount,
      indexLagMs: this.peer.getIndexLagMs(),
      pool: {
        totalConnections: pool.totalConnections,
        activeConnections: pool.activeConnections,
        idleConnections: pool.idleConnections,
        peakUtilisation: pool.peakUtilisation,
        acquireTimeouts: pool.acquireTimeouts,
        leaksDetected: pool.leaksDetected,
      },
      tuning: this.pool.getTuningRecommendations(),
      updatedAt: new Date().toISOString(),
    };
  }
}

export const advancedSearchService = new AdvancedSearchService();

export const getSuggestionLabel = (suggestion: AdvancedSearchSuggestion): string =>
  suggestion.label;

export const isCategorySuggestion = (suggestion: AdvancedSearchSuggestion): boolean =>
  suggestion.source === 'category';

export const getBillingCycleOptions = (): BillingCycle[] => Object.values(BillingCycle);

// ═══════════════════════════════════════════════════════════════════════════
// Issue #916 — Advanced Search for Subscriptions with Elasticsearch
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A single facet bucket with its label, value and hit count.
 */
export interface SearchFacetBucket {
  label: string;
  value: string;
  count: number;
}

/**
 * A named facet (e.g. "Category", "Billing cycle") with its buckets.
 */
export interface SearchFacet {
  name: string;
  field: string;
  buckets: SearchFacetBucket[];
}

/**
 * Aggregated search result that combines the raw hits with facets and metrics.
 */
export interface AggregatedSearchResult {
  hits: SearchResult;
  facets: SearchFacet[];
  totalHits: number;
  queryTimeMs: number;
  suggestions: AdvancedSearchSuggestion[];
}

/**
 * Search filter used by the aggregator to refine results.
 */
export interface SearchFilterSet {
  categories?: SubscriptionCategory[];
  billingCycles?: BillingCycle[];
  statuses?: string[];
  priceRange?: { min?: number; max?: number };
  tags?: string[];
}

/**
 * Wraps the `AdvancedSearchService` to add faceting, aggregation and
 * filter-based narrowing.
 *
 * All methods route through the existing connection-pool-backed service so
 * they benefit from the same resilience and metrics as direct searches.
 */
export class SubscriptionSearchAggregator {
  private static instance: SubscriptionSearchAggregator;
  private readonly searchService: AdvancedSearchService;

  constructor(service: AdvancedSearchService = advancedSearchService) {
    this.searchService = service;
  }

  static getInstance(): SubscriptionSearchAggregator {
    if (!SubscriptionSearchAggregator.instance) {
      SubscriptionSearchAggregator.instance = new SubscriptionSearchAggregator();
    }
    return SubscriptionSearchAggregator.instance;
  }

  /**
   * Execute a search and compute facets in one pass.
   *
   * @param query   Search query forwarded to Elasticsearch.
   * @param filters Optional filter set to narrow results before faceting.
   */
  async searchWithFacets(
    query: SearchQuery,
    filters?: SearchFilterSet
  ): Promise<AggregatedSearchResult> {
    const start = Date.now();

    // 1. Run the underlying search.
    const raw = await this.searchService.search(query);

    // 2. Apply in-memory filters (mirrors the Elasticsearch query in a
    //    client-side fallback for the embedded index).
    const filtered = filters ? this.applyFilters(raw.items, filters) : raw.items;

    // 3. Compute facets from the filtered result set.
    const facets = this.buildFacets(filtered);

    // 4. Fetch autocomplete suggestions for the query text.
    const suggestions =
      query.query
        ? await this.searchService.getSuggestions(query.query)
        : [];

    const queryTimeMs = Date.now() - start;

    return {
      hits: { ...raw, items: filtered },
      facets,
      totalHits: filtered.length,
      queryTimeMs,
      suggestions,
    };
  }

  /**
   * Apply a `SearchFilterSet` to a list of subscriptions.
   */
  private applyFilters(
    items: Subscription[],
    filters: SearchFilterSet
  ): Subscription[] {
    return items.filter((sub) => {
      if (filters.categories?.length && !filters.categories.includes(sub.category as SubscriptionCategory)) {
        return false;
      }
      if (filters.billingCycles?.length && !filters.billingCycles.includes(sub.billingCycle as BillingCycle)) {
        return false;
      }
      if (filters.statuses?.length && !filters.statuses.includes(sub.status)) {
        return false;
      }
      if (filters.priceRange) {
        const price = Number(sub.price);
        if (filters.priceRange.min !== undefined && price < filters.priceRange.min) return false;
        if (filters.priceRange.max !== undefined && price > filters.priceRange.max) return false;
      }
      if (filters.tags?.length) {
        const subTags: string[] = (sub as Record<string, unknown>).tags as string[] ?? [];
        if (!filters.tags.some((t) => subTags.includes(t))) return false;
      }
      return true;
    });
  }

  /**
   * Build facet buckets for category, billing cycle and status.
   */
  private buildFacets(items: Subscription[]): SearchFacet[] {
    const categoryCount = new Map<string, number>();
    const cycleCount = new Map<string, number>();
    const statusCount = new Map<string, number>();

    for (const item of items) {
      if (item.category) {
        categoryCount.set(item.category, (categoryCount.get(item.category) ?? 0) + 1);
      }
      if (item.billingCycle) {
        cycleCount.set(item.billingCycle, (cycleCount.get(item.billingCycle) ?? 0) + 1);
      }
      const status = item.status ?? 'unknown';
      statusCount.set(status, (statusCount.get(status) ?? 0) + 1);
    }

    return [
      {
        name: 'Category',
        field: 'category',
        buckets: this.mapToBuckets(categoryCount),
      },
      {
        name: 'Billing Cycle',
        field: 'billingCycle',
        buckets: this.mapToBuckets(cycleCount),
      },
      {
        name: 'Status',
        field: 'status',
        buckets: this.mapToBuckets(statusCount),
      },
    ];
  }

  private mapToBuckets(counts: Map<string, number>): SearchFacetBucket[] {
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({
        label: value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' '),
        value,
        count,
      }));
  }
}

/**
 * Manages the active filter set for a search session and exposes helpers
 * for toggling individual facet values.
 */
export class SearchFacetManager {
  private filters: SearchFilterSet = {};

  getFilters(): Readonly<SearchFilterSet> {
    return { ...this.filters };
  }

  setFilters(filters: SearchFilterSet): void {
    this.filters = { ...filters };
  }

  clearFilters(): void {
    this.filters = {};
  }

  toggleCategory(category: SubscriptionCategory): void {
    const current = new Set(this.filters.categories ?? []);
    if (current.has(category)) {
      current.delete(category);
    } else {
      current.add(category);
    }
    this.filters = { ...this.filters, categories: Array.from(current) };
  }

  toggleBillingCycle(cycle: BillingCycle): void {
    const current = new Set(this.filters.billingCycles ?? []);
    if (current.has(cycle)) {
      current.delete(cycle);
    } else {
      current.add(cycle);
    }
    this.filters = { ...this.filters, billingCycles: Array.from(current) };
  }

  toggleStatus(status: string): void {
    const current = new Set(this.filters.statuses ?? []);
    if (current.has(status)) {
      current.delete(status);
    } else {
      current.add(status);
    }
    this.filters = { ...this.filters, statuses: Array.from(current) };
  }

  setPriceRange(min?: number, max?: number): void {
    this.filters = {
      ...this.filters,
      priceRange: min !== undefined || max !== undefined ? { min, max } : undefined,
    };
  }

  hasActiveFilters(): boolean {
    const { categories, billingCycles, statuses, priceRange, tags } = this.filters;
    return (
      (categories?.length ?? 0) > 0 ||
      (billingCycles?.length ?? 0) > 0 ||
      (statuses?.length ?? 0) > 0 ||
      priceRange !== undefined ||
      (tags?.length ?? 0) > 0
    );
  }

  activeFilterCount(): number {
    let n = 0;
    const { categories, billingCycles, statuses, priceRange, tags } = this.filters;
    n += categories?.length ?? 0;
    n += billingCycles?.length ?? 0;
    n += statuses?.length ?? 0;
    if (priceRange) n += 1;
    n += tags?.length ?? 0;
    return n;
  }
}

/**
 * Debounced autocomplete / suggestion provider that caches results for a
 * configurable TTL to avoid hammering the search cluster on every keystroke.
 */
export class SearchAutoComplete {
  private static instance: SearchAutoComplete;
  private readonly cache = new Map<string, { suggestions: AdvancedSearchSuggestion[]; expiresAt: number }>();
  private readonly service: AdvancedSearchService;
  private readonly ttlMs: number;

  constructor(service: AdvancedSearchService = advancedSearchService, ttlMs = 10_000) {
    this.service = service;
    this.ttlMs = ttlMs;
  }

  static getInstance(): SearchAutoComplete {
    if (!SearchAutoComplete.instance) {
      SearchAutoComplete.instance = new SearchAutoComplete();
    }
    return SearchAutoComplete.instance;
  }

  /**
   * Return suggestions for a query prefix, using a cache to reduce round-trips.
   */
  async getSuggestions(prefix: string): Promise<AdvancedSearchSuggestion[]> {
    const key = prefix.toLowerCase().trim();
    if (!key) return [];

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.suggestions;
    }

    const suggestions = await this.service.getSuggestions(key);
    this.cache.set(key, { suggestions, expiresAt: Date.now() + this.ttlMs });
    return suggestions;
  }

  /**
   * Pre-warm the cache with a list of common prefixes.
   */
  async preWarm(prefixes: string[]): Promise<void> {
    await Promise.all(prefixes.map((p) => this.getSuggestions(p)));
  }

  /** Remove all cached entries. */
  invalidate(): void {
    this.cache.clear();
  }

  /** Remove entries that have expired. */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        evicted += 1;
      }
    }
    return evicted;
  }
}

export const subscriptionSearchAggregator = SubscriptionSearchAggregator.getInstance();
export const searchAutoComplete = SearchAutoComplete.getInstance();
