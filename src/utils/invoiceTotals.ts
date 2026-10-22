/**
 * invoiceTotals.ts
 *
 * Line-item helpers shared by the invoice renderers.
 *
 * The full totals module — half-up rounding, discount clamping and the single
 * arithmetic path used by `createInvoice` / `updateInvoice` — is introduced
 * with the billing-correctness work. Only the two helpers the rendering layer
 * depends on are defined here for now.
 */

export interface LineTotalSource {
  kind?: string;
  lineTotal?: number;
  amount?: number;
  unitPrice?: number;
  quantity?: number;
}

/**
 * A discount line item is itemised rather than folded into the subtotal. Any
 * other `kind` (including `undefined` and legacy records) is a chargeable line.
 */
export function isDiscountLineItem(item: { kind?: string }): boolean {
  return item.kind === 'discount';
}

/**
 * Resolves a single line's total, tolerating both the itemised (`lineTotal`)
 * and the flat (`amount`) shapes.
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
