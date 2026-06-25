import { SubscriptionTier } from '../../src/types/subscription';
import { TIER_RATE_LIMITS, type UsageMeteringEntry } from '../../src/types/rateLimiting';
import type {
  AdaptiveRateLimitDecision,
  AdaptiveThrottleLevel,
  BehavioralProfile,
  RateLimitAnomalyEvent,
  RateLimitBehaviorFeatures,
} from '../../src/types/rateLimitAnomaly';

const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_THRESHOLD = 0.8;
const HIGH_CONFIDENCE_THRESHOLD = 0.95;

interface RequestContext {
  apiKey: string;
  userId?: string;
  endpoint: string;
  payloadSize?: number;
  userAgent?: string;
  country?: string;
  timestamp?: number;
}

export class RateLimitAnomalyService {
  private history: UsageMeteringEntry[] = [];
  private profiles = new Map<string, BehavioralProfile>();
  private anomalies: RateLimitAnomalyEvent[] = [];
  private threshold = DEFAULT_THRESHOLD;

  setProfile(profile: BehavioralProfile) {
    this.profiles.set(profile.apiKey, profile);
  }

  listRecentAnomalies(limit = 50) {
    return this.anomalies.slice(-limit).reverse();
  }

  evaluate(ctx: RequestContext, tier: SubscriptionTier): AdaptiveRateLimitDecision {
    const profile = this.profiles.get(ctx.apiKey);
    const ts = ctx.timestamp ?? Date.now();
    const recent = this.history.filter((e) => e.apiKey === ctx.apiKey && ts - e.timestamp <= WINDOW_MS);

    const endpointDistribution: Record<string, number> = {};
    const geos = new Set<string>();
    const uas: string[] = [];
    let payloadTotal = ctx.payloadSize ?? 0;

    for (const item of recent) {
      endpointDistribution[item.endpoint] = (endpointDistribution[item.endpoint] ?? 0) + 1;
    }

    if (ctx.country) geos.add(ctx.country);
    if (ctx.userAgent) uas.push(ctx.userAgent);

    const features: RateLimitBehaviorFeatures = {
      requestRatePerMinute: recent.length / 60,
      endpointDistribution,
      timeOfDayBucket: new Date(ts).getUTCHours(),
      payloadSizeAvg: recent.length ? payloadTotal / Math.max(recent.length, 1) : payloadTotal,
      userAgentEntropy: new Set(uas).size,
      geographicSpread: geos.size,
    };

    let score = Math.min(1, features.requestRatePerMinute / Math.max(1, TIER_RATE_LIMITS[tier].hourlyLimit / 60));
    if (Object.keys(endpointDistribution).length > 6) score += 0.1;
    if (features.userAgentEntropy > 3) score += 0.1;
    if (features.geographicSpread > 2) score += 0.1;
    score = Math.min(1, score);

    const threshold = profile?.allowlisted ? 1.1 : this.threshold;

    let throttleLevel: AdaptiveThrottleLevel = profile?.manualThrottleLevel ?? 'normal';
    if (score >= threshold && throttleLevel === 'normal') {
      throttleLevel = score >= HIGH_CONFIDENCE_THRESHOLD ? 'reduced_90' : 'reduced_50';
    }

    const baseLimit = TIER_RATE_LIMITS[tier].hourlyLimit;
    const effectiveHourlyLimit =
      throttleLevel === 'reduced_90'
        ? Math.max(1, Math.floor(baseLimit * 0.1))
        : throttleLevel === 'reduced_50'
          ? Math.max(1, Math.floor(baseLimit * 0.5))
          : baseLimit;

    let event: RateLimitAnomalyEvent | undefined;
    if (score >= threshold) {
      event = {
        id: `anomaly_${ts}`,
        apiKey: ctx.apiKey,
        userId: ctx.userId,
        score,
        detectedAt: ts,
        adaptiveThrottleLevel: throttleLevel,
        features,
        severity:
          score > HIGH_CONFIDENCE_THRESHOLD
            ? 'critical'
            : score > 0.9
              ? 'high'
              : 'medium',
        reasons: ['request-rate spike', 'endpoint mix deviation'],
        suggestedAction:
          throttleLevel === 'reduced_90'
            ? 'Block or rotate credentials review'
            : 'Temporarily reduce hourly limit and review traffic',
      };

      this.anomalies.push(event);
    }

    return {
      allowed: true,
      anomalyScore: score,
      threshold,
      throttleLevel,
      effectiveHourlyLimit,
      event,
    };
  }

  recordUsage(entry: UsageMeteringEntry) {
    this.history.push(entry);
    this.history = this.history.slice(-50_000);
  }
}
