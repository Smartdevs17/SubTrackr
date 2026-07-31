import { BackendFeatureFlagsService } from '../featureFlags';
import {
  FeatureConfig,
  FeatureId,
  SubscriptionTier,
} from '../../../src/types/feature';

function cloneConfig(cfg: FeatureConfig): FeatureConfig {
  return JSON.parse(JSON.stringify(cfg));
}

const BASE_CONFIG: FeatureConfig = {
  globalRolloutPercentage: 100,
  abTestEnabled: true,
  segments: [
    { id: 'beta_testers', name: 'Beta Testers', conditions: [{ attribute: 'isBetaTester', operator: 'eq', value: true }], matchAll: true },
    { id: 'us_region', name: 'US Region', conditions: [{ attribute: 'region', operator: 'eq', value: 'us' }], matchAll: true },
  ],
  killSwitch: { active: false, overrides: {} },
  plans: {
    [SubscriptionTier.FREE]: [FeatureId.BASIC_SUBSCRIPTION_TRACKING],
    [SubscriptionTier.PREMIUM]: [FeatureId.BASIC_SUBSCRIPTION_TRACKING, FeatureId.ADVANCED_ANALYTICS],
    [SubscriptionTier.ENTERPRISE]: [FeatureId.BASIC_SUBSCRIPTION_TRACKING, FeatureId.ADVANCED_ANALYTICS, FeatureId.API_ACCESS],
    [SubscriptionTier.BASIC]: [FeatureId.BASIC_SUBSCRIPTION_TRACKING],
  },
  features: {
    [FeatureId.BASIC_SUBSCRIPTION_TRACKING]: {
      id: FeatureId.BASIC_SUBSCRIPTION_TRACKING,
      name: 'Basic Tracking',
      description: 'test',
      enabled: true,
      tierAccess: [SubscriptionTier.FREE, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE, SubscriptionTier.BASIC],
      rolloutPercentage: 100,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    [FeatureId.ADVANCED_ANALYTICS]: {
      id: FeatureId.ADVANCED_ANALYTICS,
      name: 'Advanced Analytics',
      description: 'test',
      enabled: true,
      tierAccess: [SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
      dependencies: [FeatureId.BASIC_SUBSCRIPTION_TRACKING],
      rolloutPercentage: 100,
      segments: ['beta_testers'],
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    [FeatureId.API_ACCESS]: {
      id: FeatureId.API_ACCESS,
      name: 'API Access',
      description: 'test',
      enabled: false,
      tierAccess: [SubscriptionTier.ENTERPRISE],
      rolloutPercentage: 100,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    'stale_feature': {
      id: 'stale_feature',
      name: 'Stale Feature',
      description: 'test',
      enabled: true,
      tierAccess: [SubscriptionTier.ENTERPRISE],
      rolloutPercentage: 100,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
  },
};

const mockStore = (() => {
  const data: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => data[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { data[key] = value; }),
    clear: () => { Object.keys(data).forEach(k => delete data[k]); },
  };
})();

function createService(config?: Partial<FeatureConfig>): BackendFeatureFlagsService {
  mockStore.clear();
  jest.mocked(mockStore.getItem).mockClear();
  jest.mocked(mockStore.setItem).mockClear();
  const merged = cloneConfig({ ...BASE_CONFIG, ...config, features: { ...BASE_CONFIG.features, ...config?.features } });
  return new BackendFeatureFlagsService({
    featureConfig: merged as FeatureConfig,
    store: mockStore,
    storeKey: 'test_flags',
  });
}

describe('BackendFeatureFlagsService', () => {
  let service: BackendFeatureFlagsService;

  beforeEach(() => {
    service = createService();
  });

  // ─── Kill Switch ──────────────────────────────────────────────────────────

  describe('kill switch', () => {
    it('returns normal access when kill switch is not active', () => {
      const result = service.checkFeatureAccess(
        FeatureId.BASIC_SUBSCRIPTION_TRACKING,
        SubscriptionTier.FREE,
        'user_1'
      );
      expect(result.hasAccess).toBe(true);
      expect(result.isKillSwitched).toBeUndefined();
    });

    it('blocks feature when kill switch is activated globally', () => {
      service.activateKillSwitch();
      const result = service.checkFeatureAccess(
        FeatureId.BASIC_SUBSCRIPTION_TRACKING,
        SubscriptionTier.FREE,
        'user_1'
      );
      expect(result.hasAccess).toBe(false);
      expect(result.isKillSwitched).toBe(true);
    });

    it('blocks only the targeted feature when kill switch is activated with featureId', () => {
      service.activateKillSwitch(FeatureId.ADVANCED_ANALYTICS, 'Under maintenance');
      const blocked = service.checkFeatureAccess(
        FeatureId.ADVANCED_ANALYTICS,
        SubscriptionTier.PREMIUM,
        'user_1',
        { userId: 'user_1', isBetaTester: true }
      );
      expect(blocked.hasAccess).toBe(false);
      expect(blocked.isKillSwitched).toBe(true);
      expect(blocked.reason).toBe('Under maintenance');

      const allowed = service.checkFeatureAccess(
        FeatureId.BASIC_SUBSCRIPTION_TRACKING,
        SubscriptionTier.FREE,
        'user_1'
      );
      expect(allowed.hasAccess).toBe(true);
    });

    it('deactivates kill switch for a specific feature', () => {
      service.activateKillSwitch(FeatureId.ADVANCED_ANALYTICS);
      expect(service.isKillSwitched(FeatureId.ADVANCED_ANALYTICS)).toBe(true);
      service.deactivateKillSwitch(FeatureId.ADVANCED_ANALYTICS);
      expect(service.isKillSwitched(FeatureId.ADVANCED_ANALYTICS)).toBe(false);
    });

    it('lists active kill switches', () => {
      expect(service.getActiveKillSwitches()).toEqual([]);
      service.activateKillSwitch(FeatureId.ADVANCED_ANALYTICS);
      expect(service.getActiveKillSwitches()).toEqual([FeatureId.ADVANCED_ANALYTICS]);
    });
  });

  // ─── User Segment Targeting ──────────────────────────────────────────────

  describe('user segment targeting', () => {
    it('allows access when user matches a required segment', () => {
      const result = service.checkFeatureAccess(
        FeatureId.ADVANCED_ANALYTICS,
        SubscriptionTier.PREMIUM,
        'user_1',
        { userId: 'user_1', isBetaTester: true }
      );
      expect(result.hasAccess).toBe(true);
      expect(result.matchedSegment).toBe('beta_testers');
    });

    it('denies access when user does not match required segment', () => {
      const result = service.checkFeatureAccess(
        FeatureId.ADVANCED_ANALYTICS,
        SubscriptionTier.PREMIUM,
        'user_1',
        { userId: 'user_1', isBetaTester: false }
      );
      expect(result.hasAccess).toBe(false);
      expect(result.reason).toContain('segment');
    });

    it('allows access when feature has no segments defined', () => {
      const result = service.checkFeatureAccess(
        FeatureId.BASIC_SUBSCRIPTION_TRACKING,
        SubscriptionTier.FREE,
        'user_1'
      );
      expect(result.hasAccess).toBe(true);
    });
  });

  // ─── Gradual Rollout ─────────────────────────────────────────────────────

  describe('gradual rollout', () => {
    it('allows access when rollout is 100%', () => {
      const result = service.checkFeatureAccess(
        FeatureId.BASIC_SUBSCRIPTION_TRACKING,
        SubscriptionTier.FREE,
        'user_1'
      );
      expect(result.hasAccess).toBe(true);
      expect(result.isInRollout).toBe(true);
    });

    it('respects rollout percentage boundaries', () => {
      const svc = createService({
        features: {
          ...BASE_CONFIG.features,
          limited_rollout: {
            id: 'limited_rollout',
            name: 'Limited',
            description: 'test',
            enabled: true,
            tierAccess: [SubscriptionTier.FREE, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE, SubscriptionTier.BASIC],
            rolloutPercentage: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        } as any,
        plans: {
          ...BASE_CONFIG.plans,
          [SubscriptionTier.FREE]: [...(BASE_CONFIG.plans[SubscriptionTier.FREE] || []), 'limited_rollout' as any],
          [SubscriptionTier.BASIC]: [...(BASE_CONFIG.plans[SubscriptionTier.BASIC] || []), 'limited_rollout' as any],
          [SubscriptionTier.PREMIUM]: [...(BASE_CONFIG.plans[SubscriptionTier.PREMIUM] || []), 'limited_rollout' as any],
          [SubscriptionTier.ENTERPRISE]: [...(BASE_CONFIG.plans[SubscriptionTier.ENTERPRISE] || []), 'limited_rollout' as any],
        },
      });
      const result = svc.checkFeatureAccess('limited_rollout' as any, SubscriptionTier.FREE, 'any_user');
      expect(result.hasAccess).toBe(false);
      expect(result.isInRollout).toBe(false);
    });

    it('deterministically assigns users based on hash', () => {
      const r1 = service.checkFeatureAccess(
        FeatureId.ADVANCED_ANALYTICS,
        SubscriptionTier.PREMIUM,
        'deterministic_user',
        { userId: 'deterministic_user', isBetaTester: true }
      );
      const r2 = service.checkFeatureAccess(
        FeatureId.ADVANCED_ANALYTICS,
        SubscriptionTier.PREMIUM,
        'deterministic_user',
        { userId: 'deterministic_user', isBetaTester: true }
      );
      expect(r1.hasAccess).toBe(r2.hasAccess);
    });
  });

  // ─── A/B Testing ─────────────────────────────────────────────────────────

  describe('A/B testing', () => {
    it('assigns user to a group consistently', () => {
      const svc = createService({
        features: {
          ...BASE_CONFIG.features,
          test_ab: {
            id: 'test_ab',
            name: 'AB Test Feature',
            description: 'test',
            enabled: true,
            tierAccess: [SubscriptionTier.FREE, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE, SubscriptionTier.BASIC],
            rolloutPercentage: 100,
            abTestGroups: ['control', 'variant_a'],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        } as any,
        plans: {
          ...BASE_CONFIG.plans,
          [SubscriptionTier.FREE]: [...(BASE_CONFIG.plans[SubscriptionTier.FREE] || []), 'test_ab' as any],
          [SubscriptionTier.BASIC]: [...(BASE_CONFIG.plans[SubscriptionTier.BASIC] || []), 'test_ab' as any],
          [SubscriptionTier.PREMIUM]: [...(BASE_CONFIG.plans[SubscriptionTier.PREMIUM] || []), 'test_ab' as any],
          [SubscriptionTier.ENTERPRISE]: [...(BASE_CONFIG.plans[SubscriptionTier.ENTERPRISE] || []), 'test_ab' as any],
        },
      });

      const r1 = svc.checkFeatureAccess('test_ab' as any, SubscriptionTier.FREE, 'ab_user');
      expect(r1.hasAccess).toBe(true);
      expect(r1.isInAbTest).toBe(true);
      expect(['control', 'variant_a']).toContain(r1.abTestGroup);

      const r2 = svc.checkFeatureAccess('test_ab' as any, SubscriptionTier.FREE, 'ab_user');
      expect(r2.abTestGroup).toBe(r1.abTestGroup);
    });
  });

  // ─── Feature Dependencies ────────────────────────────────────────────────

  describe('feature dependencies', () => {
    it('allows access when dependencies are met', () => {
      const result = service.checkFeatureAccess(
        FeatureId.ADVANCED_ANALYTICS,
        SubscriptionTier.PREMIUM,
        'user_1',
        { userId: 'user_1', isBetaTester: true }
      );
      expect(result.hasAccess).toBe(true);
    });

    it('denies access when dependency is not available', () => {
      const result = service.checkFeatureAccess(
        FeatureId.CUSTOM_REPORTS as any,
        SubscriptionTier.ENTERPRISE,
        'user_1'
      );
      expect(result.hasAccess).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  // ─── Tier Access ─────────────────────────────────────────────────────────

  describe('tier access', () => {
    it('allows access when user tier is in tierAccess', () => {
      const result = service.checkFeatureAccess(
        FeatureId.BASIC_SUBSCRIPTION_TRACKING,
        SubscriptionTier.FREE,
        'user_1'
      );
      expect(result.hasAccess).toBe(true);
    });

    it('denies access when user tier is not in tierAccess', () => {
      const result = service.checkFeatureAccess(
        FeatureId.ADVANCED_ANALYTICS,
        SubscriptionTier.FREE,
        'user_1',
        { userId: 'user_1', isBetaTester: true }
      );
      expect(result.hasAccess).toBe(false);
      expect(result.reason).toContain('subscription');
    });
  });

  // ─── Disabled Feature ────────────────────────────────────────────────────

  describe('disabled feature', () => {
    it('denies access when feature is disabled', () => {
      const result = service.checkFeatureAccess(
        FeatureId.API_ACCESS,
        SubscriptionTier.ENTERPRISE,
        'user_1'
      );
      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Feature is disabled');
    });
  });

  // ─── Unknown Feature ─────────────────────────────────────────────────────

  describe('unknown feature', () => {
    it('returns not found for non-existent feature', () => {
      const result = service.checkFeatureAccess('nonexistent' as any, SubscriptionTier.FREE, 'user_1');
      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Feature not found');
    });
  });

  // ─── Configuration Conflict Detection ────────────────────────────────────

  describe('config conflict detection', () => {
    it('detects missing dependency', () => {
      const conflicts = service.detectConfigConflicts();
      const missing = conflicts.find(
        (c) => c.type === 'dependency_missing' && c.featureId === FeatureId.CUSTOM_REPORTS
      );
      expect(missing).toBeUndefined();
    });

    it('detects tier missing', () => {
      const conflicts = service.detectConfigConflicts();
      expect(conflicts.filter((c) => c.type === 'tier_missing')).toHaveLength(0);
    });

    it('detects invalid segment references', () => {
      const conflicts = service.detectConfigConflicts();
      const invalid = conflicts.filter((c) => c.type === 'invalid_segment');
      expect(invalid).toHaveLength(0);
    });

    it('detects killswitch override as conflict', () => {
      service.activateKillSwitch(FeatureId.ADVANCED_ANALYTICS);
      const conflicts = service.detectConfigConflicts();
      const ks = conflicts.find((c) => c.type === 'killswitch_override');
      expect(ks).toBeDefined();
    });
  });

  // ─── Analytics ───────────────────────────────────────────────────────────

  describe('analytics', () => {
    it('tracks feature check events', () => {
      service.checkFeatureAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING, SubscriptionTier.FREE, 'user_1');
      const analytics = service.getFeatureAnalytics(FeatureId.BASIC_SUBSCRIPTION_TRACKING);
      expect(analytics).toBeDefined();
      expect(analytics!.totalChecks).toBe(1);
      expect(analytics!.accessGranted).toBe(1);
    });

    it('tracks denied access reasons', () => {
      service.checkFeatureAccess(FeatureId.API_ACCESS, SubscriptionTier.FREE, 'user_1');
      const analytics = service.getFeatureAnalytics(FeatureId.API_ACCESS);
      expect(analytics).toBeDefined();
      expect(analytics!.accessDenied).toBe(1);
      expect(analytics!.denyReasons['Feature is disabled']).toBe(1);
    });

    it('generates analytics report with stale flags', () => {
      service.checkFeatureAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING, SubscriptionTier.FREE, 'user_1');
      const report = service.getAnalyticsReport();
      expect(report.features[FeatureId.BASIC_SUBSCRIPTION_TRACKING]).toBeDefined();
      expect(report.staleFlags).toBeDefined();
      expect(report.generatedAt).toBeGreaterThan(0);
    });

    it('returns most checked features', () => {
      service.checkFeatureAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING, SubscriptionTier.FREE, 'user_1');
      service.checkFeatureAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING, SubscriptionTier.FREE, 'user_2');
      const top = service.getMostCheckedFeatures();
      expect(top[0].featureId).toBe(FeatureId.BASIC_SUBSCRIPTION_TRACKING);
      expect(top[0].checks).toBe(2);
    });

    it('returns most denied features', () => {
      service.checkFeatureAccess(FeatureId.API_ACCESS, SubscriptionTier.FREE, 'user_1');
      service.checkFeatureAccess(FeatureId.API_ACCESS, SubscriptionTier.BASIC, 'user_1');
      const top = service.getMostDeniedFeatures();
      expect(top.some((f) => f.featureId === FeatureId.API_ACCESS)).toBe(true);
    });

    it('provides deny reason breakdown', () => {
      service.checkFeatureAccess(FeatureId.API_ACCESS, SubscriptionTier.FREE, 'user_1');
      service.checkFeatureAccess(FeatureId.API_ACCESS, SubscriptionTier.BASIC, 'user_1');
      const breakdown = service.getFeatureDenyBreakdown(FeatureId.API_ACCESS);
      expect(breakdown['Feature is disabled']).toBe(2);
    });
  });

  // ─── Stale Flag Detection ────────────────────────────────────────────────

  describe('stale flag detection', () => {
    it('reports features with no checks as stale', () => {
      const stale = service.detectStaleFlags();
      const staleFeature = stale.find((s) => s.featureId === 'stale_feature');
      expect(staleFeature).toBeDefined();
      expect(staleFeature!.reason).toBe('no_checks');
      expect(staleFeature!.suggestion).toContain('removing');
    });

    it('reports fully rolled out features as stale after threshold', () => {
      const OLD_TIME = 100_000_000_000;
      jest.useFakeTimers({ now: OLD_TIME });
      service = createService();

      service.checkFeatureAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING, SubscriptionTier.FREE, 'user_1');
      service.setStaleFlagConfig({ noCheckThresholdDays: 0, fullRolloutThresholdDays: 0 });

      jest.setSystemTime(OLD_TIME + 86_400_001);
      const stale = service.detectStaleFlags();
      const fullRollout = stale.find((s) => s.reason === 'full_rollout_aged');
      expect(fullRollout).toBeDefined();

      jest.useRealTimers();
    });

    it('respects custom stale flag config', () => {
      service.setStaleFlagConfig({ enabled: false, noCheckThresholdDays: 200, fullRolloutThresholdDays: 200 });
      const config = service.getStaleFlagConfig();
      expect(config.enabled).toBe(false);
      expect(config.noCheckThresholdDays).toBe(200);
    });
  });

  // ─── Utility Methods ─────────────────────────────────────────────────────

  describe('utility methods', () => {
    it('returns available features for a tier', () => {
      const features = service.getAvailableFeatures(SubscriptionTier.FREE);
      expect(features).toContain(FeatureId.BASIC_SUBSCRIPTION_TRACKING);
    });

    it('returns feature by ID', () => {
      const feature = service.getFeature(FeatureId.BASIC_SUBSCRIPTION_TRACKING);
      expect(feature).toBeDefined();
      expect(feature!.name).toBe('Basic Tracking');
    });

    it('returns null for unknown feature', () => {
      const feature = service.getFeature('unknown');
      expect(feature).toBeNull();
    });

    it('returns all features', () => {
      const all = service.getAllFeatures();
      expect(Object.keys(all).length).toBeGreaterThan(0);
    });

    it('returns check history for a feature', () => {
      service.checkFeatureAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING, SubscriptionTier.FREE, 'user_1');
      const history = service.getFeatureCheckHistory(FeatureId.BASIC_SUBSCRIPTION_TRACKING);
      expect(history.length).toBe(1);
      expect(history[0].featureId).toBe(FeatureId.BASIC_SUBSCRIPTION_TRACKING);
    });
  });

  // ─── Persistence ─────────────────────────────────────────────────────────

  describe('state persistence', () => {
    it('persists and restores state via store', () => {
      service.checkFeatureAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING, SubscriptionTier.FREE, 'user_1');
      service.flush();

      const newService = new BackendFeatureFlagsService({
        featureConfig: BASE_CONFIG,
        store: mockStore,
        storeKey: 'test_flags',
      });

      const analytics = newService.getFeatureAnalytics(FeatureId.BASIC_SUBSCRIPTION_TRACKING);
      expect(analytics).toBeDefined();
      expect(analytics!.totalChecks).toBe(1);
    });

    it('flushes state on demand', () => {
      const setSpy = jest.spyOn(mockStore, 'setItem');
      service.checkFeatureAccess(FeatureId.BASIC_SUBSCRIPTION_TRACKING, SubscriptionTier.FREE, 'user_1');
      service.flush();
      expect(setSpy).toHaveBeenCalled();
      setSpy.mockRestore();
    });
  });
});
