/**
 * Tests for Issue #1005 – CSRF Protection with Double-Submit Cookie
 * (backend/services/shared/csrfService.ts)
 */

import {
  generateCsrfToken,
  verifyCsrfToken,
  parseCookies,
  buildCsrfCookieValue,
  CsrfService,
  csrfService,
  createCsrfMiddleware,
  issueCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_TOKEN_RESPONSE_HEADER,
} from '../csrfService';

import type {
  CsrfCookieOptions,
  CsrfMiddlewareOptions,
  CsrfRequest,
  CsrfResponse,
} from '../csrfService';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('exports CSRF_COOKIE_NAME as __Host-csrf', () => {
    expect(CSRF_COOKIE_NAME).toBe('__Host-csrf');
  });

  it('exports CSRF_HEADER_NAME as X-CSRF-Token', () => {
    expect(CSRF_HEADER_NAME).toBe('X-CSRF-Token');
  });

  it('exports CSRF_TOKEN_RESPONSE_HEADER as X-CSRF-Token', () => {
    expect(CSRF_TOKEN_RESPONSE_HEADER).toBe('X-CSRF-Token');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateCsrfToken()
// ─────────────────────────────────────────────────────────────────────────────

describe('generateCsrfToken()', () => {
  it('returns a non-empty string', () => {
    expect(typeof generateCsrfToken()).toBe('string');
    expect(generateCsrfToken().length).toBeGreaterThan(0);
  });

  it('returns a 64-character hex string (32 bytes)', () => {
    const token = generateCsrfToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a unique value on each call', () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).not.toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyCsrfToken()
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyCsrfToken()', () => {
  it('returns true for identical tokens', () => {
    const t = generateCsrfToken();
    expect(verifyCsrfToken(t, t)).toBe(true);
  });

  it('returns false for different tokens of the same length', () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(verifyCsrfToken(a, b)).toBe(false);
  });

  it('returns false when first argument is empty', () => {
    expect(verifyCsrfToken('', generateCsrfToken())).toBe(false);
  });

  it('returns false when second argument is empty', () => {
    expect(verifyCsrfToken(generateCsrfToken(), '')).toBe(false);
  });

  it('returns false when both arguments are empty', () => {
    expect(verifyCsrfToken('', '')).toBe(false);
  });

  it('returns false for tokens of different lengths', () => {
    expect(verifyCsrfToken('short', 'muchlongertoken')).toBe(false);
  });

  it('is case-sensitive', () => {
    const t = generateCsrfToken(); // lowercase hex
    expect(verifyCsrfToken(t, t.toUpperCase())).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCookies()
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCookies()', () => {
  it('parses a single cookie', () => {
    expect(parseCookies('__Host-csrf=abc123')).toEqual({ '__Host-csrf': 'abc123' });
  });

  it('parses multiple cookies', () => {
    const result = parseCookies('__Host-csrf=abc123; sessionId=xyz789');
    expect(result).toEqual({ '__Host-csrf': 'abc123', sessionId: 'xyz789' });
  });

  it('returns an empty object for undefined input', () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it('returns an empty object for an empty string', () => {
    expect(parseCookies('')).toEqual({});
  });

  it('handles URL-encoded cookie values', () => {
    const encoded = encodeURIComponent('hello world');
    const result = parseCookies(`foo=${encoded}`);
    expect(result.foo).toBe('hello world');
  });

  it('handles cookies without values gracefully', () => {
    // A cookie part without '=' is skipped
    const result = parseCookies('__Host-csrf=token; badcookie; other=val');
    expect(result['__Host-csrf']).toBe('token');
    expect(result.other).toBe('val');
    expect(result.badcookie).toBeUndefined();
  });

  it('trims whitespace around cookie names and values', () => {
    const result = parseCookies('  name  =  value  ');
    expect(result.name).toBe('value');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildCsrfCookieValue()
// ─────────────────────────────────────────────────────────────────────────────

describe('buildCsrfCookieValue()', () => {
  it('includes the cookie name and token', () => {
    const value = buildCsrfCookieValue('mytoken');
    expect(value).toContain('__Host-csrf=mytoken');
  });

  it('includes Path=/', () => {
    expect(buildCsrfCookieValue('t')).toContain('Path=/');
  });

  it('includes SameSite=Strict by default', () => {
    expect(buildCsrfCookieValue('t')).toContain('SameSite=Strict');
  });

  it('includes Secure by default', () => {
    expect(buildCsrfCookieValue('t')).toContain('Secure');
  });

  it('includes Max-Age=86400 by default', () => {
    expect(buildCsrfCookieValue('t')).toContain('Max-Age=86400');
  });

  it('respects custom sameSite option', () => {
    const value = buildCsrfCookieValue('t', { sameSite: 'Lax' });
    expect(value).toContain('SameSite=Lax');
  });

  it('respects custom maxAgeSeconds', () => {
    const value = buildCsrfCookieValue('t', { maxAgeSeconds: 3600 });
    expect(value).toContain('Max-Age=3600');
  });

  it('omits Max-Age when maxAgeSeconds is 0', () => {
    const value = buildCsrfCookieValue('t', { maxAgeSeconds: 0 });
    expect(value).not.toContain('Max-Age');
  });

  it('omits Secure when secure is false', () => {
    const value = buildCsrfCookieValue('t', { secure: false });
    expect(value).not.toContain('Secure');
  });

  it('does NOT include HttpOnly (double-submit requires JS readable cookie)', () => {
    expect(buildCsrfCookieValue('t')).not.toContain('HttpOnly');
  });

  it('uses a custom cookie name', () => {
    const value = buildCsrfCookieValue('t', { cookieName: 'XSRF-TOKEN' });
    expect(value).toContain('XSRF-TOKEN=t');
    expect(value).not.toContain('__Host-csrf');
  });

  it('URL-encodes special characters in the token', () => {
    const value = buildCsrfCookieValue('a+b=c');
    expect(value).toContain(encodeURIComponent('a+b=c'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CsrfService
// ─────────────────────────────────────────────────────────────────────────────

describe('CsrfService', () => {
  let service: CsrfService;

  beforeEach(() => {
    service = new CsrfService();
  });

  describe('generateToken()', () => {
    it('returns a 64-character hex string', () => {
      expect(service.generateToken()).toHaveLength(64);
    });

    it('returns unique tokens', () => {
      expect(service.generateToken()).not.toBe(service.generateToken());
    });
  });

  describe('verify()', () => {
    it('returns true for matching tokens', () => {
      const t = service.generateToken();
      expect(service.verify(t, t)).toBe(true);
    });

    it('returns false for mismatched tokens', () => {
      expect(service.verify(service.generateToken(), service.generateToken())).toBe(false);
    });

    it('returns false when cookie token is undefined', () => {
      expect(service.verify(undefined, 'sometoken')).toBe(false);
    });

    it('returns false when header token is undefined', () => {
      expect(service.verify('sometoken', undefined)).toBe(false);
    });

    it('returns false when both are undefined', () => {
      expect(service.verify(undefined, undefined)).toBe(false);
    });
  });

  describe('extractFromCookie()', () => {
    it('extracts token from cookie header', () => {
      const t = service.generateToken();
      expect(service.extractFromCookie(`__Host-csrf=${t}`)).toBe(t);
    });

    it('returns undefined when cookie is absent', () => {
      expect(service.extractFromCookie('session=xyz')).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
      expect(service.extractFromCookie(undefined)).toBeUndefined();
    });
  });

  describe('extractFromHeader()', () => {
    it('extracts token from X-CSRF-Token header (exact case)', () => {
      const t = service.generateToken();
      expect(service.extractFromHeader({ 'X-CSRF-Token': t })).toBe(t);
    });

    it('extracts token from lowercase header key', () => {
      const t = service.generateToken();
      expect(service.extractFromHeader({ 'x-csrf-token': t })).toBe(t);
    });

    it('returns first element when header is an array', () => {
      const t = service.generateToken();
      expect(service.extractFromHeader({ 'X-CSRF-Token': [t, 'other'] })).toBe(t);
    });

    it('returns undefined when header is absent', () => {
      expect(service.extractFromHeader({ 'Content-Type': 'application/json' })).toBeUndefined();
    });
  });

  describe('buildCookieValue()', () => {
    it('returns a valid Set-Cookie string', () => {
      const value = service.buildCookieValue('mytoken');
      expect(value).toContain('__Host-csrf');
      expect(value).toContain('mytoken');
    });
  });

  describe('with custom cookieName', () => {
    it('uses custom name in extractFromCookie', () => {
      const custom = new CsrfService({ cookieName: 'XSRF-TOKEN' });
      const t = 'mytoken';
      expect(custom.extractFromCookie(`XSRF-TOKEN=${t}`)).toBe(t);
      expect(custom.extractFromCookie(`__Host-csrf=${t}`)).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// csrfService singleton
// ─────────────────────────────────────────────────────────────────────────────

describe('csrfService singleton', () => {
  it('is an instance of CsrfService', () => {
    expect(csrfService).toBeInstanceOf(CsrfService);
  });

  it('can generate and verify tokens', () => {
    const t = csrfService.generateToken();
    expect(csrfService.verify(t, t)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCsrfMiddleware()
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal mock request */
function makeReq(
  method: string,
  headers: Record<string, string | undefined> = {},
  cookieHeader?: string,
  parsedCookies?: Record<string, string>,
): CsrfRequest & { url: string } {
  return {
    method,
    headers: cookieHeader ? { ...headers, cookie: cookieHeader } : headers,
    cookies: parsedCookies,
    url: '/api/data',
  };
}

/** Build a minimal mock response */
function makeRes(): CsrfResponse & { _headers: Record<string, string> } {
  const _headers: Record<string, string> = {};
  return {
    _headers,
    setHeader(name: string, value: string) {
      _headers[name] = value;
    },
  };
}

describe('createCsrfMiddleware()', () => {
  // ── Safe methods: token issuance ───────────────────────────────────────────

  describe('safe methods (GET, HEAD, OPTIONS)', () => {
    it('calls next() without error on GET', () => {
      const middleware = createCsrfMiddleware();
      const next = jest.fn();
      middleware(makeReq('GET'), makeRes(), next);
      expect(next).toHaveBeenCalledWith(); // called with no args → no error
    });

    it('sets X-CSRF-Token response header on GET', () => {
      const middleware = createCsrfMiddleware();
      const res = makeRes();
      middleware(makeReq('GET'), res, () => {});
      expect(res._headers[CSRF_TOKEN_RESPONSE_HEADER]).toBeTruthy();
    });

    it('sets Set-Cookie header when no existing token', () => {
      const middleware = createCsrfMiddleware();
      const res = makeRes();
      middleware(makeReq('GET'), res, () => {});
      expect(res._headers['Set-Cookie']).toContain('__Host-csrf');
    });

    it('reuses existing cookie token (does not re-set cookie)', () => {
      const middleware = createCsrfMiddleware();
      const token = generateCsrfToken();
      const res = makeRes();
      middleware(makeReq('GET', {}, `__Host-csrf=${token}`), res, () => {});
      // Cookie should NOT be re-set because it already exists
      expect(res._headers['Set-Cookie']).toBeUndefined();
      // But the existing token should be echoed in the response header
      expect(res._headers[CSRF_TOKEN_RESPONSE_HEADER]).toBe(token);
    });

    it('works with pre-parsed cookies object', () => {
      const middleware = createCsrfMiddleware();
      const token = generateCsrfToken();
      const res = makeRes();
      middleware(makeReq('GET', {}, undefined, { '__Host-csrf': token }), res, () => {});
      expect(res._headers['Set-Cookie']).toBeUndefined();
      expect(res._headers[CSRF_TOKEN_RESPONSE_HEADER]).toBe(token);
    });
  });

  // ── Unsafe methods: token verification ────────────────────────────────────

  describe('unsafe methods (POST, PUT, PATCH, DELETE)', () => {
    it('calls next() without error when tokens match (POST)', () => {
      const middleware = createCsrfMiddleware();
      const next = jest.fn();
      const token = generateCsrfToken();
      const req = makeReq('POST', { 'X-CSRF-Token': token }, `__Host-csrf=${token}`);
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith(); // no error arg
    });

    it('calls next() without error when tokens match (PUT)', () => {
      const middleware = createCsrfMiddleware();
      const next = jest.fn();
      const token = generateCsrfToken();
      const req = makeReq('PUT', { 'X-CSRF-Token': token }, `__Host-csrf=${token}`);
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next() without error when tokens match (PATCH)', () => {
      const middleware = createCsrfMiddleware();
      const next = jest.fn();
      const token = generateCsrfToken();
      const req = makeReq('PATCH', { 'X-CSRF-Token': token }, `__Host-csrf=${token}`);
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next() without error when tokens match (DELETE)', () => {
      const middleware = createCsrfMiddleware();
      const next = jest.fn();
      const token = generateCsrfToken();
      const req = makeReq('DELETE', { 'X-CSRF-Token': token }, `__Host-csrf=${token}`);
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next(err) with status 403 when header token is missing', () => {
      const middleware = createCsrfMiddleware();
      const next = jest.fn();
      const token = generateCsrfToken();
      const req = makeReq('POST', {}, `__Host-csrf=${token}`);
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const err = next.mock.calls[0][0] as Error & { status: number; code: string };
      expect(err.status).toBe(403);
      expect(err.code).toBe('CSRF_TOKEN_MISMATCH');
    });

    it('calls next(err) with status 403 when cookie token is missing', () => {
      const middleware = createCsrfMiddleware();
      const next = jest.fn();
      const token = generateCsrfToken();
      const req = makeReq('POST', { 'X-CSRF-Token': token });
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('calls next(err) when tokens do not match', () => {
      const middleware = createCsrfMiddleware();
      const next = jest.fn();
      const tokenA = generateCsrfToken();
      const tokenB = generateCsrfToken();
      const req = makeReq('POST', { 'X-CSRF-Token': tokenA }, `__Host-csrf=${tokenB}`);
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('error message mentions CSRF token invalid', () => {
      const middleware = createCsrfMiddleware();
      const next = jest.fn();
      middleware(makeReq('POST'), makeRes(), next);
      const err = next.mock.calls[0][0] as Error;
      expect(err.message).toContain('CSRF token');
    });
  });

  // ── skipPaths ──────────────────────────────────────────────────────────────

  describe('skipPaths option', () => {
    it('skips CSRF check for paths in the skip list', () => {
      const middleware = createCsrfMiddleware({ skipPaths: ['/webhooks'] });
      const next = jest.fn();
      const req = { ...makeReq('POST'), url: '/webhooks/stripe' };
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith(); // no error
    });

    it('does NOT skip paths not in the skip list', () => {
      const middleware = createCsrfMiddleware({ skipPaths: ['/webhooks'] });
      const next = jest.fn();
      const req = makeReq('POST');
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── custom unsafeMethods ───────────────────────────────────────────────────

  describe('unsafeMethods option', () => {
    it('respects custom unsafe methods', () => {
      const middleware = createCsrfMiddleware({ unsafeMethods: ['DELETE'] });
      const next = jest.fn();
      // POST is no longer unsafe – should pass without token
      middleware(makeReq('POST'), makeRes(), next);
      expect(next).toHaveBeenCalledWith(); // no error for POST
    });

    it('still enforces configured unsafe methods', () => {
      const middleware = createCsrfMiddleware({ unsafeMethods: ['DELETE'] });
      const next = jest.fn();
      middleware(makeReq('DELETE'), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── custom getPath ─────────────────────────────────────────────────────────

  describe('getPath option', () => {
    it('uses custom getPath function', () => {
      const middleware = createCsrfMiddleware({
        skipPaths: ['/skip'],
        getPath: (req) => (req as { customPath?: string }).customPath,
      });
      const next = jest.fn();
      const req = { ...makeReq('POST'), customPath: '/skip/something' };
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith(); // skipped
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// issueCsrfToken()
// ─────────────────────────────────────────────────────────────────────────────

describe('issueCsrfToken()', () => {
  it('returns a token string', () => {
    const res = makeRes();
    const token = issueCsrfToken(res);
    expect(typeof token).toBe('string');
    expect(token.length).toBe(64);
  });

  it('sets the Set-Cookie header', () => {
    const res = makeRes();
    issueCsrfToken(res);
    expect(res._headers['Set-Cookie']).toContain('__Host-csrf');
  });

  it('sets the X-CSRF-Token response header', () => {
    const res = makeRes();
    const token = issueCsrfToken(res);
    expect(res._headers[CSRF_TOKEN_RESPONSE_HEADER]).toBe(token);
  });

  it('uses a custom service when provided', () => {
    const service = new CsrfService({ cookieName: 'XSRF-TOKEN' });
    const res = makeRes();
    issueCsrfToken(res, service);
    expect(res._headers['Set-Cookie']).toContain('XSRF-TOKEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: full token lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: full CSRF lifecycle', () => {
  it('issues a token on GET and verifies it on POST', () => {
    const middleware = createCsrfMiddleware();

    // Step 1: GET request – issue token
    const getRes = makeRes();
    const getNext = jest.fn();
    middleware(makeReq('GET'), getRes, getNext);
    expect(getNext).toHaveBeenCalledWith();

    const issuedToken = getRes._headers[CSRF_TOKEN_RESPONSE_HEADER];
    expect(issuedToken).toBeTruthy();

    // Step 2: POST request – verify token
    const postNext = jest.fn();
    const postReq = makeReq(
      'POST',
      { 'X-CSRF-Token': issuedToken },
      `__Host-csrf=${issuedToken}`,
    );
    middleware(postReq, makeRes(), postNext);
    expect(postNext).toHaveBeenCalledWith(); // verification passes
  });

  it('rejects POST with a different token than in cookie', () => {
    const middleware = createCsrfMiddleware();
    const postNext = jest.fn();
    const cookieToken = generateCsrfToken();
    const differentToken = generateCsrfToken();
    const postReq = makeReq('POST', { 'X-CSRF-Token': differentToken }, `__Host-csrf=${cookieToken}`);
    middleware(postReq, makeRes(), postNext);
    expect(postNext).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });
});
