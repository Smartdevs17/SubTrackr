import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Subscription, SubscriptionCategory, BillingCycle } from '../../src/types/subscription';
import {
  search_subscriptions,
  save_search,
  delete_saved_search,
  check_saved_search_notifications,
  load_saved_searches,
  SavedSearch,
  SearchQuery,
} from '../services/searchService';
import { SearchResult } from '../../backend/services/search/ElasticsearchService';

type SearchFilters = NonNullable<SearchQuery['filters']>;

type SearchState = {
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
  checkNotifications: () => ReturnType<typeof check_saved_search_notifications>;
  hydrateSavedSearches: () => Promise<void>;
  clear: () => void;
};

const defaultFilters = (): SearchFilters => ({
  categories: [],
  billingCycles: [],
  plans: [],
  statuses: [],
});

const buildQuery = (state: Pick<SearchState, 'queryText' | 'filters' | 'sort'>): SearchQuery => ({
  query: state.queryText,
  filters: state.filters,
  sort: state.sort,
});

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
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
        const result = search_subscriptions(buildQuery(get()));
        set({ result, loading: false });
      },

      refreshSuggestions: (partial) => {
        const { get_search_suggestions } = require('../services/searchService');
        set({ suggestions: get_search_suggestions(partial) });
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
        await delete_saved_search(id);
        set((s) => ({ savedSearches: s.savedSearches.filter((item) => item.id !== id) }));
      },

      checkNotifications: () => check_saved_search_notifications(),

      hydrateSavedSearches: async () => {
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
    }),
    {
      name: 'subtrackr-search-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        savedSearches: state.savedSearches,
      }),
    }
  )
);

export type { Subscription, SubscriptionCategory, BillingCycle };
