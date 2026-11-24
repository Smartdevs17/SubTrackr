/**
 * Upload request-size guard (Issue #2278).
 *
 * Enforces a `Content-Length` ceiling on upload routes so a hostile or
 * misbehaving client cannot buffer an unbounded body in memory. Reads
 * `content-length` (single value or array) and, when present and above
 * `maxBytes`, answers 413 `PAYLOAD_TOO_LARGE` without touching the request
 * body. Routes that do not declare a length are left untouched (the caller
 * cannot be sized without reading the stream).
 *
 * Framework-agnostic: only needs `req.headers`, `req.url` and a response that
 * implements `status().json()` + `setHeader()`, which Express and this repo's
 * HTTP router both satisfy.
 */

import { buildErrorEnvelope } from './errorEnvelope';

export interface UploadLimitsLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface UploadLimitsMetrics {
  rejectedTotal: number;
  reset(): void;
}

export interface UploadLimitsOptions {
  /** Maximum allowed request body in bytes. Default: 10 MiB. */
  maxBytes?: number;
  /** Paths (regex or exact strings) the limit applies to. Defaults to all. */
  applyTo?: Array<RegExp | string>;
  logger?: UploadLimitsLogger;
  now?: () => number;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const PAYLOAD_TOO_LARGE = 413;

function contentLengthBytes(headers: Record<string, unknown>): number | undefined {
  const raw = headers['content-length'];
  if (raw === undefined || raw === null) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const parsed = Number.parseInt(String(value).trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function pathMatches(path: string, rules: Array<RegExp | string>): boolean {
  for (const rule of rules) {
    if (rule instanceof RegExp) {
      if (rule.test(path)) return true;
    } else if (path === rule || path.startsWith(rule + '/') || path === rule + '/') {
      return true;
    }
  }
  return false;
}

class UploadLimitsMetricsImpl implements UploadLimitsMetrics {
  rejectedTotal = 0;
  reset(): void {
    this.rejectedTotal = 0;
  }
}

export const uploadLimitsMetrics = new UploadLimitsMetricsImpl();

const noopLogger: UploadLimitsLogger = {
  debug: () => undefined,
  warn: () => undefined,
};

/**
 * Build the middleware. Rejects oversized uploads before the body is read.
 */
export function uploadLimitsMiddleware(options: UploadLimitsOptions = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const applyTo = options.applyTo;
  const logger: UploadLimitsLogger = options.logger ?? noopLogger;
  const metrics = uploadLimitsMetrics;

  return (req: { headers: Record<string, unknown>; url?: string }, res: { status(code: number): { json(body: unknown): void }; setHeader?(name: string, value: string): void }, next: () => void): void => {
    const path = req.url ? req.url.split('?')[0] : '/';
    if (applyTo && !pathMatches(path, applyTo)) {
      next();
      return;
    }

    const length = contentLengthBytes(req.headers ?? {});
    if (length === undefined || length <= maxBytes) {
      next();
      return;
    }

    metrics.rejectedTotal += 1;
    logger.warn('[upload-limits] request body exceeds ceiling', {
      path,
      contentLength: length,
      maxBytes,
    });
    res.status(PAYLOAD_TOO_LARGE).json(
      buildErrorEnvelope(PAYLOAD_TOO_LARGE, 'Request body exceeds upload size ceiling', {
        code: 'PAYLOAD_TOO_LARGE',
        maxBytes: String(maxBytes),
        received: String(length),
      }),
    );
    res.setHeader?.('X-Upload-Limit-Bytes', String(maxBytes));
  };
}

export { DEFAULT_MAX_BYTES, PAYLOAD_TOO_LARGE };
export type { UploadLimitsOptions, UploadLimitsLogger, UploadLimitsMetrics };
