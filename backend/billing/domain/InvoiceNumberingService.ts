/**
 * Invoice numbering schemes (issue #1738)
 *
 * Per-merchant numbering configuration: prefix, sequence padding, optional
 * UTC year segment and an optional yearly reset of the sequence. Each
 * merchant owns an independent sequence, so invoice numbers only need to be
 * unique within a merchant — two merchants may legitimately both issue
 * INV-2026-000001.
 *
 * The scheme is stored in `invoice_numbering` (migration 007). Allocation
 * goes through a single atomic upsert, so concurrent generators cannot hand
 * out the same sequence, and switching to a new period (year) resets the
 * sequence to 1 exactly once.
 */

import type { Pool } from '../../shared/db/connectionPool';

export interface InvoiceNumberingScheme {
  /** Literal prefix such as INV or ACME. */
  prefix: string;
  /** Zero-padding width of the sequence segment (1-12 digits). */
  padding: number;
  /** Embed the UTC year: INV-2026-000001 instead of INV-000001. */
  includeYear: boolean;
  /** Restart the sequence at 1 when the UTC year changes (requires includeYear). */
  yearlyReset: boolean;
}

export interface InvoiceNumberingState {
  merchantId: string;
  scheme: InvoiceNumberingScheme;
  sequence: number;
  period: string;
}

export interface InvoiceNumberingView {
  merchantId: string;
  scheme: InvoiceNumberingScheme;
  /** True when the merchant has no stored row and built-in defaults are shown. */
  isDefault: boolean;
  /** Last allocated sequence (0 before the first invoice). */
  sequence: number;
  period: string;
  /** Number the next invoice would receive under this scheme. */
  nextExample: string;
}

export interface InvoiceNumberingStore {
  get(merchantId: string): Promise<InvoiceNumberingState | null>;
  configure(merchantId: string, scheme: InvoiceNumberingScheme): Promise<InvoiceNumberingState>;
  nextSequence(merchantId: string, scheme: InvoiceNumberingScheme, period: string): Promise<number>;
}

export interface InvoiceNumberingService {
  getScheme(merchantId: string): Promise<InvoiceNumberingView>;
  configureScheme(merchantId: string, patch: unknown): Promise<InvoiceNumberingView>;
  nextNumber(
    merchantId: string
  ): Promise<{ invoiceNumber: string; sequence: number; period: string; scheme: InvoiceNumberingScheme }>;
}

/** Thrown for invalid scheme input; routers map it to HTTP 400. */
export class InvoiceNumberingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceNumberingValidationError';
  }
}

export const DEFAULT_INVOICE_NUMBERING_SCHEME: InvoiceNumberingScheme = Object.freeze({
  prefix: 'INV',
  padding: 6,
  includeYear: true,
  yearlyReset: true,
});

const PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const MAX_PREFIX_LENGTH = 16;

export function validateInvoiceNumberingScheme(scheme: InvoiceNumberingScheme): void {
  if (typeof scheme.prefix !== 'string' || !PREFIX_PATTERN.test(scheme.prefix)) {
    throw new InvoiceNumberingValidationError(
      `prefix must start with a letter and contain only letters and digits (got ${JSON.stringify(scheme.prefix)})`
    );
  }
  if (scheme.prefix.length > MAX_PREFIX_LENGTH) {
    throw new InvoiceNumberingValidationError(`prefix must be ${MAX_PREFIX_LENGTH} characters or fewer`);
  }
  if (!Number.isInteger(scheme.padding) || scheme.padding < 1 || scheme.padding > 12) {
    throw new InvoiceNumberingValidationError('padding must be an integer between 1 and 12');
  }
  if (scheme.yearlyReset && !scheme.includeYear) {
    throw new InvoiceNumberingValidationError(
      'yearlyReset requires includeYear so numbers stay unique across years'
    );
  }
}

/**
 * Merge a partial scheme patch over `base` and validate the result.
 * Missing fields keep their current (or default) value, so a PUT with only
 * `{ prefix: 'ACME' }` changes just the prefix.
 */
export function parseInvoiceNumberingScheme(
  raw: unknown,
  base: InvoiceNumberingScheme = DEFAULT_INVOICE_NUMBERING_SCHEME
): InvoiceNumberingScheme {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvoiceNumberingValidationError('scheme must be an object');
  }
  const input = raw as Record<string, unknown>;
  const scheme: InvoiceNumberingScheme = { ...base };

  if (input['prefix'] !== undefined) {
    if (typeof input['prefix'] !== 'string') {
      throw new InvoiceNumberingValidationError('prefix must be a string');
    }
    scheme.prefix = input['prefix'].trim();
  }
  if (input['padding'] !== undefined) {
    if (typeof input['padding'] !== 'number') {
      throw new InvoiceNumberingValidationError('padding must be a number');
    }
    scheme.padding = input['padding'];
  }
  if (input['includeYear'] !== undefined) {
    if (typeof input['includeYear'] !== 'boolean') {
      throw new InvoiceNumberingValidationError('includeYear must be a boolean');
    }
    scheme.includeYear = input['includeYear'];
    // Dropping the year segment implies the sequence can no longer reset
    // yearly. An explicit contradicting yearlyReset still fails validation.
    if (!scheme.includeYear && input['yearlyReset'] === undefined) {
      scheme.yearlyReset = false;
    }
  }
  if (input['yearlyReset'] !== undefined) {
    if (typeof input['yearlyReset'] !== 'boolean') {
      throw new InvoiceNumberingValidationError('yearlyReset must be a boolean');
    }
    scheme.yearlyReset = input['yearlyReset'];
  }

  validateInvoiceNumberingScheme(scheme);
  return scheme;
}

/**
 * Sequence period key. Empty when the sequence never resets, so the stored
 * `period` stays stable and the sequence runs continuously.
 */
export function invoiceNumberingPeriod(scheme: InvoiceNumberingScheme, now: Date): string {
  return scheme.yearlyReset ? String(now.getUTCFullYear()) : '';
}

export function formatInvoiceNumber(scheme: InvoiceNumberingScheme, sequence: number, now: Date): string {
  const padded = String(Math.max(1, Math.trunc(sequence))).padStart(scheme.padding, '0');
  return scheme.includeYear
    ? `${scheme.prefix}-${now.getUTCFullYear()}-${padded}`
    : `${scheme.prefix}-${padded}`;
}

function toState(merchantId: string, row: Record<string, unknown>): InvoiceNumberingState {
  return {
    merchantId,
    scheme: {
      prefix: String(row['prefix']),
      padding: Number(row['padding']),
      includeYear: Boolean(row['include_year']),
      yearlyReset: Boolean(row['yearly_reset']),
    },
    sequence: Number(row['sequence'] ?? 0),
    period: String(row['period'] ?? ''),
  };
}

export class InMemoryInvoiceNumberingStore implements InvoiceNumberingStore {
  private readonly rows = new Map<string, InvoiceNumberingState>();

  constructor(seed?: Iterable<InvoiceNumberingState>) {
    if (seed) {
      for (const row of seed) this.rows.set(row.merchantId, row);
    }
  }

  async get(merchantId: string): Promise<InvoiceNumberingState | null> {
    const row = this.rows.get(merchantId);
    return row ? { ...row, scheme: { ...row.scheme } } : null;
  }

  async configure(merchantId: string, scheme: InvoiceNumberingScheme): Promise<InvoiceNumberingState> {
    const existing = this.rows.get(merchantId);
    const next: InvoiceNumberingState = {
      merchantId,
      scheme: { ...scheme },
      sequence: existing?.sequence ?? 0,
      period: existing?.period ?? '',
    };
    this.rows.set(merchantId, next);
    return { ...next, scheme: { ...next.scheme } };
  }

  async nextSequence(merchantId: string, scheme: InvoiceNumberingScheme, period: string): Promise<number> {
    const existing = this.rows.get(merchantId);
    const sequence = existing && existing.period === period ? existing.sequence + 1 : 1;
    this.rows.set(merchantId, {
      merchantId,
      scheme: existing ? { ...existing.scheme } : { ...scheme },
      sequence,
      period,
    });
    return sequence;
  }
}

export class PostgresInvoiceNumberingStore implements InvoiceNumberingStore {
  constructor(private readonly pool: Pool) {}

  async get(merchantId: string): Promise<InvoiceNumberingState | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT merchant_id, prefix, padding, include_year, yearly_reset, sequence, period
       FROM invoice_numbering
       WHERE merchant_id = $1`,
      [merchantId]
    );
    const row = result.rows[0];
    return row ? toState(merchantId, row) : null;
  }

  async configure(merchantId: string, scheme: InvoiceNumberingScheme): Promise<InvoiceNumberingState> {
    // The sequence is deliberately preserved on update: keeping the counter
    // moving forward is what stops a scheme change from reissuing numbers.
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO invoice_numbering (merchant_id, prefix, padding, include_year, yearly_reset, sequence, period)
       VALUES ($1, $2, $3, $4, $5, 0, '')
       ON CONFLICT (merchant_id) DO UPDATE
         SET prefix = EXCLUDED.prefix,
             padding = EXCLUDED.padding,
             include_year = EXCLUDED.include_year,
             yearly_reset = EXCLUDED.yearly_reset,
             updated_at = now()
       RETURNING merchant_id, prefix, padding, include_year, yearly_reset, sequence, period`,
      [merchantId, scheme.prefix, scheme.padding, scheme.includeYear, scheme.yearlyReset]
    );
    return toState(merchantId, result.rows[0]);
  }

  async nextSequence(merchantId: string, scheme: InvoiceNumberingScheme, period: string): Promise<number> {
    // Single-statement upsert: the increment (or period reset to 1) is
    // atomic, so concurrent requests can never receive the same sequence.
    const result = await this.pool.query<{ sequence: number | string }>(
      `INSERT INTO invoice_numbering (merchant_id, prefix, padding, include_year, yearly_reset, sequence, period)
       VALUES ($1, $2, $3, $4, $5, 1, $6)
       ON CONFLICT (merchant_id) DO UPDATE
         SET sequence = CASE WHEN invoice_numbering.period = EXCLUDED.period
                             THEN invoice_numbering.sequence + 1
                             ELSE 1 END,
             period = EXCLUDED.period,
             updated_at = now()
       RETURNING sequence`,
      [merchantId, scheme.prefix, scheme.padding, scheme.includeYear, scheme.yearlyReset, period]
    );
    return Number(result.rows[0].sequence);
  }
}

function buildView(
  merchantId: string,
  state: InvoiceNumberingState | null,
  at: Date
): InvoiceNumberingView {
  const scheme = state?.scheme ?? DEFAULT_INVOICE_NUMBERING_SCHEME;
  const period = invoiceNumberingPeriod(scheme, at);
  const sequence = state?.sequence ?? 0;
  const withinPeriod = state !== null && state.period === period;
  const nextSequence = state === null ? 1 : withinPeriod ? sequence + 1 : 1;
  return {
    merchantId,
    scheme: { ...scheme },
    isDefault: state === null,
    sequence,
    period,
    nextExample: formatInvoiceNumber(scheme, nextSequence, at),
  };
}

export interface InvoiceNumberingServiceDeps {
  store: InvoiceNumberingStore;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export function createInvoiceNumberingService(deps: InvoiceNumberingServiceDeps): InvoiceNumberingService {
  const now = deps.now ?? (() => new Date());

  function requireMerchantId(merchantId: string): void {
    if (!merchantId) {
      throw new InvoiceNumberingValidationError('merchantId is required');
    }
  }

  return {
    async getScheme(merchantId: string): Promise<InvoiceNumberingView> {
      requireMerchantId(merchantId);
      return buildView(merchantId, await deps.store.get(merchantId), now());
    },

    async configureScheme(merchantId: string, patch: unknown): Promise<InvoiceNumberingView> {
      requireMerchantId(merchantId);
      const existing = await deps.store.get(merchantId);
      const scheme = parseInvoiceNumberingScheme(patch, existing?.scheme ?? DEFAULT_INVOICE_NUMBERING_SCHEME);
      const saved = await deps.store.configure(merchantId, scheme);
      return buildView(merchantId, saved, now());
    },

    async nextNumber(merchantId: string) {
      requireMerchantId(merchantId);
      const state = await deps.store.get(merchantId);
      const scheme = state?.scheme ?? DEFAULT_INVOICE_NUMBERING_SCHEME;
      const at = now();
      const period = invoiceNumberingPeriod(scheme, at);
      const sequence = await deps.store.nextSequence(merchantId, scheme, period);
      return {
        invoiceNumber: formatInvoiceNumber(scheme, sequence, at),
        sequence,
        period,
        scheme: { ...scheme },
      };
    },
  };
}
