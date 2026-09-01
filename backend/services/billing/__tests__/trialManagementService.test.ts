import {
  TrialManagementService,
  DEFAULT_TRIAL_POLICY,
} from '../trialManagementService';

describe('TrialManagementService', () => {
  let service: TrialManagementService;

  beforeEach(() => {
    service = new TrialManagementService();
  });

  describe('Trial Policy and Start', () => {
    it('initializes with default policy', () => {
      const policy = service.getPolicy('pro-plan');
      expect(policy.durationDays).toBe(14);
      expect(policy.gracePeriodDays).toBe(3);
      expect(policy.autoConvertOnExpiry).toBe(true);
    });

    it('creates and enrolls a new trial subscription', () => {
      const trial = service.startTrial('user-123', 'pro-plan', 50, {
        durationDays: 7,
        earlyConversionDiscountBps: 2500,
      });

      expect(trial.id).toBeDefined();
      expect(trial.userId).toBe('user-123');
      expect(trial.planId).toBe('pro-plan');
      expect(trial.status).toBe('active');
      expect(trial.autoConvert).toBe(true);
      expect(trial.conversionDiscountBps).toBe(2500);

      const diffDays = Math.round((trial.endDate.getTime() - trial.startDate.getTime()) / 86_400_000);
      expect(diffDays).toBe(7);
    });
  });

  describe('Propensity Scoring and Dynamic Incentives', () => {
    it('calculates disengaged category for zero activity', () => {
      const trial = service.startTrial('user-low', 'basic-plan', 20);
      const propensity = service.calculatePropensityScore(trial.id);

      expect(propensity.score).toBeLessThan(25);
      expect(propensity.category).toBe('disengaged');
    });

    it('calculates high propensity when subscriber has rich activity signals', () => {
      const trial = service.startTrial('user-power', 'enterprise-plan', 200);

      service.recordActivity(trial.id, {
        featureUsageCount: 5,
        loginCount: 4,
        daysActive: 3,
        dashboardViews: 4,
        exportsTriggered: 2,
      });

      const propensity = service.calculatePropensityScore(trial.id);
      expect(propensity.score).toBeGreaterThanOrEqual(75);
      expect(propensity.category).toBe('high_propensity');
    });

    it('generates targeted retention incentive for at_risk users', () => {
      const trial = service.startTrial('user-risk', 'pro-plan', 50);

      service.recordActivity(trial.id, {
        featureUsageCount: 1,
        loginCount: 1,
        daysActive: 1,
        dashboardViews: 2,
      });

      const propensity = service.calculatePropensityScore(trial.id);
      expect(propensity.category).toBe('at_risk');
      expect(propensity.recommendedIncentive).toBeDefined();
      expect(propensity.recommendedIncentive?.discountPercentage).toBe(25);
      expect(propensity.recommendedIncentive?.bonusDays).toBe(5);
    });
  });

  describe('Trial Extensions', () => {
    it('successfully extends active trial', () => {
      const trial = service.startTrial('user-ext', 'pro-plan', 50);
      const originalEndMs = trial.endDate.getTime();

      const extended = service.extendTrial(trial.id, 7, 'Special high engagement reward');
      expect(extended).toBeDefined();
      expect(extended?.status).toBe('extended');
      expect(extended?.extensionCount).toBe(1);
      expect(extended?.endDate.getTime()).toBe(originalEndMs + 7 * 86_400_000);
      expect(extended?.metadata?.lastExtensionReason).toBe('Special high engagement reward');
    });

    it('prevents extension beyond maximum allowed count', () => {
      const trial = service.startTrial('user-limit', 'pro-plan', 50, { maxExtensionsAllowed: 1 });

      expect(service.extendTrial(trial.id, 3)).toBeDefined();
      // Second extension should be rejected
      expect(service.extendTrial(trial.id, 3)).toBeUndefined();
    });
  });

  describe('Trial Conversion and Auto-Conversion Pipeline', () => {
    it('converts trial manually with early discount', () => {
      const trial = service.startTrial('user-conv', 'pro-plan', 100);
      const converted = service.convertTrial(trial.id, 'early_bird_click', 1500);

      expect(converted).toBeDefined();
      expect(converted?.status).toBe('converted');
      expect(converted?.convertedAt).toBeDefined();
      expect(converted?.conversionTrigger).toBe('early_bird_click');
      expect(converted?.conversionDiscountBps).toBe(1500);
    });

    it('cancels trial properly', () => {
      const trial = service.startTrial('user-cancel', 'pro-plan', 100);
      const cancelled = service.cancelTrial(trial.id, 'Competitor offer');

      expect(cancelled?.status).toBe('cancelled');
      expect(cancelled?.metadata?.cancellationReason).toBe('Competitor offer');
    });

    it('auto-converts expired trials when autoConvert is enabled', () => {
      const trial = service.startTrial('user-auto', 'pro-plan', 60, {
        durationDays: 7,
        gracePeriodDays: 2,
        autoConvertOnExpiry: true,
      });

      // Advance date past grace period (10 days later)
      const futureDate = new Date(Date.now() + 10 * 86_400_000);
      const result = service.processTrialExpirations(futureDate);

      expect(result.autoConverted.length).toBe(1);
      expect(result.autoConverted[0].id).toBe(trial.id);
      expect(result.autoConverted[0].status).toBe('converted');
      expect(result.autoConverted[0].conversionTrigger).toBe('auto_convert_expiry');
    });

    it('expires trials without autoConvert enabled', () => {
      const trial = service.startTrial('user-noauto', 'pro-plan', 60, {
        durationDays: 5,
        gracePeriodDays: 1,
        autoConvertOnExpiry: false,
      });

      const futureDate = new Date(Date.now() + 8 * 86_400_000);
      const result = service.processTrialExpirations(futureDate);

      expect(result.expired.length).toBe(1);
      expect(result.expired[0].id).toBe(trial.id);
      expect(result.expired[0].status).toBe('expired');
    });
  });

  describe('Reminders and Conversion Funnel Analytics', () => {
    it('schedules reminders upon trial creation', () => {
      const trial = service.startTrial('user-rem', 'pro-plan', 50);
      const pendingReminders = service.getPendingReminders(new Date(Date.now() + 20 * 86_400_000));

      expect(pendingReminders.length).toBeGreaterThanOrEqual(3);
      const d1Reminder = pendingReminders.find((r) => r.reminderType === 'D-1');
      expect(d1Reminder?.attachedIncentive).toBeDefined();

      const sent = service.markReminderSent(d1Reminder!.id);
      expect(sent).toBe(true);
    });

    it('calculates comprehensive conversion funnel and revenue metrics', () => {
      // Create 4 trials
      const t1 = service.startTrial('user-1', 'pro-plan', 100, { earlyConversionDiscountBps: 2000 });
      const t2 = service.startTrial('user-2', 'pro-plan', 100, { earlyConversionDiscountBps: 1000 });
      const t3 = service.startTrial('user-3', 'pro-plan', 100);
      const t4 = service.startTrial('user-4', 'pro-plan', 100);

      service.recordActivity(t1.id, { featureUsageCount: 3, loginCount: 2 });
      service.recordActivity(t2.id, { featureUsageCount: 1, loginCount: 1 });

      service.convertTrial(t1.id, 'early_bird');
      service.convertTrial(t2.id, 'dashboard_cta');
      service.cancelTrial(t3.id);

      const metrics = service.getFunnelMetrics('pro-plan');
      expect(metrics.totalStarted).toBe(4);
      expect(metrics.convertedCount).toBe(2);
      expect(metrics.cancelledCount).toBe(1);
      expect(metrics.conversionRatePercent).toBe(50);
      // t1 revenue: 100 * (1 - 0.2) = 80; t2 revenue: 100 * (1 - 0.1) = 90. Total = 170.
      expect(metrics.attributedRevenueUsd).toBe(170);
    });
  });
});
