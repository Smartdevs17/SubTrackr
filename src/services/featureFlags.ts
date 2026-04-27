import { FeatureId, FeatureAccessResult, FeatureFlag } from '../types/feature';
import { SubscriptionTier } from '../types/subscription';
import { FEATURE_CONFIG } from '../config/features';
import AsyncStorage from '@react-native-async-storage/async-storage';

class FeatureFlagsService {
  private static instance: FeatureFlagsService;
  private userId: string | null = null;
  private abTestAssignments: Map<string, string> = new Map();

  private constructor() {
    this.loadABTestAssignments();
  }

  static getInstance(): FeatureFlagsService {
    if (!FeatureFlagsService.instance) {
      FeatureFlagsService.instance = new FeatureFlagsService();
    }
    return FeatureFlagsService.instance;
  }

  /**
   * Set the current user ID for A/B testing and rollout calculations
   */
  setUserId(userId: string): void {
    this.userId = userId;
    this.loadABTestAssignments();
  }

  /**
   * Check if a user has access to a specific feature
   */
  async checkFeatureAccess(
    featureId: FeatureId,
    userTier: SubscriptionTier,
    userId?: string
  ): Promise<FeatureAccessResult> {
    const feature = FEATURE_CONFIG.features[featureId];

    if (!feature) {
      return {
        hasAccess: false,
        reason: 'Feature not found',
      };
    }

    if (!feature.enabled) {
      return {
        hasAccess: false,
        reason: 'Feature is disabled',
      };
    }

    // Check tier access
    if (!feature.tierAccess.includes(userTier)) {
      return {
        hasAccess: false,
        reason: `Requires ${feature.tierAccess.join(' or ')} subscription`,
      };
    }

    // Check feature dependencies
    if (feature.dependencies) {
      for (const dependencyId of feature.dependencies) {
        const dependencyResult = await this.checkFeatureAccess(
          dependencyId as FeatureId,
          userTier,
          userId
        );
        if (!dependencyResult.hasAccess) {
          return {
            hasAccess: false,
            reason: `Requires ${dependencyId}`,
          };
        }
      }
    }

    // Check gradual rollout
    const isInRollout = this.isUserInRollout(
      feature.rolloutPercentage || 100,
      userId || this.userId
    );
    if (!isInRollout) {
      return {
        hasAccess: false,
        reason: 'Feature not available in current rollout',
        isInRollout: false,
      };
    }

    // Check A/B testing
    if (feature.abTestGroups && feature.abTestGroups.length > 0) {
      const abTestGroup = this.getABTestGroup(featureId, userId || this.userId);
      if (!abTestGroup) {
        return {
          hasAccess: false,
          reason: 'Not selected for A/B test',
          isInAbTest: false,
        };
      }
      return {
        hasAccess: true,
        isInRollout: true,
        isInAbTest: true,
        abTestGroup,
      };
    }

    return {
      hasAccess: true,
      isInRollout: true,
    };
  }

  /**
   * Get all features available to a user tier
   */
  getAvailableFeatures(userTier: SubscriptionTier): FeatureId[] {
    return FEATURE_CONFIG.plans[userTier] || [];
  }

  /**
   * Get feature details
   */
  getFeature(featureId: FeatureId): FeatureFlag | null {
    return FEATURE_CONFIG.features[featureId] || null;
  }

  /**
   * Get all features
   */
  getAllFeatures(): Record<string, FeatureFlag> {
    return FEATURE_CONFIG.features;
  }

  /**
   * Check if user is in gradual rollout
   */
  private isUserInRollout(percentage: number, userId: string | null): boolean {
    if (percentage >= 100) return true;
    if (!userId) return false;

    // Use user ID hash for deterministic rollout
    const hash = this.hashString(userId);
    const normalizedHash = (hash % 100) / 100;
    return normalizedHash < percentage / 100;
  }

  /**
   * Get A/B test group for user
   */
  private getABTestGroup(featureId: string, userId: string | null): string | null {
    if (!userId) return null;

    const assignmentKey = `${featureId}:${userId}`;
    let group = this.abTestAssignments.get(assignmentKey);

    if (!group) {
      const feature = FEATURE_CONFIG.features[featureId];
      if (feature?.abTestGroups && feature.abTestGroups.length > 0) {
        // Simple random assignment based on user ID hash
        const hash = this.hashString(userId);
        const groupIndex = hash % feature.abTestGroups.length;
        group = feature.abTestGroups[groupIndex];
        this.abTestAssignments.set(assignmentKey, group);
        this.saveABTestAssignments();
      }
    }

    return group || null;
  }

  /**
   * Load A/B test assignments from storage
   */
  private async loadABTestAssignments(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem('ab_test_assignments');
      if (stored) {
        const assignments = JSON.parse(stored);
        this.abTestAssignments = new Map(Object.entries(assignments));
      }
    } catch (error) {
      console.warn('Failed to load A/B test assignments:', error);
    }
  }

  /**
   * Save A/B test assignments to storage
   */
  private async saveABTestAssignments(): Promise<void> {
    try {
      const assignments = Object.fromEntries(this.abTestAssignments);
      await AsyncStorage.setItem('ab_test_assignments', JSON.stringify(assignments));
    } catch (error) {
      console.warn('Failed to save A/B test assignments:', error);
    }
  }

  /**
   * Simple string hash function for deterministic user assignment
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Get feature usage limits for a user tier
   */
  getFeatureLimits(userTier: SubscriptionTier): Record<string, number> {
    // This could be expanded to have different limits per tier
    const limits: Record<SubscriptionTier, Record<string, number>> = {
      [SubscriptionTier.FREE]: {
        max_subscriptions: 5,
        max_categories: 3,
        export_formats: 1,
      },
      [SubscriptionTier.BASIC]: {
        max_subscriptions: 25,
        max_categories: 8,
        export_formats: 2,
      },
      [SubscriptionTier.PREMIUM]: {
        max_subscriptions: 100,
        max_categories: 20,
        export_formats: 3,
      },
      [SubscriptionTier.ENTERPRISE]: {
        max_subscriptions: -1, // Unlimited
        max_categories: -1,
        export_formats: 5,
      },
    };

    return limits[userTier] || limits[SubscriptionTier.FREE];
  }

  /**
   * Check if user has exceeded a feature limit
   */
  hasExceededLimit(userTier: SubscriptionTier, limitKey: string, currentUsage: number): boolean {
    const limits = this.getFeatureLimits(userTier);
    const limit = limits[limitKey];

    if (limit === -1) return false; // Unlimited
    return currentUsage >= limit;
  }

  /**
   * Get remaining usage for a limit
   */
  getRemainingUsage(userTier: SubscriptionTier, limitKey: string, currentUsage: number): number {
    const limits = this.getFeatureLimits(userTier);
    const limit = limits[limitKey];

    if (limit === -1) return -1; // Unlimited
    return Math.max(0, limit - currentUsage);
  }
}

export const featureFlagsService = FeatureFlagsService.getInstance();
