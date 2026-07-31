// Issue 561: Upsell/recommendation engine types

export type RecommendationTrigger =
  | 'checkout'
  | 'usage_threshold'
  | 'renewal_window'
  | 'support_request';

export type RecommendationType = 'upgrade_tier' | 'add_on' | 'complementary_plan';

export type ABTestVariant = 'recommendation' | 'control';

export interface RecommendationItem {
  id: string;
  type: RecommendationType;
  planId: string;
  planName: string;
  description: string;
  price: number;
  currency: string;
  commission?: number; // merchant-set commission %
  score: number; // 0–1 relevance score from model
}

export interface UpsellRecommendation {
  id: string;
  subscriberId: string;
  merchantId: string;
  trigger: RecommendationTrigger;
  items: RecommendationItem[];
  abVariant: ABTestVariant;
  createdAt: number;
  expiresAt?: number;
}

export interface ConversionEvent {
  recommendationId: string;
  itemId: string;
  eventType: 'impression' | 'click' | 'conversion';
  revenue?: number;
  occurredAt: number;
}

export interface ConversionFunnel {
  recommendationId: string;
  impressions: number;
  clicks: number;
  conversions: number;
  totalRevenue: number;
}

export interface MerchantUpsellConfig {
  merchantId: string;
  enabledTriggers: RecommendationTrigger[];
  commissionPercent: number;
  maxItemsPerRecommendation: number;
}

export interface CollaborativeFilteringInput {
  subscriberId: string;
  currentPlanId: string;
  usageScore: number; // 0–1 normalised usage level
  similarSubscriberPlanIds: string[]; // plans bought by similar users
}
