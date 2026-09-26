/**
 * useSearch — primary hook for full-text, faceted, paginated search.
 *
 * Accepts a live array of subscriptions (from the Zustand store) and:
 *  1. Keeps the in-process ES index up to date via `searchService.indexSubscriptions`.
 *  2. Debounces the text input to avoid hammering the index on every keystroke.
 *  3. Returns paginated results together with facet counts and sort controls.
 *
 * Usage:
 *  const {
 *    query, setSearchText, filters, setFilters, sort, setSort,
 *    results, facets, page, totalPages, nextPage, prevPage,
 *    loading, clearSearch,
 *  } = useSearch(subscriptions);
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Subscription } from '../types/subscription';
import {
  searchService,
  PagedSearchResponse,
  PagedSearchRequest,
} from '../../backend/services/subscription/search';
import type {
  SearchQuery,
  FacetResult,
  SearchHit,
} from '../../backend/services/subscription/ElasticsearchService';
import { useDebounce } from './useDebounce';

const EMPTY_FACETS: FacetResult = {
  categories: [],
  billingCycles: [],
  priceStats: { min: 0, max: 0, avg: 0 },
  activeCount: 0,
  cryptoCount: 0,
};

const EMPTY_RESPONSE: PagedSearchResponse = {
  hits: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  took: 0,
  facets: EMPTY_FACETS,
  hasResults: false,
};

export type SearchFilters = SearchQuery['filters'];
export type SearchSort = SearchQuery['sort'];

export interface UseSearchReturn {
  /** Current raw text input (uncontrolled) */
  searchText: string;
  /** Update the search text — debounce is applied internally */
  setSearchText: (text: string) => void;
  /** Active facet filters */
  filters: SearchFilters;
  setFilters: (filters: SearchFilters) => void;
  /** Update a single filter key without replacing the entire filters object */
  patchFilter: <K extends keyof NonNullable<SearchFilters>>(
    key: K,
    value: NonNullable<SearchFilters>[K]
  ) => void;
  /** Current sort settings */
  sort: SearchSort;
  setSort: (sort: SearchSort) => void;
  /** Current page (1-based) */
  page: number;
  /** Move to the next page if available */
  nextPage: () => void;
  /** Move to the previous page if available */
  prevPage: () => void;
  /** Jump to a specific page */
  goToPage: (p: number) => void;
  /** Number of results per page */
  pageSize: number;
  setPageSize: (size: number) => void;
  /** Flattened subscription list for the current page */
  hits: Subscription[];
  /** Full hit objects including scores and highlights */
  rawHits: SearchHit[];
  /** Total matching subscriptions */
  total: number;
  /** Total pages available */
  totalPages: number;
  /** Facet counts for the current filtered result set */
  facets: FacetResult;
  /** Whether a search operation is in flight */
  loading: boolean;
  /** Time in ms for the last search */
  took: number;
  /** Whether the current query/filters returned any results */
  hasResults: boolean;
  /** Whether any non-empty filters or query are active */
  hasActiveFilters: boolean;
  /** Reset all state back to initial values */
  clearSearch: () => void;
}

export function useSearch(subscriptions: Subscription[], initialPageSize = 20): UseSearchReturn {
  const [searchText, setSearchTextRaw] = useState('');
  const [filters, setFilters] = useState<SearchFilters>(undefined);
  const [sort, setSort] = useState<SearchSort>({ field: '_score', order: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [response, setResponse] = useState<PagedSearchResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(false);

  // Keep a ref so the search callback always sees the latest subscriptions
  const subscriptionsRef = useRef(subscriptions);
  subscriptionsRef.current = subscriptions;

  const debouncedText = useDebounce(searchText);

  // Re-index whenever the subscriptions list changes
  useEffect(() => {
    searchService.indexSubscriptions(subscriptions);
  }, [subscriptions]);

  // Run search when any input changes
  useEffect(() => {
    setLoading(true);
    try {
      const req: PagedSearchRequest = {
        query: debouncedText || undefined,
        filters,
        sort,
        page,
        pageSize,
      };
      const result = searchService.search(req);
      setResponse(result);
    } finally {
      setLoading(false);
    }
  }, [debouncedText, filters, sort, page, pageSize]);

  const setSearchText = useCallback((text: string) => {
    setSearchTextRaw(text);
    setPage(1); // reset to page 1 on new text
  }, []);

  const setFiltersWrapped = useCallback((f: SearchFilters) => {
    setFilters(f);
    setPage(1);
  }, []);

  const patchFilter = useCallback(
    <K extends keyof NonNullable<SearchFilters>>(key: K, value: NonNullable<SearchFilters>[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }) as SearchFilters);
      setPage(1);
    },
    []
  );

  const setSortWrapped = useCallback((s: SearchSort) => {
    setSort(s);
    setPage(1);
  }, []);

  const nextPage = useCallback(() => {
    setPage((p) => Math.min(p + 1, response.totalPages));
  }, [response.totalPages]);

  const prevPage = useCallback(() => {
    setPage((p) => Math.max(p - 1, 1));
  }, []);

  const goToPage = useCallback(
    (p: number) => {
      setPage(Math.min(Math.max(1, p), response.totalPages));
    },
    [response.totalPages]
  );

  const clearSearch = useCallback(() => {
    setSearchTextRaw('');
    setFilters(undefined);
    setSort({ field: '_score', order: 'desc' });
    setPage(1);
  }, []);

  const hasActiveFilters = useMemo(() => {
    if (searchText.trim()) return true;
    if (!filters) return false;
    const f = filters;
    if (f.categories?.length) return true;
    if (f.billingCycles?.length) return true;
    if (f.priceRange) return true;
    if (f.isActive !== undefined) return true;
    if (f.isCryptoEnabled !== undefined) return true;
    return false;
  }, [searchText, filters]);

  return {
    searchText,
    setSearchText,
    filters,
    setFilters: setFiltersWrapped,
    patchFilter,
    sort,
    setSort: setSortWrapped,
    page,
    nextPage,
    prevPage,
    goToPage,
    pageSize,
    setPageSize,
    hits: response.hits.map((h) => h.subscription),
    rawHits: response.hits,
    total: response.total,
    totalPages: response.totalPages,
    facets: response.facets,
    loading,
    took: response.took,
    hasResults: response.hasResults,
    hasActiveFilters,
    clearSearch,
  };
}
