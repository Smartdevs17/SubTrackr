// Issue 561: Upsell recommendation engine service

import type {
  ABTestVariant,
  CollaborativeFilteringInput,
  ConversionEvent,
  ConversionFunnel,
  MerchantUpsellConfig,
  RecommendationItem,
  RecommendationTrigger,
  RecommendationType,
  UpsellRecommendation,
} from '../../../src/types/upsell';

const now = (): number => Date.now();
const createId = (p: string) => `${p}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Simulated plan catalogue: maps planId -> { type, price, name } */
interface PlanMeta {
  id: string;
  name: string;
  type: RecommendationType;
  price: number;
  tierRank: number; // higher = more premium
}

export class RecommendationService {
  private configs = new Map<string, MerchantUpsellConfig>();
  private plans = new Map<string, PlanMeta>();
  private recommendations = new Map<string, UpsellRecommendation>();
  private events: ConversionEvent[] = [];

  // ── Plan catalogue management ─────────────────────────────────────────────

  registerPlan(meta: PlanMeta): void {
    this.plans.set(meta.id, meta);
  }

  // ── Merchant config ───────────────────────────────────────────────────────

  configureMerchant(config: MerchantUpsellConfig): void {
    this.configs.set(config.merchantId, config);
  }

  getMerchantConfig(merchantId: string): MerchantUpsellConfig | undefined {
    return this.configs.get(merchantId);
  }

  // ── Collaborative filtering model ─────────────────────────────────────────

  /**
   * Simple collaborative filtering: score each candidate plan by how many
   * similar subscribers are on it, weighted by usage proximity.
   */
  private collaborativeFilteringScore(
    input: CollaborativeFilteringInput,
    candidatePlanId: string
  ): number {
    const matchCount = input.similarSubscriberPlanIds.filter((p) => p === candidatePlanId).length;
    const similarityWeight = Math.min(matchCount / Math.max(input.similarSubscriberPlanIds.length, 1), 1);
    // Blend with usage score: high-usage subscribers should see upgrade suggestions more strongly
    return similarityWeight * 0.7 + input.usageScore * 0.3;
  }

  // ── Recommendation generation ─────────────────────────────────────────────

  recommend(
    subscriberId: string,
    merchantId: string,
    trigger: RecommendationTrigger,
    input: CollaborativeFilteringInput,
    currentPlanTierRank: number,
    abVariant: ABTestVariant = 'recommendation'
  ): UpsellRecommendation | null {
    // Control variant: no recommendation
    if (abVariant === 'control') {
      return null;
    }

    const config = this.configs.get(merchantId);
    if (config && !config.enabledTriggers.includes(trigger)) {
      return null;
    }

    const maxItems = config?.maxItemsPerRecommendation ?? 3;
    const allPlans = Array.from(this.plans.values());

    // Edge case: subscriber already at max tier – no upgrade recommendations
    const maxTier = Math.max(...allPlans.map((p) => p.tierRank));
    const candidates = allPlans.filter((plan) => {
      if (plan.id === input.currentPlanId) return false;
      // For upgrade_tier: only suggest strictly higher tiers
      if (plan.type === 'upgrade_tier' && plan.tierRank <= currentPlanTierRank) return false;
      return true;
    });

    if (candidates.length === 0) return null;

    const items: RecommendationItem[] = candidates
      .map((plan) => ({
        id: createId('item'),
        type: plan.type,
        planId: plan.id,
        planName: plan.name,
        description: `Upgrade to ${plan.name}`,
        price: plan.price,
        currency: 'USD',
        commission: config?.commissionPercent,
        score: this.collaborativeFilteringScore(input, plan.id),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);

    const recommendation: UpsellRecommendation = {
      id: createId('rec'),
      subscriberId,
      merchantId,
      trigger,
      items,
      abVariant,
      createdAt: now(),
      expiresAt: now() + 7 * 86_400_000, // 7-day TTL
    };

    this.recommendations.set(recommendation.id, recommendation);
    return recommendation;
  }

  getRecommendation(id: string): UpsellRecommendation | undefined {
    return this.recommendations.get(id);
  }

  // ── A/B test ──────────────────────────────────────────────────────────────

  /** Deterministically assign variant from subscriberId */
  assignABVariant(subscriberId: string): ABTestVariant {
    const hash = subscriberId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return hash % 2 === 0 ? 'recommendation' : 'control';
  }

  // ── Conversion tracking ───────────────────────────────────────────────────

  trackEvent(
    recommendationId: string,
    itemId: string,
    eventType: ConversionEvent['eventType'],
    revenue?: number
  ): ConversionEvent {
    const event: ConversionEvent = { recommendationId, itemId, eventType, revenue, occurredAt: now() };
    this.events.push(event);
    return event;
  }

  getConversionFunnel(recommendationId: string): ConversionFunnel {
    const evts = this.events.filter((e) => e.recommendationId === recommendationId);
    return {
      recommendationId,
      impressions: evts.filter((e) => e.eventType === 'impression').length,
      clicks: evts.filter((e) => e.eventType === 'click').length,
      conversions: evts.filter((e) => e.eventType === 'conversion').length,
      totalRevenue: evts
        .filter((e) => e.eventType === 'conversion')
        .reduce((sum, e) => sum + (e.revenue ?? 0), 0),
    };
  }

  getAllFunnels(): ConversionFunnel[] {
    const recIds = new Set(this.events.map((e) => e.recommendationId));
    return Array.from(recIds).map((id) => this.getConversionFunnel(id));
  }
}

export const recommendationService = new RecommendationService();
