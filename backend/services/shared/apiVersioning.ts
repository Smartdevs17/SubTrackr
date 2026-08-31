/**
 * apiVersioning.ts — API Versioning & Deprecation Management — SubTrackr
 *
 * Provides:
 *  - Version registry: register supported API versions with lifecycle state
 *  - Deprecation notices: sunset dates, migration guides, warning headers
 *  - Request routing: extract version from URL path, header, or query param
 *  - Middleware: attach version headers + deprecation warnings to responses
 *  - Sunset enforcement: block requests to sunset versions
 *  - Analytics: track per-version request counts and deprecated-version usage
 *
 * Version lifecycle: draft → active → deprecated → sunset
 *
 * HTTP headers used:
 *   API-Version           — the version resolved for this request
 *   Deprecation           — ISO date when deprecation began (RFC 8594)
 *   Sunset                — ISO date when version will stop working (RFC 8594)
 *   Link                  — rel="successor-version" pointing to migration docs
 *   Warning               — human-readable deprecation message (legacy)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type VersionLifecycle = 'draft' | 'active' | 'deprecated' | 'sunset';

export interface VersionConfig {
  /** Version identifier, e.g. "v1", "v2", "2025-01" */
  version: string;
  /** Current lifecycle state */
  lifecycle: VersionLifecycle;
  /** ISO date string when this version was released */
  releasedAt: string;
  /** ISO date string when deprecation began (required when deprecated/sunset) */
  deprecatedAt?: string;
  /** ISO date string when this version will be/was removed */
  sunsetAt?: string;
  /** URL to migration guide or successor version docs */
  migrationUrl?: string;
  /** The next recommended version clients should upgrade to */
  successorVersion?: string;
  /** Human-readable description */
  description?: string;
}

export interface VersionResolution {
  /** Resolved version string */
  version: string;
  /** How the version was resolved */
  source: 'path' | 'header' | 'query' | 'default';
  /** The full config for this version */
  config: VersionConfig;
}

export interface DeprecationWarning {
  version: string;
  deprecatedAt: string;
  sunsetAt?: string;
  migrationUrl?: string;
  successorVersion?: string;
  message: string;
}

export interface VersionAnalytics {
  version: string;
  requestCount: number;
  deprecatedRequestCount: number;
  lastSeenAt?: string;
}

export interface VersionRegistryStats {
  totalVersions: number;
  activeVersions: number;
  deprecatedVersions: number;
  sunsetVersions: number;
  draftVersions: number;
  perVersion: VersionAnalytics[];
}

// ─── HTTP header names ────────────────────────────────────────────────────────

export const HEADERS = {
  API_VERSION: 'api-version',
  DEPRECATION: 'deprecation',
  SUNSET: 'sunset',
  LINK: 'link',
  WARNING: 'warning',
} as const;

// ─── Version comparator ───────────────────────────────────────────────────────

/**
 * Parse a version string like "v1", "v2", "2025-01" into a comparable number.
 * Numeric prefix (from "vN" or "N") is used; date versions use YYYYMM.
 */
export function parseVersionNumber(v: string): number {
  // "v1" → 1, "v2" → 2
  const vPrefixed = /^v(\d+)$/i.exec(v);
  if (vPrefixed) return parseInt(vPrefixed[1], 10);
  // "2025-01" → 202501
  const dateFmt = /^(\d{4})-(\d{2})$/.exec(v);
  if (dateFmt) return parseInt(dateFmt[1] + dateFmt[2], 10);
  // plain integer string
  const plain = /^(\d+)$/.exec(v);
  if (plain) return parseInt(plain[1], 10);
  return 0;
}

// ─── ApiVersionRegistry ───────────────────────────────────────────────────────

/**
 * Central registry for API versions.
 *
 * Usage:
 * ```ts
 * const registry = new ApiVersionRegistry();
 * registry.register({ version: 'v1', lifecycle: 'deprecated', releasedAt: '2024-01-01', sunsetAt: '2026-01-01' });
 * registry.register({ version: 'v2', lifecycle: 'active', releasedAt: '2025-01-01' });
 * registry.setDefault('v2');
 * ```
 */
export class ApiVersionRegistry {
  private versions = new Map<string, VersionConfig>();
  private defaultVersion: string | null = null;
  private analytics = new Map<string, { requestCount: number; deprecatedCount: number; lastSeenAt?: string }>();

  // ── Registration ────────────────────────────────────────────────────────────

  register(config: VersionConfig): this {
    this.validateConfig(config);
    this.versions.set(config.version, { ...config });
    if (!this.analytics.has(config.version)) {
      this.analytics.set(config.version, { requestCount: 0, deprecatedCount: 0 });
    }
    return this;
  }

  unregister(version: string): boolean {
    if (this.defaultVersion === version) this.defaultVersion = null;
    this.analytics.delete(version);
    return this.versions.delete(version);
  }

  setDefault(version: string): this {
    if (!this.versions.has(version)) {
      throw new Error(`ApiVersionRegistry: cannot set default to unknown version "${version}"`);
    }
    this.defaultVersion = version;
    return this;
  }

  getDefault(): string | null {
    return this.defaultVersion;
  }

  // ── Lookups ─────────────────────────────────────────────────────────────────

  get(version: string): VersionConfig | undefined {
    return this.versions.get(version);
  }

  has(version: string): boolean {
    return this.versions.has(version);
  }

  getAll(): VersionConfig[] {
    return Array.from(this.versions.values());
  }

  getActive(): VersionConfig[] {
    return this.getAll().filter((v) => v.lifecycle === 'active');
  }

  getDeprecated(): VersionConfig[] {
    return this.getAll().filter((v) => v.lifecycle === 'deprecated');
  }

  getSunset(): VersionConfig[] {
    return this.getAll().filter((v) => v.lifecycle === 'sunset');
  }

  /** Returns the latest active version by parsed version number. */
  getLatestActive(): VersionConfig | undefined {
    const active = this.getActive();
    return active.sort((a, b) => parseVersionNumber(b.version) - parseVersionNumber(a.version))[0];
  }

  // ── Transition ──────────────────────────────────────────────────────────────

  deprecate(
    version: string,
    opts: { deprecatedAt?: string; sunsetAt?: string; successorVersion?: string; migrationUrl?: string } = {},
  ): this {
    const config = this.requireVersion(version);
    if (config.lifecycle === 'sunset') {
      throw new Error(`Cannot deprecate already-sunset version "${version}"`);
    }
    this.versions.set(version, {
      ...config,
      lifecycle: 'deprecated',
      deprecatedAt: opts.deprecatedAt ?? new Date().toISOString(),
      sunsetAt: opts.sunsetAt ?? config.sunsetAt,
      successorVersion: opts.successorVersion ?? config.successorVersion,
      migrationUrl: opts.migrationUrl ?? config.migrationUrl,
    });
    return this;
  }

  sunset(version: string, opts: { sunsetAt?: string } = {}): this {
    const config = this.requireVersion(version);
    this.versions.set(version, {
      ...config,
      lifecycle: 'sunset',
      sunsetAt: opts.sunsetAt ?? config.sunsetAt ?? new Date().toISOString(),
    });
    return this;
  }

  activate(version: string): this {
    const config = this.requireVersion(version);
    if (config.lifecycle === 'sunset') {
      throw new Error(`Cannot re-activate sunset version "${version}"`);
    }
    this.versions.set(version, { ...config, lifecycle: 'active' });
    return this;
  }

  // ── Deprecation notice ──────────────────────────────────────────────────────

  getDeprecationWarning(version: string): DeprecationWarning | null {
    const config = this.versions.get(version);
    if (!config || config.lifecycle !== 'deprecated') return null;

    const daysUntilSunset = config.sunsetAt
      ? Math.ceil((new Date(config.sunsetAt).getTime() - Date.now()) / 86_400_000)
      : null;

    const timeNotice = daysUntilSunset != null
      ? daysUntilSunset > 0
        ? ` This version sunsets in ${daysUntilSunset} day(s).`
        : ' This version has passed its sunset date.'
      : '';

    const upgradeNotice = config.successorVersion
      ? ` Please upgrade to ${config.successorVersion}.`
      : '';

    return {
      version,
      deprecatedAt: config.deprecatedAt!,
      sunsetAt: config.sunsetAt,
      migrationUrl: config.migrationUrl,
      successorVersion: config.successorVersion,
      message: `API version "${version}" is deprecated.${timeNotice}${upgradeNotice}`,
    };
  }

  // ── Analytics ───────────────────────────────────────────────────────────────

  recordRequest(version: string): void {
    const config = this.versions.get(version);
    if (!config) return;
    const stats = this.analytics.get(version) ?? { requestCount: 0, deprecatedCount: 0 };
    stats.requestCount++;
    if (config.lifecycle === 'deprecated') stats.deprecatedCount++;
    stats.lastSeenAt = new Date().toISOString();
    this.analytics.set(version, stats);
  }

  getStats(): VersionRegistryStats {
    const all = this.getAll();
    const perVersion: VersionAnalytics[] = all.map((v) => {
      const a = this.analytics.get(v.version) ?? { requestCount: 0, deprecatedCount: 0 };
      return {
        version: v.version,
        requestCount: a.requestCount,
        deprecatedRequestCount: a.deprecatedCount,
        lastSeenAt: a.lastSeenAt,
      };
    });
    return {
      totalVersions: all.length,
      activeVersions: all.filter((v) => v.lifecycle === 'active').length,
      deprecatedVersions: all.filter((v) => v.lifecycle === 'deprecated').length,
      sunsetVersions: all.filter((v) => v.lifecycle === 'sunset').length,
      draftVersions: all.filter((v) => v.lifecycle === 'draft').length,
      perVersion,
    };
  }

  resetAnalytics(): void {
    for (const v of this.versions.keys()) {
      this.analytics.set(v, { requestCount: 0, deprecatedCount: 0 });
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private requireVersion(version: string): VersionConfig {
    const config = this.versions.get(version);
    if (!config) throw new Error(`ApiVersionRegistry: unknown version "${version}"`);
    return config;
  }

  private validateConfig(config: VersionConfig): void {
    if (!config.version?.trim()) {
      throw new Error('ApiVersionRegistry: version string is required');
    }
    if (!['draft', 'active', 'deprecated', 'sunset'].includes(config.lifecycle)) {
      throw new Error(`ApiVersionRegistry: invalid lifecycle "${config.lifecycle}"`);
    }
    if ((config.lifecycle === 'deprecated' || config.lifecycle === 'sunset') && !config.deprecatedAt) {
      throw new Error(`ApiVersionRegistry: deprecatedAt is required for lifecycle "${config.lifecycle}"`);
    }
    if (config.sunsetAt && config.deprecatedAt) {
      if (new Date(config.sunsetAt) <= new Date(config.deprecatedAt)) {
        throw new Error('ApiVersionRegistry: sunsetAt must be after deprecatedAt');
      }
    }
  }
}

// ─── Version extraction ───────────────────────────────────────────────────────

export interface VersionExtractionOptions {
  /** Header name to check for version, e.g. "api-version". Default: "api-version" */
  headerName?: string;
  /** Query param name, e.g. "version". Default: "version" */
  queryParam?: string;
  /** Path segment pattern, e.g. /api/v2/... extracts "v2". Default: true */
  fromPath?: boolean;
}

/**
 * Extract a version string from a request URL path.
 * Matches patterns like /v1/, /v2/, /api/v3/
 */
export function extractVersionFromPath(path: string): string | null {
  const match = /\/v(\d+)(?:\/|$)/.exec(path);
  return match ? `v${match[1]}` : null;
}

/**
 * Extract a version from a query string map.
 */
export function extractVersionFromQuery(
  query: Record<string, string | string[] | undefined>,
  param = 'version',
): string | null {
  const val = query[param];
  if (!val) return null;
  return Array.isArray(val) ? val[0] ?? null : val;
}

/**
 * Extract a version from request headers.
 */
export function extractVersionFromHeader(
  headers: Record<string, string | string[] | undefined>,
  headerName = HEADERS.API_VERSION,
): string | null {
  const val = headers[headerName.toLowerCase()];
  if (!val) return null;
  return Array.isArray(val) ? val[0] ?? null : val;
}

/**
 * Resolve a version from a request, checking path → header → query → default.
 */
export function resolveVersion(
  opts: {
    path?: string;
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
  },
  registry: ApiVersionRegistry,
  options: VersionExtractionOptions = {},
): VersionResolution | null {
  const defaultVersion = registry.getDefault();

  // 1. Path
  if (opts.path && options.fromPath !== false) {
    const v = extractVersionFromPath(opts.path);
    if (v && registry.has(v)) {
      return { version: v, source: 'path', config: registry.get(v)! };
    }
  }

  // 2. Header
  if (opts.headers) {
    const v = extractVersionFromHeader(opts.headers, options.headerName);
    if (v && registry.has(v)) {
      return { version: v, source: 'header', config: registry.get(v)! };
    }
  }

  // 3. Query param
  if (opts.query) {
    const v = extractVersionFromQuery(opts.query, options.queryParam);
    if (v && registry.has(v)) {
      return { version: v, source: 'query', config: registry.get(v)! };
    }
  }

  // 4. Default
  if (defaultVersion && registry.has(defaultVersion)) {
    return { version: defaultVersion, source: 'default', config: registry.get(defaultVersion)! };
  }

  return null;
}

// ─── Response header builder ──────────────────────────────────────────────────

export interface VersionResponseHeaders {
  [key: string]: string;
}

/**
 * Build the set of HTTP response headers for a resolved version.
 * Always includes API-Version.
 * Deprecated versions get Deprecation + Sunset + Link + Warning headers.
 */
export function buildVersionHeaders(resolution: VersionResolution): VersionResponseHeaders {
  const headers: VersionResponseHeaders = {
    [HEADERS.API_VERSION]: resolution.version,
  };

  const { config } = resolution;

  if (config.lifecycle === 'deprecated') {
    if (config.deprecatedAt) {
      headers[HEADERS.DEPRECATION] = new Date(config.deprecatedAt).toUTCString();
    }
    if (config.sunsetAt) {
      headers[HEADERS.SUNSET] = new Date(config.sunsetAt).toUTCString();
    }
    if (config.migrationUrl) {
      headers[HEADERS.LINK] = `<${config.migrationUrl}>; rel="successor-version"`;
    }
    const warning = `299 - "API version ${config.version} is deprecated.${
      config.successorVersion ? ` Upgrade to ${config.successorVersion}.` : ''
    }${config.sunsetAt ? ` Sunset: ${config.sunsetAt}.` : ''}"`;
    headers[HEADERS.WARNING] = warning;
  }

  return headers;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export interface VersionMiddlewareOptions extends VersionExtractionOptions {
  /**
   * Called when a sunset version is requested.
   * Default: respond with 410 Gone.
   */
  onSunset?: (version: string, config: VersionConfig) => {
    statusCode: number;
    body: string;
    headers?: Record<string, string>;
  };
  /**
   * Called when version cannot be resolved.
   * Default: respond with 400 Bad Request.
   */
  onUnresolved?: (requestedVersion: string | null) => {
    statusCode: number;
    body: string;
  };
}

export interface MiddlewareRequest {
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
}

export interface MiddlewareResponse {
  setHeader(name: string, value: string): void;
  writeHead(statusCode: number, headers?: Record<string, string>): void;
  end(body?: string): void;
}

/**
 * Framework-agnostic versioning middleware.
 *
 * Resolves the API version, enforces sunset blocks, attaches deprecation
 * headers, records analytics, and calls `next()` for valid versions.
 *
 * @example — Node.js http
 * const middleware = createVersionMiddleware(registry);
 * const handled = await middleware(req, res, () => {});
 *
 * @example — Express
 * app.use(createVersionMiddleware(registry) as any);
 */
export function createVersionMiddleware(
  registry: ApiVersionRegistry,
  options: VersionMiddlewareOptions = {},
) {
  return async function versionMiddleware(
    req: MiddlewareRequest,
    res: MiddlewareResponse,
    next: () => void | Promise<void>,
  ): Promise<void> {
    const resolution = resolveVersion(
      { path: req.path, headers: req.headers, query: req.query },
      registry,
      options,
    );

    // Unresolvable version
    if (!resolution) {
      const requestedVersion =
        extractVersionFromPath(req.path ?? '') ??
        extractVersionFromHeader(req.headers, options.headerName) ??
        extractVersionFromQuery(req.query ?? {}, options.queryParam);

      if (options.onUnresolved) {
        const { statusCode, body } = options.onUnresolved(requestedVersion);
        res.writeHead(statusCode);
        res.end(body);
        return;
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'VERSION_NOT_FOUND',
            message: requestedVersion
              ? `API version "${requestedVersion}" is not supported`
              : 'No API version specified and no default is configured',
          },
        }),
      );
      return;
    }

    const { config } = resolution;

    // Sunset — block with 410 Gone
    if (config.lifecycle === 'sunset') {
      if (options.onSunset) {
        const { statusCode, body, headers } = options.onSunset(config.version, config);
        res.writeHead(statusCode, headers);
        res.end(body);
        return;
      }

      res.writeHead(410, {
        'Content-Type': 'application/json',
        [HEADERS.API_VERSION]: config.version,
        ...(config.sunsetAt ? { [HEADERS.SUNSET]: new Date(config.sunsetAt).toUTCString() } : {}),
        ...(config.migrationUrl
          ? { [HEADERS.LINK]: `<${config.migrationUrl}>; rel="successor-version"` }
          : {}),
      });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'VERSION_SUNSET',
            message: `API version "${config.version}" has been sunset and is no longer available.${
              config.successorVersion ? ` Please upgrade to ${config.successorVersion}.` : ''
            }${config.migrationUrl ? ` Migration guide: ${config.migrationUrl}` : ''}`,
          },
        }),
      );
      return;
    }

    // Attach version headers
    const versionHeaders = buildVersionHeaders(resolution);
    for (const [name, value] of Object.entries(versionHeaders)) {
      res.setHeader(name, value);
    }

    // Record analytics
    registry.recordRequest(resolution.version);

    await next();
  };
}

// ─── Singleton registry ───────────────────────────────────────────────────────

/**
 * Application-wide version registry.
 * Pre-configured with SubTrackr's version history.
 */
export const versionRegistry = new ApiVersionRegistry();

versionRegistry
  .register({
    version: 'v1',
    lifecycle: 'deprecated',
    releasedAt: '2024-01-01T00:00:00Z',
    deprecatedAt: '2025-01-01T00:00:00Z',
    sunsetAt: '2026-06-01T00:00:00Z',
    successorVersion: 'v2',
    migrationUrl: 'https://docs.subtrackr.io/migration/v1-to-v2',
    description: 'Initial release. Deprecated in favour of v2.',
  })
  .register({
    version: 'v2',
    lifecycle: 'active',
    releasedAt: '2025-01-01T00:00:00Z',
    description: 'Current stable API version.',
  })
  .setDefault('v2');
