import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Subscription,
  SubscriptionCategory,
  BillingCycle,
} from '../../src/types/subscription';
import { useSubscriptionStore } from '../../src/store/subscriptionStore';
import {
  elasticsearchService,
  SearchQuery,
  SearchResult,
  SavedSearchDefinition,
  SavedSearchMatchNotification,
} from '../../backend/services/search/ElasticsearchService';

export type { SearchQuery, SearchResult, SavedSearchDefinition, SavedSearchMatchNotification };

export type SearchFilters = NonNullable<SearchQuery['filters']>;

export type SavedSearch = SavedSearchDefinition;

const SAVED_SEARCHES_KEY = 'subtrackr-saved-searches';

const toBackendQuery = (query: SearchQuery): SearchQuery => query;

const syncIndex = (): void => {
  const subscriptions = useSubscriptionStore.getState().subscriptions ?? [];
  elasticsearchService.bulkIndex(subscriptions);
};

export const search_subscriptions = (query: SearchQuery): SearchResult => {
  syncIndex();
  return elasticsearchService.search(toBackendQuery(query));
};

export const index_subscription = (subscription: Subscription): void => {
  elasticsearchService.indexDocument(subscription);
};

export const remove_subscription_from_index = (id: string): void => {
  elasticsearchService.deleteDocument(id);
};

export const get_search_suggestions = (partial: string): string[] => {
  syncIndex();
  const suggestions = new Set<string>();
  const q = partial.toLowerCase().trim();
  if (!q) return [];

  const subs = useSubscriptionStore.getState().subscriptions ?? [];
  for (const sub of subs) {
    const candidates = [
      sub.name,
      sub.planName,
      sub.customerName,
      sub.customerEmail,
      sub.notes,
      sub.description,
    ].filter(Boolean) as string[];

    for (const value of candidates) {
      if (value.toLowerCase().includes(q)) suggestions.add(value);
    }
  }

  for (const category of Object.values(SubscriptionCategory)) {
    if (category.toLowerCase().includes(q)) suggestions.add(category);
  }

  for (const top of elasticsearchService.getTopQueries(5)) {
    if (top.query.includes(q)) suggestions.add(top.query);
  }

  return Array.from(suggestions).slice(0, 8);
};

export const load_saved_searches = async (): Promise<SavedSearch[]> => {
  const raw = await AsyncStorage.getItem(SAVED_SEARCHES_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as SavedSearch[];
  elasticsearchService.loadSavedSearches(parsed);
  return parsed;
};

export const save_search = async (search: SavedSearch): Promise<void> => {
  const existing = await load_saved_searches();
  const next = existing.some((s) => s.id === search.id)
    ? existing.map((s) => (s.id === search.id ? search : s))
    : [...existing, search];

  elasticsearchService.loadSavedSearches(next);
  await AsyncStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
  elasticsearchService.registerSavedSearch(search);
};

export const delete_saved_search = async (id: string): Promise<void> => {
  const existing = await load_saved_searches();
  const next = existing.filter((s) => s.id !== id);
  elasticsearchService.loadSavedSearches(next);
  elasticsearchService.removeSavedSearch(id);
  await AsyncStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
};

export const check_saved_search_notifications = (): SavedSearchMatchNotification[] => {
  syncIndex();
  return elasticsearchService.checkSavedSearchNotifications();
};

export const buildDefaultFilters = (): SearchFilters => ({
  categories: [],
  billingCycles: [],
  plans: [],
  statuses: [],
  priceRange: { min: 0, max: Number.MAX_SAFE_INTEGER },
});

export const formatHighlight = (highlight?: string, fallback = ''): string => {
  if (!highlight) return fallback;
  return highlight.replace(/<\/?em>/g, '');
};

export const hasHighlightMatch = (highlight?: string): boolean =>
  Boolean(highlight && highlight.includes('<em>'));

export const getBillingCycleLabel = (cycle: BillingCycle): string =>
  cycle.charAt(0).toUpperCase() + cycle.slice(1);

export const getCategoryLabel = (category: SubscriptionCategory): string =>
  category.charAt(0).toUpperCase() + category.slice(1);
