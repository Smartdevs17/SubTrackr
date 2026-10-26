/**
 * Issue #768 – Unit tests for backend/services/shared/streaming.ts
 */

import {
  encodeOpaqueCursor,
  decodeOpaqueCursor,
  createCursorStream,
  collectStream,
  MemoryMonitor,
  toNdjsonLine,
  parseNdjsonBuffer,
} from '../streaming';
import type { CursorPage, PageFetcher } from '../streaming';

// ─────────────────────────────────────────────────────────────────────────────
// Cursor helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('encodeOpaqueCursor / decodeOpaqueCursor', () => {
  it('round-trips a simple payload', () => {
    const payload = { offset: 42, subscriptionId: 'sub_abc' };
    const token = encodeOpaqueCursor(payload);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(decodeOpaqueCursor(token)).toEqual(payload);
  });

  it('returns null for invalid tokens', () => {
    expect(decodeOpaqueCursor('not-valid-base64url!!!')).toBeNull();
    expect(decodeOpaqueCursor('')).toBeNull();
  });

  it('returns null when decoded JSON is not a plain object', () => {
    const arrayToken = Buffer.from(JSON.stringify([1, 2, 3])).toString('base64url');
    expect(decodeOpaqueCursor(arrayToken)).toBeNull();
  });

  it('produces URL-safe tokens (no +, /, =)', () => {
    const token = encodeOpaqueCursor({ data: 'hello world!', n: 9999 });
    expect(token).not.toMatch(/[+/=]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCursorStream
// ─────────────────────────────────────────────────────────────────────────────

function makeFetcher<T>(allItems: T[], pageSize: number): PageFetcher<T> {
  return async (afterCursor, limit): Promise<CursorPage<T>> => {
    const offset = afterCursor ? parseInt(afterCursor, 10) : 0;
    const items = allItems.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    const nextCursor = nextOffset < allItems.length ? String(nextOffset) : null;
    return { items, nextCursor, total: allItems.length, pageSize: limit };
  };
}

describe('createCursorStream', () => {
  it('yields all pages until exhausted', async () => {
    const data = Array.from({ length: 25 }, (_, i) => i);
    const fetcher = makeFetcher(data, 10);
    const pages: CursorPage<number>[] = [];
    for await (const page of createCursorStream(fetcher, { limit: 10 })) {
      pages.push(page);
    }
    expect(pages).toHaveLength(3); // 10 + 10 + 5
    expect(pages.flatMap((p) => p.items)).toEqual(data);
  });

  it('yields a single page when data fits', async () => {
    const data = [1, 2, 3];
    const fetcher = makeFetcher(data, 10);
    const pages: CursorPage<number>[] = [];
    for await (const page of createCursorStream(fetcher, { limit: 10 })) {
      pages.push(page);
    }
    expect(pages).toHaveLength(1);
    expect(pages[0].nextCursor).toBeNull();
  });

  it('handles empty data source', async () => {
    const fetcher = makeFetcher([], 10);
    const pages: CursorPage<number>[] = [];
    for await (const page of createCursorStream(fetcher, { limit: 10 })) {
      pages.push(page);
    }
    // One empty page is yielded (the fetcher always returns at least one call)
    expect(pages).toHaveLength(1);
    expect(pages[0].items).toHaveLength(0);
    expect(pages[0].nextCursor).toBeNull();
  });
});

describe('collectStream', () => {
  it('collects all items into a flat array', async () => {
    const data = Array.from({ length: 15 }, (_, i) => `item-${i}`);
    const fetcher = makeFetcher(data, 5);
    const result = await collectStream(fetcher, { limit: 5 });
    expect(result).toEqual(data);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MemoryMonitor
// ─────────────────────────────────────────────────────────────────────────────

describe('MemoryMonitor', () => {
  it('snapshot() returns a valid snapshot with all required fields', () => {
    const monitor = new MemoryMonitor();
    const snap = monitor.snapshot();
    expect(typeof snap.rss).toBe('number');
    expect(typeof snap.heapTotal).toBe('number');
    expect(typeof snap.heapUsed).toBe('number');
    expect(typeof snap.external).toBe('number');
    expect(typeof snap.arrayBuffers).toBe('number');
    expect(typeof snap.capturedAt).toBe('string');
  });

  it('check() fires onThresholdExceeded when RSS threshold is 0', () => {
    const onThresholdExceeded = jest.fn();
    const monitor = new MemoryMonitor({
      rssThresholdBytes: 0,  // always exceeded
      onThresholdExceeded,
    });
    monitor.check();
    expect(onThresholdExceeded).toHaveBeenCalled();
    const [, field] = onThresholdExceeded.mock.calls[0] as [unknown, string];
    expect(field).toBe('rss');
  });

  it('check() does not fire callback when thresholds are very high', () => {
    const onThresholdExceeded = jest.fn();
    const monitor = new MemoryMonitor({
      rssThresholdBytes: Number.MAX_SAFE_INTEGER,
      heapThresholdBytes: Number.MAX_SAFE_INTEGER,
      onThresholdExceeded,
    });
    monitor.check();
    expect(onThresholdExceeded).not.toHaveBeenCalled();
  });

  it('MemoryMonitor.format() returns a readable string', () => {
    const monitor = new MemoryMonitor();
    const snap = monitor.snapshot();
    const formatted = MemoryMonitor.format(snap);
    expect(formatted).toMatch(/RSS=/);
    expect(formatted).toMatch(/heap=/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NDJSON helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('toNdjsonLine', () => {
  it('serialises a value and appends a newline', () => {
    const line = toNdjsonLine({ id: 'x', value: 42 });
    expect(line).toBe('{"id":"x","value":42}\n');
  });

  it('handles primitive values', () => {
    expect(toNdjsonLine(123)).toBe('123\n');
    expect(toNdjsonLine(null)).toBe('null\n');
  });
});

describe('parseNdjsonBuffer', () => {
  it('parses multi-line NDJSON', () => {
    const buffer = '{"a":1}\n{"b":2}\n{"c":3}\n';
    expect(parseNdjsonBuffer(buffer)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('skips blank lines', () => {
    const buffer = '{"a":1}\n\n{"b":2}\n';
    expect(parseNdjsonBuffer(buffer)).toHaveLength(2);
  });

  it('silently skips malformed JSON lines', () => {
    const buffer = '{"a":1}\nnot-json\n{"b":2}\n';
    expect(parseNdjsonBuffer(buffer)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns empty array for empty string', () => {
    expect(parseNdjsonBuffer('')).toEqual([]);
  });
});
