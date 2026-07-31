/**
 * Search Service — public façade over the in-process ElasticsearchService.
 *
 * Adds:
 *  - Pagination (page / pageSize) on top of the raw from/size API
 *  - Suggestion / autocomplete generation from the indexed corpus
 *  - Zero-result tracking for analytics
 *  - Convenience helpers (popular queries, recent searches)
 *
 * Because this runs in the React Native process there is no HTTP boundary.
 * Swap `elasticsearchService` for an HTTP client to upgrade to a real cluster.
 */

import {
  elasticsearchService,
  SearchQuery,
  SearchResult,
  SearchHit,
  FacetResult,
  SearchAnalyticsEvent,
} from './ElasticsearchService';
import { Subscription, SubscriptionCategory, BillingCycle } from '../../../src/types/subscription';
import { DEFAULT_ES_CONFIG } from '../../elasticsearch/config';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type {
  SearchQuery,
  SearchResult,
  SearchHit,
  FacetResult,
  SearchAnalyticsEvent,
};

export interface PagedSearchRequest {
  query?: string;
  filters?: SearchQuery['filters'];
  sort?: SearchQuery['sort'];
  /** 1-based page number */
  page?: number;
  /** Results per page (default 20, max 100) */
  pageSize?: number;
}

export interface PagedSearchResponse {
  hits: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Time in ms the search took */
  took: number;
  facets: FacetResult;
  /** Whether the query returned zero results */
  hasResults: boolean;
}

export interface SuggestionRequest {
  partial: string;
  /** Maximum number of suggestions to return (default from config) */
  limit?: number;
  /** Include category suggestions in addition to name suggestions */
  includeCategories?: boolean;
}

export interface SearchAnalyticsSummary {
  topQueries: { query: string; count: number }[];
  zeroResultQueries: { query: string; count: number }[];
  totalSearches: number;
  avgResultCount: number;
}

// ---------------------------------------------------------------------------
// SearchService
// ---------------------------------------------------------------------------

class SearchService {
  private readonly maxPageSize = 100;
  private readonly defaultPageSize = 20;

  /**
   * Index a collection of subscriptions.
   * Call this whenever the subscriptions list changes so the in-memory
   * index is up to date.
   */
  indexSubscriptions(subscriptions: Subscription[]): void {
    elasticsearchService.bulkIndex(subscriptions);
  }

  /**
   * Full-text paginated search with facets.
   *
   * Accepts 1-based pages and translates to the underlying from/size API.
   */
  search(request: PagedSearchRequest): PagedSearchResponse {
    const page = Math.max(1, request.page ?? 1);
    const pageSize = Math.min(
      this.maxPageSize,
      Math.max(1, request.pageSize ?? this.defaultPageSize)
    );
    const from = (page - 1) * pageSize;

    const esQuery: SearchQuery = {
      query: request.query,
      filters: request.filters,
      sort: request.sort,
      from,
      size: pageSize,
    };

    const result = elasticsearchService.search(esQuery);

    const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

    return {
      hits: result.hits,
      total: result.total,
      page,
      pageSize,
      totalPages,
      took: result.took,
      facets: result.facets,
      hasResults: result.total > 0,
    };
  }

  /**
   * Autocomplete suggestions derived from the indexed corpus.
   *
   * Returns up to `limit` distinct strings that start with or contain
   * the given partial query. Subscription names are scored higher than
   * descriptions; categories are included if `includeCategories` is true.
   */
  getSuggestions(request: SuggestionRequest): string[] {
    const { partial, includeCategories = true } = request;
    const limit = request.limit ?? DEFAULT_ES_CONFIG.maxSuggestions;

    if (!partial || partial.trim().length === 0) {
      return [];
    }

    const q = partial.trim().toLowerCase();
    const suggestions = new Map<string, number>(); // value → score

    // Query the underlying index for matching documents
    const result = elasticsearchService.search({
      query: partial,
      size: 50, // scan top-50 relevant docs for suggestions
    });

    for (const hit of result.hits) {
      const sub = hit.subscription;

      // Name matches score highest
      if (sub.name.toLowerCase().includes(q)) {
        suggestions.set(sub.name, (suggestions.get(sub.name) ?? 0) + 3 * hit.score);
      }

      // Description phrases that contain the query term
      if (sub.description) {
        const words = sub.description.split(/\s+/);
        for (const word of words) {
          const w = word.replace(/[^a-z0-9]/gi, '').toLowerCase();
          if (w.startsWith(q) && w.length > q.length) {
            suggestions.set(
              word.replace(/[^a-zA-Z0-9]/g, ''),
              (suggestions.get(w) ?? 0) + hit.score
            );
          }
        }
      }

      // Category suggestions
      if (includeCategories && (sub.category as string).toLowerCase().includes(q)) {
        const label = sub.category as string;
        suggestions.set(label, (suggestions.get(label) ?? 0) + 2);
      }
    }

    // Also include enum categories not covered by indexed docs
    if (includeCategories) {
      for (const cat of Object.values(SubscriptionCategory)) {
        if ((cat as string).toLowerCase().includes(q)) {
          suggestions.set(cat, (suggestions.get(cat) ?? 0) + 1);
        }
      }
    }

    return Array.from(suggestions.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value]) => value)
      .slice(0, limit);
  }

  /**
   * Returns analytics about searches performed in this session.
   */
  getAnalyticsSummary(): SearchAnalyticsSummary {
    const events = elasticsearchService.getAnalyticsEvents();
    const topQueries = elasticsearchService.getTopQueries(10);

    // Zero-result queries
    const zeroMap = new Map<string, number>();
    for (const ev of events) {
      if (ev.resultCount === 0 && ev.query.trim()) {
        const q = ev.query.trim().toLowerCase();
        zeroMap.set(q, (zeroMap.get(q) ?? 0) + 1);
      }
    }

    const zeroResultQueries = Array.from(zeroMap.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const avgResultCount =
      events.length > 0
        ? events.reduce((sum, ev) => sum + ev.resultCount, 0) / events.length
        : 0;

    return {
      topQueries,
      zeroResultQueries,
      totalSearches: events.length,
      avgResultCount: Math.round(avgResultCount * 10) / 10,
    };
  }

  /**
   * Returns the most-searched query terms.
   */
  getTopQueries(limit = 10): { query: string; count: number }[] {
    return elasticsearchService.getTopQueries(limit);
  }

  /**
   * Clears all analytics data.
   */
  clearAnalytics(): void {
    elasticsearchService.clearAnalytics();
  }
}

/** Singleton instance — import this throughout the app */
export const searchService = new SearchService();
