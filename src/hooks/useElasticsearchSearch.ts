import { useState, useEffect, useCallback, useMemo } from 'react';
import { Subscription } from '../types/subscription';
import {
  elasticsearchService,
  SearchQuery,
  SearchResult,
} from '../../backend/services/search/ElasticsearchService';

const EMPTY_RESULT: SearchResult = {
  hits: [],
  total: 0,
  took: 0,
  facets: {
    categories: [],
    billingCycles: [],
    priceStats: { min: 0, max: 0, avg: 0 },
    activeCount: 0,
    cryptoCount: 0,
  },
};

export function useElasticsearchSearch(subscriptions: Subscription[]) {
  const [query, setQuery] = useState<SearchQuery>({});
  const [result, setResult] = useState<SearchResult>(EMPTY_RESULT);

  useEffect(() => {
    elasticsearchService.bulkIndex(subscriptions);
    setResult(elasticsearchService.search(query));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptions]);

  useEffect(() => {
    setResult(elasticsearchService.search(query));
  }, [query]);

  const setSearchText = useCallback((text: string) => {
    setQuery((prev) => ({ ...prev, query: text }));
  }, []);

  const setFilters = useCallback((filters: SearchQuery['filters']) => {
    setQuery((prev) => ({ ...prev, filters }));
  }, []);

  const setSort = useCallback((sort: SearchQuery['sort']) => {
    setQuery((prev) => ({ ...prev, sort }));
  }, []);

  const clearSearch = useCallback(() => setQuery({}), []);

  const topQueries = useMemo(() => elasticsearchService.getTopQueries(), [result]);

  return {
    query,
    setSearchText,
    setFilters,
    setSort,
    clearSearch,
    result,
    hits: result.hits.map((h) => h.subscription),
    facets: result.facets,
    total: result.total,
    took: result.took,
    topQueries,
  };
}
