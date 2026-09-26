/**
 * Tier-Based Quota Enforcement Service — SubTrackr
 *
 * Issue #1155: Build rate limiting with tier-based quotas
 *
 * Extends the core RateLimitingService with:
 *   - Per-tier quota policies with configurable windows
 *   - Hard vs. soft quota enforcement (warn vs. block)
 *   - Quota reset scheduling (hourly / daily / monthly)
 *   - Overage tracking and billing signals
 *   - Quota override / entitlement grants for specific API keys
 *   - Prometheus-compatible metrics export
 *   - Quota exhaustion webhooks
 */

import { SubscriptionTier } from '../../src/types/subscription';
import {
  TIER_RATE_LIMITS,
  SOFT_LIMIT_WARNINGS,
  getRateLimitTierConfig,
  mapSubscriptionToRateLimitTier,
  type TierRateLimit,
  type RateLimitTier,
} from '../../src/types/rateLimiting';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuotaWindow = 'hourly' | 'daily' | 'monthly';
export type QuotaEnforcementMode = 'hard' | 'soft';

export interface QuotaPolicy {
  /** SubscriptionTier this policy applies to */
  tier: SubscriptionTier;
  hourlyLimit: number;
  dailyLimit: number;
  monthlyLimit: number;
  burstLimit: number;
  concurrentLimit: number;
  refillRatePerSecond: number;
  /** soft: warn only; hard: block at 100% */
  enforcementMode: QuotaEnforcementMode;
  /** 0–1; send warning event when usage crosses this fraction */
  softWarningThreshold: number;
  /** 0–1; if enforcementMode === 'soft', block at this fraction (>1 = never block) */
  softBlockThreshold: number;
}

export interface QuotaGrant {
  apiKey: string;
  tier: SubscriptionTier;
  /** Extra requests on top of tier limits per window */
  extraHourly: number;
  extraDaily: number;
  extraMonthly: number;
  /** ISO timestamp when this grant expires (null = permanent) */
  expiresAt: string | null;
  reason: string;
  grantedBy: string;
  grantedAt: string;
}

export interface QuotaUsageSnapshot {
  apiKey: string;
  tier: SubscriptionTier;
  window: QuotaWindow;
  used: number;
  limit: number;
  remaining: number;
  usagePercent: number;
  resetAt: number;
  isSoftWarning: boolean;
  isExhausted: boolean;
  overageCount: number;
}

export interface QuotaOverageEvent {
  apiKey: string;
  tier: SubscriptionTier;
  window: QuotaWindow;
  limit: number;
  attempted: number;
  timestamp: number;
}

export interface QuotaMetrics {
  totalPolicies: number;
  totalActiveGrants: number;
  overageEventCount: number;
  topOverageKeys: { apiKey: string; count: number }[];
  usageByTier: Record<
    SubscriptionTier,
    { keys: number; avgHourlyUsagePct: number; softWarningCount: number }
  >;
}

// ---------------------------------------------------------------------------
// Internal state shapes
// ---------------------------------------------------------------------------

interface QuotaUsageState {
  apiKey: string;
  tier: SubscriptionTier;
  hourly: number;
  daily: number;
  monthly: number;
  hourlyResetAt: number;
  dailyResetAt: number;
  monthlyResetAt: number;
  overageHourly: number;
  overageDaily: number;
  overageMonthly: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;
const ONE_MONTH_MS = 2_592_000_000;

function nowMs(): number {
  return Date.now();
}

function alignedResetTime(windowMs: number): number {
  return Math.floor((nowMs() + windowMs) / windowMs) * windowMs;
}

// ---------------------------------------------------------------------------
// Default quota policies (mirrors TIER_RATE_LIMITS)
// ---------------------------------------------------------------------------

const DEFAULT_POLICIES: Record<SubscriptionTier, QuotaPolicy> = Object.fromEntries(
  Object.values(SubscriptionTier).map((tier) => {
    const trl: TierRateLimit = TIER_RATE_LIMITS[tier];
    return [
      tier,
      {
        tier,
        hourlyLimit: trl.hourlyLimit,
        dailyLimit: trl.dailyLimit,
        monthlyLimit: trl.monthlyLimit,
        burstLimit: trl.burstLimit,
        concurrentLimit: trl.concurrentLimit,
        refillRatePerSecond: trl.refillRatePerSecond,
        enforcementMode: tier === SubscriptionTier.ENTERPRISE ? 'soft' : 'hard',
        softWarningThreshold: SOFT_LIMIT_WARNINGS[0],
        softBlockThreshold: tier === SubscriptionTier.ENTERPRISE ? 1.1 : 1.0,
      } satisfies QuotaPolicy,
    ];
  }),
) as Record<SubscriptionTier, QuotaPolicy>;

// ---------------------------------------------------------------------------
// TierQuotaService
// ---------------------------------------------------------------------------

export class TierQuotaService {
  /** Customised per-tier policies (fallback: DEFAULT_POLICIES) */
  private policies = new Map<SubscriptionTier, QuotaPolicy>();

  /** Per-key usage counters */
  private usageMap = new Map<string, QuotaUsageState>();

  /** Active entitlement grants (key → grant) */
  private grants = new Map<string, QuotaGrant>();

  /** Overage event log */
  private overageEvents: QuotaOverageEvent[] = [];
  private readonly maxOverageEvents = 50_000;

  /** Registered overage webhook callbacks */
  private overageHandlers: Array<(evt: QuotaOverageEvent) => void> = [];

  // -------------------------------------------------------------------------
  // Policy management
  // -------------------------------------------------------------------------

  setPolicy(tier: SubscriptionTier, policy: Partial<QuotaPolicy>): QuotaPolicy {
    const base = this.getPolicy(tier);
    const updated: QuotaPolicy = { ...base, ...policy, tier };
    this.policies.set(tier, updated);
    return updated;
  }

  getPolicy(tier: SubscriptionTier): QuotaPolicy {
    return this.policies.get(tier) ?? DEFAULT_POLICIES[tier];
  }

  getAllPolicies(): QuotaPolicy[] {
    return Object.values(SubscriptionTier).map((t) => this.getPolicy(t as SubscriptionTier));
  }

  resetPolicyToDefault(tier: SubscriptionTier): void {
    this.policies.delete(tier);
  }

  // -------------------------------------------------------------------------
  // Entitlement grants
  // -------------------------------------------------------------------------

  grantQuota(grant: Omit<QuotaGrant, 'grantedAt'>): QuotaGrant {
    const full: QuotaGrant = { ...grant, grantedAt: new Date().toISOString() };
    this.grants.set(grant.apiKey, full);
    return full;
  }

  revokeGrant(apiKey: string): boolean {
    return this.grants.delete(apiKey);
  }

  getGrant(apiKey: string): QuotaGrant | undefined {
    const grant = this.grants.get(apiKey);
    if (!grant) return undefined;
    if (grant.expiresAt && new Date(grant.expiresAt).getTime() < nowMs()) {
      this.grants.delete(apiKey);
      return undefined;
    }
    return grant;
  }

  listGrants(): QuotaGrant[] {
    const now = nowMs();
    const expired: string[] = [];
    const active: QuotaGrant[] = [];
    for (const [key, grant] of this.grants) {
      if (grant.expiresAt && new Date(grant.expiresAt).getTime() < now) {
        expired.push(key);
      } else {
        active.push(grant);
      }
    }
    for (const key of expired) this.grants.delete(key);
    return active;
  }

  // -------------------------------------------------------------------------
  // Effective limits (policy + grant)
  // -------------------------------------------------------------------------

  getEffectiveLimits(
    apiKey: string,
    tier: SubscriptionTier,
  ): {
    hourlyLimit: number;
    dailyLimit: number;
    monthlyLimit: number;
    burstLimit: number;
    concurrentLimit: number;
    refillRatePerSecond: number;
  } {
    const policy = this.getPolicy(tier);
    const grant = this.getGrant(apiKey);
    return {
      hourlyLimit: policy.hourlyLimit + (grant?.extraHourly ?? 0),
      dailyLimit: policy.dailyLimit + (grant?.extraDaily ?? 0),
      monthlyLimit: policy.monthlyLimit + (grant?.extraMonthly ?? 0),
      burstLimit: policy.burstLimit,
      concurrentLimit: policy.concurrentLimit,
      refillRatePerSecond: policy.refillRatePerSecond,
    };
  }

  // -------------------------------------------------------------------------
  // Usage state helpers
  // -------------------------------------------------------------------------

  private getOrCreateState(apiKey: string, tier: SubscriptionTier): QuotaUsageState {
    const existing = this.usageMap.get(apiKey);
    if (existing) {
      existing.tier = tier;
      return existing;
    }
    const state: QuotaUsageState = {
      apiKey,
      tier,
      hourly: 0,
      daily: 0,
      monthly: 0,
      hourlyResetAt: alignedResetTime(ONE_HOUR_MS),
      dailyResetAt: alignedResetTime(ONE_DAY_MS),
      monthlyResetAt: alignedResetTime(ONE_MONTH_MS),
      overageHourly: 0,
      overageDaily: 0,
      overageMonthly: 0,
    };
    this.usageMap.set(apiKey, state);
    return state;
  }

  private tickResets(state: QuotaUsageState): void {
    const ts = nowMs();
    if (ts >= state.hourlyResetAt) {
      state.hourly = 0;
      state.overageHourly = 0;
      state.hourlyResetAt = alignedResetTime(ONE_HOUR_MS);
    }
    if (ts >= state.dailyResetAt) {
      state.daily = 0;
      state.overageDaily = 0;
      state.dailyResetAt = alignedResetTime(ONE_DAY_MS);
    }
    if (ts >= state.monthlyResetAt) {
      state.monthly = 0;
      state.overageMonthly = 0;
      state.monthlyResetAt = alignedResetTime(ONE_MONTH_MS);
    }
  }

  // -------------------------------------------------------------------------
  // Core quota check
  // -------------------------------------------------------------------------

  /**
   * Check whether the API key is within its tier quota.
   * Does NOT consume usage — call `recordQuotaUsage` after the request.
   */
  checkQuota(
    apiKey: string,
    tier: SubscriptionTier,
  ): { allowed: boolean; retryAfterMs?: number; window?: QuotaWindow; reason?: string } {
    const state = this.getOrCreateState(apiKey, tier);
    this.tickResets(state);

    const limits = this.getEffectiveLimits(apiKey, tier);
    const policy = this.getPolicy(tier);
    const ts = nowMs();

    // Monthly quota
    const monthlyPct = state.monthly / limits.monthlyLimit;
    if (this.isBlocked(monthlyPct, policy)) {
      return {
        allowed: false,
        retryAfterMs: state.monthlyResetAt - ts,
        window: 'monthly',
        reason: `Monthly quota exhausted (${state.monthly}/${limits.monthlyLimit})`,
      };
    }

    // Daily quota
    const dailyPct = state.daily / limits.dailyLimit;
    if (this.isBlocked(dailyPct, policy)) {
      return {
        allowed: false,
        retryAfterMs: state.dailyResetAt - ts,
        window: 'daily',
        reason: `Daily quota exhausted (${state.daily}/${limits.dailyLimit})`,
      };
    }

    // Hourly quota
    const hourlyPct = state.hourly / limits.hourlyLimit;
    if (this.isBlocked(hourlyPct, policy)) {
      return {
        allowed: false,
        retryAfterMs: state.hourlyResetAt - ts,
        window: 'hourly',
        reason: `Hourly quota exhausted (${state.hourly}/${limits.hourlyLimit})`,
      };
    }

    return { allowed: true };
  }

  private isBlocked(usagePct: number, policy: QuotaPolicy): boolean {
    if (policy.enforcementMode === 'hard') {
      return usagePct >= 1.0;
    }
    // Soft mode: block only if soft block threshold is exceeded
    return usagePct >= policy.softBlockThreshold;
  }

  // -------------------------------------------------------------------------
  // Usage recording
  // -------------------------------------------------------------------------

  recordQuotaUsage(
    apiKey: string,
    tier: SubscriptionTier,
  ): {
    softWarnings: Array<{ window: QuotaWindow; usagePercent: number; message: string }>;
    overageEvents: QuotaOverageEvent[];
  } {
    const state = this.getOrCreateState(apiKey, tier);
    this.tickResets(state);

    const limits = this.getEffectiveLimits(apiKey, tier);
    const policy = this.getPolicy(tier);
    const ts = nowMs();

    state.hourly += 1;
    state.daily += 1;
    state.monthly += 1;

    const softWarnings: Array<{ window: QuotaWindow; usagePercent: number; message: string }> = [];
    const overageEvents: QuotaOverageEvent[] = [];

    const windows: Array<{
      window: QuotaWindow;
      used: number;
      limit: number;
      overage: keyof Pick<QuotaUsageState, 'overageHourly' | 'overageDaily' | 'overageMonthly'>;
      resetAt: number;
    }> = [
      {
        window: 'hourly',
        used: state.hourly,
        limit: limits.hourlyLimit,
        overage: 'overageHourly',
        resetAt: state.hourlyResetAt,
      },
      {
        window: 'daily',
        used: state.daily,
        limit: limits.dailyLimit,
        overage: 'overageDaily',
        resetAt: state.dailyResetAt,
      },
      {
        window: 'monthly',
        used: state.monthly,
        limit: limits.monthlyLimit,
        overage: 'overageMonthly',
        resetAt: state.monthlyResetAt,
      },
    ];

    for (const w of windows) {
      const pct = w.used / w.limit;

      // Soft warning
      if (pct >= policy.softWarningThreshold && pct < 1.0) {
        softWarnings.push({
          window: w.window,
          usagePercent: Math.round(pct * 100),
          message: `${w.window} quota at ${Math.round(pct * 100)}% (${w.used}/${w.limit})`,
        });
      }

      // Overage
      if (w.used > w.limit) {
        state[w.overage] += 1;
        const evt: QuotaOverageEvent = {
          apiKey,
          tier,
          window: w.window,
          limit: w.limit,
          attempted: w.used,
          timestamp: ts,
        };
        overageEvents.push(evt);
        this.recordOverageEvent(evt);
      }
    }

    return { softWarnings, overageEvents };
  }

  private recordOverageEvent(evt: QuotaOverageEvent): void {
    this.overageEvents.push(evt);
    if (this.overageEvents.length > this.maxOverageEvents) {
      this.overageEvents = this.overageEvents.slice(-this.maxOverageEvents / 2);
    }
    for (const handler of this.overageHandlers) {
      try {
        handler(evt);
      } catch {
        // swallow handler errors
      }
    }
  }

  // -------------------------------------------------------------------------
  // Overage webhook registration
  // -------------------------------------------------------------------------

  onOverage(handler: (evt: QuotaOverageEvent) => void): () => void {
    this.overageHandlers.push(handler);
    return () => {
      this.overageHandlers = this.overageHandlers.filter((h) => h !== handler);
    };
  }

  // -------------------------------------------------------------------------
  // Usage snapshot
  // -------------------------------------------------------------------------

  getUsageSnapshot(apiKey: string, tier: SubscriptionTier): QuotaUsageSnapshot[] {
    const state = this.getOrCreateState(apiKey, tier);
    this.tickResets(state);
    const limits = this.getEffectiveLimits(apiKey, tier);
    const policy = this.getPolicy(tier);
    const ts = nowMs();

    const windows: Array<{
      window: QuotaWindow;
      used: number;
      limit: number;
      resetAt: number;
      overage: number;
    }> = [
      {
        window: 'hourly',
        used: state.hourly,
        limit: limits.hourlyLimit,
        resetAt: state.hourlyResetAt,
        overage: state.overageHourly,
      },
      {
        window: 'daily',
        used: state.daily,
        limit: limits.dailyLimit,
        resetAt: state.dailyResetAt,
        overage: state.overageDaily,
      },
      {
        window: 'monthly',
        used: state.monthly,
        limit: limits.monthlyLimit,
        resetAt: state.monthlyResetAt,
        overage: state.overageMonthly,
      },
    ];

    void ts;

    return windows.map((w) => {
      const pct = w.limit > 0 ? w.used / w.limit : 0;
      return {
        apiKey,
        tier,
        window: w.window,
        used: w.used,
        limit: w.limit,
        remaining: Math.max(0, w.limit - w.used),
        usagePercent: Math.round(pct * 100),
        resetAt: w.resetAt,
        isSoftWarning: pct >= policy.softWarningThreshold && pct < 1.0,
        isExhausted: this.isBlocked(pct, policy),
        overageCount: w.overage,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Bulk reset (admin)
  // -------------------------------------------------------------------------

  resetUsage(apiKey: string): void {
    this.usageMap.delete(apiKey);
  }

  resetAllUsage(): void {
    this.usageMap.clear();
  }

  // -------------------------------------------------------------------------
  // Tier comparison / upgrade recommendation
  // -------------------------------------------------------------------------

  getUpgradeRecommendation(
    apiKey: string,
    tier: SubscriptionTier,
  ): { shouldUpgrade: boolean; recommendedTier?: SubscriptionTier; reason?: string } {
    const snapshots = this.getUsageSnapshot(apiKey, tier);
    const hourly = snapshots.find((s) => s.window === 'hourly');
    const policy = this.getPolicy(tier);

    if (!hourly) return { shouldUpgrade: false };

    const pct = hourly.usagePercent / 100;
    if (pct < policy.softWarningThreshold) return { shouldUpgrade: false };

    // Find next tier
    const tierOrder: SubscriptionTier[] = [
      SubscriptionTier.FREE,
      SubscriptionTier.BASIC,
      SubscriptionTier.PREMIUM,
      SubscriptionTier.ENTERPRISE,
    ];
    const idx = tierOrder.indexOf(tier);
    if (idx < 0 || idx >= tierOrder.length - 1) return { shouldUpgrade: false };

    const nextTier = tierOrder[idx + 1];
    return {
      shouldUpgrade: true,
      recommendedTier: nextTier,
      reason: `Hourly quota usage at ${hourly.usagePercent}% — consider upgrading to ${nextTier}`,
    };
  }

  // -------------------------------------------------------------------------
  // Prometheus metrics
  // -------------------------------------------------------------------------

  prometheusMetrics(): string {
    const lines: string[] = [];

    // Overage counts by tier
    const overageByTier: Record<string, number> = {};
    for (const evt of this.overageEvents) {
      overageByTier[evt.tier] = (overageByTier[evt.tier] ?? 0) + 1;
    }

    lines.push('# HELP subtrackr_quota_overages_total Total quota overage events by tier and window');
    lines.push('# TYPE subtrackr_quota_overages_total counter');
    for (const [tier, count] of Object.entries(overageByTier)) {
      lines.push(`subtrackr_quota_overages_total{tier="${tier}"} ${count}`);
    }

    // Active grants
    lines.push('# HELP subtrackr_quota_grants_active Number of active entitlement grants');
    lines.push('# TYPE subtrackr_quota_grants_active gauge');
    lines.push(`subtrackr_quota_grants_active ${this.listGrants().length}`);

    // Policies
    for (const policy of this.getAllPolicies()) {
      const t = policy.tier;
      lines.push(`# HELP subtrackr_quota_limit_hourly{tier="${t}"} Hourly request limit`);
      lines.push(`subtrackr_quota_limit_hourly{tier="${t}"} ${policy.hourlyLimit}`);
      lines.push(`subtrackr_quota_limit_daily{tier="${t}"} ${policy.dailyLimit}`);
      lines.push(`subtrackr_quota_limit_monthly{tier="${t}"} ${policy.monthlyLimit}`);
    }

    return lines.join('\n') + '\n';
  }

  // -------------------------------------------------------------------------
  // Summary metrics (JSON)
  // -------------------------------------------------------------------------

  getMetrics(): QuotaMetrics {
    const overageByKey = new Map<string, number>();
    for (const evt of this.overageEvents) {
      overageByKey.set(evt.apiKey, (overageByKey.get(evt.apiKey) ?? 0) + 1);
    }

    const usageByTier: Record<
      SubscriptionTier,
      { keys: number; avgHourlyUsagePct: number; softWarningCount: number }
    > = {
      [SubscriptionTier.FREE]: { keys: 0, avgHourlyUsagePct: 0, softWarningCount: 0 },
      [SubscriptionTier.BASIC]: { keys: 0, avgHourlyUsagePct: 0, softWarningCount: 0 },
      [SubscriptionTier.PREMIUM]: { keys: 0, avgHourlyUsagePct: 0, softWarningCount: 0 },
      [SubscriptionTier.ENTERPRISE]: { keys: 0, avgHourlyUsagePct: 0, softWarningCount: 0 },
    };

    for (const state of this.usageMap.values()) {
      const tier = state.tier;
      const limits = this.getEffectiveLimits(state.apiKey, tier);
      const policy = this.getPolicy(tier);
      const pct = limits.hourlyLimit > 0 ? (state.hourly / limits.hourlyLimit) * 100 : 0;
      const tUsage = usageByTier[tier];
      const prev = tUsage.avgHourlyUsagePct * tUsage.keys;
      tUsage.keys += 1;
      tUsage.avgHourlyUsagePct = (prev + pct) / tUsage.keys;
      if (pct / 100 >= policy.softWarningThreshold) tUsage.softWarningCount += 1;
    }

    const topOverageKeys = Array.from(overageByKey.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([apiKey, count]) => ({ apiKey, count }));

    return {
      totalPolicies: this.policies.size,
      totalActiveGrants: this.listGrants().length,
      overageEventCount: this.overageEvents.length,
      topOverageKeys,
      usageByTier,
    };
  }
}

// Singleton
export const tierQuotaService = new TierQuotaService();

// Re-export helpers for convenience
export { mapSubscriptionToRateLimitTier, getRateLimitTierConfig };
export type { RateLimitTier };
