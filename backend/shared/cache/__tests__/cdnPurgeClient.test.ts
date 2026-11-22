/**
 * Tests for CDN purge API client (Fastly / Cloudflare).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  CdnPurgeClient,
  NoOpCdnPurgeClient,
  createCdnPurgeClientFromEnv,
  resetCdnPurgeClient,
  purgeSurrogateKeys,
} from '../cdnPurgeClient';

function mockFetch(status: number, body = ''): typeof fetch {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  })) as unknown as typeof fetch;
}

// ── CdnPurgeClient – Fastly ───────────────────────────────────────────────────

describe('CdnPurgeClient – Fastly', () => {
  it('sends purge request with Surrogate-Key header', async () => {
    const fetchImpl = mockFetch(200);
    const client = new CdnPurgeClient({
      provider: 'fastly',
      apiToken: 'test-token',
      serviceId: 'svc-123',
      fetchImpl,
    });

    const result = await client.purgeBySurrogateKeys(['plan', 'pricing']);

    expect(result.success).toBe(true);
    expect(result.provider).toBe('fastly');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.fastly.com/service/svc-123/purge',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Fastly-Key': 'test-token',
          'Surrogate-Key': 'plan pricing',
        }),
      }),
    );
  });

  it('logs error and returns failure on non-2xx response', async () => {
    const fetchImpl = mockFetch(503, 'service unavailable');
    const client = new CdnPurgeClient({
      provider: 'fastly',
      apiToken: 'test-token',
      serviceId: 'svc-123',
      fetchImpl,
    });

    const result = await client.purgeBySurrogateKeys(['plan']);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.error).toContain('503');
  });

  it('returns success for empty key list without calling API', async () => {
    const fetchImpl = mockFetch(200);
    const client = new CdnPurgeClient({
      provider: 'fastly',
      apiToken: 'test-token',
      serviceId: 'svc-123',
      fetchImpl,
    });

    const result = await client.purgeBySurrogateKeys([]);

    expect(result.success).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ── CdnPurgeClient – Cloudflare ───────────────────────────────────────────────

describe('CdnPurgeClient – Cloudflare', () => {
  it('sends purge request with cache tags', async () => {
    const fetchImpl = mockFetch(200);
    const client = new CdnPurgeClient({
      provider: 'cloudflare',
      apiToken: 'cf-token',
      serviceId: 'zone-abc',
      fetchImpl,
    });

    const result = await client.purgeBySurrogateKeys(['feature']);

    expect(result.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/zone-abc/purge_cache',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tags: ['feature'] }),
      }),
    );
  });

  it('handles network errors without throwing', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('network timeout');
    }) as unknown as typeof fetch;

    const client = new CdnPurgeClient({
      provider: 'cloudflare',
      apiToken: 'cf-token',
      serviceId: 'zone-abc',
      fetchImpl,
    });

    const result = await client.purgeBySurrogateKeys(['config']);

    expect(result.success).toBe(false);
    expect(result.error).toContain('network timeout');
  });
});

// ── NoOpCdnPurgeClient ────────────────────────────────────────────────────────

describe('NoOpCdnPurgeClient', () => {
  it('returns success without network calls', async () => {
    const client = new NoOpCdnPurgeClient();
    const result = await client.purgeBySurrogateKeys(['plan']);
    expect(result.success).toBe(true);
  });

  it('logs warning when keys provided without CDN credentials', async () => {
    const warnSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const client = new NoOpCdnPurgeClient();
    await client.purgeBySurrogateKeys(['plan']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('CDN purge skipped'));
    warnSpy.mockRestore();
  });

  it('does not log when key list is empty', async () => {
    const warnSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const client = new NoOpCdnPurgeClient();
    await client.purgeBySurrogateKeys([]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ── createCdnPurgeClientFromEnv ─────────────────────────────────────────────────

describe('createCdnPurgeClientFromEnv', () => {
  afterEach(() => {
    resetCdnPurgeClient();
  });

  it('returns NoOp client when credentials are missing', () => {
    const client = createCdnPurgeClientFromEnv({});
    expect(client).toBeInstanceOf(NoOpCdnPurgeClient);
  });

  it('returns configured client when env vars are set', () => {
    const client = createCdnPurgeClientFromEnv({
      CDN_PROVIDER: 'fastly',
      CDN_API_TOKEN: 'token',
      CDN_SERVICE_ID: 'svc',
    });
    expect(client).toBeInstanceOf(CdnPurgeClient);
    expect(client.provider).toBe('fastly');
  });
});

// ── purgeSurrogateKeys ──────────────────────────────────────────────────────────

describe('purgeSurrogateKeys', () => {
  beforeEach(() => {
    resetCdnPurgeClient();
  });

  it('delegates to injected client', async () => {
    const fetchImpl = mockFetch(200);
    const client = new CdnPurgeClient({
      provider: 'fastly',
      apiToken: 'tok',
      serviceId: 'svc',
      fetchImpl,
    });

    const result = await purgeSurrogateKeys(['user'], client);
    expect(result.success).toBe(true);
  });
});
