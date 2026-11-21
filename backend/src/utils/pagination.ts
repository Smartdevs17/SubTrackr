/**
 * Deterministic keyset (cursor) pagination helpers (Issue #2079).
 *
 * Heavy admin lists must not use OFFSET: Postgres still walks every skipped
 * row, and concurrent writes can duplicate or omit items between pages. This
 * module paginates on the stable composite key `(created_at, id)` instead.
 *
 * Cursors are opaque v1 base64url tokens. Both encode and decode validate the
 * payload so a tampered cursor can never reach the database as SQL.
 */

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;
const CURSOR_PREFIX = 'v1.';

export type PageDirection = 'forward' | 'backward';
export type PaginationErrorCode = 'INVALID_CURSOR' | 'INVALID_PAGINATION' | 'INVALID_PAGE_DATA';

export interface KeysetCursor {
  /** ISO-8601 timestamp of the row. */
  createdAt: string;
  /** Stable tie-breaker for rows sharing a timestamp. */
  id: string;
}

export interface PageRequest {
  cursor: KeysetCursor | null;
  limit: number;
  direction: PageDirection;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export interface KeysetPage<T> {
  items: T[];
  pageInfo: PageInfo;
  nextCursor: string | null;
  prevCursor: string | null;
}

export interface PaginationOptions<T> {
  /** Extract the timestamp from a row. Defaults to `createdAt` / `created_at`. */
  getCreatedAt?: (row: T) => unknown;
  /** Extract the stable id from a row. Defaults to `id`. */
  getId?: (row: T) => unknown;
  /** Called for malformed query input or page data (for metrics/logging). */
  onValidationError?: (error: PaginationError) => void;
}

export interface KeysetClause {
  /** Parameterised predicate; empty when no cursor was supplied. */
  whereSql: string;
  orderSql: string;
  limitPlaceholder: string;
  params: Array<string | number>;
}

/** Validation failure with a stable machine-readable code. */
export class PaginationError extends Error {
  readonly code: PaginationErrorCode;

  constructor(code: PaginationErrorCode, message: string) {
    super(message);
    this.name = 'PaginationError';
    this.code = code;
  }
}

// ── Cursor codec ─────────────────────────────────────────────────────────────

function normalizeCursor(cursor: KeysetCursor): KeysetCursor {
  const timestamp = typeof cursor?.createdAt === 'string' ? Date.parse(cursor.createdAt) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    throw new PaginationError('INVALID_CURSOR', 'Cursor created_at must be an ISO-8601 timestamp');
  }
  if (typeof cursor?.id !== 'string' || cursor.id.length === 0 || cursor.id.length > 256) {
    throw new PaginationError('INVALID_CURSOR', 'Cursor id must be a non-empty string (max 256 chars)');
  }
  return { createdAt: new Date(timestamp).toISOString(), id: cursor.id };
}

/** Encode a `(created_at, id)` key as an opaque, URL-safe cursor. */
export function encodeCursor(cursor: KeysetCursor): string {
  const normalized = normalizeCursor(cursor);
  const payload = Buffer.from(JSON.stringify([normalized.createdAt, normalized.id]), 'utf8').toString(
    'base64url',
  );
  return `${CURSOR_PREFIX}${payload}`;
}

/** Decode and validate a cursor. Throws `PaginationError` on any bad input. */
export function decodeCursor(raw: string): KeysetCursor {
  if (typeof raw !== 'string' || !raw.startsWith(CURSOR_PREFIX)) {
    throw new PaginationError('INVALID_CURSOR', 'Unrecognised cursor format');
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'),
    );
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      throw new Error('cursor must contain exactly two values');
    }
    return normalizeCursor({ createdAt: parsed[0] as string, id: parsed[1] as string });
  } catch (error) {
    if (error instanceof PaginationError) throw error;
    throw new PaginationError('INVALID_CURSOR', 'Cursor could not be decoded');
  }
}

// ── Request parsing ──────────────────────────────────────────────────────────

export type QueryLike = Record<string, unknown>;

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parseLimit(value: unknown, onValidationError?: (error: PaginationError) => void): number {
  if (value === undefined || value === null || value === '') return DEFAULT_PAGE_LIMIT;
  const parsed = Number.parseInt(String(firstValue(value)), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const error = new PaginationError('INVALID_PAGINATION', 'limit must be a positive integer');
    onValidationError?.(error);
    return DEFAULT_PAGE_LIMIT;
  }
  return Math.min(parsed, MAX_PAGE_LIMIT);
}

/**
 * Parse a HTTP-style query object into a validated keyset page request.
 * `after` implies forward paging and `before` implies backward paging; an
 * explicit `direction` wins when supplied.
 */
export function parsePageRequest<T = unknown>(
  query: QueryLike = {},
  options: PaginationOptions<T> = {},
): PageRequest {
  const rawCursor = firstValue(query.cursor ?? query.after ?? query.before);
  const inferredDirection: PageDirection = query.before !== undefined && query.cursor === undefined ? 'backward' : 'forward';
  const rawDirection = firstValue(query.direction);
  let direction = inferredDirection;

  if (rawDirection !== undefined && rawDirection !== '') {
    if (rawDirection === 'forward' || rawDirection === 'backward') {
      direction = rawDirection;
    } else {
      const error = new PaginationError('INVALID_PAGINATION', 'direction must be forward or backward');
      options.onValidationError?.(error);
      throw error;
    }
  }

  let cursor: KeysetCursor | null = null;
  if (rawCursor !== undefined && rawCursor !== null && String(rawCursor).trim() !== '') {
    try {
      cursor = decodeCursor(String(rawCursor));
    } catch (error) {
      const paginationError =
        error instanceof PaginationError
          ? error
          : new PaginationError('INVALID_CURSOR', 'Cursor could not be decoded');
      options.onValidationError?.(paginationError);
      throw paginationError;
    }
  }

  return { cursor, direction, limit: parseLimit(query.limit, options.onValidationError) };
}

// ── SQL generation ───────────────────────────────────────────────────────────

/**
 * Build a parameterised keyset clause. Identifiers are fixed (never client
 * supplied), so the only dynamic values are bound parameters.
 */
export function buildKeysetClause(request: PageRequest): KeysetClause {
  if (!request.cursor) {
    return {
      whereSql: '',
      orderSql: 'ORDER BY created_at DESC, id DESC',
      limitPlaceholder: '$1',
      params: [request.limit],
    };
  }

  const comparison = request.direction === 'forward' ? '<' : '>';
  const orderSql =
    request.direction === 'forward'
      ? 'ORDER BY created_at DESC, id DESC'
      : 'ORDER BY created_at ASC, id ASC';

  return {
    whereSql: `(created_at ${comparison} $1 OR (created_at = $1 AND id ${comparison} $2))`,
    orderSql,
    limitPlaceholder: '$3',
    params: [request.cursor.createdAt, request.cursor.id, request.limit],
  };
}

// ── Row helpers and page assembly ────────────────────────────────────────────

function extractKey<T>(row: T, options: PaginationOptions<T>): KeysetCursor {
  const record = row as Record<string, unknown>;
  const createdAt = options.getCreatedAt ? options.getCreatedAt(row) : record?.createdAt ?? record?.created_at;
  const id = options.getId ? options.getId(row) : record?.id;

  try {
    return normalizeCursor({ createdAt: createdAt as string, id: id as string });
  } catch (error) {
    const paginationError =
      error instanceof PaginationError
        ? new PaginationError('INVALID_PAGE_DATA', error.message)
        : new PaginationError('INVALID_PAGE_DATA', 'Row is missing a valid created_at/id key');
    options.onValidationError?.(paginationError);
    throw paginationError;
  }
}

/** Compare keys descending by `(created_at, id)`. */
function compareKeys(a: KeysetCursor, b: KeysetCursor): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

/**
 * Assemble a page from rows already fetched in query order. Fetch `limit + 1`
 * rows so `hasNextPage`/`hasPreviousPage` can be derived without a COUNT query.
 */
export function createKeysetPage<T>(
  rows: readonly T[],
  request: PageRequest,
  options: PaginationOptions<T> = {},
): KeysetPage<T> {
  const hasMore = rows.length > request.limit;
  const queryRows = rows.slice(0, request.limit);
  // Backward queries run ASC to find the nearest older boundary; present every
  // page to the client in the same newest-first order.
  const items = request.direction === 'backward' ? [...queryRows].reverse() : queryRows;

  const startCursor = items.length > 0 ? encodeCursor(extractKey(items[0], options)) : null;
  const endCursor = items.length > 0 ? encodeCursor(extractKey(items[items.length - 1], options)) : null;
  const hasNextPage = request.direction === 'forward' ? hasMore : request.cursor !== null;
  const hasPreviousPage = request.direction === 'forward' ? request.cursor !== null : hasMore;

  return {
    items,
    pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
    nextCursor: hasNextPage ? endCursor : null,
    prevCursor: hasPreviousPage ? startCursor : null,
  };
}

/** In-memory keyset paging for tests, caches and small admin datasets. */
export function paginateRows<T>(
  rows: readonly T[],
  request: PageRequest,
  options: PaginationOptions<T> = {},
): KeysetPage<T> {
  const sorted = [...rows].sort((a, b) => compareKeys(extractKey(a, options), extractKey(b, options)));
  let candidates = sorted;

  if (request.cursor) {
    // compareKeys is a DESC sort comparator: positive means "older than".
    candidates =
      request.direction === 'forward'
        ? sorted.filter((row) => compareKeys(extractKey(row, options), request.cursor as KeysetCursor) > 0)
        : sorted.filter((row) => compareKeys(extractKey(row, options), request.cursor as KeysetCursor) < 0);
  }

  const fetchCount = request.limit + 1;
  const queryRows =
    request.direction === 'backward'
      ? candidates.slice(-fetchCount).reverse()
      : candidates.slice(0, fetchCount);

  return createKeysetPage(queryRows, request, options);
}
