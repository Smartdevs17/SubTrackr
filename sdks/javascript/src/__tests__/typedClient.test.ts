/**
 * Tests for TypedSubTrackrClient — typedClient.ts
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { TypedSubTrackrClient } from '../typedClient';
import { ApiError, AuthenticationError } from '../errors';
import type { Plan, Subscription } from '../types';

// ── Mock fetch helper ─────────────────────────────────────────────────────────

type FetchMockResponse = {
  ok: boolean;
  status: number;
  headers?: Record<string, string | null>;
  body?: unknown;
  text?: string;
};

function makeFetch(responses: FetchMockResponse[]) {
  let idx = 0;
  return jest.fn(async () => {
    const r = responses[idx] ?? responses[responses.length - 1]!;
    idx++;

    const headerMap = new Map(Object.entries(r.headers ?? {}));
    return {
      ok: r.ok,
      status: r.status,
      headers: {
        get: (name: string) => headerMap.get(name) ?? null,
      },
      text: async () => r.text ?? (r.body !== undefined ? JSON.stringify(r.body) : ''),
      json: async () => r.body,
    } as Response;
  });
}

/** Envelope-wrapped success response. */
function envelope<T>(data: T, requestId = 'req-1') {
  return {
    ok: true,
    status: 200,
    headers: { 'x-api-version': '1' },
    body: {
      success: true,
      data,
      meta: { timestamp: new Date().toISOString(), requestId, apiVersion: 1 },
    },
  };
}

/** Auth manager always returns 'token' */
function mockOptions(fetchImpl: typeof fetch) {
  return {
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.com',
    fetchImpl,
    retry: { maxAttempts: 1 },  // disable retries unless explicitly testing
  };
}

// ── Core request / envelope parsing ──────────────────────────────────────────

describe('TypedSubTrackrClient core', () => {
  it('makes a GET request and unwraps envelope', async () => {
    const subs: Subscription[] = [{ id: 1, status: 'Active' }];
    const fetchImpl = makeFetch([envelope(subs)]);

    const client = new TypedSubTrackrClient(mockOptions(fetchImpl as unknown as typeof fetch));
    const result = await client.getSubscriptions();

    expect(result).toEqual(subs);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/subscriptions');
  });

  it('attaches X-Request-ID and X-API-Version headers', async () => {
    const fetchImpl = makeFetch([envelope([])]);
    const client = new TypedSubTrackrClient(mockOptions(fetchImpl as unknown as typeof fetch));
    await client.getSubscriptions();

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Request-ID']).toBeDefined();
    expect(headers['X-API-Version']).toBe('1');
  });

  it('falls back to legacy (non-envelope) response', async () => {
    const rawData = [{ id: 1, status: 'Active' }];
    const fetchImpl = makeFetch([{
      ok: true,
      status: 200,
      headers: {},  // no x-api-version header
      body: rawData,
    }]);

    const client = new TypedSubTrackrClient(mockOptions(fetchImpl as unknown as typeof fetch));
    const result = await client.getSubscriptions();
    expect(result).toEqual(rawData);
  });

  it('throws ApiError on non-retryable non-ok response', async () => {
    const fetchImpl = makeFetch([{
      ok: false,
      status: 404,
      headers: { 'x-api-version': '1' },
      body: { error: { code: 'NOT_FOUND', message: 'Subscription not found' } },
    }]);

    const client = new TypedSubTrackrClient(mockOptions(fetchImpl as unknown as typeof fetch));
    await expect(client.getSubscription({ subscription_id: 999 })).rejects.toBeInstanceOf(ApiError);
  });

  it('handles empty body (void endpoints)', async () => {
    const fetchImpl = makeFetch([{ ok: true, status: 204, headers: {}, text: '' }]);
    const client = new TypedSubTrackrClient(mockOptions(fetchImpl as unknown as typeof fetch));
    await expect(client.cancelSubscription({ subscription_id: 1, subscriber: 'GABC' })).resolves.toBeUndefined();
  });
});

// ── Retry behaviour ───────────────────────────────────────────────────────────

describe('TypedSubTrackrClient retry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retries on 429 and succeeds on second attempt', async () => {
    const subs: Subscription[] = [{ id: 2, status: 'Active' }];
    const fetchImpl = makeFetch([
      { ok: false, status: 429, headers: { 'retry-after': '0' }, body: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'slow down' } } },
      envelope(subs),
    ]);

    const client = new TypedSubTrackrClient({
      ...mockOptions(fetchImpl as unknown as typeof fetch),
      retry: { maxAttempts: 3, initialDelayMs: 100, jitter: false },
    });

    const promise = client.getSubscriptions();
    await jest.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toEqual(subs);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry POST 500 (non-retryable method + status)', async () => {
    const fetchImpl = makeFetch([
      { ok: false, status: 500, headers: { 'x-api-version': '1' }, body: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'crash' } } },
    ]);

    const client = new TypedSubTrackrClient({
      ...mockOptions(fetchImpl as unknown as typeof fetch),
      retry: { maxAttempts: 3, initialDelayMs: 10, jitter: false },
    });

    await expect(client.createSubscription({ name: 'Test' } as any)).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries on network error for GET', async () => {
    let calls = 0;
    const fetchImpl = jest.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('Network error');
      return {
        ok: true,
        status: 200,
        headers: { get: (_: string) => null },
        text: async () => JSON.stringify([{ id: 3, status: 'Active' }]),
      } as unknown as Response;
    });

    const client = new TypedSubTrackrClient({
      ...mockOptions(fetchImpl as unknown as typeof fetch),
      retry: { maxAttempts: 3, initialDelayMs: 10, jitter: false },
    });

    const promise = client.getSubscriptions();
    await jest.advanceTimersByTimeAsync(10);
    const result = await promise;
    expect(result).toBeDefined();
    expect(calls).toBe(2);
  });

  it('throws after exhausting all attempts', async () => {
    const fetchImpl = makeFetch([
      { ok: false, status: 503, headers: {}, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } } },
      { ok: false, status: 503, headers: {}, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } } },
      { ok: false, status: 503, headers: {}, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } } },
    ]);

    const client = new TypedSubTrackrClient({
      ...mockOptions(fetchImpl as unknown as typeof fetch),
      retry: { maxAttempts: 3, initialDelayMs: 10, jitter: false },
    });

    const promise = client.getSubscriptions();
    await jest.advanceTimersByTimeAsync(10);
    await jest.advanceTimersByTimeAsync(20);
    await expect(promise).rejects.toBeDefined();
  });
});

// ── Idempotency keys ──────────────────────────────────────────────────────────

describe('idempotency keys', () => {
  it('attaches Idempotency-Key on subscribe()', async () => {
    const fetchImpl = makeFetch([envelope(1)]);
    const client = new TypedSubTrackrClient(mockOptions(fetchImpl as unknown as typeof fetch));

    await client.subscribe({ subscriber: 'GABC', plan_id: 1 });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeDefined();
  });

  it('uses provided idempotencyKey option', async () => {
    const fetchImpl = makeFetch([envelope(1)]);
    const client = new TypedSubTrackrClient(mockOptions(fetchImpl as unknown as typeof fetch));

    await client.subscribe({ subscriber: 'GABC', plan_id: 1 }, { idempotencyKey: 'my-key-123' });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('my-key-123');
  });
});

// ── Metrics ───────────────────────────────────────────────────────────────────

describe('getMetrics()', () => {
  it('tracks total and successful requests', async () => {
    const fetchImpl = makeFetch([envelope([]), envelope([])]);
    const client = new TypedSubTrackrClient(mockOptions(fetchImpl as unknown as typeof fetch));

    await client.getSubscriptions();
    await client.getWebhooks();

    const m = client.getMetrics();
    expect(m.totalRequests).toBe(2);
    expect(m.successfulRequests).toBe(2);
    expect(m.failedRequests).toBe(0);
  });

  it('tracks failed requests', async () => {
    const fetchImpl = makeFetch([{
      ok: false,
      status: 400,
      headers: {},
      body: { error: { code: 'BAD_REQUEST', message: 'bad' } },
    }]);

    const client = new TypedSubTrackrClient(mockOptions(fetchImpl as unknown as typeof fetch));
    await client.getSubscriptions().catch(() => {});

    expect(client.getMetrics().failedRequests).toBe(1);
  });

  it('resetMetrics() zeroes all counters', async () => {
    const fetchImpl = makeFetch([envelope([])]);
    const client = new TypedSubTrackrClient(mockOptions(fetchImpl as unknown as typeof fetch));
    await client.getSubscriptions();

    client.resetMetrics();
    expect(client.getMetrics().totalRequests).toBe(0);
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe('paginate()', () => {
  it('iterates through pages until hasMore is false', async () => {
    const page1 = {
      ok: true,
      status: 200,
      headers: { 'x-api-version': '1' },
      body: {
        success: true,
        data: [{ id: 1, status: 'Active' }],
        meta: { timestamp: '', requestId: 'r1', apiVersion: 1, pagination: { hasMore: true, cursor: 'c1' } },
      },
    };
    const page2 = {
      ok: true,
      status: 200,
      headers: { 'x-api-version': '1' },
      body: {
        success: true,
        data: [{ id: 2, status: 'Active' }],
        meta: { timestamp: '', requestId: 'r2', apiVersion: 1, pagination: { hasMore: false } },
      },
    };

    const fetchImpl = makeFetch([page1, page2]);
    const client = new TypedSubTrackrClient(mockOptions(fetchImpl as unknown as typeof fetch));

    const pages: Subscription[][] = [];
    for await (const page of client.paginate<Subscription>('/v1/subscriptions')) {
      pages.push(page.data);
    }

    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(1);
    expect(pages[1]).toHaveLength(1);
    // Cursor forwarded on second call
    const [url2] = fetchImpl.mock.calls[1] as [string];
    expect(url2).toContain('cursor=c1');
  });
});
