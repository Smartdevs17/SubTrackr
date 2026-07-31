/**
 * Issue #768 – Tests for app/services/streamingService.ts
 *
 * Uses Jest mocks for `fetch` and `ReadableStream`.
 */

import {
  fetchCursorPage,
  collectAllPages,
  streamNdjson,
  subscribeToSse,
  getClientMemoryStats,
} from '../streamingService';
import type { CursorPage } from '../streamingService';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mockFetchJson(body: unknown, status = 200): void {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    body: null,
  } as unknown as Response);
}

function mockFetchNdjson(lines: string[], status = 200): void {
  const text = lines.join('\n') + '\n';
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(text),
    body: null, // triggers text fallback path
  } as unknown as Response);
}

function mockFetchSse(blocks: string[], status = 200): void {
  // Build SSE text with double-newline separators
  const text = blocks.join('\n\n') + '\n\n';
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(text),
    body: null, // triggers SSE text fallback – we test subscribeToSse via handler verification
  } as unknown as Response);
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchCursorPage
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchCursorPage', () => {
  it('fetches the first page without a cursor', async () => {
    const page: CursorPage<{ id: string }> = {
      items: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'cursor-2',
      total: 10,
      pageSize: 2,
    };
    mockFetchJson(page);

    const result = await fetchCursorPage<{ id: string }>('/api/items', { limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe('cursor-2');
    expect(result.total).toBe(10);
  });

  it('includes cursor in URL when provided', async () => {
    const page: CursorPage<number> = { items: [3, 4], nextCursor: null, pageSize: 2 };
    mockFetchJson(page);

    await fetchCursorPage<number>('/api/items', { cursor: 'cursor-2', limit: 2 });

    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('cursor=cursor-2');
    expect(calledUrl).toContain('limit=2');
  });

  it('throws on non-200 responses', async () => {
    mockFetchJson({ error: 'Not Found' }, 404);
    await expect(fetchCursorPage('/api/items')).rejects.toThrow('HTTP 404');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// collectAllPages
// ─────────────────────────────────────────────────────────────────────────────

describe('collectAllPages', () => {
  it('collects items from all pages', async () => {
    const page1: CursorPage<number> = { items: [1, 2], nextCursor: 'c2', pageSize: 2 };
    const page2: CursorPage<number> = { items: [3, 4], nextCursor: 'c3', pageSize: 2 };
    const page3: CursorPage<number> = { items: [5], nextCursor: null, pageSize: 2 };

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(page1), body: null } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(page2), body: null } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(page3), body: null } as unknown as Response);

    const all = await collectAllPages<number>('/api/items', { limit: 2 });
    expect(all).toEqual([1, 2, 3, 4, 5]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// streamNdjson
// ─────────────────────────────────────────────────────────────────────────────

describe('streamNdjson', () => {
  it('calls onItem for each valid NDJSON line (fallback path)', async () => {
    const lines = ['{"id":"x1"}', '{"id":"x2"}', '{"id":"x3"}'];
    mockFetchNdjson(lines);

    const items: { id: string }[] = [];
    await streamNdjson<{ id: string }>('/stream', (item) => { items.push(item); });

    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(['x1', 'x2', 'x3']);
  });

  it('skips malformed lines silently', async () => {
    mockFetchNdjson(['{"id":"ok"}', 'not-json', '{"id":"also-ok"}']);

    const items: { id: string }[] = [];
    await streamNdjson<{ id: string }>('/stream', (item) => { items.push(item); });

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('ok');
    expect(items[1].id).toBe('also-ok');
  });

  it('throws on non-200 responses', async () => {
    mockFetchNdjson([], 500);
    await expect(streamNdjson('/stream', () => {})).rejects.toThrow('HTTP 500');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribeToSse – basic handler invocation
// ─────────────────────────────────────────────────────────────────────────────

describe('subscribeToSse', () => {
  it('returns a cancel function synchronously', () => {
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {})); // never resolves
    const cancel = subscribeToSse('/sse', {});
    expect(typeof cancel).toBe('function');
    cancel(); // should not throw
  });

  it('calls onError when fetch returns non-200', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      body: null,
    } as unknown as Response);

    const onError = jest.fn();
    const onClose = jest.fn();

    subscribeToSse('/sse', { onError, onClose });

    // Wait for the async internals to run
    await new Promise((r) => setTimeout(r, 50));

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('403') }));
    expect(onClose).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getClientMemoryStats
// ─────────────────────────────────────────────────────────────────────────────

describe('getClientMemoryStats', () => {
  it('returns a stats object with capturedAt', () => {
    const stats = getClientMemoryStats();
    expect(typeof stats.capturedAt).toBe('string');
    // In Jest/Node, performance.memory is not available so heap fields should be undefined
    expect(stats.usedJSHeapSize).toBeUndefined();
  });
});
