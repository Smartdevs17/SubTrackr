import { SubscriptionTier } from './subscription';

// ---------------------------------------------------------------------------
// Public-facing rate limit tier (coarser than the internal SubscriptionTier)
// ---------------------------------------------------------------------------

export type RateLimitTier = 'free' | 'pro' | 'enterprise';

export interface RateLimitTierConfig {
  tier: RateLimitTier;
  /** Requests/hour */
  requestsPerHour: number;
  /** Requests/day */
  requestsPerDay: number;
  /** Requests/month */
  requestsPerMonth: number;
  /** Token-bucket burst capacity */
  burstCapacity: number;
  /** Concurrent requests allowed */
  concurrentRequests: number;
  /** Token refill rate (tokens/second) */
  refillRatePerSecond: number;
  /** Soft-limit warning threshold (0–1) */
  softLimitThreshold: number;
}

/** Map internal SubscriptionTier to public RateLimitTier */
export function mapSubscriptionToRateLimitTier(tier: SubscriptionTier): RateLimitTier {
  switch (tier) {
    case SubscriptionTier.FREE:
      return 'free';
    case SubscriptionTier.BASIC:
      return 'pro';
    case SubscriptionTier.PREMIUM:
      return 'pro';
    case SubscriptionTier.ENTERPRISE:
      return 'enterprise';
    default:
      return 'free';
  }
}

/** Get the full config for a public RateLimitTier */
export function getRateLimitTierConfig(tier: RateLimitTier): RateLimitTierConfig {
  return RATE_LIMIT_TIER_CONFIGS[tier];
}

export const RATE_LIMIT_TIER_CONFIGS: Record<RateLimitTier, RateLimitTierConfig> = {
  free: {
    tier: 'free',
    requestsPerHour: 100,
    requestsPerDay: 500,
    requestsPerMonth: 10_000,
    burstCapacity: 20,
    concurrentRequests: 2,
    refillRatePerSecond: 0.028, // ~100/hour
    softLimitThreshold: 0.8,
  },
  pro: {
    tier: 'pro',
    requestsPerHour: 1_000,
    requestsPerDay: 10_000,
    requestsPerMonth: 200_000,
    burstCapacity: 100,
    concurrentRequests: 10,
    refillRatePerSecond: 0.278, // ~1000/hour
    softLimitThreshold: 0.8,
  },
  enterprise: {
    tier: 'enterprise',
    requestsPerHour: 10_000,
    requestsPerDay: 100_000,
    requestsPerMonth: 2_000_000,
    burstCapacity: 500,
    concurrentRequests: 50,
    refillRatePerSecond: 2.778, // ~10000/hour
    softLimitThreshold: 0.9,
  },
};

export interface TierRateLimit {
  tier: SubscriptionTier;
  hourlyLimit: number;
  dailyLimit: number;
  monthlyLimit: number;
  burstLimit: number;
  concurrentLimit: number;
  /** Tokens added to bucket per second */
  refillRatePerSecond: number;
}

export interface ApiKeyUsage {
  apiKey: string;
  tier: SubscriptionTier;
  hourly: number;
  daily: number;
  monthly: number;
  hourlyResetAt: number;
  dailyResetAt: number;
  monthlyResetAt: number;
  lastRequestAt: number;
  burstTokens: number;
  lastBurstRefill: number;
  concurrentRequests: number;
}

export interface UsageMeteringEntry {
  apiKey: string;
  endpoint: string;
  timestamp: number;
  statusCode: number;
  latencyMs: number;
  tier: SubscriptionTier;
}

export interface RateLimitExceededError {
  status: 429;
  error: 'rate_limit_exceeded';
  message: string;
  retryAfterMs: number;
  limit: number;
  remaining: number;
  resetAt: number;
  tier: SubscriptionTier;
}

export interface SoftLimitWarning {
  warning: 'soft_limit_reached';
  usagePercent: number;
  limit: number;
  current: number;
  tier: SubscriptionTier;
  message: string;
}

export interface UsageAnalytics {
  totalRequests: number;
  requestsByTier: Record<SubscriptionTier, number>;
  requestsByEndpoint: Record<string, number>;
  averageLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  rateLimitHitCount: number;
  topEndpoints: { endpoint: string; count: number }[];
  hourlyBreakdown: { hour: string; count: number }[];
}

export interface TierUpgradeRecommendation {
  currentTier: SubscriptionTier;
  recommendedTier: SubscriptionTier;
  reason: string;
  sustainedUsage: number;
  threshold: number;
  estimatedSavings: number;
}

export const TIER_RATE_LIMITS: Record<SubscriptionTier, TierRateLimit> = {
  [SubscriptionTier.FREE]: {
    tier: SubscriptionTier.FREE,
    hourlyLimit: 100,
    dailyLimit: 500,
    monthlyLimit: 10_000,
    burstLimit: 20,
    concurrentLimit: 2,
    refillRatePerSecond: 0.028,
  },
  [SubscriptionTier.BASIC]: {
    tier: SubscriptionTier.BASIC,
    hourlyLimit: 500,
    dailyLimit: 2_500,
    monthlyLimit: 50_000,
    burstLimit: 50,
    concurrentLimit: 5,
    refillRatePerSecond: 0.139,
  },
  [SubscriptionTier.PREMIUM]: {
    tier: SubscriptionTier.PREMIUM,
    hourlyLimit: 1_000,
    dailyLimit: 10_000,
    monthlyLimit: 200_000,
    burstLimit: 100,
    concurrentLimit: 10,
    refillRatePerSecond: 0.278,
  },
  [SubscriptionTier.ENTERPRISE]: {
    tier: SubscriptionTier.ENTERPRISE,
    hourlyLimit: 10_000,
    dailyLimit: 100_000,
    monthlyLimit: 2_000_000,
    burstLimit: 500,
    concurrentLimit: 50,
    refillRatePerSecond: 2.778,
  },
};

export const SOFT_LIMIT_WARNINGS = [0.8, 0.95] as const;

export const TIER_UPGRADE_THRESHOLDS: Record<SubscriptionTier, { usagePercent: number; sustainedHours: number }> = {
  [SubscriptionTier.FREE]: { usagePercent: 0.8, sustainedHours: 48 },
  [SubscriptionTier.BASIC]: { usagePercent: 0.8, sustainedHours: 48 },
  [SubscriptionTier.PREMIUM]: { usagePercent: 0.9, sustainedHours: 72 },
  [SubscriptionTier.ENTERPRISE]: { usagePercent: 0.95, sustainedHours: 168 },
};

const TIER_ORDER: SubscriptionTier[] = [
  SubscriptionTier.FREE,
  SubscriptionTier.BASIC,
  SubscriptionTier.PREMIUM,
  SubscriptionTier.ENTERPRISE,
];

export function getNextTier(currentTier: SubscriptionTier): SubscriptionTier | null {
  const idx = TIER_ORDER.indexOf(currentTier);
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1];
}
