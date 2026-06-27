import { create } from 'zustand';
import { useStore } from '../../src/store';

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
  results: any[];
  savedSearches: SavedSearch[];
  setQuery: (q: string) => void;
  setFacets: (f: Partial<Facets>) => void;
  updateResults: (results: any[]) => void;
  saveSearch: (name: string) => void;
  loadSavedSearch: (id: string) => void;
  clear: () => void;
};

export const useSearchStore = create<SearchState>()((set, get) => {
  // Get initial subscriptions from the combined store
  const subs = useStore.getState()?.subscriptions;

  return {
    query: '',
    facets: {},
    results: subs?.length ? subs : [],
    savedSearches: [],
    setQuery: (q: string) => {
      set({ query: q });
      const subState = useStore.getState();
      set({ results: subState?.subscriptions ?? [] });
    },
    setFacets: (f: Partial<Facets>) => {
      set((state) => ({ facets: { ...state.facets, ...f } }));
      const subState = useStore.getState();
      set({ results: subState?.subscriptions ?? [] });
    },
    updateResults: (results) => set({ results }),
    saveSearch: (name: string) => {
      const current = get();
      const id = `ss_${Date.now()}`;
      const newSearch = { id, name, query: current.query, facets: current.facets } as SavedSearch;
      set((s) => ({ savedSearches: [...s.savedSearches, newSearch] }));
    },
    loadSavedSearch: (id: string) => {
      const s = get().savedSearches.find((ss) => ss.id === id);
      if (s) set({ query: s.query, facets: s.facets || {} });
    },
    clear: () => set({ query: '', facets: {}, results: [] }),
  };
});
