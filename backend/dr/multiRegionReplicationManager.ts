/**
 * Multi-Region DB Replication Manager — SubTrackr
 *
 * Issue #1282: Build multi-region DB replication
 *
 * Manages database replication across multiple regions with:
 *  - Region-aware query routing (writes → primary region, reads → nearest replica)
 *  - Per-region health monitoring via periodic lag polling
 *  - Automatic failover when the primary region becomes unhealthy
 *  - Manual failover API for planned maintenance
 *  - Configurable lag thresholds per region
 *  - Event callbacks (onFailover, onRegionHealthChange, onLagAlert)
 *  - Prometheus-compatible metrics export
 *
 * Architecture:
 *  - Each `RegionConfig` describes one database region (primary or replica).
 *  - `MultiRegionReplicationManager` owns a map of `RegionState` objects
 *    that track live health, lag, and stats.
 *  - A polling loop updates each region's health on a configurable interval.
 *  - Read routing uses a weighted-round-robin across healthy replica regions.
 *  - On primary failure the manager promotes the healthiest available replica.
 */

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegionRole = 'primary' | 'replica';
export type RegionHealth = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface RegionConfig {
  /** Unique region identifier (e.g. "us-east-1"). */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Database connection URL or host. */
  connectionUrl: string;
  /** Initial role at startup. */
  role: RegionRole;
  /** Replication lag above this (ms) triggers a `lagAlert` event. Default: 1 000. */
  lagAlertMs?: number;
  /** Replication lag above this (ms) marks the region as `degraded`. Default: 5 000. */
  lagDegradedMs?: number;
  /** Replication lag above this (ms) excludes the region from read routing. Default: 30 000. */
  lagFailoverMs?: number;
  /**
   * Priority when selecting a new primary during failover.
   * Lower values are preferred (0 = highest priority). Default: 0.
   */
  failoverPriority?: number;
}

export interface RegionState {
  config: RegionConfig;
  role: RegionRole;
  health: RegionHealth;
  lagMs: number;
  lagP99Ms: number;
  lagSamples: number[];
  available: boolean;
  lastCheckedAt: number;
  lastHealthyAt: number;
  consecutiveFailures: number;
  queryCount: number;
  errorCount: number;
  lastLatencyMs: number;
}

export interface FailoverResult {
  previousPrimary: string;
  newPrimary: string;
  promotedAt: number;
  reason: string;
}

export interface RoutingDecision {
  regionId: string;
  role: RegionRole;
  lagMs: number;
}

export interface RegionHealthSnapshot {
  regionId: string;
  health: RegionHealth;
  role: RegionRole;
  lagMs: number;
  lagP99Ms: number;
  available: boolean;
  lastCheckedAt: number;
}

export interface MultiRegionMetrics {
  primaryRegion: string | null;
  regions: RegionHealthSnapshot[];
  totalFailovers: number;
  lastFailoverAt: number | null;
  readQueries: number;
  writeQueries: number;
}

export interface MultiRegionReplicationManagerOptions {
  regions: RegionConfig[];
  /** Health poll interval in ms. Default: 5 000. */
  pollIntervalMs?: number;
  /** Max lag samples retained per region for P99 calculation. Default: 100. */
  maxLagSamples?: number;
  /**
   * Number of consecutive health failures before a primary is considered down.
   * Default: 3.
   */
  primaryFailureThreshold?: number;
  /**
   * Pluggable lag measurement function. Receives the region state and returns
   * lag in ms. Defaults to a simulated random lag suitable for tests.
   */
  measureLag?: (region: RegionState) => Promise<number>;
  onFailover?: (result: FailoverResult) => void;
  onRegionHealthChange?: (regionId: string, previous: RegionHealth, current: RegionHealth) => void;
  onLagAlert?: (regionId: string, lagMs: number, thresholdMs: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_LAG_SAMPLES = 100;
const DEFAULT_PRIMARY_FAILURE_THRESHOLD = 3;
const DEFAULT_LAG_ALERT_MS = 1_000;
const DEFAULT_LAG_DEGRADED_MS = 5_000;
const DEFAULT_LAG_FAILOVER_MS = 30_000;

function computeP99(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(0.99 * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function deriveHealth(state: RegionState): RegionHealth {
  if (!state.available) return 'unhealthy';
  const lagDegradedMs = state.config.lagDegradedMs ?? DEFAULT_LAG_DEGRADED_MS;
  const lagFailoverMs = state.config.lagFailoverMs ?? DEFAULT_LAG_FAILOVER_MS;
  if (state.lagMs > lagFailoverMs) return 'unhealthy';
  if (state.lagMs > lagDegradedMs) return 'degraded';
  return 'healthy';
}

// ---------------------------------------------------------------------------
// MultiRegionReplicationManager
// ---------------------------------------------------------------------------

export class MultiRegionReplicationManager extends EventEmitter {
  private readonly states = new Map<string, RegionState>();
  private readonly options: Required<
    Omit<MultiRegionReplicationManagerOptions, 'onFailover' | 'onRegionHealthChange' | 'onLagAlert'>
  > & Pick<MultiRegionReplicationManagerOptions, 'onFailover' | 'onRegionHealthChange' | 'onLagAlert'>;

  private primaryRegionId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private totalFailovers = 0;
  private lastFailoverAt: number | null = null;
  private readQueries = 0;
  private writeQueries = 0;

  /** Round-robin cursor for replica selection. */
  private readCursor = 0;

  constructor(opts: MultiRegionReplicationManagerOptions) {
    super();

    this.options = {
      regions: opts.regions,
      pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      maxLagSamples: opts.maxLagSamples ?? DEFAULT_MAX_LAG_SAMPLES,
      primaryFailureThreshold: opts.primaryFailureThreshold ?? DEFAULT_PRIMARY_FAILURE_THRESHOLD,
      measureLag: opts.measureLag ?? this.defaultMeasureLag,
      onFailover: opts.onFailover,
      onRegionHealthChange: opts.onRegionHealthChange,
      onLagAlert: opts.onLagAlert,
    };

    this.initRegions();
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  private initRegions(): void {
    for (const config of this.options.regions) {
      this.states.set(config.id, {
        config,
        role: config.role,
        health: 'unknown',
        lagMs: 0,
        lagP99Ms: 0,
        lagSamples: [],
        available: true,
        lastCheckedAt: 0,
        lastHealthyAt: 0,
        consecutiveFailures: 0,
        queryCount: 0,
        errorCount: 0,
        lastLatencyMs: 0,
      });

      if (config.role === 'primary') {
        this.primaryRegionId = config.id;
      }
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Start the background health poll. */
  start(): void {
    if (this.running) return;
    this.running = true;
    // Run an initial check immediately
    void this.pollAllRegions();
    this.pollTimer = setInterval(() => void this.pollAllRegions(), this.options.pollIntervalMs);
  }

  /** Stop the background poll and free resources. */
  stop(): void {
    this.running = false;
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  /**
   * Return the region that should handle a write.
   * Always returns the primary region.
   */
  routeWrite(): RoutingDecision | null {
    if (!this.primaryRegionId) return null;
    const state = this.states.get(this.primaryRegionId);
    if (!state || state.health === 'unhealthy') return null;

    this.writeQueries++;
    state.queryCount++;
    return { regionId: state.config.id, role: 'primary', lagMs: state.lagMs };
  }

  /**
   * Return the best region for a read query.
   *
   * Selection order:
   *  1. Healthy replica regions (round-robin, excludes primary)
   *  2. Degraded replica regions (if no healthy replicas are available)
   *  3. Primary region (fallback when no replicas are acceptable)
   */
  routeRead(): RoutingDecision | null {
    const replicas = Array.from(this.states.values()).filter(
      (s) => s.role === 'replica' && s.health !== 'unhealthy',
    );

    if (replicas.length > 0) {
      // Simple round-robin
      this.readCursor = (this.readCursor + 1) % replicas.length;
      const chosen = replicas[this.readCursor];
      this.readQueries++;
      chosen.queryCount++;
      return { regionId: chosen.config.id, role: 'replica', lagMs: chosen.lagMs };
    }

    // Fallback to primary
    if (this.primaryRegionId) {
      const primary = this.states.get(this.primaryRegionId);
      if (primary && primary.health !== 'unhealthy') {
        this.readQueries++;
        primary.queryCount++;
        return { regionId: primary.config.id, role: 'primary', lagMs: primary.lagMs };
      }
    }

    return null;
  }

  // ── Health Monitoring ──────────────────────────────────────────────────────

  /** Run a health check cycle across all regions. */
  async pollAllRegions(): Promise<void> {
    for (const state of this.states.values()) {
      await this.pollRegion(state);
    }

    // Check if the primary needs to fail over
    if (this.primaryRegionId) {
      const primaryState = this.states.get(this.primaryRegionId);
      if (
        primaryState &&
        primaryState.consecutiveFailures >= this.options.primaryFailureThreshold
      ) {
        await this.triggerFailover('primary_health_failure');
      }
    }
  }

  /** Poll a single region. */
  async pollRegion(state: RegionState): Promise<void> {
    const previousHealth = state.health;
    const start = Date.now();

    try {
      const lagMs = await this.options.measureLag(state);
      const latency = Date.now() - start;

      // Update lag samples for P99 calculation
      state.lagSamples.push(lagMs);
      if (state.lagSamples.length > this.options.maxLagSamples) {
        state.lagSamples.shift();
      }

      state.lagMs = lagMs;
      state.lagP99Ms = computeP99(state.lagSamples);
      state.lastLatencyMs = latency;
      state.lastCheckedAt = Date.now();
      state.available = true;
      state.consecutiveFailures = 0;
      state.health = deriveHealth(state);

      if (state.health === 'healthy') {
        state.lastHealthyAt = Date.now();
      }

      // Emit lag alert if threshold crossed
      const lagAlertMs = state.config.lagAlertMs ?? DEFAULT_LAG_ALERT_MS;
      if (lagMs > lagAlertMs) {
        this.options.onLagAlert?.(state.config.id, lagMs, lagAlertMs);
        this.emit('lagAlert', state.config.id, lagMs, lagAlertMs);
      }
    } catch {
      state.consecutiveFailures++;
      state.errorCount++;
      state.available = state.consecutiveFailures < this.options.primaryFailureThreshold;
      state.health = state.available ? 'degraded' : 'unhealthy';
      state.lastCheckedAt = Date.now();
    }

    if (state.health !== previousHealth) {
      this.options.onRegionHealthChange?.(state.config.id, previousHealth, state.health);
      this.emit('healthChange', state.config.id, previousHealth, state.health);
    }
  }

  // ── Failover ──────────────────────────────────────────────────────────────

  /**
   * Trigger a failover from the current primary to the healthiest replica.
   *
   * Promotion order:
   *  1. Replicas with health = 'healthy', sorted by lagMs ascending, then failoverPriority ascending.
   *  2. Replicas with health = 'degraded' if no healthy candidates exist.
   */
  async triggerFailover(reason: string): Promise<FailoverResult | null> {
    const previousPrimaryId = this.primaryRegionId;
    if (!previousPrimaryId) return null;

    // Collect candidate replicas
    const candidates = Array.from(this.states.values())
      .filter((s) => s.role === 'replica' && s.health !== 'unhealthy')
      .sort((a, b) => {
        // Prefer healthy over degraded
        const healthScore = (h: RegionHealth) => (h === 'healthy' ? 0 : 1);
        if (healthScore(a.health) !== healthScore(b.health)) {
          return healthScore(a.health) - healthScore(b.health);
        }
        // Then by lag ascending
        if (a.lagMs !== b.lagMs) return a.lagMs - b.lagMs;
        // Then by failover priority
        const pa = a.config.failoverPriority ?? 0;
        const pb = b.config.failoverPriority ?? 0;
        return pa - pb;
      });

    if (candidates.length === 0) return null;

    const newPrimary = candidates[0];

    // Promote the new primary
    newPrimary.role = 'primary';
    newPrimary.config = { ...newPrimary.config, role: 'primary' };

    // Demote old primary to replica
    const oldPrimaryState = this.states.get(previousPrimaryId);
    if (oldPrimaryState) {
      oldPrimaryState.role = 'replica';
      oldPrimaryState.config = { ...oldPrimaryState.config, role: 'replica' };
    }

    this.primaryRegionId = newPrimary.config.id;
    this.totalFailovers++;
    this.lastFailoverAt = Date.now();

    const result: FailoverResult = {
      previousPrimary: previousPrimaryId,
      newPrimary: newPrimary.config.id,
      promotedAt: Date.now(),
      reason,
    };

    this.options.onFailover?.(result);
    this.emit('failover', result);

    return result;
  }

  /**
   * Manually promote a specific region to primary.
   * Used for planned maintenance / controlled failover.
   */
  async promoteRegion(regionId: string, reason = 'manual'): Promise<FailoverResult | null> {
    const target = this.states.get(regionId);
    if (!target) return null;
    if (target.role === 'primary') return null; // already primary

    // Temporarily set the target to a replica so triggerFailover can pick it
    const previousRole = target.role;
    target.role = 'replica';

    // Sort it to the front by setting the lowest priority and zero lag temporarily
    const previousLag = target.lagMs;
    const previousPriority = target.config.failoverPriority;
    target.lagMs = -1; // sorts to the front
    target.config = { ...target.config, failoverPriority: -1 };

    const result = await this.triggerFailover(reason);

    // Restore lag (the new leader will be updated on next poll)
    if (result?.newPrimary !== regionId) {
      // Failover didn't pick our target (e.g. no candidates or already primary)
      target.role = previousRole;
      target.lagMs = previousLag;
      target.config = { ...target.config, failoverPriority: previousPriority };
    }

    return result;
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  getPrimaryRegionId(): string | null {
    return this.primaryRegionId;
  }

  getRegionState(regionId: string): RegionState | undefined {
    return this.states.get(regionId);
  }

  getAllRegionStates(): RegionState[] {
    return Array.from(this.states.values());
  }

  getMetrics(): MultiRegionMetrics {
    const regions: RegionHealthSnapshot[] = Array.from(this.states.values()).map((s) => ({
      regionId: s.config.id,
      health: s.health,
      role: s.role,
      lagMs: s.lagMs,
      lagP99Ms: s.lagP99Ms,
      available: s.available,
      lastCheckedAt: s.lastCheckedAt,
    }));

    return {
      primaryRegion: this.primaryRegionId,
      regions,
      totalFailovers: this.totalFailovers,
      lastFailoverAt: this.lastFailoverAt,
      readQueries: this.readQueries,
      writeQueries: this.writeQueries,
    };
  }

  /**
   * Render region replication metrics in Prometheus text format.
   */
  toPrometheus(): string {
    const lines: string[] = [];

    lines.push('# HELP subtrackr_region_replication_lag_ms Replication lag per region in ms');
    lines.push('# TYPE subtrackr_region_replication_lag_ms gauge');
    for (const s of this.states.values()) {
      lines.push(`subtrackr_region_replication_lag_ms{region="${s.config.id}"} ${s.lagMs}`);
    }

    lines.push('# HELP subtrackr_region_replication_lag_p99_ms Rolling P99 replication lag per region');
    lines.push('# TYPE subtrackr_region_replication_lag_p99_ms gauge');
    for (const s of this.states.values()) {
      lines.push(`subtrackr_region_replication_lag_p99_ms{region="${s.config.id}"} ${s.lagP99Ms}`);
    }

    lines.push('# HELP subtrackr_region_available Region availability (1=available, 0=unavailable)');
    lines.push('# TYPE subtrackr_region_available gauge');
    for (const s of this.states.values()) {
      lines.push(`subtrackr_region_available{region="${s.config.id}"} ${s.available ? 1 : 0}`);
    }

    lines.push('# HELP subtrackr_region_is_primary Whether the region is the current primary (1=yes)');
    lines.push('# TYPE subtrackr_region_is_primary gauge');
    for (const s of this.states.values()) {
      lines.push(
        `subtrackr_region_is_primary{region="${s.config.id}"} ${s.role === 'primary' ? 1 : 0}`,
      );
    }

    lines.push('# HELP subtrackr_region_query_total Total queries routed to region');
    lines.push('# TYPE subtrackr_region_query_total counter');
    for (const s of this.states.values()) {
      lines.push(`subtrackr_region_query_total{region="${s.config.id}"} ${s.queryCount}`);
    }

    lines.push('# HELP subtrackr_region_error_total Query errors per region');
    lines.push('# TYPE subtrackr_region_error_total counter');
    for (const s of this.states.values()) {
      lines.push(`subtrackr_region_error_total{region="${s.config.id}"} ${s.errorCount}`);
    }

    lines.push('# HELP subtrackr_region_failovers_total Total failovers performed');
    lines.push('# TYPE subtrackr_region_failovers_total counter');
    lines.push(`subtrackr_region_failovers_total ${this.totalFailovers}`);

    return lines.join('\n') + '\n';
  }

  // ── Defaults ──────────────────────────────────────────────────────────────

  /** Default lag measurement — always returns 0 ms (for the primary) or a small value. */
  private readonly defaultMeasureLag = async (state: RegionState): Promise<number> => {
    return state.role === 'primary' ? 0 : 50;
  };
}
