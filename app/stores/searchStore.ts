import { create } from 'zustand';
import { useSubscriptionStore } from './subscriptionStore';
import { Subscription } from '../types/subscription';

type Facets = {
  category?: string;
  activeOnly?: boolean;
  minPrice?: number;
  maxPrice?: number;
};

type SavedSearch = {
  id: string;
  name: string;
  query: string;
  facets?: Facets;
};

type SearchState = {
  query: string;
  facets: Facets;
  results: Subscription[];
  savedSearches: SavedSearch[];
  setQuery: (q: string) => void;
  setFacets: (f: Partial<Facets>) => void;
  updateResults: (subs: Subscription[]) => void;
  saveSearch: (name: string) => void;
  loadSavedSearch: (id: string) => void;
  clear: () => void;
};

export const useSearchStore = create<SearchState>()((set, get) => {
  const { subscriptions } = require('../store/subscriptionStore').useSubscriptionStore.getState();
  return {
    query: '',
    facets: {},
    results: subscriptions?.length ? subscriptions : [],
    savedSearches: [],
    setQuery: (q: string) => {
      set({ query: q });
      // Basic debounce-like refresh by recalculating results on demand
      const subState = require('../store/subscriptionStore').useSubscriptionStore.getState();
      set({ results: subState.subscriptions });
    },
    setFacets: (f: Partial<Facets>) => {
      set((state) => ({ facets: { ...state.facets, ...f } }));
      // Refresh results when facets change
      const subState = require('../store/subscriptionStore').useSubscriptionStore.getState();
      set({ results: subState.subscriptions });
    },
    updateResults: (subs: Subscription[]) => set({ results: subs }),
    saveSearch: (name: string) => {
      const current = get();
      const id = `ss_${Date.now()}`;
      const newSearch = {
        id,
        name,
        query: current.query,
        facets: current.facets,
      } as SavedSearch;
      set((s) => ({ savedSearches: [...s.savedSearches, newSearch] }));
    },
    loadSavedSearch: (id: string) => {
      const s = get().savedSearches.find((ss) => ss.id === id);
      if (s) {
        set({ query: s.query, facets: s.facets || {} });
      }
    },
    clear: () => {
      set({ query: '', facets: {}, results: [] });
    },
  };
});
