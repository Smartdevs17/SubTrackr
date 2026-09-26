import {
  FeatureFlag,
  FeatureAccessResult,
  FeatureConfig,
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
} from '../../src/types/feature';
import { SubscriptionTier } from '../../src/types/subscription';
import { FEATURE_CONFIG } from '../../src/config/features';

const DEFAULT_STALE_FLAG_CONFIG: StaleFlagConfig = {
  enabled: true,
  noCheckThresholdDays: 90,
  fullRolloutThresholdDays: 60,
};

type StoreLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export class BackendFeatureFlagsService {
  private abTestAssignments = new Map<string, string>();
  private checkEvents: FeatureCheckEvent[] = [];
  private analytics = new Map<string, FeatureFlagAnalytics>();
  private uniqueUsersSeen = new Set<string>();
  private staleConfig: StaleFlagConfig = { ...DEFAULT_STALE_FLAG_CONFIG };
  private featureConfig: FeatureConfig;
  private store: StoreLike | null;
  private storeKey: string;

  constructor(options?: {
    featureConfig?: FeatureConfig;
    store?: StoreLike;
    storeKey?: string;
  }) {
    this.featureConfig = options?.featureConfig ?? FEATURE_CONFIG;
    this.store = options?.store ?? null;
    this.storeKey = options?.storeKey ?? 'bfeature_flags_state';

    if (this.store) {
      this.loadState();
    }
  }

  // ─── State Persistence ───────────────────────────────────────────────────

  private loadState(): void {
    if (!this.store) return;
    try {
      const raw = this.store.getItem(this.storeKey);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state.abTestAssignments) {
        this.abTestAssignments = new Map(Object.entries(state.abTestAssignments));
      }
      if (state.analytics) {
        this.analytics = new Map(Object.entries(state.analytics));
      }
      if (state.uniqueUsers) {
        for (const uid of Object.keys(state.uniqueUsers)) {
          this.uniqueUsersSeen.add(uid);
        }
      }
      if (state.staleConfig) {
        this.staleConfig = { ...this.staleConfig, ...state.staleConfig };
      }
    } catch {
      // ignore
    }
  }

  private persistState(): void {
    if (!this.store) return;
    try {
      const data: Record<string, unknown> = {
        abTestAssignments: Object.fromEntries(this.abTestAssignments),
        analytics: Object.fromEntries(this.analytics),
        uniqueUsers: Object.fromEntries(Array.from(this.uniqueUsersSeen).map((u) => [u, true])),
        staleConfig: this.staleConfig,
      };
      this.store.setItem(this.storeKey, JSON.stringify(data));
    } catch {
      // ignore
    }
  }

  // ─── Kill Switch ─────────────────────────────────────────────────────────

  activateKillSwitch(featureId?: string, message?: string): void {
    const ks = this.featureConfig.killSwitch;
    if (!ks) return;
    ks.active = true;
    if (featureId) {
      ks.overrides[featureId] = {
        active: true,
        featureIds: featureId ? [featureId as any] : undefined,
        message: message || 'Feature temporarily disabled',
        triggeredAt: new Date(),
        triggeredBy: 'admin',
      };
    }
  }

  deactivateKillSwitch(featureId?: string): void {
    const ks = this.featureConfig.killSwitch;
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
    const ks = this.featureConfig.killSwitch;
    if (!ks || !ks.active) return false;
    if (ks.overrides[featureId]?.active === true) return true;
    if (Object.keys(ks.overrides).length === 0) return true;
    return false;
  }

  getActiveKillSwitches(): string[] {
    const ks = this.featureConfig.killSwitch;
    if (!ks || !ks.active) return [];
    return Object.entries(ks.overrides)
      .filter(([, c]) => c.active)
      .map(([id]) => id);
  }

  // ─── User Segment Evaluation ─────────────────────────────────────────────

  private evaluateCondition(condition: UserSegmentCondition, attrs: UserAttributes): boolean {
    const val = attrs[condition.attribute];
    switch (condition.operator) {
      case 'eq': return val === condition.value;
      case 'neq': return val !== condition.value;
      case 'in': return Array.isArray(condition.value) && condition.value.includes(val as string);
      case 'not_in': return Array.isArray(condition.value) && !condition.value.includes(val as string);
      case 'gt': return typeof val === 'number' && typeof condition.value === 'number' && val > condition.value;
      case 'gte': return typeof val === 'number' && typeof condition.value === 'number' && val >= condition.value;
      case 'lt': return typeof val === 'number' && typeof condition.value === 'number' && val < condition.value;
      case 'lte': return typeof val === 'number' && typeof condition.value === 'number' && val <= condition.value;
      default: return false;
    }
  }

  private isUserInSegment(segment: UserSegment, attrs: UserAttributes): boolean {
    if (segment.matchAll !== false) {
      return segment.conditions.every((c) => this.evaluateCondition(c, attrs));
    }
    return segment.conditions.some((c) => this.evaluateCondition(c, attrs));
  }

  private getMatchedSegments(feature: FeatureFlag, attrs: UserAttributes): string[] {
    if (!feature.segments || feature.segments.length === 0) return [];
    const segments = this.featureConfig.segments || [];
    return feature.segments.filter((segId) => {
      const seg = segments.find((s) => s.id === segId);
      return seg ? this.isUserInSegment(seg, attrs) : false;
    });
  }

  private resolveSegmentAccess(feature: FeatureFlag, attrs: UserAttributes): {
    hasAccess: boolean;
    matchedSegment?: string;
  } {
    if (!feature.segments || feature.segments.length === 0) return { hasAccess: true };
    const matched = this.getMatchedSegments(feature, attrs);
    if (matched.length > 0) return { hasAccess: true, matchedSegment: matched[0] };
    return { hasAccess: false };
  }

  // ─── Rollout ─────────────────────────────────────────────────────────────

  private getCurrentRolloutPercentage(feature: FeatureFlag): number {
    if (feature.rolloutStages && feature.rolloutStages.length > 0) {
      const sorted = [...feature.rolloutStages].sort((a, b) => b.percentage - a.percentage);
      return sorted[0].percentage;
    }
    return feature.rolloutPercentage ?? 100;
  }

  private isUserInRollout(percentage: number, userId: string | null): boolean {
    if (percentage >= 100) return true;
    if (!userId) return false;
    const hash = this.hashString(userId);
    return (hash % 100) / 100 < percentage / 100;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  // ─── A/B Test ────────────────────────────────────────────────────────────

  private getABTestGroup(featureId: string, userId: string | null): string | null {
    if (!userId) return null;
    const key = `${featureId}:${userId}`;
    let group = this.abTestAssignments.get(key);
    if (!group) {
      const feature = this.featureConfig.features[featureId];
      if (feature?.abTestGroups?.length) {
        const idx = this.hashString(userId) % feature.abTestGroups.length;
        group = feature.abTestGroups[idx];
        this.abTestAssignments.set(key, group);
        this.persistState();
      }
    }
    return group ?? null;
  }

  getABTestAssignments(userId?: string): ABTestAssignment[] {
    return Array.from(this.abTestAssignments.entries())
      .filter(([k]) => !userId || k.endsWith(`:${userId}`))
      .map(([k, v]) => {
        const [featureId] = k.split(':');
        return { featureId, userId: userId ?? '', group: v, assignedAt: 0 };
      });
  }

  getABTestGroups(featureId: string): string[] {
    return this.featureConfig.features[featureId]?.abTestGroups || [];
  }

  // ─── Configuration Conflict Detection ────────────────────────────────────

  detectConfigConflicts(): ConfigConflict[] {
    const conflicts: ConfigConflict[] = [];
    const features = this.featureConfig.features;

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
          } else if (
            feature.rolloutPercentage &&
            features[depId].rolloutPercentage &&
            feature.rolloutPercentage > features[depId].rolloutPercentage
          ) {
            conflicts.push({
              type: 'rollout_mismatch',
              featureId: id,
              description: `Rollout ${feature.rolloutPercentage}% exceeds dependency ${depId} rollout ${features[depId].rolloutPercentage}%`,
              severity: 'warning',
            });
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
        const segments = this.featureConfig.segments || [];
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

  checkFeatureAccess(
    featureId: string,
    userTier: SubscriptionTier,
    userId?: string,
    attributes?: UserAttributes
  ): FeatureAccessResult {
    const startTime = Date.now();
    const resolvedUserId = userId || 'anonymous';
    const feature = this.featureConfig.features[featureId];

    if (!feature) {
      this.recordEvent(featureId, resolvedUserId, userTier, false, 'Feature not found', startTime);
      return { hasAccess: false, reason: 'Feature not found' };
    }

    if (this.isKillSwitched(featureId)) {
      this.recordEvent(featureId, resolvedUserId, userTier, false, 'Kill switch active', startTime);
      const ks = this.featureConfig.killSwitch;
      return {
        hasAccess: false,
        reason: ks?.overrides[featureId]?.message || 'Feature temporarily disabled',
        isKillSwitched: true,
      };
    }

    if (!feature.enabled) {
      this.recordEvent(featureId, resolvedUserId, userTier, false, 'Feature is disabled', startTime);
      return { hasAccess: false, reason: 'Feature is disabled' };
    }

    if (!feature.tierAccess.includes(userTier)) {
      this.recordEvent(featureId, resolvedUserId, userTier, false, 'Tier access denied', startTime);
      return { hasAccess: false, reason: `Requires ${feature.tierAccess.join(' or ')} subscription` };
    }

    if (feature.dependencies) {
      for (const depId of feature.dependencies) {
        const depResult = this.checkFeatureAccess(depId, userTier, resolvedUserId, attributes);
        if (!depResult.hasAccess) {
          this.recordEvent(featureId, resolvedUserId, userTier, false, `Requires ${depId}`, startTime);
          return { hasAccess: false, reason: `Requires ${depId}` };
        }
      }
    }

    if (attributes && feature.segments?.length) {
      const segResult = this.resolveSegmentAccess(feature, attributes);
      if (!segResult.hasAccess) {
        this.recordEvent(featureId, resolvedUserId, userTier, false, 'Segment targeting not met', startTime);
        return { hasAccess: false, reason: 'Feature not available for your user segment' };
      }
    }

    const pct = this.getCurrentRolloutPercentage(feature);
    if (!this.isUserInRollout(pct, resolvedUserId)) {
      this.recordEvent(featureId, resolvedUserId, userTier, false, 'Not in rollout', startTime);
      return { hasAccess: false, reason: 'Feature not available in current rollout', isInRollout: false };
    }

    if (feature.abTestGroups?.length) {
      const group = this.getABTestGroup(featureId, resolvedUserId);
      if (!group) {
        this.recordEvent(featureId, resolvedUserId, userTier, false, 'Not in A/B test', startTime);
        return { hasAccess: false, reason: 'Not selected for A/B test', isInAbTest: false };
      }
      const matched = attributes ? this.resolveSegmentAccess(feature, attributes).matchedSegment : undefined;
      this.recordEvent(featureId, resolvedUserId, userTier, true, undefined, startTime);
      return { hasAccess: true, isInRollout: true, isInAbTest: true, abTestGroup: group, matchedSegment: matched };
    }

    const matched = attributes ? this.resolveSegmentAccess(feature, attributes).matchedSegment : undefined;
    this.recordEvent(featureId, resolvedUserId, userTier, true, undefined, startTime);
    return { hasAccess: true, isInRollout: true, matchedSegment: matched };
  }

  // ─── Analytics ───────────────────────────────────────────────────────────

  private recordEvent(
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
    if (this.checkEvents.length > 10_000) {
      this.checkEvents = this.checkEvents.slice(-5_000);
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
    if (event.hasAccess) existing.accessGranted += 1;
    else {
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

  getFeatureAnalytics(featureId: string): FeatureFlagAnalytics | null {
    return this.analytics.get(featureId) ?? null;
  }

  getAnalyticsReport(): FeatureAnalyticsReport {
    const features: Record<string, FeatureFlagAnalytics> = {};
    for (const [id, a] of this.analytics) features[id] = a;
    return { features, staleFlags: this.detectStaleFlags(), generatedAt: Date.now() };
  }

  getFeatureCheckHistory(featureId: string, limit = 50): FeatureCheckEvent[] {
    return this.checkEvents.filter((e) => e.featureId === featureId).slice(-limit);
  }

  getMostCheckedFeatures(limit = 10): { featureId: string; checks: number }[] {
    return Array.from(this.analytics.entries())
      .map(([id, a]) => ({ featureId: id, checks: a.totalChecks }))
      .sort((a, b) => b.checks - a.checks)
      .slice(0, limit);
  }

  getMostDeniedFeatures(limit = 10): { featureId: string; denials: number }[] {
    return Array.from(this.analytics.entries())
      .map(([id, a]) => ({ featureId: id, denials: a.accessDenied }))
      .sort((a, b) => b.denials - a.denials)
      .slice(0, limit);
  }

  getFeatureDenyBreakdown(featureId: string): Record<string, number> {
    return this.analytics.get(featureId)?.denyReasons ?? {};
  }

  // ─── Stale Flag Detection ────────────────────────────────────────────────

  setStaleFlagConfig(config: Partial<StaleFlagConfig>): void {
    this.staleConfig = { ...this.staleConfig, ...config };
    this.persistState();
  }

  getStaleFlagConfig(): StaleFlagConfig {
    return { ...this.staleConfig };
  }

  detectStaleFlags(): StaleFlagReport[] {
    const reports: StaleFlagReport[] = [];
    const now = Date.now();
    const noCheckMs = this.staleConfig.noCheckThresholdDays * 86_400_000;
    const fullRolloutDays = this.staleConfig.fullRolloutThresholdDays;

    for (const [id, feature] of Object.entries(this.featureConfig.features)) {
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
        daysSinceLastCheck > fullRolloutDays
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

  // ─── Utility ─────────────────────────────────────────────────────────────

  getAvailableFeatures(userTier: SubscriptionTier): string[] {
    return (this.featureConfig.plans as any)[userTier] || [];
  }

  getFeature(featureId: string): FeatureFlag | null {
    return this.featureConfig.features[featureId] || null;
  }

  getAllFeatures(): Record<string, FeatureFlag> {
    return this.featureConfig.features;
  }

  flush(): void {
    this.persistState();
  }
}

export const backendFeatureFlagsService = new BackendFeatureFlagsService();
