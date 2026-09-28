import { useFeatureAccessTierStore } from '../featureAccessTierStore';
import { SubscriptionTier, FeatureId } from '../../types/feature';

describe('useFeatureAccessTierStore', () => {
  beforeEach(() => {
    useFeatureAccessTierStore.setState({
      currentTier: SubscriptionTier.FREE,
      customOverrides: {},
      usageRecords: {},
    });
  });

  it('initializes with FREE tier and checks features', () => {
    const store = useFeatureAccessTierStore.getState();
    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.hasAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING)).toBe(true);
    expect(store.hasAccess(FeatureId.ADVANCED_ANALYTICS)).toBe(false);
  });

  it('updates user tier and grants access accordingly', () => {
    useFeatureAccessTierStore.getState().setUserTier(SubscriptionTier.PREMIUM);
    const store = useFeatureAccessTierStore.getState();
    expect(store.currentTier).toBe(SubscriptionTier.PREMIUM);
    expect(store.hasAccess(FeatureId.ADVANCED_ANALYTICS)).toBe(true);
  });

  it('records and checks feature usage against tier quota limits', () => {
    const store = useFeatureAccessTierStore.getState();
    expect(store.hasAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING)).toBe(true);

    // Record usage up to limit (5 for Free tier)
    for (let i = 0; i < 5; i++) {
      useFeatureAccessTierStore.getState().recordUsage(FeatureId.BASIC_SUBSCRIPTION_TRACKING);
    }

    expect(useFeatureAccessTierStore.getState().usageRecords[FeatureId.BASIC_SUBSCRIPTION_TRACKING]).toBe(5);
    expect(useFeatureAccessTierStore.getState().hasAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING)).toBe(false);

    // Reset usage
    useFeatureAccessTierStore.getState().resetUsage(FeatureId.BASIC_SUBSCRIPTION_TRACKING);
    expect(useFeatureAccessTierStore.getState().hasAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING)).toBe(true);
  });

  it('applies custom feature overrides', () => {
    const store = useFeatureAccessTierStore.getState();
    expect(store.hasAccess(FeatureId.WHITE_LABEL)).toBe(false);

    // Enable override
    useFeatureAccessTierStore.getState().setOverride(FeatureId.WHITE_LABEL, true);
    expect(useFeatureAccessTierStore.getState().hasAccess(FeatureId.WHITE_LABEL)).toBe(true);

    // Remove override
    useFeatureAccessTierStore.getState().setOverride(FeatureId.WHITE_LABEL, undefined);
    expect(useFeatureAccessTierStore.getState().hasAccess(FeatureId.WHITE_LABEL)).toBe(false);
  });

  it('provides upgrade recommendations for restricted features', () => {
    const rec = useFeatureAccessTierStore.getState().getUpgradeRecommendation(FeatureId.API_ACCESS);
    expect(rec).not.toBeNull();
    expect(rec?.requiredTier).toBe(SubscriptionTier.ENTERPRISE);
  });
});
