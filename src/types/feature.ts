import { SubscriptionTier } from './subscription';

export { SubscriptionTier } from './subscription';

export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tierAccess: SubscriptionTier[]; // Which tiers can access this feature
  dependencies?: string[]; // Feature IDs this feature depends on
  rolloutPercentage?: number; // For gradual rollout (0-100)
  abTestGroups?: string[]; // A/B test group names
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureAccessResult {
  hasAccess: boolean;
  reason?: string;
  isInRollout?: boolean;
  isInAbTest?: boolean;
  abTestGroup?: string;
}

export interface FeatureConfig {
  features: Record<string, FeatureFlag>;
  plans: Record<SubscriptionTier, FeatureId[]>; // Feature IDs available per tier
  globalRolloutPercentage: number;
  abTestEnabled: boolean;
}

export enum FeatureId {
  // Core features (available to all)
  BASIC_SUBSCRIPTION_TRACKING = 'basic_subscription_tracking',
  BASIC_ANALYTICS = 'basic_analytics',
  PUSH_NOTIFICATIONS = 'push_notifications',

  // Premium features
  ADVANCED_ANALYTICS = 'advanced_analytics',
  BUDGET_ALERTS = 'budget_alerts',
  EXPORT_DATA = 'export_data',
  MULTI_CURRENCY = 'multi_currency',
  CRYPTO_INTEGRATION = 'crypto_integration',

  // Enterprise features
  TEAM_COLLABORATION = 'team_collaboration',
  CUSTOM_REPORTS = 'custom_reports',
  API_ACCESS = 'api_access',
  PRIORITY_SUPPORT = 'priority_support',
  WHITE_LABEL = 'white_label',
}

export interface ABTestVariant {
  name: string;
  weight: number; // Percentage of users in this variant
  config: Record<string, any>;
}
