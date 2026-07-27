/**
 * Backend accounting export service.
 *
 * Handles large-dataset streaming exports, reconciliation checks,
 * and encoding-safe output for CSV/JSON/QuickBooks/Xero formats.
 *
 * Issue #768: Added async-generator streaming exports and SSE progress variants.
 */

import { MemoryMonitor, toNdjsonLine } from '../shared/streaming';

export type AccountingFormat = 'csv' | 'json' | 'quickbooks' | 'xero';
export type TransactionType = 'revenue' | 'refund' | 'credit' | 'fee';

export interface TransactionRecord {
  id: string;
  merchantId: string;
  subscriptionId: string;
  subscriptionName: string;
  description?: string;
  category?: string;
  transactionType: TransactionType;
  amount: number;
  currency: string;
  billingCycle?: string;
  billingDate: number; // Unix ms
  deferredRevenue?: number;
  createdAt: number;
}

export interface ExportFilter {
  merchantId?: string;
  dateFrom?: number;
  dateTo?: number;
  transactionTypes?: TransactionType[];
  includeInactive?: boolean;
}

export interface StreamExportOptions {
  format: AccountingFormat;
  filter?: ExportFilter;
  /** Called with each chunk of output (for streaming large datasets). */
  onChunk: (chunk: string) => void;
  /** Chunk size in number of records. Default: 500. */
  chunkSize?: number;
}

// ── Async streaming types (Issue #768) ──────────────────────────────────────

/** Progress callback fired for each chunk during a streaming export. */
export type ExportProgressCallback = (progress: {
  /** 0–100 */
  percent: number;
  /** Records processed so far */
  recordsProcessed: number;
  /** Total records in the filtered result */
  totalRecords: number;
  /** Serialised chunk payload */
  chunk: string;
  /** Chunk index starting at 0 */
  chunkIndex: number;
}) => void | Promise<void>;

/** Options for the async-generator streaming export variants. */
export interface AsyncStreamExportOptions {
  format: AccountingFormat;
  filter?: ExportFilter;
  /** Chunk size in records. Default: 500. */
  chunkSize?: number;
  /** Optional memory monitor — will call check() between chunks. */
  memoryMonitor?: MemoryMonitor;
}

export interface ReconciliationResult {
  totalRecords: number;
  totalAmount: number;
  mismatches: Array<{ id: string; reason: string }>;
  isBalanced: boolean;
}

// ── Encoding helpers ──────────────────────────────────────────────────────────

/** Escape a value for CSV, handling commas, quotes, and non-ASCII safely. */
function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  // Normalize to NFC to avoid encoding mismatches
  const normalized = text.normalize('NFC');
  return `"${normalized.replace(/"/g, '""')}"`;
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ── Format builders ───────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'TransactionId',
  'MerchantId',
  'SubscriptionId',
  'Name',
  'Description',
  'Category',
  'Type',
  'Amount',
  'Currency',
  'BillingCycle',
  'BillingDate',
  'DeferredRevenue',
  'CreatedAt',
];

const QB_HEADERS = [
  'Customer',
  'Product/Service',
  'Description',
  'Qty',
  'Rate',
  'Amount',
  'Currency',
  'Service Date',
  'Memo',
];

const XERO_HEADERS = [
  'ContactName',
  'InvoiceNumber',
  'InvoiceDate',
  'DueDate',
  'Description',
  'Quantity',
  'UnitAmount',
  'AccountCode',
  'TaxType',
  'Currency',
];

function recordToCsvRow(r: TransactionRecord, format: AccountingFormat): string {
  if (format === 'quickbooks') {
    return [
      csvEscape(r.merchantId),
      csvEscape(r.subscriptionName),
      csvEscape(r.description ?? ''),
      csvEscape('1'),
      csvEscape(r.amount.toFixed(2)),
      csvEscape(r.amount.toFixed(2)),
      csvEscape(r.currency.toUpperCase()),
      csvEscape(formatDate(r.billingDate)),
      csvEscape(r.billingCycle ?? ''),
    ].join(',');
  }
  if (format === 'xero') {
    return [
      csvEscape(r.merchantId),
      csvEscape(r.subscriptionId),
      csvEscape(formatDate(r.createdAt)),
      csvEscape(formatDate(r.billingDate)),
      csvEscape(r.subscriptionName),
      csvEscape('1'),
      csvEscape(r.amount.toFixed(2)),
      csvEscape('400'),
      csvEscape('NONE'),
      csvEscape(r.currency.toUpperCase()),
    ].join(',');
  }
  // csv (generic)
  return [
    csvEscape(r.id),
    csvEscape(r.merchantId),
    csvEscape(r.subscriptionId),
    csvEscape(r.subscriptionName),
    csvEscape(r.description ?? ''),
    csvEscape(r.category ?? ''),
    csvEscape(r.transactionType),
    csvEscape(r.amount.toFixed(2)),
    csvEscape(r.currency.toUpperCase()),
    csvEscape(r.billingCycle ?? ''),
    csvEscape(formatDate(r.billingDate)),
    csvEscape((r.deferredRevenue ?? 0).toFixed(2)),
    csvEscape(formatDate(r.createdAt)),
  ].join(',');
}

function headersForFormat(format: AccountingFormat): string[] {
  if (format === 'quickbooks') return QB_HEADERS;
  if (format === 'xero') return XERO_HEADERS;
  return CSV_HEADERS;
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function applyFilter(records: TransactionRecord[], filter: ExportFilter): TransactionRecord[] {
  return records.filter((r) => {
    if (filter.merchantId && r.merchantId !== filter.merchantId) return false;
    if (filter.dateFrom !== undefined && r.billingDate < filter.dateFrom) return false;
    if (filter.dateTo !== undefined && r.billingDate > filter.dateTo) return false;
    if (filter.transactionTypes?.length && !filter.transactionTypes.includes(r.transactionType))
      return false;
    return true;
  });
}

// ── Streaming export ──────────────────────────────────────────────────────────

/**
 * Stream-export a large set of transaction records in chunks.
 * Emits header first, then rows in batches to avoid memory pressure.
 */
export function streamExport(
  records: TransactionRecord[],
  options: StreamExportOptions
): { totalRecords: number; checksum: string } {
  const { format, filter = {}, onChunk, chunkSize = 500 } = options;
  const filtered = applyFilter(records, filter);

  if (format === 'json') {
    // Stream JSON array in chunks
    onChunk('[');
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      const separator = i === 0 ? '' : ',';
      onChunk(separator + batch.map((r) => JSON.stringify(r)).join(','));
    }
    onChunk(']');
  } else {
    const headers = headersForFormat(format);
    onChunk(headers.map(csvEscape).join(',') + '\n');
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      onChunk(batch.map((r) => recordToCsvRow(r, format)).join('\n') + '\n');
    }
  }

  // Simple checksum over record IDs for reconciliation
  const cs = filtered.reduce((acc, r) => acc ^ r.id.split('').reduce((h, c) => h + c.charCodeAt(0), 0), 0);
  return { totalRecords: filtered.length, checksum: Math.abs(cs).toString(16) };
}

// ── Async-generator streaming export (Issue #768) ───────────────────────────

/**
 * Async-generator variant of `streamExport`.
 *
 * Yields string chunks lazily — the full result set is never held in memory at
 * once. Each yielded value is a self-contained fragment that can be piped
 * directly to an HTTP response or a file stream.
 *
 * ```ts
 * const gen = streamExportAsync(records, { format: 'csv' });
 * for await (const chunk of gen) {
 *   res.write(chunk);
 * }
 * ```
 */
export async function* streamExportAsync(
  records: TransactionRecord[],
  options: AsyncStreamExportOptions
): AsyncGenerator<string> {
  const { format, filter = {}, chunkSize = 500, memoryMonitor } = options;
  const filtered = applyFilter(records, filter);

  if (format === 'json') {
    yield '[';
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      const separator = i === 0 ? '' : ',';
      yield separator + batch.map((r) => JSON.stringify(r)).join(',');
      memoryMonitor?.check();
      // Yield to event loop between chunks to avoid blocking
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    yield ']';
  } else {
    const headers = headersForFormat(format);
    yield headers.map(csvEscape).join(',') + '\n';
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      yield batch.map((r) => recordToCsvRow(r, format)).join('\n') + '\n';
      memoryMonitor?.check();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

/**
 * NDJSON streaming export — each record is its own JSON line.
 *
 * Suitable for endpoints that need line-by-line client parsing (e.g., the
 * `GET /subscriptions/stream` endpoint).
 */
export async function* streamExportNdjson(
  records: TransactionRecord[],
  options: Omit<AsyncStreamExportOptions, 'format'>
): AsyncGenerator<string> {
  const { filter = {}, chunkSize = 500, memoryMonitor } = options;
  const filtered = applyFilter(records, filter);

  for (let i = 0; i < filtered.length; i += chunkSize) {
    const batch = filtered.slice(i, i + chunkSize);
    for (const record of batch) {
      yield toNdjsonLine(record);
    }
    memoryMonitor?.check();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * Streaming export with per-chunk progress callbacks — intended for SSE
 * endpoints where the caller needs to emit `progress` events to the client
 * while the export is being built.
 *
 * Returns a summary `{ totalRecords, checksum }` once complete (same as
 * the synchronous `streamExport`).
 */
export async function streamExportWithProgress(
  records: TransactionRecord[],
  options: AsyncStreamExportOptions,
  onProgress: ExportProgressCallback
): Promise<{ totalRecords: number; checksum: string }> {
  const { format, filter = {}, chunkSize = 500, memoryMonitor } = options;
  const filtered = applyFilter(records, filter);
  const totalRecords = filtered.length;
  let chunkIndex = 0;

  let checksum = 0;

  const emitChunk = async (chunk: string, recordsProcessed: number) => {
    const percent = totalRecords === 0 ? 100 : Math.round((recordsProcessed / totalRecords) * 100);
    await onProgress({ percent, recordsProcessed, totalRecords, chunk, chunkIndex });
    chunkIndex++;
    memoryMonitor?.check();
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  if (format === 'json') {
    await emitChunk('[', 0);
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      const separator = i === 0 ? '' : ',';
      await emitChunk(separator + batch.map((r) => JSON.stringify(r)).join(','), i + batch.length);
    }
    await emitChunk(']', totalRecords);
  } else {
    const headers = headersForFormat(format);
    await emitChunk(headers.map(csvEscape).join(',') + '\n', 0);
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      await emitChunk(
        batch.map((r) => recordToCsvRow(r, format)).join('\n') + '\n',
        i + batch.length
      );
    }
  }

  checksum = filtered.reduce(
    (acc, r) => acc ^ r.id.split('').reduce((h, c) => h + c.charCodeAt(0), 0),
    0
  );

  return { totalRecords, checksum: Math.abs(checksum).toString(16) };
}

// ── Reconciliation ────────────────────────────────────────────────────────────

/**
 * Reconcile exported records against expected totals.
 * Returns mismatches where amount or type doesn't match expectations.
 */
export function reconcile(
  exported: TransactionRecord[],
  expected: Array<{ id: string; amount: number; transactionType: TransactionType }>
): ReconciliationResult {
  const exportedMap = new Map(exported.map((r) => [r.id, r]));
  const mismatches: Array<{ id: string; reason: string }> = [];
  let totalAmount = 0;

  for (const exp of expected) {
    const actual = exportedMap.get(exp.id);
    if (!actual) {
      mismatches.push({ id: exp.id, reason: 'missing from export' });
      continue;
    }
    if (Math.abs(actual.amount - exp.amount) > 0.001) {
      mismatches.push({
        id: exp.id,
        reason: `amount mismatch: expected ${exp.amount}, got ${actual.amount}`,
      });
    }
    if (actual.transactionType !== exp.transactionType) {
      mismatches.push({
        id: exp.id,
        reason: `type mismatch: expected ${exp.transactionType}, got ${actual.transactionType}`,
      });
    }
    totalAmount += actual.amount;
  }

  return {
    totalRecords: exported.length,
    totalAmount,
    mismatches,
    isBalanced: mismatches.length === 0,
  };
}
