/**
 * RevenueByCurrencyReportService
 *
 * Groups subscription revenue by currency, producing per-currency totals
 * (monthly equivalent, annualised, subscription count, share) that can be
 * returned as JSON or exported as CSV.
 *
 * Design goals (issue #1757)
 * ──────────────────────────
 *  - Per-currency totals — each currency gets its own row with MRR, ARR,
 *    subscription count, average, and percentage share.
 *  - Exportable — `exportReport(report, format)` produces a CSV or JSON
 *    string suitable for an HTTP download endpoint.
 *  - Tested — pure functions, injectable clock, no external dependencies.
 *
 * The service accepts a `SubscriptionRevenueInput[]` which maps to both the
 * frontend `Subscription` type (price / billingCycle) and the backend
 * repository `Subscription` type (amount / billingCycle). This avoids coupling
 * to either layer.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/** Minimal subscription shape needed for revenue calculation. */
export interface SubscriptionRevenueInput {
  /** Subscription amount / price in the subscription's currency. */
  amount: number;
  /** ISO 4217 currency code, e.g. "USD", "EUR". */
  currency: string;
  /** Billing cycle — used to normalise to a monthly equivalent. */
  billingCycle: string;
  /** Only active subscriptions are included in revenue totals. */
  status?: 'active' | 'paused' | 'cancelled';
}

/** One row per currency in the report. */
export interface CurrencyRevenueEntry {
  currency: string;
  subscriptionCount: number;
  /** Monthly recurring revenue in this currency. */
  monthlyRevenue: number;
  /** Annualised revenue (monthly × 12) in this currency. */
  annualRevenue: number;
  /** Average monthly revenue per subscription. */
  averagePerSubscription: number;
  /** Share of total monthly revenue across all currencies (0–1). */
  percentage: number;
}

/** Aggregated totals across all currencies. */
export interface RevenueTotals {
  /** Sum of monthly revenue across all currencies (mixed currencies). */
  totalMonthlyRevenue: number;
  /** Sum of annual revenue across all currencies (mixed currencies). */
  totalAnnualRevenue: number;
  /** Total active subscription count across all currencies. */
  totalSubscriptions: number;
  /** Number of distinct currencies in the report. */
  currencyCount: number;
}

/** The full report returned by `generateReport()`. */
export interface RevenueByCurrencyReport {
  merchantId: string;
  generatedAt: string;
  currencies: CurrencyRevenueEntry[];
  totals: RevenueTotals;
}

export type ExportFormat = 'csv' | 'json';

// ─── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Normalise a billing cycle and amount to a monthly equivalent.
 *
 *   monthly   → amount as-is
 *   yearly / annual → amount / 12
 *   weekly    → amount × 52 / 12
 *   custom    → amount as-is (assume monthly)
 */
export function toMonthlyEquivalent(amount: number, billingCycle: string): number {
  const normalised = billingCycle.toLowerCase();
  switch (normalised) {
    case 'yearly':
    case 'annual':
      return amount / 12;
    case 'weekly':
      return (amount * 52) / 12;
    case 'monthly':
    case 'custom':
    default:
      return amount;
  }
}

/** Escape a value for CSV, handling commas, quotes, and non-ASCII safely. */
function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.normalize('NFC').replace(/"/g, '""')}"`;
}

/** Format a number to 2 decimal places for display. */
function fmt(n: number): string {
  return n.toFixed(2);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class RevenueByCurrencyReportService {
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Generate a revenue-by-currency report from a list of subscriptions.
   *
   * Only subscriptions with status "active" (or undefined status) are included.
   * The result is sorted by monthly revenue descending so the highest-grossing
   * currency appears first.
   */
  generateReport(
    subscriptions: SubscriptionRevenueInput[],
    merchantId: string
  ): RevenueByCurrencyReport {
    const active = subscriptions.filter(
      (s) => s.status === undefined || s.status === 'active'
    );

    // Group by currency and accumulate.
    const byCurrency = new Map<string, { count: number; monthly: number }>();

    for (const sub of active) {
      const currency = (sub.currency ?? 'USD').toUpperCase();
      const monthly = toMonthlyEquivalent(sub.amount, sub.billingCycle);
      const entry = byCurrency.get(currency) ?? { count: 0, monthly: 0 };
      entry.count += 1;
      entry.monthly += monthly;
      byCurrency.set(currency, entry);
    }

    const totalMonthly = [...byCurrency.values()].reduce((sum, e) => sum + e.monthly, 0);

    const currencies: CurrencyRevenueEntry[] = [...byCurrency.entries()]
      .map(([currency, data]) => ({
        currency,
        subscriptionCount: data.count,
        monthlyRevenue: data.monthly,
        annualRevenue: data.monthly * 12,
        averagePerSubscription: data.count > 0 ? data.monthly / data.count : 0,
        percentage: totalMonthly > 0 ? data.monthly / totalMonthly : 0,
      }))
      .sort((a, b) => b.monthlyRevenue - a.monthlyRevenue);

    return {
      merchantId,
      generatedAt: this.now().toISOString(),
      currencies,
      totals: {
        totalMonthlyRevenue: totalMonthly,
        totalAnnualRevenue: totalMonthly * 12,
        totalSubscriptions: active.length,
        currencyCount: currencies.length,
      },
    };
  }

  /**
   * Export a report as CSV or JSON string.
   *
   * CSV includes a header row and one data row per currency, followed by
   * a totals row.  JSON is the full report object pretty-printed.
   */
  exportReport(report: RevenueByCurrencyReport, format: ExportFormat): string {
    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    }

    // CSV format
    const headers = [
      'Currency',
      'SubscriptionCount',
      'MonthlyRevenue',
      'AnnualRevenue',
      'AveragePerSubscription',
      'Percentage',
    ];

    const rows: string[] = [headers.map(csvEscape).join(',')];

    for (const entry of report.currencies) {
      rows.push(
        [
          csvEscape(entry.currency),
          csvEscape(entry.subscriptionCount),
          csvEscape(fmt(entry.monthlyRevenue)),
          csvEscape(fmt(entry.annualRevenue)),
          csvEscape(fmt(entry.averagePerSubscription)),
          csvEscape(fmt(entry.percentage * 100) + '%'),
        ].join(',')
      );
    }

    // Totals row
    rows.push('');
    rows.push(
      [
        csvEscape('TOTAL'),
        csvEscape(report.totals.totalSubscriptions),
        csvEscape(fmt(report.totals.totalMonthlyRevenue)),
        csvEscape(fmt(report.totals.totalAnnualRevenue)),
        csvEscape(''),
        csvEscape(report.totals.currencyCount + ' currencies'),
      ].join(',')
    );

    return rows.join('\n');
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

export function createRevenueByCurrencyReportService(
  options?: { now?: () => Date }
): RevenueByCurrencyReportService {
  return new RevenueByCurrencyReportService(options);
}
