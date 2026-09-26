/**
 * Issue #768 – Tests for the async streaming variants added to accountingExportService.ts
 */

import {
  streamExportAsync,
  streamExportNdjson,
  streamExportWithProgress,
} from '../accountingExportService';
import type { TransactionRecord, AsyncStreamExportOptions } from '../accountingExportService';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeRecords(count: number): TransactionRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `tx_${i}`,
    merchantId: `merchant_1`,
    subscriptionId: `sub_${i % 5}`,
    subscriptionName: `Subscription ${i}`,
    description: `Desc ${i}`,
    category: 'streaming',
    transactionType: 'revenue' as const,
    amount: 9.99 + i,
    currency: 'usd',
    billingCycle: 'monthly',
    billingDate: Date.now() - i * 86400000,
    deferredRevenue: 0,
    createdAt: Date.now() - i * 86400000,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// streamExportAsync
// ─────────────────────────────────────────────────────────────────────────────

describe('streamExportAsync', () => {
  async function collect(gen: AsyncGenerator<string>): Promise<string> {
    let out = '';
    for await (const chunk of gen) out += chunk;
    return out;
  }

  it('json format: produces valid JSON array for 0 records', async () => {
    const gen = streamExportAsync([], { format: 'json' });
    const out = await collect(gen);
    expect(JSON.parse(out)).toEqual([]);
  });

  it('json format: produces valid JSON array for N records', async () => {
    const records = makeRecords(15);
    const gen = streamExportAsync(records, { format: 'json', chunkSize: 5 });
    const out = await collect(gen);
    const parsed = JSON.parse(out) as TransactionRecord[];
    expect(parsed).toHaveLength(15);
    expect(parsed[0].id).toBe('tx_0');
    expect(parsed[14].id).toBe('tx_14');
  });

  it('csv format: first line is the header', async () => {
    const records = makeRecords(3);
    const gen = streamExportAsync(records, { format: 'csv', chunkSize: 10 });
    const out = await collect(gen);
    const lines = out.split('\n').filter(Boolean);
    expect(lines[0]).toContain('TransactionId');
    expect(lines).toHaveLength(4); // header + 3 data rows
  });

  it('quickbooks format: header row matches QB columns', async () => {
    const records = makeRecords(2);
    const gen = streamExportAsync(records, { format: 'quickbooks' });
    const out = await collect(gen);
    const firstLine = out.split('\n')[0];
    expect(firstLine).toContain('Customer');
    expect(firstLine).toContain('Amount');
  });

  it('applies filter correctly', async () => {
    const records = makeRecords(10);
    const gen = streamExportAsync(records, {
      format: 'json',
      filter: { merchantId: 'merchant_1', transactionTypes: ['revenue'] },
    });
    const out = await collect(gen);
    const parsed = JSON.parse(out) as TransactionRecord[];
    expect(parsed).toHaveLength(10); // all match
  });

  it('respects chunkSize (generator yields multiple chunks)', async () => {
    const records = makeRecords(11);
    const chunks: string[] = [];
    const gen = streamExportAsync(records, { format: 'csv', chunkSize: 5 });
    for await (const chunk of gen) chunks.push(chunk);
    // header + 3 data chunks (5, 5, 1)
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// streamExportNdjson
// ─────────────────────────────────────────────────────────────────────────────

describe('streamExportNdjson', () => {
  it('yields one NDJSON line per record', async () => {
    const records = makeRecords(5);
    const lines: string[] = [];
    for await (const line of streamExportNdjson(records, {})) {
      lines.push(line.trim());
    }
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('produces empty output for 0 records', async () => {
    const lines: string[] = [];
    for await (const line of streamExportNdjson([], {})) {
      lines.push(line);
    }
    expect(lines).toHaveLength(0);
  });

  it('each line parses to the original record shape', async () => {
    const records = makeRecords(3);
    const parsed: TransactionRecord[] = [];
    for await (const line of streamExportNdjson(records, { chunkSize: 2 })) {
      parsed.push(JSON.parse(line.trim()) as TransactionRecord);
    }
    expect(parsed.map((r) => r.id)).toEqual(['tx_0', 'tx_1', 'tx_2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// streamExportWithProgress
// ─────────────────────────────────────────────────────────────────────────────

describe('streamExportWithProgress', () => {
  it('fires onProgress for each chunk and reaches 100%', async () => {
    const records = makeRecords(20);
    const progresses: number[] = [];

    await streamExportWithProgress(
      records,
      { format: 'json', chunkSize: 5 },
      async (p) => { progresses.push(p.percent); }
    );

    expect(progresses[progresses.length - 1]).toBe(100);
    // Should be monotonically non-decreasing
    for (let i = 1; i < progresses.length; i++) {
      expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
    }
  });

  it('returns correct totalRecords and a checksum string', async () => {
    const records = makeRecords(7);
    const result = await streamExportWithProgress(
      records,
      { format: 'csv', chunkSize: 3 },
      async () => {}
    );
    expect(result.totalRecords).toBe(7);
    expect(typeof result.checksum).toBe('string');
    expect(result.checksum.length).toBeGreaterThan(0);
  });

  it('calls onProgress with chunk payload containing data', async () => {
    const records = makeRecords(5);
    const chunks: string[] = [];

    await streamExportWithProgress(
      records,
      { format: 'csv', chunkSize: 5 },
      async (p) => { chunks.push(p.chunk); }
    );

    // There is at least the header + one data chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some((c) => c.includes('tx_'))).toBe(true);
  });

  it('returns totalRecords 0 and 0 percent for empty records', async () => {
    const percents: number[] = [];
    const result = await streamExportWithProgress(
      [],
      { format: 'json', chunkSize: 10 },
      async (p) => { percents.push(p.percent); }
    );
    expect(result.totalRecords).toBe(0);
    // all progress events should be 100% for empty set
    expect(percents.every((p) => p === 100)).toBe(true);
  });
});
