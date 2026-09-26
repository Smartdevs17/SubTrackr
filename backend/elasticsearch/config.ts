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
  /** Remote cluster nodes (empty → in-process index) */
  nodes: ElasticsearchNode[];
  /** Route reads to replicas when available. Default: true */
  readWriteSplitting: boolean;
  /** Fail over reads to primary when all replicas are down. Default: true */
  automaticFailover: boolean;
}

export interface ElasticsearchNode {
  name: string;
  url: string;
  role: 'primary' | 'replica';
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
  nodes: [],
  readWriteSplitting: true,
  automaticFailover: true,
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

// ─── Node loading from environment ────────────────────────────────────────────

/**
 * Parse `ES_PRIMARY_URL` and `ES_READ_REPLICA_URLS` environment variables
 * into a typed node list.
 */
export function loadElasticsearchNodes(
  env: NodeJS.ProcessEnv = process.env,
): ElasticsearchNode[] {
  const nodes: ElasticsearchNode[] = [];

  if (env['ES_PRIMARY_URL']) {
    nodes.push({
      name: 'es-primary',
      url: env['ES_PRIMARY_URL'],
      role: 'primary',
    });
  }

  if (env['ES_READ_REPLICA_URLS']) {
    const urls = env['ES_READ_REPLICA_URLS'].split(',').map((s) => s.trim()).filter(Boolean);
    urls.forEach((url, i) => {
      nodes.push({
        name: `es-replica-${i + 1}`,
        url,
        role: 'replica',
      });
    });
  }

  return nodes;
}

/**
 * Build a full `ElasticsearchConfig` from environment variables.
 * Falls back to sensible defaults for every field.
 */
export function loadElasticsearchConfig(
  env: NodeJS.ProcessEnv = process.env,
): ElasticsearchConfig {
  return {
    ...DEFAULT_ES_CONFIG,
    nodes: loadElasticsearchNodes(env),
    readWriteSplitting: env['ES_READ_WRITE_SPLITTING'] !== 'false',
    automaticFailover: env['ES_AUTOMATIC_FAILOVER'] !== 'false',
  };
}
