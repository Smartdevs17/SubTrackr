/**
 * compression.test.ts — Unit tests for backend/services/shared/compression.ts
 *
 * Coverage:
 *  - negotiateEncoding: q-value parsing, br/gzip/identity selection, edge cases
 *  - generateETag / isETagMatch: hash generation, conditional GET detection
 *  - applyCompression: brotli, gzip, identity, below-threshold, 304, metrics,
 *    content-type filtering, defaultCacheControl, compression fallback
 *  - compressionPrometheusMetrics: output format
 *  - compressionMetrics: reset, avgCompressionRatio
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import * as zlib from 'node:zlib';
import {
  negotiateEncoding,
  generateETag,
  isETagMatch,
  applyCompression,
  compressionPrometheusMetrics,
  compressionMetrics,
  type CompressionMetrics,
} from '../compression';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    headers: {},
    ...overrides,
  } as unknown as IncomingMessage;
}

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string | number>;
  body: Buffer;
  ended: boolean;
}

function mockRes(): { res: ServerResponse; capture: () => CapturedResponse } {
  let statusCode = 200;
  const headers: Record<string, string | number> = {};
  const chunks: Buffer[] = [];
  let ended = false;

  const res = {
    writeHead(code: number, h: Record<string, string | number>) {
      statusCode = code;
      Object.assign(headers, h);
    },
    end(body?: Buffer) {
      if (body) chunks.push(body);
      ended = true;
    },
  } as unknown as ServerResponse;

  return {
    res,
    capture: () => ({
      statusCode,
      headers,
      body: Buffer.concat(chunks),
      ended,
    }),
  };
}

/** Build a buffer of repeated chars that compresses well */
function compressibleBody(size: number): Buffer {
  return Buffer.alloc(size, 'a');
}

/** Decompress brotli synchronously */
function decompressBr(buf: Buffer): Buffer {
  return zlib.brotliDecompressSync(buf);
}

/** Decompress gzip synchronously */
function decompressGz(buf: Buffer): Buffer {
  return zlib.gunzipSync(buf);
}

// ─── negotiateEncoding ────────────────────────────────────────────────────────

describe('negotiateEncoding', () => {
  it('returns identity when Accept-Encoding is absent', () => {
    expect(negotiateEncoding(undefined)).toBe('identity');
  });

  it('returns identity for empty string', () => {
    expect(negotiateEncoding('')).toBe('identity');
  });

  it('prefers br over gzip', () => {
    expect(negotiateEncoding('gzip, br')).toBe('br');
  });

  it('returns gzip when br is not present', () => {
    expect(negotiateEncoding('gzip, deflate')).toBe('gzip');
  });

  it('returns identity when only unsupported encodings are listed', () => {
    expect(negotiateEncoding('deflate, sdch')).toBe('identity');
  });

  it('respects q-values: gzip;q=1 beats br;q=0', () => {
    // br is present but q=0 means "not acceptable"
    expect(negotiateEncoding('br;q=0, gzip;q=1')).toBe('gzip');
  });

  it('wildcard * resolves to gzip', () => {
    expect(negotiateEncoding('*')).toBe('gzip');
  });

  it('handles whitespace around tokens', () => {
    expect(negotiateEncoding('  gzip  ,  br  ')).toBe('br');
  });

  it('handles single br token', () => {
    expect(negotiateEncoding('br')).toBe('br');
  });

  it('returns identity for identity token', () => {
    expect(negotiateEncoding('identity')).toBe('identity');
  });
});

// ─── generateETag ─────────────────────────────────────────────────────────────

describe('generateETag', () => {
  it('generates a quoted string', () => {
    const tag = generateETag(Buffer.from('hello'));
    expect(tag).toMatch(/^"[A-Za-z0-9_-]+"$/);
  });

  it('produces consistent output for the same input', () => {
    const body = Buffer.from('{"data": "test"}');
    expect(generateETag(body)).toBe(generateETag(body));
  });

  it('produces different ETags for different bodies', () => {
    const a = generateETag(Buffer.from('body-a'));
    const b = generateETag(Buffer.from('body-b'));
    expect(a).not.toBe(b);
  });

  it('handles empty buffer', () => {
    const tag = generateETag(Buffer.alloc(0));
    expect(tag).toMatch(/^".+"$/);
  });
});

// ─── isETagMatch ──────────────────────────────────────────────────────────────

describe('isETagMatch', () => {
  it('returns true when If-None-Match matches ETag', () => {
    const etag = '"abc123"';
    const req = mockReq({ headers: { 'if-none-match': etag } });
    expect(isETagMatch(req, etag)).toBe(true);
  });

  it('returns true for wildcard *', () => {
    const req = mockReq({ headers: { 'if-none-match': '*' } });
    expect(isETagMatch(req, '"anything"')).toBe(true);
  });

  it('returns false when If-None-Match does not match', () => {
    const req = mockReq({ headers: { 'if-none-match': '"old-etag"' } });
    expect(isETagMatch(req, '"new-etag"')).toBe(false);
  });

  it('returns false when If-None-Match is absent', () => {
    const req = mockReq({ headers: {} });
    expect(isETagMatch(req, '"abc"')).toBe(false);
  });
});

// ─── applyCompression — core behaviour ───────────────────────────────────────

describe('applyCompression — brotli', () => {
  beforeEach(() => compressionMetrics.reset());

  it('compresses with brotli when Accept-Encoding: br', async () => {
    const body = compressibleBody(2048);
    const req = mockReq({ headers: { 'accept-encoding': 'br' } });
    const { res, capture } = mockRes();

    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });

    const { headers, body: responseBody } = capture();
    expect(headers['Content-Encoding']).toBe('br');
    expect(headers['Vary']).toBe('Accept-Encoding');
    expect(decompressBr(responseBody).toString()).toBe(body.toString());
  });

  it('sets ETag header on brotli response', async () => {
    const body = compressibleBody(2048);
    const req = mockReq({ headers: { 'accept-encoding': 'br' } });
    const { res, capture } = mockRes();

    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });

    const { headers } = capture();
    expect(headers['ETag']).toMatch(/^".+"$/);
  });

  it('increments brotliUsed metric', async () => {
    const body = compressibleBody(2048);
    const req = mockReq({ headers: { 'accept-encoding': 'br' } });
    const { res } = mockRes();
    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });
    expect(compressionMetrics.snapshot().brotliUsed).toBe(1);
  });
});

describe('applyCompression — gzip', () => {
  beforeEach(() => compressionMetrics.reset());

  it('compresses with gzip when Accept-Encoding: gzip', async () => {
    const body = compressibleBody(2048);
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res, capture } = mockRes();

    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });

    const { headers, body: responseBody } = capture();
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(decompressGz(responseBody).toString()).toBe(body.toString());
  });

  it('increments gzipUsed metric', async () => {
    const body = compressibleBody(2048);
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res } = mockRes();
    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });
    expect(compressionMetrics.snapshot().gzipUsed).toBe(1);
  });

  it('Content-Length matches the compressed body length', async () => {
    const body = compressibleBody(4096);
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res, capture } = mockRes();
    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });
    const { headers, body: responseBody } = capture();
    expect(headers['Content-Length']).toBe(responseBody.length);
  });
});

describe('applyCompression — identity / threshold', () => {
  beforeEach(() => compressionMetrics.reset());

  it('skips compression for bodies below minSize', async () => {
    const body = Buffer.from('{"small":true}'); // < 1024 bytes
    const req = mockReq({ headers: { 'accept-encoding': 'br' } });
    const { res, capture } = mockRes();

    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });

    const { headers, body: responseBody } = capture();
    expect(headers['Content-Encoding']).toBeUndefined();
    expect(responseBody.toString()).toBe(body.toString());
    expect(compressionMetrics.snapshot().skipped).toBe(1);
  });

  it('skips compression for non-compressible content types', async () => {
    const body = compressibleBody(2048);
    const req = mockReq({ headers: { 'accept-encoding': 'br' } });
    const { res, capture } = mockRes();

    await applyCompression(req, res, body, { 'Content-Type': 'image/png' });

    const { headers } = capture();
    expect(headers['Content-Encoding']).toBeUndefined();
    expect(compressionMetrics.snapshot().skipped).toBe(1);
  });

  it('does not compress when Accept-Encoding is absent', async () => {
    const body = compressibleBody(2048);
    const req = mockReq({ headers: {} });
    const { res, capture } = mockRes();

    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });

    const { headers } = capture();
    expect(headers['Content-Encoding']).toBeUndefined();
  });

  it('accepts string body and treats it as UTF-8', async () => {
    const text = 'x'.repeat(2048);
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res, capture } = mockRes();

    await applyCompression(req, res, text, { 'Content-Type': 'text/plain' });

    const { headers, body } = capture();
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(decompressGz(body).toString()).toBe(text);
  });
});

describe('applyCompression — 304 Not Modified', () => {
  beforeEach(() => compressionMetrics.reset());

  it('returns 304 when If-None-Match matches', async () => {
    const body = compressibleBody(2048);

    // First request: get ETag
    const req1 = mockReq({ headers: { 'accept-encoding': 'br' } });
    const { res: res1, capture: cap1 } = mockRes();
    await applyCompression(req1, res1, body, { 'Content-Type': 'application/json' });
    const etag = cap1().headers['ETag'] as string;
    expect(etag).toBeDefined();

    // Second request: conditional GET
    const req2 = mockReq({ headers: { 'if-none-match': etag, 'accept-encoding': 'br' } });
    const { res: res2, capture: cap2 } = mockRes();
    await applyCompression(req2, res2, body, { 'Content-Type': 'application/json' });

    const { statusCode, body: responseBody } = cap2();
    expect(statusCode).toBe(304);
    expect(responseBody.length).toBe(0);
  });

  it('responds 200 when If-None-Match does not match', async () => {
    const body = compressibleBody(2048);
    const req = mockReq({
      headers: { 'if-none-match': '"stale-etag"', 'accept-encoding': 'br' },
    });
    const { res, capture } = mockRes();
    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });
    expect(capture().statusCode).toBe(200);
  });
});

describe('applyCompression — options', () => {
  beforeEach(() => compressionMetrics.reset());

  it('respects custom minSize', async () => {
    const body = compressibleBody(500); // 500 bytes
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res, capture } = mockRes();

    // Lower threshold to 100 → should compress 500-byte body
    await applyCompression(req, res, body, { 'Content-Type': 'application/json' }, { minSize: 100 });

    const { headers } = capture();
    expect(headers['Content-Encoding']).toBe('gzip');
  });

  it('respects etag: false — no ETag header', async () => {
    const body = compressibleBody(2048);
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res, capture } = mockRes();

    await applyCompression(req, res, body, { 'Content-Type': 'application/json' }, { etag: false });

    expect(capture().headers['ETag']).toBeUndefined();
  });

  it('sets Cache-Control when defaultCacheControl is provided', async () => {
    const body = compressibleBody(2048);
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res, capture } = mockRes();

    await applyCompression(
      req, res, body,
      { 'Content-Type': 'application/json' },
      { defaultCacheControl: 'public, max-age=3600' },
    );

    expect(capture().headers['Cache-Control']).toBe('public, max-age=3600');
  });

  it('does not override Cache-Control when already set in headers', async () => {
    const body = compressibleBody(2048);
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res, capture } = mockRes();

    await applyCompression(
      req, res, body,
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      { defaultCacheControl: 'public, max-age=3600' },
    );

    expect(capture().headers['Cache-Control']).toBe('no-store');
  });

  it('uses custom brotli quality', async () => {
    const body = compressibleBody(4096);
    const req = mockReq({ headers: { 'accept-encoding': 'br' } });
    const { res, capture } = mockRes();

    await applyCompression(
      req, res, body,
      { 'Content-Type': 'application/json' },
      { brotliQuality: 1 },
    );

    const { body: compressed } = capture();
    // Should still produce valid brotli
    expect(decompressBr(compressed).toString()).toBe(body.toString());
  });
});

// ─── applyCompression — metrics ───────────────────────────────────────────────

describe('applyCompression — metrics', () => {
  beforeEach(() => compressionMetrics.reset());

  it('increments totalRequests on every call', async () => {
    for (let i = 0; i < 5; i++) {
      const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
      const { res } = mockRes();
      await applyCompression(req, res, compressibleBody(2048), { 'Content-Type': 'application/json' });
    }
    expect(compressionMetrics.snapshot().totalRequests).toBe(5);
  });

  it('tracks totalOriginalBytes and totalCompressedBytes', async () => {
    const body = compressibleBody(4096);
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res } = mockRes();
    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });

    const m = compressionMetrics.snapshot();
    expect(m.totalOriginalBytes).toBe(4096);
    expect(m.totalCompressedBytes).toBeGreaterThan(0);
    expect(m.totalCompressedBytes).toBeLessThan(4096); // must be smaller
  });

  it('avgCompressionRatio is between 0 and 1 for compressible data', async () => {
    const body = compressibleBody(8192);
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res } = mockRes();
    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });

    const { avgCompressionRatio } = compressionMetrics.snapshot();
    expect(avgCompressionRatio).toBeGreaterThan(0);
    expect(avgCompressionRatio).toBeLessThan(1);
  });

  it('avgCompressionRatio is 1 when nothing has been compressed', () => {
    compressionMetrics.reset();
    expect(compressionMetrics.snapshot().avgCompressionRatio).toBe(1);
  });

  it('reset() clears all counters', async () => {
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res } = mockRes();
    await applyCompression(req, res, compressibleBody(2048), { 'Content-Type': 'application/json' });

    compressionMetrics.reset();
    const m = compressionMetrics.snapshot();
    expect(m.totalRequests).toBe(0);
    expect(m.brotliUsed).toBe(0);
    expect(m.gzipUsed).toBe(0);
    expect(m.compressed).toBe(0);
    expect(m.skipped).toBe(0);
  });
});

// ─── compressionPrometheusMetrics ─────────────────────────────────────────────

describe('compressionPrometheusMetrics', () => {
  beforeEach(() => compressionMetrics.reset());

  it('includes all expected metric names', async () => {
    const body = compressibleBody(4096);
    const req = mockReq({ headers: { 'accept-encoding': 'br' } });
    const { res } = mockRes();
    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });

    const output = compressionPrometheusMetrics();
    expect(output).toContain('requests_total');
    expect(output).toContain('compressed_total');
    expect(output).toContain('brotli_total');
    expect(output).toContain('gzip_total');
    expect(output).toContain('original_bytes_total');
    expect(output).toContain('compressed_bytes_total');
    expect(output).toContain('avg_ratio');
  });

  it('uses custom namespace', () => {
    const output = compressionPrometheusMetrics('myapp_compress');
    expect(output).toContain('myapp_compress_requests_total');
  });

  it('includes HELP and TYPE lines for each metric', () => {
    const output = compressionPrometheusMetrics();
    const helpLines = output.split('\n').filter((l) => l.startsWith('# HELP'));
    const typeLines = output.split('\n').filter((l) => l.startsWith('# TYPE'));
    expect(helpLines.length).toBeGreaterThanOrEqual(7);
    expect(typeLines.length).toBeGreaterThanOrEqual(7);
  });

  it('counter values are numeric', () => {
    const output = compressionPrometheusMetrics();
    const valueLines = output
      .split('\n')
      .filter((l) => !l.startsWith('#') && l.trim().length > 0);
    for (const line of valueLines) {
      const parts = line.split(' ');
      const value = parseFloat(parts[parts.length - 1]);
      expect(isNaN(value)).toBe(false);
    }
  });
});

// ─── Compression ratio performance benchmark ─────────────────────────────────

describe('compression ratio benchmarks', () => {
  beforeEach(() => compressionMetrics.reset());

  it('JSON data achieves at least 70% compression with gzip', async () => {
    // Realistic JSON — repeated structure compresses well
    const jsonData = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        id: `sub_${i}`,
        status: 'active',
        plan: 'monthly',
        amount: 9.99,
        currency: 'USD',
      })),
    );
    const body = Buffer.from(jsonData);
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res, capture } = mockRes();

    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });

    const { body: compressed } = capture();
    const ratio = compressed.length / body.length;
    expect(ratio).toBeLessThan(0.30); // 70%+ compression = ratio < 0.30
  });

  it('JSON data achieves at least 70% compression with brotli', async () => {
    const jsonData = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        id: `sub_${i}`,
        status: 'active',
        plan: 'monthly',
        amount: 9.99,
        currency: 'USD',
      })),
    );
    const body = Buffer.from(jsonData);
    const req = mockReq({ headers: { 'accept-encoding': 'br' } });
    const { res, capture } = mockRes();

    await applyCompression(req, res, body, { 'Content-Type': 'application/json' });

    const { body: compressed } = capture();
    const ratio = compressed.length / body.length;
    expect(ratio).toBeLessThan(0.30); // 70%+ compression
  });

  it('CSV data achieves at least 80% compression with gzip', async () => {
    const header = 'id,status,plan,amount,currency\n';
    const rows = Array.from(
      { length: 100 },
      (_, i) => `sub_${i},active,monthly,9.99,USD\n`,
    ).join('');
    const body = Buffer.from(header + rows);
    const req = mockReq({ headers: { 'accept-encoding': 'gzip' } });
    const { res, capture } = mockRes();

    await applyCompression(req, res, body, { 'Content-Type': 'text/csv' }, { minSize: 100 });

    const { body: compressed } = capture();
    const ratio = compressed.length / body.length;
    expect(ratio).toBeLessThan(0.20); // 80%+ compression = ratio < 0.20
  });
});
