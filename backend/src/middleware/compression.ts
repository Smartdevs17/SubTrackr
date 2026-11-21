/**
 * Gateway response compression middleware (Issue #2080).
 *
 * Negotiates `Content-Encoding` from `Accept-Encoding` (Brotli first, gzip
 * fallback, q-values respected), compresses only eligible payloads, and streams
 * the compressed bytes instead of buffering the whole response in memory.
 *
 * Design notes:
 *  - Negotiation is delegated to the shared `negotiateEncoding()` helper so the
 *    gateway cannot drift from `/metrics/compression` semantics.
 *  - The first `threshold` bytes are buffered so tiny responses stay identity;
 *    once the threshold is crossed a zlib stream is started and the buffer is
 *    flushed through it.
 *  - `Vary: Accept-Encoding` is appended, never overwritten.
 *  - Skips: skip-list paths, HEAD/1xx/204/304, already-encoded responses,
 *    `Cache-Control: no-transform`, non-compressible content types, and
 *    clients that negotiate `identity`.
 */

import type { Request, Response, NextFunction } from 'express';
import {
  createBrotliCompress,
  createGzip,
  constants as zlibConstants,
  type Transform,
} from 'node:zlib';
import {
  DEFAULT_COMPRESSION_CONFIG,
  X_COMPRESSION_LEVEL_HEADER,
  resolveCompressionConfig,
  shouldSkipCompression,
  type GlobalCompressionConfig,
} from '../../config/compression';
import {
  compressionMetrics,
  negotiateEncoding,
  type Encoding,
} from '../../services/shared/compression';

export interface CompressionLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export type CompressionSkipReason =
  | 'skip-pattern'
  | 'no-accept-encoding'
  | 'identity-negotiated'
  | 'request-method'
  | 'response-status'
  | 'already-encoded'
  | 'no-transform'
  | 'uncompressible-type'
  | 'below-threshold'
  | 'headers-sent'
  | 'compression-error';

export interface CompressionEvent {
  path: string;
  encoding: 'br' | 'gzip' | 'identity';
  outcome: 'compressed' | 'identity' | 'fallback';
  reason?: CompressionSkipReason;
  originalBytes: number;
  compressedBytes: number;
  durationMs: number;
}

export interface GatewayCompressionOptions {
  config?: GlobalCompressionConfig;
  logger?: CompressionLogger;
  onMetrics?: (event: CompressionEvent) => void;
  now?: () => number;
  /** Content types eligible for compression. Defaults to text/* and JSON/JS. */
  compressibleTypes?: RegExp;
}

const DEFAULT_COMPRESSIBLE_TYPES = /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml|application\/graphql-response\+json)/i;

function headerValue(res: Response, name: string): string | undefined {
  const value = res.getHeader(name);
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.join(', ');
  return undefined;
}

function appendVary(res: Response): void {
  const existing = headerValue(res, 'Vary');
  if (!existing) {
    res.setHeader('Vary', 'Accept-Encoding');
    return;
  }
  if (/\baccept-encoding\b/i.test(existing)) return;
  res.setHeader('Vary', `${existing}, Accept-Encoding`);
}

function toBuffer(chunk: unknown, encoding?: string): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, (encoding as BufferEncoding | undefined) ?? 'utf8');
  }
  return Buffer.from(JSON.stringify(chunk));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/** Counters for the gateway middleware, exported for admin/metrics surfaces. */
class GatewayCompressionMetrics {
  private requests = 0;
  private compressed = 0;
  private identity = 0;
  private fallbacks = 0;
  private brotli = 0;
  private gzip = 0;
  private originalBytes = 0;
  private compressedBytes = 0;

  record(event: CompressionEvent): void {
    this.requests += 1;
    this.originalBytes += event.originalBytes;
    this.compressedBytes += event.compressedBytes;
    if (event.outcome === 'compressed') {
      this.compressed += 1;
      if (event.encoding === 'br') this.brotli += 1;
      if (event.encoding === 'gzip') this.gzip += 1;
    } else if (event.outcome === 'fallback') {
      this.fallbacks += 1;
    } else {
      this.identity += 1;
    }
  }

  snapshot() {
    return {
      requests: this.requests,
      compressed: this.compressed,
      identity: this.identity,
      fallbacks: this.fallbacks,
      brotli: this.brotli,
      gzip: this.gzip,
      originalBytes: this.originalBytes,
      compressedBytes: this.compressedBytes,
      avgRatio:
        this.originalBytes === 0
          ? 1
          : Math.round((this.compressedBytes / this.originalBytes) * 10_000) / 10_000,
    };
  }

  reset(): void {
    this.requests = 0;
    this.compressed = 0;
    this.identity = 0;
    this.fallbacks = 0;
    this.brotli = 0;
    this.gzip = 0;
    this.originalBytes = 0;
    this.compressedBytes = 0;
  }
}

export const gatewayCompressionMetrics = new GatewayCompressionMetrics();

export function gatewayCompressionPrometheusMetrics(
  namespace = 'subtrackr_gateway_compression',
): string {
  const m = gatewayCompressionMetrics.snapshot();
  return [
    `# HELP ${namespace}_requests_total Responses evaluated by the gateway`,
    `# TYPE ${namespace}_requests_total counter`,
    `${namespace}_requests_total ${m.requests}`,
    `# HELP ${namespace}_compressed_total Responses compressed`,
    `# TYPE ${namespace}_compressed_total counter`,
    `${namespace}_compressed_total ${m.compressed}`,
    `# HELP ${namespace}_identity_total Responses intentionally left uncompressed`,
    `# TYPE ${namespace}_identity_total counter`,
    `${namespace}_identity_total ${m.identity}`,
    `# HELP ${namespace}_fallbacks_total Compression failures that fell back to identity`,
    `# TYPE ${namespace}_fallbacks_total counter`,
    `${namespace}_fallbacks_total ${m.fallbacks}`,
    `# HELP ${namespace}_brotli_total Brotli-compressed responses`,
    `# TYPE ${namespace}_brotli_total counter`,
    `${namespace}_brotli_total ${m.brotli}`,
    `# HELP ${namespace}_gzip_total Gzip-compressed responses`,
    `# TYPE ${namespace}_gzip_total counter`,
    `${namespace}_gzip_total ${m.gzip}`,
    `# HELP ${namespace}_avg_ratio Average compressed/original byte ratio`,
    `# TYPE ${namespace}_avg_ratio gauge`,
    `${namespace}_avg_ratio ${m.avgRatio}`,
  ].join('\n');
}

/**
 * Produce the Express middleware. One instance can be shared by all routes;
 * all per-request state is closed over inside the returned handler.
 */
export function compressionMiddleware(options: GatewayCompressionOptions = {}) {
  const config = options.config ?? DEFAULT_COMPRESSION_CONFIG;
  const compressibleTypes = options.compressibleTypes ?? DEFAULT_COMPRESSIBLE_TYPES;
  const now = options.now ?? Date.now;
  const logger: CompressionLogger = options.logger ?? {
    debug: () => undefined,
    warn: (message, meta) => console.warn(message, meta ?? ''),
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const path = req.path || req.url?.split('?')[0] || '/';
    const startedAt = now();
    const acceptHeader = req.headers?.['accept-encoding'];
    const acceptEncoding = Array.isArray(acceptHeader) ? acceptHeader.join(',') : acceptHeader;
    const negotiated: Encoding = negotiateEncoding(acceptEncoding);
    const routeConfig = resolveCompressionConfig(
      config,
      path,
      parseRuntimeLevel(headerValue(res, X_COMPRESSION_LEVEL_HEADER)),
    );
    const threshold = Math.max(0, routeConfig.threshold);

    let evaluated = false;
    let skipReason: CompressionSkipReason | undefined;
    let encoding: 'br' | 'gzip' = negotiated === 'br' ? 'br' : 'gzip';
    let originalBytes = 0;
    let compressedBytes = 0;
    let buffered: Buffer[] = [];
    let compressor: Transform | null = null;
    let compressionStarted = false;
    let failed = false;
    let reported = false;

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    const report = (outcome: CompressionEvent['outcome'], reason?: CompressionSkipReason): void => {
      if (reported) return;
      reported = true;
      const event: CompressionEvent = {
        path,
        encoding: compressionStarted && !failed ? encoding : 'identity',
        outcome,
        reason,
        originalBytes,
        compressedBytes: compressionStarted && !failed ? compressedBytes : originalBytes,
        durationMs: Math.max(0, now() - startedAt),
      };
      gatewayCompressionMetrics.record(event);
      compressionMetrics.totalRequests += 1;
      if (event.outcome === 'compressed') {
        compressionMetrics.compressed += 1;
        compressionMetrics.totalCompressedBytes += event.compressedBytes;
      } else {
        compressionMetrics.skipped += 1;
        compressionMetrics.totalCompressedBytes += event.originalBytes;
      }
      compressionMetrics.totalOriginalBytes += event.originalBytes;
      if (event.encoding === 'br' && event.outcome === 'compressed') compressionMetrics.brotliUsed += 1;
      if (event.encoding === 'gzip' && event.outcome === 'compressed') compressionMetrics.gzipUsed += 1;
      options.onMetrics?.(event);
      logger.debug('[gateway-compression] response', {
        path,
        encoding: event.encoding,
        outcome,
        reason: event.reason,
        originalBytes: event.originalBytes,
        compressedBytes: event.compressedBytes,
        durationMs: event.durationMs,
      });
    };

    const evaluate = (): void => {
      if (evaluated) return;
      evaluated = true;

      if (shouldSkipCompression(config, path)) skipReason = 'skip-pattern';
      else if (req.method === 'HEAD') skipReason = 'request-method';
      else if (res.statusCode < 200 || res.statusCode === 204 || res.statusCode === 304) {
        skipReason = 'response-status';
      } else if (headerValue(res, 'Content-Encoding')) skipReason = 'already-encoded';
      else if (/\bno-transform\b/i.test(headerValue(res, 'Cache-Control') ?? '')) {
        skipReason = 'no-transform';
      } else if (!compressibleTypes.test(headerValue(res, 'Content-Type') ?? '')) {
        skipReason = 'uncompressible-type';
      } else if (negotiated === 'identity') {
        skipReason = acceptEncoding ? 'identity-negotiated' : 'no-accept-encoding';
      } else if (res.headersSent) {
        skipReason = 'headers-sent';
      }

      // Clients that cannot negotiate a shared encoding still need to know the
      // response varies, so caches do not serve a compressed body to a client
      // that did not ask for it.
      if (
        !skipReason ||
        skipReason === 'no-accept-encoding' ||
        skipReason === 'identity-negotiated'
      ) {
        appendVary(res);
      }
    };

    const failToIdentity = (error: unknown): void => {
      if (failed) return;
      failed = true;
      logger.warn('[gateway-compression] compression failed; sending identity', {
        path,
        encoding,
        error: error instanceof Error ? error.message : String(error),
      });
      res.removeHeader('Content-Encoding');
      for (const chunk of buffered) originalWrite(chunk);
      buffered = [];
      compressor?.removeAllListeners('data');
      compressor?.removeAllListeners('error');
      compressor?.destroy();
      compressor = null;
      compressionStarted = false;
      compressedBytes = 0;
      report('fallback', 'compression-error');
    };

    const writeThroughCompressor = (buf: Buffer): void => {
      if (!compressor || failed) {
        originalWrite(buf);
        return;
      }
      // Keep the chunk replayable until zlib accepts it. A synchronous error
      // emitted from write() is handled by failToIdentity, which flushes the
      // buffered bytes before clearing them.
      buffered.push(buf);
      compressor.write(buf);
      if (!failed) buffered.pop();
    };

    const startCompression = (): void => {
      if (compressionStarted || failed) return;
      compressionStarted = true;
      res.setHeader('Content-Encoding', encoding);
      res.removeHeader('Content-Length');

      compressor =
        encoding === 'br'
          ? createBrotliCompress({
              params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: clamp(routeConfig.level, 0, 11),
              },
            })
          : createGzip({ level: clamp(routeConfig.level, 1, 9) });

      compressor.on('data', (chunk: Buffer) => {
        compressedBytes += chunk.length;
        originalWrite(chunk);
      });
      compressor.on('error', failToIdentity);

      const pending = buffered;
      buffered = [];
      for (const chunk of pending) {
        if (failed) break;
        writeThroughCompressor(chunk);
      }
    };

    const writeChunk = (chunk: unknown, encodingHint?: string): void => {
      if (chunk === undefined || chunk === null) return;
      const buf = toBuffer(chunk, encodingHint);
      originalBytes += buf.length;

      const identityCandidate =
        !skipReason ||
        skipReason === 'no-accept-encoding' ||
        skipReason === 'identity-negotiated';

      if (identityCandidate && !compressor && !failed && !res.headersSent) {
        buffered.push(buf);
        if (!skipReason && originalBytes >= threshold) startCompression();
        return;
      }
      if (failed) return;

      if (compressor) writeThroughCompressor(buf);
      else originalWrite(buf);
    };

    res.write = ((chunk: unknown, encodingOrCallback?: string | (() => void), callback?: () => void) => {
      evaluate();
      writeChunk(chunk, typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined);
      const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      cb?.();
      return true;
    }) as typeof res.write;

    res.end = ((
      chunk?: unknown,
      encodingOrCallback?: string | (() => void),
      callback?: () => void,
    ) => {
      evaluate();
      writeChunk(chunk, typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined);

      const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      const finish = (): void => {
        cb?.();
        originalEnd();
      };

      if (compressor) {
        compressor.end();
        compressor.once('end', () => {
          report('compressed');
          finish();
        });
      } else {
        if (!skipReason) skipReason = 'below-threshold';
        const recomputeLength =
          !skipReason ||
          skipReason === 'no-accept-encoding' ||
          skipReason === 'identity-negotiated' ||
          skipReason === 'below-threshold';
        if (recomputeLength && !res.headersSent && originalBytes > 0) {
          res.setHeader('Content-Length', originalBytes);
        }
        for (const pending of buffered) originalWrite(pending);
        buffered = [];
        report('identity', skipReason);
        finish();
      }
      return res;
    }) as typeof res.end;

    res.once('finish', () => {
      if (!reported) report(failed ? 'fallback' : 'identity', skipReason);
    });

    next();
  };
}

function parseRuntimeLevel(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const compression = compressionMiddleware();
