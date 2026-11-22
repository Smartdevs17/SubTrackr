/**
 * Issue #768 – useStreamingList hook
 *
 * Incrementally loads cursor-paginated data from a streaming endpoint.
 * Items are appended as each page arrives — no full dataset is held in memory.
 *
 * Usage:
 * ```tsx
 * const { items, isLoading, hasMore, loadMore } = useStreamingList<MyRecord>(
 *   '/subscriptions/stream',
 *   { pageSize: 50, autoLoad: true }
 * );
 * ```
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchCursorPage } from '../streamingService';
import type { CursorPage } from '../streamingService';

export interface UseStreamingListOptions {
  /** Records per page. Default: 100. */
  pageSize?: number;
  /** If true, fetches the first page automatically on mount. Default: false. */
  autoLoad?: boolean;
  /** Additional query params forwarded to the endpoint. */
  params?: Record<string, string>;
}

export interface UseStreamingListResult<T> {
  /** All items loaded so far (appended page-by-page). */
  items: T[];
  /** True while a page fetch is in flight. */
  isLoading: boolean;
  /** True if there is at least one more page to load. */
  hasMore: boolean;
  /** Total records available on the server (if the endpoint returns it). */
  total: number | undefined;
  /** Number of items currently loaded. */
  totalLoaded: number;
  /** Fetch the next page and append items. No-op if already loading or no more pages. */
  loadMore: () => Promise<void>;
  /** Reset to the initial empty state and re-fetch from the first page. */
  reset: () => void;
  /** Error from the last failed fetch, if any. */
  error: Error | null;
}

export function useStreamingList<T>(
  url: string,
  options: UseStreamingListOptions = {}
): UseStreamingListResult<T> {
  const { pageSize = 100, autoLoad = false, params } = options;

  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);

  // Store cursor in a ref so loadMore closure always sees the latest value
  const cursorRef = useRef<string | null | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;

    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const page: CursorPage<T> = await fetchCursorPage<T>(url, {
        cursor: cursorRef.current ?? undefined,
        limit: pageSize,
        params,
        signal: controller.signal,
      });

      cursorRef.current = page.nextCursor;
      setItems((prev) => [...prev, ...page.items]);
      setHasMore(page.nextCursor !== null);
      if (page.total !== undefined) setTotal(page.total);
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [url, pageSize, params, hasMore]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    cursorRef.current = undefined;
    setItems([]);
    loadingRef.current = false;
    setIsLoading(false);
    setHasMore(true);
    setTotal(undefined);
    setError(null);
  }, []);

  // Auto-load first page on mount
  useEffect(() => {
    if (autoLoad) {
      void loadMore();
    }
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, url]);

  return {
    items,
    isLoading,
    hasMore,
    total,
    totalLoaded: items.length,
    loadMore,
    reset,
    error,
  };
}

export default useStreamingList;
