/**
 * decimalAmount.ts
 *
 * Exact comparison for fixed-point decimal amounts expressed as strings.
 *
 * Crypto amounts are user-entered decimals like `"12.5"`. `ethers.BigNumber`
 * only accepts integer base units, so `BigNumber.from("12.5")` throws. That
 * throw used to be swallowed by the surrounding `catch`, which meant *every*
 * fractional amount failed the per-method spend cap and was reported as a
 * generic payment error.
 *
 * Comparing via `parseFloat` instead would reintroduce float error, so the
 * comparison below is done on normalised integer coefficient/exponent pairs.
 */

/** Splits a decimal string into a sign, a digit string and a decimal scale. */
interface NormalizedAmount {
  negative: boolean;
  /** Digits with the decimal point removed. */
  digits: string;
  /** Number of implied decimal places in `digits`. */
  scale: number;
}

const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * Parses a decimal string, or returns `null` when it is not a finite decimal.
 * Rejects exponents (`1e18`), blanks, and anything non-numeric.
 */
export function normalizeDecimal(
  value: string | number | null | undefined
): NormalizedAmount | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    value = value.toString();
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '' || !DECIMAL_PATTERN.test(trimmed)) return null;

  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const dotIndex = unsigned.indexOf('.');

  const whole = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const fraction = dotIndex === -1 ? '' : unsigned.slice(dotIndex + 1);
  const rawDigits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '');

  if (rawDigits === '') return null;

  return {
    negative: negative && !/^0+$/.test(rawDigits) ? true : false,
    digits: rawDigits,
    scale: fraction.length,
  };
}

/**
 * Returns -1, 0 or 1 as `a` is less than, equal to, or greater than `b`.
 *
 * @throws when either side is not a finite decimal string.
 */
export function compareDecimalAmounts(
  a: string | number | null | undefined,
  b: string | number | null | undefined
): number {
  const left = normalizeDecimal(a);
  const right = normalizeDecimal(b);

  if (!left || !right) {
    throw new Error(
      `Cannot compare non-decimal amounts: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
    );
  }

  if (left.negative !== right.negative) {
    return left.negative ? -1 : 1;
  }

  // Align both sides to the same scale so a plain lexicographic compare works.
  const scale = Math.max(left.scale, right.scale);
  const leftAligned = left.digits.padEnd(left.digits.length + (scale - left.scale), '0');
  const rightAligned = right.digits.padEnd(right.digits.length + (scale - right.scale), '0');

  const magnitude = compareDigits(leftAligned, rightAligned);

  return left.negative ? -magnitude : magnitude;
}

function compareDigits(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** True when `amount` exceeds `limit`. Both must be finite decimals. */
export function exceedsLimit(
  amount: string | number | null | undefined,
  limit: string | number | null | undefined
): boolean {
  return compareDecimalAmounts(amount, limit) > 0;
}
