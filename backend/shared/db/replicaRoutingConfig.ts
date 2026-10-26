/**
 * Replica routing configuration (issue #1804).
 *
 * Provides configurable read-replica routing with:
 *   - Enable/disable routing globally or per-request
 *   - Routing strategy selection (round-robin, least-lag, random)
 *   - Query pattern pinning (force specific queries to primary)
 *   - Per-request force-primary override
 */

/** Routing strategy for selecting among healthy replicas. */
export type RoutingStrategy = 'round-robin' | 'least-lag' | 'random';

/** Query patterns that should always go to primary, even if they are reads. */
export interface PrimaryPinnedPattern {
  /** Regex pattern to match against the SQL query */
  pattern: string;
  /** Reason for pinning (for logging/debugging) */
  reason: string;
}

/** Global routing configuration loaded from environment. */
export interface ReplicaRoutingConfig {
  /** Master switch for read-replica routing. Default: true */
  enabled: boolean;
  /** Strategy for selecting among healthy replicas. Default: 'round-robin' */
  strategy: RoutingStrategy;
  /** Query patterns that must always go to primary. */
  primaryPinnedPatterns: PrimaryPinnedPattern[];
  /** Minimum replicas required to route reads (fall back to primary below this). Default: 1 */
  minReplicas: number;
  /** Max lag (ms) before a replica is excluded. Default: from DatabaseConfig */
  maxLagMs: number;
  /** Whether to include routing debug headers in responses. Default: false */
  debugHeaders: boolean;
}

export const DEFAULT_ROUTING_CONFIG: Readonly<ReplicaRoutingConfig> = {
  enabled: true,
  strategy: 'round-robin',
  primaryPinnedPatterns: [
    { pattern: 'FOR UPDATE', reason: 'locking read must use primary' },
    { pattern: 'SELECT.*NEXTVAL', reason: 'sequence generation must use primary' },
    { pattern: 'pg_advisory_lock', reason: 'advisory locks must use primary' },
  ],
  minReplicas: 1,
  maxLagMs: 5_000,
  debugHeaders: false,
};

/**
 * Load routing configuration from environment variables.
 */
export function loadRoutingConfig(env: NodeJS.ProcessEnv = process.env): ReplicaRoutingConfig {
  const strategy = env.DB_ROUTING_STRATEGY;
  const validStrategies: RoutingStrategy[] = ['round-robin', 'least-lag', 'random'];

  return {
    enabled: env.DB_ROUTING_ENABLED !== 'false',
    strategy: strategy && validStrategies.includes(strategy as RoutingStrategy)
      ? (strategy as RoutingStrategy)
      : DEFAULT_ROUTING_CONFIG.strategy,
    primaryPinnedPatterns: DEFAULT_ROUTING_CONFIG.primaryPinnedPatterns,
    minReplicas: parseInt(env.DB_ROUTING_MIN_REPLICAS ?? '1', 10) || 1,
    maxLagMs: parseInt(env.DB_ROUTING_MAX_LAG_MS ?? '5000', 10) || 5_000,
    debugHeaders: env.DB_ROUTING_DEBUG_HEADERS === 'true',
  };
}

/**
 * Check if a SQL query should be pinned to primary (not routed to replica).
 */
export function shouldPinToPrimary(sql: string, config: ReplicaRoutingConfig): boolean {
  for (const pinned of config.primaryPinnedPatterns) {
    const regex = new RegExp(pinned.pattern, 'i');
    if (regex.test(sql)) return true;
  }
  return false;
}

/**
 * Per-request routing override.
 * Set via AsyncLocalStorage context to force all queries in a request to primary.
 */
export interface RoutingOverride {
  /** Force all queries to primary for this request */
  forcePrimary?: boolean;
  /** Override the routing strategy for this request */
  strategy?: RoutingStrategy;
  /** Override max lag for this request */
  maxLagMs?: number;
}

/**
 * Merge a per-request override with the global config.
 */
export function mergeRoutingConfig(
  base: ReplicaRoutingConfig,
  override?: RoutingOverride,
): ReplicaRoutingConfig {
  if (!override) return base;
  return {
    ...base,
    enabled: override.forcePrimary ? false : base.enabled,
    strategy: override.strategy ?? base.strategy,
    maxLagMs: override.maxLagMs ?? base.maxLagMs,
  };
}
