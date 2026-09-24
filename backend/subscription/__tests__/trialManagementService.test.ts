/**
 * Trial Management Service Tests
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1118
 */

import { TrialManagementService } from '../domain/trialManagementService';

describe('TrialManagementService', () => {
  let service: TrialManagementService;

  beforeEach(() => {
    service = new TrialManagementService();
  });

  describe('startTrial', () => {
    it('should create an active trial', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
        durationDays: 14,
      });

      expect(trial.status).toBe('active');
      expect(trial.subscriptionId).toBe('sub_001');
      expect(trial.durationDays).toBe(14);
      expect(trial.extensionsGranted).toBe(0);
      expect(trial.engagementScore).toBe(50);
    });

    it('should default to 14-day duration', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'basic',
      });
      expect(trial.durationDays).toBe(14);
    });

    it('should throw if an active trial already exists', () => {
      service.startTrial({ subscriptionId: 'sub_001', userId: 'user_001', planId: 'premium' });
      expect(() =>
        service.startTrial({ subscriptionId: 'sub_001', userId: 'user_001', planId: 'premium' }),
      ).toThrow('already has an active trial');
    });

    it('should record a trial_started funnel event', () => {
      service.startTrial({ subscriptionId: 'sub_001', userId: 'user_001', planId: 'premium' });
      const trial = service.getActiveTrial('sub_001')!;
      const events = service.getFunnelEvents(trial.id);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('trial_started');
    });
  });

  describe('convertTrial', () => {
    it('should convert an active trial to paid', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
      });

      const converted = service.convertTrial(trial.id, 'manual_upgrade', 99.99);

      expect(converted.status).toBe('converted');
      expect(converted.convertedAt).toBeDefined();
      expect(converted.conversionTrigger).toBe('manual_upgrade');

      const events = service.getFunnelEvents(trial.id);
      expect(events.some((e) => e.eventType === 'trial_converted')).toBe(true);
      expect(events.some((e) => e.eventType === 'payment_completed')).toBe(true);
    });

    it('should throw for non-active trial', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
      });
      service.cancelTrial(trial.id);

      expect(() => service.convertTrial(trial.id)).toThrow('not active');
    });
  });

  describe('cancelTrial', () => {
    it('should cancel an active trial', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
      });

      const cancelled = service.cancelTrial(trial.id);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancelledAt).toBeDefined();
    });
  });

  describe('extendTrial', () => {
    it('should extend a trial by the rule days', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
      });
      const originalEnd = trial.endDate;

      const extended = service.extendTrial(trial.id, 'high_engagement');

      expect(extended.endDate).toBeGreaterThan(originalEnd);
      expect(extended.extensionsGranted).toBe(1);
    });

    it('should throw for unknown condition', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
      });

      expect(() => service.extendTrial(trial.id, 'support_ticket')).toThrow('No enabled extension rule');
    });
  });

  describe('updateEngagement', () => {
    it('should update the engagement score', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
      });

      const updated = service.updateEngagement(trial.id, 85);
      expect(updated.engagementScore).toBe(85);
    });

    it('should auto-extend on high engagement (score >= 80)', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
      });
      const originalEnd = trial.endDate;

      service.updateEngagement(trial.id, 85);

      const updated = service.getTrial(trial.id)!;
      expect(updated.endDate).toBeGreaterThan(originalEnd);
      expect(updated.extensionsGranted).toBe(1);
    });

    it('should reject invalid score', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
      });

      expect(() => service.updateEngagement(trial.id, 150)).toThrow('between 0 and 100');
    });
  });

  describe('tracking events', () => {
    it('should track feature access and boost engagement', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
      });
      const initialScore = trial.engagementScore;

      service.trackFeatureAccess(trial.id, 'analytics_dashboard');

      const updated = service.getTrial(trial.id)!;
      expect(updated.engagementScore).toBeGreaterThan(initialScore);

      const events = service.getFunnelEvents(trial.id);
      expect(events.some((e) => e.eventType === 'feature_accessed')).toBe(true);
    });

    it('should track dashboard visits and payment clicks', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
      });

      service.trackDashboardVisit(trial.id);
      service.trackPaymentClick(trial.id);

      const events = service.getFunnelEvents(trial.id);
      expect(events.some((e) => e.eventType === 'dashboard_visited')).toBe(true);
      expect(events.some((e) => e.eventType === 'payment_clicked')).toBe(true);
    });
  });

  describe('processExpirations', () => {
    it('should expire trials past their end date', () => {
      const trial = service.startTrial({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        planId: 'premium',
        durationDays: 7,
      });

      const future = Date.now() + 10 * 24 * 60 * 60 * 1000;
      const expired = service.processExpirations(future);

      expect(expired).toHaveLength(1);
      expect(expired[0].status).toBe('expired');
      expect(expired[0].id).toBe(trial.id);
    });
  });

  describe('getAnalytics', () => {
    it('should compute conversion analytics', () => {
      // Trial 1: converted
      const t1 = service.startTrial({ subscriptionId: 'sub_001', userId: 'user_001', planId: 'premium' });
      service.trackFeatureAccess(t1.id, 'feature1');
      service.trackDashboardVisit(t1.id);
      service.trackPaymentClick(t1.id);
      service.convertTrial(t1.id, 'manual_upgrade', 99.99);

      // Trial 2: expired
      const t2 = service.startTrial({ subscriptionId: 'sub_002', userId: 'user_002', planId: 'basic', durationDays: 7 });
      service.processExpirations(Date.now() + 10 * 24 * 60 * 60 * 1000);

      // Trial 3: cancelled
      const t3 = service.startTrial({ subscriptionId: 'sub_003', userId: 'user_003', planId: 'premium' });
      service.cancelTrial(t3.id);

      // Trial 4: still active
      service.startTrial({ subscriptionId: 'sub_004', userId: 'user_004', planId: 'enterprise' });

      const analytics = service.getAnalytics();

      expect(analytics.totalTrialsStarted).toBe(4);
      expect(analytics.convertedTrialsCount).toBe(1);
      expect(analytics.expiredTrialsCount).toBe(1);
      expect(analytics.cancelledTrialsCount).toBe(1);
      expect(analytics.activeTrialsCount).toBe(1);
      expect(analytics.trialConversionRate).toBe(25);
      expect(analytics.revenueFromConversions).toBe(99.99);
      expect(analytics.funnelStats.trialStarted).toBe(4);
      expect(analytics.funnelStats.featureAccessed).toBeGreaterThanOrEqual(1);
      expect(analytics.funnelStats.dashboardVisited).toBeGreaterThanOrEqual(1);
      expect(analytics.funnelStats.paymentClicked).toBeGreaterThanOrEqual(1);
      expect(analytics.funnelStats.paymentCompleted).toBeGreaterThanOrEqual(1);
      expect(analytics.conversionByTrigger['manual_upgrade']).toBe(1);
    });
  });

  describe('getExtensionRules', () => {
    it('should return default extension rules', () => {
      const rules = service.getExtensionRules();
      expect(rules).toHaveLength(3);
      expect(rules.map((r) => r.condition)).toContain('high_engagement');
      expect(rules.map((r) => r.condition)).toContain('inactive_reminder');
      expect(rules.map((r) => r.condition)).toContain('promo_offer');
    });

    it('should toggle extension rule enabled state', () => {
      const rule = service.setExtensionRuleEnabled('ext-high-engagement', false);
      expect(rule).not.toBeNull();
      expect(rule!.isEnabled).toBe(false);
    });
  });
});
