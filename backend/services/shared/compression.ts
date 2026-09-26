/**
 * Response Compression Middleware — SubTrackr
 *
 * Provides Brotli-first, gzip-fallback compression for HTTP responses.
 * Works with Node.js native `http` module (no Express required).
 *
 * Features:
 *  - Brotli (br) and gzip compression via Node.js zlib
 *  - Accept-Encoding negotiation with quality factor support
 *  - Per-response ETag generation (SHA-256 of body, base64url)
 *  - Cache-Control header attachment
 *  - Minimum size threshold to skip compressing tiny responses
 *  - Compression ratio and response-size metrics
 *  - Content-type filtering (only compress text/* and application/json)
 */

import { createBrotliCompress, createGzip, constants as zlibConstants } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface CompressionConfig {
  /** Minimum uncompressed byte size to apply compression. Default: 1024 */
  minSize?: number;
  /** Brotli quality 0–11. Default: 4 (fast, good ratio) */
  brotliQuality?: number;
  /** Gzip level 1–9. Default: 6 */
  gzipLevel?: number;
  /** Content-types eligible for compression. Default: text/* and application/json */
  compressibleTypes?: RegExp;
  /** Attach ETag header to compressed responses. Default: true */
  etag?: boolean;
}

const DEFAULTS: Required<CompressionConfig> = {
  minSize: 1024,
  brotliQuality: 4,
  gzipLevel: 6,
  compressibleTypes: /^(text\/|application\/json|application\/javascript)/,
  etag: true,
};

// ─── Metrics ──────────────────────────────────────────────────────────────────

export interface CompressionMetrics {
  totalRequests: number;
  compressed: number;
  skipped: number;
  brotliUsed: number;
  gzipUsed: number;
  totalOriginalBytes: number;
  totalCompressedBytes: number;
  /** Average compression ratio (compressed / original). Lower is better. */
  avgCompressionRatio: number;
}

class MetricsStore {
  totalRequests = 0;
  compressed = 0;
  skipped = 0;
  brotliUsed = 0;
  gzipUsed = 0;
  totalOriginalBytes = 0;
  totalCompressedBytes = 0;

  snapshot(): CompressionMetrics {
    const ratio =
      this.totalOriginalBytes === 0
        ? 1
        : this.totalCompressedBytes / this.totalOriginalBytes;
    return {
      totalRequests: this.totalRequests,
      compressed: this.compressed,
      skipped: this.skipped,
      brotliUsed: this.brotliUsed,
      gzipUsed: this.gzipUsed,
      totalOriginalBytes: this.totalOriginalBytes,
      totalCompressedBytes: this.totalCompressedBytes,
      avgCompressionRatio: Math.round(ratio * 10000) / 10000,
    };
  }

  reset(): void {
    this.totalRequests = 0;
    this.compressed = 0;
    this.skipped = 0;
    this.brotliUsed = 0;
    this.gzipUsed = 0;
    this.totalOriginalBytes = 0;
    this.totalCompressedBytes = 0;
  }
}

export const compressionMetrics = new MetricsStore();

// ─── Encoding Negotiation ─────────────────────────────────────────────────────

export type Encoding = 'br' | 'gzip' | 'identity';

/**
 * Parse Accept-Encoding header and return the best supported encoding.
 * Prefers br > gzip > identity, respecting q-values.
 */
export function negotiateEncoding(acceptEncoding: string | undefined): Encoding {
  if (!acceptEncoding) return 'identity';

  const encodings = acceptEncoding
    .split(',')
    .map((part) => {
      const [enc, q] = part.trim().split(';q=');
      return { enc: enc.trim().toLowerCase(), q: q !== undefined ? parseFloat(q) : 1.0 };
    })
    .filter(({ enc }) => ['br', 'gzip', 'deflate', 'identity', '*'].includes(enc))
    .sort((a, b) => b.q - a.q);

  for (const { enc, q } of encodings) {
    if (q <= 0) continue;
    if (enc === 'br') return 'br';
    if (enc === 'gzip' || enc === '*') return 'gzip';
    if (enc === 'identity') return 'identity';
  }

  return 'identity';
}

// ─── ETag Generation ──────────────────────────────────────────────────────────

export function generateETag(body: Buffer): string {
  const hash = createHash('sha256').update(body).digest('base64url');
  return `"${hash.slice(0, 27)}"`;
}

export function isETagMatch(req: IncomingMessage, etag: string): boolean {
  const ifNoneMatch = req.headers['if-none-match'];
  if (!ifNoneMatch) return false;
  return ifNoneMatch === etag || ifNoneMatch === '*';
}

// ─── Compression ─────────────────────────────────────────────────────────────

async function compressBrotli(data: Buffer, quality: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const br = createBrotliCompress({
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: quality },
    });
    br.on('data', (c: Buffer) => chunks.push(c));
    br.on('end', () => resolve(Buffer.concat(chunks)));
    br.on('error', reject);
    br.end(data);
  });
}

async function compressGzip(data: Buffer, level: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gz = createGzip({ level });
    gz.on('data', (c: Buffer) => chunks.push(c));
    gz.on('end', () => resolve(Buffer.concat(chunks)));
    gz.on('error', reject);
    gz.end(data);
  });
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export interface CompressionMiddlewareOptions extends CompressionConfig {
  /** Default Cache-Control value to set when not already present. Optional. */
  defaultCacheControl?: string;
}

/**
 * Apply Brotli/gzip compression + ETag to an HTTP response body.
 *
 * Works with Node.js native `http.ServerResponse` — no Express dependency.
 *
 * Usage in your request handler:
 * ```ts
 * await applyCompression(req, res, jsonBody, { 'Content-Type': 'application/json' });
 * ```
 */
export async function applyCompression(
  req: IncomingMessage,
  res: ServerResponse,
  body: string | Buffer,
  headers: Record<string, string> = {},
  options: CompressionMiddlewareOptions = {},
): Promise<void> {
  const cfg = { ...DEFAULTS, ...options };
  compressionMetrics.totalRequests++;

  const rawBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const contentType = headers['Content-Type'] ?? headers['content-type'] ?? 'application/octet-stream';
  const originalSize = rawBuffer.length;

  // ETag from the uncompressed body so it's encoding-independent
  let etag: string | undefined;
  if (cfg.etag) {
    etag = generateETag(rawBuffer);
    // Conditional GET: 304 Not Modified
    if (isETagMatch(req, etag)) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return;
    }
  }

  const shouldCompress =
    originalSize >= cfg.minSize && cfg.compressibleTypes.test(contentType);

  const acceptEncoding = req.headers['accept-encoding'] as string | undefined;
  const encoding: Encoding = shouldCompress ? negotiateEncoding(acceptEncoding) : 'identity';

  let responseBody = rawBuffer;
  let compressedSize = originalSize;

  if (encoding !== 'identity') {
    try {
      if (encoding === 'br') {
        responseBody = await compressBrotli(rawBuffer, cfg.brotliQuality);
        compressionMetrics.brotliUsed++;
      } else {
        responseBody = await compressGzip(rawBuffer, cfg.gzipLevel);
        compressionMetrics.gzipUsed++;
      }
      compressedSize = responseBody.length;
      compressionMetrics.compressed++;
    } catch {
      // Compression failed — fall back to uncompressed
      responseBody = rawBuffer;
      compressionMetrics.skipped++;
    }
  } else {
    compressionMetrics.skipped++;
  }

  compressionMetrics.totalOriginalBytes += originalSize;
  compressionMetrics.totalCompressedBytes += compressedSize;

  const responseHeaders: Record<string, string | number> = {
    ...headers,
    'Content-Length': responseBody.length,
    'Vary': 'Accept-Encoding',
  };

  if (encoding !== 'identity') {
    responseHeaders['Content-Encoding'] = encoding;
  }

  if (etag) {
    responseHeaders['ETag'] = etag;
  }

  if (cfg.defaultCacheControl && !responseHeaders['Cache-Control']) {
    responseHeaders['Cache-Control'] = cfg.defaultCacheControl;
  }

  res.writeHead(200, responseHeaders);
  res.end(responseBody);
}

// ─── Prometheus Metrics Export ────────────────────────────────────────────────

export function compressionPrometheusMetrics(namespace = 'subtrackr_compression'): string {
  const m = compressionMetrics.snapshot();
  return [
    `# HELP ${namespace}_requests_total Total responses processed`,
    `# TYPE ${namespace}_requests_total counter`,
    `${namespace}_requests_total ${m.totalRequests}`,
    `# HELP ${namespace}_compressed_total Responses that were compressed`,
    `# TYPE ${namespace}_compressed_total counter`,
    `${namespace}_compressed_total ${m.compressed}`,
    `# HELP ${namespace}_brotli_total Responses compressed with brotli`,
    `# TYPE ${namespace}_brotli_total counter`,
    `${namespace}_brotli_total ${m.brotliUsed}`,
    `# HELP ${namespace}_gzip_total Responses compressed with gzip`,
    `# TYPE ${namespace}_gzip_total counter`,
    `${namespace}_gzip_total ${m.gzipUsed}`,
    `# HELP ${namespace}_original_bytes_total Total uncompressed bytes`,
    `# TYPE ${namespace}_original_bytes_total counter`,
    `${namespace}_original_bytes_total ${m.totalOriginalBytes}`,
    `# HELP ${namespace}_compressed_bytes_total Total compressed bytes sent`,
    `# TYPE ${namespace}_compressed_bytes_total counter`,
    `${namespace}_compressed_bytes_total ${m.totalCompressedBytes}`,
    `# HELP ${namespace}_avg_ratio Average compression ratio (lower is better)`,
    `# TYPE ${namespace}_avg_ratio gauge`,
    `${namespace}_avg_ratio ${m.avgCompressionRatio}`,
  ].join('\n');
}
