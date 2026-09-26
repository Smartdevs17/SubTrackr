/**
 * Tests for Issue #1004 – XSS Prevention with Content Security Policy
 */

import {
  buildCspHeader,
  buildSecurityHeaders,
  createCspMiddleware,
  sanitizeHtml,
  sanitizeObject,
  createXssSanitizerMiddleware,
  generateCspNonce,
  buildNoncePolicy,
  DEFAULT_CSP_POLICY,
  HTML_CSP_POLICY,
} from '../cspMiddleware';

import type {
  CspPolicy,
  SanitizeOptions,
  SecurityHeaders,
  SanitizableRequest,
  XssSanitizerMiddlewareOptions,
} from '../cspMiddleware';

// ─────────────────────────────────────────────────────────────────────────────
// buildCspHeader()
// ─────────────────────────────────────────────────────────────────────────────

describe('buildCspHeader()', () => {
  it('builds a header string from an array directive', () => {
    const header = buildCspHeader({ defaultSrc: ["'self'"] });
    expect(header).toBe("default-src 'self'");
  });

  it('separates multiple sources with spaces', () => {
    const header = buildCspHeader({ scriptSrc: ["'self'", 'https://cdn.example.com'] });
    expect(header).toBe("script-src 'self' https://cdn.example.com");
  });

  it('includes boolean-true directives without a value', () => {
    const header = buildCspHeader({ upgradeInsecureRequests: true });
    expect(header).toBe('upgrade-insecure-requests');
  });

  it('excludes boolean-false directives', () => {
    const header = buildCspHeader({ blockAllMixedContent: false });
    expect(header).toBe('');
  });

  it('separates multiple directives with semicolons', () => {
    const header = buildCspHeader({
      defaultSrc: ["'none'"],
      connectSrc: ["'self'"],
    });
    expect(header).toContain("default-src 'none'");
    expect(header).toContain("connect-src 'self'");
    expect(header).toContain(';');
  });

  it('returns an empty string for an empty policy', () => {
    const header = buildCspHeader({});
    expect(header).toBe('');
  });

  it('handles all supported directives', () => {
    const policy: CspPolicy = {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ['https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: true,
    };
    const header = buildCspHeader(policy);
    expect(header).toContain('default-src');
    expect(header).toContain('script-src');
    expect(header).toContain('upgrade-insecure-requests');
  });

  it('omits empty-array directives', () => {
    const header = buildCspHeader({ scriptSrc: [] });
    expect(header).toBe('');
  });

  it('handles report-uri directive', () => {
    const header = buildCspHeader({ reportUri: ['/csp-report'] });
    expect(header).toBe('report-uri /csp-report');
  });

  it('handles worker-src directive', () => {
    const header = buildCspHeader({ workerSrc: ["'self'", 'blob:'] });
    expect(header).toBe("worker-src 'self' blob:");
  });

  it('combines boolean and array directives in one policy', () => {
    const header = buildCspHeader({
      defaultSrc: ["'self'"],
      upgradeInsecureRequests: true,
      blockAllMixedContent: true,
    });
    expect(header).toContain("default-src 'self'");
    expect(header).toContain('upgrade-insecure-requests');
    expect(header).toContain('block-all-mixed-content');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_CSP_POLICY
// ─────────────────────────────────────────────────────────────────────────────

describe('DEFAULT_CSP_POLICY', () => {
  it("sets default-src to 'none'", () => {
    expect(DEFAULT_CSP_POLICY.defaultSrc).toEqual(["'none'"]);
  });

  it("sets script-src to 'none'", () => {
    expect(DEFAULT_CSP_POLICY.scriptSrc).toEqual(["'none'"]);
  });

  it("sets frame-ancestors to 'none'", () => {
    expect(DEFAULT_CSP_POLICY.frameAncestors).toEqual(["'none'"]);
  });

  it('enables upgradeInsecureRequests', () => {
    expect(DEFAULT_CSP_POLICY.upgradeInsecureRequests).toBe(true);
  });

  it("allows connect-src 'self'", () => {
    expect(DEFAULT_CSP_POLICY.connectSrc).toContain("'self'");
  });

  it('produces a non-empty CSP string', () => {
    expect(buildCspHeader(DEFAULT_CSP_POLICY).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTML_CSP_POLICY
// ─────────────────────────────────────────────────────────────────────────────

describe('HTML_CSP_POLICY', () => {
  it("sets default-src to 'self'", () => {
    expect(HTML_CSP_POLICY.defaultSrc).toContain("'self'");
  });

  it('allows strict-dynamic in script-src', () => {
    expect(HTML_CSP_POLICY.scriptSrc).toContain("'strict-dynamic'");
  });

  it("sets object-src to 'none'", () => {
    expect(HTML_CSP_POLICY.objectSrc).toEqual(["'none'"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSecurityHeaders()
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSecurityHeaders()', () => {
  let headers: SecurityHeaders;

  beforeEach(() => {
    headers = buildSecurityHeaders();
  });

  it('includes Content-Security-Policy', () => {
    expect(headers['Content-Security-Policy']).toBeTruthy();
  });

  it('sets X-Content-Type-Options to nosniff', () => {
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sets X-Frame-Options to DENY', () => {
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('sets X-XSS-Protection', () => {
    expect(headers['X-XSS-Protection']).toBe('1; mode=block');
  });

  it('sets Referrer-Policy to strict-origin-when-cross-origin', () => {
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sets Strict-Transport-Security with preload', () => {
    expect(headers['Strict-Transport-Security']).toContain('preload');
    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(headers['Strict-Transport-Security']).toContain('includeSubDomains');
  });

  it('sets Permissions-Policy', () => {
    expect(headers['Permissions-Policy']).toContain('geolocation=()');
    expect(headers['Permissions-Policy']).toContain('microphone=()');
    expect(headers['Permissions-Policy']).toContain('camera=()');
  });

  it('sets Cross-Origin-Opener-Policy to same-origin', () => {
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('sets Cross-Origin-Resource-Policy to same-origin', () => {
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });

  it('sets Cross-Origin-Embedder-Policy to require-corp', () => {
    expect(headers['Cross-Origin-Embedder-Policy']).toBe('require-corp');
  });

  it('accepts a custom policy', () => {
    const custom = buildSecurityHeaders({ connectSrc: ["'self'", 'https://rpc.example.com'] });
    expect(custom['Content-Security-Policy']).toContain('https://rpc.example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCspMiddleware()
// ─────────────────────────────────────────────────────────────────────────────

describe('createCspMiddleware()', () => {
  it('calls next()', () => {
    const middleware = createCspMiddleware();
    const next = jest.fn();
    const res = { setHeader: jest.fn() };
    middleware({}, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets all security headers on the response', () => {
    const middleware = createCspMiddleware();
    const setHeader = jest.fn();
    middleware({}, { setHeader }, () => {});
    expect(setHeader).toHaveBeenCalledWith('Content-Security-Policy', expect.any(String));
    expect(setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
    expect(setHeader).toHaveBeenCalledWith('Referrer-Policy', expect.any(String));
    expect(setHeader).toHaveBeenCalledWith('Strict-Transport-Security', expect.any(String));
  });

  it('applies a custom policy', () => {
    const custom: CspPolicy = { connectSrc: ["'self'", 'https://custom.example.com'] };
    const middleware = createCspMiddleware(custom);
    const setHeader = jest.fn();
    middleware({}, { setHeader }, () => {});
    const cspCall = (setHeader.mock.calls as [string, string][]).find(
      ([name]) => name === 'Content-Security-Policy',
    );
    expect(cspCall?.[1]).toContain('https://custom.example.com');
  });

  it('uses DEFAULT_CSP_POLICY when no policy is provided', () => {
    const middleware = createCspMiddleware();
    const setHeader = jest.fn();
    middleware({}, { setHeader }, () => {});
    const cspCall = (setHeader.mock.calls as [string, string][]).find(
      ([name]) => name === 'Content-Security-Policy',
    );
    expect(cspCall?.[1]).toContain("default-src 'none'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeHtml()
// ─────────────────────────────────────────────────────────────────────────────

describe('sanitizeHtml()', () => {
  // ── Script tag removal ────────────────────────────────────────────────────

  it('removes a basic script tag', () => {
    expect(sanitizeHtml('<script>alert(1)</script>Hello')).not.toContain('<script');
  });

  it('removes multi-line script tags', () => {
    const input = '<script\ntype="text/javascript">alert("xss")</script>safe';
    expect(sanitizeHtml(input)).not.toContain('script');
  });

  it('removes script tag with src attribute', () => {
    const input = '<script src="https://evil.com/xss.js"></script>';
    expect(sanitizeHtml(input)).not.toContain('script');
  });

  // ── Event handler removal ─────────────────────────────────────────────────

  it('removes onclick handler', () => {
    expect(sanitizeHtml('<div onclick="alert(1)">text</div>')).not.toContain('onclick');
  });

  it('removes onerror handler', () => {
    expect(sanitizeHtml('<img onerror="alert(1)" src="x">')).not.toContain('onerror');
  });

  it('removes onload handler', () => {
    expect(sanitizeHtml('<body onload="alert(1)">')).not.toContain('onload');
  });

  it('removes event handlers with single-quote delimiters', () => {
    expect(sanitizeHtml("<div onclick='stealCookies()'>")).not.toContain('onclick');
  });

  // ── JavaScript URI ────────────────────────────────────────────────────────

  it('removes javascript: URI', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">click</a>')).not.toContain('javascript:');
  });

  it('removes javascript: URI with spaces', () => {
    expect(sanitizeHtml('<a href="javascript :alert(1)">click</a>')).not.toContain('javascript');
  });

  // ── vbscript URI ──────────────────────────────────────────────────────────

  it('removes vbscript: URI', () => {
    expect(sanitizeHtml('<a href="vbscript:msgbox(1)">click</a>')).not.toContain('vbscript:');
  });

  // ── iframe injection ──────────────────────────────────────────────────────

  it('removes iframe tags', () => {
    expect(sanitizeHtml('<iframe src="https://evil.com"></iframe>')).not.toContain('iframe');
  });

  // ── SVG injection ─────────────────────────────────────────────────────────

  it('removes SVG tags', () => {
    expect(sanitizeHtml('<svg onload="alert(1)"></svg>')).not.toContain('<svg');
  });

  // ── Expression injection ──────────────────────────────────────────────────

  it('removes CSS expression()', () => {
    expect(sanitizeHtml('background: expression(alert(1))')).not.toContain('expression(');
  });

  // ── Safe content preservation ─────────────────────────────────────────────

  it('preserves plain text', () => {
    const safe = 'Hello, World! This is a safe string.';
    const result = sanitizeHtml(safe);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  it('strips tags but preserves text content', () => {
    const result = sanitizeHtml('<b>Bold</b> text');
    expect(result).toContain('Bold');
    expect(result).toContain('text');
    expect(result).not.toContain('<b>');
  });

  // ── Entity encoding ───────────────────────────────────────────────────────

  it('encodes < and > by default', () => {
    const result = sanitizeHtml('3 < 5 and 5 > 3');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
  });

  it('encodes & by default', () => {
    const result = sanitizeHtml('AT&T');
    expect(result).toContain('&amp;');
  });

  it('encodes double quotes by default', () => {
    const result = sanitizeHtml('Say "hello"');
    expect(result).toContain('&quot;');
  });

  it('encodes single quotes by default', () => {
    const result = sanitizeHtml("it's fine");
    expect(result).toContain('&#x27;');
  });

  it('skips encoding when encodeEntities is false', () => {
    const result = sanitizeHtml('AT&T', { encodeEntities: false });
    expect(result).toBe('AT&T');
  });

  // ── Extra patterns ────────────────────────────────────────────────────────

  it('applies extra patterns', () => {
    const result = sanitizeHtml('BADWORD hello', {
      extraPatterns: [/BADWORD/g],
      encodeEntities: false,
    });
    expect(result).not.toContain('BADWORD');
    expect(result).toContain('hello');
  });

  // ── Empty / edge inputs ───────────────────────────────────────────────────

  it('returns an empty string for empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('trims whitespace', () => {
    expect(sanitizeHtml('  hello  ')).toBe('hello');
  });

  it('handles strings with only whitespace', () => {
    expect(sanitizeHtml('   ')).toBe('');
  });

  it('handles a string that is only dangerous content', () => {
    const result = sanitizeHtml('<script>alert(1)</script>');
    expect(result.trim()).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeObject()
// ─────────────────────────────────────────────────────────────────────────────

describe('sanitizeObject()', () => {
  it('sanitizes string values in a flat object', () => {
    const obj = { name: '<script>evil</script>Alice', age: 30 };
    const result = sanitizeObject(obj) as typeof obj;
    expect(result.name).not.toContain('<script');
    expect(result.name).toContain('Alice');
    expect(result.age).toBe(30);
  });

  it('sanitizes nested objects', () => {
    const obj = { user: { bio: '<img onerror="xss" src="x">' } };
    const result = sanitizeObject(obj) as typeof obj;
    expect((result.user as Record<string, string>).bio).not.toContain('onerror');
  });

  it('sanitizes string values in arrays', () => {
    const arr = ['<script>alert(1)</script>', 'safe'];
    const result = sanitizeObject(arr) as string[];
    expect(result[0]).not.toContain('<script');
    expect(result[1]).toContain('safe');
  });

  it('passes through numbers unchanged', () => {
    const result = sanitizeObject(42);
    expect(result).toBe(42);
  });

  it('passes through booleans unchanged', () => {
    expect(sanitizeObject(true)).toBe(true);
    expect(sanitizeObject(false)).toBe(false);
  });

  it('passes through null unchanged', () => {
    expect(sanitizeObject(null)).toBeNull();
  });

  it('strips function values from objects', () => {
    const obj = { fn: () => 'evil', safe: 'hello' };
    const result = sanitizeObject(obj) as Record<string, unknown>;
    expect(result.fn).toBeUndefined();
    expect(result.safe).toBeTruthy();
  });

  it('handles deeply nested objects without stack overflow', () => {
    // Build a moderately deep object (within the MAX_DEPTH limit)
    let deep: Record<string, unknown> = { value: '<script>deep</script>' };
    for (let i = 0; i < 9; i++) deep = { nested: deep };
    expect(() => sanitizeObject(deep)).not.toThrow();
  });

  it('handles arrays of objects', () => {
    const arr = [{ name: '<b>Alice</b>' }, { name: '<script>Bob</script>' }];
    const result = sanitizeObject(arr) as Array<Record<string, string>>;
    expect(result[0].name).not.toContain('<b>');
    expect(result[1].name).not.toContain('<script');
  });

  it('accepts SanitizeOptions and passes them through', () => {
    const obj = { text: 'AT&T' };
    const result = sanitizeObject(obj, { encodeEntities: false }) as typeof obj;
    expect(result.text).toBe('AT&T');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createXssSanitizerMiddleware()
// ─────────────────────────────────────────────────────────────────────────────

describe('createXssSanitizerMiddleware()', () => {
  it('calls next()', () => {
    const middleware = createXssSanitizerMiddleware();
    const next = jest.fn();
    middleware({ body: { name: 'Alice' } }, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sanitizes all body fields by default', () => {
    const middleware = createXssSanitizerMiddleware();
    const req: SanitizableRequest = { body: { name: '<script>xss</script>Alice', age: 30 } };
    middleware(req, {}, () => {});
    const body = req.body as Record<string, unknown>;
    expect(body.name as string).not.toContain('<script');
    expect(body.age).toBe(30);
  });

  it('sanitizes only specified fields when fields option is given', () => {
    const middleware = createXssSanitizerMiddleware({ fields: ['description'] });
    const req: SanitizableRequest = {
      body: {
        name: '<script>alert(1)</script>',
        description: '<b>bold</b>',
      },
    };
    middleware(req, {}, () => {});
    const body = req.body as Record<string, string>;
    // 'description' should be sanitized
    expect(body.description).not.toContain('<b>');
    // 'name' is NOT in the fields list and should NOT be mutated
    expect(body.name).toBe('<script>alert(1)</script>');
  });

  it('sanitizes query params when sanitizeQuery is true', () => {
    const middleware = createXssSanitizerMiddleware({ sanitizeQuery: true });
    const req: SanitizableRequest = { query: { search: '<script>xss</script>' } };
    middleware(req, {}, () => {});
    expect(req.query?.search as string).not.toContain('<script');
  });

  it('sanitizes route params when sanitizeQuery is true', () => {
    const middleware = createXssSanitizerMiddleware({ sanitizeQuery: true });
    const req: SanitizableRequest = { params: { id: '<b>1</b>' } };
    middleware(req, {}, () => {});
    expect(req.params?.id as string).not.toContain('<b>');
  });

  it('does not mutate query when sanitizeQuery is false (default)', () => {
    const middleware = createXssSanitizerMiddleware();
    const req: SanitizableRequest = { query: { search: '<script>xss</script>' } };
    middleware(req, {}, () => {});
    // Query should be unchanged since sanitizeQuery defaults to false
    expect(req.query?.search).toBe('<script>xss</script>');
  });

  it('handles undefined body gracefully', () => {
    const middleware = createXssSanitizerMiddleware();
    const req: SanitizableRequest = { body: undefined };
    expect(() => middleware(req, {}, () => {})).not.toThrow();
  });

  it('handles null body gracefully', () => {
    const middleware = createXssSanitizerMiddleware();
    const req: SanitizableRequest = { body: null as unknown as undefined };
    expect(() => middleware(req, {}, () => {})).not.toThrow();
  });

  it('handles body that is not an object', () => {
    const middleware = createXssSanitizerMiddleware();
    // Body as a primitive (unusual but defensive check)
    const req = { body: 'raw string' } as unknown as SanitizableRequest;
    expect(() => middleware(req, {}, () => {})).not.toThrow();
  });

  it('forwards sanitizeOptions to sanitizeHtml', () => {
    const opts: XssSanitizerMiddlewareOptions = {
      sanitizeOptions: { encodeEntities: false },
    };
    const middleware = createXssSanitizerMiddleware(opts);
    const req: SanitizableRequest = { body: { text: 'AT&T' } };
    middleware(req, {}, () => {});
    expect((req.body as Record<string, string>).text).toBe('AT&T');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateCspNonce()
// ─────────────────────────────────────────────────────────────────────────────

describe('generateCspNonce()', () => {
  it('returns a non-empty string', () => {
    const nonce = generateCspNonce();
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(0);
  });

  it('returns different values on each call', () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    expect(a).not.toBe(b);
  });

  it('returns a URL-safe Base64 string (no +, /, or = padding)', () => {
    for (let i = 0; i < 20; i++) {
      const nonce = generateCspNonce();
      expect(nonce).not.toMatch(/[+/=]/);
    }
  });

  it('has the expected length for 16 bytes base64url (22 chars)', () => {
    const nonce = generateCspNonce();
    expect(nonce.length).toBe(22);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildNoncePolicy()
// ─────────────────────────────────────────────────────────────────────────────

describe('buildNoncePolicy()', () => {
  it("injects the nonce into script-src with 'nonce-' prefix", () => {
    const nonce = 'abc123';
    const policy = buildNoncePolicy(nonce);
    expect(policy.scriptSrc).toContain(`'nonce-${nonce}'`);
  });

  it('preserves the base script-src sources', () => {
    const nonce = 'abc123';
    const policy = buildNoncePolicy(nonce, HTML_CSP_POLICY);
    expect(policy.scriptSrc).toContain("'self'");
    expect(policy.scriptSrc).toContain("'strict-dynamic'");
  });

  it('produces a valid CSP header string containing the nonce', () => {
    const nonce = generateCspNonce();
    const policy = buildNoncePolicy(nonce);
    const header = buildCspHeader(policy);
    expect(header).toContain(`'nonce-${nonce}'`);
  });

  it('does not mutate the base policy', () => {
    const base: CspPolicy = { scriptSrc: ["'self'"] };
    const original = [...(base.scriptSrc ?? [])];
    buildNoncePolicy('nonce123', base);
    expect(base.scriptSrc).toEqual(original);
  });

  it('uses HTML_CSP_POLICY as default base', () => {
    const policy = buildNoncePolicy('nonce123');
    expect(policy.defaultSrc).toEqual(HTML_CSP_POLICY.defaultSrc);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: CSP middleware + XSS sanitizer used together
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: CSP + XSS middleware chain', () => {
  it('sets CSP headers and sanitizes the body in sequence', () => {
    const cspMiddleware = createCspMiddleware();
    const xssMiddleware = createXssSanitizerMiddleware();

    const setHeader = jest.fn();
    const res = { setHeader };
    const req: SanitizableRequest = {
      body: { comment: '<script>alert("xss")</script>Hello' },
    };

    const nextCsp = jest.fn(() => xssMiddleware(req, res, () => {}));
    cspMiddleware(req, res, nextCsp);

    // CSP headers were set
    expect(setHeader).toHaveBeenCalledWith('Content-Security-Policy', expect.any(String));
    // Body was sanitized
    const body = req.body as Record<string, string>;
    expect(body.comment).not.toContain('<script');
    expect(body.comment).toContain('Hello');
  });
});
