/**
 * Issue #768 – Client-Side Streaming Service
 *
 * Provides typed utilities for:
 *  - Cursor-based pagination  (fetchCursorPage, collectAllPages)
 *  - NDJSON streaming         (streamNdjson)
 *  - Server-Sent Events       (subscribeToSse)
 *  - Memory stats             (getClientMemoryStats)
 *
 * Designed to work in React Native (no DOM EventSource) using fetch +
 * a manual NDJSON/SSE line parser over ReadableStream.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

/** A page of items from a cursor-paginated endpoint. */
export interface CursorPage<T> {
  items: T[];
  /** Opaque cursor for the next page. `null` = last page. */
  nextCursor: string | null;
  total?: number;
  pageSize: number;
}

/** Options for fetchCursorPage. */
export interface FetchPageOptions {
  /** Cursor returned by a previous page response. */
  cursor?: string | null;
  /** Maximum records per page. */
  limit?: number;
  /** Additional query params to append. */
  params?: Record<string, string>;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/** SSE event handlers used by subscribeToSse. */
export interface SseHandlers {
  onProgress?: (data: {
    percent: number;
    message: string;
    recordsProcessed: number;
    totalRecords?: number;
  }) => void;
  onChunk?: (data: { payload: string; index: number }) => void;
  onComplete?: (data: {
    downloadUrl?: string;
    data?: unknown;
    totalRecords: number;
    checksum?: string;
  }) => void;
  onError?: (data: { message: string; code?: string }) => void;
  /** Called when the SSE connection closes (cleanly or on error). */
  onClose?: () => void;
}

/** Client-side memory stats (where available). */
export interface ClientMemoryStats {
  /** Total JS heap size limit in bytes (Chrome / V8 only). */
  jsHeapSizeLimit?: number;
  /** Total JS heap size allocated in bytes. */
  totalJSHeapSize?: number;
  /** Current JS heap in use in bytes. */
  usedJSHeapSize?: number;
  capturedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor-based pagination
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a single cursor page from a paginated endpoint.
 *
 * The server must return a JSON body conforming to `CursorPage<T>`.
 */
export async function fetchCursorPage<T>(
  baseUrl: string,
  options: FetchPageOptions = {}
): Promise<CursorPage<T>> {
  const { cursor, limit = 100, params = {}, signal } = options;

  const isRelative = !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(baseUrl);
  const url = new URL(baseUrl, isRelative ? 'http://localhost' : undefined);
  if (cursor) url.searchParams.set('cursor', cursor);
  url.searchParams.set('limit', String(limit));
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const fetchUrl = isRelative ? url.pathname + url.search : url.toString();
  const res = await fetch(fetchUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`fetchCursorPage: HTTP ${res.status} – ${text}`);
  }

  return (await res.json()) as CursorPage<T>;
}

/**
 * Collect ALL pages from a cursor-paginated endpoint into a flat array.
 *
 * ⚠️  Only use for datasets you are sure fit in memory.
 */
export async function collectAllPages<T>(
  baseUrl: string,
  options: Omit<FetchPageOptions, 'cursor'> = {}
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null | undefined = undefined;

  do {
    const page = await fetchCursorPage<T>(baseUrl, { ...options, cursor });
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null && cursor !== undefined);

  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// NDJSON streaming
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch an NDJSON stream from `url` and call `onItem` for each parsed record.
 *
 * Processes data incrementally using the Streams API — never buffers the full
 * body in memory. Works in React Native via the Hermes fetch implementation.
 *
 * @param url      Endpoint returning `application/x-ndjson`
 * @param onItem   Called with each parsed record as it arrives
 * @param signal   Optional AbortSignal to cancel mid-stream
 */
export async function streamNdjson<T>(
  url: string,
  onItem: (item: T) => void | Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/x-ndjson, application/json' },
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`streamNdjson: HTTP ${res.status} – ${text}`);
  }

  if (!res.body) {
    // Fallback: body not streamable (e.g., old RN or test env)
    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        await onItem(JSON.parse(line) as T);
      } catch {
        // skip malformed lines
      }
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process all complete lines
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line.length === 0) continue;
        try {
          await onItem(JSON.parse(line) as T);
        } catch {
          // skip malformed lines
        }
      }
    }

    // Process any remaining data in buffer
    const remaining = buffer.trim();
    if (remaining.length > 0) {
      try {
        await onItem(JSON.parse(remaining) as T);
      } catch {
        // skip malformed trailing data
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-Sent Events (fetch-based, works in React Native)
// ─────────────────────────────────────────────────────────────────────────────

/** Parsed SSE message. */
interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

/** Parse raw SSE text block into a structured message. */
function parseSseBlock(block: string): SseMessage | null {
  const lines = block.split('\n');
  let event = 'message';
  let data = '';
  let id: string | undefined;

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      data += line.slice('data:'.length).trim();
    } else if (line.startsWith('id:')) {
      id = line.slice('id:'.length).trim();
    }
    // ignore 'retry:' and comments for now
  }

  if (!data) return null;
  return { event, data, id };
}

/**
 * Subscribe to a Server-Sent Events endpoint using `fetch` + ReadableStream.
 *
 * Compatible with React Native (no native `EventSource` required).
 *
 * Returns a cleanup function that aborts the connection.
 *
 * ```ts
 * const stop = subscribeToSse('/exports/stream/exp_123', {
 *   onProgress: (p) => setPercent(p.percent),
 *   onComplete: (d) => setDownloadUrl(d.downloadUrl),
 * });
 * // later: stop();
 * ```
 */
export function subscribeToSse(
  url: string,
  handlers: SseHandlers,
  signal?: AbortSignal
): () => void {
  const controller = new AbortController();
  const combinedSignal = signal ?? controller.signal;

  // Start in background — we return the cleanup function synchronously
  (async () => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: combinedSignal,
      });

      if (!res.ok) {
        handlers.onError?.({ message: `SSE connection failed: HTTP ${res.status}` });
        handlers.onClose?.();
        return;
      }

      if (!res.body) {
        handlers.onError?.({ message: 'SSE: response body not readable' });
        handlers.onClose?.();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (combinedSignal.aborted) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by double newlines
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';

          for (const block of blocks) {
            const trimmed = block.trim();
            if (!trimmed || trimmed.startsWith(':')) continue; // heartbeat/comment

            const msg = parseSseBlock(trimmed);
            if (!msg) continue;

            try {
              const payload = JSON.parse(msg.data) as unknown;
              switch (msg.event) {
                case 'progress':
                  handlers.onProgress?.(payload as Parameters<NonNullable<SseHandlers['onProgress']>>[0]);
                  break;
                case 'chunk':
                  handlers.onChunk?.(payload as Parameters<NonNullable<SseHandlers['onChunk']>>[0]);
                  break;
                case 'complete':
                  handlers.onComplete?.(payload as Parameters<NonNullable<SseHandlers['onComplete']>>[0]);
                  break;
                case 'error':
                  handlers.onError?.(payload as Parameters<NonNullable<SseHandlers['onError']>>[0]);
                  break;
              }
            } catch {
              // ignore parse errors for individual events
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        handlers.onError?.({
          message: err instanceof Error ? err.message : 'SSE connection error',
        });
      }
    } finally {
      handlers.onClose?.();
    }
  })();

  return () => controller.abort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Client memory stats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return client-side memory statistics where available.
 * In React Native / Hermes, `performance.memory` is not exposed,
 * so all heap fields will be `undefined`.
 */
export function getClientMemoryStats(): ClientMemoryStats {
  const mem = (
    typeof performance !== 'undefined'
      ? (performance as unknown as { memory?: Record<string, number> }).memory
      : undefined
  );

  return {
    jsHeapSizeLimit: mem?.['jsHeapSizeLimit'],
    totalJSHeapSize: mem?.['totalJSHeapSize'],
    usedJSHeapSize: mem?.['usedJSHeapSize'],
    capturedAt: new Date().toISOString(),
  };
}
