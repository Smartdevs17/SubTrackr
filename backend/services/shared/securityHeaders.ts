/**
 * Security Headers Middleware — SubTrackr
 *
 * Provides HSTS, CSP, X-Frame-Options, Permissions-Policy,
 * X-Content-Type-Options, Referrer-Policy, and X-XSS-Protection headers.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface SecurityHeadersConfig {
  hsts?: {
    maxAge?: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };
  csp?: {
    defaultSrc?: string[];
    scriptSrc?: string[];
    styleSrc?: string[];
    imgSrc?: string[];
    connectSrc?: string[];
    fontSrc?: string[];
    objectSrc?: string[];
    frameSrc?: string[];
    reportUri?: string;
  };
  frameOptions?: 'DENY' | 'SAMEORIGIN' | string;
  contentTypeOptions?: boolean;
  referrerPolicy?: string;
  permissionsPolicy?: Record<string, string>;
  xssProtection?: boolean;
}

const DEFAULT_CONFIG: Required<SecurityHeadersConfig> = {
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  csp: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'", 'https://api.subtrackr.app'],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameSrc: ["'none'"],
    reportUri: '/csp-report',
  },
  frameOptions: 'DENY',
  contentTypeOptions: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: {
    camera: "()",
    microphone: "()",
    geolocation: "()",
    payment: "(self)",
    usb: "()",
    magnetometer: "()",
    accelerometer: "()",
    gyroscope: "()",
    autoplay: "(self)",
    encrypted-media: "(self)",
  },
  xssProtection: true,
};

function buildHstsHeader(hsts: Required<SecurityHeadersConfig>['hsts']): string {
  let value = `max-age=${hsts.maxAge}`;
  if (hsts.includeSubDomains) value += '; includeSubDomains';
  if (hsts.preload) value += '; preload';
  return value;
}

function buildCspHeader(csp: Required<SecurityHeadersConfig>['csp']): string {
  const directives: string[] = [];

  if (csp.defaultSrc.length) directives.push(`default-src ${csp.defaultSrc.join(' ')}`);
  if (csp.scriptSrc.length) directives.push(`script-src ${csp.scriptSrc.join(' ')}`);
  if (csp.styleSrc.length) directives.push(`style-src ${csp.styleSrc.join(' ')}`);
  if (csp.imgSrc.length) directives.push(`img-src ${csp.imgSrc.join(' ')}`);
  if (csp.connectSrc.length) directives.push(`connect-src ${csp.connectSrc.join(' ')}`);
  if (csp.fontSrc.length) directives.push(`font-src ${csp.fontSrc.join(' ')}`);
  if (csp.objectSrc.length) directives.push(`object-src ${csp.objectSrc.join(' ')}`);
  if (csp.frameSrc.length) directives.push(`frame-src ${csp.frameSrc.join(' ')}`);
  if (csp.reportUri) directives.push(`report-uri ${csp.reportUri}`);

  return directives.join('; ');
}

function buildPermissionsPolicyHeader(policy: Record<string, string>): string {
  return Object.entries(policy)
    .map(([feature, allowlist]) => `${feature}=${allowlist}`)
    .join(', ');
}

export function getSecurityHeaders(config: Partial<SecurityHeadersConfig> = {}): Record<string, string> {
  const cfg = {
    ...DEFAULT_CONFIG,
    ...config,
    hsts: { ...DEFAULT_CONFIG.hsts, ...config.hsts },
    csp: { ...DEFAULT_CONFIG.csp, ...config.csp },
    permissionsPolicy: { ...DEFAULT_CONFIG.permissionsPolicy, ...config.permissionsPolicy },
  };

  const headers: Record<string, string> = {};

  headers['Strict-Transport-Security'] = buildHstsHeader(cfg.hsts);
  headers['Content-Security-Policy'] = buildCspHeader(cfg.csp);
  headers['X-Frame-Options'] = cfg.frameOptions;

  if (cfg.contentTypeOptions) {
    headers['X-Content-Type-Options'] = 'nosniff';
  }

  headers['Referrer-Policy'] = cfg.referrerPolicy;
  headers['Permissions-Policy'] = buildPermissionsPolicyHeader(cfg.permissionsPolicy);

  if (cfg.xssProtection) {
    headers['X-XSS-Protection'] = '1; mode=block';
  }

  headers['X-DNS-Prefetch-Control'] = 'off';
  headers['X-Download-Options'] = 'noopen';
  headers['X-Permitted-Cross-Domain-Policies'] = 'none';

  return headers;
}

export function createSecurityHeadersMiddleware(config: Partial<SecurityHeadersConfig> = {}) {
  const headers = getSecurityHeaders(config);

  return function securityHeadersMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): void {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
    next();
  };
}

export function getHstsHeader(config: Partial<SecurityHeadersConfig['hsts']> = {}): string {
  const hsts = { ...DEFAULT_CONFIG.hsts, ...config };
  return buildHstsHeader(hsts);
}

export function getCspHeader(config: Partial<SecurityHeadersConfig['csp']> = {}): string {
  const csp = { ...DEFAULT_CONFIG.csp, ...config };
  return buildCspHeader(csp);
}
