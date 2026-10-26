/**
 * Issue #776 – Pure plan comparison + recommendation engine (no RN deps).
 */

import type {
  BillingCycle,
  ComparablePlan,
  CompareOptions,
  ComparisonAnalytics,
  ComparisonShare,
  ComparedPairStat,
  PlanComparisonResult,
  PlanDiff,
  PlanFeature,
  PlanRecommendation,
  PreferenceProfile,
  PriceDiffEntry,
  RecommendationScore,
  RecommendationTrackingEvent,
  TopRecommendedStat,
  UsageLevel,
} from '../types/planComparison';

const BILLING_TO_MONTHLY: Record<BillingCycle, number> = {
  daily: 30,
  weekly: 52 / 12,
  monthly: 1,
  yearly: 1 / 12,
};

const USAGE_TIER_TARGET: Record<UsageLevel, number> = {
  light: 1,
  moderate: 2,
  heavy: 3,
  enterprise: 4,
};

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createToken(): string {
  return `pcs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Convert plan price to a monthly-equivalent amount. */
export function normalizePrice(price: number, cycle: BillingCycle): number {
  return Math.round(price * BILLING_TO_MONTHLY[cycle] * 100) / 100;
}

function featureNumericValue(value: boolean | string | number): number | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickFeatureWinner(plans: ComparablePlan[], featureId: string): string | undefined {
  let bestPlanId: string | undefined;
  let bestScore = -Infinity;

  for (const plan of plans) {
    const feature = plan.features.find((f) => f.id === featureId);
    if (!feature) continue;
    const score = featureNumericValue(feature.value);
    if (score === null) continue;
    if (score > bestScore) {
      bestScore = score;
      bestPlanId = plan.id;
    }
  }

  return bestPlanId;
}

function buildFeatureMatrix(plans: ComparablePlan[], options?: CompareOptions): PlanDiff[] {
  const featureMap = new Map<string, { name: string; category?: string }>();

  for (const plan of plans) {
    for (const feature of plan.features) {
      if (options?.categories?.length && feature.category) {
        if (!options.categories.includes(feature.category)) continue;
      }
      if (!featureMap.has(feature.id)) {
        featureMap.set(feature.id, { name: feature.name, category: feature.category });
      }
    }
  }

  const matrix: PlanDiff[] = [];

  for (const [featureId, meta] of featureMap) {
    const values: Record<string, boolean | string | number | null> = {};
    const unique = new Set<string>();

    for (const plan of plans) {
      const feature = plan.features.find((f) => f.id === featureId);
      const value = feature?.value ?? null;
      values[plan.id] = value;
      unique.add(JSON.stringify(value));
    }

    if (options?.highlightDifferencesOnly && unique.size === 1) {
      continue;
    }

    matrix.push({
      featureId,
      featureName: meta.name,
      category: meta.category,
      values,
      winnerPlanId: pickFeatureWinner(plans, featureId),
    });
  }

  return matrix;
}

function buildPriceDiffs(
  plans: ComparablePlan[],
  normalizeTo: 'monthly' | 'yearly' = 'monthly'
): PriceDiffEntry[] {
  const factor = normalizeTo === 'yearly' ? 12 : 1;
  const normalized = plans.map((p) => ({
    planId: p.id,
    normalizedPrice: Math.round(normalizePrice(p.price, p.billingCycle) * factor * 100) / 100,
  }));

  const prices = normalized.map((n) => n.normalizedPrice);
  const cheapest = Math.min(...prices);
  const mostExpensive = Math.max(...prices);

  return normalized.map((n) => ({
    planId: n.planId,
    normalizedPrice: n.normalizedPrice,
    vsCheapest: Math.round((n.normalizedPrice - cheapest) * 100) / 100,
    vsMostExpensive: Math.round((mostExpensive - n.normalizedPrice) * 100) / 100,
  }));
}

function countEnabledFeatures(plan: ComparablePlan): number {
  return plan.features.filter((f) => {
    if (typeof f.value === 'boolean') return f.value;
    if (typeof f.value === 'number') return f.value > 0;
    return f.value !== '' && f.value !== 'none';
  }).length;
}

function computeWinners(
  plans: ComparablePlan[],
  priceDiffs: PriceDiffEntry[],
  featureMatrix: PlanDiff[]
): PlanComparisonResult['winners'] {
  const cheapest =
    [...priceDiffs].sort((a, b) => a.normalizedPrice - b.normalizedPrice)[0]?.planId ?? plans[0].id;

  const mostFeatures =
    [...plans].sort((a, b) => countEnabledFeatures(b) - countEnabledFeatures(a))[0]?.id ??
    plans[0].id;

  // best value = features per dollar (avoid divide-by-zero)
  const bestValue =
    [...plans]
      .map((p) => {
        const price =
          priceDiffs.find((d) => d.planId === p.id)?.normalizedPrice ??
          normalizePrice(p.price, p.billingCycle);
        const features = countEnabledFeatures(p);
        return { id: p.id, ratio: features / Math.max(price, 0.01) };
      })
      .sort((a, b) => b.ratio - a.ratio)[0]?.id ?? plans[0].id;

  const byCategory: Record<string, string> = {};
  const categories = new Set(
    featureMatrix.map((d) => d.category).filter((c): c is string => Boolean(c))
  );

  for (const category of categories) {
    const catDiffs = featureMatrix.filter((d) => d.category === category);
    const wins = new Map<string, number>();
    for (const diff of catDiffs) {
      if (!diff.winnerPlanId) continue;
      wins.set(diff.winnerPlanId, (wins.get(diff.winnerPlanId) ?? 0) + 1);
    }
    let top: string | undefined;
    let topCount = -1;
    for (const [planId, count] of wins) {
      if (count > topCount) {
        top = planId;
        topCount = count;
      }
    }
    if (top) byCategory[category] = top;
  }

  return { cheapest, mostFeatures, bestValue, byCategory };
}

/**
 * Compare two or more plans: feature matrix, price diffs, winners per category.
 */
export function comparePlans(
  plans: ComparablePlan[],
  options?: CompareOptions
): PlanComparisonResult {
  if (plans.length < 2) {
    throw new Error('At least two plans are required for comparison');
  }

  const ids = new Set(plans.map((p) => p.id));
  if (ids.size !== plans.length) {
    throw new Error('Duplicate plan ids are not allowed');
  }

  const featureMatrix = buildFeatureMatrix(plans, options);
  const priceDiffs = buildPriceDiffs(plans, options?.normalizeBillingCycle ?? 'monthly');
  const winners = computeWinners(plans, priceDiffs, featureMatrix);

  return {
    id: createId('cmp'),
    plans,
    featureMatrix,
    priceDiffs,
    winners,
    createdAt: Date.now(),
  };
}

function scoreBudgetFit(monthlyPrice: number, budget?: number): number {
  if (budget === undefined || budget <= 0) return 0.5;
  if (monthlyPrice <= budget) {
    // Prefer using most of the budget without exceeding
    return Math.min(1, 0.6 + (monthlyPrice / budget) * 0.4);
  }
  // Over budget — penalize proportionally
  const overshoot = monthlyPrice / budget;
  return Math.max(0, 1 - (overshoot - 1));
}

function scoreFeatureMatch(
  plan: ComparablePlan,
  required: string[] = [],
  preferred: string[] = []
): { score: number; missingRequired: string[]; matchedPreferred: string[] } {
  const featureIds = new Set(
    plan.features
      .filter((f) => {
        if (typeof f.value === 'boolean') return f.value;
        if (typeof f.value === 'number') return f.value > 0;
        return true;
      })
      .map((f) => f.id)
  );

  const missingRequired = required.filter((id) => !featureIds.has(id));
  if (missingRequired.length > 0) {
    return { score: 0, missingRequired, matchedPreferred: [] };
  }

  const matchedPreferred = preferred.filter((id) => featureIds.has(id));
  const preferredScore = preferred.length === 0 ? 0.7 : matchedPreferred.length / preferred.length;

  return { score: preferredScore, missingRequired: [], matchedPreferred };
}

function scoreUsageFit(plan: ComparablePlan, usageLevel?: UsageLevel): number {
  if (!usageLevel) return 0.5;
  const target = USAGE_TIER_TARGET[usageLevel];
  const tier = plan.tierRank ?? Math.min(4, Math.max(1, Math.ceil(countEnabledFeatures(plan) / 3)));
  const distance = Math.abs(tier - target);
  return Math.max(0, 1 - distance * 0.25);
}

function scoreValue(plan: ComparablePlan, monthlyPrice: number): number {
  const features = countEnabledFeatures(plan);
  const ratio = features / Math.max(monthlyPrice, 0.01);
  // Soft-cap normalization
  return Math.min(1, ratio / 2);
}

/**
 * Rank plans against a preference profile with scored reasons.
 */
export function recommendPlan(
  plans: ComparablePlan[],
  profile: PreferenceProfile
): PlanRecommendation[] {
  if (plans.length === 0) {
    throw new Error('At least one plan is required for recommendations');
  }

  const required = profile.requiredFeatures ?? [];
  const preferred = profile.preferredFeatures ?? [];
  const maxResults = profile.maxResults ?? plans.length;

  const scored: PlanRecommendation[] = [];

  for (const plan of plans) {
    if (profile.currentPlanId && plan.id === profile.currentPlanId) {
      continue;
    }

    const monthly = normalizePrice(plan.price, plan.billingCycle);
    const feature = scoreFeatureMatch(plan, required, preferred);

    // Hard filter: missing required features
    if (feature.missingRequired.length > 0) {
      continue;
    }

    const budgetFit = scoreBudgetFit(monthly, profile.budget);
    const usageFit = scoreUsageFit(plan, profile.usageLevel);
    const valueScore = scoreValue(plan, monthly);

    const weights = profile.prioritizeValue
      ? { budget: 0.2, feature: 0.25, usage: 0.15, value: 0.4 }
      : { budget: 0.3, feature: 0.35, usage: 0.2, value: 0.15 };

    const total =
      budgetFit * weights.budget +
      feature.score * weights.feature +
      usageFit * weights.usage +
      valueScore * weights.value;

    const score: RecommendationScore = {
      planId: plan.id,
      total: Math.round(total * 1000) / 1000,
      breakdown: {
        budgetFit: Math.round(budgetFit * 1000) / 1000,
        featureMatch: Math.round(feature.score * 1000) / 1000,
        usageFit: Math.round(usageFit * 1000) / 1000,
        valueScore: Math.round(valueScore * 1000) / 1000,
      },
    };

    const reasons: string[] = [];
    if (profile.budget !== undefined && monthly <= profile.budget) {
      reasons.push(`Fits budget ($${monthly}/mo ≤ $${profile.budget})`);
    }
    if (feature.matchedPreferred.length > 0) {
      reasons.push(`Includes preferred features: ${feature.matchedPreferred.join(', ')}`);
    }
    if (required.length > 0) {
      reasons.push('Meets all required features');
    }
    if (profile.usageLevel) {
      reasons.push(`Aligned with ${profile.usageLevel} usage`);
    }
    if (score.breakdown.valueScore >= 0.6) {
      reasons.push('Strong features-per-dollar value');
    }
    if (plan.popular) {
      reasons.push('Popular plan');
    }
    if (reasons.length === 0) {
      reasons.push('Competitive overall match');
    }

    scored.push({
      planId: plan.id,
      planName: plan.name,
      rank: 0,
      score,
      reasons,
      estimatedMonthlyCost: monthly,
    });
  }

  scored.sort((a, b) => b.score.total - a.score.total);
  return scored.slice(0, maxResults).map((r, i) => ({ ...r, rank: i + 1 }));
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * In-memory tracker for recommendation events, comparisons, and shares.
 */
export class PlanRecommendationTracker {
  private events: RecommendationTrackingEvent[] = [];
  private comparisons: PlanComparisonResult[] = [];
  private recommendationCounts = new Map<string, number>();
  private pairCounts = new Map<string, number>();
  private shares = new Map<string, ComparisonShare>();

  reset(): void {
    this.events = [];
    this.comparisons = [];
    this.recommendationCounts.clear();
    this.pairCounts.clear();
    this.shares.clear();
  }

  recordComparison(result: PlanComparisonResult): void {
    this.comparisons.push(result);
    const ids = result.plans.map((p) => p.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = pairKey(ids[i], ids[j]);
        this.pairCounts.set(key, (this.pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  recordRecommendations(recs: PlanRecommendation[]): void {
    for (const rec of recs) {
      this.recommendationCounts.set(
        rec.planId,
        (this.recommendationCounts.get(rec.planId) ?? 0) + 1
      );
    }
  }

  track(
    event: Omit<RecommendationTrackingEvent, 'id' | 'occurredAt'> & {
      id?: string;
      occurredAt?: number;
    }
  ): RecommendationTrackingEvent {
    const stored: RecommendationTrackingEvent = {
      id: event.id ?? createId('evt'),
      recommendationId: event.recommendationId,
      planId: event.planId,
      eventType: event.eventType,
      userId: event.userId,
      comparisonId: event.comparisonId,
      metadata: event.metadata,
      occurredAt: event.occurredAt ?? Date.now(),
    };
    this.events.push(stored);
    return stored;
  }

  getEvents(): RecommendationTrackingEvent[] {
    return [...this.events];
  }

  getComparisons(): PlanComparisonResult[] {
    return [...this.comparisons];
  }

  createShare(
    comparisonId: string,
    planIds: string[],
    payload?: PlanComparisonResult,
    ttlMs?: number
  ): ComparisonShare {
    const token = createToken();
    const share: ComparisonShare = {
      token,
      comparisonId,
      planIds,
      createdAt: Date.now(),
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
      payload,
    };
    this.shares.set(token, share);
    return share;
  }

  resolveShare(token: string): ComparisonShare | null {
    const share = this.shares.get(token);
    if (!share) return null;
    if (share.expiresAt && share.expiresAt < Date.now()) {
      this.shares.delete(token);
      return null;
    }
    return share;
  }

  getAnalytics(): ComparisonAnalytics {
    const impressions = this.events.filter((e) => e.eventType === 'impression').length;
    const clicks = this.events.filter((e) => e.eventType === 'click').length;
    const accepts = this.events.filter((e) => e.eventType === 'accept').length;
    const dismissals = this.events.filter((e) => e.eventType === 'dismiss').length;

    const mostComparedPairs: ComparedPairStat[] = [...this.pairCounts.entries()]
      .map(([key, count]) => {
        const [planA, planB] = key.split('|');
        return { planA, planB, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topRecommended: TopRecommendedStat[] = [...this.recommendationCounts.entries()]
      .map(([planId, count]) => ({ planId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalComparisons: this.comparisons.length,
      totalRecommendations: [...this.recommendationCounts.values()].reduce((a, b) => a + b, 0),
      impressions,
      clicks,
      accepts,
      dismissals,
      conversionRate: impressions > 0 ? Math.round((accepts / impressions) * 1000) / 1000 : 0,
      clickThroughRate: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 1000 : 0,
      mostComparedPairs,
      topRecommended,
    };
  }
}

/** Shared default tracker instance for module-level helpers. */
export const defaultTracker = new PlanRecommendationTracker();

export function trackRecommendationEvent(
  event: Omit<RecommendationTrackingEvent, 'id' | 'occurredAt'> & {
    id?: string;
    occurredAt?: number;
  },
  tracker: PlanRecommendationTracker = defaultTracker
): RecommendationTrackingEvent {
  return tracker.track(event);
}

export function getComparisonAnalytics(
  tracker: PlanRecommendationTracker = defaultTracker
): ComparisonAnalytics {
  return tracker.getAnalytics();
}

export function createComparisonShare(
  comparisonId: string,
  planIds: string[],
  payload?: PlanComparisonResult,
  ttlMs?: number,
  tracker: PlanRecommendationTracker = defaultTracker
): ComparisonShare {
  return tracker.createShare(comparisonId, planIds, payload, ttlMs);
}

export function resolveComparisonShare(
  token: string,
  tracker: PlanRecommendationTracker = defaultTracker
): ComparisonShare | null {
  return tracker.resolveShare(token);
}

/** Convenience: compare + record analytics. */
export function compareAndTrack(
  plans: ComparablePlan[],
  options?: CompareOptions,
  tracker: PlanRecommendationTracker = defaultTracker
): PlanComparisonResult {
  const result = comparePlans(plans, options);
  tracker.recordComparison(result);
  tracker.track({
    recommendationId: result.id,
    planId: plans.map((p) => p.id).join(','),
    eventType: 'compare',
    comparisonId: result.id,
  });
  return result;
}

/** Convenience: recommend + record analytics. */
export function recommendAndTrack(
  plans: ComparablePlan[],
  profile: PreferenceProfile,
  tracker: PlanRecommendationTracker = defaultTracker
): PlanRecommendation[] {
  const recs = recommendPlan(plans, profile);
  tracker.recordRecommendations(recs);
  return recs;
}

export type { PlanFeature };
