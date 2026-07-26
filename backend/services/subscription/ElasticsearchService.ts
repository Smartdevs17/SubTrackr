import { Subscription, SubscriptionCategory, BillingCycle } from '../../../src/types/subscription';
import { ElasticsearchConfig, DEFAULT_ES_CONFIG } from '../../elasticsearch/config';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SearchQuery {
  query?: string;
  filters?: {
    categories?: SubscriptionCategory[];
    billingCycles?: BillingCycle[];
    priceRange?: { min: number; max: number };
    isActive?: boolean;
    isCryptoEnabled?: boolean;
  };
  sort?: {
    field: 'name' | 'price' | 'nextBillingDate' | 'category' | '_score';
    order: 'asc' | 'desc';
  };
  from?: number;
  size?: number;
}

export interface SearchHit {
  subscription: Subscription;
  score: number;
  highlights: Record<string, string>;
}

export interface FacetResult {
  categories: { key: SubscriptionCategory; count: number }[];
  billingCycles: { key: BillingCycle; count: number }[];
  priceStats: { min: number; max: number; avg: number };
  activeCount: number;
  cryptoCount: number;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  took: number;
  facets: FacetResult;
}

export interface SearchAnalyticsEvent {
  query: string;
  resultCount: number;
  timestamp: number;
  filters: SearchQuery['filters'];
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

interface IndexedDocument {
  id: string;
  tokens: string[];
  source: Subscription;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a: string, b: string, maxEdits: number): number {
  if (Math.abs(a.length - b.length) > maxEdits) return maxEdits + 1;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? dp[j - 1] : 1 + Math.min(dp[j - 1], dp[j], prev);
      dp[j - 1] = prev;
      prev = val;
    }
    dp[b.length] = prev;
  }
  return dp[b.length];
}

function fuzzyMatch(token: string, term: string, maxEdits: number, minLength: number): boolean {
  if (token === term) return true;
  if (token.includes(term) || term.includes(token)) return true;
  if (term.length < minLength) return false;
  return levenshtein(token, term, maxEdits) <= maxEdits;
}

// ---------------------------------------------------------------------------
// ElasticsearchService
// ---------------------------------------------------------------------------

export class ElasticsearchService {
  private index: Map<string, IndexedDocument> = new Map();
  private analytics: SearchAnalyticsEvent[] = [];
  private readonly config: ElasticsearchConfig;

  constructor(config: ElasticsearchConfig = DEFAULT_ES_CONFIG) {
    this.config = config;
  }

  // ── Indexing pipeline ────────────────────────────────────────────────────

  indexDocument(subscription: Subscription): void {
    const tokens: string[] = [];
    for (const { field } of this.config.searchFields) {
      const value = (subscription as unknown as Record<string, unknown>)[field];
      if (typeof value === 'string') tokens.push(...tokenize(value));
    }
    this.index.set(subscription.id, { id: subscription.id, tokens, source: subscription });
  }

  bulkIndex(subscriptions: Subscription[]): void {
    this.index.clear();
    for (const sub of subscriptions) this.indexDocument(sub);
  }

  deleteDocument(id: string): void {
    this.index.delete(id);
  }

  get documentCount(): number {
    return this.index.size;
  }

  // ── Search ───────────────────────────────────────────────────────────────

  search(query: SearchQuery): SearchResult {
    const start = Date.now();
    const { from = 0, size = this.config.maxResults } = query;

    const scoredDocs = Array.from(this.index.values()).map((doc) => ({
      doc,
      score: this._score(doc, query.query),
      highlights: this._highlight(doc, query.query),
    }));

    const afterTextFilter = query.query?.trim()
      ? scoredDocs.filter((d) => d.score > 0)
      : scoredDocs;

    const afterFacets = afterTextFilter.filter(({ doc }) =>
      this._matchesFacets(doc.source, query.filters)
    );

    const facets = this._computeFacets(afterFacets.map((d) => d.doc.source));
    const sorted = this._sort(afterFacets, query.sort);
    const page = sorted.slice(from, from + size);

    const result: SearchResult = {
      hits: page.map(({ doc, score, highlights }) => ({
        subscription: doc.source,
        score,
        highlights,
      })),
      total: afterFacets.length,
      took: Date.now() - start,
      facets,
    };

    if (this.config.analyticsEnabled && query.query?.trim()) {
      this._recordAnalytics(query, result.total);
    }

    return result;
  }

  // ── Scoring ──────────────────────────────────────────────────────────────

  private _score(doc: IndexedDocument, queryString?: string): number {
    if (!queryString?.trim()) return 1;
    const terms = tokenize(queryString);
    let score = 0;
    for (const { field, boost } of this.config.searchFields) {
      const value = (doc.source as unknown as Record<string, unknown>)[field];
      if (typeof value !== 'string') continue;
      const fieldTokens = tokenize(value);
      for (const term of terms) {
        for (const token of fieldTokens) {
          if (fuzzyMatch(token, term, this.config.fuzzyMaxEdits, this.config.fuzzyMinLength)) {
            score += boost * (token === term ? 2 : 1);
          }
        }
      }
    }
    return score;
  }

  private _highlight(doc: IndexedDocument, queryString?: string): Record<string, string> {
    if (!queryString?.trim()) return {};
    const terms = tokenize(queryString);
    const highlights: Record<string, string> = {};
    for (const { field } of this.config.searchFields) {
      const value = (doc.source as unknown as Record<string, unknown>)[field];
      if (typeof value !== 'string') continue;
      const matched = tokenize(value).some((token) =>
        terms.some((term) =>
          fuzzyMatch(token, term, this.config.fuzzyMaxEdits, this.config.fuzzyMinLength)
        )
      );
      if (matched) highlights[field] = value;
    }
    return highlights;
  }

  // ── Faceted navigation ───────────────────────────────────────────────────

  private _matchesFacets(sub: Subscription, filters?: SearchQuery['filters']): boolean {
    if (!filters) return true;
    if (filters.categories?.length && !filters.categories.includes(sub.category)) return false;
    if (filters.billingCycles?.length && !filters.billingCycles.includes(sub.billingCycle))
      return false;
    if (filters.priceRange) {
      if (sub.price < filters.priceRange.min || sub.price > filters.priceRange.max) return false;
    }
    if (filters.isActive !== undefined && sub.isActive !== filters.isActive) return false;
    if (filters.isCryptoEnabled !== undefined && sub.isCryptoEnabled !== filters.isCryptoEnabled)
      return false;
    return true;
  }

  private _computeFacets(subscriptions: Subscription[]): FacetResult {
    const categoryMap = new Map<SubscriptionCategory, number>();
    const cycleMap = new Map<BillingCycle, number>();
    let priceMin = Infinity;
    let priceMax = -Infinity;
    let priceSum = 0;
    let activeCount = 0;
    let cryptoCount = 0;

    for (const sub of subscriptions) {
      categoryMap.set(sub.category, (categoryMap.get(sub.category) ?? 0) + 1);
      cycleMap.set(sub.billingCycle, (cycleMap.get(sub.billingCycle) ?? 0) + 1);
      if (sub.price < priceMin) priceMin = sub.price;
      if (sub.price > priceMax) priceMax = sub.price;
      priceSum += sub.price;
      if (sub.isActive) activeCount++;
      if (sub.isCryptoEnabled) cryptoCount++;
    }

    const n = subscriptions.length;
    return {
      categories: Array.from(categoryMap.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count),
      billingCycles: Array.from(cycleMap.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count),
      priceStats: { min: n ? priceMin : 0, max: n ? priceMax : 0, avg: n ? priceSum / n : 0 },
      activeCount,
      cryptoCount,
    };
  }

  // ── Sorting ──────────────────────────────────────────────────────────────

  private _sort(
    docs: { doc: IndexedDocument; score: number; highlights: Record<string, string> }[],
    sort?: SearchQuery['sort']
  ) {
    const field = sort?.field ?? '_score';
    const order = sort?.order ?? 'desc';
    return [...docs].sort((a, b) => {
      let cmp = 0;
      if (field === '_score') cmp = a.score - b.score;
      else if (field === 'name') cmp = a.doc.source.name.localeCompare(b.doc.source.name);
      else if (field === 'price') cmp = a.doc.source.price - b.doc.source.price;
      else if (field === 'nextBillingDate')
        cmp =
          new Date(a.doc.source.nextBillingDate).getTime() -
          new Date(b.doc.source.nextBillingDate).getTime();
      else if (field === 'category')
        cmp = a.doc.source.category.localeCompare(b.doc.source.category);
      return order === 'asc' ? cmp : -cmp;
    });
  }

  // ── Analytics ────────────────────────────────────────────────────────────

  private _recordAnalytics(query: SearchQuery, resultCount: number): void {
    this.analytics.push({
      query: query.query ?? '',
      resultCount,
      timestamp: Date.now(),
      filters: query.filters,
    });
    if (this.analytics.length > 500) this.analytics.shift();
  }

  getTopQueries(limit = 10): { query: string; count: number }[] {
    const freq = new Map<string, number>();
    for (const event of this.analytics) {
      const q = event.query.trim().toLowerCase();
      if (q) freq.set(q, (freq.get(q) ?? 0) + 1);
    }
    return Array.from(freq.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getAnalyticsEvents(): SearchAnalyticsEvent[] {
    return [...this.analytics];
  }

  clearAnalytics(): void {
    this.analytics = [];
  }
}

export const elasticsearchService = new ElasticsearchService();
