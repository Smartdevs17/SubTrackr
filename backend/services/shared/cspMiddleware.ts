/**
 * CSP Middleware — SubTrackr
 *
 * Content Security Policy middleware for XSS prevention.
 * Generates nonce-based CSP headers for inline scripts.
 */

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface CspConfig {
  directives: Record<string, string[]>;
  reportOnly: boolean;
  reportUri: string;
  useNonce: boolean;
}

const DEFAULT_CSP_CONFIG: CspConfig = {
  directives: {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'strict-dynamic'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", 'wss:', 'https:'],
    'media-src': ["'self'"],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'upgrade-insecure-requests': [],
  },
  reportOnly: false,
  reportUri: '/csp-report',
  useNonce: true,
};

export class CspMiddleware {
  private config: CspConfig;

  constructor(config: Partial<CspConfig> = {}) {
    this.config = {
      ...DEFAULT_CSP_CONFIG,
      ...config,
      directives: { ...DEFAULT_CSP_CONFIG.directives, ...config.directives },
    };
  }

  generateNonce(): string {
    return randomBytes(16).toString('base64');
  }

  buildPolicyHeader(nonce?: string): string {
    const directives = { ...this.config.directives };

    if (nonce && this.config.useNonce) {
      directives['script-src'] = [
        ...(directives['script-src'] ?? []),
        `'nonce-${nonce}'`,
      ];
    }

    if (this.config.reportUri) {
      directives['report-uri'] = [this.config.reportUri];
    }

    return Object.entries(directives)
      .map(([key, values]) => {
        if (values.length === 0) return key;
        return `${key} ${values.join(' ')}`;
      })
      .join('; ');
  }

  createMiddleware() {
    const self = this;

    return function cspMiddleware(
      req: IncomingMessage,
      res: ServerResponse & { cspNonce?: string },
      next: () => void,
    ): void {
      const nonce = self.config.useNonce ? self.generateNonce() : undefined;
      res.cspNonce = nonce;

      const policy = self.buildPolicyHeader(nonce);
      const headerName = self.config.reportOnly
        ? 'Content-Security-Policy-Report-Only'
        : 'Content-Security-Policy';

      res.setHeader(headerName, policy);
      next();
    };
  }

  setDirectives(directives: Record<string, string[]>): void {
    this.config.directives = { ...this.config.directives, ...directives };
  }

  allowSource(directive: string, source: string): void {
    const current = this.config.directives[directive] ?? [];
    if (!current.includes(source)) {
      this.config.directives[directive] = [...current, source];
    }
  }

  disallowSource(directive: string, source: string): void {
    const current = this.config.directives[directive] ?? [];
    this.config.directives[directive] = current.filter((s) => s !== source);
  }

  getPolicy(nonce?: string): string {
    return this.buildPolicyHeader(nonce);
  }

  getReportOnly(): boolean {
    return this.config.reportOnly;
  }

  setReportOnly(reportOnly: boolean): void {
    this.config.reportOnly = reportOnly;
  }
}

export const cspMiddleware = new CspMiddleware();
