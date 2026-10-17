/**
 * invoiceTotals.ts
 *
 * Single source of truth for turning line items into an invoice total.
 *
 * `createInvoice` and `updateInvoice` previously each rolled their own
 * arithmetic, and they did not agree: `createInvoice` subtracted the
 * discount, `updateInvoice` did not. Editing one line on a discounted
 * invoice therefore silently increased the amount payable, and because the
 * discount was never persisted on the record there was nothing left to
 * subtract on the second pass.
 */

/** Rounds to `decimals` places using half-up, avoiding binary float drift. */
export function roundMoney(amount: number, decimals = 2): number {
  if (!Number.isFinite(amount)) return 0;

  const factor = 10 ** decimals;
  // The epsilon nudge keeps values such as 1.005 from rounding down because
  // their binary representation is fractionally below the decimal value.
  // The trailing `+ 0` normalises -0 to 0 so callers never see a negative zero.
  return Math.round((amount + Number.EPSILON * Math.sign(amount)) * factor) / factor + 0;
}

export interface LineTotalSource {
  lineTotal?: number;
  amount?: number;
  unitPrice?: number;
  quantity?: number;
}

/**
 * Resolves a single line's total, tolerating both the itemised (`lineTotal`)
 * and flat (`amount`) shapes.
 */
export function resolveLineTotal(item: LineTotalSource): number {
  const derived = item.quantity !== undefined ? (item.unitPrice ?? 0) * item.quantity : undefined;
  const candidates = [item.lineTotal, item.amount, derived];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return 0;
}

export interface InvoiceTotalsInput {
  lineItems?: LineTotalSource[];
  /** Used when the invoice has no line items. */
  amount?: number;
  tax?: number;
  discount?: number;
  currencyDecimals?: number;
}

export interface InvoiceTotals {
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
}

/**
 * Computes invoice totals with every component rounded to minor units and a
 * non-negative payable amount.
 *
 * The clamp matters: a discount larger than the subtotal otherwise produces a
 * negative tax base and a negative total, which downstream code then treats as
 * a credit owed to the customer rather than an over-discounted invoice.
 */
export function calculateInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const decimals = input.currencyDecimals ?? 2;

  const hasLineItems = (input.lineItems?.length ?? 0) > 0;
  const rawSubtotal = hasLineItems
    ? (input.lineItems ?? []).reduce((sum, item) => sum + resolveLineTotal(item), 0)
    : (input.amount ?? 0);

  const subtotal = roundMoney(rawSubtotal, decimals);
  const tax = roundMoney(input.tax ?? 0, decimals);

  // A discount may not exceed what is being discounted.
  const requestedDiscount = roundMoney(input.discount ?? 0, decimals);
  const discount = roundMoney(Math.min(Math.max(requestedDiscount, 0), subtotal), decimals);

  const total = roundMoney(Math.max(subtotal + tax - discount, 0), decimals);

  return { subtotal, tax, discount, total };
}
