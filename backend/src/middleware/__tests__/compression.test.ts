/** Unit/integration tests for gateway content-encoding negotiation (Issue #2080). */

jest.mock('node:zlib', () => ({
  __esModule: true,
  ...jest.requireActual<typeof import('node:zlib')>('node:zlib'),
}));

import { EventEmitter, once } from 'events';
import * as zlib from 'node:zlib';
import {
  compressionMiddleware,
  gatewayCompressionMetrics,
  gatewayCompressionPrometheusMetrics,
  type CompressionEvent,
} from '../compression';

class FakeRequest extends EventEmitter {
  method = 'GET';
  url: string;
  path: string;
  headers: Record<string, string>;

  constructor(path: string, headers: Record<string, string> = {}, method = 'GET') {
    super();
    this.path = path;
    this.url = `${path}?fixture=1`;
    this.headers = headers;
    this.method = method;
  }
}

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  private readonly headers = new Map<string, string | number | string[]>();
  private readonly chunks: Buffer[] = [];

  getHeader(name: string): string | number | string[] | undefined {
    return this.headers.get(name.toLowerCase());
  }

  setHeader(name: string, value: string | number | string[]): this {
    if (this.headersSent) throw new Error('Cannot set headers after they are sent');
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase());
  }

  write(chunk: unknown): boolean {
    this.headersSent = true;
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  }

  end(chunk?: unknown): this {
    if (chunk !== undefined && chunk !== null) this.write(chunk);
    this.emit('finish');
    return this;
  }

  get body(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

const LARGE_BODY = JSON.stringify({
  items: Array.from({ length: 300 }, (_, index) => ({
    id: `sub_${index}`,
    name: `Subscription number ${index}`,
    status: index % 2 === 0 ? 'active' : 'canceled',
  })),
});

/** Above the /api/exports/dump threshold (512) but below the default (1024). */
const MEDIUM_BODY = 'payload-'.repeat(90);

async function run(options: {
  path?: string;
  acceptEncoding?: string;
  body?: string;
  contentType?: string;
  responseHeaders?: Record<string, string>;
  statusCode?: number;
  method?: string;
  metrics?: CompressionEvent[];
} = {}) {
  const path = options.path ?? '/api/subscriptions/list';
  const req = new FakeRequest(
    path,
    options.acceptEncoding ? { 'accept-encoding': options.acceptEncoding } : {},
    options.method,
  );
  const res = new FakeResponse();
  if (options.statusCode !== undefined) res.statusCode = options.statusCode;
  res.setHeader('Content-Type', options.contentType ?? 'application/json; charset=utf-8');
  for (const [name, value] of Object.entries(options.responseHeaders ?? {})) {
    res.setHeader(name, value);
  }

  const next = jest.fn();
  const middleware = compressionMiddleware({
    onMetrics: (event) => options.metrics?.push(event),
    logger: { debug: jest.fn(), warn: jest.fn() },
    now: (() => {
      let clock = 1_000;
      return () => {
        clock += 5;
        return clock;
      };
    })(),
  });
  middleware(req as never, res as never, next as never);

  const finished = once(res, 'finish');
  res.write(options.body ?? LARGE_BODY);
  res.end();
  await finished;

  return { req, res, next };
}

function decompress(body: Buffer, encoding?: string): Buffer {
  if (encoding === 'br') return zlib.brotliDecompressSync(body);
  if (encoding === 'gzip') return zlib.gunzipSync(body);
  return body;
}

describe('gateway compression negotiation (issue #2080)', () => {
  beforeEach(() => gatewayCompressionMetrics.reset());

  it('runs in the gateway pipeline before the route handler', async () => {
    const { next } = await run();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('prefers Brotli when the client gives it the higher q-value', async () => {
    const events: CompressionEvent[] = [];
    const { res } = await run({ acceptEncoding: 'gzip;q=0.5, br;q=1', metrics: events });

    expect(res.getHeader('Content-Encoding')).toBe('br');
    expect(res.getHeader('Vary')).toBe('Accept-Encoding');
    expect(decompress(res.body, 'br').toString()).toBe(LARGE_BODY);
    expect(events).toEqual([
      expect.objectContaining({ encoding: 'br', outcome: 'compressed', durationMs: 5 }),
    ]);
  });

  it('falls back to gzip when Brotli is explicitly rejected', async () => {
    const { res } = await run({ acceptEncoding: 'br;q=0, gzip;q=1' });

    expect(res.getHeader('Content-Encoding')).toBe('gzip');
    expect(decompress(res.body, 'gzip').toString()).toBe(LARGE_BODY);
  });

  it('uses gzip for wildcard clients and identity for unsupported encodings', async () => {
    const wildcard = await run({ acceptEncoding: '*' });
    expect(wildcard.res.getHeader('Content-Encoding')).toBe('gzip');

    const unsupported = await run({ acceptEncoding: 'deflate' });
    expect(unsupported.res.getHeader('Content-Encoding')).toBeUndefined();
    expect(unsupported.res.body.toString()).toBe(LARGE_BODY);
  });

  it('returns identity and records the reason when no Accept-Encoding is sent', async () => {
    const events: CompressionEvent[] = [];
    const { res } = await run({ metrics: events });

    expect(res.getHeader('Content-Encoding')).toBeUndefined();
    expect(res.getHeader('Vary')).toBe('Accept-Encoding');
    expect(events[0]).toEqual(
      expect.objectContaining({ outcome: 'identity', reason: 'no-accept-encoding' }),
    );
  });

  it('skips small payloads and non-compressible content types', async () => {
    const smallEvents: CompressionEvent[] = [];
    const small = await run({
      acceptEncoding: 'br',
      body: '{"ok":true}',
      metrics: smallEvents,
    });
    expect(small.res.getHeader('Content-Encoding')).toBeUndefined();
    expect(smallEvents[0].reason).toBe('below-threshold');

    const binaryEvents: CompressionEvent[] = [];
    const binary = await run({
      acceptEncoding: 'br',
      contentType: 'application/octet-stream',
      metrics: binaryEvents,
    });
    expect(binary.res.getHeader('Content-Encoding')).toBeUndefined();
    expect(binaryEvents[0].reason).toBe('uncompressible-type');
  });

  it('honours skip patterns, HEAD, 304, already-encoded and no-transform responses', async () => {
    const cases: Array<
      [Partial<Parameters<typeof run>[0]>, CompressionEvent['reason'], string | undefined]
    > = [
      [{ path: '/health' }, 'skip-pattern', undefined],
      [{ method: 'HEAD' }, 'request-method', undefined],
      [{ statusCode: 204 }, 'response-status', undefined],
      [{ statusCode: 304 }, 'response-status', undefined],
      [{ responseHeaders: { 'Content-Encoding': 'gzip' } }, 'already-encoded', 'gzip'],
      [{ responseHeaders: { 'Cache-Control': 'no-transform' } }, 'no-transform', undefined],
    ];

    for (const [overrides, reason, expectedEncoding] of cases) {
      const events: CompressionEvent[] = [];
      const { res } = await run({
        acceptEncoding: 'br',
        metrics: events,
        ...overrides,
      });
      expect({ reason, encoding: res.getHeader('Content-Encoding') }).toEqual({
        reason,
        encoding: expectedEncoding,
      });
      expect(events[0].reason).toBe(reason);
    }
  });

  it('appends to an existing Vary header without overwriting it', async () => {
    const { res } = await run({
      acceptEncoding: 'gzip',
      responseHeaders: { Vary: 'Accept-Language' },
    });

    expect(res.getHeader('Vary')).toBe('Accept-Language, Accept-Encoding');
  });

  it('replaces stale Content-Length for both compressed and identity responses', async () => {
    const compressed = await run({
      acceptEncoding: 'gzip',
      responseHeaders: { 'Content-Length': '10' },
    });
    expect(compressed.res.getHeader('Content-Encoding')).toBe('gzip');
    expect(compressed.res.getHeader('Content-Length')).toBeUndefined();

    const identity = await run({
      body: '{"ok":true}',
      responseHeaders: { 'Content-Length': '999' },
    });
    expect(identity.res.getHeader('Content-Encoding')).toBeUndefined();
    expect(identity.res.getHeader('Content-Length')).toBe('{"ok":true}'.length);
  });

  it('applies route thresholds and per-response level overrides', async () => {
    const overridden = await run({
      path: '/api/exports/dump',
      acceptEncoding: 'gzip',
      body: MEDIUM_BODY,
      contentType: 'text/plain',
    });
    expect(overridden.res.getHeader('Content-Encoding')).toBe('gzip');
    expect(zlib.gunzipSync(overridden.res.body).toString()).toBe(MEDIUM_BODY);

    const belowThreshold = await run({
      acceptEncoding: 'gzip',
      body: MEDIUM_BODY,
      contentType: 'text/plain',
    });
    expect(belowThreshold.res.getHeader('Content-Encoding')).toBeUndefined();

    const createBrotliCompress = jest.spyOn(zlib, 'createBrotliCompress');
    try {
      await run({
        acceptEncoding: 'br',
        responseHeaders: { 'X-Compression-Level': '9' },
      });
      expect(createBrotliCompress).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
          }),
        }),
      );
    } finally {
      createBrotliCompress.mockRestore();
    }
  });

  it('falls back to identity and reports a fallback when compression fails', async () => {
    const events: CompressionEvent[] = [];
    const createGzip = jest.spyOn(zlib, 'createGzip').mockImplementation(() => {
      const emitter = new EventEmitter();
      return Object.assign(emitter, {
        write: () => {
          emitter.emit('error', new Error('zlib failure'));
          return true;
        },
        end: () => emitter,
        destroy: () => emitter,
      }) as unknown as ReturnType<typeof zlib.createGzip>;
    });

    try {
      const { res } = await run({ acceptEncoding: 'gzip', metrics: events });
      expect(res.getHeader('Content-Encoding')).toBeUndefined();
      expect(res.body.toString()).toBe(LARGE_BODY);
      expect(events[0]).toEqual(
        expect.objectContaining({
          outcome: 'fallback',
          reason: 'compression-error',
          encoding: 'identity',
        }),
      );
    } finally {
      createGzip.mockRestore();
    }
  });

  it('records metrics and exposes a Prometheus snapshot', async () => {
    await run({ acceptEncoding: 'br' });
    await run({ acceptEncoding: 'gzip' });
    await run({});

    const snapshot = gatewayCompressionMetrics.snapshot();
    expect(snapshot.requests).toBe(3);
    expect(snapshot.compressed).toBe(2);
    expect(snapshot.brotli).toBe(1);
    expect(snapshot.gzip).toBe(1);
    expect(snapshot.identity).toBe(1);
    expect(snapshot.originalBytes).toBe(LARGE_BODY.length * 3);
    expect(snapshot.avgRatio).toBeLessThan(1);

    const prometheus = gatewayCompressionPrometheusMetrics();
    expect(prometheus).toContain('subtrackr_gateway_compression_requests_total 3');
    expect(prometheus).toContain('subtrackr_gateway_compression_fallbacks_total 0');
  });
});
