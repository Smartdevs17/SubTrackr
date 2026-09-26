/**
 * Cursor-Based Pagination + Field Selection — SubTrackr
 *
 * Provides:
 *  - Opaque, tamper-evident cursor encoding (base64url JSON)
 *  - Type-safe page builders for any ordered result set
 *  - Field selection: clients pass `?fields=id,name,status` to trim payloads
 *  - Integration with the existing ApiResponse / PaginationMeta envelope
 */

import { createHmac } from 'node:crypto';

// ─── Cursor Encoding ──────────────────────────────────────────────────────────

const CURSOR_SECRET = process.env['CURSOR_HMAC_SECRET'] ?? 'subtrackr-cursor-secret';
const CURSOR_VERSION = 1;

export interface CursorPayload {
  v: number;
  field: string;
  value: unknown;
  id: string;
  dir: 'asc' | 'desc';
}

function sign(data: string): string {
  return createHmac('sha256', CURSOR_SECRET).update(data).digest('base64url').slice(0, 16);
}

/** Encode a cursor payload into an opaque base64url string. */
export function encodeCursor(payload: Omit<CursorPayload, 'v'>): string {
  const full: CursorPayload = { v: CURSOR_VERSION, ...payload };
  const json = JSON.stringify(full);
  const sig = sign(json);
  return Buffer.from(`${json}|${sig}`, 'utf8').toString('base64url');
}

/** Decode and verify a cursor. Returns null when invalid or tampered. */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sepIdx = raw.lastIndexOf('|');
    if (sepIdx === -1) return null;
    const json = raw.slice(0, sepIdx);
    const sig = raw.slice(sepIdx + 1);
    if (sign(json) !== sig) return null;
    const payload = JSON.parse(json) as CursorPayload;
    if (payload.v !== CURSOR_VERSION) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Page Builder ─────────────────────────────────────────────────────────────

export interface PageOptions {
  /** Opaque cursor from the previous page response. Absent on first page. */
  cursor?: string;
  /** Max records to return. Clamped to [1, maxLimit]. Default: 20 */
  limit?: number;
  /** Hard cap on limit. Default: 100 */
  maxLimit?: number;
  /** Sort direction. Default: 'asc' */
  direction?: 'asc' | 'desc';
  /** Which field the cursor tracks. Default: 'id' */
  sortField?: string;
}

export interface PageResult<T> {
  items: T[];
  /** Opaque cursor pointing to the next page. Absent on last page. */
  nextCursor?: string;
  /** Whether more records exist. */
  hasMore: boolean;
  /** Total matching records (optional — may be omitted for performance). */
  total?: number;
}

export interface SqlCursorClause {
  /** WHERE clause fragment to add (e.g. `"id" > $1`) */
  where: string;
  /** Bind parameter value */
  param: unknown;
  /** ORDER BY clause (e.g. `"id" ASC`) */
  orderBy: string;
  /** LIMIT value */
  limit: number;
}

/**
 * Parse pagination options and produce a SQL cursor WHERE clause.
 *
 * @example
 * const { where, param, orderBy, limit } = buildCursorClause({ cursor, limit: 20 });
 * const sql = `SELECT * FROM subscriptions ${where ? `WHERE ${where}` : ''} ORDER BY ${orderBy} LIMIT ${limit + 1}`;
 */
export function buildCursorClause(options: PageOptions = {}): SqlCursorClause {
  const dir = options.direction ?? 'asc';
  const sortField = options.sortField ?? 'id';
  const rawLimit = options.limit ?? 20;
  const limit = Math.min(Math.max(1, rawLimit), options.maxLimit ?? 100);
  const op = dir === 'asc' ? '>' : '<';
  const orderDir = dir.toUpperCase();

  if (!options.cursor) {
    return {
      where: '',
      param: null,
      orderBy: `"${sortField}" ${orderDir}`,
      limit,
    };
  }

  const decoded = decodeCursor(options.cursor);
  if (!decoded) {
    return { where: '', param: null, orderBy: `"${sortField}" ${orderDir}`, limit };
  }

  return {
    where: `("${decoded.field}", id) ${op} ($1, $2)`,
    param: decoded.value,
    orderBy: `"${decoded.field}" ${orderDir}, id ${orderDir}`,
    limit,
  };
}

/**
 * Build a PageResult from a raw DB row set.
 *
 * Fetches `limit + 1` rows; the extra row signals `hasMore`.
 *
 * @example
 * const rows = await pool.query(`SELECT * FROM subscriptions ... LIMIT ${limit + 1}`);
 * return buildPage(rows, limit, (row) => row.createdAt, (row) => row.id);
 */
export function buildPage<T extends Record<string, unknown>>(
  rows: T[],
  limit: number,
  getCursorValue: (row: T) => unknown,
  getId: (row: T) => string,
  direction: 'asc' | 'desc' = 'asc',
  sortField = 'id',
  total?: number,
): PageResult<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];

  let nextCursor: string | undefined;
  if (hasMore && lastItem) {
    nextCursor = encodeCursor({
      field: sortField,
      value: getCursorValue(lastItem),
      id: getId(lastItem),
      dir: direction,
    });
  }

  return { items, nextCursor, hasMore, total };
}

// ─── Field Selection ──────────────────────────────────────────────────────────

/**
 * Parse a `?fields=id,name,status` query parameter into a set of allowed keys.
 * Returns null when the parameter is absent (return all fields).
 */
export function parseFieldSelection(fieldsParam: string | undefined): Set<string> | null {
  if (!fieldsParam?.trim()) return null;
  const fields = fieldsParam
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  return fields.length > 0 ? new Set(fields) : null;
}

/**
 * Project a record to only the requested fields.
 * Always includes `id` to ensure response objects are identifiable.
 *
 * @example
 * const slim = selectFields(subscription, parseFieldSelection(req.query.fields));
 */
export function selectFields<T extends Record<string, unknown>>(
  record: T,
  fields: Set<string> | null,
): Partial<T> {
  if (!fields) return record;
  const result: Partial<T> = {};
  // id is always included for linkability
  if ('id' in record) {
    (result as Record<string, unknown>)['id'] = record['id'];
  }
  for (const key of fields) {
    if (key in record) {
      (result as Record<string, unknown>)[key] = record[key];
    }
  }
  return result;
}

/**
 * Apply field selection to an array of records.
 */
export function selectFieldsAll<T extends Record<string, unknown>>(
  records: T[],
  fields: Set<string> | null,
): Partial<T>[] {
  if (!fields) return records;
  return records.map((r) => selectFields(r, fields));
}
