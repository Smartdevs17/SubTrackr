import { useCallback, useRef, useState } from 'react';

type RefreshOptions = {
  fetcher?: () => Promise<any>;
  clearBefore?: () => void | Promise<void>;
  minDurationMs?: number;
  onError?: (err: unknown) => void;
};

/**
 * useRefresh — standardized pull-to-refresh handler used across screens.
 * - Prevents concurrent refreshes
 * - Optionally clears old data before fetching
 * - Ensures a short minimum visible refresh duration
 */
export function useRefresh() {
  const [refreshing, setRefreshing] = useState(false);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async (opts: RefreshOptions = {}) => {
    const { fetcher, clearBefore, minDurationMs = 400, onError } = opts;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRefreshing(true);

    const start = Date.now();

    try {
      if (clearBefore) await clearBefore();
      if (fetcher) await fetcher();
      else await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      console.error('Refresh failed', err);
      if (onError) onError(err);
    } finally {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, minDurationMs - elapsed);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      inFlightRef.current = false;
      setRefreshing(false);
    }
  }, []);

  return { refreshing, refresh } as const;
}

export default useRefresh;
