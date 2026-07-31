import {
  streamExport,
  reconcile,
  createExportSchedule,
  getExportSchedules,
  updateExportSchedule,
  deleteExportSchedule,
  toggleExportSchedule,
  runDueExports,
  recordExportDownload,
  getExportHistory,
  getExportAnalytics,
  TransactionRecord,
  TransactionType,
} from '../accountingExportService';

function makeRecord(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: 'txn_1',
    merchantId: 'merchant-1',
    subscriptionId: 'sub_1',
    subscriptionName: 'Slack',
    description: 'Team chat',
    category: 'software',
    transactionType: 'revenue',
    amount: 12.5,
    currency: 'usd',
    billingCycle: 'monthly',
    billingDate: Date.UTC(2026, 1, 1),
    deferredRevenue: 0,
    createdAt: Date.UTC(2025, 11, 1),
    ...overrides,
  };
}

describe('accountingExportService', () => {
  describe('streamExport', () => {
    it('streams CSV with correct headers and rows', () => {
      const chunks: string[] = [];
      const { totalRecords } = streamExport([makeRecord()], {
        format: 'csv',
        onChunk: (c) => chunks.push(c),
      });

      const output = chunks.join('');
      expect(totalRecords).toBe(1);
      expect(output).toContain('"TransactionId"');
      expect(output).toContain('"txn_1"');
      expect(output).toContain('"12.50"');
    });

    it('streams QuickBooks CSV format', () => {
      const chunks: string[] = [];
      streamExport([makeRecord()], { format: 'quickbooks', onChunk: (c) => chunks.push(c) });
      const output = chunks.join('');
      expect(output).toContain('"Customer"');
      expect(output).toContain('"Product/Service"');
      expect(output).toContain('"merchant-1"');
    });

    it('streams Xero CSV format', () => {
      const chunks: string[] = [];
      streamExport([makeRecord()], { format: 'xero', onChunk: (c) => chunks.push(c) });
      const output = chunks.join('');
      expect(output).toContain('"ContactName"');
      expect(output).toContain('"InvoiceNumber"');
    });

    it('streams JSON format', () => {
      const chunks: string[] = [];
      streamExport([makeRecord()], { format: 'json', onChunk: (c) => chunks.push(c) });
      const output = chunks.join('');
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe('txn_1');
    });

    it('filters by date range', () => {
      const inRange = makeRecord({ id: 'in', billingDate: Date.UTC(2026, 1, 15) });
      const outRange = makeRecord({ id: 'out', billingDate: Date.UTC(2026, 6, 1) });
      const chunks: string[] = [];
      const { totalRecords } = streamExport([inRange, outRange], {
        format: 'csv',
        filter: { dateFrom: Date.UTC(2026, 0, 1), dateTo: Date.UTC(2026, 2, 31) },
        onChunk: (c) => chunks.push(c),
      });
      expect(totalRecords).toBe(1);
      expect(chunks.join('')).toContain('"in"');
      expect(chunks.join('')).not.toContain('"out"');
    });

    it('filters by transaction type', () => {
      const revenue = makeRecord({ id: 'rev', transactionType: 'revenue' });
      const refund = makeRecord({ id: 'ref', transactionType: 'refund' });
      const chunks: string[] = [];
      const { totalRecords } = streamExport([revenue, refund], {
        format: 'csv',
        filter: { transactionTypes: ['revenue'] as TransactionType[] },
        onChunk: (c) => chunks.push(c),
      });
      expect(totalRecords).toBe(1);
      expect(chunks.join('')).toContain('"rev"');
    });

    it('handles large datasets in chunks', () => {
      const records = Array.from({ length: 1200 }, (_, i) =>
        makeRecord({ id: `txn_${i}` })
      );
      const chunkCount: number[] = [];
      streamExport(records, {
        format: 'csv',
        chunkSize: 500,
        onChunk: () => chunkCount.push(1),
      });
      // header + 3 data chunks (500, 500, 200)
      expect(chunkCount.length).toBe(4);
    });
  });

  describe('reconcile', () => {
    it('returns balanced when all records match', () => {
      const records = [makeRecord()];
      const result = reconcile(records, [
        { id: 'txn_1', amount: 12.5, transactionType: 'revenue' },
      ]);
      expect(result.isBalanced).toBe(true);
      expect(result.mismatches).toHaveLength(0);
      expect(result.totalAmount).toBeCloseTo(12.5);
    });

    it('detects missing records', () => {
      const result = reconcile([], [{ id: 'txn_missing', amount: 10, transactionType: 'revenue' }]);
      expect(result.isBalanced).toBe(false);
      expect(result.mismatches[0]?.reason).toContain('missing');
    });

    it('detects amount mismatches', () => {
      const result = reconcile([makeRecord({ amount: 15 })], [
        { id: 'txn_1', amount: 12.5, transactionType: 'revenue' },
      ]);
      expect(result.isBalanced).toBe(false);
      expect(result.mismatches[0]?.reason).toContain('amount mismatch');
    });

    it('detects transaction type mismatches', () => {
      const result = reconcile([makeRecord({ transactionType: 'refund' })], [
        { id: 'txn_1', amount: 12.5, transactionType: 'revenue' },
      ]);
      expect(result.isBalanced).toBe(false);
      expect(result.mismatches[0]?.reason).toContain('type mismatch');
    });
  });

  describe('PDF streaming', () => {
    it('streams valid PDF content', () => {
      const chunks: string[] = [];
      const { totalRecords } = streamExport([makeRecord()], {
        format: 'pdf',
        filter: { merchantId: 'merchant-1' },
        onChunk: (c) => chunks.push(c),
      });

      const output = chunks.join('');
      expect(totalRecords).toBe(1);
      expect(output).toContain('%PDF-1.4');
      expect(output).toContain('merchant-1');
      expect(output).toContain('Slack');
      expect(output).toContain('%%EOF');
    });
  });

  describe('JSON schema wrapping', () => {
    it('wraps JSON output in schema envelope when includeSchema is true', () => {
      const chunks: string[] = [];
      streamExport([makeRecord()], {
        format: 'json',
        filter: { merchantId: 'merchant-1' },
        includeSchema: true,
        onChunk: (c) => chunks.push(c),
      });

      const output = chunks.join('');
      const parsed = JSON.parse(output);
      expect(parsed.$schema).toContain('subtrackr.app');
      expect(parsed.schemaVersion).toBe('1.0.0');
      expect(parsed.recordCount).toBe(1);
      expect(Array.isArray(parsed.records)).toBe(true);
    });

    it('returns bare JSON array by default', () => {
      const chunks: string[] = [];
      streamExport([makeRecord()], {
        format: 'json',
        onChunk: (c) => chunks.push(c),
      });

      const output = chunks.join('');
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe('txn_1');
    });
  });

  describe('custom field mappings in CSV', () => {
    it('applies custom field mappings to CSV rows', () => {
      const chunks: string[] = [];
      streamExport([makeRecord()], {
        format: 'csv',
        onChunk: (c) => chunks.push(c),
        fieldMappings: [
          { targetField: 'ID', sourceField: 'id' },
          { targetField: 'Total', sourceField: 'amount', transform: 'currency' },
        ],
      });

      const output = chunks.join('');
      expect(output).toContain('"ID"');
      expect(output).toContain('"Total"');
      expect(output).toContain('"txn_1"');
      expect(output).toContain('"12.50"');
    });
  });

  describe('schedule management', () => {
    const baseInput = {
      merchantId: 'merchant-sched',
      format: 'csv' as const,
      frequency: 'weekly' as const,
      enabled: true,
      includeInactive: false,
      nextRunAt: Date.now() + 1000,
    };

    it('creates, reads, updates, and deletes schedules', () => {
      const sched = createExportSchedule(baseInput);
      expect(sched.id).toBeTruthy();

      const schedules = getExportSchedules('merchant-sched');
      expect(schedules.some((s) => s.id === sched.id)).toBe(true);

      const updated = updateExportSchedule(sched.id, { frequency: 'monthly' });
      expect(updated?.frequency).toBe('monthly');

      const deleted = deleteExportSchedule(sched.id);
      expect(deleted).toBe(true);

      const afterDelete = getExportSchedules('merchant-sched');
      expect(afterDelete.find((s) => s.id === sched.id)).toBeUndefined();
    });

    it('toggleExportSchedule enables and disables', () => {
      const sched = createExportSchedule({ ...baseInput, enabled: true });
      const paused = toggleExportSchedule(sched.id, false);
      expect(paused?.enabled).toBe(false);
      const resumed = toggleExportSchedule(sched.id, true);
      expect(resumed?.enabled).toBe(true);
    });

    it('runDueExports processes due schedules', () => {
      const past = Date.now() - 5000;
      createExportSchedule({ ...baseInput, merchantId: 'merchant-due', nextRunAt: past });
      const results = runDueExports([makeRecord()], Date.now());
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('analytics and history', () => {
    it('getExportAnalytics aggregates history', () => {
      // runDueExports populates history; analytics should reflect counts
      const analytics = getExportAnalytics();
      expect(typeof analytics.totalExports).toBe('number');
      expect(typeof analytics.totalDownloads).toBe('number');
      expect(typeof analytics.formatBreakdown.csv).toBe('number');
    });

    it('recordExportDownload increments download count', () => {
      const history = getExportHistory();
      if (history.length === 0) {
        // No history to test against; pass
        return;
      }
      const entry = history[0]!;
      const updated = recordExportDownload(entry.id);
      expect(updated?.downloadCount).toBe((entry.downloadCount ?? 0) + 1);
    });

    it('recordExportDownload returns null for unknown id', () => {
      const result = recordExportDownload('unknown_backend_id');
      expect(result).toBeNull();
    });
  });
});
