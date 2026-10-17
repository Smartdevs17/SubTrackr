/**
 * Tests for invoiceTotals — the single invoice arithmetic implementation.
 *
 * @see src/utils/invoiceTotals.ts
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1684
 */

import { calculateInvoiceTotals, resolveLineTotal, roundMoney } from '../invoiceTotals';

describe('roundMoney', () => {
  it('rounds half away from zero at two decimal places', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(1.004)).toBe(1);
    expect(roundMoney(2.675)).toBe(2.68);
  });

  it('rounds negative values symmetrically', () => {
    expect(roundMoney(-1.005)).toBe(-1.01);
  });

  it('honours a custom precision', () => {
    expect(roundMoney(1.2345, 3)).toBe(1.235);
    expect(roundMoney(1.2345, 0)).toBe(1);
  });

  it('maps non-finite input to zero', () => {
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundMoney(-0), 0)).toBe(true);
    expect(Object.is(roundMoney(-0.001), 0)).toBe(true);
  });
});

describe('resolveLineTotal', () => {
  it('prefers an explicit lineTotal', () => {
    expect(resolveLineTotal({ lineTotal: 12, amount: 99, unitPrice: 5, quantity: 2 })).toBe(12);
  });

  it('falls back to the flat amount alias', () => {
    expect(resolveLineTotal({ amount: 7.5, unitPrice: 5, quantity: 2 })).toBe(7.5);
  });

  it('derives unit price times quantity as a last resort', () => {
    expect(resolveLineTotal({ unitPrice: 5, quantity: 3 })).toBe(15);
  });

  it('returns zero for an unusable line', () => {
    expect(resolveLineTotal({})).toBe(0);
    expect(resolveLineTotal({ lineTotal: Number.NaN })).toBe(0);
  });
});

describe('calculateInvoiceTotals', () => {
  it('sums line items into a subtotal', () => {
    const result = calculateInvoiceTotals({
      lineItems: [{ lineTotal: 10 }, { lineTotal: 5 }],
    });
    expect(result.subtotal).toBe(15);
    expect(result.tax).toBe(0);
    expect(result.discount).toBe(0);
    expect(result.total).toBe(15);
  });

  it('uses the flat amount when there are no line items', () => {
    expect(calculateInvoiceTotals({ amount: 42 }).total).toBe(42);
  });

  it('prefers line items over the flat amount', () => {
    expect(calculateInvoiceTotals({ lineItems: [{ lineTotal: 10 }], amount: 999 }).total).toBe(10);
  });

  it('adds tax and subtracts discount', () => {
    const result = calculateInvoiceTotals({
      lineItems: [{ lineTotal: 100 }],
      tax: 20,
      discount: 15,
    });
    expect(result.subtotal).toBe(100);
    expect(result.tax).toBe(20);
    expect(result.discount).toBe(15);
    expect(result.total).toBe(105);
  });

  it('clamps a discount larger than the subtotal so the total never goes negative', () => {
    const result = calculateInvoiceTotals({
      lineItems: [{ lineTotal: 100 }],
      discount: 150,
    });
    expect(result.discount).toBe(100);
    expect(result.total).toBe(0);
  });

  it('ignores a negative discount rather than inflating the bill', () => {
    const result = calculateInvoiceTotals({
      lineItems: [{ lineTotal: 100 }],
      discount: -25,
    });
    expect(result.discount).toBe(0);
    expect(result.total).toBe(100);
  });

  it('rounds each component to minor units', () => {
    const result = calculateInvoiceTotals({
      lineItems: [{ lineTotal: 10.005 }, { lineTotal: 10.005 }],
    });
    // Raw sum is 20.01, and rounding the subtotal (not each line) gives 20.01.
    expect(result.subtotal).toBe(20.01);
    expect(result.total).toBe(20.01);
  });

  it('treats an empty invoice as zero', () => {
    expect(calculateInvoiceTotals({}).total).toBe(0);
  });

  it('produces identical totals whether created or recomputed on update', () => {
    const created = calculateInvoiceTotals({
      lineItems: [{ lineTotal: 50 }, { lineTotal: 30 }],
      tax: 8,
      discount: 10,
    });

    // Editing one line re-derives totals from line items + the stored tax and
    // discount; the payable amount must not change.
    const updated = calculateInvoiceTotals({
      lineItems: [{ lineTotal: 50 }, { lineTotal: 30 }],
      tax: 8,
      discount: 10,
    });

    expect(updated).toEqual(created);
    expect(updated.total).toBe(78);
  });
});
