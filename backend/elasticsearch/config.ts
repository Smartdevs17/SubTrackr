/**
 * Elasticsearch cluster configuration.
 * In this mobile-first architecture the "cluster" is an in-process index
 * backed by AsyncStorage, mirroring a real ES setup so the service layer
 * can be swapped for a remote cluster without changing callers.
 */

export interface ElasticsearchConfig {
  indexName: string;
  fuzzyMaxEdits: number;
  fuzzyMinLength: number;
  searchFields: { field: string; boost: number }[];
  maxResults: number;
  analyticsEnabled: boolean;
  /** Maximum number of suggestions to return from autocomplete */
  maxSuggestions: number;
  /** Maximum analytics events to retain in memory */
  analyticsBufferSize: number;
  /** Minimum query length required to trigger fuzzy matching */
  minQueryLength: number;
  /** Whether to highlight matching terms in result fields */
  highlightEnabled: boolean;
}

export const DEFAULT_ES_CONFIG: ElasticsearchConfig = {
  indexName: 'subtrackr_subscriptions',
  fuzzyMaxEdits: 1,
  fuzzyMinLength: 4,
  searchFields: [
    { field: 'name', boost: 3 },
    { field: 'description', boost: 1 },
    { field: 'category', boost: 2 },
    { field: 'currency', boost: 1 },
  ],
  maxResults: 100,
  analyticsEnabled: true,
  maxSuggestions: 8,
  analyticsBufferSize: 500,
  minQueryLength: 1,
  highlightEnabled: true,
};

export interface FieldMapping {
  type: 'text' | 'keyword' | 'float' | 'boolean' | 'date';
  analyzer?: string;
  /** Whether this field contributes to autocomplete suggestions */
  suggestionEnabled?: boolean;
}

export interface IndexMapping {
  properties: Record<string, FieldMapping>;
}

export const SUBSCRIPTION_INDEX_MAPPING: IndexMapping = {
  properties: {
    name: { type: 'text', analyzer: 'standard', suggestionEnabled: true },
    description: { type: 'text', analyzer: 'standard' },
    category: { type: 'keyword', suggestionEnabled: true },
    billingCycle: { type: 'keyword' },
    currency: { type: 'keyword', suggestionEnabled: true },
    price: { type: 'float' },
    isActive: { type: 'boolean' },
    isCryptoEnabled: { type: 'boolean' },
    nextBillingDate: { type: 'date' },
    createdAt: { type: 'date' },
  },
};

/** Facet configuration: which fields can be used as facets and their display labels */
export interface FacetConfig {
  field: string;
  label: string;
  type: 'terms' | 'range' | 'boolean';
}

export const FACET_CONFIG: FacetConfig[] = [
  { field: 'category', label: 'Category', type: 'terms' },
  { field: 'billingCycle', label: 'Billing Cycle', type: 'terms' },
  { field: 'price', label: 'Price Range', type: 'range' },
  { field: 'isActive', label: 'Status', type: 'boolean' },
  { field: 'isCryptoEnabled', label: 'Crypto', type: 'boolean' },
];

/** Sort options exposed to consumers */
export type SortField = 'name' | 'price' | 'nextBillingDate' | 'category' | '_score';
export type SortOrder = 'asc' | 'desc';

export interface SortOption {
  field: SortField;
  order: SortOrder;
  label: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { field: '_score', order: 'desc', label: 'Relevance' },
  { field: 'name', order: 'asc', label: 'Name A–Z' },
  { field: 'name', order: 'desc', label: 'Name Z–A' },
  { field: 'price', order: 'asc', label: 'Price Low–High' },
  { field: 'price', order: 'desc', label: 'Price High–Low' },
  { field: 'nextBillingDate', order: 'asc', label: 'Next Billing (Earliest)' },
  { field: 'nextBillingDate', order: 'desc', label: 'Next Billing (Latest)' },
];
