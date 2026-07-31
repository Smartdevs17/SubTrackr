/**
 * Issue #768 – API Response Streaming for Large Datasets
 *
 * Core streaming primitives:
 *  - CursorPage<T>            page envelope returned by cursor-paginated endpoints
 *  - AsyncCursorStream<T>     async-generator helper that lazily yields cursor pages
 *  - MemoryMonitor            lightweight RSS/heap watcher with configurable thresholds
 *  - encodeOpaqueCursor /
 *    decodeOpaqueCursor       base64-JSON cursor encode/decode (store-agnostic)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cursor pagination types
// ─────────────────────────────────────────────────────────────────────────────

/** A single page of results returned by a cursor-paginated endpoint. */
export interface CursorPage<T> {
  /** Items in this page. */
  items: T[];
  /**
   * Opaque cursor pointing to the next page.
   * `null` means this is the last page.
   */
  nextCursor: string | null;
  /** Total number of records matching the query (may be omitted for performance). */
  total?: number;
  /** Page size used for this response. */
  pageSize: number;
}

/** Options shared by all cursor-paginated queries. */
export interface CursorQueryOptions {
  /** Opaque cursor returned by a previous page request. */
  afterCursor?: string;
  /** Maximum records per page. Default: 100. */
  limit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Opaque cursor helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode an arbitrary payload into an opaque, URL-safe cursor token.
 * Uses base64url encoding of a JSON-serialised object.
 */
export function encodeOpaqueCursor(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode an opaque cursor token back into its original payload.
 * Returns `null` if the token is invalid or cannot be parsed.
 */
export function decodeOpaqueCursor(token: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AsyncCursorStream
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A function that fetches one page of data given a cursor and limit.
 * The implementation is store-specific (in-memory, Postgres keyset, etc.).
 */
export type PageFetcher<T> = (
  afterCursor: string | null,
  limit: number
) => Promise<CursorPage<T>>;

/**
 * Async generator that lazily yields pages from a cursor-paginated data source.
 *
 * Usage:
 * ```ts
 * const stream = createCursorStream(fetchPage, { limit: 50 });
 * for await (const page of stream) {
 *   // process page.items without holding the whole dataset in memory
 * }
 * ```
 */
export async function* createCursorStream<T>(
  fetcher: PageFetcher<T>,
  options: CursorQueryOptions = {}
): AsyncGenerator<CursorPage<T>> {
  const limit = Math.max(1, options.limit ?? 100);
  let cursor: string | null = options.afterCursor ?? null;

  do {
    const page = await fetcher(cursor, limit);
    yield page;
    cursor = page.nextCursor;
  } while (cursor !== null);
}

/**
 * Collect all pages from a cursor stream into a single flat array.
 * Only use for small datasets where you are sure the result fits in memory.
 */
export async function collectStream<T>(
  fetcher: PageFetcher<T>,
  options: CursorQueryOptions = {}
): Promise<T[]> {
  const all: T[] = [];
  for await (const page of createCursorStream(fetcher, options)) {
    all.push(...page.items);
  }
  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// MemoryMonitor
// ─────────────────────────────────────────────────────────────────────────────

export interface MemorySnapshot {
  /** Resident Set Size in bytes. */
  rss: number;
  /** Total heap allocated in bytes. */
  heapTotal: number;
  /** Heap actually used in bytes. */
  heapUsed: number;
  /** V8 external memory in bytes. */
  external: number;
  /** Array buffer memory in bytes. */
  arrayBuffers: number;
  /** ISO-8601 timestamp. */
  capturedAt: string;
}

export interface MemoryMonitorConfig {
  /** RSS threshold in bytes. Warning emitted when exceeded. Default: 500 MB. */
  rssThresholdBytes?: number;
  /** Heap-used threshold in bytes. Warning emitted when exceeded. Default: 256 MB. */
  heapThresholdBytes?: number;
  /** Called when a threshold is crossed. */
  onThresholdExceeded?: (snapshot: MemorySnapshot, field: keyof MemorySnapshot) => void;
}

/** Lightweight memory watcher. Captures snapshots on demand or periodically. */
export class MemoryMonitor {
  private readonly rssThreshold: number;
  private readonly heapThreshold: number;
  private readonly onThreshold: MemoryMonitorConfig['onThresholdExceeded'];

  constructor(config: MemoryMonitorConfig = {}) {
    this.rssThreshold = config.rssThresholdBytes ?? 500 * 1024 * 1024; // 500 MB
    this.heapThreshold = config.heapThresholdBytes ?? 256 * 1024 * 1024; // 256 MB
    this.onThreshold = config.onThresholdExceeded;
  }

  /** Capture current memory snapshot. */
  snapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    return {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Check memory and fire the threshold callback if exceeded.
   * Returns the snapshot for callers that want to surface metrics.
   */
  check(): MemorySnapshot {
    const snap = this.snapshot();
    if (snap.rss > this.rssThreshold) {
      this.onThreshold?.(snap, 'rss');
    }
    if (snap.heapUsed > this.heapThreshold) {
      this.onThreshold?.(snap, 'heapUsed');
    }
    return snap;
  }

  /** Format snapshot as human-readable string (for logging). */
  static format(snap: MemorySnapshot): string {
    const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return (
      `RSS=${mb(snap.rss)} heap=${mb(snap.heapUsed)}/${mb(snap.heapTotal)} ` +
      `ext=${mb(snap.external)} ts=${snap.capturedAt}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NDJSON helpers (used by streaming HTTP endpoints)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialise a value to a single NDJSON line (JSON + newline).
 * Safe for use with chunked-transfer HTTP responses.
 */
export function toNdjsonLine(value: unknown): string {
  return JSON.stringify(value) + '\n';
}

/**
 * Parse a buffer of NDJSON text into typed records.
 * Lines that fail to parse are silently skipped.
 */
export function parseNdjsonBuffer<T>(buffer: string): T[] {
  return buffer
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}
