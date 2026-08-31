/**
 * Elasticsearch cluster configuration.
 * In this mobile-first architecture the "cluster" is an in-process index
 * backed by AsyncStorage, mirroring a real ES setup so the service layer
 * can be swapped for a remote cluster without changing callers.
 *
 * Issue #986: Extended with connection pool settings.
 */

// ---------------------------------------------------------------------------
// Connection pool config (Issue #986)
// ---------------------------------------------------------------------------

export interface ElasticsearchPoolConfig {
  /** Primary node host. Default: localhost */
  primaryHost: string;
  /** Primary node port. Default: 9200 */
  primaryPort: number;
  /** Optional read replicas for query routing. */
  replicas?: { host: string; port: number }[];
  /**
   * Total connections in pool across primary + replicas.
   * Recommended: (vCPUs * 2) for IO-bound ES workloads.
   * Default: 10
   */
  poolSize: number;
  /** Milliseconds to wait for a free connection. Default: 5000 */
  acquireTimeoutMs: number;
  /** Idle connection teardown threshold (ms). Default: 60_000 */
  idleTimeoutMs: number;
  /** Connection-held-too-long leak threshold (ms). Default: 30_000 */
  leakThresholdMs: number;
  /** DNS cache TTL (ms). Default: 30_000 */
  dnsCacheTtlMs: number;
  /** Maintenance sweep interval (ms). Default: 10_000 */
  maintenanceIntervalMs: number;
}

export const DEFAULT_POOL_CONFIG: ElasticsearchPoolConfig = {
  primaryHost: process.env['ES_PRIMARY_HOST'] ?? 'localhost',
  primaryPort: Number(process.env['ES_PRIMARY_PORT'] ?? 9200),
  replicas: process.env['ES_REPLICA_HOSTS']
    ? process.env['ES_REPLICA_HOSTS'].split(',').map((h) => {
        const [host, port] = h.split(':');
        return { host: host ?? 'localhost', port: Number(port ?? 9200) };
      })
    : [],
  poolSize: Number(process.env['ES_POOL_SIZE'] ?? 10),
  acquireTimeoutMs: Number(process.env['ES_ACQUIRE_TIMEOUT_MS'] ?? 5_000),
  idleTimeoutMs: Number(process.env['ES_IDLE_TIMEOUT_MS'] ?? 60_000),
  leakThresholdMs: Number(process.env['ES_LEAK_THRESHOLD_MS'] ?? 30_000),
  dnsCacheTtlMs: Number(process.env['ES_DNS_CACHE_TTL_MS'] ?? 30_000),
  maintenanceIntervalMs: Number(process.env['ES_MAINTENANCE_INTERVAL_MS'] ?? 10_000),
};

// ---------------------------------------------------------------------------
// Index / Search config
// ---------------------------------------------------------------------------

export type ElasticsearchNodeRole = 'primary' | 'replica';

export interface ElasticsearchNode {
  name: string;
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
  /** Analyzer locales used for multilingual tokenization */
  analyzerLocales: string[];
  /** Connection pool settings (Issue #986) */
  pool?: ElasticsearchPoolConfig;
  /** Remote cluster nodes for read/write routing (empty = in-process only). */
  nodes?: ElasticsearchNode[];
  /** Route reads to replicas when remote nodes are configured. Default: true */
  readWriteSplitting?: boolean;
  /** Fall back to the primary when all replicas are unhealthy. Default: true */
  automaticFailover?: boolean;
  /** Maximum autocomplete suggestions returned by the search façade. */
  maxSuggestions?: number;
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
  pool: DEFAULT_POOL_CONFIG,
  nodes: [],
  readWriteSplitting: true,
  automaticFailover: true,
  maxSuggestions: 8,
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

// ---------------------------------------------------------------------------
// Remote node loading (Issue #945)
// ---------------------------------------------------------------------------

/**
 * Load remote cluster nodes from the environment.
 *
 *  - ES_PRIMARY_URL          primary node URL (required for remote mode)
 *  - ES_READ_REPLICA_URLS    comma-separated replica node URLs
 *
 * Returns an empty list when no remote nodes are configured so callers fall
 * back to the in-process index (the default mobile-first deployment).
 */
export function loadElasticsearchNodes(env: NodeJS.ProcessEnv = process.env): ElasticsearchNode[] {
  const nodes: ElasticsearchNode[] = [];

  const primaryUrl = env.ES_PRIMARY_URL;
  if (primaryUrl) {
    nodes.push({ name: 'es-primary', url: primaryUrl, role: 'primary' });
  }

  const replicaUrls = env.ES_READ_REPLICA_URLS;
  if (replicaUrls) {
    const urls = replicaUrls
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
    urls.forEach((url, index) => {
      nodes.push({ name: `es-replica-${index + 1}`, url, role: 'replica' });
    });
  }

  return nodes;
}

/**
 * Build a complete `ElasticsearchConfig` from the environment, merging the
 * in-process defaults with any remote nodes that are configured.
 *
 * Read/write splitting and automatic failover can be toggled via
 * `ES_READ_WRITE_SPLITTING` and `ES_AUTOMATIC_FAILOVER`.
 */
export function loadElasticsearchConfig(env: NodeJS.ProcessEnv = process.env): ElasticsearchConfig {
  return {
    ...DEFAULT_ES_CONFIG,
    nodes: loadElasticsearchNodes(env),
    readWriteSplitting: env.ES_READ_WRITE_SPLITTING !== 'false',
    automaticFailover: env.ES_AUTOMATIC_FAILOVER !== 'false',
  };
}
