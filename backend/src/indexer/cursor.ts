/**
 * Opaque cursor helpers for Soroban event scans (Issue #2086).
 *
 * Soroban paging tokens are `ledger-sequence` pairs. We normalise them to a
 * fixed-width, zero-padded representation so lexicographic ordering matches
 * numeric ordering and a cursor can be compared without `BigInt` (the backend
 * targets ES2017). Unknown token formats fall back to plain string ordering,
 * which is still stable for a given RPC implementation.
 */

export interface DecodedCursor {
  ledger: number;
  sequence: string;
}

const LEDGER_WIDTH = 12;
const SEQUENCE_WIDTH = 24;

const DECIMAL = /^\d+$/;

/** Build a sortable, opaque paging token from a ledger and event sequence. */
export function encodeCursor(ledger: number, sequence: number | string): string {
  const safeLedger = Math.max(0, Math.trunc(Number(ledger) || 0));
  return `${String(safeLedger).padStart(LEDGER_WIDTH, '0')}-${String(sequence).padStart(SEQUENCE_WIDTH, '0')}`;
}

/** Parse a cursor produced by {@link encodeCursor}; returns null when malformed. */
export function decodeCursor(cursor: string | null | undefined): DecodedCursor | null {
  if (typeof cursor !== 'string') return null;
  const separator = cursor.indexOf('-');
  if (separator <= 0) return null;

  const ledgerPart = cursor.slice(0, separator);
  const sequencePart = cursor.slice(separator + 1);
  if (!DECIMAL.test(ledgerPart) || !DECIMAL.test(sequencePart)) return null;

  const ledger = Number(ledgerPart);
  if (!Number.isSafeInteger(ledger)) return null;

  return { ledger, sequence: sequencePart.replace(/^0+(?=\d)/, '') };
}

/** True when the token can be decoded by {@link decodeCursor}. */
export function isValidCursor(cursor: string | null | undefined): boolean {
  return decodeCursor(cursor) !== null;
}

function normalise(cursor: string): string {
  const decoded = decodeCursor(cursor);
  if (!decoded) return cursor;
  return encodeCursor(decoded.ledger, decoded.sequence);
}

/**
 * Compare two cursors: -1 when `a` precedes `b`, 1 when it follows, 0 when
 * equal. Sorting by this function advances from the chain's past to its tip.
 */
export function compareCursors(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;

  const left = normalise(a);
  const right = normalise(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Ledger encoded in a cursor, or `null` for an unknown / absent token. */
export function cursorLedger(cursor: string | null | undefined): number | null {
  return decodeCursor(cursor)?.ledger ?? null;
}
