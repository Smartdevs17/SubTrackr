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
  /** Analyzer locales used for multilingual tokenization */
  analyzerLocales: string[];
}

export const DEFAULT_ES_CONFIG: ElasticsearchConfig = {
  indexName: 'subtrackr_subscriptions',
  fuzzyMaxEdits: 1,
  fuzzyMinLength: 4,
  searchFields: [
    { field: 'customerName', boost: 3 },
    { field: 'customerEmail', boost: 3 },
    { field: 'planName', boost: 3 },
    { field: 'name', boost: 2 },
    { field: 'notes', boost: 2 },
    { field: 'description', boost: 1 },
    { field: 'category', boost: 1 },
    { field: 'currency', boost: 1 },
  ],
  maxResults: 100,
  analyticsEnabled: true,
  analyzerLocales: ['en', 'fr', 'de', 'es'],
};

export interface IndexMapping {
  properties: Record<
    string,
    { type: 'text' | 'keyword' | 'float' | 'boolean' | 'date'; analyzer?: string }
  >;
}

export const SUBSCRIPTION_INDEX_MAPPING: IndexMapping = {
  properties: {
    customerName: { type: 'text', analyzer: 'standard' },
    customerEmail: { type: 'text', analyzer: 'standard' },
    planName: { type: 'text', analyzer: 'standard' },
    notes: { type: 'text', analyzer: 'standard' },
    name: { type: 'text', analyzer: 'standard' },
    description: { type: 'text', analyzer: 'standard' },
    category: { type: 'keyword' },
    billingCycle: { type: 'keyword' },
    currency: { type: 'keyword' },
    price: { type: 'float' },
    isActive: { type: 'boolean' },
    isCryptoEnabled: { type: 'boolean' },
    nextBillingDate: { type: 'date' },
    createdAt: { type: 'date' },
  },
};
