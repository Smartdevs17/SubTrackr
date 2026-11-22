import { SubscriptionTier, FeatureId } from './feature';

export interface FeatureAccessTier {
  tier: SubscriptionTier;
  displayName: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  includedFeatures: FeatureId[];
  featureLimits: Record<string, number>;
  inheritanceHierarchy: SubscriptionTier[];
  isCustomTier?: boolean;
}

export interface FeatureAccessPolicy {
  tier: SubscriptionTier;
  enabledFeatures: FeatureId[];
  limits: Record<string, number>;
  overrides?: Record<string, boolean>;
}

export interface TierEvaluationResult {
  hasAccess: boolean;
  userTier: SubscriptionTier;
  requiredTier: SubscriptionTier;
  featureId: FeatureId;
  currentUsage?: number;
  limit?: number;
  reason: string;
}

export interface TierUpgradeRecommendation {
  currentTier: SubscriptionTier;
  requiredTier: SubscriptionTier;
  featureId: FeatureId;
  recommendedTierInfo: FeatureAccessTier;
}
