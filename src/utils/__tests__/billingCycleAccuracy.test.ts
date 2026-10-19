import { BillingCycle, Subscription, SubscriptionCategory } from '../../types/subscription';
import { billingCycleToMonths, InvoiceLineItem, InvoiceStatus } from '../../types/invoice';
import { buildBillingPeriod, calculateInvoiceTax, calculateInvoiceTotals } from '../invoice';
import { getPeriodDays } from '../proration';
import {
  calculateSubscriptionStats,
  getMonthlySubscriptionSpend,
  getYearlySubscriptionSpend,
} from '../stats';

const makeSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: 'sub-1',
  name: 'Test subscription',
  category: SubscriptionCategory.SOFTWARE,
  price: 1200,
  currency: 'USD',
  billingCycle: BillingCycle.ANNUAL,
  nextBillingDate: new Date('2026-06-01T00:00:00Z'),
  isActive: true,
  isCryptoEnabled: false,
  createdAt: new Date('2025-06-01T00:00:00Z'),
  updatedAt: new Date('2025-06-01T00:00:00Z'),
  ...overrides,
});

const makeLineItem = (overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem => ({
  description: 'Pro plan',
  quantity: 1,
  unitPrice: 100,
  currency: 'USD',
  exchangeRate: 1_000_000,
  taxRateBps: 0,
  ...overrides,
});

/**
 * `BillingCycle.ANNUAL` is a first-class cycle in the domain enum, not a
 * synonym that should fall through to the monthly default. Every place that
 * normalises a cycle has to agree about it, otherwise an annual plan is billed,
 * prorated and reported against different periods.
 */
describe('annual billing cycle normalisation', () => {
  describe('spend reporting', () => {
    it('treats an annual price as twelve months, not one month', () => {
      const subscription = makeSubscription({ price: 1200 });

      expect(getMonthlySubscriptionSpend(subscription)).toBe(100);
      expect(getYearlySubscriptionSpend(subscription)).toBe(1200);
    });

    it('matches the yearly cycle for an equivalent price', () => {
      const annual = makeSubscription({ billingCycle: BillingCycle.ANNUAL, price: 1200 });
      const yearly = makeSubscription({ billingCycle: BillingCycle.YEARLY, price: 1200 });

      expect(getMonthlySubscriptionSpend(annual)).toBe(getMonthlySubscriptionSpend(yearly));
      expect(getYearlySubscriptionSpend(annual)).toBe(getYearlySubscriptionSpend(yearly));
    });

    it('keeps monthly spend times twelve equal to yearly spend', () => {
      for (const cycle of [BillingCycle.MONTHLY, BillingCycle.YEARLY, BillingCycle.ANNUAL]) {
        const subscription = makeSubscription({ billingCycle: cycle, price: 120 });
        expect(getMonthlySubscriptionSpend(subscription) * 12).toBeCloseTo(
          getYearlySubscriptionSpend(subscription),
          10
        );
      }
    });

    it('still applies the currency converter before normalising', () => {
      const subscription = makeSubscription({ price: 100, currency: 'EUR' });

      expect(getMonthlySubscriptionSpend(subscription, (amount) => amount * 3)).toBe(25);
      expect(getYearlySubscriptionSpend(subscription, (amount) => amount * 3)).toBe(300);
    });

    it('folds an annual subscription into the aggregate stats', () => {
      const stats = calculateSubscriptionStats([
        makeSubscription({ id: 'annual', price: 1200, billingCycle: BillingCycle.ANNUAL }),
        makeSubscription({ id: 'monthly', price: 10, billingCycle: BillingCycle.MONTHLY }),
      ]);

      // 1200/12 + 10 — the annual plan must contribute 100, not 1200.
      expect(stats.totalActive).toBe(2);
      expect(stats.totalMonthlySpend).toBe(110);
      expect(stats.totalYearlySpend).toBe(1320);
    });

    it('excludes inactive annual subscriptions', () => {
      const stats = calculateSubscriptionStats([
        makeSubscription({ isActive: false, billingCycle: BillingCycle.ANNUAL }),
      ]);

      expect(stats.totalActive).toBe(0);
      expect(stats.totalMonthlySpend).toBe(0);
      expect(stats.totalYearlySpend).toBe(0);
    });
  });

  describe('billingCycleToMonths', () => {
    it('reports an annual cycle as twelve months', () => {
      expect(billingCycleToMonths(BillingCycle.ANNUAL)).toBe(12);
      expect(billingCycleToMonths(BillingCycle.ANNUAL)).toBe(
        billingCycleToMonths(BillingCycle.YEARLY)
      );
    });

    it('leaves the other cycles unchanged', () => {
      expect(billingCycleToMonths(BillingCycle.MONTHLY)).toBe(1);
      expect(billingCycleToMonths(BillingCycle.CUSTOM)).toBe(1);
      expect(billingCycleToMonths(BillingCycle.WEEKLY)).toBeCloseTo(1 / 4.345, 10);
    });
  });

  describe('invoice billing period', () => {
    it('spans a full year for an annual cycle', () => {
      const period = buildBillingPeriod(makeSubscription());

      expect(period.end.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(period.start.toISOString()).toBe('2025-06-01T00:00:00.000Z');
    });

    it('matches the yearly cycle period', () => {
      const annual = buildBillingPeriod(makeSubscription({ billingCycle: BillingCycle.ANNUAL }));
      const yearly = buildBillingPeriod(makeSubscription({ billingCycle: BillingCycle.YEARLY }));

      expect(annual.start.getTime()).toBe(yearly.start.getTime());
      expect(annual.end.getTime()).toBe(yearly.end.getTime());
    });

    it('still spans one month for a monthly cycle', () => {
      const period = buildBillingPeriod(
        makeSubscription({
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date('2026-05-01T00:00:00Z'),
        })
      );

      expect(period.start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
      expect(period.end.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    });
  });

  describe('proration period length', () => {
    it('prorates an annual cycle over a year', () => {
      expect(getPeriodDays(BillingCycle.ANNUAL)).toBe(365);
      expect(getPeriodDays(BillingCycle.ANNUAL)).toBe(getPeriodDays(BillingCycle.YEARLY));
    });

    it('leaves the other cycles unchanged', () => {
      expect(getPeriodDays(BillingCycle.WEEKLY)).toBe(7);
      expect(getPeriodDays(BillingCycle.MONTHLY)).toBe(30);
      expect(getPeriodDays(BillingCycle.CUSTOM)).toBe(30);
    });
  });
});

describe('invoice money arithmetic', () => {
  describe('calculateInvoiceTax', () => {
    it('keeps a tax amount below one currency unit', () => {
      // 5 % of 3.00 is 0.15, which used to round away to nothing.
      expect(calculateInvoiceTax(3, 500)).toBe(0.15);
      expect(calculateInvoiceTax(0.5, 500)).toBe(0.03);
      expect(calculateInvoiceTax(19.99, 875)).toBe(1.75);
    });

    it('still rounds a whole-unit tax to the same value', () => {
      expect(calculateInvoiceTax(10000, 500)).toBe(500);
      expect(calculateInvoiceTax(100, 2000)).toBe(20);
    });

    it('returns zero for a non-positive or non-finite rate', () => {
      expect(calculateInvoiceTax(100, 0)).toBe(0);
      expect(calculateInvoiceTax(100, -500)).toBe(0);
      expect(calculateInvoiceTax(100, Number.NaN)).toBe(0);
      expect(calculateInvoiceTax(Number.NaN, 500)).toBe(0);
    });
  });

  describe('calculateInvoiceTotals', () => {
    it('sums line totals', () => {
      const totals = calculateInvoiceTotals(
        [makeLineItem({ lineTotal: 100 }), makeLineItem({ lineTotal: 50.5 })],
        0
      );

      expect(totals).toEqual({ subtotal: 150.5, tax: 0, total: 150.5 });
    });

    it('falls back to unit price times quantity when lineTotal is omitted', () => {
      const line = makeLineItem({ unitPrice: 12.5, quantity: 4 });
      const totals = calculateInvoiceTotals([line], 0);

      expect(totals.subtotal).toBe(50);
      expect(totals.total).toBe(50);
    });

    it('falls back to the amount alias used by the invoice form shape', () => {
      const line = makeLineItem({ amount: 42 });
      const totals = calculateInvoiceTotals([line], 0);

      expect(totals.subtotal).toBe(42);
    });

    it('prefers an explicit lineTotal over the fallbacks', () => {
      const line = makeLineItem({ lineTotal: 10, amount: 99, unitPrice: 1000, quantity: 5 });
      expect(calculateInvoiceTotals([line], 0).subtotal).toBe(10);
    });

    it('never produces NaN for a malformed line item', () => {
      const line = makeLineItem({ lineTotal: Number.NaN, amount: Number.NaN });
      const totals = calculateInvoiceTotals([line], 500);

      expect(Number.isNaN(totals.subtotal)).toBe(false);
      expect(Number.isNaN(totals.total)).toBe(false);
      // unitPrice * quantity is the last resort.
      expect(totals.subtotal).toBe(100);
    });

    it('treats a line with no usable amount at all as zero', () => {
      const line = makeLineItem({ unitPrice: Number.NaN });
      const totals = calculateInvoiceTotals([line], 500);

      expect(totals).toEqual({ subtotal: 0, tax: 0, total: 0 });
    });

    it('treats a line with no usable unit price as zero', () => {
      const line = makeLineItem({ lineTotal: Number.NaN, amount: undefined });
      const broken = { ...line, unitPrice: undefined } as unknown as InvoiceLineItem;
      const totals = calculateInvoiceTotals([broken], 500);

      expect(totals).toEqual({ subtotal: 0, tax: 0, total: 0 });
    });

    it('rounds the subtotal and total to minor units', () => {
      const totals = calculateInvoiceTotals(
        [makeLineItem({ lineTotal: 0.1 }), makeLineItem({ lineTotal: 0.2 })],
        0
      );

      expect(totals.subtotal).toBe(0.3);
      expect(totals.total).toBe(0.3);
    });

    it('applies tax on top of the subtotal', () => {
      const totals = calculateInvoiceTotals([makeLineItem({ lineTotal: 200 })], 750);

      expect(totals).toEqual({ subtotal: 200, tax: 15, total: 215 });
    });

    it('returns zeroed totals for an empty or non-array input', () => {
      expect(calculateInvoiceTotals([], 500)).toEqual({ subtotal: 0, tax: 0, total: 0 });
      expect(calculateInvoiceTotals(undefined as unknown as InvoiceLineItem[], 500)).toEqual({
        subtotal: 0,
        tax: 0,
        total: 0,
      });
    });
  });

  it('keeps the invoice status contract unchanged', () => {
    expect(InvoiceStatus.DRAFT).toBe('draft');
  });
});
