export type AdaptiveThrottleLevel = 'normal' | 'reduced_50' | 'reduced_90';

export interface RateLimitBehaviorFeatures {
  requestRatePerMinute: number;
  endpointDistribution: Record<string, number>;
  timeOfDayBucket: number;
  payloadSizeAvg: number;
  userAgentEntropy: number;
  geographicSpread: number;
}

export interface RateLimitAnomalyEvent {
  id: string;
  apiKey: string;
  userId?: string;
  score: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detectedAt: number;
  adaptiveThrottleLevel: AdaptiveThrottleLevel;
  features: RateLimitBehaviorFeatures;
  reasons: string[];
  suggestedAction: string;
}

export interface AdaptiveRateLimitDecision {
  allowed: boolean;
  anomalyScore: number;
  threshold: number;
  throttleLevel: AdaptiveThrottleLevel;
  effectiveHourlyLimit: number;
  retryAfterMs?: number;
  event?: RateLimitAnomalyEvent;
}

export interface BehavioralProfile {
  apiKey: string;
  userId?: string;
  allowlisted?: boolean;
  manualThrottleLevel?: AdaptiveThrottleLevel;
  seasonalProfile?: string;
}
