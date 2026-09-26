import {
  FeatureId,
  FeatureAccessResult,
  FeatureFlag,
  FeatureCheckEvent,
  FeatureFlagAnalytics,
  FeatureAnalyticsReport,
  StaleFlagReport,
  StaleFlagConfig,
  ConfigConflict,
  UserAttributes,
  UserSegment,
  UserSegmentCondition,
  ABTestAssignment,
} from '../types/feature';
import { SubscriptionTier } from '../types/subscription';
import { FEATURE_CONFIG } from '../config/features';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AB_TEST_ASSIGNMENTS_KEY = 'ab_test_assignments';
const FEATURE_ANALYTICS_KEY = 'feature_analytics';
const STALE_FLAG_CONFIG_KEY = 'stale_flag_config';

const DEFAULT_STALE_FLAG_CONFIG: StaleFlagConfig = {
  enabled: true,
  noCheckThresholdDays: 90,
  fullRolloutThresholdDays: 60,
};

class FeatureFlagsService {
  private static instance: FeatureFlagsService;
  private userId: string | null = null;
  private abTestAssignments: Map<string, string> = new Map();
  private checkEvents: FeatureCheckEvent[] = [];
  private analytics: Map<string, FeatureFlagAnalytics> = new Map();
  private staleConfig: StaleFlagConfig = { ...DEFAULT_STALE_FLAG_CONFIG };
  private analyticsFlushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxEventsBuffer = 500;
  private readonly flushIntervalMs = 30_000;

  private constructor() {
    this.loadPersistedState();
    this.startAnalyticsFlush();
  }

  static getInstance(): FeatureFlagsService {
    if (!FeatureFlagsService.instance) {
      FeatureFlagsService.instance = new FeatureFlagsService();
    }
    return FeatureFlagsService.instance;
  }

  setUserId(userId: string): void {
    this.userId = userId;
    this.loadPersistedState();
  }

  // ─── Kill Switch ─────────────────────────────────────────────────────────

  activateKillSwitch(featureId?: FeatureId, message?: string): void {
    const ks = FEATURE_CONFIG.killSwitch;
    if (!ks) return;
    ks.active = true;
    if (featureId) {
      ks.overrides[featureId] = {
        active: true,
        featureIds: [featureId],
        message: message || 'Feature temporarily disabled',
        triggeredAt: new Date(),
        triggeredBy: 'admin',
      };
    }
  }

  deactivateKillSwitch(featureId?: FeatureId): void {
    const ks = FEATURE_CONFIG.killSwitch;
    if (!ks) return;
    if (featureId) {
      delete ks.overrides[featureId];
      ks.active = Object.keys(ks.overrides).length > 0;
    } else {
      ks.active = false;
      ks.overrides = {};
    }
  }

  isKillSwitched(featureId: string): boolean {
    const ks = FEATURE_CONFIG.killSwitch;
    if (!ks || !ks.active) return false;
    const override = ks.overrides[featureId];
    if (override?.active) return true;
    return false;
  }

  getActiveKillSwitches(): string[] {
    const ks = FEATURE_CONFIG.killSwitch;
    if (!ks || !ks.active) return [];
    return Object.entries(ks.overrides)
      .filter(([, config]) => config.active)
      .map(([id]) => id);
  }

  // ─── User Segment Evaluation ─────────────────────────────────────────────

  private evaluateSegmentCondition(
    condition: UserSegmentCondition,
    attributes: UserAttributes
  ): boolean {
    const attrValue = attributes[condition.attribute];

    switch (condition.operator) {
      case 'eq':
        return attrValue === condition.value;
      case 'neq':
        return attrValue !== condition.value;
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(attrValue as string);
      case 'not_in':
        return Array.isArray(condition.value) && !condition.value.includes(attrValue as string);
      case 'gt':
        return (
          typeof attrValue === 'number' &&
          typeof condition.value === 'number' &&
          attrValue > condition.value
        );
      case 'gte':
        return (
          typeof attrValue === 'number' &&
          typeof condition.value === 'number' &&
          attrValue >= condition.value
        );
      case 'lt':
        return (
          typeof attrValue === 'number' &&
          typeof condition.value === 'number' &&
          attrValue < condition.value
        );
      case 'lte':
        return (
          typeof attrValue === 'number' &&
          typeof condition.value === 'number' &&
          attrValue <= condition.value
        );
      default:
        return false;
    }
  }

  private isUserInSegment(segment: UserSegment, attributes: UserAttributes): boolean {
    if (segment.matchAll !== false) {
      return segment.conditions.every((c) => this.evaluateSegmentCondition(c, attributes));
    }
    return segment.conditions.some((c) => this.evaluateSegmentCondition(c, attributes));
  }

  private getMatchedSegments(feature: FeatureFlag, attributes: UserAttributes): string[] {
    if (!feature.segments || feature.segments.length === 0) return [];
    const segments = FEATURE_CONFIG.segments || [];
    return feature.segments.filter((segId) => {
      const segment = segments.find((s) => s.id === segId);
      return segment ? this.isUserInSegment(segment, attributes) : false;
    });
  }

  private resolveSegmentAccess(
    feature: FeatureFlag,
    attributes: UserAttributes
  ): {
    hasSegmentAccess: boolean;
    matchedSegment?: string;
  } {
    if (!feature.segments || feature.segments.length === 0) {
      return { hasSegmentAccess: true };
    }
    const matched = this.getMatchedSegments(feature, attributes);
    if (matched.length > 0) {
      return { hasSegmentAccess: true, matchedSegment: matched[0] };
    }
    return { hasSegmentAccess: false };
  }

  // ─── Rollout Stage Calculation ───────────────────────────────────────────

  private getCurrentRolloutPercentage(feature: FeatureFlag): number {
    if (feature.rolloutStages && feature.rolloutStages.length > 0) {
      const sorted = [...feature.rolloutStages].sort((a, b) => b.percentage - a.percentage);
      return sorted[0].percentage;
    }
    return feature.rolloutPercentage ?? 100;
  }

  // ─── Configuration Conflict Detection ────────────────────────────────────

  detectConfigConflicts(): ConfigConflict[] {
    const conflicts: ConfigConflict[] = [];
    const features = FEATURE_CONFIG.features;

    for (const [id, feature] of Object.entries(features)) {
      if (feature.dependencies) {
        for (const depId of feature.dependencies) {
          if (!features[depId]) {
            conflicts.push({
              type: 'dependency_missing',
              featureId: id,
              description: `Depends on missing feature: ${depId}`,
              severity: 'error',
            });
          } else if (feature.rolloutPercentage && features[depId].rolloutPercentage) {
            if (feature.rolloutPercentage > features[depId].rolloutPercentage) {
              conflicts.push({
                type: 'rollout_mismatch',
                featureId: id,
                description: `Rollout ${feature.rolloutPercentage}% exceeds dependency ${depId} rollout ${features[depId].rolloutPercentage}%`,
                severity: 'warning',
              });
            }
          }
        }
      }

      if (feature.tierAccess.length === 0) {
        conflicts.push({
          type: 'tier_missing',
          featureId: id,
          description: 'Feature has no tier access defined',
          severity: 'error',
        });
      }

      if (feature.segments) {
        const segments = FEATURE_CONFIG.segments || [];
        for (const segId of feature.segments) {
          if (!segments.find((s) => s.id === segId)) {
            conflicts.push({
              type: 'invalid_segment',
              featureId: id,
              description: `References undefined segment: ${segId}`,
              severity: 'warning',
            });
          }
        }
      }

      if (this.isKillSwitched(id)) {
        conflicts.push({
          type: 'killswitch_override',
          featureId: id,
          description: 'Feature is overridden by active kill switch',
          severity: 'warning',
        });
      }
    }

    return conflicts;
  }

  // ─── Feature Access Check ────────────────────────────────────────────────

  async checkFeatureAccess(
    featureId: FeatureId,
    userTier: SubscriptionTier,
    userId?: string,
    attributes?: UserAttributes
  ): Promise<FeatureAccessResult> {
    const startTime = Date.now();
    const resolvedUserId = userId || this.userId || 'anonymous';
    const feature = FEATURE_CONFIG.features[featureId];

    if (!feature) {
      this.recordCheckEvent(
        featureId,
        resolvedUserId,
        userTier,
        false,
        'Feature not found',
        startTime
      );
      return { hasAccess: false, reason: 'Feature not found' };
    }

    if (this.isKillSwitched(featureId)) {
      this.recordCheckEvent(
        featureId,
        resolvedUserId,
        userTier,
        false,
        'Kill switch active',
        startTime
      );
      const ks = FEATURE_CONFIG.killSwitch;
      return {
        hasAccess: false,
        reason: ks?.overrides[featureId]?.message || 'Feature temporarily disabled',
        isKillSwitched: true,
      };
    }

    if (!feature.enabled) {
      this.recordCheckEvent(
        featureId,
        resolvedUserId,
        userTier,
        false,
        'Feature is disabled',
        startTime
      );
      return { hasAccess: false, reason: 'Feature is disabled' };
    }

    if (!feature.tierAccess.includes(userTier)) {
      this.recordCheckEvent(
        featureId,
        resolvedUserId,
        userTier,
        false,
        'Tier access denied',
        startTime
      );
      return {
        hasAccess: false,
        reason: `Requires ${feature.tierAccess.join(' or ')} subscription`,
      };
    }

    if (feature.dependencies) {
      for (const dependencyId of feature.dependencies) {
        const dependencyResult = await this.checkFeatureAccess(
          dependencyId as FeatureId,
          userTier,
          resolvedUserId,
          attributes
        );
        if (!dependencyResult.hasAccess) {
          this.recordCheckEvent(
            featureId,
            resolvedUserId,
            userTier,
            false,
            `Requires ${dependencyId}`,
            startTime
          );
          return { hasAccess: false, reason: `Requires ${dependencyId}` };
        }
      }
    }

    if (attributes && feature.segments && feature.segments.length > 0) {
      const segmentResult = this.resolveSegmentAccess(feature, attributes);
      if (!segmentResult.hasSegmentAccess) {
        this.recordCheckEvent(
          featureId,
          resolvedUserId,
          userTier,
          false,
          'Segment targeting not met',
          startTime
        );
        return {
          hasAccess: false,
          reason: 'Feature not available for your user segment',
        };
      }
    }

    const effectiveRollout = this.getCurrentRolloutPercentage(feature);
    const isInRollout = this.isUserInRollout(effectiveRollout, resolvedUserId);
    if (!isInRollout) {
      this.recordCheckEvent(
        featureId,
        resolvedUserId,
        userTier,
        false,
        'Not in rollout',
        startTime
      );
      return {
        hasAccess: false,
        reason: 'Feature not available in current rollout',
        isInRollout: false,
      };
    }

    if (feature.abTestGroups && feature.abTestGroups.length > 0) {
      const abTestGroup = this.getABTestGroup(featureId, resolvedUserId);
      if (!abTestGroup) {
        this.recordCheckEvent(
          featureId,
          resolvedUserId,
          userTier,
          false,
          'Not in A/B test',
          startTime
        );
        return { hasAccess: false, reason: 'Not selected for A/B test', isInAbTest: false };
      }
      const matchedSegment = this.resolveSegmentAccess(
        feature,
        attributes || ({} as UserAttributes)
      ).matchedSegment;
      this.recordCheckEvent(featureId, resolvedUserId, userTier, true, undefined, startTime);
      return {
        hasAccess: true,
        isInRollout: true,
        isInAbTest: true,
        abTestGroup,
        matchedSegment,
      };
    }

    const matchedSegment = attributes
      ? this.resolveSegmentAccess(feature, attributes).matchedSegment
      : undefined;
    this.recordCheckEvent(featureId, resolvedUserId, userTier, true, undefined, startTime);
    return {
      hasAccess: true,
      isInRollout: true,
      matchedSegment,
    };
  }

  // ─── Analytics ───────────────────────────────────────────────────────────

  private recordCheckEvent(
    featureId: string,
    userId: string,
    tier: SubscriptionTier,
    hasAccess: boolean,
    reason?: string,
    startTime?: number
  ): void {
    const event: FeatureCheckEvent = {
      featureId,
      userId,
      tier,
      hasAccess,
      reason,
      timestamp: Date.now(),
      latencyMs: startTime ? Date.now() - startTime : 0,
    };

    this.checkEvents.push(event);
    this.updateAnalytics(event);

    if (this.checkEvents.length >= this.maxEventsBuffer) {
      this.flushAnalytics();
    }
  }

  private updateAnalytics(event: FeatureCheckEvent): void {
    const existing = this.analytics.get(event.featureId) || {
      featureId: event.featureId,
      totalChecks: 0,
      accessGranted: 0,
      accessDenied: 0,
      denyReasons: {},
      uniqueUsers: 0,
      lastChecked: 0,
      firstChecked: Date.now(),
    };

    existing.totalChecks += 1;
    if (event.hasAccess) {
      existing.accessGranted += 1;
    } else {
      existing.accessDenied += 1;
      if (event.reason) {
        existing.denyReasons[event.reason] = (existing.denyReasons[event.reason] || 0) + 1;
      }
    }
    existing.lastChecked = event.timestamp;

    if (!this.uniqueUsersSeen.has(event.userId)) {
      this.uniqueUsersSeen.add(event.userId);
      existing.uniqueUsers = this.uniqueUsersSeen.size;
    }

    this.analytics.set(event.featureId, existing);
  }

  private uniqueUsersSeen = new Set<string>();

  getFeatureAnalytics(featureId: string): FeatureFlagAnalytics | null {
    return this.analytics.get(featureId) || null;
  }

  getAnalyticsReport(): FeatureAnalyticsReport {
    const features: Record<string, FeatureFlagAnalytics> = {};
    for (const [id, analytics] of this.analytics) {
      features[id] = analytics;
    }
    return {
      features,
      staleFlags: this.detectStaleFlags(),
      generatedAt: Date.now(),
    };
  }

  getFeatureCheckHistory(featureId: string, limit = 50): FeatureCheckEvent[] {
    return this.checkEvents.filter((e) => e.featureId === featureId).slice(-limit);
  }

  getMostCheckedFeatures(limit = 10): { featureId: string; checks: number }[] {
    return Array.from(this.analytics.entries())
      .map(([featureId, analytics]) => ({ featureId, checks: analytics.totalChecks }))
      .sort((a, b) => b.checks - a.checks)
      .slice(0, limit);
  }

  getMostDeniedFeatures(limit = 10): { featureId: string; denials: number }[] {
    return Array.from(this.analytics.entries())
      .map(([featureId, analytics]) => ({ featureId, denials: analytics.accessDenied }))
      .sort((a, b) => b.denials - a.denials)
      .slice(0, limit);
  }

  getFeatureDenyBreakdown(featureId: string): Record<string, number> {
    return this.analytics.get(featureId)?.denyReasons || {};
  }

  // ─── Stale Flag Detection ────────────────────────────────────────────────

  setStaleFlagConfig(config: Partial<StaleFlagConfig>): void {
    this.staleConfig = { ...this.staleConfig, ...config };
    this.persistStaleFlagConfig();
  }

  getStaleFlagConfig(): StaleFlagConfig {
    return { ...this.staleConfig };
  }

  detectStaleFlags(): StaleFlagReport[] {
    const reports: StaleFlagReport[] = [];
    const now = Date.now();
    const fullRolloutMs = this.staleConfig.fullRolloutThresholdDays * 86_400_000;

    for (const [id, feature] of Object.entries(FEATURE_CONFIG.features)) {
      const analytics = this.analytics.get(id);

      if (!analytics || analytics.totalChecks === 0) {
        reports.push({
          featureId: id,
          name: feature.name,
          reason: 'no_checks',
          daysSinceLastCheck: 0,
          rolloutPercentage: this.getCurrentRolloutPercentage(feature),
          enabled: feature.enabled,
          suggestion: 'Consider removing this feature flag or its configuration',
        });
        continue;
      }

      const daysSinceLastCheck = (now - analytics.lastChecked) / 86_400_000;

      if (daysSinceLastCheck > this.staleConfig.noCheckThresholdDays) {
        reports.push({
          featureId: id,
          name: feature.name,
          reason: 'no_checks',
          daysSinceLastCheck: Math.floor(daysSinceLastCheck),
          rolloutPercentage: this.getCurrentRolloutPercentage(feature),
          enabled: feature.enabled,
          suggestion: 'Feature has not been checked recently. Consider removal or audit.',
        });
      }

      if (
        this.getCurrentRolloutPercentage(feature) >= 100 &&
        daysSinceLastCheck > fullRolloutMs / 86_400_000
      ) {
        reports.push({
          featureId: id,
          name: feature.name,
          reason: 'full_rollout_aged',
          daysSinceLastCheck: Math.floor(daysSinceLastCheck),
          rolloutPercentage: 100,
          enabled: feature.enabled,
          suggestion: 'Feature is fully rolled out and stable. Consider removing the flag.',
        });
      }
    }

    return reports;
  }

  // ─── Existing Methods (preserved) ────────────────────────────────────────

  getAvailableFeatures(userTier: SubscriptionTier): FeatureId[] {
    return FEATURE_CONFIG.plans[userTier] || [];
  }

  getFeature(featureId: FeatureId): FeatureFlag | null {
    return FEATURE_CONFIG.features[featureId] || null;
  }

  getAllFeatures(): Record<string, FeatureFlag> {
    return FEATURE_CONFIG.features;
  }

  private isUserInRollout(percentage: number, userId: string | null): boolean {
    if (percentage >= 100) return true;
    if (!userId) return false;
    const hash = this.hashString(userId);
    const normalizedHash = (hash % 100) / 100;
    return normalizedHash < percentage / 100;
  }

  private getABTestGroup(featureId: string, userId: string | null): string | null {
    if (!userId) return null;

    const assignmentKey = `${featureId}:${userId}`;
    let group = this.abTestAssignments.get(assignmentKey);

    if (!group) {
      const feature = FEATURE_CONFIG.features[featureId];
      if (feature?.abTestGroups && feature.abTestGroups.length > 0) {
        const hash = this.hashString(userId);
        const groupIndex = hash % feature.abTestGroups.length;
        group = feature.abTestGroups[groupIndex];
        this.abTestAssignments.set(assignmentKey, group);
        this.persistABTestAssignments();
      }
    }

    return group || null;
  }

  getABTestAssignments(userId?: string): ABTestAssignment[] {
    const resolvedUserId = userId || this.userId || '';
    const assignments: ABTestAssignment[] = [];

    for (const [key, group] of this.abTestAssignments) {
      const [featureId, uid] = key.split(':');
      if (uid === resolvedUserId) {
        assignments.push({
          featureId,
          userId: uid,
          group,
          assignedAt: 0,
        });
      }
    }

    return assignments;
  }

  getABTestGroups(featureId: string): string[] {
    return FEATURE_CONFIG.features[featureId]?.abTestGroups || [];
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private async loadPersistedState(): Promise<void> {
    await Promise.all([
      this.loadABTestAssignments(),
      this.loadAnalytics(),
      this.loadStaleFlagConfig(),
    ]);
  }

  private async loadABTestAssignments(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(AB_TEST_ASSIGNMENTS_KEY);
      if (stored) {
        const assignments = JSON.parse(stored);
        this.abTestAssignments = new Map(Object.entries(assignments));
      }
    } catch {
      // ignore
    }
  }

  private async persistABTestAssignments(): Promise<void> {
    try {
      const assignments = Object.fromEntries(this.abTestAssignments);
      await AsyncStorage.setItem(AB_TEST_ASSIGNMENTS_KEY, JSON.stringify(assignments));
    } catch {
      // ignore
    }
  }

  private async loadAnalytics(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(FEATURE_ANALYTICS_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        this.analytics = new Map(Object.entries(data));
        for (const userId of Object.keys(data._uniqueUsers || {})) {
          this.uniqueUsersSeen.add(userId);
        }
      }
    } catch {
      // ignore
    }
  }

  private async persistAnalytics(): Promise<void> {
    try {
      const data: Record<string, unknown> = Object.fromEntries(this.analytics);
      data._uniqueUsers = Object.fromEntries(
        Array.from(this.uniqueUsersSeen).map((u) => [u, true])
      );
      await AsyncStorage.setItem(FEATURE_ANALYTICS_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  }

  private async loadStaleFlagConfig(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STALE_FLAG_CONFIG_KEY);
      if (stored) {
        this.staleConfig = { ...this.staleConfig, ...JSON.parse(stored) };
      }
    } catch {
      // ignore
    }
  }

  private async persistStaleFlagConfig(): Promise<void> {
    try {
      await AsyncStorage.setItem(STALE_FLAG_CONFIG_KEY, JSON.stringify(this.staleConfig));
    } catch {
      // ignore
    }
  }

  private startAnalyticsFlush(): void {
    if (this.analyticsFlushTimer) {
      clearInterval(this.analyticsFlushTimer);
    }
    this.analyticsFlushTimer = setInterval(() => {
      this.flushAnalytics();
    }, this.flushIntervalMs);
  }

  private async flushAnalytics(): Promise<void> {
    if (this.checkEvents.length === 0) return;
    await this.persistAnalytics();
  }

  destroy(): void {
    if (this.analyticsFlushTimer) {
      clearInterval(this.analyticsFlushTimer);
      this.analyticsFlushTimer = null;
    }
    this.flushAnalytics();
  }

  // ─── Usage Limits (preserved) ────────────────────────────────────────────

  getFeatureLimits(userTier: SubscriptionTier): Record<string, number> {
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
        max_subscriptions: -1,
        max_categories: -1,
        export_formats: 5,
      },
    };
    return limits[userTier] || limits[SubscriptionTier.FREE];
  }

  hasExceededLimit(userTier: SubscriptionTier, limitKey: string, currentUsage: number): boolean {
    const limits = this.getFeatureLimits(userTier);
    const limit = limits[limitKey];
    if (limit === -1) return false;
    return currentUsage >= limit;
  }

  getRemainingUsage(userTier: SubscriptionTier, limitKey: string, currentUsage: number): number {
    const limits = this.getFeatureLimits(userTier);
    const limit = limits[limitKey];
    if (limit === -1) return -1;
    return Math.max(0, limit - currentUsage);
  }
}

export const featureFlagsService = FeatureFlagsService.getInstance();
