/**
 * Overdue invoice sources (#1737)
 *
 * Adapters that feed `OverdueInvoiceReminderService.runDue()`:
 *
 *  - `createPostgresOverdueInvoiceSource` — reads the `invoices` table used by
 *    `invoiceController`, returning every row whose due date has passed.
 *    Recently settled rows are kept for a grace window so an invoice that was
 *    just paid still shows up once and stops its reminders explicitly.
 *  - `createInvoiceListSource` — maps an in-process invoice list (the Zustand
 *    `invoiceStore` shape) into the same contract.
 */

import type { Pool } from '../../shared/db/connectionPool';
import type { Invoice } from '../../../src/types/invoice';
import type {
  OverdueInvoice,
  OverdueInvoiceSource,
} from './overdueInvoiceReminderService';

export const SETTLED_INVOICE_STATUSES = [
  'paid',
  'settled',
  'payment_received',
  'void',
  'voided',
  'cancelled',
  'canceled',
  'refunded',
];

export const DEFAULT_MERCHANT_ID = 'default';
export const DEFAULT_INVOICE_SOURCE_LIMIT = 500;
export const DEFAULT_SETTLED_LOOKBACK_DAYS = 7;

const SETTLED_SQL_LIST = SETTLED_INVOICE_STATUSES.map((s) => `'${s}'`).join(', ');

const OVERDUE_INVOICES_SQL = `
  SELECT invoice_number, customer_name, customer_email, status, total, currency,
         due_date, subscription_id
  FROM invoices
  WHERE due_date IS NOT NULL
    AND due_date < $1::timestamptz
    AND (
      LOWER(COALESCE(status, '')) NOT IN (${SETTLED_SQL_LIST})
      OR COALESCE(updated_at, created_at) >= $1::timestamptz - INTERVAL '1 day' * $3::int
    )
  ORDER BY due_date DESC
  LIMIT $2`;

export interface PostgresOverdueInvoiceSourceOptions {
  /** Merchant every invoice is filed under until the table carries a tenant column. */
  merchantId?: string;
  limit?: number;
  /** Days a settled invoice keeps appearing so its reminders stop explicitly. */
  settledLookbackDays?: number;
  appBaseUrl?: string;
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function createPostgresOverdueInvoiceSource(
  pool: Pool,
  options: PostgresOverdueInvoiceSourceOptions = {}
): OverdueInvoiceSource {
  const merchantId = options.merchantId ?? DEFAULT_MERCHANT_ID;
  const limit = options.limit ?? DEFAULT_INVOICE_SOURCE_LIMIT;
  const lookbackDays = options.settledLookbackDays ?? DEFAULT_SETTLED_LOOKBACK_DAYS;
  const appBaseUrl = (options.appBaseUrl ?? 'https://app.subtrackr.io').replace(/\/+$/, '');

  return async (now: Date): Promise<OverdueInvoice[]> => {
    const result = await pool.query(OVERDUE_INVOICES_SQL, [now.toISOString(), limit, lookbackDays]);
    const invoices: OverdueInvoice[] = [];
    for (const row of result.rows as Array<Record<string, unknown>>) {
      const dueDate = toIso(row['due_date']);
      if (!dueDate) continue;
      const invoiceNumber = String(row['invoice_number'] ?? '').trim();
      if (!invoiceNumber) continue;
      const subscriptionId = row['subscription_id'] ? String(row['subscription_id']) : undefined;
      invoices.push({
        id: invoiceNumber,
        invoiceNumber,
        merchantId,
        customerName: row['customer_name'] ? String(row['customer_name']) : undefined,
        customerEmail: String(row['customer_email'] ?? ''),
        subscriptionName: subscriptionId,
        amount: Number.parseFloat(String(row['total'] ?? '0')) || 0,
        currency: String(row['currency'] ?? 'USD'),
        dueDate,
        status: String(row['status'] ?? ''),
        invoiceUrl: `${appBaseUrl}/invoices/${encodeURIComponent(invoiceNumber)}`,
      });
    }
    return invoices;
  };
}

export interface InvoiceListSourceOptions {
  merchantId?: string;
  limit?: number;
  appBaseUrl?: string;
  getInvoices: () => Invoice[] | Promise<Invoice[]>;
}

export function createInvoiceListSource(
  options: InvoiceListSourceOptions
): OverdueInvoiceSource {
  const fallbackMerchantId = options.merchantId ?? DEFAULT_MERCHANT_ID;
  const limit = options.limit ?? DEFAULT_INVOICE_SOURCE_LIMIT;
  const appBaseUrl = (options.appBaseUrl ?? 'https://app.subtrackr.io').replace(/\/+$/, '');

  return async (now: Date): Promise<OverdueInvoice[]> => {
    const invoices = await options.getInvoices();
    const pastDue: OverdueInvoice[] = [];
    for (const invoice of invoices) {
      const dueDate = toIso(invoice.dueDate);
      if (!dueDate || new Date(dueDate) >= now) continue;
      pastDue.push({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        merchantId: invoice.tenantId ?? fallbackMerchantId,
        customerName: invoice.customerName,
        customerEmail: invoice.customerEmail ?? invoice.recipientEmail ?? '',
        subscriptionName: invoice.subscriptionName,
        amount: Number(invoice.total) || 0,
        currency: invoice.currency,
        dueDate,
        status: String(invoice.status ?? ''),
        invoiceUrl: `${appBaseUrl}/invoices/${encodeURIComponent(invoice.id)}`,
      });
    }
    pastDue.sort((a, b) => {
      if (a.dueDate === b.dueDate) return 0;
      return a.dueDate < b.dueDate ? 1 : -1;
    });
    return pastDue.slice(0, limit);
  };
}
