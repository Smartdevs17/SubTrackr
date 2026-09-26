/**
 * Security headers middleware for HTTP responses.
 *
 * Issue #1010: adds production-ready HSTS and Permissions-Policy headers,
 * plus common hardening headers, to every response.
 */

export interface SecurityHeadersOptions {
  /** HSTS max-age in seconds. Default: 1 year. */
  hstsMaxAge?: number;
  /** Whether to include subdomains in HSTS. Default: true. */
  hstsIncludeSubDomains?: boolean;
  /** Whether to preload HSTS. Default: true. */
  hstsPreload?: boolean;
  /** Custom permissions policy directives. */
  permissionsPolicy?: Record<string, string | (string | 'none')[]>;
}

const DEFAULT_PERMISSIONS_POLICY: Record<string, (string | 'none')[]> = {
  accelerometer: ["'none'"],
  ambientLightSensor: ["'none'"],
  autoplay: ["'none'"],
  camera: ["'none'"],
  crossOriginIsolated: ["'none'"],
  displayCapture: ["'none'"],
  encryptedMedia: ["'none'"],
  geolocation: ["'none'"],
  gyroscope: ["'none'"],
  magnetometer: ["'none'"],
  microphone: ["'none'"],
  midi: ["'none'"],
  payment: ["'none'"],
  pictureInPicture: ["'none'"],
  publickeyCredentialsGet: ["'self'"],
  screenWakeLock: ["'none'"],
  usb: ["'none'"],
  webRTC: ["'none'"],
  xrSpatialTracking: ["'none'"],
};

function buildHsts(options: SecurityHeadersOptions): string {
  const maxAge = options.hstsMaxAge ?? 63_072_000;
  const includeSubDomains = options.hstsIncludeSubDomains ?? true;
  const preload = options.hstsPreload ?? true;
  const parts = [`max-age=${maxAge}`];
  if (includeSubDomains) parts.push('includeSubDomains');
  if (preload) parts.push('preload');
  return parts.join('; ');
}

function buildPermissionsPolicy(
  options: SecurityHeadersOptions,
): string {
  const policy = { ...DEFAULT_PERMISSIONS_POLICY, ...(options.permissionsPolicy ?? {}) };
  return Object.entries(policy)
    .map(([name, values]) => `${name}=${Array.isArray(values) ? values.join(' ') : values}`)
    .join(', ');
}

export function buildSecurityHeaders(
  options: SecurityHeadersOptions = {},
): Record<string, string> {
  return {
    'Strict-Transport-Security': buildHsts(options),
    'Permissions-Policy': buildPermissionsPolicy(options),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

export function securityHeadersMiddleware(options: SecurityHeadersOptions = {}) {
  const headers = buildSecurityHeaders(options);
  return function applySecurityHeaders(
    _req: unknown,
    res: {
      setHeader(name: string, value: string | number | string[]): void;
      headersSent: boolean;
    },
    next: () => void,
  ): void {
    if (!res.headersSent) {
      for (const [name, value] of Object.entries(headers)) {
        res.setHeader(name, value);
      }
    }
    next();
  };
}

export function applySecurityHeadersToResponse(
  res: {
    setHeader(name: string, value: string | number | string[]): void;
    headersSent: boolean;
  },
  options: SecurityHeadersOptions = {},
): void {
  if (!res.headersSent) {
    const headers = buildSecurityHeaders(options);
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
  }
}
