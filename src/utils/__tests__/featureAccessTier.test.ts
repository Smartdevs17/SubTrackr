import {
  evaluateFeatureAccess,
  isTierAtLeast,
  getRequiredTierForFeature,
  getTierUpgradeRecommendation,
  TIER_RANK,
} from '../featureAccessTier';
import { SubscriptionTier, FeatureId } from '../../types/feature';

describe('featureAccessTier utility functions', () => {
  describe('isTierAtLeast', () => {
    it('returns true when current tier meets or exceeds required tier', () => {
      expect(isTierAtLeast(SubscriptionTier.PREMIUM, SubscriptionTier.BASIC)).toBe(true);
      expect(isTierAtLeast(SubscriptionTier.BASIC, SubscriptionTier.BASIC)).toBe(true);
      expect(isTierAtLeast(SubscriptionTier.ENTERPRISE, SubscriptionTier.FREE)).toBe(true);
    });

    it('returns false when current tier is below required tier', () => {
      expect(isTierAtLeast(SubscriptionTier.FREE, SubscriptionTier.BASIC)).toBe(false);
      expect(isTierAtLeast(SubscriptionTier.BASIC, SubscriptionTier.PREMIUM)).toBe(false);
      expect(isTierAtLeast(SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE)).toBe(false);
    });
  });

  describe('getRequiredTierForFeature', () => {
    it('returns correct required tier for features', () => {
      expect(getRequiredTierForFeature(FeatureId.BASIC_SUBSCRIPTION_TRACKING)).toBe(
        SubscriptionTier.FREE
      );
      expect(getRequiredTierForFeature(FeatureId.BUDGET_ALERTS)).toBe(SubscriptionTier.BASIC);
      expect(getRequiredTierForFeature(FeatureId.ADVANCED_ANALYTICS)).toBe(
        SubscriptionTier.PREMIUM
      );
      expect(getRequiredTierForFeature(FeatureId.WHITE_LABEL)).toBe(SubscriptionTier.ENTERPRISE);
    });
  });

  describe('evaluateFeatureAccess', () => {
    it('grants access when feature is included in user tier', () => {
      const result = evaluateFeatureAccess(SubscriptionTier.BASIC, FeatureId.EXPORT_DATA);
      expect(result.hasAccess).toBe(true);
      expect(result.requiredTier).toBe(SubscriptionTier.BASIC);
    });

    it('denies access when feature requires a higher tier', () => {
      const result = evaluateFeatureAccess(SubscriptionTier.FREE, FeatureId.ADVANCED_ANALYTICS);
      expect(result.hasAccess).toBe(false);
      expect(result.requiredTier).toBe(SubscriptionTier.PREMIUM);
      expect(result.reason).toContain("requires 'premium' tier");
    });

    it('denies access when feature usage exceeds quota limit', () => {
      const result = evaluateFeatureAccess(
        SubscriptionTier.FREE,
        FeatureId.BASIC_SUBSCRIPTION_TRACKING,
        5 // Free tier max_subscriptions is 5
      );
      expect(result.hasAccess).toBe(false);
      expect(result.currentUsage).toBe(5);
      expect(result.limit).toBe(5);
      expect(result.reason).toContain('Usage quota exceeded');
    });

    it('grants access when usage is below limit', () => {
      const result = evaluateFeatureAccess(
        SubscriptionTier.FREE,
        FeatureId.BASIC_SUBSCRIPTION_TRACKING,
        3
      );
      expect(result.hasAccess).toBe(true);
      expect(result.currentUsage).toBe(3);
    });

    it('respects explicit overrides', () => {
      const grantedOverride = evaluateFeatureAccess(
        SubscriptionTier.FREE,
        FeatureId.API_ACCESS,
        0,
        true
      );
      expect(grantedOverride.hasAccess).toBe(true);

      const deniedOverride = evaluateFeatureAccess(
        SubscriptionTier.ENTERPRISE,
        FeatureId.BASIC_SUBSCRIPTION_TRACKING,
        0,
        false
      );
      expect(deniedOverride.hasAccess).toBe(false);
    });
  });

  describe('getTierUpgradeRecommendation', () => {
    it('returns null if user already has access', () => {
      const rec = getTierUpgradeRecommendation(
        SubscriptionTier.PREMIUM,
        FeatureId.ADVANCED_ANALYTICS
      );
      expect(rec).toBeNull();
    });

    it('returns recommendation details if user tier is insufficient', () => {
      const rec = getTierUpgradeRecommendation(SubscriptionTier.FREE, FeatureId.ADVANCED_ANALYTICS);
      expect(rec).not.toBeNull();
      expect(rec?.requiredTier).toBe(SubscriptionTier.PREMIUM);
      expect(rec?.recommendedTierInfo.displayName).toBe('Premium Tier');
    });
  });
});
