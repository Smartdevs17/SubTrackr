/**
 * Tests for accountingStore – revenue recognition calculations.
 *
 * Covers:
 *  - buildStraightLineSchedule: even split, remainder, single period
 *  - buildUsageBasedSchedule: single deferred entry
 *  - splitRecognisedDeferred: all deferred, all recognised, partial, multi-period
 *  - billingCycleToMs: all billing cycles
 *  - Store actions: setRecognitionRule, generateRevenueSchedule, recognizeRevenue,
 *    getDeferredRevenue, getRevenueSchedule, getRevenueAnalyticsByPeriod
 *  - Edge cases: cancellation mid-period, contract modification (rule update),
 *    multi-element arrangements, unknown subscription
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  buildStraightLineSchedule,
  buildUsageBasedSchedule,
  splitRecognisedDeferred,
  billingCycleToMs,
  useAccountingStore,
} from '../accountingStore';
import { BillingCycle } from '../../types/subscription';

// ── Mock AsyncStorage so persist middleware doesn't fail ─────────────────────
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetStore() {
  useAccountingStore.getState().reset();
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ═════════════════════════════════════════════════════════════════════════════
// Pure helpers
// ═════════════════════════════════════════════════════════════════════════════

describe('billingCycleToMs', () => {
  it('weekly → 7 days', () => {
    expect(billingCycleToMs(BillingCycle.WEEKLY)).toBe(7 * MS_PER_DAY);
  });

  it('monthly → ~30 days', () => {
    const ms = billingCycleToMs(BillingCycle.MONTHLY);
    // Allow ±1 day tolerance for rounding.
    expect(ms).toBeGreaterThanOrEqual(29 * MS_PER_DAY);
    expect(ms).toBeLessThanOrEqual(31 * MS_PER_DAY);
  });

  it('yearly → 365 days', () => {
    expect(billingCycleToMs(BillingCycle.YEARLY)).toBe(365 * MS_PER_DAY);
  });
});

// ── buildStraightLineSchedule ─────────────────────────────────────────────────

describe('buildStraightLineSchedule', () => {
  it('splits evenly when divisible', () => {
    const schedule = buildStraightLineSchedule('sub-1', 120, 0, 30 * MS_PER_DAY, 4);
    expect(schedule.entries).toHaveLength(4);
    schedule.entries.forEach((e) => expect(e.recognisedAmount).toBe(30));
  });

  it('puts remainder in last entry', () => {
    // 100 / 3 = 33.33 → 33 + 33 + 34
    const schedule = buildStraightLineSchedule('sub-1', 100, 0, 30 * MS_PER_DAY, 3);
    const amounts = schedule.entries.map((e) => e.recognisedAmount);
    expect(amounts[0]).toBe(33);
    expect(amounts[1]).toBe(33);
    expect(amounts[2]).toBeCloseTo(34, 1);
  });

  it('single period covers full interval', () => {
    const start = 1_000_000;
    const period = 30 * MS_PER_DAY;
    const schedule = buildStraightLineSchedule('sub-1', 500, start, period, 1);
    expect(schedule.entries).toHaveLength(1);
    expect(schedule.entries[0].periodStart).toBe(start);
    expect(schedule.entries[0].periodEnd).toBe(start + period);
    expect(schedule.entries[0].recognisedAmount).toBe(500);
  });

  it('entries are not yet recognised', () => {
    const schedule = buildStraightLineSchedule('sub-1', 200, 0, MS_PER_DAY, 2);
    schedule.entries.forEach((e) => expect(e.isRecognised).toBe(false));
  });

  it('throws when numPeriods is 0', () => {
    expect(() => buildStraightLineSchedule('sub-1', 100, 0, MS_PER_DAY, 0)).toThrow();
  });

  it('throws when periodMs is 0', () => {
    expect(() => buildStraightLineSchedule('sub-1', 100, 0, 0, 1)).toThrow();
  });
});

// ── buildUsageBasedSchedule ───────────────────────────────────────────────────

describe('buildUsageBasedSchedule', () => {
  it('creates a single deferred entry covering the full interval', () => {
    const schedule = buildUsageBasedSchedule('sub-2', 800, 500, 30 * MS_PER_DAY);
    expect(schedule.entries).toHaveLength(1);
    const entry = schedule.entries[0];
    expect(entry.recognisedAmount).toBe(800);
    expect(entry.periodStart).toBe(500);
    expect(entry.periodEnd).toBe(500 + 30 * MS_PER_DAY);
    expect(entry.isRecognised).toBe(false);
  });
});

// ── splitRecognisedDeferred ───────────────────────────────────────────────────

describe('splitRecognisedDeferred', () => {
  it('all deferred before period starts', () => {
    const schedule = buildStraightLineSchedule('s', 1000, 1000, 1000, 1);
    const { recognised, deferred } = splitRecognisedDeferred(schedule, 500);
    expect(recognised).toBe(0);
    expect(deferred).toBe(1000);
  });

  it('all recognised after period ends', () => {
    const schedule = buildStraightLineSchedule('s', 1000, 0, 1000, 1);
    const { recognised, deferred } = splitRecognisedDeferred(schedule, 2000);
    expect(recognised).toBe(1000);
    expect(deferred).toBe(0);
  });

  it('50% recognised at midpoint', () => {
    const schedule = buildStraightLineSchedule('s', 1000, 0, 1000, 1);
    const { recognised, deferred } = splitRecognisedDeferred(schedule, 500);
    expect(recognised).toBeCloseTo(500, 1);
    expect(deferred).toBeCloseTo(500, 1);
  });

  it('multi-period partial recognition', () => {
    // 1200 over 4 × 100ms periods. Query at t=250 → 2 full + 50% of 3rd.
    const schedule = buildStraightLineSchedule('s', 1200, 0, 100, 4);
    const { recognised, deferred } = splitRecognisedDeferred(schedule, 250);
    // 300 + 300 + 150 = 750 recognised; 150 + 300 = 450 deferred
    expect(recognised).toBeCloseTo(750, 1);
    expect(deferred).toBeCloseTo(450, 1);
  });

  it('cancellation mid-period: partial recognition', () => {
    // Cancelled at 30% through a 1000ms period.
    const schedule = buildStraightLineSchedule('s', 1000, 0, 1000, 1);
    const { recognised, deferred } = splitRecognisedDeferred(schedule, 300);
    expect(recognised).toBeCloseTo(300, 1);
    expect(deferred).toBeCloseTo(700, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Store actions
// ═════════════════════════════════════════════════════════════════════════════

describe('useAccountingStore', () => {
  beforeEach(() => resetStore());

  // ── setRecognitionRule ────────────────────────────────────────────────────

  it('setRecognitionRule persists a rule', () => {
    useAccountingStore.getState().setRecognitionRule({
      subscriptionId: 'sub-1',
      method: 'straight-line',
      recognitionPeriodMs: 7 * MS_PER_DAY,
    });
    expect(useAccountingStore.getState().rules['sub-1']).toBeDefined();
    expect(useAccountingStore.getState().rules['sub-1'].method).toBe('straight-line');
  });

  it('setRecognitionRule can be updated (contract modification)', () => {
    useAccountingStore.getState().setRecognitionRule({
      subscriptionId: 'sub-1',
      method: 'straight-line',
      recognitionPeriodMs: 7 * MS_PER_DAY,
    });
    useAccountingStore.getState().setRecognitionRule({
      subscriptionId: 'sub-1',
      method: 'usage-based',
      recognitionPeriodMs: 7 * MS_PER_DAY,
    });
    expect(useAccountingStore.getState().rules['sub-1'].method).toBe('usage-based');
  });

  it('removeRecognitionRule deletes the rule', () => {
    useAccountingStore.getState().setRecognitionRule({
      subscriptionId: 'sub-1',
      method: 'straight-line',
      recognitionPeriodMs: MS_PER_DAY,
    });
    useAccountingStore.getState().removeRecognitionRule('sub-1');
    expect(useAccountingStore.getState().rules['sub-1']).toBeUndefined();
  });

  // ── generateRevenueSchedule ───────────────────────────────────────────────

  it('generateRevenueSchedule creates a schedule and defers revenue', () => {
    const schedule = useAccountingStore
      .getState()
      .generateRevenueSchedule('sub-1', 100, Date.now(), BillingCycle.MONTHLY);

    expect(schedule.totalAmount).toBe(100);
    expect(schedule.entries.length).toBeGreaterThan(0);
    // All revenue starts deferred.
    expect(useAccountingStore.getState().deferredRevenue['default']).toBe(100);
  });

  it('generateRevenueSchedule uses straight-line rule when set', () => {
    const periodMs = 7 * MS_PER_DAY;
    useAccountingStore.getState().setRecognitionRule({
      subscriptionId: 'sub-1',
      method: 'straight-line',
      recognitionPeriodMs: periodMs,
    });
    const schedule = useAccountingStore
      .getState()
      .generateRevenueSchedule('sub-1', 280, 0, BillingCycle.MONTHLY);
    // Monthly (~30 days) / 7-day period = ~4-5 entries.
    expect(schedule.entries.length).toBeGreaterThanOrEqual(4);
  });

  it('generateRevenueSchedule uses usage-based rule when set', () => {
    useAccountingStore.getState().setRecognitionRule({
      subscriptionId: 'sub-1',
      method: 'usage-based',
      recognitionPeriodMs: 30 * MS_PER_DAY,
    });
    const schedule = useAccountingStore
      .getState()
      .generateRevenueSchedule('sub-1', 500, 0, BillingCycle.MONTHLY);
    expect(schedule.entries).toHaveLength(1);
  });

  it('generateRevenueSchedule defaults to single straight-line period with no rule', () => {
    const schedule = useAccountingStore
      .getState()
      .generateRevenueSchedule('sub-1', 200, 0, BillingCycle.MONTHLY);
    expect(schedule.entries).toHaveLength(1);
    expect(schedule.entries[0].recognisedAmount).toBe(200);
  });

  // ── recognizeRevenue ──────────────────────────────────────────────────────

  it('recognizeRevenue returns zeros for unknown subscription', () => {
    const rec = useAccountingStore.getState().recognizeRevenue('unknown');
    expect(rec.recognisedRevenue).toBe(0);
    expect(rec.deferredRevenue).toBe(0);
  });

  it('recognizeRevenue returns all deferred immediately after charge', () => {
    const chargeDate = Date.now() - 1; // just in the past
    useAccountingStore
      .getState()
      .generateRevenueSchedule('sub-1', 1000, chargeDate, BillingCycle.MONTHLY);
    // Query at chargeDate + 1ms → almost nothing recognised yet.
    const rec = useAccountingStore.getState().recognizeRevenue('sub-1', chargeDate + 1);
    expect(rec.deferredRevenue).toBeGreaterThan(990);
  });

  it('recognizeRevenue returns all recognised after period ends', () => {
    const chargeDate = 0;
    const intervalMs = billingCycleToMs(BillingCycle.MONTHLY);
    useAccountingStore
      .getState()
      .generateRevenueSchedule('sub-1', 1000, chargeDate, BillingCycle.MONTHLY);
    // Query well after period ends.
    const rec = useAccountingStore
      .getState()
      .recognizeRevenue('sub-1', chargeDate + intervalMs + 1);
    expect(rec.recognisedRevenue).toBeCloseTo(1000, 1);
    expect(rec.deferredRevenue).toBeCloseTo(0, 1);
  });

  // ── getDeferredRevenue ────────────────────────────────────────────────────

  it('getDeferredRevenue returns 0 for unknown merchant', () => {
    expect(useAccountingStore.getState().getDeferredRevenue('merchant-x')).toBe(0);
  });

  it('getDeferredRevenue accumulates across multiple charges', () => {
    useAccountingStore
      .getState()
      .generateRevenueSchedule('sub-1', 100, 0, BillingCycle.MONTHLY, 'merchant-1');
    useAccountingStore
      .getState()
      .generateRevenueSchedule('sub-2', 200, 0, BillingCycle.MONTHLY, 'merchant-1');
    expect(useAccountingStore.getState().getDeferredRevenue('merchant-1')).toBe(300);
  });

  // ── getRevenueSchedule ────────────────────────────────────────────────────

  it('getRevenueSchedule returns undefined for unknown subscription', () => {
    expect(useAccountingStore.getState().getRevenueSchedule('ghost')).toBeUndefined();
  });

  it('getRevenueSchedule returns the persisted schedule', () => {
    useAccountingStore.getState().generateRevenueSchedule('sub-1', 500, 0, BillingCycle.MONTHLY);
    const schedule = useAccountingStore.getState().getRevenueSchedule('sub-1');
    expect(schedule).toBeDefined();
    expect(schedule!.totalAmount).toBe(500);
  });

  // ── getRevenueAnalyticsByPeriod ───────────────────────────────────────────

  it('getRevenueAnalyticsByPeriod returns empty buckets with no schedules', () => {
    const now = Date.now();
    const analytics = useAccountingStore
      .getState()
      .getRevenueAnalyticsByPeriod(7 * MS_PER_DAY, now - 28 * MS_PER_DAY, now);
    expect(analytics).toHaveLength(4);
    analytics.forEach((b) => {
      expect(b.recognisedAmount).toBe(0);
      expect(b.subscriptionCount).toBe(0);
    });
  });

  it('getRevenueAnalyticsByPeriod accumulates amounts into correct buckets', () => {
    const from = 0;
    const bucketMs = 100;
    // Two subscriptions charged at t=0 (bucket 0).
    useAccountingStore.getState().generateRevenueSchedule('sub-1', 1000, 0, BillingCycle.MONTHLY);
    useAccountingStore.getState().generateRevenueSchedule('sub-2', 2000, 0, BillingCycle.MONTHLY);

    const analytics = useAccountingStore
      .getState()
      .getRevenueAnalyticsByPeriod(bucketMs, from, from + 200);

    // Both schedules have their single entry starting at t=0 → bucket 0.
    expect(analytics[0].recognisedAmount).toBe(3000);
    expect(analytics[0].subscriptionCount).toBe(2);
  });

  it('getRevenueAnalyticsByPeriod throws on invalid periodMs', () => {
    expect(() => useAccountingStore.getState().getRevenueAnalyticsByPeriod(0, 0, 1000)).toThrow();
  });

  // ── Multi-element arrangement ─────────────────────────────────────────────

  it('multi-element: deferred balances accumulate per merchant', () => {
    useAccountingStore
      .getState()
      .generateRevenueSchedule('sub-1', 500, 0, BillingCycle.MONTHLY, 'merchant-A');
    useAccountingStore
      .getState()
      .generateRevenueSchedule('sub-2', 300, 0, BillingCycle.MONTHLY, 'merchant-A');
    useAccountingStore
      .getState()
      .generateRevenueSchedule('sub-3', 200, 0, BillingCycle.MONTHLY, 'merchant-B');

    expect(useAccountingStore.getState().getDeferredRevenue('merchant-A')).toBe(800);
    expect(useAccountingStore.getState().getDeferredRevenue('merchant-B')).toBe(200);
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  it('reset clears all state', () => {
    useAccountingStore.getState().setRecognitionRule({
      subscriptionId: 'sub-1',
      method: 'straight-line',
      recognitionPeriodMs: MS_PER_DAY,
    });
    useAccountingStore.getState().generateRevenueSchedule('sub-1', 100, 0, BillingCycle.MONTHLY);

    useAccountingStore.getState().reset();

    expect(Object.keys(useAccountingStore.getState().rules)).toHaveLength(0);
    expect(Object.keys(useAccountingStore.getState().schedules)).toHaveLength(0);
    expect(useAccountingStore.getState().getDeferredRevenue()).toBe(0);
  });
});
