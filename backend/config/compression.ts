/**
 * Compression configuration for the API gateway.
 *
 * Controls algorithm negotiation, default levels, per-endpoint overrides,
 * the minimum payload threshold, and endpoint skip patterns.
 *
 * Route handlers can override the per-request level by setting the response
 * header  X-Compression-Level  before the middleware processes the body.
 */

export type CompressionAlgorithm = 'br' | 'gzip' | 'identity';

export interface EndpointCompressionOverride {
  algorithm: CompressionAlgorithm;
  level: number;
  threshold: number;
}

export interface GlobalCompressionConfig {
  default: EndpointCompressionOverride;
  /** URL path patterns mapped to overrides. Evaluated in insertion order. */
  endpointOverrides: Map<string, Partial<EndpointCompressionOverride>>;
  /** Regex patterns for paths that must never be compressed. */
  skipPatterns: RegExp[];
}

export const X_COMPRESSION_LEVEL_HEADER = 'X-Compression-Level';

export const DEFAULT_COMPRESSION_CONFIG: GlobalCompressionConfig = {
  default: {
    algorithm: 'br',
    level: 4,
    threshold: 1024,
  },
  endpointOverrides: new Map([
    ['/api/exports/invoices', { level: 5 }],
    ['/api/exports/dump', { level: 6, threshold: 512 }],
    ['/api/analytics/reports', { level: 3 }],
    ['/api/analytics/export', { level: 5 }],
    ['/api/subscriptions/list', { level: 4, threshold: 2048 }],
  ]),
  skipPatterns: [
    /\/stream\/video\//,
    /\/downloads\/.*\.(gz|br|zip|mp4|webm|webp|avif)$/,
    /\/realtime\/events/,
    /^\/ws(\/|$)/,
    /\/health$/,
  ],
};

/**
 * Resolve the compression config for a given request path.
 *
 * @param path - URL pathname (e.g. "/api/exports/invoices/2025-01.csv")
 * @param runtimeLevel - Optional value from the X-Compression-Level response header
 */
export function resolveCompressionConfig(
  config: GlobalCompressionConfig,
  path: string,
  runtimeLevel?: number,
): EndpointCompressionOverride {
  const resolved: EndpointCompressionOverride = { ...config.default };

  for (const [pattern, override] of config.endpointOverrides) {
    if (path.startsWith(pattern)) {
      Object.assign(resolved, override);
      break;
    }
  }

  if (runtimeLevel !== undefined && runtimeLevel >= 0 && runtimeLevel <= 11) {
    resolved.level = runtimeLevel;
  }

  return resolved;
}

/**
 * Check whether compression should be skipped entirely for this path.
 */
export function shouldSkipCompression(
  config: GlobalCompressionConfig,
  path: string,
): boolean {
  return config.skipPatterns.some((pattern) => pattern.test(path));
}
