/**
 * Tests for the developer portal strict CORS allow-list (issue #2101)
 * Technical scope: developer-portal/utils/corsAllowList.ts
 *
 * Covers:
 *  - allowed origin      -> exact origin echoed with credentials
 *  - disallowed origin   -> no Access-Control-Allow-Origin header
 *  - missing Origin      -> no Access-Control-* headers
 *  - config parsing      -> wildcards and non-origin values are rejected
 */

import {
  CORS_ALLOWED_ORIGINS_ENV,
  getCorsHeaders,
  getPortalCorsAllowList,
  parseCorsAllowList,
} from '../utils/corsAllowList';

const allowList = parseCorsAllowList('https://portal.subtrackr.com, http://localhost:3000');

describe('getCorsHeaders()', () => {
  it('allowed origin: echoes the exact origin with credentials enabled', () => {
    const headers = getCorsHeaders('https://portal.subtrackr.com', allowList);

    expect(headers['Access-Control-Allow-Origin']).toBe('https://portal.subtrackr.com');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers.Vary).toBe('Origin');
  });

  it('disallowed origin: sends no Access-Control-Allow-Origin header', () => {
    const headers = getCorsHeaders('https://evil.example.com', allowList);

    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    expect(headers.Vary).toBe('Origin');
  });

  it('missing Origin: sends no Access-Control-* headers', () => {
    const headers = getCorsHeaders(undefined, allowList);

    expect(Object.keys(headers).filter((k) => k.startsWith('Access-Control-'))).toEqual([]);
  });

  it('never emits a wildcard origin, even for an empty allow-list', () => {
    for (const headers of [getCorsHeaders('https://portal.subtrackr.com', []), getCorsHeaders(undefined, allowList)]) {
      expect(headers['Access-Control-Allow-Origin']).not.toBe('*');
    }
  });
});

describe('parseCorsAllowList()', () => {
  it('returns an empty list when the env value is unset', () => {
    expect(parseCorsAllowList(undefined)).toEqual([]);
    expect(parseCorsAllowList('')).toEqual([]);
  });

  it('normalizes entries to exact origins', () => {
    expect(parseCorsAllowList('https://Portal.Example.com/')).toEqual(['https://portal.example.com']);
  });

  it('rejects wildcard entries', () => {
    expect(() => parseCorsAllowList('*')).toThrow(/wildcard/);
    expect(() => parseCorsAllowList('https://*.example.com')).toThrow(/wildcard/);
  });

  it('rejects values that are not bare origins', () => {
    expect(() => parseCorsAllowList('https://example.com/docs')).toThrow(/scheme:\/\/host/);
    expect(() => parseCorsAllowList('ftp://example.com')).toThrow(/scheme:\/\/host/);
    expect(() => parseCorsAllowList('not a url')).toThrow(/invalid origin/);
  });
});

describe('getPortalCorsAllowList()', () => {
  it('reads the allow-list from the documented env var', () => {
    const env = { [CORS_ALLOWED_ORIGINS_ENV]: 'https://portal.subtrackr.com' } as NodeJS.ProcessEnv;

    expect(getPortalCorsAllowList(env)).toEqual(['https://portal.subtrackr.com']);
  });
});
