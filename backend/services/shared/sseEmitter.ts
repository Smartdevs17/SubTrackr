/**
 * Issue #768 – Server-Sent Events (SSE) Emitter
 *
 * Wraps an `http.ServerResponse` and provides a typed interface for sending
 * SSE events. Correctly handles:
 *  - Required headers (Content-Type, Cache-Control, Connection)
 *  - Client-disconnect cleanup
 *  - Event ID and retry fields
 *  - Heartbeat keep-alive pings
 */

import type http from 'node:http';

// ─────────────────────────────────────────────────────────────────────────────
// SSE event types (matches what the client-side hook expects)
// ─────────────────────────────────────────────────────────────────────────────

export type SseEventName = 'progress' | 'chunk' | 'complete' | 'error' | 'ping';

export interface SseProgressData {
  /** 0–100 */
  percent: number;
  /** Human-readable stage label */
  message: string;
  /** Records processed so far */
  recordsProcessed: number;
  /** Total records (if known) */
  totalRecords?: number;
}

export interface SseChunkData {
  /** Serialised payload fragment */
  payload: string;
  /** Sequential chunk index starting at 0 */
  index: number;
}

export interface SseCompleteData {
  /** Final download URL or inline payload for small exports */
  downloadUrl?: string;
  /** Inline payload (if small enough to embed) */
  data?: unknown;
  /** Total records exported */
  totalRecords: number;
  /** Export checksum for client-side validation */
  checksum?: string;
}

export interface SseErrorData {
  message: string;
  code?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SseEmitter
// ─────────────────────────────────────────────────────────────────────────────

export class SseEmitter {
  private readonly res: http.ServerResponse;
  private eventId = 0;
  private closed = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: { heartbeatMs?: number; retryMs?: number } = {}
  ) {
    this.res = res;

    // Set SSE headers before any data is written
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx proxy buffering
      'Access-Control-Allow-Origin': '*',
    });

    // Send retry hint if configured
    if (options.retryMs) {
      res.write(`retry: ${options.retryMs}\n\n`);
    }

    // Clean up on client disconnect
    req.on('close', () => {
      this.closed = true;
      this.stopHeartbeat();
    });

    // Optional keep-alive heartbeat
    if (options.heartbeatMs && options.heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        if (!this.closed) this.ping();
      }, options.heartbeatMs);
    }
  }

  /** Whether the underlying connection has been closed by the client. */
  get isConnected(): boolean {
    return !this.closed;
  }

  /** Send an SSE event with typed data. */
  send<D>(event: SseEventName, data: D): void {
    if (this.closed) return;
    const id = ++this.eventId;
    const payload = [
      `id: ${id}`,
      `event: ${event}`,
      `data: ${JSON.stringify(data)}`,
      '',
      '',
    ].join('\n');
    this.res.write(payload);
  }

  /** Emit a progress update (0–100%). */
  progress(data: SseProgressData): void {
    this.send('progress', data);
  }

  /** Emit a data chunk (for large exports sent in pieces). */
  chunk(data: SseChunkData): void {
    this.send('chunk', data);
  }

  /** Signal successful completion. Closes the stream. */
  complete(data: SseCompleteData): void {
    this.send('complete', data);
    this.close();
  }

  /** Signal an error. Closes the stream. */
  error(data: SseErrorData): void {
    this.send('error', data);
    this.close();
  }

  /** Send a heartbeat ping (keeps the connection alive through proxies). */
  ping(): void {
    if (this.closed) return;
    // SSE comment — proxies must forward this
    this.res.write(': ping\n\n');
  }

  /** Gracefully close the SSE stream. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    this.res.end();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
