/**
 * pagination.test.ts — Unit tests for backend/services/shared/pagination.ts
 *
 * Coverage:
 *  - encodeCursor / decodeCursor: round-trip, tamper detection, version check
 *  - buildCursorClause: first page, paginated page, invalid cursor, limit clamping
 *  - buildPage: hasMore, nextCursor, last page, single-item page, total passthrough
 *  - parseFieldSelection: absent, empty, valid, deduplication
 *  - selectFields: all fields, subset, id always included, unknown fields ignored
 *  - selectFieldsAll: array projection, null fields returns original
 */

import {
  encodeCursor,
  decodeCursor,
  buildCursorClause,
  buildPage,
  parseFieldSelection,
  selectFields,
  selectFieldsAll,
  type CursorPayload,
} from '../pagination';

// ─── encodeCursor / decodeCursor ─────────────────────────────────────────────

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a complete cursor payload', () => {
    const payload: Omit<CursorPayload, 'v'> = {
      field: 'createdAt',
      value: '2025-01-15T10:00:00Z',
      id: 'sub_abc123',
      dir: 'asc',
    };
    const token = encodeCursor(payload);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const decoded = decodeCursor(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.field).toBe('createdAt');
    expect(decoded!.value).toBe('2025-01-15T10:00:00Z');
    expect(decoded!.id).toBe('sub_abc123');
    expect(decoded!.dir).toBe('asc');
    expect(decoded!.v).toBe(1);
  });

  it('produces URL-safe base64url tokens (no +, /, =)', () => {
    const token = encodeCursor({ field: 'id', value: 'abc', id: 'xyz', dir: 'desc' });
    expect(token).not.toMatch(/[+/=]/);
  });

  it('returns null for empty string', () => {
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for random garbage', () => {
    expect(decodeCursor('not-a-valid-cursor!!!!')).toBeNull();
  });

  it('returns null for a tampered token (signature mismatch)', () => {
    const token = encodeCursor({ field: 'id', value: '1', id: 'sub_1', dir: 'asc' });
    // Flip last character to corrupt the signature
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(decodeCursor(tampered)).toBeNull();
  });

  it('returns null for a valid-looking base64url with no pipe separator', () => {
    const noPipe = Buffer.from('{"v":1,"field":"id","value":"1","id":"x","dir":"asc"}').toString('base64url');
    expect(decodeCursor(noPipe)).toBeNull();
  });

  it('handles numeric cursor values', () => {
    const token = encodeCursor({ field: 'amount', value: 99.99, id: 'inv_1', dir: 'asc' });
    const decoded = decodeCursor(token);
    expect(decoded!.value).toBe(99.99);
  });

  it('handles null cursor value', () => {
    const token = encodeCursor({ field: 'deletedAt', value: null, id: 'sub_1', dir: 'asc' });
    const decoded = decodeCursor(token);
    expect(decoded!.value).toBeNull();
  });

  it('two different payloads produce different tokens', () => {
    const t1 = encodeCursor({ field: 'id', value: 'a', id: 'sub_1', dir: 'asc' });
    const t2 = encodeCursor({ field: 'id', value: 'b', id: 'sub_2', dir: 'asc' });
    expect(t1).not.toBe(t2);
  });
});

// ─── buildCursorClause ────────────────────────────────────────────────────────

describe('buildCursorClause', () => {
  it('returns empty where clause for first page (no cursor)', () => {
    const clause = buildCursorClause({});
    expect(clause.where).toBe('');
    expect(clause.param).toBeNull();
    expect(clause.orderBy).toBe('"id" ASC');
    expect(clause.limit).toBe(20); // default
  });

  it('uses custom sortField', () => {
    const clause = buildCursorClause({ sortField: 'createdAt', direction: 'desc' });
    expect(clause.orderBy).toBe('"createdAt" DESC');
  });

  it('clamps limit to 1 at minimum', () => {
    const clause = buildCursorClause({ limit: 0 });
    expect(clause.limit).toBe(1);
  });

  it('clamps limit to maxLimit', () => {
    const clause = buildCursorClause({ limit: 500, maxLimit: 50 });
    expect(clause.limit).toBe(50);
  });

  it('uses default limit of 20 when not provided', () => {
    expect(buildCursorClause().limit).toBe(20);
  });

  it('uses limit when within maxLimit', () => {
    const clause = buildCursorClause({ limit: 30, maxLimit: 100 });
    expect(clause.limit).toBe(30);
  });

  it('generates WHERE clause for a valid cursor', () => {
    const token = encodeCursor({
      field: 'createdAt',
      value: '2025-01-01T00:00:00Z',
      id: 'sub_001',
      dir: 'asc',
    });
    const clause = buildCursorClause({ cursor: token });
    expect(clause.where).toContain('createdAt');
    expect(clause.where).toContain('>');
    expect(clause.param).toBe('2025-01-01T00:00:00Z');
  });

  it('generates DESC WHERE clause for descending cursor', () => {
    const token = encodeCursor({ field: 'id', value: 'sub_100', id: 'sub_100', dir: 'desc' });
    const clause = buildCursorClause({ cursor: token, direction: 'desc' });
    expect(clause.where).toContain('<');
  });

  it('falls back to empty where clause for an invalid/tampered cursor', () => {
    const clause = buildCursorClause({ cursor: 'totally-invalid-cursor' });
    expect(clause.where).toBe('');
  });

  it('includes both field and id in composite WHERE clause', () => {
    const token = encodeCursor({ field: 'amount', value: 9.99, id: 'inv_1', dir: 'asc' });
    const clause = buildCursorClause({ cursor: token });
    expect(clause.where).toContain('$1');
    expect(clause.where).toContain('$2');
  });
});

// ─── buildPage ────────────────────────────────────────────────────────────────

interface SubRecord {
  id: string;
  createdAt: string;
  amount: number;
}

function makeRows(n: number): SubRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `sub_${String(i + 1).padStart(3, '0')}`,
    createdAt: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    amount: 9.99,
  }));
}

describe('buildPage', () => {
  it('returns hasMore=false and no nextCursor on last page', () => {
    const rows = makeRows(5); // exactly 5, limit=5
    const result = buildPage(rows, 5, (r) => r.createdAt, (r) => r.id);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
    expect(result.items).toHaveLength(5);
  });

  it('returns hasMore=true and nextCursor when more rows exist', () => {
    // fetch limit+1 rows to detect hasMore
    const rows = makeRows(11); // limit=10, 11th row signals hasMore
    const result = buildPage(rows, 10, (r) => r.createdAt, (r) => r.id);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeDefined();
    expect(result.items).toHaveLength(10); // trimmed to limit
  });

  it('nextCursor decodes to the last item in the page', () => {
    const rows = makeRows(6);
    const result = buildPage(rows, 5, (r) => r.createdAt, (r) => r.id, 'asc', 'createdAt');
    expect(result.nextCursor).toBeDefined();

    const decoded = decodeCursor(result.nextCursor!);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(rows[4].id); // 5th item (index 4)
    expect(decoded!.value).toBe(rows[4].createdAt);
    expect(decoded!.field).toBe('createdAt');
    expect(decoded!.dir).toBe('asc');
  });

  it('returns empty items with no cursor for empty result set', () => {
    const result = buildPage([], 20, (r: SubRecord) => r.createdAt, (r) => r.id);
    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it('passes through optional total count', () => {
    const rows = makeRows(5);
    const result = buildPage(rows, 5, (r) => r.createdAt, (r) => r.id, 'asc', 'id', 42);
    expect(result.total).toBe(42);
  });

  it('total is undefined when not provided', () => {
    const rows = makeRows(5);
    const result = buildPage(rows, 5, (r) => r.createdAt, (r) => r.id);
    expect(result.total).toBeUndefined();
  });

  it('single-item page on last page — no cursor', () => {
    const rows = makeRows(1);
    const result = buildPage(rows, 20, (r) => r.createdAt, (r) => r.id);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(false);
  });

  it('descending cursor encodes dir=desc', () => {
    const rows = makeRows(6);
    const result = buildPage(rows, 5, (r) => r.amount, (r) => r.id, 'desc', 'amount');
    const decoded = decodeCursor(result.nextCursor!);
    expect(decoded!.dir).toBe('desc');
  });
});

// ─── parseFieldSelection ──────────────────────────────────────────────────────

describe('parseFieldSelection', () => {
  it('returns null when fields param is undefined', () => {
    expect(parseFieldSelection(undefined)).toBeNull();
  });

  it('returns null when fields param is empty string', () => {
    expect(parseFieldSelection('')).toBeNull();
  });

  it('returns null when fields param is only whitespace', () => {
    expect(parseFieldSelection('   ')).toBeNull();
  });

  it('returns a Set of field names for valid input', () => {
    const fields = parseFieldSelection('id,name,status');
    expect(fields).not.toBeNull();
    expect(fields!.has('id')).toBe(true);
    expect(fields!.has('name')).toBe(true);
    expect(fields!.has('status')).toBe(true);
    expect(fields!.size).toBe(3);
  });

  it('trims whitespace around field names', () => {
    const fields = parseFieldSelection(' id , name , status ');
    expect(fields!.has('id')).toBe(true);
    expect(fields!.has('name')).toBe(true);
  });

  it('filters out empty segments from double commas', () => {
    const fields = parseFieldSelection('id,,name,,');
    expect(fields!.size).toBe(2);
    expect(fields!.has('id')).toBe(true);
    expect(fields!.has('name')).toBe(true);
  });

  it('returns null for a single empty field after filtering', () => {
    expect(parseFieldSelection(',')).toBeNull();
  });

  it('single field returns a one-element Set', () => {
    const fields = parseFieldSelection('status');
    expect(fields!.size).toBe(1);
    expect(fields!.has('status')).toBe(true);
  });
});

// ─── selectFields ─────────────────────────────────────────────────────────────

describe('selectFields', () => {
  const record = {
    id: 'sub_001',
    status: 'active',
    amount: 9.99,
    currency: 'USD',
    planId: 'plan_basic',
  };

  it('returns the full record when fields is null', () => {
    const result = selectFields(record, null);
    expect(result).toEqual(record);
  });

  it('returns only requested fields', () => {
    const fields = new Set(['status', 'amount']);
    const result = selectFields(record, fields);
    expect(result).toHaveProperty('id'); // always included
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('amount');
    expect(result).not.toHaveProperty('currency');
    expect(result).not.toHaveProperty('planId');
  });

  it('always includes id even when not in fields set', () => {
    const fields = new Set(['status']);
    const result = selectFields(record, fields);
    expect(result.id).toBe('sub_001');
  });

  it('ignores field names not present in the record', () => {
    const fields = new Set(['nonExistentField', 'status']);
    const result = selectFields(record, fields);
    expect(result).not.toHaveProperty('nonExistentField');
    expect(result).toHaveProperty('status');
  });

  it('works when record has no id field', () => {
    const noId = { name: 'Alice', role: 'admin' } as Record<string, unknown>;
    const fields = new Set(['name']);
    const result = selectFields(noId, fields);
    expect(result).toHaveProperty('name');
    expect(result).not.toHaveProperty('id');
  });

  it('requesting only id returns just id', () => {
    const fields = new Set(['id']);
    const result = selectFields(record, fields);
    expect(Object.keys(result)).toEqual(['id']);
  });
});

// ─── selectFieldsAll ─────────────────────────────────────────────────────────

describe('selectFieldsAll', () => {
  const records = [
    { id: 's1', status: 'active', amount: 10 },
    { id: 's2', status: 'cancelled', amount: 20 },
    { id: 's3', status: 'paused', amount: 30 },
  ];

  it('returns the original array when fields is null', () => {
    const result = selectFieldsAll(records, null);
    expect(result).toBe(records); // same reference
  });

  it('projects each record to the requested fields', () => {
    const fields = new Set(['status']);
    const result = selectFieldsAll(records, fields);
    expect(result).toHaveLength(3);
    for (const r of result) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('status');
      expect(r).not.toHaveProperty('amount');
    }
  });

  it('handles empty array', () => {
    expect(selectFieldsAll([], new Set(['id']))).toEqual([]);
  });

  it('preserves order of records', () => {
    const fields = new Set(['id']);
    const result = selectFieldsAll(records, fields);
    expect(result.map((r) => r.id)).toEqual(['s1', 's2', 's3']);
  });
});

// ─── Integration: full pagination cycle ──────────────────────────────────────

describe('pagination integration — cursor-based traversal', () => {
  interface Item {
    id: string;
    createdAt: string;
    value: number;
  }

  const allItems: Item[] = Array.from({ length: 55 }, (_, i) => ({
    id: `item_${String(i + 1).padStart(3, '0')}`,
    createdAt: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
    value: i * 10,
  }));

  function fetchPage(cursor: string | undefined, limit: number): { items: Item[]; nextCursor?: string; hasMore: boolean } {
    // Simulate a keyset query
    const clause = buildCursorClause({ cursor, limit, sortField: 'createdAt', direction: 'asc' });

    let startIdx = 0;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        const idx = allItems.findIndex((i) => i.id === decoded.id);
        startIdx = idx + 1;
      }
    }

    const rawRows = allItems.slice(startIdx, startIdx + clause.limit + 1);
    return buildPage(rawRows, clause.limit, (r) => r.createdAt, (r) => r.id, 'asc', 'createdAt');
  }

  it('traverses all 55 items in pages of 10 without gaps or duplicates', () => {
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pageCount = 0;

    while (true) {
      const page = fetchPage(cursor, 10);
      pageCount++;

      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false); // no duplicates
        seen.add(item.id);
      }

      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }

    expect(seen.size).toBe(55);
    expect(pageCount).toBe(6); // 10+10+10+10+10+5
  });

  it('applies field selection to paginated results', () => {
    const page = fetchPage(undefined, 5);
    const fields = parseFieldSelection('id,value');
    const projected = selectFieldsAll(page.items, fields);

    for (const r of projected) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('value');
      expect(r).not.toHaveProperty('createdAt');
    }
  });

  it('last page has hasMore=false and no nextCursor', () => {
    // Skip to the last page
    let cursor: string | undefined;
    let lastPage: { items: Item[]; nextCursor?: string; hasMore: boolean } | null = null;

    while (true) {
      const page = fetchPage(cursor, 20);
      lastPage = page;
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }

    expect(lastPage!.hasMore).toBe(false);
    expect(lastPage!.nextCursor).toBeUndefined();
  });
});
