import { SubscriptionTier } from './subscription';

export { SubscriptionTier } from './subscription';

// ─── User Segment Targeting ────────────────────────────────────────────────

export type UserSegmentOperator = 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

export interface UserSegmentCondition {
  attribute: string;
  operator: UserSegmentOperator;
  value: string | number | boolean | string[];
}

export interface UserSegment {
  id: string;
  name: string;
  conditions: UserSegmentCondition[];
  matchAll?: boolean;
}

export interface UserAttributes {
  userId: string;
  tier?: SubscriptionTier;
  region?: string;
  language?: string;
  signupDate?: string;
  totalSubscriptions?: number;
  isNewUser?: boolean;
  isBetaTester?: boolean;
  isStaff?: boolean;
  emailVerified?: boolean;
  [key: string]: unknown;
}

// ─── Kill Switch ───────────────────────────────────────────────────────────

export interface KillSwitchConfig {
  active: boolean;
  featureIds?: FeatureId[];
  message?: string;
  triggeredAt?: Date;
  triggeredBy?: string;
}

export interface GlobalKillSwitchConfig {
  active: boolean;
  overrides: Record<string, KillSwitchConfig>;
}

// ─── Feature Flag ──────────────────────────────────────────────────────────

export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tierAccess: SubscriptionTier[];
  dependencies?: string[];
  rolloutPercentage?: number;
  rolloutStages?: RolloutStage[];
  abTestGroups?: string[];
  segments?: string[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RolloutStage {
  percentage: number;
  label: string;
  createdAt?: Date;
}

// ─── Feature Access Result ─────────────────────────────────────────────────

export interface FeatureAccessResult {
  hasAccess: boolean;
  reason?: string;
  isInRollout?: boolean;
  isInAbTest?: boolean;
  abTestGroup?: string;
  isKillSwitched?: boolean;
  matchedSegment?: string;
}

// ─── Feature Config ────────────────────────────────────────────────────────

export interface FeatureConfig {
  features: Record<string, FeatureFlag>;
  plans: Record<SubscriptionTier, FeatureId[]>;
  globalRolloutPercentage: number;
  abTestEnabled: boolean;
  segments?: UserSegment[];
  killSwitch?: GlobalKillSwitchConfig;
}

// ─── Feature IDs ───────────────────────────────────────────────────────────

export enum FeatureId {
  BASIC_SUBSCRIPTION_TRACKING = 'basic_subscription_tracking',
  BASIC_ANALYTICS = 'basic_analytics',
  PUSH_NOTIFICATIONS = 'push_notifications',
  ADVANCED_ANALYTICS = 'advanced_analytics',
  BUDGET_ALERTS = 'budget_alerts',
  EXPORT_DATA = 'export_data',
  MULTI_CURRENCY = 'multi_currency',
  CRYPTO_INTEGRATION = 'crypto_integration',
  TEAM_COLLABORATION = 'team_collaboration',
  CUSTOM_REPORTS = 'custom_reports',
  API_ACCESS = 'api_access',
  PRIORITY_SUPPORT = 'priority_support',
  WHITE_LABEL = 'white_label',
  DEVELOPER_PORTAL = 'developer_portal',
  SANDBOX_ACCESS = 'sandbox_access',
}

// ─── A/B Test ──────────────────────────────────────────────────────────────

export interface ABTestVariant {
  name: string;
  weight: number;
  config: Record<string, any>;
}

export interface ABTestAssignment {
  featureId: string;
  userId: string;
  group: string;
  assignedAt: number;
}

// ─── Feature Analytics ─────────────────────────────────────────────────────

export interface FeatureCheckEvent {
  featureId: string;
  userId: string;
  tier: SubscriptionTier;
  hasAccess: boolean;
  reason?: string;
  timestamp: number;
  latencyMs: number;
}

export interface FeatureFlagAnalytics {
  featureId: string;
  totalChecks: number;
  accessGranted: number;
  accessDenied: number;
  denyReasons: Record<string, number>;
  uniqueUsers: number;
  lastChecked: number;
  firstChecked: number;
}

export interface FeatureAnalyticsReport {
  features: Record<string, FeatureFlagAnalytics>;
  staleFlags: StaleFlagReport[];
  generatedAt: number;
}

// ─── Stale Flag Detection ──────────────────────────────────────────────────

export interface StaleFlagConfig {
  enabled: boolean;
  noCheckThresholdDays: number;
  fullRolloutThresholdDays: number;
  reportChannel?: string;
}

export interface StaleFlagReport {
  featureId: string;
  name: string;
  reason: 'no_checks' | 'full_rollout_aged' | 'always_enabled_unused';
  daysSinceLastCheck: number;
  rolloutPercentage: number;
  enabled: boolean;
  suggestion: string;
}

// ─── Configuration Conflict ────────────────────────────────────────────────

export interface ConfigConflict {
  type:
    | 'rollout_mismatch'
    | 'dependency_missing'
    | 'tier_missing'
    | 'killswitch_override'
    | 'invalid_segment';
  featureId: string;
  description: string;
  severity: 'warning' | 'error';
}
