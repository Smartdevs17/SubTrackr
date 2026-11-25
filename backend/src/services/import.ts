/**
 * backend/src/services/import.ts
 *
 * Bulk subscription import with duplicate detection and per-row errors.
 *
 * Takes CSV text, validates every row independently, detects duplicates
 * (against subscriptions that already exist AND earlier rows in the same
 * file), and creates the rest. One bad row never blocks the others: every row
 * gets its own outcome with the line number and field-level errors, so users
 * can fix just the failing lines and re-run (re-runs are safe because rows
 * created last time now show up as duplicates).
 *
 * Expected header (case-insensitive, any column order):
 *   name, price, currency, billing_cycle, next_billing_date, category
 * Only `name`, `price`, `currency` and `billing_cycle` are required.
 *
 * Storage and observability are injected so the module stays framework-free.
 */

export const IMPORT_MAX_ROWS = 1000;

export const BILLING_CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export interface ImportSubscriptionInput {
  name: string;
  /** Integer minor units (cents). */
  priceMinor: number;
  currency: string;
  billingCycle: BillingCycle;
  nextBillingDate?: string;
  category?: string;
}

export interface ExistingSubscription {
  name: string;
  currency: string;
  billingCycle: string;
}

export interface ImportRowError {
  field: string;
  message: string;
}

export type ImportRowStatus = 'created' | 'duplicate' | 'error' | 'would_create';

export interface ImportRowResult {
  /** 1-based CSV record number (the header is record 1). */
  line: number;
  status: ImportRowStatus;
  name?: string;
  id?: string;
  errors: ImportRowError[];
  /** For duplicates: where the original is. */
  duplicateOf?: 'existing' | { line: number };
}

export interface ImportSummary {
  total: number;
  created: number;
  duplicates: number;
  failed: number;
  dryRun: boolean;
  rows: ImportRowResult[];
}

export interface ImportLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface ImportDeps {
  existing: ExistingSubscription[];
  /** Persist one subscription and return its id. A throw becomes a row error. */
  create(input: ImportSubscriptionInput): Promise<{ id: string }>;
  logger?: ImportLogger;
}

export interface ImportOptions {
  /** Validate and detect duplicates without creating anything. */
  dryRun?: boolean;
  maxRows?: number;
}

export class ImportError extends Error {
  constructor(
    public readonly code: 'EMPTY_FILE' | 'MISSING_COLUMNS' | 'TOO_MANY_ROWS' | 'MALFORMED_CSV',
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

// ── CSV parsing (RFC 4180: quotes, escaped quotes, embedded newlines) ─────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new ImportError('MALFORMED_CSV', 'Unterminated quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ── Row validation ────────────────────────────────────────────────────────────

const REQUIRED_COLUMNS = ['name', 'price', 'currency', 'billing_cycle'] as const;
const KNOWN_COLUMNS = [...REQUIRED_COLUMNS, 'next_billing_date', 'category'];

/** "9.99" → 999. Rejects negatives, zero, and more than two decimals. */
export function parsePriceMinor(raw: string): number | undefined {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return undefined;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : undefined;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function validateRow(
  cells: Record<string, string>,
): { input: ImportSubscriptionInput } | { errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];
  const name = (cells.name ?? '').trim();
  if (!name) errors.push({ field: 'name', message: 'name is required' });
  else if (name.length > 120) errors.push({ field: 'name', message: 'name must be 120 characters or fewer' });

  const priceMinor = parsePriceMinor(cells.price ?? '');
  if (priceMinor === undefined) {
    errors.push({ field: 'price', message: 'price must be a positive number with at most 2 decimals' });
  }

  const currency = (cells.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    errors.push({ field: 'currency', message: 'currency must be a 3-letter ISO code' });
  }

  const cycle = (cells.billing_cycle ?? '').trim().toLowerCase();
  if (!(BILLING_CYCLES as readonly string[]).includes(cycle)) {
    errors.push({ field: 'billing_cycle', message: `billing_cycle must be one of ${BILLING_CYCLES.join(', ')}` });
  }

  const next = (cells.next_billing_date ?? '').trim();
  if (next && !isRealDate(next)) {
    errors.push({ field: 'next_billing_date', message: 'next_billing_date must be a real date as YYYY-MM-DD' });
  }

  if (errors.length > 0) return { errors };
  return {
    input: {
      name,
      priceMinor: priceMinor as number,
      currency,
      billingCycle: cycle as BillingCycle,
      ...(next ? { nextBillingDate: next } : {}),
      ...((cells.category ?? '').trim() ? { category: cells.category.trim() } : {}),
    },
  };
}

/** Same subscription = same name (case/space-insensitive), currency and cycle. */
export function duplicateKey(name: string, currency: string, cycle: string): string {
  return [name.trim().replace(/\s+/g, ' ').toLowerCase(), currency.trim().toUpperCase(), cycle.trim().toLowerCase()].join('|');
}

// ── Import ────────────────────────────────────────────────────────────────────

export async function importSubscriptions(
  csv: string,
  deps: ImportDeps,
  options: ImportOptions = {},
): Promise<ImportSummary> {
  const dryRun = options.dryRun ?? false;
  const maxRows = options.maxRows ?? IMPORT_MAX_ROWS;
  const log: ImportLogger = deps.logger ?? { info: () => undefined, warn: () => undefined };

  // `line` is the 1-based CSV record number, so blank lines still count.
  const table = parseCsv(csv)
    .map((cells, i) => ({ cells, line: i + 1 }))
    .filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (table.length === 0) throw new ImportError('EMPTY_FILE', 'The file is empty');

  const header = table[0].cells.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new ImportError('MISSING_COLUMNS', `Missing required column(s): ${missing.join(', ')}`);
  }
  const dataRows = table.slice(1);
  if (dataRows.length > maxRows) {
    throw new ImportError('TOO_MANY_ROWS', `Import is limited to ${maxRows} rows (got ${dataRows.length})`);
  }
  const unknown = header.filter((h) => !KNOWN_COLUMNS.includes(h));
  if (unknown.length > 0) log.warn('[import] ignoring unknown columns', { columns: unknown });

  const seen = new Map<string, 'existing' | { line: number }>();
  for (const e of deps.existing) seen.set(duplicateKey(e.name, e.currency, e.billingCycle), 'existing');

  const results: ImportRowResult[] = [];
  for (const { cells, line } of dataRows) {
    const record: Record<string, string> = {};
    header.forEach((h, i) => (record[h] = cells[i] ?? ''));

    if (cells.length > header.length && cells.slice(header.length).some((c) => c.trim() !== '')) {
      results.push({
        line,
        status: 'error',
        name: record.name,
        errors: [{ field: '*', message: `row has ${cells.length} columns but the header has ${header.length}` }],
      });
      continue;
    }

    const validated = validateRow(record);
    if ('errors' in validated) {
      results.push({ line, status: 'error', name: record.name?.trim() || undefined, errors: validated.errors });
      continue;
    }
    const { input } = validated;
    const key = duplicateKey(input.name, input.currency, input.billingCycle);
    const original = seen.get(key);
    if (original) {
      results.push({ line, status: 'duplicate', name: input.name, errors: [], duplicateOf: original });
      continue;
    }
    seen.set(key, { line });

    if (dryRun) {
      results.push({ line, status: 'would_create', name: input.name, errors: [] });
      continue;
    }
    try {
      const { id } = await deps.create(input);
      results.push({ line, status: 'created', name: input.name, id, errors: [] });
    } catch (error) {
      seen.delete(key);
      results.push({
        line,
        status: 'error',
        name: input.name,
        errors: [{ field: '*', message: error instanceof Error ? error.message : String(error) }],
      });
    }
  }

  const summary: ImportSummary = {
    total: results.length,
    created: results.filter((r) => r.status === 'created' || r.status === 'would_create').length,
    duplicates: results.filter((r) => r.status === 'duplicate').length,
    failed: results.filter((r) => r.status === 'error').length,
    dryRun,
    rows: results,
  };
  log.info('[import] subscription import finished', {
    total: summary.total,
    created: summary.created,
    duplicates: summary.duplicates,
    failed: summary.failed,
    dryRun,
  });
  return summary;
}
