/**
 * Tests for Issue #1005 – CSRF Client Service (src/services/csrfClientService.ts)
 */

import { CsrfClientService, csrfClientService, CSRF_HEADER_NAME } from '../csrfClientService';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal mock fetch response */
function makeFetchResponse(
  token: string | null,
  status = 200,
  bodyJson?: object,
): Response {
  const headers = new Headers();
  if (token) headers.set(CSRF_HEADER_NAME, token);

  return {
    status,
    headers,
    ok: status >= 200 && status < 300,
    clone: () => makeFetchResponse(token, status, bodyJson),
    json: () => Promise.resolve(bodyJson ?? {}),
    text: () => Promise.resolve(JSON.stringify(bodyJson ?? {})),
  } as unknown as Response;
}

/** Build a mock fetch that returns a response with a CSRF token header. */
function makeMockFetch(token: string, status = 200, bodyJson?: object) {
  return jest.fn().mockResolvedValue(makeFetchResponse(token, status, bodyJson));
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('exports CSRF_HEADER_NAME as X-CSRF-Token', () => {
    expect(CSRF_HEADER_NAME).toBe('X-CSRF-Token');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CsrfClientService — getToken()
// ─────────────────────────────────────────────────────────────────────────────

describe('CsrfClientService.getToken()', () => {
  it('fetches and returns the token on first call', async () => {
    const mockFetch = makeMockFetch('tok123');
    const service = new CsrfClientService({ fetchImpl: mockFetch });
    const token = await service.getToken();
    expect(token).toBe('tok123');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns the cached token on subsequent calls without re-fetching', async () => {
    const mockFetch = makeMockFetch('tok123');
    const service = new CsrfClientService({ fetchImpl: mockFetch });
    await service.getToken();
    await service.getToken();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after cache is cleared', async () => {
    const mockFetch = makeMockFetch('tok123');
    const service = new CsrfClientService({ fetchImpl: mockFetch });
    await service.getToken();
    service.clearToken();
    await service.getToken();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('fetches from custom endpoint', async () => {
    const mockFetch = makeMockFetch('tok');
    const service = new CsrfClientService({
      fetchImpl: mockFetch,
      tokenEndpoint: '/custom/csrf',
    });
    await service.getToken();
    expect(mockFetch).toHaveBeenCalledWith('/custom/csrf', expect.any(Object));
  });

  it('throws when response has no X-CSRF-Token header', async () => {
    const noTokenFetch = jest.fn().mockResolvedValue(makeFetchResponse(null));
    const service = new CsrfClientService({ fetchImpl: noTokenFetch });
    await expect(service.getToken()).rejects.toThrow(/No X-CSRF-Token header/);
  });

  it('deduplicates concurrent refresh calls (only one fetch in-flight)', async () => {
    const mockFetch = makeMockFetch('tok');
    const service = new CsrfClientService({ fetchImpl: mockFetch });
    // Fire multiple concurrent getToken calls before the first resolves
    const [a, b, c] = await Promise.all([
      service.getToken(),
      service.getToken(),
      service.getToken(),
    ]);
    expect(a).toBe('tok');
    expect(b).toBe('tok');
    expect(c).toBe('tok');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CsrfClientService — getHeaders()
// ─────────────────────────────────────────────────────────────────────────────

describe('CsrfClientService.getHeaders()', () => {
  it('returns headers object with X-CSRF-Token', async () => {
    const service = new CsrfClientService({ fetchImpl: makeMockFetch('tok123') });
    const headers = await service.getHeaders();
    expect(headers[CSRF_HEADER_NAME]).toBe('tok123');
  });

  it('returns only the CSRF header (no extra keys)', async () => {
    const service = new CsrfClientService({ fetchImpl: makeMockFetch('tok') });
    const headers = await service.getHeaders();
    expect(Object.keys(headers)).toEqual([CSRF_HEADER_NAME]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CsrfClientService — prefetch()
// ─────────────────────────────────────────────────────────────────────────────

describe('CsrfClientService.prefetch()', () => {
  it('eagerly fetches the token', async () => {
    const mockFetch = makeMockFetch('tok');
    const service = new CsrfClientService({ fetchImpl: mockFetch });
    await service.prefetch();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('subsequent getToken() does not re-fetch', async () => {
    const mockFetch = makeMockFetch('tok');
    const service = new CsrfClientService({ fetchImpl: mockFetch });
    await service.prefetch();
    await service.getToken();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CsrfClientService — injectHeader()
// ─────────────────────────────────────────────────────────────────────────────

describe('CsrfClientService.injectHeader()', () => {
  it('mutates the headers object in-place', async () => {
    const service = new CsrfClientService({ fetchImpl: makeMockFetch('tok') });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    await service.injectHeader(headers);
    expect(headers[CSRF_HEADER_NAME]).toBe('tok');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CsrfClientService — setToken()
// ─────────────────────────────────────────────────────────────────────────────

describe('CsrfClientService.setToken()', () => {
  it('sets the token without fetching', async () => {
    const mockFetch = jest.fn();
    const service = new CsrfClientService({ fetchImpl: mockFetch });
    service.setToken('manually-set-token');
    const token = await service.getToken();
    expect(token).toBe('manually-set-token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('isTokenValid() returns true after setToken()', () => {
    const service = new CsrfClientService({ fetchImpl: jest.fn() });
    service.setToken('tok');
    expect(service.isTokenValid()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CsrfClientService — clearToken()
// ─────────────────────────────────────────────────────────────────────────────

describe('CsrfClientService.clearToken()', () => {
  it('isTokenValid() returns false after clearToken()', async () => {
    const service = new CsrfClientService({ fetchImpl: makeMockFetch('tok') });
    await service.getToken();
    service.clearToken();
    expect(service.isTokenValid()).toBe(false);
  });

  it('forces re-fetch after clear', async () => {
    const mockFetch = makeMockFetch('tok');
    const service = new CsrfClientService({ fetchImpl: mockFetch });
    await service.getToken();
    service.clearToken();
    await service.getToken();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CsrfClientService — isTokenValid()
// ─────────────────────────────────────────────────────────────────────────────

describe('CsrfClientService.isTokenValid()', () => {
  it('returns false when no token is cached', () => {
    const service = new CsrfClientService({ fetchImpl: jest.fn() });
    expect(service.isTokenValid()).toBe(false);
  });

  it('returns true when a fresh token is cached', async () => {
    const service = new CsrfClientService({ fetchImpl: makeMockFetch('tok') });
    await service.getToken();
    expect(service.isTokenValid()).toBe(true);
  });

  it('returns false when the token has expired (very short TTL)', async () => {
    jest.useFakeTimers();
    const service = new CsrfClientService({
      fetchImpl: makeMockFetch('tok'),
      tokenTtlMs: 1000, // 1 second
    });
    await service.getToken();
    expect(service.isTokenValid()).toBe(true);
    jest.advanceTimersByTime(1001);
    expect(service.isTokenValid()).toBe(false);
    jest.useRealTimers();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CsrfClientService — fetchWithRetry()
// ─────────────────────────────────────────────────────────────────────────────

describe('CsrfClientService.fetchWithRetry()', () => {
  it('returns a successful response without retry', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(makeFetchResponse('tok')) // initial prefetch
      .mockResolvedValueOnce({ status: 200, ok: true } as Response);

    const service = new CsrfClientService({ fetchImpl: mockFetch });
    service.setToken('cached-token');

    const res = await service.fetchWithRetry('/api/data', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('injects X-CSRF-Token header into the request', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 200, ok: true } as Response);
    const service = new CsrfClientService({ fetchImpl: mockFetch });
    service.setToken('my-csrf-token');

    await service.fetchWithRetry('/api/data', { method: 'POST' });

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers[CSRF_HEADER_NAME]).toBe('my-csrf-token');
  });

  it('retries once on 403 CSRF_TOKEN_MISMATCH and returns retry response', async () => {
    const mockFetch = jest
      .fn()
      // For the actual request – first call returns 403
      .mockResolvedValueOnce(
        makeFetchResponse('old-token', 403, { code: 'CSRF_TOKEN_MISMATCH' }),
      )
      // The refresh call (after clear)
      .mockResolvedValueOnce(makeFetchResponse('new-token'))
      // The retry of the original request
      .mockResolvedValueOnce({ status: 200, ok: true } as Response);

    const service = new CsrfClientService({ fetchImpl: mockFetch });
    service.setToken('old-token');

    const res = await service.fetchWithRetry('/api/data', { method: 'POST' });
    expect(res.status).toBe(200);
    // fetch was called 3 times: first attempt + refresh + retry
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry on 403 responses that are not CSRF mismatches', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue(makeFetchResponse(null, 403, { code: 'FORBIDDEN' }));

    const service = new CsrfClientService({ fetchImpl: mockFetch });
    service.setToken('tok');

    const res = await service.fetchWithRetry('/api/data', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// csrfClientService singleton
// ─────────────────────────────────────────────────────────────────────────────

describe('csrfClientService singleton', () => {
  it('is an instance of CsrfClientService', () => {
    expect(csrfClientService).toBeInstanceOf(CsrfClientService);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: setToken → getHeaders → inject
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration', () => {
  it('set → inject → clear → re-fetch cycle', async () => {
    const mockFetch = makeMockFetch('fresh-token');
    const service = new CsrfClientService({ fetchImpl: mockFetch });

    // Set a token manually (e.g. from a server-rendered meta tag)
    service.setToken('ssr-token');
    expect(service.isTokenValid()).toBe(true);

    // Inject into outgoing headers
    const headers: Record<string, string> = {};
    await service.injectHeader(headers);
    expect(headers[CSRF_HEADER_NAME]).toBe('ssr-token');

    // Clear and let it auto-fetch
    service.clearToken();
    const freshHeaders = await service.getHeaders();
    expect(freshHeaders[CSRF_HEADER_NAME]).toBe('fresh-token');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
