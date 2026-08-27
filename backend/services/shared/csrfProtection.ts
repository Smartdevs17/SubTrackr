/**
 * CSRF Protection with Double-Submit Cookie — SubTrackr
 *
 * Implements the double-submit cookie pattern for CSRF protection.
 * Works without server-side session state.
 */

import { createHmac, randomBytes } from 'node:crypto';

export interface CsrfConfig {
  cookieName: string;
  headerName: string;
  tokenLength: number;
  hmacSecret: string;
  cookieOptions: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    path: string;
  };
  ignoredMethods: string[];
  ignoredPaths: string[];
}

export interface CsrfTokenPair {
  cookieValue: string;
  headerValue: string;
}

const DEFAULT_CSRF_CONFIG: CsrfConfig = {
  cookieName: '_csrf',
  headerName: 'x-csrf-token',
  tokenLength: 32,
  hmacSecret: process.env['CSRF_SECRET'] ?? 'subtrackr-csrf-secret-change-in-production',
  cookieOptions: {
    httpOnly: false,
    secure: true,
    sameSite: 'strict',
    path: '/',
  },
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  ignoredPaths: ['/health', '/metrics', '/webhooks'],
};

export class CsrfProtection {
  private config: CsrfConfig;

  constructor(config: Partial<CsrfConfig> = {}) {
    this.config = { ...DEFAULT_CSRF_CONFIG, ...config };
  }

  generateTokenPair(): CsrfTokenPair {
    const random = randomBytes(this.config.tokenLength).toString('hex');
    const timestamp = Date.now().toString(36);
    const payload = `${random}.${timestamp}`;
    const signature = this.sign(payload);

    const token = `${payload}.${signature}`;
    return { cookieValue: token, headerValue: token };
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.config.hmacSecret)
      .update(payload)
      .digest('hex')
      .slice(0, 16);
  }

  validate(cookieToken: string | undefined, headerToken: string | undefined): boolean {
    if (!cookieToken || !headerToken) return false;
    if (cookieToken !== headerToken) return false;

    const parts = cookieToken.split('.');
    if (parts.length !== 3) return false;

    const [random, timestamp, signature] = parts;
    const expectedSignature = this.sign(`${random}.${timestamp}`);

    if (signature !== expectedSignature) return false;

    const tokenTime = parseInt(timestamp, 36);
    const maxAge = 24 * 60 * 60 * 1000;
    if (Date.now() - tokenTime > maxAge) return false;

    return true;
  }

  shouldProtect(method: string | undefined, path: string | undefined): boolean {
    if (!method) return false;
    if (this.config.ignoredMethods.includes(method.toUpperCase())) return false;
    if (path && this.config.ignoredPaths.some((p) => path.startsWith(p))) return false;
    return true;
  }

  createMiddleware() {
    return function csrfMiddleware(
      req: {
        method?: string;
        url?: string;
        headers?: Record<string, string | string[] | undefined>;
        cookies?: Record<string, string>;
      },
      res: {
        setHeader(name: string, value: string | number | string[]): void;
        getHeader(name: string): string | number | string[] | undefined;
      },
      next: () => void,
    ): void {
      const method = req.method ?? 'GET';
      const path = req.url ?? '/';

      if (!thisCsrf.shouldProtect(method, path)) {
        const { cookieValue } = thisCsrf.generateTokenPair();
        res.setHeader('Set-Cookie', `${thisCsrf.config.cookieName}=${cookieValue}; Path=/; SameSite=Strict`);
        next();
        return;
      }

      const cookieToken = req.cookies?.[thisCsrf.config.cookieName];
      const headerToken = typeof req.headers?.[thisCsrf.config.headerName] === 'string'
        ? req.headers[thisCsrf.config.headerName]
        : undefined;

      if (!thisCsrf.validate(cookieToken, headerToken)) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('HTTP/1.1', '403 Forbidden');
        return;
      }

      next();
    };
  }

  getConfig(): CsrfConfig {
    return { ...this.config };
  }
}

const thisCsrf = new CsrfProtection();
export const csrfProtection = thisCsrf;
