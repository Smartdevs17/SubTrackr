import { useState, useEffect, useCallback } from 'react';
import { FeatureId, FeatureAccessResult } from '../types/feature';
import { featureFlagsService } from '../services/featureFlags';
import { useUserStore } from '../store/userStore';

export interface UseFeatureAccessResult extends FeatureAccessResult {
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook to check feature access for the current user
 */
export const useFeatureAccess = (featureId: FeatureId): UseFeatureAccessResult => {
  const { subscriptionTier } = useUserStore();
  const [result, setResult] = useState<FeatureAccessResult>({
    hasAccess: false,
  });
  const [loading, setLoading] = useState(true);

  const checkAccess = useCallback(async () => {
    setLoading(true);
    try {
      const accessResult = await featureFlagsService.checkFeatureAccess(
        featureId,
        subscriptionTier
      );
      setResult(accessResult);
    } catch (error) {
      console.error('Error checking feature access:', error);
      setResult({
        hasAccess: false,
        reason: 'Error checking access',
      });
    } finally {
      setLoading(false);
    }
  }, [featureId, subscriptionTier]);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  return {
    ...result,
    loading,
    refresh: checkAccess,
  };
};

/**
 * Hook to get all available features for the current user tier
 */
export const useAvailableFeatures = (): FeatureId[] => {
  const { subscriptionTier } = useUserStore();
  return featureFlagsService.getAvailableFeatures(subscriptionTier);
};

/**
 * Hook to check feature limits
 */
export const useFeatureLimits = () => {
  const { subscriptionTier } = useUserStore();

  const getLimits = useCallback(() => {
    return featureFlagsService.getFeatureLimits(subscriptionTier);
  }, [subscriptionTier]);

  const hasExceededLimit = useCallback(
    (limitKey: string, currentUsage: number) => {
      return featureFlagsService.hasExceededLimit(subscriptionTier, limitKey, currentUsage);
    },
    [subscriptionTier]
  );

  const getRemainingUsage = useCallback(
    (limitKey: string, currentUsage: number) => {
      return featureFlagsService.getRemainingUsage(subscriptionTier, limitKey, currentUsage);
    },
    [subscriptionTier]
  );

  return {
    getLimits,
    hasExceededLimit,
    getRemainingUsage,
  };
};

/**
 * Hook to get feature details
 */
export const useFeature = (featureId: FeatureId) => {
  return featureFlagsService.getFeature(featureId);
};

/**
 * Hook to check multiple features at once
 */
export const useMultipleFeatureAccess = (featureIds: FeatureId[]) => {
  const { subscriptionTier } = useUserStore();
  const [results, setResults] = useState<Record<string, FeatureAccessResult>>({});
  const [loading, setLoading] = useState(true);

  const checkAccess = useCallback(async () => {
    setLoading(true);
    try {
      const accessResults: Record<string, FeatureAccessResult> = {};

      for (const featureId of featureIds) {
        accessResults[featureId] = await featureFlagsService.checkFeatureAccess(
          featureId,
          subscriptionTier
        );
      }

      setResults(accessResults);
    } catch (error) {
      console.error('Error checking multiple feature access:', error);
    } finally {
      setLoading(false);
    }
  }, [featureIds, subscriptionTier]);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  return {
    results,
    loading,
    refresh: checkAccess,
  };
};
