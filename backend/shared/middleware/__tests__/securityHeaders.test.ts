/**
 * Tests for security headers middleware.
 *
 * Issue #1010: HSTS and Permissions-Policy hardening.
 */

import {
  buildSecurityHeaders,
  buildHsts,
  buildPermissionsPolicy,
  securityHeadersMiddleware,
  applySecurityHeadersToResponse,
  type SecurityHeadersOptions,
} from '../securityHeaders';

describe('buildHsts', () => {
  it('returns default HSTS header', () => {
    expect(buildHsts({})).toBe('max-age=63072000; includeSubDomains; preload');
  });

  it('respects custom max-age', () => {
    expect(buildHsts({ hstsMaxAge: 86400 })).toBe('max-age=86400; includeSubDomains; preload');
  });

  it('omits includeSubDomains when disabled', () => {
    expect(buildHsts({ hstsIncludeSubDomains: false })).toBe('max-age=63072000; preload');
  });

  it('omits preload when disabled', () => {
    expect(buildHsts({ hstsPreload: false })).toBe('max-age=63072000; includeSubDomains');
  });
});

describe('buildPermissionsPolicy', () => {
  it('returns default hardened policy', () => {
    const policy = buildPermissionsPolicy({});
    expect(policy).toContain("geolocation='none'");
    expect(policy).toContain("microphone='none'");
    expect(policy).toContain("camera='none'");
    expect(policy).toContain("publickeyCredentialsGet='self'");
  });

  it('merges custom directives', () => {
    const policy = buildPermissionsPolicy({
      permissionsPolicy: { geolocation: ["'self'"] },
    });
    expect(policy).toContain("geolocation='self'");
    expect(policy).toContain("microphone='none'");
  });
});

describe('buildSecurityHeaders', () => {
  it('includes HSTS and Permissions-Policy', () => {
    const headers = buildSecurityHeaders({});
    expect(headers['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(headers['Permissions-Policy']).toContain("geolocation='none'");
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });
});

describe('securityHeadersMiddleware', () => {
  it('sets headers on the response', () => {
    const headersOut: Record<string, string> = {};
    const res = {
      headersSent: false,
      setHeader: (name: string, value: string | number | string[]) => {
        headersOut[name] = String(value);
      },
    } as any;
    const next = jest.fn();

    securityHeadersMiddleware()(null, res, next);
    expect(next).toHaveBeenCalled();
    expect(headersOut['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(headersOut['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('skips setting headers when already sent', () => {
    const setHeader = jest.fn();
    const res = {
      headersSent: true,
      setHeader,
    } as any;
    const next = jest.fn();

    securityHeadersMiddleware()(null, res, next);
    expect(setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

describe('applySecurityHeadersToResponse', () => {
  it('applies headers to response object', () => {
    const headersOut: Record<string, string> = {};
    const res = {
      headersSent: false,
      setHeader: (name: string, value: string | number | string[]) => {
        headersOut[name] = String(value);
      },
    } as any;

    applySecurityHeadersToResponse(res, { hstsMaxAge: 100 });
    expect(headersOut['Strict-Transport-Security']).toBe('max-age=100; includeSubDomains; preload');
  });

  it('skips all headers when response is already sent', () => {
    const setHeader = jest.fn();
    const res = { headersSent: true, setHeader } as any;

    applySecurityHeadersToResponse(res);
    expect(setHeader).not.toHaveBeenCalled();
  });
});

describe('Security Header Audit (#1773)', () => {
  const REQUIRED_HEADERS = [
    'Strict-Transport-Security',
    'Permissions-Policy',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
  ] as const;

  it('emits every required security header with default options', () => {
    const headers = buildSecurityHeaders({});
    for (const name of REQUIRED_HEADERS) {
      expect(headers).toHaveProperty(name);
      expect(headers[name]).toBeTruthy();
    }
  });

  it('X-Content-Type-Options is always nosniff regardless of custom options', () => {
    const headers = buildSecurityHeaders({
      hstsMaxAge: 3600,
      hstsIncludeSubDomains: false,
      hstsPreload: false,
      permissionsPolicy: { geolocation: ["'self'"] },
    });
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('Referrer-Policy is always strict-origin-when-cross-origin', () => {
    expect(buildSecurityHeaders({})['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(buildSecurityHeaders({ hstsMaxAge: 0 })['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('X-Frame-Options is always SAMEORIGIN', () => {
    expect(buildSecurityHeaders({})['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('HSTS max-age is at least 1 year (31536000 s) by default for preload eligibility', () => {
    const hsts = buildSecurityHeaders({})['Strict-Transport-Security'];
    const match = /max-age=(\d+)/.exec(hsts);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(31_536_000);
  });

  it('payment feature-policy is none by default (no inadvertent Payment Request API exposure)', () => {
    const policy = buildSecurityHeaders({})['Permissions-Policy'];
    expect(policy).toContain("payment='none'");
  });
});
