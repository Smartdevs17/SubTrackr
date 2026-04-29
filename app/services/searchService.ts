import { Subscription, SubscriptionCategory } from '../types/subscription';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { currencyService } from './currencyService';
import { useSettingsStore } from '../store/settingsStore';

export type SearchQuery = {
  query: string;
  filters?: {
    category?: SubscriptionCategory | string;
    minPrice?: number;
    maxPrice?: number;
    activeOnly?: boolean;
  };
};

export type SavedSearch = {
  id: string;
  name: string;
  query: string;
  filters?: any;
};

export type SearchResult = {
  subscriptions: Subscription[];
  total: number;
  // potential analytics hook-in placeholders
  // analytics?: any;
};

// Very lightweight full-text + facet search on subscriptions
export const search_subscriptions = (query: SearchQuery): SearchResult => {
  const all = useSubscriptionStore.getState().subscriptions || [];
  const { query: q, filters } = query;

  const text = (s: Subscription) => {
    const fields = [s.name, s.description, String(s.category), s.currency, String(s.price)];
    return fields.filter(Boolean).join(' ').toLowerCase();
  };

  const normalizedQ = (q || '').toLowerCase().trim();

  const filtered = all.filter((sub) => {
    // quick skip if not active and user asked for activeOnly
    if (filters?.activeOnly && sub.isActive !== true) return false;
    // category facet
    if (filters?.category && sub.category !== filters!.category) return false;
    // price filters
    if (typeof filters?.minPrice === 'number' && sub.price < filters!.minPrice) return false;
    if (typeof filters?.maxPrice === 'number' && sub.price > filters!.maxPrice) return false;
    // full-text search against multiple fields
    if (normalizedQ) {
      const hay = text(sub);
      return hay.includes(normalizedQ);
    }
    return true;
  });

  // Sorting (simple): by nextBillingDate asc if available, else by createdAt
  const sorted = filtered.slice().sort((a, b) => {
    const ta = a.nextBillingDate?.getTime?.() ?? 0;
    const tb = b.nextBillingDate?.getTime?.() ?? 0;
    return ta - tb;
  });

  // export-friendly result: total and items
  return { subscriptions: sorted, total: sorted.length };
};

export const save_search = async (search: SavedSearch): Promise<void> => {
  // Simple persistence via local store if needed; here we'll just attempt to attach to settings if available
  // In a full implementation, we'd persist to AsyncStorage or backend; keep minimal for now
  const _ = search; // placeholder to signal intent
  return Promise.resolve();
};

export const get_search_suggestions = (partial: string): string[] => {
  const suggestions = new Set<string>();
  const subs = useSubscriptionStore.getState().subscriptions || [];
  const q = partial.toLowerCase();
  for (const sub of subs) {
    if (sub.name.toLowerCase().includes(q)) suggestions.add(sub.name);
    if (sub.description && sub.description.toLowerCase().includes(q)) suggestions.add(sub.description);
  }
  // also suggest categories
  const categories = Object.values(SubscriptionCategory);
  for (const c of categories) if ((c as string).toLowerCase().includes(q)) suggestions.add(c);
  return Array.from(suggestions).slice(0, 5);
};
