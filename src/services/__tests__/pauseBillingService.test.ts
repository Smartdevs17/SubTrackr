import { PauseBillingService } from '../pauseBillingService';
import { DEFAULT_PAUSE_LIMITS } from '../../types/pause';

describe('PauseBillingService', () => {
  let service: PauseBillingService;

  beforeEach(() => {
    service = new PauseBillingService();
  });

  describe('previewAdjustment / createPauseAdjustment (credit math)', () => {
    it('calculates credit as (pauseDays / periodDays) * price', () => {
      const preview = service.previewAdjustment(30, 30, 10, 'USD');
      expect(preview.creditAmount).toBe(10);
      expect(preview.periodDays).toBe(30);
      expect(preview.pauseDays).toBe(10);
      expect(preview.dailyRate).toBe(1);
    });

    it('rounds credit to 2 decimal places', () => {
      const preview = service.previewAdjustment(29.99, 30, 7, 'USD');
      expect(preview.creditAmount).toBe(7);
    });

    it('creates and stores a pause_credit adjustment', () => {
      const adjustment = service.createPauseAdjustment({
        subscriptionId: 'sub-1',
        price: 30,
        billingCycleDays: 30,
        pauseDays: 15,
        currency: 'USD',
        reason: 'vacation',
      });

      expect(adjustment.type).toBe('pause_credit');
      expect(adjustment.amount).toBe(15);
      expect(adjustment.currency).toBe('USD');
      expect(adjustment.pauseDays).toBe(15);
      expect(adjustment.appliedAt).toBeDefined();

      const active = service.getActivePause('sub-1');
      expect(active).toBeDefined();
      expect(active!.creditAmount).toBe(15);
      expect(active!.creditRemaining).toBe(15);
      expect(active!.status).toBe('active');
      expect(active!.reason).toBe('vacation');
    });
  });

  describe('createEarlyResumeAdjustment', () => {
    it('clawbacks unused portion of original credit', () => {
      const original = service.createPauseAdjustment({
        subscriptionId: 'sub-1',
        price: 30,
        billingCycleDays: 30,
        pauseDays: 10,
        currency: 'USD',
      });

      // Used 4 of 10 days → remaining 6/10 * 10 = 6
      const clawback = service.createEarlyResumeAdjustment(original, 4);

      expect(clawback.type).toBe('early_resume_clawback');
      expect(clawback.amount).toBe(6);
      expect(clawback.pauseDays).toBe(6);

      const record = service.getRecords('sub-1')[0];
      expect(record.status).toBe('resumed');
      expect(record.earlyResume).toBe(true);
      expect(record.creditRemaining).toBe(6);
      expect(record.pauseDays).toBe(4);
    });

    it('returns zero clawback when full pause was used', () => {
      const original = service.createPauseAdjustment({
        subscriptionId: 'sub-2',
        price: 60,
        billingCycleDays: 30,
        pauseDays: 15,
        currency: 'USD',
      });

      const clawback = service.createEarlyResumeAdjustment(original, 15);
      expect(clawback.amount).toBe(0);
    });
  });

  describe('createResumeRestart', () => {
    it('shifts next billing date by pause duration', () => {
      service.createPauseAdjustment({
        subscriptionId: 'sub-1',
        price: 30,
        billingCycleDays: 30,
        pauseDays: 14,
        currency: 'USD',
      });

      const currentNext = new Date('2026-08-01T00:00:00.000Z');
      const restart = service.createResumeRestart({
        subscriptionId: 'sub-1',
        pauseDays: 14,
        currentNextBillingDate: currentNext,
        currency: 'USD',
        billingCycleDays: 30,
      });

      expect(restart.type).toBe('resume_restart');
      expect(restart.nextBillingDate).toBeDefined();
      expect(restart.nextBillingDate!.toISOString()).toBe('2026-08-15T00:00:00.000Z');
      expect(restart.pauseDays).toBe(14);

      const record = service.getRecords('sub-1')[0];
      expect(record.status).toBe('resumed');
      expect(record.creditRemaining).toBe(0);
    });
  });

  describe('enforceLimits', () => {
    it('rejects pauses below min days', () => {
      const result = service.enforceLimits([], 3, DEFAULT_PAUSE_LIMITS, 'sub-1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Minimum pause/);
    });

    it('rejects pauses above max days', () => {
      const result = service.enforceLimits([], 120, DEFAULT_PAUSE_LIMITS, 'sub-1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Maximum pause/);
    });

    it('rejects when subscription already paused', () => {
      service.createPauseAdjustment({
        subscriptionId: 'sub-1',
        price: 30,
        billingCycleDays: 30,
        pauseDays: 14,
        currency: 'USD',
      });

      const result = service.enforceLimits(
        service.getRecords('sub-1'),
        14,
        DEFAULT_PAUSE_LIMITS,
        'sub-1'
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/already paused/);
    });

    it('rejects when max pauses per year reached', () => {
      service.setLimits({ maxPausesPerYear: 1 });
      service.createPauseAdjustment({
        subscriptionId: 'sub-1',
        price: 30,
        billingCycleDays: 30,
        pauseDays: 14,
        currency: 'USD',
      });
      // Resume so we are not blocked by active pause
      const credit = service.getAdjustments('sub-1')[0];
      service.createEarlyResumeAdjustment(credit, 7);

      const result = service.enforceLimits(
        service.getRecords('sub-1'),
        14,
        service.getLimits(),
        'sub-1'
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Maximum of 1 pauses/);
    });

    it('allows valid pause and warns near yearly cap', () => {
      service.setLimits({ maxPausesPerYear: 2 });
      service.createPauseAdjustment({
        subscriptionId: 'sub-1',
        price: 30,
        billingCycleDays: 30,
        pauseDays: 14,
        currency: 'USD',
        reason: 'vacation',
      });
      const credit = service.getAdjustments('sub-1')[0];
      service.createEarlyResumeAdjustment(credit, 7);

      const result = service.enforceLimits(
        service.getRecords('sub-1'),
        14,
        service.getLimits(),
        'sub-1'
      );
      expect(result.allowed).toBe(true);
      expect(result.warning).toBe(true);
    });
  });

  describe('scheduleNotifications', () => {
    it('schedules paused, resume_reminder, and resumed', () => {
      const resumeAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const notifications = service.scheduleNotifications('sub-1', 14, resumeAt);

      expect(notifications).toHaveLength(3);
      expect(notifications.map((n) => n.type)).toEqual(['paused', 'resume_reminder', 'resumed']);
      expect(notifications[0].sentAt).toBeDefined();
      expect(notifications[1].scheduledFor.getTime()).toBeLessThanOrEqual(resumeAt.getTime());
      expect(notifications[2].scheduledFor.getTime()).toBe(resumeAt.getTime());

      expect(service.getNotifications('sub-1')).toHaveLength(3);
    });
  });

  describe('getAnalytics', () => {
    it('aggregates pauses, credits, resume rates, and byReason', () => {
      service.createPauseAdjustment({
        subscriptionId: 'sub-1',
        price: 30,
        billingCycleDays: 30,
        pauseDays: 10,
        currency: 'USD',
        reason: 'vacation',
      });
      service.createPauseAdjustment({
        subscriptionId: 'sub-2',
        price: 60,
        billingCycleDays: 30,
        pauseDays: 15,
        currency: 'USD',
        reason: 'financial_hardship',
      });

      const credit1 = service.getAdjustments('sub-1').find((a) => a.type === 'pause_credit')!;
      service.createEarlyResumeAdjustment(credit1, 4);

      const report = service.getAnalytics();

      expect(report.totalPauses).toBe(2);
      expect(report.activePauses).toBe(1);
      expect(report.totalCreditsIssued).toBe(10 + 30); // 10 + (15/30)*60
      expect(report.resumeRate).toBe(50);
      expect(report.earlyResumeRate).toBe(100);
      expect(report.byReason.vacation).toBe(1);
      expect(report.byReason.financial_hardship).toBe(1);
      expect(report.totalCreditsRemaining).toBeGreaterThan(0);
    });
  });
});
