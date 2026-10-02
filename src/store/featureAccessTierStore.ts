import { create } from 'zustand';
import { SubscriptionTier, FeatureId } from '../types/feature';
import {
  FeatureAccessTier,
  TierEvaluationResult,
  TierUpgradeRecommendation,
} from '../types/featureTier';
import {
  DEFAULT_TIER_CONFIGS,
  evaluateFeatureAccess,
  getTierUpgradeRecommendation,
} from '../utils/featureAccessTier';

export interface FeatureAccessTierState {
  currentTier: SubscriptionTier;
  tierConfigs: Record<SubscriptionTier, FeatureAccessTier>;
  customOverrides: Record<string, boolean>;
  usageRecords: Record<string, number>;

  // Actions
  setUserTier: (tier: SubscriptionTier) => void;
  checkAccess: (featureId: FeatureId) => TierEvaluationResult;
  hasAccess: (featureId: FeatureId) => boolean;
  recordUsage: (featureId: FeatureId, delta?: number) => number;
  resetUsage: (featureId?: FeatureId) => void;
  setOverride: (featureId: FeatureId, enabled: boolean | undefined) => void;
  updateTierConfig: (tier: SubscriptionTier, updates: Partial<FeatureAccessTier>) => void;
  getUpgradeRecommendation: (featureId: FeatureId) => TierUpgradeRecommendation | null;
}

export const useFeatureAccessTierStore = create<FeatureAccessTierState>((set, get) => ({
  currentTier: SubscriptionTier.FREE,
  tierConfigs: { ...DEFAULT_TIER_CONFIGS },
  customOverrides: {},
  usageRecords: {},

  setUserTier: (tier: SubscriptionTier) => {
    set({ currentTier: tier });
  },

  checkAccess: (featureId: FeatureId) => {
    const { currentTier, customOverrides, usageRecords, tierConfigs } = get();
    const currentUsage = usageRecords[featureId] || 0;
    const override = customOverrides[featureId];

    return evaluateFeatureAccess(currentTier, featureId, currentUsage, override, tierConfigs);
  },

  hasAccess: (featureId: FeatureId) => {
    return get().checkAccess(featureId).hasAccess;
  },

  recordUsage: (featureId: FeatureId, delta = 1) => {
    const currentUsage = get().usageRecords[featureId] || 0;
    const newUsage = Math.max(0, currentUsage + delta);

    set((state) => ({
      usageRecords: {
        ...state.usageRecords,
        [featureId]: newUsage,
      },
    }));

    return newUsage;
  },

  resetUsage: (featureId?: FeatureId) => {
    if (featureId) {
      set((state) => {
        const next = { ...state.usageRecords };
        delete next[featureId];
        return { usageRecords: next };
      });
    } else {
      set({ usageRecords: {} });
    }
  },

  setOverride: (featureId: FeatureId, enabled: boolean | undefined) => {
    set((state) => {
      const next = { ...state.customOverrides };
      if (enabled === undefined) {
        delete next[featureId];
      } else {
        next[featureId] = enabled;
      }
      return { customOverrides: next };
    });
  },

  updateTierConfig: (tier: SubscriptionTier, updates: Partial<FeatureAccessTier>) => {
    set((state) => {
      const existing = state.tierConfigs[tier] || DEFAULT_TIER_CONFIGS[tier];
      return {
        tierConfigs: {
          ...state.tierConfigs,
          [tier]: {
            ...existing,
            ...updates,
          },
        },
      };
    });
  },

  getUpgradeRecommendation: (featureId: FeatureId) => {
    const { currentTier, tierConfigs } = get();
    return getTierUpgradeRecommendation(currentTier, featureId, tierConfigs);
  },
}));
