/**
 * Issue #768 – Tests for useStreamingList hook
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useStreamingList } from '../useStreamingList';

// ─────────────────────────────────────────────────────────────────────────────
// fetch mock helpers
// ─────────────────────────────────────────────────────────────────────────────

function makePage<T>(items: T[], nextCursor: string | null, total?: number) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ items, nextCursor, total, pageSize: items.length }),
    body: null,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('useStreamingList', () => {
  it('starts in idle state with no items', () => {
    global.fetch = jest.fn();
    const { result } = renderHook(() =>
      useStreamingList<string>('/api/items')
    );

    expect(result.current.items).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.totalLoaded).toBe(0);
  });

  it('does NOT auto-fetch when autoLoad is false (default)', () => {
    global.fetch = jest.fn();
    renderHook(() => useStreamingList<string>('/api/items'));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('auto-fetches first page when autoLoad is true', async () => {
    global.fetch = jest.fn().mockResolvedValue(makePage(['a', 'b'], null));

    const { result } = renderHook(() =>
      useStreamingList<string>('/api/items', { autoLoad: true, pageSize: 2 })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toEqual(['a', 'b']);
    expect(result.current.hasMore).toBe(false);
  });

  it('loadMore appends items from subsequent pages', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(makePage([1, 2], 'cursor-2', 4) as unknown as Response)
      .mockResolvedValueOnce(makePage([3, 4], null, 4) as unknown as Response);

    const { result } = renderHook(() =>
      useStreamingList<number>('/api/items', { pageSize: 2 })
    );

    // Load first page
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items).toEqual([1, 2]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.total).toBe(4);

    // Load second page
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items).toEqual([1, 2, 3, 4]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.totalLoaded).toBe(4);
  });

  it('does not call fetch again when hasMore is false', async () => {
    global.fetch = jest.fn().mockResolvedValue(makePage(['x'], null));

    const { result } = renderHook(() => useStreamingList<string>('/api/items'));

    await act(async () => { await result.current.loadMore(); });
    expect(result.current.hasMore).toBe(false);

    await act(async () => { await result.current.loadMore(); });
    expect(global.fetch).toHaveBeenCalledTimes(1); // no second call
  });

  it('sets error state on fetch failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      text: () => Promise.resolve('Internal server error'),
      body: null,
    });

    const { result } = renderHook(() => useStreamingList<string>('/api/items'));

    await act(async () => { await result.current.loadMore(); });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.items).toHaveLength(0);
  });

  it('reset() clears all state and allows re-loading', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(makePage(['a'], 'c2') as unknown as Response)
      .mockResolvedValueOnce(makePage(['b'], null) as unknown as Response);

    const { result } = renderHook(() => useStreamingList<string>('/api/items'));

    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items).toHaveLength(1);

    act(() => { result.current.reset(); });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.totalLoaded).toBe(0);

    await act(async () => { await result.current.loadMore(); });
    // Reset re-enables loading from the beginning (second mock resolves new data)
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toBe('b');
  });

  it('does not double-fetch when loadMore is called while loading', async () => {
    let resolveFirst!: (v: unknown) => void;
    global.fetch = jest.fn().mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; })
    );

    const { result } = renderHook(() => useStreamingList<string>('/api/items'));

    // Start loading
    const p1 = act(async () => { await result.current.loadMore(); });
    // Call loadMore again while in-flight (should be no-op)
    act(() => { void result.current.loadMore(); });

    // Resolve the fetch
    resolveFirst(makePage(['z'], null));
    await p1;

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
