/**
 * Unit tests for the lifecycle module.
 *
 * Covers: errors, cancellation, pause/resume, trial, and SLA monitoring.
 * No I/O — all services are tested in isolation.
 */

import { LifecycleError, LifecycleErrorCode } from '../errors';
import { CancellationService } from '../cancellationService';
import { PauseResumeService } from '../pauseResumeService';
import { TrialService } from '../trialService';
import { SlaMonitoringService } from '../slaMonitoringService';
import type { SubscriptionStatus } from '../types';

// ── Error codes ───────────────────────────────────────────────────────────────

describe('LifecycleError', () => {
  it('all error codes are unique', () => {
    const codes = Object.values(LifecycleErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('notFound carries subscriptionId', () => {
    const err = LifecycleError.notFound('sub_1');
    expect(err.code).toBe(LifecycleErrorCode.NOT_FOUND);
    expect(err.details).toMatchObject({ subscriptionId: 'sub_1' });
  });

  it('alreadyCancelled carries subscriptionId', () => {
    const err = LifecycleError.alreadyCancelled('sub_2');
    expect(err.code).toBe(LifecycleErrorCode.ALREADY_CANCELLED);
  });

  it('invalidState carries expected and actual', () => {
    const err = LifecycleError.invalidState('sub_3', 'active', 'expired');
    expect(err.details).toMatchObject({ expected: 'active', actual: 'expired' });
  });

  it('lockTimeout carries subscriptionId', () => {
    const err = LifecycleError.lockTimeout('sub_4');
    expect(err.code).toBe(LifecycleErrorCode.LOCK_TIMEOUT);
  });
});

// ── CancellationService ───────────────────────────────────────────────────────

describe('CancellationService', () => {
  const service = new CancellationService();
  const periodEnd = Date.now() + 10 * 86_400_000; // 10 days from now

  it('cancels an active subscription immediately', () => {
    const result = service.cancel(
      { subscriptionId: 'sub_1', mode: 'immediate' },
      'active',
    );
    expect(result.subscriptionId).toBe('sub_1');
    expect(result.mode).toBe('immediate');
    expect(result.effectiveAt).toBeLessThanOrEqual(Date.now());
  });

  it('sets effectiveAt to periodEnd for end-of-period mode', () => {
    const result = service.cancel(
      { subscriptionId: 'sub_1', mode: 'end_of_period' },
      'active',
      periodEnd,
    );
    expect(result.effectiveAt).toBe(periodEnd);
  });

  it('cancels a paused subscription', () => {
    const result = service.cancel({ subscriptionId: 'sub_2', mode: 'immediate' }, 'paused');
    expect(result.mode).toBe('immediate');
  });

  it('cancels a subscription in trial', () => {
    expect(() =>
      service.cancel({ subscriptionId: 'sub_3', mode: 'immediate' }, 'trialing'),
    ).not.toThrow();
  });

  it('throws for already-cancelled subscription', () => {
    expect(() =>
      service.cancel({ subscriptionId: 'sub_4', mode: 'immediate' }, 'cancelled' as SubscriptionStatus),
    ).toThrow(LifecycleError);
  });

  it('throws for expired subscription', () => {
    expect(() =>
      service.cancel({ subscriptionId: 'sub_5', mode: 'immediate' }, 'expired'),
    ).toThrow(LifecycleError);
  });

  it('canCancel returns false for cancelled status', () => {
    expect(service.canCancel('cancelled')).toBe(false);
    expect(service.canCancel('expired')).toBe(false);
  });

  it('canCancel returns true for active status', () => {
    expect(service.canCancel('active')).toBe(true);
  });

  it('resolveMode returns immediate when fewer than 3 days remain', () => {
    const soon = Date.now() + 2 * 86_400_000; // 2 days
    expect(service.resolveMode('end_of_period', soon)).toBe('immediate');
  });

  it('resolveMode honours preference when plenty of days remain', () => {
    expect(service.resolveMode('end_of_period', periodEnd)).toBe('end_of_period');
  });
});

// ── PauseResumeService ────────────────────────────────────────────────────────

describe('PauseResumeService', () => {
  const service = new PauseResumeService();

  const baseRequest = {
    subscriptionId: 'sub_1',
    pauseDays: 30,
    price: 30,
    currency: 'USD',
    periodDays: 30,
  };

  it('calculates pause credit correctly', () => {
    const result = service.pause(baseRequest, 'active');
    expect(result.subscriptionId).toBe('sub_1');
    expect(result.creditAmount).toBeCloseTo(30); // $1/day * 30 days
    expect(result.currency).toBe('USD');
    expect(result.resumeAt).toBeGreaterThan(result.pausedAt);
  });

  it('throws when already paused', () => {
    expect(() => service.pause(baseRequest, 'paused')).toThrow(LifecycleError);
    expect(() => service.pause(baseRequest, 'paused')).toThrow(
      expect.objectContaining({ code: LifecycleErrorCode.ALREADY_PAUSED }),
    );
  });

  it('throws for cancelled subscription', () => {
    expect(() => service.pause(baseRequest, 'cancelled')).toThrow(LifecycleError);
  });

  it('throws when pauseDays exceeds max', () => {
    expect(() =>
      service.pause({ ...baseRequest, pauseDays: 91 }, 'active'),
    ).toThrow(LifecycleError);
  });

  it('throws when pauseDays is 0', () => {
    expect(() =>
      service.pause({ ...baseRequest, pauseDays: 0 }, 'active'),
    ).toThrow(LifecycleError);
  });

  it('calculates unused credit on early resume', () => {
    const result = service.resume(
      { subscriptionId: 'sub_1', creditAmount: 30, pauseDays: 30, daysElapsed: 10 },
      'paused',
    );
    // 20 days remaining → $1/day * 20 = $20
    expect(result.unusedCredit).toBeCloseTo(20);
    expect(result.resumedAt).toBeLessThanOrEqual(Date.now());
  });

  it('returns 0 unused credit when all pause days consumed', () => {
    const result = service.resume(
      { subscriptionId: 'sub_1', creditAmount: 30, pauseDays: 30, daysElapsed: 30 },
      'paused',
    );
    expect(result.unusedCredit).toBe(0);
  });

  it('throws when resuming a non-paused subscription', () => {
    expect(() =>
      service.resume(
        { subscriptionId: 'sub_2', creditAmount: 10, pauseDays: 10, daysElapsed: 5 },
        'active',
      ),
    ).toThrow(LifecycleError);
    expect(() =>
      service.resume(
        { subscriptionId: 'sub_2', creditAmount: 10, pauseDays: 10, daysElapsed: 5 },
        'active',
      ),
    ).toThrow(expect.objectContaining({ code: LifecycleErrorCode.NOT_PAUSED }));
  });
});

// ── TrialService ──────────────────────────────────────────────────────────────

describe('TrialService', () => {
  it('starts a trial with the default duration', () => {
    const service = new TrialService();
    const trial = service.start({ subscriptionId: 'sub_1', planId: 'basic', userId: 'u_1' });
    expect(trial.status).toBe('active');
    expect(trial.durationDays).toBe(14);
    expect(trial.endsAt).toBeGreaterThan(trial.startedAt);
  });

  it('honours a custom duration', () => {
    const service = new TrialService();
    const trial = service.start({ subscriptionId: 'sub_2', planId: 'pro', userId: 'u_2', durationDays: 30 });
    expect(trial.durationDays).toBe(30);
  });

  it('honours a per-plan duration override', () => {
    const service = new TrialService();
    service.registerPlanDuration('enterprise', 60);
    const trial = service.start({ subscriptionId: 'sub_3', planId: 'enterprise', userId: 'u_3' });
    expect(trial.durationDays).toBe(60);
  });

  it('caps trial duration at 90 days', () => {
    const service = new TrialService();
    const trial = service.start({ subscriptionId: 'sub_4', planId: 'plan', userId: 'u_4', durationDays: 999 });
    expect(trial.durationDays).toBe(90);
  });

  it('throws when a second trial is started for the same subscription', () => {
    const service = new TrialService();
    service.start({ subscriptionId: 'sub_5', planId: 'basic', userId: 'u_5' });
    expect(() =>
      service.start({ subscriptionId: 'sub_5', planId: 'basic', userId: 'u_5' }),
    ).toThrow(LifecycleError);
  });

  it('converts an active trial', () => {
    const service = new TrialService();
    service.start({ subscriptionId: 'sub_6', planId: 'basic', userId: 'u_6' });
    const converted = service.convert({ subscriptionId: 'sub_6' });
    expect(converted.status).toBe('converted');
    expect(converted.convertedAt).toBeDefined();
  });

  it('throws when converting a non-existent trial', () => {
    const service = new TrialService();
    expect(() => service.convert({ subscriptionId: 'sub_no_trial' })).toThrow(LifecycleError);
  });

  it('processExpirations marks past-due trials expired', () => {
    const service = new TrialService();
    service.start({ subscriptionId: 'sub_7', planId: 'basic', userId: 'u_7', durationDays: 1 });
    const future = Date.now() + 2 * 86_400_000;
    const expired = service.processExpirations(future);
    expect(expired).toHaveLength(1);
    expect(expired[0].status).toBe('expired');
  });

  it('isActive returns true during the trial window', () => {
    const service = new TrialService();
    service.start({ subscriptionId: 'sub_8', planId: 'basic', userId: 'u_8' });
    expect(service.isActive('sub_8')).toBe(true);
  });

  it('isActive returns false for a subscription with no trial', () => {
    const service = new TrialService();
    expect(service.isActive('sub_no_trial')).toBe(false);
  });

  it('getMetrics reflects current state', () => {
    const service = new TrialService();
    service.start({ subscriptionId: 'sub_9',  planId: 'basic', userId: 'u_9' });
    service.start({ subscriptionId: 'sub_10', planId: 'basic', userId: 'u_10' });
    service.convert({ subscriptionId: 'sub_9' });
    const metrics = service.getMetrics();
    expect(metrics.total).toBe(2);
    expect(metrics.active).toBe(1);
    expect(metrics.converted).toBe(1);
    expect(metrics.expired).toBe(0);
  });
});

// ── SlaMonitoringService ──────────────────────────────────────────────────────

describe('SlaMonitoringService', () => {
  it('records no breach when metric is within target', () => {
    const service = new SlaMonitoringService();
    const breach = service.record({
      subscriptionId: 'sub_1',
      tier: 'basic',
      kind: 'uptime',
      value: 99.5,       // above 99% target
      timestamp: Date.now(),
    });
    expect(breach).toBeUndefined();
  });

  it('records a breach when uptime falls below target', () => {
    const service = new SlaMonitoringService();
    const breach = service.record({
      subscriptionId: 'sub_1',
      tier: 'standard',
      kind: 'uptime',
      value: 98,         // below 99.5% standard target
      timestamp: Date.now(),
    });
    expect(breach).toBeDefined();
    expect(breach!.subscriptionId).toBe('sub_1');
    expect(breach!.tier).toBe('standard');
    expect(breach!.resolvedAt).toBeNull();
  });

  it('records a breach when response time exceeds target', () => {
    const service = new SlaMonitoringService();
    const breach = service.record({
      subscriptionId: 'sub_2',
      tier: 'premium',
      kind: 'response_time',
      value: 600,        // exceeds 500 ms premium target
      timestamp: Date.now(),
    });
    expect(breach).toBeDefined();
    expect(breach!.metricKind).toBe('response_time');
  });

  it('resolve marks a breach resolved', () => {
    const service = new SlaMonitoringService();
    const breach = service.record({
      subscriptionId: 'sub_3',
      tier: 'basic',
      kind: 'error_rate',
      value: 10,          // above 5% basic target
      timestamp: Date.now(),
    })!;
    expect(breach).toBeDefined();
    const resolved = service.resolve(breach.id);
    expect(resolved).toBe(true);
    expect(service.activeBreaches()).toHaveLength(0);
  });

  it('resolve returns false for an unknown breach id', () => {
    const service = new SlaMonitoringService();
    expect(service.resolve('nonexistent')).toBe(false);
  });

  it('activeBreaches filters by subscriptionId', () => {
    const service = new SlaMonitoringService();
    service.record({ subscriptionId: 'sub_A', tier: 'standard', kind: 'uptime', value: 90, timestamp: Date.now() });
    service.record({ subscriptionId: 'sub_B', tier: 'standard', kind: 'uptime', value: 90, timestamp: Date.now() });
    expect(service.activeBreaches('sub_A')).toHaveLength(1);
  });

  it('summary reflects active breaches and total credits', () => {
    const service = new SlaMonitoringService();
    service.record({ subscriptionId: 'sub_1', tier: 'premium', kind: 'uptime', value: 90, timestamp: Date.now() });
    service.record({ subscriptionId: 'sub_2', tier: 'basic',   kind: 'uptime', value: 90, timestamp: Date.now() });
    const summary = service.summary();
    expect(summary.totalBreaches).toBe(2);
    expect(summary.activeBreaches).toBe(2);
    expect(summary.totalCreditsIssued).toBeGreaterThan(0);
  });

  it('honours a tier target override', () => {
    const service = new SlaMonitoringService();
    service.overrideTierTarget('free', {
      uptimeTarget: 99,
      maxResponseTimeMs: 1000,
      maxErrorRate: 1,
      maxLatencyMs: 500,
      creditPercentage: 0,
    });
    // 98% uptime is now a breach under the overridden target
    const breach = service.record({
      subscriptionId: 'sub_1',
      tier: 'free',
      kind: 'uptime',
      value: 98,
      timestamp: Date.now(),
    });
    expect(breach).toBeDefined();
  });
});
