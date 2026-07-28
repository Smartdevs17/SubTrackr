import {
  streamExport,
  reconcile,
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
});
