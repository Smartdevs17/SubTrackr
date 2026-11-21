/** React binding for the query client. The core remains framework-agnostic. */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { QueryClient } from './queryClient';
import { defaultQueryClient } from './defaultQueryClient';
import { serializeQueryKey } from './queryKey';
import type { QueryFetchOptions, QueryResult } from './types';

export interface UseQueryOptions<T> extends QueryFetchOptions<T> {
  /** Skip fetching while false (for example until a user id is available). */
  enabled?: boolean;
  /** Injectable for tests and per-screen isolation. */
  client?: QueryClient;
}

export interface UseQueryResult<T> extends QueryResult<T> {
  refetch: () => Promise<QueryResult<T>>;
  invalidate: () => void;
}

const idleResult: QueryResult<unknown> = {
  status: 'idle',
  isFetching: false,
  fromCache: false,
  attempts: 0,
};

/**
 * Subscribe a screen to one query. Re-renders only when the client publishes a
 * new snapshot for this key, including background revalidations.
 */
export function useQuery<T>(options: UseQueryOptions<T>): UseQueryResult<T> {
  const { client = defaultQueryClient, enabled = true } = options;
  const serializedKey = serializeQueryKey(options.key);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const snapshot = useCallback(
    () => client.getSnapshot<T>(serializedKey),
    [client, serializedKey],
  );
  const [result, setResult] = useState<QueryResult<T>>(
    () => snapshot() ?? (idleResult as QueryResult<T>),
  );

  const sync = useCallback(() => {
    const next = snapshot();
    setResult((previous) => {
      if (!next) return previous ?? (idleResult as QueryResult<T>);
      return next === previous ? previous : next;
    });
  }, [snapshot]);

  useEffect(() => {
    if (!enabled) {
      setResult(idleResult as QueryResult<T>);
      return;
    }
    let active = true;
    const unsubscribe = client.subscribe(() => {
      if (active) sync();
    });
    sync();
    void client.fetch<T>(optionsRef.current).then(() => {
      if (active) sync();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client, enabled, serializedKey, sync]);

  const refetch = useCallback(() => {
    const next = client.refresh<T>(optionsRef.current);
    void next.then(sync);
    return next;
  }, [client, sync]);

  const invalidate = useCallback(() => {
    client.invalidate({ key: optionsRef.current.key });
  }, [client]);

  return { ...result, refetch, invalidate };
}
