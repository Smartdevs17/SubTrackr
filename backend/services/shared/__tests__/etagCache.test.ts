/**
 * Unit tests for the ETag-based API response cache.
 *
 * Run:
 *   npx jest backend/services/shared/__tests__/etagCache.test.ts
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ETagCacheService,
  computeETag,
  parseIfNoneMatch,
  isETagMatch,
  createETagCache,
} from '../etagCache';
import type { ICacheService, CacheMetrics } from '../cache';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal ICacheService backed by an in-memory Map (no Redis). */
class MemoryCacheService implements ICacheService {
  private store = new Map<string, unknown>();

  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T | null>,
    opts?: { bypassCache?: boolean },
  ): Promise<T | null> {
    if (opts?.bypassCache) {
      const fresh = await loader();
      if (fresh != null) this.store.set(key, fresh);
      return fresh;
    }
    if (this.store.has(key)) return this.store.get(key) as T;
    const val = await loader();
    if (val != null) this.store.set(key, val);
    return val;
  }

  async set<T>(key: string, value: T): Promise<boolean> {
    this.store.set(key, value);
    return true;
  }

  async invalidate(...keys: string[]): Promise<void> {
    for (const k of keys) this.store.delete(k);
  }

  async invalidatePattern(prefix: string): Promise<void> {
    for (const k of [...this.store.keys()]) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }

  async warm<T>(entries: Array<{ key: string; value: T }>): Promise<{ warmed: number; errors: number }> {
    for (const { key, value } of entries) this.store.set(key, value);
    return { warmed: entries.length, errors: 0 };
  }

  getMetrics(): CacheMetrics {
    return {
      hits: 0, misses: 0, writes: 0, invalidations: 0,
      errors: 0, degradations: 0, hitRatio: NaN,
      latencyMs: { p50: 0, p95: 0, p99: 0 },
      memoryUsageBytes: 0,
    };
  }

  resetMetrics(): void { /* noop */ }
  async isHealthy(): Promise<boolean> { return true; }
  isDegraded(): boolean { return false; }
  prometheusMetrics(): string { return ''; }

  _size() { return this.store.size; }
  _keys() { return [...this.store.keys()]; }
}

/** Build a minimal mock IncomingMessage. */
function mockReq(ifNoneMatch?: string): IncomingMessage {
  return {
    headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {},
    socket: {},
  } as unknown as IncomingMessage;
}

interface MockRes {
  statusCode: number;
  headers: Record<string, string | number>;
  body: string;
  ended: boolean;
  writeHead(status: number, headers?: Record<string, string | number>): void;
  setHeader(name: string, value: string | number): void;
  end(body?: Buffer | string): void;
}

/** Build a minimal mock ServerResponse that captures writes. */
function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    body: '',
    ended: false,
    writeHead(status, headers) {
      this.statusCode = status;
      if (headers) Object.assign(this.headers, headers);
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(data?: Buffer | string) {
      this.ended = true;
      if (data) this.body = typeof data === 'string' ? data : data.toString('utf8');
    },
  };
  return res;
}

// ─── computeETag ─────────────────────────────────────────────────────────────

describe('computeETag', () => {
  it('produces a weak ETag by default', () => {
    const etag = computeETag('{"hello":"world"}');
    expect(etag).toMatch(/^W\/"[A-Za-z0-9_-]{1,27}"$/);
  });

  it('produces a strong ETag when weak=false', () => {
    const etag = computeETag('{"hello":"world"}', false);
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{1,27}"$/);
    expect(etag).not.toMatch(/^W\//);
  });

  it('is deterministic — same input → same output', () => {
    const body = '{"id":1,"name":"plan-a"}';
    expect(computeETag(body)).toBe(computeETag(body));
  });

  it('produces different ETags for different bodies', () => {
    expect(computeETag('body-1')).not.toBe(computeETag('body-2'));
  });
});

// ─── parseIfNoneMatch ─────────────────────────────────────────────────────────

describe('parseIfNoneMatch', () => {
  it('returns empty set for undefined', () => {
    expect(parseIfNoneMatch(undefined).size).toBe(0);
  });

  it('returns wildcard set for *', () => {
    const s = parseIfNoneMatch('*');
    expect(s.has('*')).toBe(true);
  });

  it('parses a single ETag', () => {
    const s = parseIfNoneMatch('W/"abc123"');
    expect(s.has('W/"abc123"')).toBe(true);
  });

  it('parses multiple comma-separated ETags', () => {
    const s = parseIfNoneMatch('W/"a", W/"b", "c"');
    expect(s.size).toBe(3);
    expect(s.has('W/"a"')).toBe(true);
    expect(s.has('W/"b"')).toBe(true);
    expect(s.has('"c"')).toBe(true);
  });
});

// ─── isETagMatch ──────────────────────────────────────────────────────────────

describe('isETagMatch', () => {
  it('matches exact same ETag', () => {
    expect(isETagMatch('W/"abc"', new Set(['W/"abc"']))).toBe(true);
  });

  it('matches wildcard', () => {
    expect(isETagMatch('W/"xyz"', new Set(['*']))).toBe(true);
  });

  it('does weak comparison — W/"abc" matches "abc"', () => {
    expect(isETagMatch('W/"abc"', new Set(['"abc"']))).toBe(true);
    expect(isETagMatch('"abc"', new Set(['W/"abc"']))).toBe(true);
  });

  it('returns false for no match', () => {
    expect(isETagMatch('W/"abc"', new Set(['W/"xyz"']))).toBe(false);
  });

  it('returns false for empty set', () => {
    expect(isETagMatch('W/"abc"', new Set())).toBe(false);
  });
});

// ─── ETagCacheService — wrap ──────────────────────────────────────────────────

describe('ETagCacheService.wrap', () => {
  let cache: MemoryCacheService;
  let service: ETagCacheService;

  beforeEach(() => {
    cache = new MemoryCacheService();
    service = new ETagCacheService(cache);
  });

  it('calls producer and returns 200 on first request (cache miss)', async () => {
    const req = mockReq();
    const res = mockRes();

    await service.wrap(req as unknown as IncomingMessage, res as unknown as ServerResponse, 'plan:1', async () => ({
      id: 1,
      name: 'Basic',
    }));

    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
    expect(res.headers['ETag']).toBeDefined();
  });

  it('returns 304 when If-None-Match matches cached ETag', async () => {
    const body = { id: 1, name: 'Basic' };
    const bodyStr = JSON.stringify(body);
    const etag = computeETag(bodyStr);

    // Prime the cache manually
    await service.prime('plan:1', body);

    const req = mockReq(etag);
    const res = mockRes();

    await service.wrap(req as unknown as IncomingMessage, res as unknown as ServerResponse, 'plan:1', async () => body);

    expect(res.statusCode).toBe(304);
    expect(res.headers['ETag']).toBe(etag);
    expect(res.body).toBe('');
  });

  it('returns 200 (not 304) when ETag does not match', async () => {
    const body = { id: 1 };
    await service.prime('plan:1', body);

    const req = mockReq('W/"definitely-wrong-etag"');
    const res = mockRes();

    await service.wrap(req as unknown as IncomingMessage, res as unknown as ServerResponse, 'plan:1', async () => body);

    expect(res.statusCode).toBe(200);
  });

  it('producer is NOT called on 304 response (cache hit + ETag match)', async () => {
    const body = { id: 2 };
    const etag = await service.prime('plan:2', body);

    let producerCalls = 0;
    const req = mockReq(etag);
    const res = mockRes();

    await service.wrap(req as unknown as IncomingMessage, res as unknown as ServerResponse, 'plan:2', async () => {
      producerCalls++;
      return body;
    });

    // producer should NOT have been called (ETag matched at 304 path)
    expect(producerCalls).toBe(0);
    expect(res.statusCode).toBe(304);
  });

  it('wildcard If-None-Match (* ) always returns 304 when cached', async () => {
    await service.prime('plan:3', { id: 3 });

    const req = mockReq('*');
    const res = mockRes();

    await service.wrap(req as unknown as IncomingMessage, res as unknown as ServerResponse, 'plan:3', async () => ({ id: 3 }));

    expect(res.statusCode).toBe(304);
  });

  it('metrics track requests and 304s correctly', async () => {
    const body = { id: 99 };
    const etag = await service.prime('plan:99', body);

    // 2 requests: one fresh, one 304
    await service.wrap(mockReq() as unknown as IncomingMessage, mockRes() as unknown as ServerResponse, 'plan:99', async () => body);
    await service.wrap(mockReq(etag) as unknown as IncomingMessage, mockRes() as unknown as ServerResponse, 'plan:99', async () => body);

    const m = service.getMetrics();
    expect(m.totalRequests).toBe(2);
    expect(m.notModified).toBe(1);
    expect(m.cacheHits).toBeGreaterThanOrEqual(1);
    expect(m.notModifiedRate).toBeGreaterThan(0);
    expect(m.bytesSavedByNotModified).toBeGreaterThan(0);
  });
});

// ─── ETagCacheService — invalidation ─────────────────────────────────────────

describe('ETagCacheService — invalidation', () => {
  it('invalidate removes cached ETag', async () => {
    const cache = new MemoryCacheService();
    const service = new ETagCacheService(cache);
    const body = { id: 7 };
    const etag = await service.prime('plan:7', body);

    // Confirm it's cached
    const before = await service.getETag('plan:7');
    expect(before).toBe(etag);

    // Invalidate
    await service.invalidate('plan:7');

    // No longer cached — producer should be called
    let called = false;
    const req = mockReq(etag);
    const res = mockRes();
    await service.wrap(req as unknown as IncomingMessage, res as unknown as ServerResponse, 'plan:7', async () => {
      called = true;
      return body;
    });

    expect(called).toBe(true);
    // After invalidation + fresh produce, a new ETag is set; the old one may no longer match
    // so status is 200 or 304 depending on hash — either way producer ran
    expect(res.statusCode).not.toBe(0);
  });

  it('invalidatePattern removes all matching keys', async () => {
    const cache = new MemoryCacheService();
    const service = new ETagCacheService(cache, { keyPrefix: 'etag:' });

    await service.prime('plan:1', { id: 1 });
    await service.prime('plan:2', { id: 2 });
    await service.prime('sub:1', { id: 1 });

    await service.invalidatePattern('plan:');

    expect(await service.getETag('plan:1')).toBeNull();
    expect(await service.getETag('plan:2')).toBeNull();
    // sub:1 should still be present
    expect(await service.getETag('sub:1')).not.toBeNull();
  });

  it('metrics.invalidations increments on explicit invalidate', async () => {
    const service = new ETagCacheService(new MemoryCacheService());
    await service.invalidate('plan:1');
    await service.invalidate('plan:2');
    expect(service.getMetrics().invalidations).toBe(2);
  });

  it('metrics.patternInvalidations increments on pattern invalidate', async () => {
    const service = new ETagCacheService(new MemoryCacheService());
    await service.invalidatePattern('plan:');
    expect(service.getMetrics().patternInvalidations).toBe(1);
  });
});

// ─── ETagCacheService — getETag / prime ──────────────────────────────────────

describe('ETagCacheService — getETag and prime', () => {
  it('getETag returns null for uncached key', async () => {
    const service = new ETagCacheService(new MemoryCacheService());
    expect(await service.getETag('missing')).toBeNull();
  });

  it('prime stores and getETag retrieves the ETag', async () => {
    const service = new ETagCacheService(new MemoryCacheService());
    const etag = await service.prime('key:1', { value: 42 });
    expect(etag).toMatch(/^W\//);
    expect(await service.getETag('key:1')).toBe(etag);
  });

  it('prime accepts a pre-serialised string body', async () => {
    const service = new ETagCacheService(new MemoryCacheService());
    const etag = await service.prime('key:2', '{"raw":true}');
    expect(etag).toBeDefined();
    expect(await service.getETag('key:2')).toBe(etag);
  });
});

// ─── ETagCacheService — metrics ───────────────────────────────────────────────

describe('ETagCacheService — metrics', () => {
  it('resetMetrics zeros all counters', async () => {
    const service = new ETagCacheService(new MemoryCacheService());
    await service.prime('k', { x: 1 });
    await service.wrap(
      mockReq() as unknown as IncomingMessage,
      mockRes() as unknown as ServerResponse,
      'k',
      async () => ({ x: 1 }),
    );

    service.resetMetrics();
    const m = service.getMetrics();
    expect(m.totalRequests).toBe(0);
    expect(m.notModified).toBe(0);
    expect(m.bytesSavedByNotModified).toBe(0);
  });

  it('prometheusMetrics contains expected labels', () => {
    const service = new ETagCacheService(new MemoryCacheService());
    const text = service.prometheusMetrics();
    expect(text).toContain('subtrackr_etag_cache_requests_total');
    expect(text).toContain('subtrackr_etag_cache_not_modified_total');
    expect(text).toContain('subtrackr_etag_cache_bytes_saved_total');
    expect(text).toContain('subtrackr_etag_cache_not_modified_rate');
  });

  it('prometheusMetrics respects custom namespace', () => {
    const service = new ETagCacheService(new MemoryCacheService());
    expect(service.prometheusMetrics('myapi')).toContain('myapi_requests_total');
  });
});

// ─── createETagCache factory ─────────────────────────────────────────────────

describe('createETagCache', () => {
  it('returns an ETagCacheService instance', () => {
    const service = createETagCache(new MemoryCacheService());
    expect(service).toBeInstanceOf(ETagCacheService);
  });

  it('passes config overrides', async () => {
    const service = createETagCache(new MemoryCacheService(), {
      defaultCacheControl: 'private, max-age=60',
      weakEtag: false,
    });
    const etag = await service.prime('k', { x: 1 });
    // Strong ETag (no W/ prefix)
    expect(etag).not.toMatch(/^W\//);
  });
});
