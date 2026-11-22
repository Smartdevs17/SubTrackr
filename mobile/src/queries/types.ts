/**
 * Types for the dedicated mobile query layer (Issue #2074).
 *
 * Screens declare *what* they need with a key and a fetcher; the query client
 * owns caching, deduplication, retries and observability. No React or
 * third-party query library is required by the core.
 */

/** Structured, serialisable query identity. Keep values primitive and stable. */
export type QueryKey = readonly (string | number | boolean | null)[];

export interface QueryFetchContext {
  /** Aborted on timeout or when the caller stops caring. */
  signal: AbortSignal;
  /** Zero-based attempt number; the first call is 0. */
  attempt: number;
  key: QueryKey;
}

export type QueryFetcher<T> = (context: QueryFetchContext) => Promise<T>;

export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

export interface QueryResult<T> {
  status: QueryStatus;
  data?: T;
  error?: unknown;
  isFetching: boolean;
  fetchedAt?: number;
  /** True when the value came from cache rather than a completed fetch. */
  fromCache: boolean;
  /** Number of attempts made for the most recent fetch (0 for a cache hit). */
  attempts: number;
}

export type QueryEventType =
  | 'cache_hit'
  | 'cache_miss'
  | 'dedupe'
  | 'fetch_start'
  | 'fetch_success'
  | 'fetch_error'
  | 'retry'
  | 'invalidate'
  | 'evict'
  | 'set_data';

export interface QueryEvent {
  type: QueryEventType;
  key: string;
  keyParts: QueryKey;
  at: number;
  durationMs?: number;
  attempts?: number;
  tags?: readonly string[];
  stale?: boolean;
  error?: string;
}

export interface QueryTelemetry {
  emit(event: QueryEvent): void;
}

export interface QueryLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface QueryEntry<T = unknown> {
  key: QueryKey;
  serializedKey: string;
  data: T;
  tags: readonly string[];
  storedAt: number;
  expiresAt: number;
}

export interface QueryFetchOptions<T> {
  key: QueryKey;
  fetcher: QueryFetcher<T>;
  /** Freshness window. Default 60_000 ms. */
  ttlMs?: number;
  /** Retry attempts after the first failure. Default 2. */
  retries?: number;
  /** Base delay for exponential backoff. Default 250 ms. */
  retryDelayMs?: number;
  /** Per-attempt deadline. Default 10_000 ms. */
  timeoutMs?: number;
  /** Tags used for bulk invalidation (for example `subscriptions`). */
  tags?: readonly string[];
}
