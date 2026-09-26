/**
 * apiVersioning.test.ts — Tests for backend/services/shared/apiVersioning.ts
 *
 * Coverage:
 *  - parseVersionNumber: v-prefix, date format, plain integer, unknown
 *  - ApiVersionRegistry: register, unregister, setDefault, get/has/getAll,
 *    getActive/Deprecated/Sunset/LatestActive, deprecate, sunset, activate,
 *    getDeprecationWarning, recordRequest/getStats/resetAnalytics, validation
 *  - extractVersionFromPath/Header/Query
 *  - resolveVersion: path → header → query → default priority
 *  - buildVersionHeaders: active, deprecated (all sub-headers), sunset
 *  - createVersionMiddleware: active pass-through, deprecated headers,
 *    sunset 410, unknown version 400, custom handlers, analytics recording
 *  - Integration: full v1→v2 migration scenario
 */

import {
  parseVersionNumber,
  ApiVersionRegistry,
  extractVersionFromPath,
  extractVersionFromHeader,
  extractVersionFromQuery,
  resolveVersion,
  buildVersionHeaders,
  createVersionMiddleware,
  HEADERS,
  versionRegistry,
  type VersionConfig,
  type MiddlewareRequest,
  type MiddlewareResponse,
} from '../apiVersioning';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRegistry(configs: Partial<VersionConfig>[] = []): ApiVersionRegistry {
  const registry = new ApiVersionRegistry();
  const defaults: VersionConfig[] = [
    { version: 'v1', lifecycle: 'deprecated', releasedAt: '2024-01-01T00:00:00Z', deprecatedAt: '2025-01-01T00:00:00Z', sunsetAt: '2027-01-01T00:00:00Z', successorVersion: 'v2', migrationUrl: 'https://example.com/migrate' },
    { version: 'v2', lifecycle: 'active', releasedAt: '2025-01-01T00:00:00Z' },
  ];
  for (const c of configs.length ? configs : defaults) {
    registry.register(c as VersionConfig);
  }
  if (!configs.length) registry.setDefault('v2');
  return registry;
}

interface CapturedRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
}

function mockRes(): { res: MiddlewareResponse; capture: () => CapturedRes } {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = '';
  let ended = false;

  const res: MiddlewareResponse = {
    setHeader(name, value) { headers[name] = value; },
    writeHead(code, h = {}) { statusCode = code; Object.assign(headers, h); },
    end(b = '') { body = b; ended = true; },
  };

  return { res, capture: () => ({ statusCode, headers, body, ended }) };
}

function mockReq(overrides: Partial<MiddlewareRequest> = {}): MiddlewareRequest {
  return { headers: {}, ...overrides };
}

// ─── parseVersionNumber ───────────────────────────────────────────────────────

describe('parseVersionNumber', () => {
  it('parses "v1" → 1', () => expect(parseVersionNumber('v1')).toBe(1));
  it('parses "v10" → 10', () => expect(parseVersionNumber('v10')).toBe(10));
  it('parses "V2" (case-insensitive) → 2', () => expect(parseVersionNumber('V2')).toBe(2));
  it('parses "2025-01" → 202501', () => expect(parseVersionNumber('2025-01')).toBe(202501));
  it('parses "2025-12" → 202512', () => expect(parseVersionNumber('2025-12')).toBe(202512));
  it('parses "1" → 1', () => expect(parseVersionNumber('1')).toBe(1));
  it('returns 0 for unknown format', () => expect(parseVersionNumber('beta')).toBe(0));
  it('v2 > v1', () => expect(parseVersionNumber('v2')).toBeGreaterThan(parseVersionNumber('v1')));
  it('date version > v2', () => expect(parseVersionNumber('2025-01')).toBeGreaterThan(parseVersionNumber('v2')));
});

// ─── ApiVersionRegistry — registration ───────────────────────────────────────

describe('ApiVersionRegistry — registration', () => {
  it('registers and retrieves a version', () => {
    const reg = new ApiVersionRegistry();
    reg.register({ version: 'v1', lifecycle: 'active', releasedAt: '2024-01-01T00:00:00Z' });
    expect(reg.get('v1')).toMatchObject({ version: 'v1', lifecycle: 'active' });
  });

  it('has() returns true for registered versions', () => {
    const reg = makeRegistry();
    expect(reg.has('v1')).toBe(true);
    expect(reg.has('v99')).toBe(false);
  });

  it('getAll() returns all registered versions', () => {
    const reg = makeRegistry();
    expect(reg.getAll()).toHaveLength(2);
  });

  it('unregister() removes a version', () => {
    const reg = makeRegistry();
    expect(reg.unregister('v1')).toBe(true);
    expect(reg.has('v1')).toBe(false);
  });

  it('unregister() returns false for unknown version', () => {
    const reg = makeRegistry();
    expect(reg.unregister('v99')).toBe(false);
  });

  it('register() is chainable', () => {
    const reg = new ApiVersionRegistry();
    const result = reg.register({ version: 'v1', lifecycle: 'active', releasedAt: '2024-01-01T00:00:00Z' });
    expect(result).toBe(reg);
  });

  it('throws when version string is empty', () => {
    const reg = new ApiVersionRegistry();
    expect(() =>
      reg.register({ version: '', lifecycle: 'active', releasedAt: '2024-01-01T00:00:00Z' }),
    ).toThrow('version string is required');
  });

  it('throws for invalid lifecycle value', () => {
    const reg = new ApiVersionRegistry();
    expect(() =>
      reg.register({ version: 'v1', lifecycle: 'invalid' as never, releasedAt: '2024-01-01T00:00:00Z' }),
    ).toThrow('invalid lifecycle');
  });

  it('throws when deprecated lifecycle lacks deprecatedAt', () => {
    const reg = new ApiVersionRegistry();
    expect(() =>
      reg.register({ version: 'v1', lifecycle: 'deprecated', releasedAt: '2024-01-01T00:00:00Z' }),
    ).toThrow('deprecatedAt is required');
  });

  it('throws when sunsetAt <= deprecatedAt', () => {
    const reg = new ApiVersionRegistry();
    expect(() =>
      reg.register({
        version: 'v1',
        lifecycle: 'deprecated',
        releasedAt: '2024-01-01T00:00:00Z',
        deprecatedAt: '2025-06-01T00:00:00Z',
        sunsetAt: '2025-01-01T00:00:00Z',
      }),
    ).toThrow('sunsetAt must be after deprecatedAt');
  });
});

// ─── ApiVersionRegistry — default ─────────────────────────────────────────────

describe('ApiVersionRegistry — default version', () => {
  it('setDefault sets and getDefault returns the version', () => {
    const reg = makeRegistry();
    expect(reg.getDefault()).toBe('v2');
  });

  it('throws when setting default to unknown version', () => {
    const reg = makeRegistry();
    expect(() => reg.setDefault('v99')).toThrow('unknown version "v99"');
  });

  it('getDefault returns null when not set', () => {
    const reg = new ApiVersionRegistry();
    expect(reg.getDefault()).toBeNull();
  });

  it('unregistering default clears getDefault', () => {
    const reg = makeRegistry();
    reg.unregister('v2');
    expect(reg.getDefault()).toBeNull();
  });
});

// ─── ApiVersionRegistry — filters ─────────────────────────────────────────────

describe('ApiVersionRegistry — filters', () => {
  it('getActive returns only active versions', () => {
    const reg = makeRegistry();
    const active = reg.getActive();
    expect(active.every((v) => v.lifecycle === 'active')).toBe(true);
    expect(active.map((v) => v.version)).toContain('v2');
  });

  it('getDeprecated returns only deprecated versions', () => {
    const reg = makeRegistry();
    expect(reg.getDeprecated().map((v) => v.version)).toContain('v1');
  });

  it('getSunset returns only sunset versions', () => {
    const reg = makeRegistry();
    reg.sunset('v1');
    expect(reg.getSunset().map((v) => v.version)).toContain('v1');
  });

  it('getLatestActive returns highest-numbered active version', () => {
    const reg = new ApiVersionRegistry();
    reg.register({ version: 'v1', lifecycle: 'active', releasedAt: '2023-01-01T00:00:00Z' });
    reg.register({ version: 'v3', lifecycle: 'active', releasedAt: '2025-01-01T00:00:00Z' });
    reg.register({ version: 'v2', lifecycle: 'active', releasedAt: '2024-01-01T00:00:00Z' });
    expect(reg.getLatestActive()?.version).toBe('v3');
  });

  it('getLatestActive returns undefined when no active versions', () => {
    const reg = new ApiVersionRegistry();
    expect(reg.getLatestActive()).toBeUndefined();
  });
});

// ─── ApiVersionRegistry — transitions ─────────────────────────────────────────

describe('ApiVersionRegistry — lifecycle transitions', () => {
  it('deprecate() transitions active → deprecated', () => {
    const reg = makeRegistry();
    reg.deprecate('v2', { deprecatedAt: '2026-01-01T00:00:00Z', sunsetAt: '2027-01-01T00:00:00Z', successorVersion: 'v3' });
    expect(reg.get('v2')?.lifecycle).toBe('deprecated');
    expect(reg.get('v2')?.successorVersion).toBe('v3');
  });

  it('deprecate() uses current date when deprecatedAt not provided', () => {
    const reg = makeRegistry();
    const before = Date.now();
    reg.deprecate('v2');
    const after = Date.now();
    const deprecatedAt = new Date(reg.get('v2')!.deprecatedAt!).getTime();
    expect(deprecatedAt).toBeGreaterThanOrEqual(before);
    expect(deprecatedAt).toBeLessThanOrEqual(after);
  });

  it('deprecate() throws for sunset version', () => {
    const reg = makeRegistry();
    reg.sunset('v1');
    expect(() => reg.deprecate('v1')).toThrow('already-sunset');
  });

  it('sunset() transitions deprecated → sunset', () => {
    const reg = makeRegistry();
    reg.sunset('v1', { sunsetAt: '2026-01-01T00:00:00Z' });
    expect(reg.get('v1')?.lifecycle).toBe('sunset');
  });

  it('activate() transitions draft → active', () => {
    const reg = new ApiVersionRegistry();
    reg.register({ version: 'v3', lifecycle: 'draft', releasedAt: '2026-01-01T00:00:00Z' });
    reg.activate('v3');
    expect(reg.get('v3')?.lifecycle).toBe('active');
  });

  it('activate() throws for sunset version', () => {
    const reg = makeRegistry();
    reg.sunset('v1');
    expect(() => reg.activate('v1')).toThrow('Cannot re-activate sunset');
  });

  it('deprecate() throws for unknown version', () => {
    const reg = makeRegistry();
    expect(() => reg.deprecate('v99')).toThrow('unknown version "v99"');
  });

  it('sunset() throws for unknown version', () => {
    const reg = makeRegistry();
    expect(() => reg.sunset('v99')).toThrow('unknown version "v99"');
  });
});

// ─── ApiVersionRegistry — deprecation warnings ────────────────────────────────

describe('ApiVersionRegistry — getDeprecationWarning', () => {
  it('returns null for active version', () => {
    const reg = makeRegistry();
    expect(reg.getDeprecationWarning('v2')).toBeNull();
  });

  it('returns null for unknown version', () => {
    const reg = makeRegistry();
    expect(reg.getDeprecationWarning('v99')).toBeNull();
  });

  it('returns warning object for deprecated version', () => {
    const reg = makeRegistry();
    const warning = reg.getDeprecationWarning('v1');
    expect(warning).not.toBeNull();
    expect(warning!.version).toBe('v1');
    expect(warning!.message).toContain('deprecated');
    expect(warning!.migrationUrl).toBe('https://example.com/migrate');
    expect(warning!.successorVersion).toBe('v2');
  });

  it('message mentions successor version', () => {
    const reg = makeRegistry();
    const warning = reg.getDeprecationWarning('v1');
    expect(warning!.message).toContain('v2');
  });

  it('message mentions days until sunset for future sunsets', () => {
    const reg = new ApiVersionRegistry();
    const futureDate = new Date(Date.now() + 10 * 86_400_000).toISOString();
    reg.register({
      version: 'v1',
      lifecycle: 'deprecated',
      releasedAt: '2024-01-01T00:00:00Z',
      deprecatedAt: '2025-01-01T00:00:00Z',
      sunsetAt: futureDate,
    });
    const warning = reg.getDeprecationWarning('v1');
    expect(warning!.message).toMatch(/sunsets in \d+ day/);
  });

  it('message mentions passed sunset date', () => {
    const reg = new ApiVersionRegistry();
    const pastDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
    reg.register({
      version: 'v1',
      lifecycle: 'deprecated',
      releasedAt: '2024-01-01T00:00:00Z',
      deprecatedAt: '2024-06-01T00:00:00Z',
      sunsetAt: pastDate,
    });
    const warning = reg.getDeprecationWarning('v1');
    expect(warning!.message).toContain('passed its sunset date');
  });
});

// ─── ApiVersionRegistry — analytics ──────────────────────────────────────────

describe('ApiVersionRegistry — analytics', () => {
  it('recordRequest increments requestCount', () => {
    const reg = makeRegistry();
    reg.recordRequest('v2');
    reg.recordRequest('v2');
    const stats = reg.getStats();
    const v2 = stats.perVersion.find((v) => v.version === 'v2')!;
    expect(v2.requestCount).toBe(2);
  });

  it('recordRequest increments deprecatedRequestCount for deprecated version', () => {
    const reg = makeRegistry();
    reg.recordRequest('v1');
    const stats = reg.getStats();
    const v1 = stats.perVersion.find((v) => v.version === 'v1')!;
    expect(v1.deprecatedRequestCount).toBe(1);
  });

  it('recordRequest is a no-op for unknown version', () => {
    const reg = makeRegistry();
    expect(() => reg.recordRequest('v99')).not.toThrow();
  });

  it('getStats returns correct lifecycle counts', () => {
    const reg = makeRegistry();
    const stats = reg.getStats();
    expect(stats.totalVersions).toBe(2);
    expect(stats.activeVersions).toBe(1);
    expect(stats.deprecatedVersions).toBe(1);
    expect(stats.sunsetVersions).toBe(0);
    expect(stats.draftVersions).toBe(0);
  });

  it('lastSeenAt is set after recordRequest', () => {
    const reg = makeRegistry();
    const before = Date.now();
    reg.recordRequest('v2');
    const after = Date.now();
    const stats = reg.getStats();
    const v2 = stats.perVersion.find((v) => v.version === 'v2')!;
    const lastSeen = new Date(v2.lastSeenAt!).getTime();
    expect(lastSeen).toBeGreaterThanOrEqual(before);
    expect(lastSeen).toBeLessThanOrEqual(after);
  });

  it('resetAnalytics clears all counts', () => {
    const reg = makeRegistry();
    reg.recordRequest('v1');
    reg.recordRequest('v2');
    reg.resetAnalytics();
    const stats = reg.getStats();
    for (const v of stats.perVersion) {
      expect(v.requestCount).toBe(0);
      expect(v.deprecatedRequestCount).toBe(0);
    }
  });
});

// ─── extractVersionFromPath ───────────────────────────────────────────────────

describe('extractVersionFromPath', () => {
  it('extracts v1 from /v1/subscriptions', () => expect(extractVersionFromPath('/v1/subscriptions')).toBe('v1'));
  it('extracts v2 from /api/v2/plans', () => expect(extractVersionFromPath('/api/v2/plans')).toBe('v2'));
  it('extracts v10 from /v10/', () => expect(extractVersionFromPath('/v10/')).toBe('v10'));
  it('returns null when no version in path', () => expect(extractVersionFromPath('/subscriptions')).toBeNull());
  it('returns null for empty path', () => expect(extractVersionFromPath('')).toBeNull());
  it('returns null for /versionx (non-numeric)', () => expect(extractVersionFromPath('/versionx/plans')).toBeNull());
});

// ─── extractVersionFromHeader ─────────────────────────────────────────────────

describe('extractVersionFromHeader', () => {
  it('returns version from api-version header', () => {
    expect(extractVersionFromHeader({ 'api-version': 'v2' })).toBe('v2');
  });

  it('handles array values by returning first', () => {
    expect(extractVersionFromHeader({ 'api-version': ['v1', 'v2'] })).toBe('v1');
  });

  it('returns null when header is absent', () => {
    expect(extractVersionFromHeader({})).toBeNull();
  });

  it('uses custom header name', () => {
    expect(extractVersionFromHeader({ 'x-version': 'v3' }, 'x-version')).toBe('v3');
  });
});

// ─── extractVersionFromQuery ──────────────────────────────────────────────────

describe('extractVersionFromQuery', () => {
  it('returns version from "version" param', () => {
    expect(extractVersionFromQuery({ version: 'v2' })).toBe('v2');
  });

  it('handles array query params', () => {
    expect(extractVersionFromQuery({ version: ['v1', 'v2'] })).toBe('v1');
  });

  it('returns null when param is absent', () => {
    expect(extractVersionFromQuery({})).toBeNull();
  });

  it('uses custom param name', () => {
    expect(extractVersionFromQuery({ api_ver: 'v3' }, 'api_ver')).toBe('v3');
  });
});

// ─── resolveVersion ───────────────────────────────────────────────────────────

describe('resolveVersion', () => {
  it('prefers path over header', () => {
    const reg = makeRegistry();
    const result = resolveVersion(
      { path: '/v1/plans', headers: { 'api-version': 'v2' } },
      reg,
    );
    expect(result?.version).toBe('v1');
    expect(result?.source).toBe('path');
  });

  it('falls back to header when path has no version', () => {
    const reg = makeRegistry();
    const result = resolveVersion(
      { path: '/plans', headers: { 'api-version': 'v1' } },
      reg,
    );
    expect(result?.version).toBe('v1');
    expect(result?.source).toBe('header');
  });

  it('falls back to query param', () => {
    const reg = makeRegistry();
    const result = resolveVersion(
      { path: '/plans', headers: {}, query: { version: 'v2' } },
      reg,
    );
    expect(result?.version).toBe('v2');
    expect(result?.source).toBe('query');
  });

  it('falls back to default when nothing specified', () => {
    const reg = makeRegistry();
    const result = resolveVersion({ path: '/plans', headers: {} }, reg);
    expect(result?.version).toBe('v2');
    expect(result?.source).toBe('default');
  });

  it('returns null when version is not in registry', () => {
    const reg = makeRegistry();
    const result = resolveVersion(
      { path: '/v99/plans', headers: {} },
      reg,
    );
    expect(result).toBeNull();
  });

  it('returns null when no default is set and no version specified', () => {
    const reg = new ApiVersionRegistry();
    reg.register({ version: 'v1', lifecycle: 'active', releasedAt: '2024-01-01T00:00:00Z' });
    const result = resolveVersion({ path: '/plans', headers: {} }, reg);
    expect(result).toBeNull();
  });

  it('can disable path extraction via fromPath: false', () => {
    const reg = makeRegistry();
    const result = resolveVersion(
      { path: '/v1/plans', headers: { 'api-version': 'v2' } },
      reg,
      { fromPath: false },
    );
    expect(result?.source).toBe('header');
    expect(result?.version).toBe('v2');
  });
});

// ─── buildVersionHeaders ──────────────────────────────────────────────────────

describe('buildVersionHeaders', () => {
  it('always includes api-version header', () => {
    const reg = makeRegistry();
    const resolution = resolveVersion({ path: '/v2/plans', headers: {} }, reg)!;
    const headers = buildVersionHeaders(resolution);
    expect(headers[HEADERS.API_VERSION]).toBe('v2');
  });

  it('no deprecation headers for active version', () => {
    const reg = makeRegistry();
    const resolution = resolveVersion({ path: '/v2/plans', headers: {} }, reg)!;
    const headers = buildVersionHeaders(resolution);
    expect(headers[HEADERS.DEPRECATION]).toBeUndefined();
    expect(headers[HEADERS.SUNSET]).toBeUndefined();
    expect(headers[HEADERS.WARNING]).toBeUndefined();
  });

  it('deprecated version gets Deprecation, Sunset, Link, Warning headers', () => {
    const reg = makeRegistry();
    const resolution = resolveVersion({ path: '/v1/plans', headers: {} }, reg)!;
    const headers = buildVersionHeaders(resolution);
    expect(headers[HEADERS.DEPRECATION]).toBeDefined();
    expect(headers[HEADERS.SUNSET]).toBeDefined();
    expect(headers[HEADERS.LINK]).toContain('successor-version');
    expect(headers[HEADERS.WARNING]).toContain('deprecated');
  });

  it('Warning header mentions successor version', () => {
    const reg = makeRegistry();
    const resolution = resolveVersion({ path: '/v1/plans', headers: {} }, reg)!;
    const headers = buildVersionHeaders(resolution);
    expect(headers[HEADERS.WARNING]).toContain('v2');
  });

  it('Warning header mentions sunset date', () => {
    const reg = makeRegistry();
    const resolution = resolveVersion({ path: '/v1/plans', headers: {} }, reg)!;
    const headers = buildVersionHeaders(resolution);
    expect(headers[HEADERS.WARNING]).toContain('2027');
  });

  it('Link header omitted when no migrationUrl', () => {
    const reg = new ApiVersionRegistry();
    reg.register({
      version: 'v1',
      lifecycle: 'deprecated',
      releasedAt: '2024-01-01T00:00:00Z',
      deprecatedAt: '2025-01-01T00:00:00Z',
    });
    reg.setDefault('v1');
    const resolution = resolveVersion({ path: '/v1/plans', headers: {} }, reg)!;
    const headers = buildVersionHeaders(resolution);
    expect(headers[HEADERS.LINK]).toBeUndefined();
  });
});

// ─── createVersionMiddleware ──────────────────────────────────────────────────

describe('createVersionMiddleware — active version pass-through', () => {
  it('calls next() for an active version', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    const req = mockReq({ path: '/v2/subscriptions' });
    const { res } = mockRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('sets api-version header on active response', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    const req = mockReq({ path: '/v2/subscriptions' });
    const { res, capture } = mockRes();
    await middleware(req, res, () => {});
    expect(capture().headers[HEADERS.API_VERSION]).toBe('v2');
  });

  it('records the request in analytics', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    await middleware(mockReq({ path: '/v2/subscriptions' }), mockRes().res, () => {});
    await middleware(mockReq({ path: '/v2/plans' }), mockRes().res, () => {});
    const stats = reg.getStats();
    const v2 = stats.perVersion.find((v) => v.version === 'v2')!;
    expect(v2.requestCount).toBe(2);
  });
});

describe('createVersionMiddleware — deprecated version', () => {
  it('calls next() for deprecated version (not blocked)', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    let nextCalled = false;
    await middleware(mockReq({ path: '/v1/plans' }), mockRes().res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('attaches deprecation headers for deprecated version', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    const { res, capture } = mockRes();
    await middleware(mockReq({ path: '/v1/plans' }), res, () => {});
    const { headers } = capture();
    expect(headers[HEADERS.DEPRECATION]).toBeDefined();
    expect(headers[HEADERS.SUNSET]).toBeDefined();
    expect(headers[HEADERS.WARNING]).toContain('deprecated');
  });

  it('increments deprecatedRequestCount for deprecated version', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    await middleware(mockReq({ path: '/v1/plans' }), mockRes().res, () => {});
    const v1 = reg.getStats().perVersion.find((v) => v.version === 'v1')!;
    expect(v1.deprecatedRequestCount).toBe(1);
  });
});

describe('createVersionMiddleware — sunset version', () => {
  it('returns 410 Gone for sunset version', async () => {
    const reg = makeRegistry();
    reg.sunset('v1');
    const middleware = createVersionMiddleware(reg);
    const { res, capture } = mockRes();
    let nextCalled = false;
    await middleware(mockReq({ path: '/v1/plans' }), res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(capture().statusCode).toBe(410);
  });

  it('410 body contains VERSION_SUNSET error code', async () => {
    const reg = makeRegistry();
    reg.sunset('v1');
    const middleware = createVersionMiddleware(reg);
    const { res, capture } = mockRes();
    await middleware(mockReq({ path: '/v1/plans' }), res, () => {});
    const body = JSON.parse(capture().body);
    expect(body.error.code).toBe('VERSION_SUNSET');
  });

  it('410 body mentions successor version', async () => {
    const reg = makeRegistry();
    reg.sunset('v1');
    const middleware = createVersionMiddleware(reg);
    const { res, capture } = mockRes();
    await middleware(mockReq({ path: '/v1/plans' }), res, () => {});
    const body = JSON.parse(capture().body);
    expect(body.error.message).toContain('v2');
  });

  it('uses custom onSunset handler when provided', async () => {
    const reg = makeRegistry();
    reg.sunset('v1');
    const middleware = createVersionMiddleware(reg, {
      onSunset: () => ({ statusCode: 451, body: 'custom gone' }),
    });
    const { res, capture } = mockRes();
    await middleware(mockReq({ path: '/v1/plans' }), res, () => {});
    expect(capture().statusCode).toBe(451);
    expect(capture().body).toBe('custom gone');
  });
});

describe('createVersionMiddleware — unknown version', () => {
  it('returns 400 when version not in registry', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    const { res, capture } = mockRes();
    let nextCalled = false;
    await middleware(mockReq({ path: '/v99/plans' }), res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(capture().statusCode).toBe(400);
  });

  it('400 body contains VERSION_NOT_FOUND error code', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    const { res, capture } = mockRes();
    await middleware(mockReq({ path: '/v99/plans' }), res, () => {});
    const body = JSON.parse(capture().body);
    expect(body.error.code).toBe('VERSION_NOT_FOUND');
    expect(body.error.message).toContain('v99');
  });

  it('400 body explains no default when nothing specified', async () => {
    const reg = new ApiVersionRegistry();
    reg.register({ version: 'v1', lifecycle: 'active', releasedAt: '2024-01-01T00:00:00Z' });
    const middleware = createVersionMiddleware(reg);
    const { res, capture } = mockRes();
    await middleware(mockReq({ path: '/plans' }), res, () => {});
    const body = JSON.parse(capture().body);
    expect(body.error.message).toContain('no default');
  });

  it('uses custom onUnresolved handler', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg, {
      onUnresolved: () => ({ statusCode: 406, body: 'custom error' }),
    });
    const { res, capture } = mockRes();
    await middleware(mockReq({ path: '/v99/plans' }), res, () => {});
    expect(capture().statusCode).toBe(406);
    expect(capture().body).toBe('custom error');
  });
});

describe('createVersionMiddleware — version resolution order', () => {
  it('resolves version from header when path has no version', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    const req = mockReq({ path: '/plans', headers: { 'api-version': 'v1' } });
    const { res, capture } = mockRes();
    await middleware(req, res, () => {});
    expect(capture().headers[HEADERS.API_VERSION]).toBe('v1');
  });

  it('resolves from query param when path and header are absent', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    const req = mockReq({ path: '/plans', headers: {}, query: { version: 'v2' } });
    const { res, capture } = mockRes();
    await middleware(req, res, () => {});
    expect(capture().headers[HEADERS.API_VERSION]).toBe('v2');
  });

  it('falls back to default when nothing specified', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    const req = mockReq({ path: '/plans', headers: {} });
    const { res, capture } = mockRes();
    await middleware(req, res, () => {});
    expect(capture().headers[HEADERS.API_VERSION]).toBe('v2');
  });
});

// ─── Singleton versionRegistry ────────────────────────────────────────────────

describe('versionRegistry singleton', () => {
  it('is exported and has v1 and v2 registered', () => {
    expect(versionRegistry.has('v1')).toBe(true);
    expect(versionRegistry.has('v2')).toBe(true);
  });

  it('default version is v2', () => {
    expect(versionRegistry.getDefault()).toBe('v2');
  });

  it('v1 is deprecated', () => {
    expect(versionRegistry.get('v1')?.lifecycle).toBe('deprecated');
  });

  it('v2 is active', () => {
    expect(versionRegistry.get('v2')?.lifecycle).toBe('active');
  });
});

// ─── Integration: full v1 → v2 migration scenario ────────────────────────────

describe('Integration — v1→v2 migration scenario', () => {
  it('legacy client on v1 receives deprecation warning but gets a response', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    const dispatched: string[] = [];
    const req = mockReq({ path: '/v1/subscriptions' });
    const { res, capture } = mockRes();

    await middleware(req, res, () => { dispatched.push('handler'); });

    expect(dispatched).toContain('handler');
    const { headers } = capture();
    expect(headers[HEADERS.DEPRECATION]).toBeDefined();
    expect(headers[HEADERS.SUNSET]).toBeDefined();
    expect(headers[HEADERS.WARNING]).toContain('v2');
  });

  it('upgraded client on v2 receives clean response with no deprecation headers', async () => {
    const reg = makeRegistry();
    const middleware = createVersionMiddleware(reg);
    const req = mockReq({ path: '/v2/subscriptions' });
    const { res, capture } = mockRes();

    await middleware(req, res, () => {});

    const { headers } = capture();
    expect(headers[HEADERS.DEPRECATION]).toBeUndefined();
    expect(headers[HEADERS.WARNING]).toBeUndefined();
    expect(headers[HEADERS.API_VERSION]).toBe('v2');
  });

  it('client attempting sunset version gets blocked with 410', async () => {
    const reg = makeRegistry();
    reg.sunset('v1');
    const middleware = createVersionMiddleware(reg);
    const req = mockReq({ path: '/v1/subscriptions' });
    const { res, capture } = mockRes();

    await middleware(req, res, () => {});

    const { statusCode, body } = capture();
    expect(statusCode).toBe(410);
    const parsed = JSON.parse(body);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('VERSION_SUNSET');
  });

  it('analytics correctly tracks v1 vs v2 usage', async () => {
    const reg = makeRegistry();
    reg.resetAnalytics();
    const middleware = createVersionMiddleware(reg);

    // 3 v2 requests
    for (let i = 0; i < 3; i++) {
      await middleware(mockReq({ path: '/v2/plans' }), mockRes().res, () => {});
    }
    // 2 v1 requests (deprecated)
    for (let i = 0; i < 2; i++) {
      await middleware(mockReq({ path: '/v1/plans' }), mockRes().res, () => {});
    }

    const stats = reg.getStats();
    const v2 = stats.perVersion.find((v) => v.version === 'v2')!;
    const v1 = stats.perVersion.find((v) => v.version === 'v1')!;
    expect(v2.requestCount).toBe(3);
    expect(v1.requestCount).toBe(2);
    expect(v1.deprecatedRequestCount).toBe(2);
    expect(v2.deprecatedRequestCount).toBe(0);
  });
});
