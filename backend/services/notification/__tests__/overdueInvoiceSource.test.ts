/**
 * Unit tests for overdueInvoiceSource.ts (#1737)
 *
 * Covers:
 *  - createPostgresOverdueInvoiceSource: row mapping, invalid-row skipping,
 *    parameterised query shape, option defaults and overrides
 *  - createInvoiceListSource: past-due filtering, field mapping, sorting,
 *    limit, merchant fallback
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { Pool } from '../../../shared/db/connectionPool';
import type { Invoice } from '../../../../src/types/invoice';
import {
  createPostgresOverdueInvoiceSource,
  createInvoiceListSource,
  SETTLED_INVOICE_STATUSES,
  DEFAULT_MERCHANT_ID,
  DEFAULT_INVOICE_SOURCE_LIMIT,
  DEFAULT_SETTLED_LOOKBACK_DAYS,
} from '../overdueInvoiceSource';

// ─── Postgres source ──────────────────────────────────────────────────────────

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

function fakePool(rows: Array<Record<string, unknown>>): {
  pool: Pool;
  queries: CapturedQuery[];
} {
  const queries: CapturedQuery[] = [];
  const pool = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rows };
    }),
  } as unknown as Pool;
  return { pool, queries };
}

describe('createPostgresOverdueInvoiceSource', () => {
  it('maps rows to overdue invoices', async () => {
    const { pool } = fakePool([
      {
        invoice_number: 'INV-1',
        customer_name: 'Dana Lee',
        customer_email: 'dana@example.com',
        status: 'sent',
        total: '49.50',
        currency: 'USD',
        due_date: new Date('2026-03-01T00:00:00.000Z'),
        subscription_id: 'sub_1',
      },
    ]);
    const source = createPostgresOverdueInvoiceSource(pool, { merchantId: 'merch_1' });

    const invoices = await source(new Date('2026-03-15T00:00:00.000Z'));

    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      id: 'INV-1',
      invoiceNumber: 'INV-1',
      merchantId: 'merch_1',
      customerName: 'Dana Lee',
      customerEmail: 'dana@example.com',
      subscriptionName: 'sub_1',
      amount: 49.5,
      currency: 'USD',
      dueDate: '2026-03-01T00:00:00.000Z',
      status: 'sent',
      invoiceUrl: 'https://app.subtrackr.io/invoices/INV-1',
    });
  });

  it('skips rows without an invoice number or due date', async () => {
    const { pool } = fakePool([
      {
        invoice_number: '   ',
        customer_email: 'a@example.com',
        status: 'sent',
        total: '10',
        currency: 'USD',
        due_date: new Date('2026-03-01T00:00:00.000Z'),
      },
      {
        invoice_number: 'INV-2',
        customer_email: 'b@example.com',
        status: 'sent',
        total: '10',
        currency: 'USD',
        due_date: null,
      },
    ]);
    const source = createPostgresOverdueInvoiceSource(pool);

    expect(await source(new Date())).toHaveLength(0);
  });

  it('passes now, limit and settled lookback as query parameters and lists settled statuses', async () => {
    const { pool, queries } = fakePool([]);
    const source = createPostgresOverdueInvoiceSource(pool, {
      merchantId: 'merch_1',
      limit: 42,
      settledLookbackDays: 3,
    });

    await source(new Date('2026-03-15T00:00:00.000Z'));

    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual(['2026-03-15T00:00:00.000Z', 42, 3]);
    for (const status of SETTLED_INVOICE_STATUSES) {
      expect(queries[0].sql).toContain(`'${status}'`);
    }
    expect(queries[0].sql).toContain('LIMIT $2');
    expect(queries[0].sql).not.toMatch(/\$\{[^}]+\}/);
  });

  it('applies option defaults when omitted', async () => {
    const { pool, queries } = fakePool([]);
    const source = createPostgresOverdueInvoiceSource(pool);

    await source(new Date('2026-03-15T00:00:00.000Z'));

    expect(queries[0].params).toEqual([
      '2026-03-15T00:00:00.000Z',
      DEFAULT_INVOICE_SOURCE_LIMIT,
      DEFAULT_SETTLED_LOOKBACK_DAYS,
    ]);
  });

  it('falls back to the default merchant id and strips a trailing slash from appBaseUrl', async () => {
    const { pool } = fakePool([
      {
        invoice_number: 'INV-3',
        customer_email: 'c@example.com',
        status: 'sent',
        total: '5',
        currency: 'EUR',
        due_date: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]);
    const source = createPostgresOverdueInvoiceSource(pool, {
      appBaseUrl: 'https://example.test/',
    });

    const [invoice] = await source(new Date('2026-03-15T00:00:00.000Z'));
    expect(invoice.merchantId).toBe(DEFAULT_MERCHANT_ID);
    expect(invoice.invoiceUrl).toBe('https://example.test/invoices/INV-3');
  });
});

// ─── Invoice list source ──────────────────────────────────────────────────────

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv_1',
    invoiceNumber: 'INV-1',
    customerName: 'Dana Lee',
    customerEmail: 'dana@example.com',
    total: 49.5,
    currency: 'USD',
    dueDate: new Date('2026-03-01T00:00:00.000Z'),
    status: 'sent',
    createdAt: new Date('2026-02-20T00:00:00.000Z'),
    updatedAt: new Date('2026-02-20T00:00:00.000Z'),
    ...overrides,
  } as Invoice;
}

describe('createInvoiceListSource', () => {
  const NOW = new Date('2026-03-15T00:00:00.000Z');

  it('keeps only past-due invoices and maps them', async () => {
    const source = createInvoiceListSource({
      merchantId: 'merch_1',
      getInvoices: () => [
        makeInvoice(),
        makeInvoice({ id: 'inv_2', invoiceNumber: 'INV-2', dueDate: new Date('2026-03-20T00:00:00.000Z') }),
      ],
    });

    const invoices = await source(NOW);

    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      id: 'inv_1',
      invoiceNumber: 'INV-1',
      merchantId: 'merch_1',
      customerEmail: 'dana@example.com',
      amount: 49.5,
      currency: 'USD',
      dueDate: '2026-03-01T00:00:00.000Z',
      status: 'sent',
      invoiceUrl: 'https://app.subtrackr.io/invoices/inv_1',
    });
  });

  it('prefers tenantId over the fallback merchant', async () => {
    const source = createInvoiceListSource({
      merchantId: 'fallback',
      getInvoices: () => [makeInvoice({ tenantId: 'tenant_9' } as Partial<Invoice>)],
    });

    const [invoice] = await source(NOW);
    expect(invoice.merchantId).toBe('tenant_9');
  });

  it('sorts most recently due first and honours the limit', async () => {
    const source = createInvoiceListSource({
      merchantId: 'merch_1',
      limit: 2,
      getInvoices: () => [
        makeInvoice({ id: 'a', dueDate: new Date('2026-03-10T00:00:00.000Z') }),
        makeInvoice({ id: 'b', dueDate: new Date('2026-03-01T00:00:00.000Z') }),
        makeInvoice({ id: 'c', dueDate: new Date('2026-03-12T00:00:00.000Z') }),
      ],
    });

    const invoices = await source(NOW);
    expect(invoices.map((i) => i.id)).toEqual(['c', 'a']);
  });

  it('skips invoices without a parseable due date and accepts a sync getter', async () => {
    const source = createInvoiceListSource({
      merchantId: 'merch_1',
      getInvoices: () => [makeInvoice({ dueDate: undefined as unknown as Date })],
    });

    expect(await source(NOW)).toHaveLength(0);
  });
});
