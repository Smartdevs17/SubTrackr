/**
 * Dependency-free query client for screen-level data fetching (Issue #2074).
 *
 * Responsibilities are limited to one place: key-based caching with TTL,
 * request deduplication, stale-while-revalidate, bounded retries, tag/key
 * invalidation and observability. Screens only provide a key and a fetcher.
 */

import { QueryCache } from './queryCache';
import { describeQueryKey, isQueryKeyPrefix, serializeQueryKey } from './queryKey';
import type {
  QueryEntry,
  QueryEvent,
  QueryFetchOptions,
  QueryKey,
  QueryLogger,
  QueryResult,
  QueryTelemetry,
} from './types';

type QueryDefaults = Required<
  Pick<QueryFetchOptions<unknown>, 'ttlMs' | 'retries' | 'retryDelayMs' | 'timeoutMs'>
>;

export interface QueryClientOptions {
  cache?: QueryCache;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  telemetry?: QueryTelemetry;
  logger?: QueryLogger;
  defaults?: Partial<QueryDefaults>;
}

export interface InvalidateOptions {
  key?: QueryKey;
  prefix?: QueryKey;
  tag?: string;
  tags?: readonly string[];
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Retry transport/server failures, but never retry a definite client error. */
export function isRetryableQueryError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true;
  const candidate = error as { retryable?: unknown; status?: unknown };
  if (typeof candidate.retryable === 'boolean') return candidate.retryable;
  if (typeof candidate.status === 'number') {
    return candidate.status === 408 || candidate.status === 429 || candidate.status >= 500;
  }
  return true;
}

export function queryErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class QueryClient {
  private readonly cache: QueryCache;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly telemetry?: QueryTelemetry;
  private readonly logger?: QueryLogger;
  private readonly defaults: QueryDefaults;
  private readonly inFlight = new Map<string, Promise<QueryResult<unknown>>>();
  private readonly inFlightMeta = new Map<string, { key: QueryKey; tags: readonly string[] }>();
  private readonly states = new Map<string, QueryResult<unknown>>();
  private readonly generations = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  constructor(options: QueryClientOptions = {}) {
    this.now = options.now ?? Date.now;
    this.cache = options.cache ?? new QueryCache({ now: this.now });
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.telemetry = options.telemetry;
    this.logger = options.logger;
    this.defaults = {
      ttlMs: options.defaults?.ttlMs ?? DEFAULT_TTL_MS,
      retries: options.defaults?.retries ?? DEFAULT_RETRIES,
      retryDelayMs: options.defaults?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      timeoutMs: options.defaults?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  /**
   * Return fresh cached data, or wait for a fetch. Stale data is returned
   * immediately while a deduplicated background revalidation runs.
   */
  async fetch<T>(options: QueryFetchOptions<T>): Promise<QueryResult<T>> {
    const serializedKey = serializeQueryKey(options.key);
    // `peek` keeps expired entries visible so stale-while-revalidate works;
    // `get` is reserved for fresh values only.
    const cached = this.cache.peek<T>(serializedKey);

    if (cached && cached.expiresAt > this.now()) {
      this.emit('cache_hit', options.key, { tags: cached.tags });
      return this.fromEntry(cached, true);
    }

    if (cached) {
      this.emit('cache_hit', options.key, { stale: true, tags: cached.tags });
      const staleResult: QueryResult<T> = {
        ...this.fromEntry(cached, true),
        isFetching: true,
      };
      this.setState(serializedKey, staleResult);
      if (!this.inFlight.has(serializedKey)) {
        void this.refresh(options);
      } else {
        this.emit('dedupe', options.key);
      }
      return staleResult;
    }

    this.emit('cache_miss', options.key);
    return this.refresh(options);
  }

  /** Always fetch, deduplicating concurrent callers for the same key. */
  refresh<T>(options: QueryFetchOptions<T>): Promise<QueryResult<T>> {
    const serializedKey = serializeQueryKey(options.key);
    const existing = this.inFlight.get(serializedKey);
    if (existing) {
      this.emit('dedupe', options.key);
      return existing as Promise<QueryResult<T>>;
    }

    const generation = this.generations.get(serializedKey) ?? 0;
    this.inFlightMeta.set(serializedKey, { key: options.key, tags: options.tags ?? [] });
    const promise = this.execute(options, serializedKey, generation);
    this.inFlight.set(serializedKey, promise as Promise<QueryResult<unknown>>);
    void promise.then(
      () => this.clearInFlight(serializedKey, promise),
      () => this.clearInFlight(serializedKey, promise),
    );
    return promise;
  }

  /** Fire-and-forget warm-up; errors are still observable through events. */
  async prefetch<T>(options: QueryFetchOptions<T>): Promise<void> {
    await this.refresh(options);
  }

  /** Optimistically replace a cached value without a network call. */
  setQueryData<T>(key: QueryKey, data: T, options: { ttlMs?: number; tags?: readonly string[] } = {}): void {
    const serializedKey = serializeQueryKey(key);
    this.cache.set(key, data, {
      ttlMs: options.ttlMs ?? this.defaults.ttlMs,
      tags: options.tags,
    });
    this.setState(serializedKey, {
      status: 'success',
      data,
      isFetching: false,
      fromCache: false,
      attempts: 0,
      fetchedAt: this.now(),
    });
    this.emit('set_data', key, { tags: options.tags });
    this.notify();
  }

  /** Invalidate by exact key, key prefix and/or tag. No filter clears all. */
  invalidate(options: InvalidateOptions = {}): string[] {
    const tags = [...(options.tag ? [options.tag] : []), ...(options.tags ?? [])];
    const hasFilter = Boolean(options.key || options.prefix || tags.length);
    const matches = (entry: QueryEntry): boolean => {
      if (!hasFilter) return true;
      if (options.key && entry.serializedKey === serializeQueryKey(options.key)) return true;
      if (options.prefix && isQueryKeyPrefix(entry.key, options.prefix)) return true;
      return tags.some((tag) => entry.tags.includes(tag));
    };
    const matched = this.cache.entriesSnapshot().filter(matches);
    const removed = this.cache.invalidate((entry) =>
      matched.some((item) => item.serializedKey === entry.serializedKey),
    );

    const affected = new Set(matched.map((entry) => entry.serializedKey));
    for (const [serializedKey, meta] of Array.from(this.inFlightMeta.entries())) {
      if (
        !hasFilter ||
        (options.key && serializedKey === serializeQueryKey(options.key)) ||
        (options.prefix && isQueryKeyPrefix(meta.key, options.prefix)) ||
        tags.some((tag) => meta.tags.includes(tag))
      ) {
        affected.add(serializedKey);
      }
    }

    for (const serializedKey of affected) {
      this.generations.set(serializedKey, (this.generations.get(serializedKey) ?? 0) + 1);
      this.states.delete(serializedKey);
      this.emit(
        'invalidate',
        this.inFlightMeta.get(serializedKey)?.key ?? this.parseKey(serializedKey),
      );
    }
    if (affected.size) this.notify();
    return removed;
  }

  clear(): void {
    const removed = new Set(this.cache.clear());
    for (const serializedKey of this.inFlightMeta.keys()) removed.add(serializedKey);
    for (const serializedKey of removed) {
      this.generations.set(serializedKey, (this.generations.get(serializedKey) ?? 0) + 1);
      this.states.delete(serializedKey);
      this.emit(
        'invalidate',
        this.inFlightMeta.get(serializedKey)?.key ?? this.parseKey(serializedKey),
      );
    }
    if (removed.size) this.notify();
  }

  getSnapshot<T>(key: QueryKey | string): QueryResult<T> | undefined {
    const serializedKey = typeof key === 'string' ? key : serializeQueryKey(key);
    return this.states.get(serializedKey) as QueryResult<T> | undefined;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test/lifecycle helper: resolve once all in-flight fetches have settled. */
  async waitForIdle(): Promise<void> {
    const pending = Array.from(this.inFlight.values());
    await Promise.all(pending);
  }

  private async execute<T>(
    options: QueryFetchOptions<T>,
    serializedKey: string,
    generation: number,
  ): Promise<QueryResult<T>> {
    const ttlMs = options.ttlMs ?? this.defaults.ttlMs;
    const retries = Math.max(0, options.retries ?? this.defaults.retries);
    const retryDelayMs = Math.max(0, options.retryDelayMs ?? this.defaults.retryDelayMs);
    const timeoutMs = Math.max(1, options.timeoutMs ?? this.defaults.timeoutMs);
    const cached = this.cache.peek<T>(serializedKey);
    const started = this.now();

    this.setState(serializedKey, {
      status: 'loading',
      data: cached?.data,
      isFetching: true,
      fromCache: Boolean(cached),
      attempts: 0,
    });
    this.emit('fetch_start', options.key, { tags: options.tags });

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('query timeout')), timeoutMs);
      try {
        const data = await options.fetcher({
          signal: controller.signal,
          attempt,
          key: options.key,
        });
        clearTimeout(timer);
        const result: QueryResult<T> = {
          status: 'success',
          data,
          isFetching: false,
          fromCache: false,
          attempts: attempt + 1,
          fetchedAt: this.now(),
        };
        if ((this.generations.get(serializedKey) ?? 0) !== generation) {
          // Invalidated while in flight: never resurrect stale data.
          return result;
        }
        this.cache.set(options.key, data, { ttlMs, tags: options.tags });
        this.setState(serializedKey, result);
        this.emit('fetch_success', options.key, {
          durationMs: this.now() - started,
          attempts: attempt + 1,
          tags: options.tags,
        });
        this.notify();
        return result;
      } catch (error) {
        clearTimeout(timer);
        if (attempt < retries && isRetryableQueryError(error)) {
          this.emit('retry', options.key, {
            attempts: attempt + 1,
            tags: options.tags,
            error: queryErrorMessage(error),
          });
          await this.sleep(retryDelayMs * 2 ** attempt);
          continue;
        }

        const result: QueryResult<T> = {
          status: 'error',
          error,
          data: cached?.data,
          isFetching: false,
          fromCache: Boolean(cached),
          attempts: attempt + 1,
          fetchedAt: cached?.storedAt,
        };
        if ((this.generations.get(serializedKey) ?? 0) !== generation) {
          return result;
        }
        this.setState(serializedKey, result);
        this.emit('fetch_error', options.key, {
          attempts: attempt + 1,
          durationMs: this.now() - started,
          tags: options.tags,
          error: queryErrorMessage(error),
        });
        this.logger?.warn('query fetch failed', {
          key: describeQueryKey(options.key),
          error: queryErrorMessage(error),
          attempts: attempt + 1,
        });
        this.notify();
        return result;
      }
    }

    throw new Error('Unreachable query retry state');
  }

  private clearInFlight(serializedKey: string, promise: Promise<QueryResult<unknown>>): void {
    if (this.inFlight.get(serializedKey) === promise) {
      this.inFlight.delete(serializedKey);
      this.inFlightMeta.delete(serializedKey);
    }
  }

  private fromEntry<T>(entry: QueryEntry<T>, fromCache: boolean): QueryResult<T> {
    return {
      status: 'success',
      data: entry.data,
      isFetching: false,
      fromCache,
      fetchedAt: entry.storedAt,
      attempts: 0,
    };
  }

  private setState<T>(serializedKey: string, result: QueryResult<T>): void {
    this.states.set(serializedKey, result as QueryResult<unknown>);
  }

  private parseKey(serializedKey: string): QueryKey {
    try {
      const parsed = JSON.parse(serializedKey);
      return Array.isArray(parsed) ? (parsed as QueryKey) : [serializedKey];
    } catch {
      return [serializedKey];
    }
  }

  private emit(
    type: QueryEvent['type'],
    key: QueryKey,
    extra: Partial<Omit<QueryEvent, 'type' | 'key' | 'keyParts' | 'at'>> = {},
  ): void {
    this.telemetry?.emit({ type, key: serializeQueryKey(key), keyParts: key, at: this.now(), ...extra });
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (error) {
        this.logger?.warn('query subscriber failed', { error: queryErrorMessage(error) });
      }
    }
  }
}
