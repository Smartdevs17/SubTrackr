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
import { RateLimitAnomalyService } from './rateLimitAnomalyService';

const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;
const ONE_MONTH_MS = 2_592_000_000;

const now = (): number => Date.now();

const createId = (prefix: string): string =>
  `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function computeResetTime(periodMs: number): number {
  return Math.floor((now() + periodMs) / periodMs) * periodMs;
}

export class RateLimitingService {
  private usages = new Map<string, ApiKeyUsage>();
  private requestLog: UsageMeteringEntry[] = [];
  private readonly maxLogEntries = 100_000;
  private readonly anomalyService = new RateLimitAnomalyService();

  getOrCreateUsage(apiKey: string, tier: SubscriptionTier): ApiKeyUsage {
    const existing = this.usages.get(apiKey);
    if (existing) {
      existing.tier = tier;
      return existing;
    }

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
      burstTokens: TIER_RATE_LIMITS[tier].burstLimit,
      lastBurstRefill: now(),
      concurrentRequests: 0,
    };

    this.usages.set(apiKey, usage);
    return usage;
  }

  checkRateLimit(
    apiKey: string,
    tier: SubscriptionTier,
    context?: {
      userId?: string;
      endpoint?: string;
      payloadSize?: number;
      userAgent?: string;
      country?: string;
    }
  ): { allowed: boolean; retryAfterMs?: number; anomalyScore?: number; throttleLevel?: string } {
    const usage = this.getOrCreateUsage(apiKey, tier);
    let limits = TIER_RATE_LIMITS[tier];
    const now_ts = now();

    this.resetIfExpired(usage);

    const anomalyDecision = this.anomalyService.evaluate(
      {
        apiKey,
        userId: context?.userId,
        endpoint: context?.endpoint ?? 'unknown',
        payloadSize: context?.payloadSize,
        userAgent: context?.userAgent,
        country: context?.country,
      },
      tier
    );

    if (anomalyDecision.throttleLevel !== 'normal') {
      limits = {
        ...limits,
        hourlyLimit: anomalyDecision.effectiveHourlyLimit,
      };
    }

    const hourlyRemaining = limits.hourlyLimit - usage.hourly;
    const dailyRemaining = limits.dailyLimit - usage.daily;
    const monthlyRemaining = limits.monthlyLimit - usage.monthly;

    if (monthlyRemaining <= 0) {
      return {
        allowed: false,
        retryAfterMs: usage.monthlyResetAt - now_ts,
        anomalyScore: anomalyDecision.anomalyScore,
        throttleLevel: anomalyDecision.throttleLevel,
      };
    }
    if (dailyRemaining <= 0) {
      return {
        allowed: false,
        retryAfterMs: usage.dailyResetAt - now_ts,
        anomalyScore: anomalyDecision.anomalyScore,
        throttleLevel: anomalyDecision.throttleLevel,
      };
    }
    if (hourlyRemaining <= 0) {
      return {
        allowed: false,
        retryAfterMs: usage.hourlyResetAt - now_ts,
        anomalyScore: anomalyDecision.anomalyScore,
        throttleLevel: anomalyDecision.throttleLevel,
      };
    }

    this.refillBurstTokens(usage, limits);
    if (usage.burstTokens <= 0) {
      return {
        allowed: false,
        retryAfterMs: 1_000,
        anomalyScore: anomalyDecision.anomalyScore,
        throttleLevel: anomalyDecision.throttleLevel,
      };
    }

    if (usage.concurrentRequests >= limits.concurrentLimit) {
      return {
        allowed: false,
        retryAfterMs: 500,
        anomalyScore: anomalyDecision.anomalyScore,
        throttleLevel: anomalyDecision.throttleLevel,
      };
    }

    return {
      allowed: true,
      anomalyScore: anomalyDecision.anomalyScore,
      throttleLevel: anomalyDecision.throttleLevel,
    };
  }

  recordRequest(
    apiKey: string,
    tier: SubscriptionTier,
    endpoint: string,
    statusCode: number,
    latencyMs: number
  ): { softWarning?: SoftLimitWarning; rateLimitError?: RateLimitExceededError } {
    const usage = this.getOrCreateUsage(apiKey, tier);
    const limits = TIER_RATE_LIMITS[tier];

    this.resetIfExpired(usage);

    usage.hourly += 1;
    usage.daily += 1;
    usage.monthly += 1;
    usage.lastRequestAt = now();
    usage.burstTokens -= 1;
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
    this.anomalyService.recordUsage(entry);

    if (this.requestLog.length > this.maxLogEntries) {
      this.requestLog = this.requestLog.slice(-this.maxLogEntries / 2);
    }

    const hourlyUsagePct = usage.hourly / limits.hourlyLimit;
    const softWarning = SOFT_LIMIT_WARNINGS.find((w) => hourlyUsagePct >= w)
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

  getUsage(apiKey: string): ApiKeyUsage | undefined {
    const usage = this.usages.get(apiKey);
    if (usage) {
      this.resetIfExpired(usage);
    }
    return usage;
  }

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
      hourlyBreakdown: [],
    };
  }

  checkTierUpgrade(apiKey: string): TierUpgradeRecommendation | null {
    const usage = this.usages.get(apiKey);
    if (!usage) return null;
    this.resetIfExpired(usage);

    const nextTier = getNextTier(usage.tier);
    if (!nextTier) return null;

    const limits = TIER_RATE_LIMITS[usage.tier];
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

  getRateLimitStatus(apiKey: string, tier: SubscriptionTier): {
    limits: TierRateLimit;
    current: { hourly: number; daily: number; monthly: number; burstTokens: number };
    remaining: { hourly: number; daily: number; monthly: number; burstTokens: number };
    resetAt: { hourly: number; daily: number; monthly: number };
  } {
    const usage = this.getOrCreateUsage(apiKey, tier);
    this.resetIfExpired(usage);
    const limits = TIER_RATE_LIMITS[tier];

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

  getRecentAnomalies(limit = 50) {
    return this.anomalyService.listRecentAnomalies(limit);
  }

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
