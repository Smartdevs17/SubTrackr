/**
 * Revenue recognition export (Issue #1743).
 *
 * Flattens per-subscription revenue schedules into period rows so finance can
 * export recognised revenue for any window in CSV or JSON.
 *
 * Two bases are supported:
 *  - accrual (default): revenue is recognised as the service period is
 *    consumed — the ASC 606 / IFRS 15 treatment. A period partially elapsed
 *    at `asOf` recognises its pro-rated amount; the rest stays deferred.
 *  - cash: the full charge is recognised in the period that contains the
 *    charge date, because the cash was received up front.
 */

import type { RevenueSchedule } from '../store/accountingStore';

export type RecognitionBasis = 'accrual' | 'cash';
export type RecognitionExportFormat = 'csv' | 'json';
export type RecognitionStatus = 'recognised' | 'partial' | 'deferred';

export interface RecognitionExportRow {
  subscriptionId: string;
  /** ISO-8601 date (YYYY-MM-DD) of the period start. */
  periodStart: string;
  /** ISO-8601 date (YYYY-MM-DD) of the period end. */
  periodEnd: string;
  basis: RecognitionBasis;
  recognisedAmount: number;
  deferredAmount: number;
  status: RecognitionStatus;
}

export interface RecognitionExportOptions {
  format: RecognitionExportFormat;
  /** Inclusive window start (Unix ms). Omit for no lower bound. */
  from?: number;
  /** Inclusive window end (Unix ms). Omit for no upper bound. */
  to?: number;
  /** Reporting basis. Defaults to 'accrual'. */
  basis?: RecognitionBasis;
  /** Point in time used to split partially-elapsed periods. Defaults to now. */
  asOf?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function statusFor(recognised: number, total: number): RecognitionStatus {
  if (recognised <= 0) return 'deferred';
  if (recognised >= total) return 'recognised';
  return 'partial';
}

/**
 * Build one export row per schedule period, filtered to the requested window.
 * Rows are sorted by period start then subscription id for stable output.
 */
export function buildRecognitionRows(
  schedules: RevenueSchedule[],
  options: Omit<RecognitionExportOptions, 'format'> = {}
): RecognitionExportRow[] {
  const basis: RecognitionBasis = options.basis ?? 'accrual';
  const asOf = options.asOf ?? Date.now();
  const rows: RecognitionExportRow[] = [];

  for (const schedule of schedules) {
    if (basis === 'cash') {
      const first = schedule.entries[0];
      if (!first) continue;
      if (!withinWindow(first.periodStart, options)) continue;
      // Cash basis: the whole charge lands in the period containing chargeDate.
      const recognised = asOf >= schedule.chargeDate ? schedule.totalAmount : 0;
      rows.push({
        subscriptionId: schedule.subscriptionId,
        periodStart: toIsoDate(first.periodStart),
        periodEnd: toIsoDate(first.periodEnd),
        basis,
        recognisedAmount: round2(recognised),
        deferredAmount: round2(schedule.totalAmount - recognised),
        status: statusFor(recognised, schedule.totalAmount),
      });
      continue;
    }

    for (const entry of schedule.entries) {
      if (!withinWindow(entry.periodStart, options)) continue;

      let recognised: number;
      if (asOf >= entry.periodEnd) {
        recognised = entry.recognisedAmount;
      } else if (asOf <= entry.periodStart) {
        recognised = 0;
      } else {
        const elapsed = asOf - entry.periodStart;
        const duration = Math.max(entry.periodEnd - entry.periodStart, 1);
        recognised = (entry.recognisedAmount * elapsed) / duration;
      }

      rows.push({
        subscriptionId: schedule.subscriptionId,
        periodStart: toIsoDate(entry.periodStart),
        periodEnd: toIsoDate(entry.periodEnd),
        basis,
        recognisedAmount: round2(recognised),
        deferredAmount: round2(entry.recognisedAmount - recognised),
        status: statusFor(recognised, entry.recognisedAmount),
      });
    }
  }

  rows.sort((a, b) =>
    a.periodStart === b.periodStart
      ? a.subscriptionId.localeCompare(b.subscriptionId)
      : a.periodStart.localeCompare(b.periodStart)
  );
  return rows;
}

function withinWindow(periodStart: number, options: { from?: number; to?: number }): boolean {
  if (options.from !== undefined && periodStart < options.from) return false;
  if (options.to !== undefined && periodStart > options.to) return false;
  return true;
}

function csvEscape(value: string | number): string {
  const text = String(value).normalize('NFC');
  return `"${text.replace(/"/g, '""')}"`;
}

const CSV_HEADER = [
  'SubscriptionId',
  'PeriodStart',
  'PeriodEnd',
  'Basis',
  'RecognisedAmount',
  'DeferredAmount',
  'Status',
];

export function recognitionRowsToCsv(rows: RecognitionExportRow[]): string {
  const lines = rows.map((r) =>
    [
      csvEscape(r.subscriptionId),
      csvEscape(r.periodStart),
      csvEscape(r.periodEnd),
      csvEscape(r.basis),
      csvEscape(r.recognisedAmount.toFixed(2)),
      csvEscape(r.deferredAmount.toFixed(2)),
      csvEscape(r.status),
    ].join(',')
  );
  return [CSV_HEADER.map(csvEscape).join(','), ...lines].join('\n');
}

/** Export recognition entries for a period as CSV or JSON. */
export function exportRecognitionEntries(
  schedules: RevenueSchedule[],
  options: RecognitionExportOptions
): string {
  const rows = buildRecognitionRows(schedules, options);
  if (options.format === 'json') {
    return JSON.stringify(
      {
        basis: options.basis ?? 'accrual',
        generatedAt: new Date(options.asOf ?? Date.now()).toISOString(),
        periodCount: rows.length,
        entries: rows,
      },
      null,
      2
    );
  }
  return recognitionRowsToCsv(rows);
}

/** Convenience: last `days` days ending at `asOf`, for quick "this period" exports. */
export function recentPeriodWindow(
  days: number,
  asOf: number = Date.now()
): { from: number; to: number } {
  return { from: asOf - days * MS_PER_DAY, to: asOf };
}
