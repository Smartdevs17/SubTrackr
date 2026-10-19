/**
 * Unit tests for revenueByCurrencyReport.ts
 *
 * Covers:
 *  - toMonthlyEquivalent() for every billing cycle
 *  - generateReport() — grouping, sorting, percentage, totals
 *  - generateReport() — filters paused/cancelled subscriptions
 *  - generateReport() — empty input
 *  - generateReport() — single currency
 *  - generateReport() — multiple currencies
 *  - generateReport() — normalises currency to uppercase
 *  - exportReport() CSV format — headers, data rows, totals row
 *  - exportReport() JSON format — round-trips to report object
 *  - exportReport() CSV — special characters escaped correctly
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  RevenueByCurrencyReportService,
  createRevenueByCurrencyReportService,
  toMonthlyEquivalent,
  type SubscriptionRevenueInput,
  type RevenueByCurrencyReport,
} from '../revenueByCurrencyReport';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date('2026-03-15T09:00:00.000Z');

function makeService(): RevenueByCurrencyReportService {
  return createRevenueByCurrencyReportService({ now: () => NOW });
}

function sub(overrides: Partial<SubscriptionRevenueInput> = {}): SubscriptionRevenueInput {
  return {
    amount: 10,
    currency: 'USD',
    billingCycle: 'monthly',
    status: 'active',
    ...overrides,
  };
}

// ─── toMonthlyEquivalent ──────────────────────────────────────────────────────

describe('toMonthlyEquivalent', () => {
  it('monthly — returns amount unchanged', () => {
    expect(toMonthlyEquivalent(100, 'monthly')).toBe(100);
  });

  it('yearly — divides by 12', () => {
    expect(toMonthlyEquivalent(1200, 'yearly')).toBeCloseTo(100);
  });

  it('annual — divides by 12', () => {
    expect(toMonthlyEquivalent(1200, 'annual')).toBeCloseTo(100);
  });

  it('weekly — multiplies by 52/12', () => {
    expect(toMonthlyEquivalent(120, 'weekly')).toBeCloseTo((120 * 52) / 12);
  });

  it('custom — returns amount unchanged', () => {
    expect(toMonthlyEquivalent(50, 'custom')).toBe(50);
  });

  it('unknown cycle — returns amount unchanged (safe default)', () => {
    expect(toMonthlyEquivalent(50, 'quarterly')).toBe(50);
  });

  it('is case-insensitive', () => {
    expect(toMonthlyEquivalent(1200, 'YEARLY')).toBeCloseTo(100);
    expect(toMonthlyEquivalent(1200, 'Yearly')).toBeCloseTo(100);
  });
});

// ─── generateReport — empty input ────────────────────────────────────────────

describe('RevenueByCurrencyReportService.generateReport — empty input', () => {
  it('returns zero totals for an empty subscription list', () => {
    const svc = makeService();
    const report = svc.generateReport([], 'merch_1');
    expect(report.currencies).toHaveLength(0);
    expect(report.totals.totalSubscriptions).toBe(0);
    expect(report.totals.totalMonthlyRevenue).toBe(0);
    expect(report.totals.totalAnnualRevenue).toBe(0);
    expect(report.totals.currencyCount).toBe(0);
  });

  it('includes merchantId and generatedAt in the report', () => {
    const svc = makeService();
    const report = svc.generateReport([], 'merch_42');
    expect(report.merchantId).toBe('merch_42');
    expect(report.generatedAt).toBe(NOW.toISOString());
  });
});

// ─── generateReport — filtering by status ────────────────────────────────────

describe('RevenueByCurrencyReportService.generateReport — status filtering', () => {
  it('excludes cancelled subscriptions', () => {
    const svc = makeService();
    const report = svc.generateReport(
      [sub({ amount: 100, status: 'active' }), sub({ amount: 50, status: 'cancelled' })],
      'merch_1'
    );
    expect(report.totals.totalSubscriptions).toBe(1);
    expect(report.totals.totalMonthlyRevenue).toBeCloseTo(100);
  });

  it('excludes paused subscriptions', () => {
    const svc = makeService();
    const report = svc.generateReport(
      [sub({ amount: 100, status: 'active' }), sub({ amount: 50, status: 'paused' })],
      'merch_1'
    );
    expect(report.totals.totalSubscriptions).toBe(1);
    expect(report.totals.totalMonthlyRevenue).toBeCloseTo(100);
  });

  it('includes subscriptions with no status field (treated as active)', () => {
    const svc = makeService();
    const report = svc.generateReport(
      [{ amount: 100, currency: 'USD', billingCycle: 'monthly' }],
      'merch_1'
    );
    expect(report.totals.totalSubscriptions).toBe(1);
  });
});

// ─── generateReport — single currency ────────────────────────────────────────

describe('RevenueByCurrencyReportService.generateReport — single currency', () => {
  it('computes monthlyRevenue, annualRevenue, and averagePerSubscription', () => {
    const svc = makeService();
    const subs = [
      sub({ amount: 100, currency: 'USD' }),
      sub({ amount: 200, currency: 'USD' }),
    ];
    const report = svc.generateReport(subs, 'merch_1');
    expect(report.currencies).toHaveLength(1);
    const entry = report.currencies[0]!;
    expect(entry.currency).toBe('USD');
    expect(entry.subscriptionCount).toBe(2);
    expect(entry.monthlyRevenue).toBeCloseTo(300);
    expect(entry.annualRevenue).toBeCloseTo(3600);
    expect(entry.averagePerSubscription).toBeCloseTo(150);
    expect(entry.percentage).toBeCloseTo(1);
  });
});

// ─── generateReport — multiple currencies ─────────────────────────────────────

describe('RevenueByCurrencyReportService.generateReport — multiple currencies', () => {
  it('groups by currency and calculates correct percentages', () => {
    const svc = makeService();
    const subs = [
      sub({ amount: 300, currency: 'USD' }),
      sub({ amount: 100, currency: 'EUR' }),
      sub({ amount: 100, currency: 'EUR' }),
    ];
    const report = svc.generateReport(subs, 'merch_1');
    expect(report.currencies).toHaveLength(2);
    const usd = report.currencies.find((c) => c.currency === 'USD')!;
    const eur = report.currencies.find((c) => c.currency === 'EUR')!;

    expect(usd.monthlyRevenue).toBeCloseTo(300);
    expect(eur.monthlyRevenue).toBeCloseTo(200);
    expect(usd.percentage).toBeCloseTo(300 / 500);
    expect(eur.percentage).toBeCloseTo(200 / 500);
    // Percentages should sum to ~1
    expect(usd.percentage + eur.percentage).toBeCloseTo(1);
  });

  it('sorts currencies by monthly revenue descending', () => {
    const svc = makeService();
    const subs = [
      sub({ amount: 50, currency: 'GBP' }),
      sub({ amount: 300, currency: 'USD' }),
      sub({ amount: 150, currency: 'EUR' }),
    ];
    const report = svc.generateReport(subs, 'merch_1');
    const codes = report.currencies.map((c) => c.currency);
    expect(codes).toEqual(['USD', 'EUR', 'GBP']);
  });

  it('accumulates totals across all currencies', () => {
    const svc = makeService();
    const subs = [
      sub({ amount: 300, currency: 'USD' }),
      sub({ amount: 200, currency: 'EUR' }),
    ];
    const report = svc.generateReport(subs, 'merch_1');
    expect(report.totals.totalMonthlyRevenue).toBeCloseTo(500);
    expect(report.totals.totalAnnualRevenue).toBeCloseTo(6000);
    expect(report.totals.totalSubscriptions).toBe(2);
    expect(report.totals.currencyCount).toBe(2);
  });
});

// ─── generateReport — currency normalisation ──────────────────────────────────

describe('RevenueByCurrencyReportService.generateReport — currency normalisation', () => {
  it('normalises currency codes to uppercase and groups them', () => {
    const svc = makeService();
    const subs = [
      sub({ amount: 100, currency: 'usd' }),
      sub({ amount: 200, currency: 'USD' }),
      sub({ amount: 50, currency: 'Usd' }),
    ];
    const report = svc.generateReport(subs, 'merch_1');
    expect(report.currencies).toHaveLength(1);
    expect(report.currencies[0]!.currency).toBe('USD');
    expect(report.currencies[0]!.monthlyRevenue).toBeCloseTo(350);
  });
});

// ─── generateReport — billing cycle normalisation ─────────────────────────────

describe('RevenueByCurrencyReportService.generateReport — billing cycle normalisation', () => {
  it('normalises annual subscriptions to monthly equivalent', () => {
    const svc = makeService();
    const report = svc.generateReport(
      [sub({ amount: 1200, currency: 'USD', billingCycle: 'yearly' })],
      'merch_1'
    );
    expect(report.currencies[0]!.monthlyRevenue).toBeCloseTo(100);
    expect(report.currencies[0]!.annualRevenue).toBeCloseTo(1200);
  });

  it('normalises weekly subscriptions to monthly equivalent', () => {
    const svc = makeService();
    const report = svc.generateReport(
      [sub({ amount: 12, currency: 'USD', billingCycle: 'weekly' })],
      'merch_1'
    );
    const expectedMonthly = (12 * 52) / 12;
    expect(report.currencies[0]!.monthlyRevenue).toBeCloseTo(expectedMonthly);
  });
});

// ─── exportReport — JSON ──────────────────────────────────────────────────────

describe('RevenueByCurrencyReportService.exportReport — JSON', () => {
  let report: RevenueByCurrencyReport;

  beforeEach(() => {
    const svc = makeService();
    report = svc.generateReport(
      [sub({ amount: 100, currency: 'USD' }), sub({ amount: 50, currency: 'EUR' })],
      'merch_1'
    );
  });

  it('produces valid JSON that round-trips to the report object', () => {
    const svc = makeService();
    const json = svc.exportReport(report, 'json');
    const parsed = JSON.parse(json) as RevenueByCurrencyReport;
    expect(parsed.merchantId).toBe(report.merchantId);
    expect(parsed.currencies).toHaveLength(report.currencies.length);
    expect(parsed.totals.totalMonthlyRevenue).toBeCloseTo(report.totals.totalMonthlyRevenue);
  });

  it('is pretty-printed (contains newlines)', () => {
    const svc = makeService();
    const json = svc.exportReport(report, 'json');
    expect(json).toContain('\n');
  });
});

// ─── exportReport — CSV ───────────────────────────────────────────────────────

describe('RevenueByCurrencyReportService.exportReport — CSV', () => {
  it('first line is a header row with expected columns', () => {
    const svc = makeService();
    const report = svc.generateReport([sub()], 'merch_1');
    const csv = svc.exportReport(report, 'csv');
    const firstLine = csv.split('\n')[0]!;
    expect(firstLine).toContain('Currency');
    expect(firstLine).toContain('SubscriptionCount');
    expect(firstLine).toContain('MonthlyRevenue');
    expect(firstLine).toContain('AnnualRevenue');
    expect(firstLine).toContain('Percentage');
  });

  it('has one data row per currency', () => {
    const svc = makeService();
    const report = svc.generateReport(
      [sub({ currency: 'USD' }), sub({ currency: 'EUR' }), sub({ currency: 'GBP' })],
      'merch_1'
    );
    const csv = svc.exportReport(report, 'csv');
    const lines = csv.split('\n').filter((l) => l.trim().length > 0);
    // header + 3 currencies + totals = 5 non-empty lines
    expect(lines).toHaveLength(5);
  });

  it('includes a totals row with TOTAL label', () => {
    const svc = makeService();
    const report = svc.generateReport([sub()], 'merch_1');
    const csv = svc.exportReport(report, 'csv');
    expect(csv).toContain('"TOTAL"');
  });

  it('data row contains the currency code', () => {
    const svc = makeService();
    const report = svc.generateReport([sub({ currency: 'XLM' })], 'merch_1');
    const csv = svc.exportReport(report, 'csv');
    expect(csv).toContain('"XLM"');
  });

  it('data row contains the correct subscription count', () => {
    const svc = makeService();
    const report = svc.generateReport(
      [sub({ currency: 'USD' }), sub({ currency: 'USD' }), sub({ currency: 'USD' })],
      'merch_1'
    );
    const csv = svc.exportReport(report, 'csv');
    expect(csv).toContain('"3"');
  });

  it('escapes double-quotes in values', () => {
    // Currency codes are always simple strings, but we can test via the
    // service directly by manufacturing a report with a currency containing a quote.
    const svc = makeService();
    // Build a minimal report manually to test the escape path.
    const report: RevenueByCurrencyReport = {
      merchantId: 'test',
      generatedAt: NOW.toISOString(),
      currencies: [
        {
          currency: 'US"D',
          subscriptionCount: 1,
          monthlyRevenue: 10,
          annualRevenue: 120,
          averagePerSubscription: 10,
          percentage: 1,
        },
      ],
      totals: {
        totalMonthlyRevenue: 10,
        totalAnnualRevenue: 120,
        totalSubscriptions: 1,
        currencyCount: 1,
      },
    };
    const csv = svc.exportReport(report, 'csv');
    // Double-quote in value should be escaped as ""
    expect(csv).toContain('US""D');
  });
});
