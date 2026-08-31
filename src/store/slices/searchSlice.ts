/**
 * searchSlice.ts — Advanced search slice for the slices-pattern store.
 *
 * Migrated from app/stores/searchStore.ts (Issue #944) so search state and
 * actions live alongside the other domain slices in the combined useAppStore.
 * Legacy consumers importing `useSearchStore` are untouched.
 */

import { SliceCreator } from './types';
import type { AppState } from './state';
import type { Subscription, SubscriptionCategory, BillingCycle } from '../../types/subscription';
import type { SearchResult } from '../../backend/services/search/ElasticsearchService';
import type {
  SavedSearch,
  SearchQuery,
  SavedSearchMatchNotification,
} from '../../app/services/searchService';

type SearchFilters = NonNullable<SearchQuery['filters']>;

export interface SearchSlice {
  queryText: string;
  filters: SearchFilters;
  sort: SearchQuery['sort'];
  result: SearchResult | null;
  savedSearches: SavedSearch[];
  suggestions: string[];
  loading: boolean;

  setQueryText: (text: string) => void;
  setFilters: (filters: Partial<SearchFilters>) => void;
  setSort: (sort: SearchQuery['sort']) => void;
  runSearch: () => void;
  refreshSuggestions: (partial: string) => void;
  saveCurrentSearch: (name: string, notifyOnNewMatches?: boolean) => Promise<void>;
  loadSavedSearch: (id: string) => void;
  removeSavedSearch: (id: string) => Promise<void>;
  checkNotifications: () => Promise<SavedSearchMatchNotification[]>;
  hydrateSavedSearches: () => Promise<void>;
  clear: () => void;
}

export type SearchStoreState = AppState;

const defaultFilters = (): SearchFilters => ({
  categories: [],
  billingCycles: [],
  plans: [],
  statuses: [],
});

const loadSearchService = (): Promise<typeof import('../../app/services/searchService')> =>
  import('../../app/services/searchService');

const buildQuery = (state: Pick<SearchSlice, 'queryText' | 'filters' | 'sort'>): SearchQuery => ({
  query: state.queryText,
  filters: state.filters,
  sort: state.sort,
});

export const createSearchSlice: SliceCreator<SearchSlice> = (set, get) => ({
  queryText: '',
  filters: defaultFilters(),
  sort: { field: '_score', order: 'desc' },
  result: null,
  savedSearches: [],
  suggestions: [],
  loading: false,

  setQueryText: (text) => {
    set({ queryText: text });
    get().runSearch();
  },

  setFilters: (partial) => {
    set((state) => ({ filters: { ...state.filters, ...partial } }));
    get().runSearch();
  },

  setSort: (sort) => {
    set({ sort });
    get().runSearch();
  },

  runSearch: () => {
    set({ loading: true });
    void loadSearchService().then(({ search_subscriptions }) => {
      const result = search_subscriptions(buildQuery(get()));
      set({ result, loading: false });
    });
  },

  refreshSuggestions: (partial) => {
    void loadSearchService().then(({ get_search_suggestions }) => {
      set({ suggestions: get_search_suggestions(partial) });
    });
  },

  saveCurrentSearch: async (name, notifyOnNewMatches = true) => {
    const state = get();
    const saved: SavedSearch = {
      id: `ss_${Date.now()}`,
      name,
      query: buildQuery(state),
      notifyOnNewMatches,
      lastMatchCount: state.result?.total ?? 0,
      createdAt: Date.now(),
    };
    const { save_search } = await loadSearchService();
    await save_search(saved);
    set((s) => ({ savedSearches: [...s.savedSearches, saved] }));
  },

  loadSavedSearch: (id) => {
    const saved = get().savedSearches.find((s) => s.id === id);
    if (!saved) return;
    set({
      queryText: saved.query.query ?? '',
      filters: saved.query.filters ?? defaultFilters(),
      sort: saved.query.sort ?? { field: '_score', order: 'desc' },
    });
    get().runSearch();
  },

  removeSavedSearch: async (id) => {
    const { delete_saved_search } = await loadSearchService();
    await delete_saved_search(id);
    set((s) => ({ savedSearches: s.savedSearches.filter((item) => item.id !== id) }));
  },

  checkNotifications: () =>
    loadSearchService().then(({ check_saved_search_notifications }) =>
      check_saved_search_notifications()
    ),

  hydrateSavedSearches: async () => {
    const { load_saved_searches } = await loadSearchService();
    const saved = await load_saved_searches();
    set({ savedSearches: saved });
  },

  clear: () => {
    set({
      queryText: '',
      filters: defaultFilters(),
      sort: { field: '_score', order: 'desc' },
      result: null,
    });
  },
});

export type { Subscription, SubscriptionCategory, BillingCycle };