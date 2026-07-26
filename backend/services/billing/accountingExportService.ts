/**
 * Backend accounting export service.
 *
 * Handles large-dataset streaming exports, reconciliation checks,
 * and encoding-safe output for CSV/JSON/QuickBooks/Xero formats.
 */

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
