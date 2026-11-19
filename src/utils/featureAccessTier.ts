import { SubscriptionTier, FeatureId } from '../types/feature';
import {
  FeatureAccessTier,
  TierEvaluationResult,
  TierUpgradeRecommendation,
} from '../types/featureTier';

/** Hierarchy rank numerical weight for comparison */
export const TIER_RANK: Record<SubscriptionTier, number> = {
  [SubscriptionTier.FREE]: 1,
  [SubscriptionTier.BASIC]: 2,
  [SubscriptionTier.PREMIUM]: 3,
  [SubscriptionTier.ENTERPRISE]: 4,
};

/** Default feature configs for all tiers */
export const DEFAULT_TIER_CONFIGS: Record<SubscriptionTier, FeatureAccessTier> = {
  [SubscriptionTier.FREE]: {
    tier: SubscriptionTier.FREE,
    displayName: 'Free Tier',
    description: 'Basic tracking for personal subscriptions',
    monthlyPrice: 0,
    yearlyPrice: 0,
    includedFeatures: [
      FeatureId.BASIC_SUBSCRIPTION_TRACKING,
      FeatureId.BASIC_ANALYTICS,
      FeatureId.PUSH_NOTIFICATIONS,
    ],
    featureLimits: {
      max_subscriptions: 5,
      export_rows: 50,
    },
    inheritanceHierarchy: [SubscriptionTier.FREE],
  },
  [SubscriptionTier.BASIC]: {
    tier: SubscriptionTier.BASIC,
    displayName: 'Basic Tier',
    description: 'Expanded tracking, exports, and multi-currency support',
    monthlyPrice: 4.99,
    yearlyPrice: 49.99,
    includedFeatures: [
      FeatureId.BASIC_SUBSCRIPTION_TRACKING,
      FeatureId.BASIC_ANALYTICS,
      FeatureId.PUSH_NOTIFICATIONS,
      FeatureId.BUDGET_ALERTS,
      FeatureId.EXPORT_DATA,
      FeatureId.MULTI_CURRENCY,
    ],
    featureLimits: {
      max_subscriptions: 25,
      export_rows: 500,
    },
    inheritanceHierarchy: [SubscriptionTier.FREE, SubscriptionTier.BASIC],
  },
  [SubscriptionTier.PREMIUM]: {
    tier: SubscriptionTier.PREMIUM,
    displayName: 'Premium Tier',
    description: 'Advanced analytics, team features, and crypto payments',
    monthlyPrice: 12.99,
    yearlyPrice: 129.99,
    includedFeatures: [
      FeatureId.BASIC_SUBSCRIPTION_TRACKING,
      FeatureId.BASIC_ANALYTICS,
      FeatureId.PUSH_NOTIFICATIONS,
      FeatureId.BUDGET_ALERTS,
      FeatureId.EXPORT_DATA,
      FeatureId.MULTI_CURRENCY,
      FeatureId.ADVANCED_ANALYTICS,
      FeatureId.CRYPTO_INTEGRATION,
      FeatureId.TEAM_COLLABORATION,
      FeatureId.CUSTOM_REPORTS,
    ],
    featureLimits: {
      max_subscriptions: 100,
      export_rows: 10000,
      team_members: 5,
    },
    inheritanceHierarchy: [SubscriptionTier.FREE, SubscriptionTier.BASIC, SubscriptionTier.PREMIUM],
  },
  [SubscriptionTier.ENTERPRISE]: {
    tier: SubscriptionTier.ENTERPRISE,
    displayName: 'Enterprise Tier',
    description: 'Unlimited access, API, developer portal, white label & priority support',
    monthlyPrice: 49.99,
    yearlyPrice: 499.99,
    includedFeatures: [
      FeatureId.BASIC_SUBSCRIPTION_TRACKING,
      FeatureId.BASIC_ANALYTICS,
      FeatureId.PUSH_NOTIFICATIONS,
      FeatureId.BUDGET_ALERTS,
      FeatureId.EXPORT_DATA,
      FeatureId.MULTI_CURRENCY,
      FeatureId.ADVANCED_ANALYTICS,
      FeatureId.CRYPTO_INTEGRATION,
      FeatureId.TEAM_COLLABORATION,
      FeatureId.CUSTOM_REPORTS,
      FeatureId.API_ACCESS,
      FeatureId.PRIORITY_SUPPORT,
      FeatureId.WHITE_LABEL,
      FeatureId.DEVELOPER_PORTAL,
      FeatureId.SANDBOX_ACCESS,
    ],
    featureLimits: {
      max_subscriptions: 999999,
      export_rows: 999999,
      team_members: 100,
    },
    inheritanceHierarchy: [
      SubscriptionTier.FREE,
      SubscriptionTier.BASIC,
      SubscriptionTier.PREMIUM,
      SubscriptionTier.ENTERPRISE,
    ],
  },
};

/**
 * Checks if current user tier satisfies required minimum tier.
 */
export function isTierAtLeast(
  currentTier: SubscriptionTier,
  requiredTier: SubscriptionTier
): boolean {
  const currentRank = TIER_RANK[currentTier] ?? 1;
  const requiredRank = TIER_RANK[requiredTier] ?? 1;
  return currentRank >= requiredRank;
}

/**
 * Gets the minimum required tier for a specific feature.
 */
export function getRequiredTierForFeature(
  featureId: FeatureId,
  configs: Record<SubscriptionTier, FeatureAccessTier> = DEFAULT_TIER_CONFIGS
): SubscriptionTier {
  const tiers: SubscriptionTier[] = [
    SubscriptionTier.FREE,
    SubscriptionTier.BASIC,
    SubscriptionTier.PREMIUM,
    SubscriptionTier.ENTERPRISE,
  ];

  for (const tier of tiers) {
    const config = configs[tier];
    if (config && config.includedFeatures.includes(featureId)) {
      return tier;
    }
  }

  return SubscriptionTier.ENTERPRISE;
}

/**
 * Evaluates access to a feature based on user tier, usage, and overrides.
 */
export function evaluateFeatureAccess(
  userTier: SubscriptionTier,
  featureId: FeatureId,
  currentUsage?: number,
  overrideEnabled?: boolean,
  configs: Record<SubscriptionTier, FeatureAccessTier> = DEFAULT_TIER_CONFIGS
): TierEvaluationResult {
  const requiredTier = getRequiredTierForFeature(featureId, configs);

  // If explicitly overridden
  if (overrideEnabled !== undefined) {
    return {
      hasAccess: overrideEnabled,
      userTier,
      requiredTier,
      featureId,
      reason: overrideEnabled
        ? 'Access granted via custom feature override'
        : 'Access revoked via custom feature override',
    };
  }

  const userConfig = configs[userTier] || DEFAULT_TIER_CONFIGS[SubscriptionTier.FREE];
  const hasTierAccess = userConfig.includedFeatures.includes(featureId);

  if (!hasTierAccess) {
    return {
      hasAccess: false,
      userTier,
      requiredTier,
      featureId,
      reason: `Feature '${featureId}' requires '${requiredTier}' tier or higher. Current tier is '${userTier}'.`,
    };
  }

  // Check usage limit if limit key exists
  const limitKey = getLimitKeyForFeature(featureId);
  if (limitKey && userConfig.featureLimits[limitKey] !== undefined) {
    const limit = userConfig.featureLimits[limitKey];
    if (currentUsage !== undefined && currentUsage >= limit) {
      return {
        hasAccess: false,
        userTier,
        requiredTier,
        featureId,
        currentUsage,
        limit,
        reason: `Usage quota exceeded for feature '${featureId}'. Current: ${currentUsage}, Limit: ${limit}.`,
      };
    }
    return {
      hasAccess: true,
      userTier,
      requiredTier,
      featureId,
      currentUsage,
      limit,
      reason: 'Access granted within tier quota limit',
    };
  }

  return {
    hasAccess: true,
    userTier,
    requiredTier,
    featureId,
    reason: 'Access granted for subscription tier',
  };
}

/**
 * Maps feature ID to limit key name.
 */
export function getLimitKeyForFeature(featureId: FeatureId): string | null {
  switch (featureId) {
    case FeatureId.BASIC_SUBSCRIPTION_TRACKING:
      return 'max_subscriptions';
    case FeatureId.EXPORT_DATA:
      return 'export_rows';
    case FeatureId.TEAM_COLLABORATION:
      return 'team_members';
    default:
      return null;
  }
}

/**
 * Computes upgrade recommendation for a user needing a feature.
 */
export function getTierUpgradeRecommendation(
  currentTier: SubscriptionTier,
  featureId: FeatureId,
  configs: Record<SubscriptionTier, FeatureAccessTier> = DEFAULT_TIER_CONFIGS
): TierUpgradeRecommendation | null {
  const requiredTier = getRequiredTierForFeature(featureId, configs);
  if (isTierAtLeast(currentTier, requiredTier)) {
    return null; // Already has sufficient tier
  }

  const recommendedTierInfo = configs[requiredTier] || DEFAULT_TIER_CONFIGS[requiredTier];
  return {
    currentTier,
    requiredTier,
    featureId,
    recommendedTierInfo,
  };
}
