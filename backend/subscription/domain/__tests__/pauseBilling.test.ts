/**
 * Unit tests for pause/resume billing adjustments (Issue #1116).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  buildPauseBillingAdjustment,
  calculatePauseCredit,
  calculateResumeCredit,
  daysBetween,
  daysFromNow,
  getPeriodDays,
  isResumeDue,
  validatePauseRequest,
  CREDIT_EXPIRY_DAYS,
  DEFAULT_PAUSE_LIMITS,
} from '../pauseBilling';
import { PauseStateStore } from '../pauseStateStore';

describe('pause billing math', () => {
  it('computes period days per billing cycle', () => {
    expect(getPeriodDays('monthly')).toBe(30);
    expect(getPeriodDays('yearly')).toBe(365);
    expect(getPeriodDays('weekly')).toBe(30);
  });

  it('credits the unused portion of the period', () => {
    const credit = calculatePauseCredit({ price: 30, periodDays: 30, pauseDays: 15 });
    expect(credit).toBe(15);
  });

  it('never credits more than the price', () => {
    const credit = calculatePauseCredit({ price: 10, periodDays: 30, pauseDays: 90 });
    expect(credit).toBe(10);
  });

  it('returns zero credit for free plans', () => {
    expect(calculatePauseCredit({ price: 0, periodDays: 30, pauseDays: 15 })).toBe(0);
  });

  it('splits credit on early resume', () => {
    const adjustment = calculateResumeCredit({
      creditAmount: 15,
      pauseDays: 15,
      daysElapsed: 5,
    });
    expect(adjustment.creditConsumed).toBe(5);
    expect(adjustment.creditRefund).toBe(10);
    expect(adjustment.creditRemaining).toBe(10);
  });

  it('caps elapsed days at the pause duration', () => {
    const adjustment = calculateResumeCredit({
      creditAmount: 15,
      pauseDays: 15,
      daysElapsed: 99,
    });
    expect(adjustment.creditRefund).toBe(0);
  });

  it('keeps the remaining balance above zero', () => {
    const adjustment = buildPauseBillingAdjustment({
      subscriptionId: 'sub_1',
      price: 9.99,
      currency: 'USD',
      periodDays: 30,
      pauseDays: 10,
    });
    expect(adjustment.creditAmount).toBe(3.33);
    expect(adjustment.remainingBalance).toBe(6.66);
    expect(adjustment.creditExpiryDays).toBe(CREDIT_EXPIRY_DAYS);
    expect(adjustment.currency).toBe('USD');
  });
});

describe('validatePauseRequest', () => {
  it('accepts a valid request', () => {
    expect(validatePauseRequest(14, false, 0)).toEqual({ valid: true });
  });

  it('rejects durations below the minimum', () => {
    const result = validatePauseRequest(3, false, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(String(DEFAULT_PAUSE_LIMITS.minDays));
  });

  it('rejects durations above the maximum', () => {
    expect(validatePauseRequest(400, false, 0).valid).toBe(false);
  });

  it('rejects when already paused', () => {
    const result = validatePauseRequest(14, true, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('already paused');
  });

  it('rejects when the yearly quota is exhausted', () => {
    const result = validatePauseRequest(14, false, DEFAULT_PAUSE_LIMITS.maxPausesPerYear);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('per year');
  });
});

describe('date helpers', () => {
  it('computes whole days between instants', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-11T00:00:00.000Z');
    expect(daysBetween(from, to)).toBe(10);
    expect(daysBetween(to, from)).toBe(0);
  });

  it('detects a due resume', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    expect(isResumeDue('2026-01-09T00:00:00.000Z', now)).toBe(true);
    expect(isResumeDue('2026-01-20T00:00:00.000Z', now)).toBe(false);
  });

  it('projects a date into the future', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(daysFromNow(7, from)).toBe('2026-01-08T00:00:00.000Z');
  });
});

describe('PauseStateStore', () => {
  let store: PauseStateStore;

  const seed = {
    subscriptionId: 'sub_1',
    price: 30,
    currency: 'USD',
    periodDays: 30,
    pauseDays: 14,
    reason: 'vacation' as const,
  };

  beforeEach(() => {
    store = new PauseStateStore();
  });

  it('pauses and issues a credit adjustment', () => {
    const session = store.pause(seed);
    expect(session.status).toBe('paused');
    expect(session.adjustment.creditAmount).toBe(14);
    expect(session.creditRemaining).toBe(14);
    expect(session.adjustment.remainingBalance).toBe(16);
    expect(store.getActive('sub_1')).toBeDefined();
  });

  it('rejects a second pause while one is active', () => {
    store.pause(seed);
    expect(() => store.pause(seed)).toThrow('already paused');
  });

  it('refunds unconsumed credit on early resume', () => {
    const pausedAt = new Date('2026-01-01T00:00:00.000Z');
    store.pause({ ...seed }, pausedAt);
    const resumed = store.resume('sub_1', true, new Date('2026-01-08T00:00:00.000Z'));

    expect(resumed.status).toBe('resumed');
    expect(resumed.creditRemaining).toBe(7);
    expect(store.getActive('sub_1')).toBeUndefined();
  });

  it('keeps no credit on a scheduled resume', () => {
    const pausedAt = new Date('2026-01-01T00:00:00.000Z');
    store.pause({ ...seed }, pausedAt);
    const resumed = store.resume('sub_1', false, new Date('2026-01-20T00:00:00.000Z'));
    expect(resumed.creditRemaining).toBe(0);
  });

  it('throws when resuming a subscription that is not paused', () => {
    expect(() => store.resume('missing', false)).toThrow('not paused');
  });

  it('auto resumes sessions whose schedule elapsed', () => {
    store.pause(seed, new Date('2026-01-01T00:00:00.000Z'));
    const due = store.autoResumeDue(new Date('2026-02-01T00:00:00.000Z'));
    expect(due).toHaveLength(1);
    expect(store.getActive('sub_1')).toBeUndefined();
  });

  it('counts completed pauses per calendar year', () => {
    const pausedAt = new Date('2026-01-01T00:00:00.000Z');
    store.pause(seed, pausedAt);
    store.resume('sub_1', false, new Date('2026-01-20T00:00:00.000Z'));
    expect(store.pausesThisYear('sub_1', new Date('2026-06-01T00:00:00.000Z'))).toBe(1);
    expect(store.pausesThisYear('sub_1', new Date('2027-06-01T00:00:00.000Z'))).toBe(0);
  });

  it('lists history for a subscription', () => {
    store.pause(seed);
    store.resume('sub_1', false);
    expect(store.list('sub_1')).toHaveLength(1);
    expect(store.list()).toHaveLength(1);
    store.reset();
    expect(store.list()).toHaveLength(0);
  });
});
