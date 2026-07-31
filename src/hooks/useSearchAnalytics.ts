/**
 * useSearchAnalytics — exposes search analytics to UI components.
 *
 * Provides:
 *  - Top queries by frequency in this session
 *  - Zero-result queries (terms that found nothing)
 *  - Total search count and average result count
 *
 * The analytics data is derived from the in-memory buffer of the
 * ElasticsearchService; it resets when the app is restarted.
 *
 * Usage:
 *  const { summary, refresh } = useSearchAnalytics();
 */
import { useState, useCallback } from 'react';
import { searchService } from '../../backend/services/subscription/search';
import type { SearchAnalyticsSummary } from '../../backend/services/subscription/search';

const EMPTY_SUMMARY: SearchAnalyticsSummary = {
  topQueries: [],
  zeroResultQueries: [],
  totalSearches: 0,
  avgResultCount: 0,
};

export interface UseSearchAnalyticsReturn {
  /** Current analytics snapshot */
  summary: SearchAnalyticsSummary;
  /** Re-fetch the analytics snapshot (call after performing searches) */
  refresh: () => void;
  /** Clear all analytics data */
  clear: () => void;
}

export function useSearchAnalytics(): UseSearchAnalyticsReturn {
  const [summary, setSummary] = useState<SearchAnalyticsSummary>(() => {
    try {
      return searchService.getAnalyticsSummary();
    } catch {
      return EMPTY_SUMMARY;
    }
  });

  const refresh = useCallback(() => {
    try {
      setSummary(searchService.getAnalyticsSummary());
    } catch {
      setSummary(EMPTY_SUMMARY);
    }
  }, []);

  const clear = useCallback(() => {
    searchService.clearAnalytics();
    setSummary(EMPTY_SUMMARY);
  }, []);

  return { summary, refresh, clear };
}
