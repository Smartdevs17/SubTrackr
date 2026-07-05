import { SubscriptionTier } from './subscription';

export interface TierRateLimit {
  tier: SubscriptionTier;
  hourlyLimit: number;
  dailyLimit: number;
  monthlyLimit: number;
  burstLimit: number;
  concurrentLimit: number;
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
  },
  [SubscriptionTier.BASIC]: {
    tier: SubscriptionTier.BASIC,
    hourlyLimit: 500,
    dailyLimit: 2_500,
    monthlyLimit: 50_000,
    burstLimit: 50,
    concurrentLimit: 5,
  },
  [SubscriptionTier.PREMIUM]: {
    tier: SubscriptionTier.PREMIUM,
    hourlyLimit: 1_000,
    dailyLimit: 10_000,
    monthlyLimit: 200_000,
    burstLimit: 100,
    concurrentLimit: 10,
  },
  [SubscriptionTier.ENTERPRISE]: {
    tier: SubscriptionTier.ENTERPRISE,
    hourlyLimit: 10_000,
    dailyLimit: 100_000,
    monthlyLimit: 2_000_000,
    burstLimit: 500,
    concurrentLimit: 50,
  },
};

export const SOFT_LIMIT_WARNINGS = [0.8, 0.95] as const;

export const TIER_UPGRADE_THRESHOLDS: Record<
  SubscriptionTier,
  { usagePercent: number; sustainedHours: number }
> = {
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
