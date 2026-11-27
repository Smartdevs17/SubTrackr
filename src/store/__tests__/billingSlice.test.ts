/**
 * Tests for src/store/slices/billingSlice.ts (issue #2045).
 *
 * Run with:
 *   npx jest --config jest.backend.config.js \
 *     --testMatch '**\/src\/store\/__tests__\/billingSlice.test.ts'
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { useAppStore } from '../slices';
import {
  calculateNextBillingDate,
  calculateProRataAmount,
  type CalendarBilling,
} from '../slices/billingSlice';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

const reset = () =>
  useAppStore.setState({
    billingSchedules: {},
    billingInvoices: {},
    billingIsLoading: false,
    billingError: null,
  });

const periodStart = new Date('2026-05-01T00:00:00Z');
const periodEnd = new Date('2026-05-31T23:59:59Z');
const billingDate = new Date('2026-05-01T00:00:00Z');

const googleMonthly: CalendarBilling = {
  provider: 'google',
  anchorDay: 1,
  billingCycleMonths: 1,
  adjustmentPolicy: 'skip',
};

// ─── pure helpers ────────────────────────────────────────────────────────────

describe('calculateNextBillingDate (pure)', () => {
  it('advances exactly one month for a monthly config', () => {
    const from = new Date('2026-05-10T00:00:00Z');
    const next = calculateNextBillingDate(googleMonthly, from);
    expect(next.getMonth()).toBe(5); // June (0-indexed)
    expect(next.getDate()).toBe(1);
  });

  it('advances three months for a quarterly config', () => {
    const quarterly: CalendarBilling = { ...googleMonthly, billingCycleMonths: 3 };
    const from = new Date('2026-01-01T00:00:00Z');
    const next = calculateNextBillingDate(quarterly, from);
    expect(next.getMonth()).toBe(3); // April
  });

  it('applies last_day policy when anchor exceeds month length', () => {
    const config: CalendarBilling = {
      ...googleMonthly,
      anchorDay: 31,
      adjustmentPolicy: 'last_day',
    };
    const from = new Date('2026-01-01T00:00:00Z');
    const next = calculateNextBillingDate(config, from);
    // Feb has 28 days in 2026
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(28);
  });

  it('applies next_month policy by rolling into the following month', () => {
    const config: CalendarBilling = {
      ...googleMonthly,
      anchorDay: 31,
      adjustmentPolicy: 'next_month',
    };
    const from = new Date('2026-01-01T00:00:00Z');
    const next = calculateNextBillingDate(config, from);
    // Should roll into March 1
    expect(next.getMonth()).toBe(2);
    expect(next.getDate()).toBe(1);
  });
});

describe('calculateProRataAmount (pure)', () => {
  it('returns full amount when joining at period start', () => {
    expect(calculateProRataAmount(30, periodStart, periodEnd, periodStart)).toBeCloseTo(30, 0);
  });

  it('returns roughly half when joining at mid-period', () => {
    const midPeriod = new Date('2026-05-16T00:00:00Z');
    const result = calculateProRataAmount(30, periodStart, periodEnd, midPeriod);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(30);
  });

  it('returns full amount when joinDate is before periodStart', () => {
    const before = new Date('2026-04-01T00:00:00Z');
    expect(calculateProRataAmount(30, periodStart, periodEnd, before)).toBe(30);
  });
});

// ─── slice composition ────────────────────────────────────────────────────────

describe('billingSlice — composition', () => {
  beforeEach(reset);

  it('is composed into useAppStore with correct initial state', () => {
    const s = useAppStore.getState();
    expect(s.billingSchedules).toEqual({});
    expect(s.billingInvoices).toEqual({});
    expect(s.billingIsLoading).toBe(false);
    expect(s.billingError).toBeNull();
  });

  it('exposes every billing action on the combined store', () => {
    const s = useAppStore.getState();
    const fns = [
      'setMerchantCalendarBilling',
      'removeMerchantCalendarBilling',
      'getNextBillingDate',
      'advanceBillingSchedule',
      'generateBillingInvoice',
      'updateBillingInvoiceStatus',
      'getInvoicesForSubscription',
      'getInvoicesForMerchant',
      'calculateProRata',
      'clearBillingError',
    ];
    for (const fn of fns) {
      expect(typeof (s as Record<string, unknown>)[fn]).toBe('function');
    }
  });
});

// ─── setMerchantCalendarBilling ───────────────────────────────────────────────

describe('setMerchantCalendarBilling', () => {
  beforeEach(reset);

  it('creates a schedule with a nextBillingDate string', () => {
    useAppStore.getState().setMerchantCalendarBilling('m1', googleMonthly);
    const schedule = useAppStore.getState().billingSchedules['m1'];
    expect(schedule).toBeDefined();
    expect(schedule.merchantId).toBe('m1');
    expect(typeof schedule.nextBillingDate).toBe('string');
  });

  it('replaces the schedule when called again for the same merchant', () => {
    useAppStore.getState().setMerchantCalendarBilling('m1', googleMonthly);
    useAppStore.getState().setMerchantCalendarBilling('m1', { ...googleMonthly, anchorDay: 15 });
    expect(Object.keys(useAppStore.getState().billingSchedules)).toHaveLength(1);
  });

  it('stores independent schedules for different merchants', () => {
    useAppStore.getState().setMerchantCalendarBilling('ma', googleMonthly);
    useAppStore.getState().setMerchantCalendarBilling('mb', { ...googleMonthly, anchorDay: 15 });
    expect(Object.keys(useAppStore.getState().billingSchedules)).toHaveLength(2);
  });
});

// ─── removeMerchantCalendarBilling ───────────────────────────────────────────

describe('removeMerchantCalendarBilling', () => {
  beforeEach(reset);

  it('removes an existing schedule', () => {
    useAppStore.getState().setMerchantCalendarBilling('m1', googleMonthly);
    useAppStore.getState().removeMerchantCalendarBilling('m1');
    expect(useAppStore.getState().billingSchedules['m1']).toBeUndefined();
  });

  it('is a no-op for an unknown merchant', () => {
    useAppStore.getState().setMerchantCalendarBilling('m1', googleMonthly);
    useAppStore.getState().removeMerchantCalendarBilling('ghost');
    expect(Object.keys(useAppStore.getState().billingSchedules)).toHaveLength(1);
  });
});

// ─── getNextBillingDate ───────────────────────────────────────────────────────

describe('getNextBillingDate', () => {
  beforeEach(reset);

  it('returns a valid Date for a known merchant', () => {
    useAppStore.getState().setMerchantCalendarBilling('m1', googleMonthly);
    const d = useAppStore.getState().getNextBillingDate('m1');
    expect(d).toBeInstanceOf(Date);
    expect(isNaN(d!.getTime())).toBe(false);
  });

  it('returns null for an unknown merchant', () => {
    expect(useAppStore.getState().getNextBillingDate('ghost')).toBeNull();
  });
});

// ─── advanceBillingSchedule ───────────────────────────────────────────────────

describe('advanceBillingSchedule', () => {
  beforeEach(reset);

  it('moves nextBillingDate forward by one cycle', () => {
    useAppStore.getState().setMerchantCalendarBilling('m1', googleMonthly);
    const before = useAppStore.getState().billingSchedules['m1'].nextBillingDate;
    useAppStore.getState().advanceBillingSchedule('m1');
    const after = useAppStore.getState().billingSchedules['m1'].nextBillingDate;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('records the previous date as lastBillingDate', () => {
    useAppStore.getState().setMerchantCalendarBilling('m1', googleMonthly);
    const before = useAppStore.getState().billingSchedules['m1'].nextBillingDate;
    useAppStore.getState().advanceBillingSchedule('m1');
    expect(useAppStore.getState().billingSchedules['m1'].lastBillingDate).toBe(before);
  });

  it('is a no-op for an unknown merchant', () => {
    const snap = JSON.stringify(useAppStore.getState().billingSchedules);
    useAppStore.getState().advanceBillingSchedule('ghost');
    expect(JSON.stringify(useAppStore.getState().billingSchedules)).toBe(snap);
  });
});

// ─── generateBillingInvoice ───────────────────────────────────────────────────

describe('generateBillingInvoice', () => {
  beforeEach(reset);

  it('stores and returns an invoice with correct fields', () => {
    const inv = useAppStore.getState().generateBillingInvoice({
      subscriptionId: 'sub-1',
      merchantId: 'm1',
      periodStart,
      periodEnd,
      billingDate,
      amount: 29.99,
      currency: 'USD',
    });
    expect(inv.id).toBeTruthy();
    expect(inv.subscriptionId).toBe('sub-1');
    expect(inv.merchantId).toBe('m1');
    expect(inv.amount).toBe(29.99);
    expect(inv.status).toBe('draft');
    expect(inv.isProRated).toBe(false);
    expect(useAppStore.getState().billingInvoices[inv.id]).toEqual(inv);
  });

  it('applies pro-rata when joinDate is mid-period', () => {
    const joinDate = new Date('2026-05-15T00:00:00Z');
    const inv = useAppStore.getState().generateBillingInvoice({
      subscriptionId: 'sub-2',
      merchantId: 'm1',
      periodStart,
      periodEnd,
      billingDate,
      amount: 30,
      currency: 'USD',
      joinDate,
    });
    expect(inv.isProRated).toBe(true);
    expect(inv.amount).toBeGreaterThan(0);
    expect(inv.amount).toBeLessThan(30);
  });

  it('accumulates multiple invoices without id collision', () => {
    useAppStore.getState().generateBillingInvoice({
      subscriptionId: 'sub-1',
      merchantId: 'm1',
      periodStart,
      periodEnd,
      billingDate,
      amount: 10,
      currency: 'USD',
    });
    useAppStore.getState().generateBillingInvoice({
      subscriptionId: 'sub-2',
      merchantId: 'm1',
      periodStart,
      periodEnd,
      billingDate,
      amount: 20,
      currency: 'USD',
    });
    expect(Object.keys(useAppStore.getState().billingInvoices)).toHaveLength(2);
  });
});

// ─── updateBillingInvoiceStatus ───────────────────────────────────────────────

describe('updateBillingInvoiceStatus', () => {
  beforeEach(reset);

  it('updates status of a known invoice', () => {
    const inv = useAppStore.getState().generateBillingInvoice({
      subscriptionId: 'sub-1',
      merchantId: 'm1',
      periodStart,
      periodEnd,
      billingDate,
      amount: 10,
      currency: 'USD',
    });
    useAppStore.getState().updateBillingInvoiceStatus(inv.id, 'paid');
    expect(useAppStore.getState().billingInvoices[inv.id].status).toBe('paid');
  });

  it('is a no-op for an unknown invoice id', () => {
    const snap = JSON.stringify(useAppStore.getState().billingInvoices);
    useAppStore.getState().updateBillingInvoiceStatus('ghost', 'paid');
    expect(JSON.stringify(useAppStore.getState().billingInvoices)).toBe(snap);
  });

  it('supports all valid statuses', () => {
    const statuses = ['draft', 'pending', 'paid', 'void', 'refunded'] as const;
    for (const status of statuses) {
      const inv = useAppStore.getState().generateBillingInvoice({
        subscriptionId: `sub-${status}`,
        merchantId: 'm1',
        periodStart,
        periodEnd,
        billingDate,
        amount: 1,
        currency: 'USD',
      });
      useAppStore.getState().updateBillingInvoiceStatus(inv.id, status);
      expect(useAppStore.getState().billingInvoices[inv.id].status).toBe(status);
    }
  });
});

// ─── invoice queries ──────────────────────────────────────────────────────────

describe('invoice queries', () => {
  beforeEach(reset);

  it('getInvoicesForSubscription filters and sorts newest first', () => {
    useAppStore.getState().generateBillingInvoice({
      subscriptionId: 'sub-A',
      merchantId: 'm1',
      periodStart,
      periodEnd,
      billingDate,
      amount: 10,
      currency: 'USD',
    });
    useAppStore.getState().generateBillingInvoice({
      subscriptionId: 'sub-B',
      merchantId: 'm1',
      periodStart,
      periodEnd,
      billingDate,
      amount: 20,
      currency: 'USD',
    });
    useAppStore.getState().generateBillingInvoice({
      subscriptionId: 'sub-A',
      merchantId: 'm1',
      periodStart: new Date('2026-06-01'),
      periodEnd: new Date('2026-06-30'),
      billingDate: new Date('2026-06-01'),
      amount: 10,
      currency: 'USD',
    });

    const result = useAppStore.getState().getInvoicesForSubscription('sub-A');
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.subscriptionId === 'sub-A')).toBe(true);
    expect(new Date(result[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(result[1].createdAt).getTime()
    );
  });

  it('getInvoicesForSubscription returns [] for unknown subscription', () => {
    expect(useAppStore.getState().getInvoicesForSubscription('ghost')).toEqual([]);
  });

  it('getInvoicesForMerchant filters by merchantId', () => {
    useAppStore.getState().generateBillingInvoice({
      subscriptionId: 'sub-1',
      merchantId: 'mx',
      periodStart,
      periodEnd,
      billingDate,
      amount: 10,
      currency: 'USD',
    });
    useAppStore.getState().generateBillingInvoice({
      subscriptionId: 'sub-2',
      merchantId: 'my',
      periodStart,
      periodEnd,
      billingDate,
      amount: 20,
      currency: 'USD',
    });
    const result = useAppStore.getState().getInvoicesForMerchant('mx');
    expect(result).toHaveLength(1);
    expect(result[0].merchantId).toBe('mx');
  });
});

// ─── calculateProRata (via store) ─────────────────────────────────────────────

describe('calculateProRata (store action)', () => {
  it('delegates to calculateProRataAmount', () => {
    const joinDate = new Date('2026-05-15T00:00:00Z');
    const result = useAppStore.getState().calculateProRata(30, periodStart, periodEnd, joinDate);
    expect(result).toBe(calculateProRataAmount(30, periodStart, periodEnd, joinDate));
  });
});

// ─── clearBillingError ───────────────────────────────────────────────────────

describe('clearBillingError', () => {
  it('resets billingError to null', () => {
    useAppStore.setState({ billingError: 'oops' });
    useAppStore.getState().clearBillingError();
    expect(useAppStore.getState().billingError).toBeNull();
  });
});

// ─── slice isolation ─────────────────────────────────────────────────────────

describe('slice isolation', () => {
  beforeEach(reset);

  it('billing mutations leave auth state untouched', () => {
    useAppStore.setState({ token: 'tok-abc', isAuthenticated: true });
    useAppStore.getState().setMerchantCalendarBilling('m1', googleMonthly);
    expect(useAppStore.getState().token).toBe('tok-abc');
    expect(useAppStore.getState().isAuthenticated).toBe(true);
  });

  it('billing mutations leave calendar integrations untouched', () => {
    useAppStore.setState({ calendarIntegrations: [] });
    useAppStore.getState().generateBillingInvoice({
      subscriptionId: 'sub-1',
      merchantId: 'm1',
      periodStart,
      periodEnd,
      billingDate,
      amount: 10,
      currency: 'USD',
    });
    expect(useAppStore.getState().calendarIntegrations).toEqual([]);
  });
});
