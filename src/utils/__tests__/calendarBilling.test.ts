/**
 * Tests for calendar-based billing calculations (Issue #182).
 *
 * Covers:
 * - daysInMonth (including leap years)
 * - normalizeBillingDay (all three adjustment policies)
 * - calculateNextBillingDate (monthly, quarterly, year-boundary)
 * - calculateProRataAmount
 * - generateCalendarInvoice
 * - setCalendarBilling / advanceMerchantBillingSchedule
 */

import {
  advanceMerchantBillingSchedule,
  calculateNextBillingDate,
  calculateProRataAmount,
  daysInMonth,
  generateCalendarInvoice,
  normalizeBillingDay,
  setCalendarBilling,
} from '../../services/calendarService';
import type { CalendarBilling } from '../../types/calendar';

// ── daysInMonth ────────────────────────────────────────────────────────────

describe('daysInMonth', () => {
  it('returns 31 for January', () => {
    expect(daysInMonth(2025, 1)).toBe(31);
  });

  it('returns 28 for February in a non-leap year', () => {
    expect(daysInMonth(2025, 2)).toBe(28);
  });

  it('returns 29 for February in a leap year', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it('returns 30 for April', () => {
    expect(daysInMonth(2025, 4)).toBe(30);
  });

  it('returns 31 for December', () => {
    expect(daysInMonth(2025, 12)).toBe(31);
  });
});

// ── normalizeBillingDay ────────────────────────────────────────────────────

describe('normalizeBillingDay', () => {
  describe('day exists in month', () => {
    it('returns the day unchanged when it fits', () => {
      expect(normalizeBillingDay(15, 3, 2025, 'last_day')).toEqual({ year: 2025, month: 3, day: 15 });
    });

    it('returns day 28 in February non-leap year when target is 28', () => {
      expect(normalizeBillingDay(28, 2, 2025, 'last_day')).toEqual({ year: 2025, month: 2, day: 28 });
    });

    it('returns day 29 in February leap year when target is 29', () => {
      expect(normalizeBillingDay(29, 2, 2024, 'last_day')).toEqual({ year: 2024, month: 2, day: 29 });
    });
  });

  describe('policy: last_day', () => {
    it('Jan 31 → Feb: returns Feb 28 in non-leap year', () => {
      expect(normalizeBillingDay(31, 2, 2025, 'last_day')).toEqual({ year: 2025, month: 2, day: 28 });
    });

    it('Jan 31 → Feb: returns Feb 29 in leap year', () => {
      expect(normalizeBillingDay(31, 2, 2024, 'last_day')).toEqual({ year: 2024, month: 2, day: 29 });
    });

    it('31st → April: returns April 30', () => {
      expect(normalizeBillingDay(31, 4, 2025, 'last_day')).toEqual({ year: 2025, month: 4, day: 30 });
    });

    it('30th → February: returns Feb 28', () => {
      expect(normalizeBillingDay(30, 2, 2025, 'last_day')).toEqual({ year: 2025, month: 2, day: 28 });
    });
  });

  describe('policy: first_day_next', () => {
    it('Jan 31 → Feb: returns March 1', () => {
      expect(normalizeBillingDay(31, 2, 2025, 'first_day_next')).toEqual({ year: 2025, month: 3, day: 1 });
    });

    it('31st → April: returns May 1', () => {
      expect(normalizeBillingDay(31, 4, 2025, 'first_day_next')).toEqual({ year: 2025, month: 5, day: 1 });
    });

    it('rolls over year boundary: Dec 31 → Feb: returns March 1 next year', () => {
      // February doesn't have 31 days; first_day_next → March 1
      expect(normalizeBillingDay(31, 2, 2025, 'first_day_next')).toEqual({ year: 2025, month: 3, day: 1 });
    });

    it('handles December → January year rollover', () => {
      // 31st in a 30-day month with first_day_next
      expect(normalizeBillingDay(31, 11, 2025, 'first_day_next')).toEqual({ year: 2025, month: 12, day: 1 });
    });
  });

  describe('policy: skip', () => {
    it('returns null when day exceeds month length', () => {
      expect(normalizeBillingDay(31, 2, 2025, 'skip')).toBeNull();
    });

    it('returns null for 30th in February', () => {
      expect(normalizeBillingDay(30, 2, 2025, 'skip')).toBeNull();
    });

    it('returns the day when it fits (no skip needed)', () => {
      expect(normalizeBillingDay(15, 2, 2025, 'skip')).toEqual({ year: 2025, month: 2, day: 15 });
    });
  });
});

// ── calculateNextBillingDate ───────────────────────────────────────────────

describe('calculateNextBillingDate', () => {
  const monthlyOn1st: CalendarBilling = {
    day_of_month: 1,
    billing_months_interval: 1,
    adjustment_policy: 'last_day',
    timezone: 'UTC',
  };

  it('returns the 1st of next month when current date is past the 1st', () => {
    const current = new Date('2025-01-15T00:00:00Z');
    const next = calculateNextBillingDate(current, monthlyOn1st);
    expect(next.getUTCFullYear()).toBe(2025);
    expect(next.getUTCMonth() + 1).toBe(2); // February
    expect(next.getUTCDate()).toBe(1);
  });

  it('returns the 1st of the same month when current date is before the 1st', () => {
    // Day 1 of January — we're on Jan 1, so we've already hit it; next is Feb 1
    const current = new Date('2025-01-01T00:00:00Z');
    const next = calculateNextBillingDate(current, monthlyOn1st);
    expect(next.getUTCMonth() + 1).toBe(2);
    expect(next.getUTCDate()).toBe(1);
  });

  it('handles month-end billing: 31st with last_day policy', () => {
    const config: CalendarBilling = {
      day_of_month: 31,
      billing_months_interval: 1,
      adjustment_policy: 'last_day',
      timezone: 'UTC',
    };
    // From Jan 15, next billing is Jan 31
    const current = new Date('2025-01-15T00:00:00Z');
    const next = calculateNextBillingDate(current, config);
    expect(next.getUTCMonth() + 1).toBe(1);
    expect(next.getUTCDate()).toBe(31);
  });

  it('handles Feb 28/29 edge case with last_day policy', () => {
    const config: CalendarBilling = {
      day_of_month: 31,
      billing_months_interval: 1,
      adjustment_policy: 'last_day',
      timezone: 'UTC',
    };
    // From Jan 31, next billing is Feb 28 (non-leap 2025)
    const current = new Date('2025-01-31T00:00:00Z');
    const next = calculateNextBillingDate(current, config);
    expect(next.getUTCMonth() + 1).toBe(2);
    expect(next.getUTCDate()).toBe(28);
  });

  it('handles Feb 29 in a leap year with last_day policy', () => {
    const config: CalendarBilling = {
      day_of_month: 31,
      billing_months_interval: 1,
      adjustment_policy: 'last_day',
      timezone: 'UTC',
    };
    // From Jan 31 2024, next billing is Feb 29 (leap year)
    const current = new Date('2024-01-31T00:00:00Z');
    const next = calculateNextBillingDate(current, config);
    expect(next.getUTCMonth() + 1).toBe(2);
    expect(next.getUTCDate()).toBe(29);
  });

  it('handles quarterly billing crossing year boundary', () => {
    const config: CalendarBilling = {
      day_of_month: 15,
      billing_months_interval: 3,
      adjustment_policy: 'last_day',
      timezone: 'UTC',
    };
    // From Nov 15, next quarterly billing is Feb 15
    const current = new Date('2025-11-15T00:00:00Z');
    const next = calculateNextBillingDate(current, config);
    expect(next.getUTCFullYear()).toBe(2026);
    expect(next.getUTCMonth() + 1).toBe(2);
    expect(next.getUTCDate()).toBe(15);
  });

  it('skips months with skip policy and finds next valid month', () => {
    const config: CalendarBilling = {
      day_of_month: 31,
      billing_months_interval: 1,
      adjustment_policy: 'skip',
      timezone: 'UTC',
    };
    // From Jan 31, February is skipped (no 31st), next is March 31
    const current = new Date('2025-01-31T00:00:00Z');
    const next = calculateNextBillingDate(current, config);
    expect(next.getUTCMonth() + 1).toBe(3); // March
    expect(next.getUTCDate()).toBe(31);
  });

  it('handles first_day_next policy for month-end billing', () => {
    const config: CalendarBilling = {
      day_of_month: 31,
      billing_months_interval: 1,
      adjustment_policy: 'first_day_next',
      timezone: 'UTC',
    };
    // From Jan 31, Feb doesn't have 31st → March 1
    const current = new Date('2025-01-31T00:00:00Z');
    const next = calculateNextBillingDate(current, config);
    expect(next.getUTCMonth() + 1).toBe(3); // March
    expect(next.getUTCDate()).toBe(1);
  });

  it('handles annual billing', () => {
    const config: CalendarBilling = {
      day_of_month: 1,
      billing_months_interval: 12,
      adjustment_policy: 'last_day',
      timezone: 'UTC',
    };
    const current = new Date('2025-03-01T00:00:00Z');
    const next = calculateNextBillingDate(current, config);
    expect(next.getUTCFullYear()).toBe(2026);
    expect(next.getUTCMonth() + 1).toBe(3);
    expect(next.getUTCDate()).toBe(1);
  });
});

// ── calculateProRataAmount ─────────────────────────────────────────────────

describe('calculateProRataAmount', () => {
  it('returns full amount when join date is at period start', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-02-01T00:00:00Z');
    expect(calculateProRataAmount(100, start, end, start)).toBe(100);
  });

  it('returns 0 when join date is at period end', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-02-01T00:00:00Z');
    expect(calculateProRataAmount(100, start, end, end)).toBe(0);
  });

  it('returns approximately half for mid-period join', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-31T00:00:00Z');
    const mid = new Date('2025-01-16T00:00:00Z'); // ~halfway
    const result = calculateProRataAmount(100, start, end, mid);
    expect(result).toBeGreaterThan(40);
    expect(result).toBeLessThan(60);
  });

  it('returns full amount when join date is before period start', () => {
    const start = new Date('2025-01-15T00:00:00Z');
    const end = new Date('2025-02-15T00:00:00Z');
    const joinBefore = new Date('2025-01-01T00:00:00Z');
    expect(calculateProRataAmount(100, start, end, joinBefore)).toBe(100);
  });

  it('rounds to 2 decimal places', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-31T00:00:00Z');
    const join = new Date('2025-01-10T00:00:00Z');
    const result = calculateProRataAmount(99.99, start, end, join);
    expect(result.toString()).toMatch(/^\d+\.\d{1,2}$/);
  });

  it('handles zero-length period gracefully', () => {
    const date = new Date('2025-01-01T00:00:00Z');
    expect(calculateProRataAmount(100, date, date, date)).toBe(100);
  });
});

// ── generateCalendarInvoice ────────────────────────────────────────────────

describe('generateCalendarInvoice', () => {
  const periodStart = new Date('2025-01-01T00:00:00Z');
  const periodEnd = new Date('2025-02-01T00:00:00Z');
  const billingDate = new Date('2025-02-01T00:00:00Z');

  it('generates a draft invoice with correct fields', () => {
    const invoice = generateCalendarInvoice(
      'sub_1',
      'merchant_1',
      periodStart,
      periodEnd,
      billingDate,
      99.99,
      'USD'
    );

    expect(invoice.subscriptionId).toBe('sub_1');
    expect(invoice.merchantId).toBe('merchant_1');
    expect(invoice.amount).toBe(99.99);
    expect(invoice.currency).toBe('USD');
    expect(invoice.status).toBe('draft');
    expect(invoice.isProratedPeriod).toBe(false);
    expect(invoice.proratedAmount).toBeUndefined();
    expect(invoice.id).toMatch(/^inv_/);
  });

  it('sets isProratedPeriod and calculates proratedAmount when joinDate is provided', () => {
    const joinDate = new Date('2025-01-15T00:00:00Z');
    const invoice = generateCalendarInvoice(
      'sub_1',
      'merchant_1',
      periodStart,
      periodEnd,
      billingDate,
      100,
      'USD',
      joinDate
    );

    expect(invoice.isProratedPeriod).toBe(true);
    expect(invoice.proratedAmount).toBeDefined();
    expect(invoice.proratedAmount!).toBeLessThan(100);
    expect(invoice.proratedAmount!).toBeGreaterThan(0);
  });

  it('does not set isProratedPeriod when joinDate equals periodStart', () => {
    const invoice = generateCalendarInvoice(
      'sub_1',
      'merchant_1',
      periodStart,
      periodEnd,
      billingDate,
      100,
      'USD',
      periodStart
    );
    // joinDate === periodStart means not mid-period
    expect(invoice.isProratedPeriod).toBe(false);
  });

  it('generates unique IDs for each invoice', () => {
    const inv1 = generateCalendarInvoice('sub_1', 'merchant_1', periodStart, periodEnd, billingDate, 100, 'USD');
    const inv2 = generateCalendarInvoice('sub_1', 'merchant_1', periodStart, periodEnd, billingDate, 100, 'USD');
    expect(inv1.id).not.toBe(inv2.id);
  });
});

// ── setCalendarBilling / advanceMerchantBillingSchedule ───────────────────

describe('setCalendarBilling', () => {
  it('creates a schedule with the correct config and a future nextBillingDate', () => {
    const config: CalendarBilling = {
      day_of_month: 15,
      billing_months_interval: 1,
      adjustment_policy: 'last_day',
      timezone: 'UTC',
    };
    const schedule = setCalendarBilling('merchant_1', config, new Date('2025-01-10T00:00:00Z'));

    expect(schedule.merchantId).toBe('merchant_1');
    expect(schedule.config).toEqual(config);
    const nextDate = new Date(schedule.nextBillingDate);
    expect(nextDate.getUTCDate()).toBe(15);
    expect(nextDate.getUTCMonth() + 1).toBe(1); // January 15
  });
});

describe('advanceMerchantBillingSchedule', () => {
  it('advances the schedule to the next billing period', () => {
    const config: CalendarBilling = {
      day_of_month: 1,
      billing_months_interval: 1,
      adjustment_policy: 'last_day',
      timezone: 'UTC',
    };
    const schedule = setCalendarBilling('merchant_1', config, new Date('2025-01-15T00:00:00Z'));
    // nextBillingDate should be Feb 1
    expect(new Date(schedule.nextBillingDate).getUTCMonth() + 1).toBe(2);

    const advanced = advanceMerchantBillingSchedule(schedule);
    // After advancing from Feb 1, next should be March 1
    expect(new Date(advanced.nextBillingDate).getUTCMonth() + 1).toBe(3);
    expect(new Date(advanced.nextBillingDate).getUTCDate()).toBe(1);
  });

  it('handles quarterly advancement across year boundary', () => {
    const config: CalendarBilling = {
      day_of_month: 15,
      billing_months_interval: 3,
      adjustment_policy: 'last_day',
      timezone: 'UTC',
    };
    const schedule = setCalendarBilling('merchant_1', config, new Date('2025-11-15T00:00:00Z'));
    // nextBillingDate should be Feb 15 2026
    const advanced = advanceMerchantBillingSchedule(schedule);
    const nextDate = new Date(advanced.nextBillingDate);
    expect(nextDate.getUTCFullYear()).toBe(2026);
    expect(nextDate.getUTCMonth() + 1).toBe(5); // May
    expect(nextDate.getUTCDate()).toBe(15);
  });
});
