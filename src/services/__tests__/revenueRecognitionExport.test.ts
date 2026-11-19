/**
 * Issue #1743 — revenue recognition export (CSV/JSON, accrual basis, periods).
 */

import {
  buildRecognitionRows,
  exportRecognitionEntries,
  recognitionRowsToCsv,
  recentPeriodWindow,
  type RecognitionExportRow,
} from '../revenueRecognitionExport';
import type { RevenueSchedule } from '../../store/accountingStore';

const DAY = 24 * 60 * 60 * 1000;
const CHARGE = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z

function makeSchedule(overrides: Partial<RevenueSchedule> = {}): RevenueSchedule {
  return {
    subscriptionId: 'sub-1',
    totalAmount: 90,
    chargeDate: CHARGE,
    entries: [
      {
        periodStart: CHARGE,
        periodEnd: CHARGE + 30 * DAY,
        recognisedAmount: 30,
        isRecognised: false,
      },
      {
        periodStart: CHARGE + 30 * DAY,
        periodEnd: CHARGE + 60 * DAY,
        recognisedAmount: 30,
        isRecognised: false,
      },
      {
        periodStart: CHARGE + 60 * DAY,
        periodEnd: CHARGE + 90 * DAY,
        recognisedAmount: 30,
        isRecognised: false,
      },
    ],
    ...overrides,
  };
}

describe('buildRecognitionRows — accrual basis', () => {
  it('recognises a fully elapsed period in full and defers the rest', () => {
    const rows = buildRecognitionRows([makeSchedule()], { asOf: CHARGE + 30 * DAY });
    expect(rows).toHaveLength(3);

    expect(rows[0].recognisedAmount).toBe(30);
    expect(rows[0].deferredAmount).toBe(0);
    expect(rows[0].status).toBe('recognised');

    expect(rows[1].recognisedAmount).toBe(0);
    expect(rows[1].deferredAmount).toBe(30);
    expect(rows[1].status).toBe('deferred');
  });

  it('pro-rates a period elapsed by one day', () => {
    const rows = buildRecognitionRows([makeSchedule()], { asOf: CHARGE + 31 * DAY });
    expect(rows[1].status).toBe('partial');
    expect(rows[1].recognisedAmount).toBe(1);
    expect(rows[1].deferredAmount).toBe(29);
  });

  it('pro-rates a partially elapsed period', () => {
    // Half-way through period two (15 of 30 days elapsed).
    const rows = buildRecognitionRows([makeSchedule()], { asOf: CHARGE + 45 * DAY });
    const partial = rows[1];
    expect(partial.status).toBe('partial');
    expect(partial.recognisedAmount).toBe(15);
    expect(partial.deferredAmount).toBe(15);
  });

  it('defaults to the accrual basis and stamps it on every row', () => {
    const rows = buildRecognitionRows([makeSchedule()], { asOf: CHARGE });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.basis).toBe('accrual');
  });

  it('filters rows to the requested period window', () => {
    const from = CHARGE + 30 * DAY;
    const to = CHARGE + 30 * DAY;
    const rows = buildRecognitionRows([makeSchedule()], { from, to, asOf: CHARGE + 91 * DAY });
    expect(rows).toHaveLength(1);
    expect(rows[0].periodStart).toBe('2026-01-31');
  });

  it('sorts rows by period start then subscription id', () => {
    const b = makeSchedule({
      subscriptionId: 'sub-b',
      chargeDate: CHARGE + 5 * DAY,
      entries: [
        {
          periodStart: CHARGE + 10 * DAY,
          periodEnd: CHARGE + 40 * DAY,
          recognisedAmount: 50,
          isRecognised: false,
        },
      ],
    });
    const a = makeSchedule({ subscriptionId: 'sub-a' });
    const rows = buildRecognitionRows([b, a], { asOf: CHARGE + 100 * DAY });
    const keys = rows.map((r) => `${r.subscriptionId}:${r.periodStart}`);
    expect(keys).toEqual([
      'sub-a:2026-01-01',
      'sub-b:2026-01-11',
      'sub-a:2026-01-31',
      'sub-a:2026-03-02',
    ]);
  });
});

describe('buildRecognitionRows — cash basis', () => {
  it('recognises the whole charge in the period containing the charge date', () => {
    const rows = buildRecognitionRows([makeSchedule()], { basis: 'cash', asOf: CHARGE + 10 * DAY });
    expect(rows).toHaveLength(1);
    expect(rows[0].recognisedAmount).toBe(90);
    expect(rows[0].deferredAmount).toBe(0);
    expect(rows[0].status).toBe('recognised');
    expect(rows[0].basis).toBe('cash');
    expect(rows[0].periodStart).toBe('2026-01-01');
  });

  it('recognises nothing before the charge date', () => {
    const rows = buildRecognitionRows([makeSchedule()], { basis: 'cash', asOf: CHARGE - DAY });
    expect(rows[0].recognisedAmount).toBe(0);
    expect(rows[0].status).toBe('deferred');
  });
});

describe('exportRecognitionEntries', () => {
  it('emits CSV with a header row and one line per period', () => {
    const csv = exportRecognitionEntries([makeSchedule()], {
      format: 'csv',
      asOf: CHARGE + 31 * DAY,
    });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('SubscriptionId');
    expect(lines[0]).toContain('Basis');
    expect(lines).toHaveLength(4); // header + 3 periods
    expect(lines[1]).toContain('"sub-1"');
    expect(lines[1]).toContain('"accrual"');
  });

  it('emits JSON carrying the basis, timestamp and entries', () => {
    const json = exportRecognitionEntries([makeSchedule()], {
      format: 'json',
      basis: 'cash',
      asOf: CHARGE,
    });
    const parsed = JSON.parse(json) as {
      basis: string;
      periodCount: number;
      entries: RecognitionExportRow[];
    };
    expect(parsed.basis).toBe('cash');
    expect(parsed.periodCount).toBe(1);
    expect(parsed.entries[0].subscriptionId).toBe('sub-1');
    expect(parsed.entries[0].basis).toBe('cash');
  });

  it('escapes quotes in CSV fields', () => {
    const schedule = makeSchedule({ subscriptionId: 'sub "quoted"' });
    const csv = recognitionRowsToCsv(
      buildRecognitionRows([schedule], { asOf: CHARGE + 100 * DAY })
    );
    expect(csv).toContain('"sub ""quoted"""');
  });

  it('produces a stable window for the trailing N days', () => {
    const asOf = Date.UTC(2026, 5, 30);
    const window = recentPeriodWindow(30, asOf);
    expect(window.to).toBe(asOf);
    expect(window.from).toBe(asOf - 30 * DAY);
  });
});
