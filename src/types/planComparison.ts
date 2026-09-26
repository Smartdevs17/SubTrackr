/**
 * Issue #776 – Plan comparison and recommendation engine types.
 * Separate from upsell recommendation types (`upsell.ts`).
 */

export type BillingCycle = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type UsageLevel = 'light' | 'moderate' | 'heavy' | 'enterprise';

export type RecommendationEventType =
  | 'impression'
  | 'click'
  | 'accept'
  | 'dismiss'
  | 'share'
  | 'compare';

export interface PlanFeature {
  id: string;
  name: string;
  category?: string;
  /** boolean flag, numeric limit, or string label */
  value: boolean | string | number;
  unit?: string;
}

export interface ComparablePlan {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  features: PlanFeature[];
  /** Higher = more premium (optional) */
  tierRank?: number;
  popular?: boolean;
}

export interface CompareOptions {
  normalizeBillingCycle?: 'monthly' | 'yearly';
  highlightDifferencesOnly?: boolean;
  categories?: string[];
}

export interface PlanComparisonRequest {
  planIds: string[];
  plans?: ComparablePlan[];
  options?: CompareOptions;
}

export interface PlanDiff {
  featureId: string;
  featureName: string;
  category?: string;
  values: Record<string, boolean | string | number | null>;
  /** Plan with the "best" value for this feature when comparable */
  winnerPlanId?: string;
}

export interface PriceDiffEntry {
  planId: string;
  normalizedPrice: number;
  vsCheapest: number;
  vsMostExpensive: number;
}

export interface CategoryWinners {
  cheapest: string;
  mostFeatures: string;
  bestValue: string;
  byCategory: Record<string, string>;
}

export interface PlanComparisonResult {
  id: string;
  plans: ComparablePlan[];
  featureMatrix: PlanDiff[];
  priceDiffs: PriceDiffEntry[];
  winners: CategoryWinners;
  createdAt: number;
}

export interface RecommendationScoreBreakdown {
  budgetFit: number;
  featureMatch: number;
  usageFit: number;
  valueScore: number;
}

export interface RecommendationScore {
  planId: string;
  total: number;
  breakdown: RecommendationScoreBreakdown;
}

export interface PlanRecommendation {
  planId: string;
  planName: string;
  rank: number;
  score: RecommendationScore;
  reasons: string[];
  estimatedMonthlyCost: number;
}

export interface RecommendationTrackingEvent {
  id: string;
  recommendationId: string;
  planId: string;
  eventType: RecommendationEventType;
  userId?: string;
  comparisonId?: string;
  metadata?: Record<string, string>;
  occurredAt: number;
}

export interface ComparisonShare {
  token: string;
  comparisonId: string;
  planIds: string[];
  createdAt: number;
  expiresAt?: number;
  payload?: PlanComparisonResult;
}

export interface ComparedPairStat {
  planA: string;
  planB: string;
  count: number;
}

export interface TopRecommendedStat {
  planId: string;
  count: number;
}

export interface ComparisonAnalytics {
  totalComparisons: number;
  totalRecommendations: number;
  impressions: number;
  clicks: number;
  accepts: number;
  dismissals: number;
  conversionRate: number;
  clickThroughRate: number;
  mostComparedPairs: ComparedPairStat[];
  topRecommended: TopRecommendedStat[];
}

export interface PreferenceProfile {
  budget?: number;
  currency?: string;
  requiredFeatures?: string[];
  preferredFeatures?: string[];
  usageLevel?: UsageLevel;
  billingCyclePreference?: 'monthly' | 'yearly';
  currentPlanId?: string;
  prioritizeValue?: boolean;
  maxResults?: number;
}
