/**
 * Tests for decimalAmount — exact fixed-point comparison for crypto amounts.
 *
 * @see src/utils/decimalAmount.ts
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1683
 */

import { compareDecimalAmounts, exceedsLimit, normalizeDecimal } from '../decimalAmount';

describe('normalizeDecimal', () => {
  it('splits a decimal string into sign, digits and scale', () => {
    expect(normalizeDecimal('12.5')).toEqual({ negative: false, digits: '125', scale: 1 });
    expect(normalizeDecimal('120')).toEqual({ negative: false, digits: '120', scale: 0 });
  });

  it('strips leading zeros without changing the value', () => {
    expect(normalizeDecimal('00.5')).toEqual({ negative: false, digits: '5', scale: 1 });
    expect(normalizeDecimal('0007')).toEqual({ negative: false, digits: '7', scale: 0 });
  });

  it('accepts a leading decimal point', () => {
    expect(normalizeDecimal('.5')).toEqual({ negative: false, digits: '5', scale: 1 });
  });

  it('normalises negative zero to zero', () => {
    expect(normalizeDecimal('-0')?.negative).toBe(false);
    expect(normalizeDecimal('-0.00')?.negative).toBe(false);
  });

  it('preserves the sign for non-zero values', () => {
    expect(normalizeDecimal('-5')?.negative).toBe(true);
    expect(normalizeDecimal('-0.01')?.negative).toBe(true);
  });

  it('accepts finite numbers', () => {
    expect(normalizeDecimal(1.5)).toEqual({ negative: false, digits: '15', scale: 1 });
  });

  it('rejects anything that is not a finite decimal', () => {
    expect(normalizeDecimal('')).toBeNull();
    expect(normalizeDecimal('   ')).toBeNull();
    expect(normalizeDecimal('abc')).toBeNull();
    expect(normalizeDecimal('.')).toBeNull();
    expect(normalizeDecimal('-')).toBeNull();
    expect(normalizeDecimal('1e18')).toBeNull();
    expect(normalizeDecimal('1,000')).toBeNull();
    expect(normalizeDecimal(null)).toBeNull();
    expect(normalizeDecimal(undefined)).toBeNull();
    expect(normalizeDecimal(Number.NaN)).toBeNull();
    expect(normalizeDecimal(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('compareDecimalAmounts', () => {
  it('compares equal values written at different scales', () => {
    expect(compareDecimalAmounts('0.1', '0.10')).toBe(0);
    expect(compareDecimalAmounts('5', '5.000')).toBe(0);
    expect(compareDecimalAmounts('1.0', '1')).toBe(0);
  });

  it('orders fractional amounts correctly', () => {
    expect(compareDecimalAmounts('12.5', '10')).toBe(1);
    expect(compareDecimalAmounts('10', '12.5')).toBe(-1);
    expect(compareDecimalAmounts('1.005', '1.004')).toBe(1);
    expect(compareDecimalAmounts('1.004', '1.005')).toBe(-1);
  });

  it('does not lose precision on values that float maths gets wrong', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    expect(compareDecimalAmounts('0.3', '0.1')).toBe(1);
    expect(compareDecimalAmounts('0.3', '0.2')).toBe(1);
    expect(compareDecimalAmounts('0.30000000000000004', '0.3')).toBe(1);
  });

  it('handles negatives', () => {
    expect(compareDecimalAmounts('-5', '3')).toBe(-1);
    expect(compareDecimalAmounts('3', '-5')).toBe(1);
    expect(compareDecimalAmounts('-5', '-3')).toBe(-1);
    expect(compareDecimalAmounts('-0.5', '-0.5')).toBe(0);
  });

  it('orders values of differing digit length', () => {
    expect(compareDecimalAmounts('100', '99.99')).toBe(1);
    expect(compareDecimalAmounts('0.001', '0.0009')).toBe(1);
  });

  it('throws on non-decimal input rather than guessing', () => {
    expect(() => compareDecimalAmounts('abc', '1')).toThrow(/non-decimal/);
    expect(() => compareDecimalAmounts('1', undefined)).toThrow(/non-decimal/);
  });
});

describe('exceedsLimit', () => {
  it('is true only when the amount is strictly greater than the limit', () => {
    expect(exceedsLimit('12.5', '10')).toBe(true);
    expect(exceedsLimit('10', '10')).toBe(false);
    expect(exceedsLimit('9.99', '10')).toBe(false);
  });

  it('works on fractional limits, which BigNumber.from would reject', () => {
    // `ethers.BigNumber.from('0.1')` throws; this path must not.
    expect(() => exceedsLimit('0.2', '0.1')).not.toThrow();
    expect(exceedsLimit('0.2', '0.1')).toBe(true);
    expect(exceedsLimit('0.1', '0.1')).toBe(false);
  });
});
