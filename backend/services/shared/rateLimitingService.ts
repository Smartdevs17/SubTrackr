import { SubscriptionTier } from '../../src/types/subscription';
import {
  TIER_RATE_LIMITS,
  SOFT_LIMIT_WARNINGS,
  TIER_UPGRADE_THRESHOLDS,
  getNextTier,
  type ApiKeyUsage,
  type RateLimitExceededError,
  type SoftLimitWarning,
  type TierRateLimit,
  type UsageAnalytics,
  type UsageMeteringEntry,
  type TierUpgradeRecommendation,
} from '../../src/types/rateLimiting';

const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;
const ONE_MONTH_MS = 2_592_000_000;

const now = (): number => Date.now();

function computeResetTime(periodMs: number): number {
  return Math.floor((now() + periodMs) / periodMs) * periodMs;
}

// ---------------------------------------------------------------------------
// Per-user limit multiplier: users aggregate across all keys they own
// ---------------------------------------------------------------------------
const USER_HOURLY_MULTIPLIER = 5; // user gets 5× the per-key hourly limit

// ---------------------------------------------------------------------------
// Bypass configuration
// ---------------------------------------------------------------------------
export interface BypassConfig {
  /** API keys that are fully exempt from rate limiting. */
  keys?: Set<string>;
  /** User IDs that are fully exempt from rate limiting. */
  userIds?: Set<string>;
  /** URL path prefixes that skip rate limiting (health, metrics, etc.). */
  paths?: string[];
}

// ---------------------------------------------------------------------------
// Per-key custom limits (override tier defaults)
// ---------------------------------------------------------------------------
export interface CustomLimits {
  hourlyLimit?: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  burstLimit?: number;
  concurrentLimit?: number;
}

export class RateLimitingService {
  private usages = new Map<string, ApiKeyUsage>();
  /** Separate tracking bucket for per-user aggregated usage */
  private userUsages = new Map<string, ApiKeyUsage>();
  private requestLog: UsageMeteringEntry[] = [];
  private readonly maxLogEntries = 100_000;

  /** Bypass configuration — mutate at runtime to add/remove trusted clients */
  public bypass: BypassConfig = {
    keys: new Set(),
    userIds: new Set(),
    paths: ['/health', '/metrics', '/metrics/plan-cache'],
  };

  /** Per-key custom limit overrides */
  private customLimits = new Map<string, CustomLimits>();

  // -------------------------------------------------------------------------
  // Bypass management
  // -------------------------------------------------------------------------

  addBypassKey(apiKey: string): void {
    this.bypass.keys ??= new Set();
    this.bypass.keys.add(apiKey);
  }

  removeBypassKey(apiKey: string): boolean {
    return this.bypass.keys?.delete(apiKey) ?? false;
  }

  addBypassUser(userId: string): void {
    this.bypass.userIds ??= new Set();
    this.bypass.userIds.add(userId);
  }

  removeBypassUser(userId: string): boolean {
    return this.bypass.userIds?.delete(userId) ?? false;
  }

  isBypassed(key: string, isUserId = false): boolean {
    if (isUserId) return this.bypass.userIds?.has(key) ?? false;
    return this.bypass.keys?.has(key) ?? false;
  }

  listBypassKeys(): string[] {
    return Array.from(this.bypass.keys ?? []);
  }

  listBypassUsers(): string[] {
    return Array.from(this.bypass.userIds ?? []);
  }

  // -------------------------------------------------------------------------
  // Custom limit configuration
  // -------------------------------------------------------------------------

  setCustomLimits(apiKey: string, limits: CustomLimits): void {
    this.customLimits.set(apiKey, limits);
  }

  clearCustomLimits(apiKey: string): void {
    this.customLimits.delete(apiKey);
  }

  getEffectiveLimits(apiKey: string, tier: SubscriptionTier): TierRateLimit {
    const tierLimits = TIER_RATE_LIMITS[tier];
    const custom = this.customLimits.get(apiKey);
    if (!custom) return tierLimits;

    return {
      tier: tierLimits.tier,
      hourlyLimit: custom.hourlyLimit ?? tierLimits.hourlyLimit,
      dailyLimit: custom.dailyLimit ?? tierLimits.dailyLimit,
      monthlyLimit: custom.monthlyLimit ?? tierLimits.monthlyLimit,
      burstLimit: custom.burstLimit ?? tierLimits.burstLimit,
      concurrentLimit: custom.concurrentLimit ?? tierLimits.concurrentLimit,
    };
  }

  // -------------------------------------------------------------------------
  // Core: per-API-key usage
  // -------------------------------------------------------------------------

  getOrCreateUsage(apiKey: string, tier: SubscriptionTier): ApiKeyUsage {
    const existing = this.usages.get(apiKey);
    if (existing) {
      existing.tier = tier;
      return existing;
    }

    const limits = this.getEffectiveLimits(apiKey, tier);
    const usage: ApiKeyUsage = {
      apiKey,
      tier,
      hourly: 0,
      daily: 0,
      monthly: 0,
      hourlyResetAt: computeResetTime(ONE_HOUR_MS),
      dailyResetAt: computeResetTime(ONE_DAY_MS),
      monthlyResetAt: computeResetTime(ONE_MONTH_MS),
      lastRequestAt: 0,
      burstTokens: limits.burstLimit,
      lastBurstRefill: now(),
      concurrentRequests: 0,
    };

    this.usages.set(apiKey, usage);
    return usage;
  }

  checkRateLimit(
    apiKey: string,
    tier: SubscriptionTier,
  ): { allowed: boolean; retryAfterMs?: number } {
    // Bypass check
    if (this.isBypassed(apiKey)) return { allowed: true };

    const usage = this.getOrCreateUsage(apiKey, tier);
    const limits = this.getEffectiveLimits(apiKey, tier);
    const now_ts = now();

    this.resetIfExpired(usage);

    if (limits.monthlyLimit - usage.monthly <= 0) {
      return { allowed: false, retryAfterMs: usage.monthlyResetAt - now_ts };
    }
    if (limits.dailyLimit - usage.daily <= 0) {
      return { allowed: false, retryAfterMs: usage.dailyResetAt - now_ts };
    }
    if (limits.hourlyLimit - usage.hourly <= 0) {
      return { allowed: false, retryAfterMs: usage.hourlyResetAt - now_ts };
    }

    this.refillBurstTokens(usage, limits);
    if (usage.burstTokens <= 0) {
      return { allowed: false, retryAfterMs: 1_000 };
    }
    if (usage.concurrentRequests >= limits.concurrentLimit) {
      return { allowed: false, retryAfterMs: 500 };
    }

    return { allowed: true };
  }

  recordRequest(
    apiKey: string,
    tier: SubscriptionTier,
    endpoint: string,
    statusCode: number,
    latencyMs: number,
  ): { softWarning?: SoftLimitWarning; rateLimitError?: RateLimitExceededError } {
    const usage = this.getOrCreateUsage(apiKey, tier);
    const limits = this.getEffectiveLimits(apiKey, tier);

    this.resetIfExpired(usage);

    usage.hourly += 1;
    usage.daily += 1;
    usage.monthly += 1;
    usage.lastRequestAt = now();
    usage.burstTokens = Math.max(0, usage.burstTokens - 1);
    usage.concurrentRequests += 1;

    setTimeout(() => {
      usage.concurrentRequests = Math.max(0, usage.concurrentRequests - 1);
    }, 0);

    const entry: UsageMeteringEntry = {
      apiKey,
      endpoint,
      timestamp: now(),
      statusCode,
      latencyMs,
      tier,
    };

    this.requestLog.push(entry);
    if (this.requestLog.length > this.maxLogEntries) {
      this.requestLog = this.requestLog.slice(-this.maxLogEntries / 2);
    }

    const hourlyUsagePct = usage.hourly / limits.hourlyLimit;
    const softWarning =
      SOFT_LIMIT_WARNINGS.find((w) => hourlyUsagePct >= w) !== undefined
        ? {
            warning: 'soft_limit_reached' as const,
            usagePercent: Math.round(hourlyUsagePct * 100),
            limit: limits.hourlyLimit,
            current: usage.hourly,
            tier,
            message: `API usage at ${Math.round(hourlyUsagePct * 100)}% of hourly limit (${usage.hourly}/${limits.hourlyLimit})`,
          }
        : undefined;

    let rateLimitError: RateLimitExceededError | undefined;
    if (hourlyUsagePct >= 1) {
      rateLimitError = {
        status: 429,
        error: 'rate_limit_exceeded',
        message: `Hourly rate limit exceeded for ${tier} tier. Limit: ${limits.hourlyLimit} requests/hour.`,
        retryAfterMs: usage.hourlyResetAt - now(),
        limit: limits.hourlyLimit,
        remaining: 0,
        resetAt: usage.hourlyResetAt,
        tier,
      };
    }

    return { softWarning, rateLimitError };
  }

  // -------------------------------------------------------------------------
  // Per-user aggregated rate limiting
  // -------------------------------------------------------------------------

  private getOrCreateUserUsage(userKey: string, tier: SubscriptionTier): ApiKeyUsage {
    const existing = this.userUsages.get(userKey);
    if (existing) {
      existing.tier = tier;
      return existing;
    }

    const tierLimits = TIER_RATE_LIMITS[tier];
    const usage: ApiKeyUsage = {
      apiKey: userKey,
      tier,
      hourly: 0,
      daily: 0,
      monthly: 0,
      hourlyResetAt: computeResetTime(ONE_HOUR_MS),
      dailyResetAt: computeResetTime(ONE_DAY_MS),
      monthlyResetAt: computeResetTime(ONE_MONTH_MS),
      lastRequestAt: 0,
      burstTokens: tierLimits.burstLimit * USER_HOURLY_MULTIPLIER,
      lastBurstRefill: now(),
      concurrentRequests: 0,
    };

    this.userUsages.set(userKey, usage);
    return usage;
  }

  /**
   * Check per-user aggregate rate limit.
   * `userKey` should be prefixed, e.g. `user:abc123`.
   */
  checkUserRateLimit(
    userKey: string,
    tier: SubscriptionTier,
  ): { allowed: boolean; retryAfterMs?: number } {
    const userId = userKey.replace(/^user:/, '');
    if (this.isBypassed(userId, true)) return { allowed: true };

    const usage = this.getOrCreateUserUsage(userKey, tier);
    const tierLimits = TIER_RATE_LIMITS[tier];
    const now_ts = now();

    this.resetIfExpired(usage);

    const userHourlyLimit = tierLimits.hourlyLimit * USER_HOURLY_MULTIPLIER;
    const userDailyLimit = tierLimits.dailyLimit * USER_HOURLY_MULTIPLIER;
    const userMonthlyLimit = tierLimits.monthlyLimit * USER_HOURLY_MULTIPLIER;

    if (userMonthlyLimit - usage.monthly <= 0) {
      return { allowed: false, retryAfterMs: usage.monthlyResetAt - now_ts };
    }
    if (userDailyLimit - usage.daily <= 0) {
      return { allowed: false, retryAfterMs: usage.dailyResetAt - now_ts };
    }
    if (userHourlyLimit - usage.hourly <= 0) {
      return { allowed: false, retryAfterMs: usage.hourlyResetAt - now_ts };
    }

    return { allowed: true };
  }

  /** Record a request against per-user aggregate counters. */
  recordUserRequest(userKey: string, tier: SubscriptionTier, endpoint: string): void {
    const usage = this.getOrCreateUserUsage(userKey, tier);
    this.resetIfExpired(usage);
    usage.hourly += 1;
    usage.daily += 1;
    usage.monthly += 1;
    usage.lastRequestAt = now();
  }

  getUserRateLimitStatus(
    userKey: string,
    tier: SubscriptionTier,
  ): {
    limits: { hourlyLimit: number; dailyLimit: number; monthlyLimit: number };
    current: { hourly: number; daily: number; monthly: number };
    remaining: { hourly: number; daily: number; monthly: number };
    resetAt: { hourly: number; daily: number; monthly: number };
  } {
    const usage = this.getOrCreateUserUsage(userKey, tier);
    this.resetIfExpired(usage);
    const tierLimits = TIER_RATE_LIMITS[tier];

    const userHourlyLimit = tierLimits.hourlyLimit * USER_HOURLY_MULTIPLIER;
    const userDailyLimit = tierLimits.dailyLimit * USER_HOURLY_MULTIPLIER;
    const userMonthlyLimit = tierLimits.monthlyLimit * USER_HOURLY_MULTIPLIER;

    return {
      limits: {
        hourlyLimit: userHourlyLimit,
        dailyLimit: userDailyLimit,
        monthlyLimit: userMonthlyLimit,
      },
      current: {
        hourly: usage.hourly,
        daily: usage.daily,
        monthly: usage.monthly,
      },
      remaining: {
        hourly: Math.max(0, userHourlyLimit - usage.hourly),
        daily: Math.max(0, userDailyLimit - usage.daily),
        monthly: Math.max(0, userMonthlyLimit - usage.monthly),
      },
      resetAt: {
        hourly: usage.hourlyResetAt,
        daily: usage.dailyResetAt,
        monthly: usage.monthlyResetAt,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Read helpers
  // -------------------------------------------------------------------------

  getUsage(apiKey: string): ApiKeyUsage | undefined {
    const usage = this.usages.get(apiKey);
    if (usage) this.resetIfExpired(usage);
    return usage;
  }

  getRateLimitStatus(
    apiKey: string,
    tier: SubscriptionTier,
  ): {
    limits: TierRateLimit;
    current: { hourly: number; daily: number; monthly: number; burstTokens: number };
    remaining: { hourly: number; daily: number; monthly: number; burstTokens: number };
    resetAt: { hourly: number; daily: number; monthly: number };
  } {
    const usage = this.getOrCreateUsage(apiKey, tier);
    this.resetIfExpired(usage);
    const limits = this.getEffectiveLimits(apiKey, tier);

    return {
      limits,
      current: {
        hourly: usage.hourly,
        daily: usage.daily,
        monthly: usage.monthly,
        burstTokens: usage.burstTokens,
      },
      remaining: {
        hourly: Math.max(0, limits.hourlyLimit - usage.hourly),
        daily: Math.max(0, limits.dailyLimit - usage.daily),
        monthly: Math.max(0, limits.monthlyLimit - usage.monthly),
        burstTokens: Math.max(0, usage.burstTokens),
      },
      resetAt: {
        hourly: usage.hourlyResetAt,
        daily: usage.dailyResetAt,
        monthly: usage.monthlyResetAt,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Analytics
  // -------------------------------------------------------------------------

  getAnalytics(tier?: SubscriptionTier): UsageAnalytics {
    let entries = this.requestLog;
    if (tier) {
      entries = entries.filter((e) => e.tier === tier);
    }

    const totalRequests = entries.length;
    const requestsByTier: Record<SubscriptionTier, number> = {
      [SubscriptionTier.FREE]: 0,
      [SubscriptionTier.BASIC]: 0,
      [SubscriptionTier.PREMIUM]: 0,
      [SubscriptionTier.ENTERPRISE]: 0,
    };

    const requestsByEndpoint: Record<string, number> = {};
    let totalLatencyMs = 0;
    let errorCount = 0;
    let rateLimitHits = 0;

    for (const entry of entries) {
      requestsByTier[entry.tier] = (requestsByTier[entry.tier] ?? 0) + 1;
      requestsByEndpoint[entry.endpoint] = (requestsByEndpoint[entry.endpoint] ?? 0) + 1;
      totalLatencyMs += entry.latencyMs;
      if (entry.statusCode >= 400) errorCount += 1;
      if (entry.statusCode === 429) rateLimitHits += 1;
    }

    const sortedLatencies = entries.map((e) => e.latencyMs).sort((a, b) => a - b);
    const avgLatency = totalRequests > 0 ? totalLatencyMs / totalRequests : 0;
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);

    const topEndpoints = Object.entries(requestsByEndpoint)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([endpoint, count]) => ({ endpoint, count }));

    // Hourly breakdown over the last 24 h
    const hourlyBuckets = new Map<string, number>();
    const nowTs = now();
    for (const entry of entries) {
      const age = nowTs - entry.timestamp;
      if (age > ONE_DAY_MS) continue;
      const hourOffset = Math.floor(age / ONE_HOUR_MS);
      const hourLabel = `${23 - hourOffset}h ago`;
      hourlyBuckets.set(hourLabel, (hourlyBuckets.get(hourLabel) ?? 0) + 1);
    }
    const hourlyBreakdown = Array.from(hourlyBuckets.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    return {
      totalRequests,
      requestsByTier,
      requestsByEndpoint,
      averageLatencyMs: Math.round(avgLatency),
      p95LatencyMs: sortedLatencies[p95Index] ?? 0,
      p99LatencyMs: sortedLatencies[p99Index] ?? 0,
      errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
      rateLimitHitCount: rateLimitHits,
      topEndpoints,
      hourlyBreakdown,
    };
  }

  /**
   * Returns analytics specifically for rate-limit events.
   */
  getRateLimitAnalytics(): {
    totalRequests: number;
    rateLimitHits: number;
    hitRate: number;
    topThrottledKeys: { key: string; hits: number }[];
    topThrottledEndpoints: { endpoint: string; hits: number }[];
    byTier: Record<SubscriptionTier, { requests: number; hits: number; hitRate: number }>;
  } {
    const byKey = new Map<string, number>();
    const byEndpoint = new Map<string, number>();
    const byTier: Record<
      SubscriptionTier,
      { requests: number; hits: number; hitRate: number }
    > = {
      [SubscriptionTier.FREE]: { requests: 0, hits: 0, hitRate: 0 },
      [SubscriptionTier.BASIC]: { requests: 0, hits: 0, hitRate: 0 },
      [SubscriptionTier.PREMIUM]: { requests: 0, hits: 0, hitRate: 0 },
      [SubscriptionTier.ENTERPRISE]: { requests: 0, hits: 0, hitRate: 0 },
    };

    let rateLimitHits = 0;

    for (const entry of this.requestLog) {
      byTier[entry.tier].requests += 1;
      if (entry.statusCode === 429) {
        rateLimitHits += 1;
        byKey.set(entry.apiKey, (byKey.get(entry.apiKey) ?? 0) + 1);
        byEndpoint.set(entry.endpoint, (byEndpoint.get(entry.endpoint) ?? 0) + 1);
        byTier[entry.tier].hits += 1;
      }
    }

    for (const t of Object.values(SubscriptionTier)) {
      const b = byTier[t as SubscriptionTier];
      b.hitRate = b.requests > 0 ? b.hits / b.requests : 0;
    }

    const topThrottledKeys = Array.from(byKey.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([key, hits]) => ({ key, hits }));

    const topThrottledEndpoints = Array.from(byEndpoint.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([endpoint, hits]) => ({ endpoint, hits }));

    return {
      totalRequests: this.requestLog.length,
      rateLimitHits,
      hitRate: this.requestLog.length > 0 ? rateLimitHits / this.requestLog.length : 0,
      topThrottledKeys,
      topThrottledEndpoints,
      byTier,
    };
  }

  // -------------------------------------------------------------------------
  // Tier upgrade recommendation
  // -------------------------------------------------------------------------

  checkTierUpgrade(apiKey: string): TierUpgradeRecommendation | null {
    const usage = this.usages.get(apiKey);
    if (!usage) return null;
    this.resetIfExpired(usage);

    const nextTier = getNextTier(usage.tier);
    if (!nextTier) return null;

    const limits = this.getEffectiveLimits(apiKey, usage.tier);
    const threshold = TIER_UPGRADE_THRESHOLDS[usage.tier];
    const hourlyUsagePct = usage.hourly / limits.hourlyLimit;

    if (hourlyUsagePct >= threshold.usagePercent) {
      const nextLimits = TIER_RATE_LIMITS[nextTier];
      return {
        currentTier: usage.tier,
        recommendedTier: nextTier,
        reason: `Sustained usage at ${Math.round(hourlyUsagePct * 100)}% of ${usage.tier} tier hourly limit`,
        sustainedUsage: usage.hourly,
        threshold: Math.round(limits.hourlyLimit * threshold.usagePercent),
        estimatedSavings: nextLimits.hourlyLimit - limits.hourlyLimit,
      };
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private resetIfExpired(usage: ApiKeyUsage): void {
    const now_ts = now();
    if (now_ts >= usage.hourlyResetAt) {
      usage.hourly = 0;
      usage.hourlyResetAt = computeResetTime(ONE_HOUR_MS);
    }
    if (now_ts >= usage.dailyResetAt) {
      usage.daily = 0;
      usage.dailyResetAt = computeResetTime(ONE_DAY_MS);
    }
    if (now_ts >= usage.monthlyResetAt) {
      usage.monthly = 0;
      usage.monthlyResetAt = computeResetTime(ONE_MONTH_MS);
    }
  }

  private refillBurstTokens(usage: ApiKeyUsage, limits: TierRateLimit): void {
    const now_ts = now();
    const elapsed = now_ts - usage.lastBurstRefill;
    const tokensToAdd = Math.floor(elapsed / 1_000);
    if (tokensToAdd > 0) {
      usage.burstTokens = Math.min(limits.burstLimit, usage.burstTokens + tokensToAdd);
      usage.lastBurstRefill = now_ts;
    }
  }
}

export const rateLimitingService = new RateLimitingService();
