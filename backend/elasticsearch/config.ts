/**
 * Elasticsearch cluster configuration.
 * In this mobile-first architecture the "cluster" is an in-process index
 * backed by AsyncStorage, mirroring a real ES setup so the service layer
 * can be swapped for a remote cluster without changing callers.
 *
 * When remote nodes are configured, reads prefer replica nodes and writes
 * go to the primary, with automatic failover when a replica is marked down.
 */

export type ElasticsearchNodeRole = 'primary' | 'replica';

export interface ElasticsearchNode {
  /** Logical name used in routing / metrics (es-primary, es-replica-1, …). */
  name: string;
  /** Node HTTP URL, e.g. https://es-replica-1.internal:9200 */
  url: string;
  role: ElasticsearchNodeRole;
}

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
  /**
   * Optional remote cluster nodes. When empty the in-process index is used.
   * Env: ES_PRIMARY_URL + ES_READ_REPLICA_URLS (comma-separated).
   */
  nodes: ElasticsearchNode[];
  /** Route search/read requests to replica nodes when available. */
  readWriteSplitting: boolean;
  /** Fail reads over to primary when no healthy replica remains. */
  automaticFailover: boolean;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Build ES node list from environment variables. */
export function loadElasticsearchNodes(env: NodeJS.ProcessEnv = process.env): ElasticsearchNode[] {
  const nodes: ElasticsearchNode[] = [];
  const primaryUrl = env.ES_PRIMARY_URL?.trim();
  if (primaryUrl) {
    nodes.push({ name: 'es-primary', url: primaryUrl, role: 'primary' });
  }

  const replicaRaw = env.ES_READ_REPLICA_URLS?.trim();
  if (replicaRaw) {
    replicaRaw
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean)
      .forEach((url, index) => {
        nodes.push({ name: `es-replica-${index + 1}`, url, role: 'replica' });
      });
  }

  return nodes;
}

export function loadElasticsearchConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<ElasticsearchConfig> = {},
): ElasticsearchConfig {
  return {
    ...DEFAULT_ES_CONFIG,
    nodes: loadElasticsearchNodes(env),
    readWriteSplitting: env.ES_READ_WRITE_SPLITTING !== 'false',
    automaticFailover: env.ES_AUTOMATIC_FAILOVER !== 'false',
    maxResults: parsePositiveInt(env.ES_MAX_RESULTS, DEFAULT_ES_CONFIG.maxResults),
    ...overrides,
  };
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
  nodes: [],
  readWriteSplitting: true,
  automaticFailover: true,
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
