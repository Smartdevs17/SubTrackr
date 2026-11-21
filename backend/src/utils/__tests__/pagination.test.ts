/** Unit tests for deterministic keyset pagination (Issue #2079). */

import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  PaginationError,
  buildKeysetClause,
  createKeysetPage,
  decodeCursor,
  encodeCursor,
  paginateRows,
  parsePageRequest,
  type KeysetCursor,
  type PaginationOptions,
} from '../pagination';

interface Row {
  id: string;
  createdAt: string;
  name?: string;
}

const at = (day: number, hour = 0): string =>
  new Date(Date.UTC(2026, 0, day, hour, 0, 0)).toISOString();

const ROWS: Row[] = [
  { id: 'a', createdAt: at(5), name: 'newest-a' },
  { id: 'b', createdAt: at(5), name: 'newest-b' },
  { id: 'c', createdAt: at(4), name: 'middle' },
  { id: 'd', createdAt: at(3), name: 'old-1' },
  { id: 'e', createdAt: at(2), name: 'old-2' },
  { id: 'f', createdAt: at(1), name: 'oldest' },
];

const cursorFor = (row: Row): KeysetCursor => ({ createdAt: row.createdAt, id: row.id });

describe('keyset cursor codec', () => {
  it('round-trips a key and normalises the timestamp', () => {
    const encoded = encodeCursor({ createdAt: '2026-01-05T00:00:00+00:00', id: 'row-1' });
    expect(encoded.startsWith('v1.')).toBe(true);
    expect(decodeCursor(encoded)).toEqual({ createdAt: at(5), id: 'row-1' });
  });

  it('rejects malformed, non-v1 and tampered cursors', () => {
    const bad = [
      '',
      'offset-20',
      'v2.abcd',
      'v1.not-json',
      encodeCursor({ createdAt: at(5), id: 'x' }).slice(0, -2),
    ];

    for (const value of bad) {
      expect(() => decodeCursor(value)).toThrow(PaginationError);
      try {
        decodeCursor(value);
      } catch (error) {
        expect((error as PaginationError).code).toBe('INVALID_CURSOR');
      }
    }
  });

  it('rejects empty ids and invalid timestamps at encode time', () => {
    expect(() => encodeCursor({ createdAt: at(1), id: '' })).toThrow(PaginationError);
    expect(() => encodeCursor({ createdAt: 'yesterday', id: 'x' })).toThrow(PaginationError);
  });
});

describe('page request parsing', () => {
  it('uses bounded defaults', () => {
    expect(parsePageRequest({})).toEqual({ cursor: null, direction: 'forward', limit: DEFAULT_PAGE_LIMIT });
    expect(parsePageRequest({ limit: '999' }).limit).toBe(MAX_PAGE_LIMIT);
  });

  it('accepts cursor/after aliases and infers direction', () => {
    const cursor = encodeCursor(cursorFor(ROWS[2]));
    expect(parsePageRequest({ after: cursor }).direction).toBe('forward');
    expect(parsePageRequest({ before: cursor }).direction).toBe('backward');
    expect(parsePageRequest({ cursor, direction: 'backward' }).direction).toBe('backward');
    expect(parsePageRequest({ cursor }).cursor).toEqual(cursorFor(ROWS[2]));
  });

  it('reports invalid limits through the hook without failing the request', () => {
    const seen: PaginationError[] = [];
    const request = parsePageRequest(
      { limit: 'nope' },
      { onValidationError: (error) => seen.push(error) },
    );

    expect(request.limit).toBe(DEFAULT_PAGE_LIMIT);
    expect(seen.map((error) => error.code)).toEqual(['INVALID_PAGINATION']);
  });

  it('throws and reports an invalid direction or cursor', () => {
    const seen: PaginationError[] = [];
    const options: PaginationOptions<Row> = { onValidationError: (error) => seen.push(error) };

    expect(() => parsePageRequest({ direction: 'sideways' }, options)).toThrow(
      'direction must be forward or backward',
    );
    expect(() => parsePageRequest({ cursor: 'offset-10' }, options)).toThrow(PaginationError);
    expect(seen.map((error) => error.code)).toEqual(['INVALID_PAGINATION', 'INVALID_CURSOR']);
  });
});

describe('SQL clause generation', () => {
  it('uses a deterministic descending order for the first page', () => {
    expect(buildKeysetClause({ cursor: null, direction: 'forward', limit: 25 })).toEqual({
      whereSql: '',
      orderSql: 'ORDER BY created_at DESC, id DESC',
      limitPlaceholder: '$1',
      params: [25],
    });
  });

  it('breaks created_at ties with id in both directions', () => {
    const cursor = cursorFor(ROWS[2]);
    const forward = buildKeysetClause({ cursor, direction: 'forward', limit: 10 });
    const backward = buildKeysetClause({ cursor, direction: 'backward', limit: 10 });

    expect(forward.whereSql).toContain('created_at < $1');
    expect(forward.whereSql).toContain('id < $2');
    expect(forward.orderSql).toBe('ORDER BY created_at DESC, id DESC');
    expect(backward.whereSql).toContain('created_at > $1');
    expect(backward.whereSql).toContain('id > $2');
    expect(backward.orderSql).toBe('ORDER BY created_at ASC, id ASC');
    expect(forward.params).toEqual([cursor.createdAt, cursor.id, 10]);
  });
});

describe('in-memory keyset paging', () => {
  it('pages forward without gaps when timestamps tie', () => {
    const first = paginateRows(ROWS, { cursor: null, direction: 'forward', limit: 2 });
    const second = paginateRows(ROWS, {
      cursor: decodeCursor(first.nextCursor as string),
      direction: 'forward',
      limit: 2,
    });
    const third = paginateRows(ROWS, {
      cursor: decodeCursor(second.nextCursor as string),
      direction: 'forward',
      limit: 2,
    });

    expect(first.items.map((row) => row.id)).toEqual(['b', 'a']);
    expect(first.pageInfo.hasNextPage).toBe(true);
    expect(first.pageInfo.hasPreviousPage).toBe(false);
    expect(second.items.map((row) => row.id)).toEqual(['c', 'd']);
    expect(third.items.map((row) => row.id)).toEqual(['e', 'f']);
    expect(third.nextCursor).toBeNull();
  });

  it('pages backward and keeps the client-facing order stable', () => {
    const page = paginateRows(ROWS, {
      cursor: cursorFor(ROWS[4]),
      direction: 'backward',
      limit: 2,
    });

    expect(page.items.map((row) => row.id)).toEqual(['c', 'd']);
    expect(page.pageInfo.hasPreviousPage).toBe(true);
    expect(page.pageInfo.hasNextPage).toBe(true);
    expect(page.prevCursor).toBe(page.pageInfo.startCursor);
    expect(page.nextCursor).toBe(page.pageInfo.endCursor);
  });

  it('returns an empty page that still reports boundaries safely', () => {
    const page = paginateRows([], { cursor: null, direction: 'forward', limit: 5 });
    expect(page.items).toEqual([]);
    expect(page.pageInfo).toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    });
    expect(page.nextCursor).toBeNull();
  });

  it('supports custom key extractors and reports bad row data', () => {
    const rows = [{ key: 'z', ts: at(1) }, { key: 'y', ts: at(2) }];
    const options: PaginationOptions<(typeof rows)[number]> = {
      getCreatedAt: (row) => row.ts,
      getId: (row) => row.key,
    };
    expect(paginateRows(rows, { cursor: null, direction: 'forward', limit: 1 }, options).items).toEqual([
      rows[1],
    ]);

    const errors: PaginationError[] = [];
    expect(() =>
      createKeysetPage([{ id: '', createdAt: at(1) }], { cursor: null, direction: 'forward', limit: 1 }, {
        onValidationError: (error) => errors.push(error),
      }),
    ).toThrow(PaginationError);
    expect(errors[0].code).toBe('INVALID_PAGE_DATA');
  });
});
