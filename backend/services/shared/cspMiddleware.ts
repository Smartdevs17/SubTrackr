/**
 * Issue #1004 – XSS Prevention with Content Security Policy
 *
 * This module provides:
 *   1. `buildCspHeader(policy)` – assembles a CSP header string from a typed policy object.
 *   2. `DEFAULT_CSP_POLICY` – a secure-by-default Content-Security-Policy for SubTrackr.
 *   3. `createCspMiddleware(policy?)` – Express/Fastify-compatible middleware that injects
 *      the CSP header and a full suite of security headers (X-Frame-Options, etc.) on
 *      every response.
 *   4. `sanitizeHtml(input, opts?)` – lightweight XSS sanitizer for user-supplied strings.
 *   5. `sanitizeObject(obj, opts?)` – deep-sanitizes all string values in a plain object.
 *   6. `createXssSanitizerMiddleware(fields?)` – middleware that sanitizes request body
 *      fields before they reach route handlers.
 *
 * Usage:
 * ```ts
 * // Express
 * app.use(createCspMiddleware());
 * app.use(createXssSanitizerMiddleware());
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// CSP Policy types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Typed representation of a Content-Security-Policy directive set.
 *
 * Each key corresponds to a CSP directive name (camelCase → kebab-case).
 * Values are arrays of source expressions, e.g. `["'self'", "https://cdn.example.com"]`.
 * Use `true` for boolean directives that take no value (e.g. `upgradeInsecureRequests`).
 */
export interface CspPolicy {
  defaultSrc?: string[];
  scriptSrc?: string[];
  styleSrc?: string[];
  imgSrc?: string[];
  connectSrc?: string[];
  fontSrc?: string[];
  objectSrc?: string[];
  mediaSrc?: string[];
  frameSrc?: string[];
  childSrc?: string[];
  workerSrc?: string[];
  manifestSrc?: string[];
  formAction?: string[];
  frameAncestors?: string[];
  baseUri?: string[];
  sandbox?: string[];
  reportUri?: string[];
  reportTo?: string[];
  upgradeInsecureRequests?: boolean;
  blockAllMixedContent?: boolean;
  requireTrustedTypesFor?: string[];
  trustedTypes?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Default policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Secure-by-default CSP for the SubTrackr API backend.
 *
 * The backend primarily serves JSON — it never inlines scripts or styles, so
 * all executable content is locked to `'none'` by default.  Relax individual
 * directives for endpoints that render HTML (e.g. developer portal, email
 * previews).
 */
export const DEFAULT_CSP_POLICY: CspPolicy = {
  defaultSrc: ["'none'"],
  scriptSrc: ["'none'"],
  styleSrc: ["'none'"],
  imgSrc: ["'none'"],
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

/**
 * Relaxed CSP suitable for the developer portal / HTML pages.
 *
 * Allows scripts, styles and images from trusted CDNs while still blocking
 * inline scripts and `eval`.  Import this instead of `DEFAULT_CSP_POLICY`
 * for HTML-rendering routes.
 */
export const HTML_CSP_POLICY: CspPolicy = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'strict-dynamic'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'", 'https://api.subtrackr.app'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  objectSrc: ["'none'"],
  mediaSrc: ["'none'"],
  frameSrc: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
  baseUri: ["'self'"],
  upgradeInsecureRequests: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// CSP header builder
// ─────────────────────────────────────────────────────────────────────────────

const DIRECTIVE_MAP: Record<keyof CspPolicy, string> = {
  defaultSrc: 'default-src',
  scriptSrc: 'script-src',
  styleSrc: 'style-src',
  imgSrc: 'img-src',
  connectSrc: 'connect-src',
  fontSrc: 'font-src',
  objectSrc: 'object-src',
  mediaSrc: 'media-src',
  frameSrc: 'frame-src',
  childSrc: 'child-src',
  workerSrc: 'worker-src',
  manifestSrc: 'manifest-src',
  formAction: 'form-action',
  frameAncestors: 'frame-ancestors',
  baseUri: 'base-uri',
  sandbox: 'sandbox',
  reportUri: 'report-uri',
  reportTo: 'report-to',
  upgradeInsecureRequests: 'upgrade-insecure-requests',
  blockAllMixedContent: 'block-all-mixed-content',
  requireTrustedTypesFor: 'require-trusted-types-for',
  trustedTypes: 'trusted-types',
};

/**
 * Convert a `CspPolicy` object into a valid `Content-Security-Policy` header
 * value string.
 *
 * @example
 * buildCspHeader({ defaultSrc: ["'self'"], upgradeInsecureRequests: true })
 * // → "default-src 'self'; upgrade-insecure-requests"
 */
export function buildCspHeader(policy: CspPolicy): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(policy) as [keyof CspPolicy, unknown][]) {
    const directive = DIRECTIVE_MAP[key];
    if (!directive) continue;

    if (typeof value === 'boolean') {
      if (value) parts.push(directive);
    } else if (Array.isArray(value) && value.length > 0) {
      parts.push(`${directive} ${(value as string[]).join(' ')}`);
    }
  }

  return parts.join('; ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Security headers
// ─────────────────────────────────────────────────────────────────────────────

/** Security headers applied to every response alongside the CSP. */
export interface SecurityHeaders {
  'Content-Security-Policy': string;
  'X-Content-Type-Options': string;
  'X-Frame-Options': string;
  'X-XSS-Protection': string;
  'Referrer-Policy': string;
  'Permissions-Policy': string;
  'Strict-Transport-Security': string;
  'Cross-Origin-Opener-Policy': string;
  'Cross-Origin-Resource-Policy': string;
  'Cross-Origin-Embedder-Policy': string;
}

/**
 * Build the full set of security headers for a response.
 *
 * @param policy - CSP policy; defaults to `DEFAULT_CSP_POLICY`.
 */
export function buildSecurityHeaders(policy: CspPolicy = DEFAULT_CSP_POLICY): SecurityHeaders {
  return {
    'Content-Security-Policy': buildCspHeader(policy),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSP middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape of an Express-/Fastify-compatible middleware function that this module
 * produces.  We keep it dependency-free by typing req/res minimally.
 */
export type SecurityMiddleware = (
  req: { method?: string; url?: string },
  res: { setHeader: (name: string, value: string) => void },
  next: () => void,
) => void;

/**
 * Express/Fastify-compatible middleware that attaches the Content-Security-Policy
 * header and all complementary security headers to **every** HTTP response.
 *
 * @param policy - Override the default CSP policy.
 *
 * @example
 * app.use(createCspMiddleware());
 * // or with a custom policy:
 * app.use(createCspMiddleware({ ...DEFAULT_CSP_POLICY, connectSrc: ["'self'", "https://rpc.subtrackr.app"] }));
 */
export function createCspMiddleware(policy: CspPolicy = DEFAULT_CSP_POLICY): SecurityMiddleware {
  const headers = buildSecurityHeaders(policy);

  return function cspMiddleware(_req, res, next): void {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// XSS sanitizer
// ─────────────────────────────────────────────────────────────────────────────

/** Options for the HTML sanitizer. */
export interface SanitizeOptions {
  /**
   * Additional patterns to strip.  Each entry is a RegExp with global flag.
   * They are applied **after** the built-in HTML-entity and tag stripping.
   */
  extraPatterns?: RegExp[];
  /**
   * When true (default), HTML entities in the output are encoded:
   *   `<` → `&lt;`, `>` → `&gt;`, `&` → `&amp;`, `"` → `&quot;`, `'` → `&#x27;`
   */
  encodeEntities?: boolean;
}

// Characters that are dangerous in HTML contexts.
const HTML_ENTITY_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

// Patterns for common XSS vectors we want to strip outright.
const XSS_PATTERNS: RegExp[] = [
  // Script tags (any case, whitespace, encoded variants)
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  // Event handlers: onclick="...", onerror='...', etc.
  /\bon\w+\s*=\s*(['"`]?)[\s\S]*?\1/gi,
  // javascript: URI
  /javascript\s*:/gi,
  // vbscript: URI
  /vbscript\s*:/gi,
  // data: URI (blocks data:text/html and data:application/xhtml+xml XSS vectors)
  /data\s*:\s*(?:text\/html|application\/xhtml\+xml)/gi,
  // expression() – IE CSS XSS
  /expression\s*\(/gi,
  // SVG/XML namespace attacks
  /<\s*svg[\s\S]*?>/gi,
  // Base tag injection
  /<\s*base[\s\S]*?>/gi,
  // Object/embed/applet tags
  /<\s*(?:object|embed|applet)[\s\S]*?>/gi,
  // Iframe injection
  /<\s*iframe[\s\S]*?>/gi,
  // Link tag with preload/import
  /<\s*link[\s\S]*?>/gi,
  // Meta refresh/redirect
  /<\s*meta[\s\S]*?>/gi,
  // Remaining HTML tags (catch-all for unknown tags after specific ones above)
  /<[^>]+>/g,
];

/**
 * Strip XSS vectors from a user-supplied string.
 *
 * The function:
 *   1. Removes known dangerous HTML tags and attributes (event handlers, script, iframe, etc.)
 *   2. Optionally encodes HTML special characters in the result (default: `true`).
 *
 * **Important**: This sanitizer is intended as a defence-in-depth measure.
 * The primary XSS protection must always be Context-aware output encoding at
 * the render layer (e.g. React JSX, Handlebars auto-escaping).
 *
 * @param input - Raw string from user input.
 * @param opts  - Optional tuning.
 * @returns     - Sanitized string safe to store and later render through an
 *               escaping template engine.
 *
 * @example
 * sanitizeHtml('<script>alert(1)</script>Hello')
 * // → 'Hello'
 *
 * sanitizeHtml('<b>Bold</b>', { encodeEntities: false })
 * // → 'Bold'
 */
export function sanitizeHtml(input: string, opts: SanitizeOptions = {}): string {
  const { extraPatterns = [], encodeEntities = true } = opts;

  let result = input;

  // Strip known XSS vectors
  for (const pattern of XSS_PATTERNS) {
    result = result.replace(pattern, '');
  }

  // Apply any caller-supplied extra patterns
  for (const pattern of extraPatterns) {
    result = result.replace(pattern, '');
  }

  // Encode remaining HTML special characters
  if (encodeEntities) {
    result = result.replace(/[&<>"'`=/]/g, (char) => HTML_ENTITY_MAP[char] ?? char);
  }

  return result.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep object sanitizer
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum recursion depth for object sanitization (prevents DoS via deeply nested input). */
const MAX_DEPTH = 10;

/**
 * Recursively sanitize all `string` values within a plain object or array.
 *
 * Non-string primitives (numbers, booleans, null) are passed through unchanged.
 * Functions and class instances are omitted from the output.
 *
 * @param obj   - Value to sanitize.
 * @param opts  - Forwarded to `sanitizeHtml`.
 * @param depth - Internal recursion depth counter; do not pass externally.
 */
export function sanitizeObject(obj: unknown, opts: SanitizeOptions = {}, depth = 0): unknown {
  if (depth > MAX_DEPTH) return obj;

  if (typeof obj === 'string') {
    return sanitizeHtml(obj, opts);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, opts, depth + 1));
  }

  if (obj !== null && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === 'function') continue; // strip callables
      sanitized[key] = sanitizeObject(value, opts, depth + 1);
    }
    return sanitized;
  }

  // Primitive (number, boolean, null, undefined) – return as-is
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// XSS sanitizer middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request shape that the XSS middleware works with.  Typed minimally so this
 * remains compatible with Express, Fastify, and plain `http.IncomingMessage`
 * wrappers.
 */
export interface SanitizableRequest {
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

/**
 * Options for the XSS sanitizer middleware.
 */
export interface XssSanitizerMiddlewareOptions {
  /**
   * List of top-level body field names to sanitize.
   * When omitted, **all** body fields are sanitized.
   */
  fields?: string[];
  /**
   * Whether to also sanitize `req.query` and `req.params`.
   * @default false
   */
  sanitizeQuery?: boolean;
  /** Forwarded to `sanitizeHtml`. */
  sanitizeOptions?: SanitizeOptions;
}

/**
 * Middleware that sanitizes user-supplied string fields in `req.body` (and
 * optionally `req.query` / `req.params`) before they reach route handlers.
 *
 * @param options - Tuning options.
 *
 * @example
 * // Sanitize all body fields
 * app.use(createXssSanitizerMiddleware());
 *
 * // Sanitize only specific fields
 * app.use(createXssSanitizerMiddleware({ fields: ['name', 'description'] }));
 */
export function createXssSanitizerMiddleware(
  options: XssSanitizerMiddlewareOptions = {},
): (req: SanitizableRequest, res: unknown, next: () => void) => void {
  const { fields, sanitizeQuery = false, sanitizeOptions = {} } = options;

  return function xssSanitizerMiddleware(req, _res, next): void {
    // Sanitize body
    if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
      if (fields && fields.length > 0) {
        const body = req.body as Record<string, unknown>;
        for (const field of fields) {
          if (Object.prototype.hasOwnProperty.call(body, field)) {
            body[field] = sanitizeObject(body[field], sanitizeOptions);
          }
        }
      } else {
        req.body = sanitizeObject(req.body, sanitizeOptions);
      }
    }

    // Optionally sanitize query and params
    if (sanitizeQuery) {
      if (req.query) {
        req.query = sanitizeObject(req.query, sanitizeOptions) as Record<string, unknown>;
      }
      if (req.params) {
        req.params = sanitizeObject(req.params, sanitizeOptions) as Record<string, unknown>;
      }
    }

    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Nonce helpers (for inline scripts in HTML responses)
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'crypto';

/**
 * Generate a cryptographically random nonce string suitable for use in CSP
 * `script-src 'nonce-<value>'` directives.
 *
 * The nonce is Base64-URL encoded (no padding), 16 bytes → 22 characters.
 *
 * @example
 * const nonce = generateCspNonce();
 * res.setHeader('Content-Security-Policy', `script-src 'nonce-${nonce}'`);
 * // In the HTML template:
 * // <script nonce="${nonce}">...</script>
 */
export function generateCspNonce(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Build a `CspPolicy` with a per-request nonce injected into `scriptSrc`.
 *
 * @param nonce  - Value returned by `generateCspNonce()`.
 * @param base   - Base policy to extend; defaults to `HTML_CSP_POLICY`.
 */
export function buildNoncePolicy(nonce: string, base: CspPolicy = HTML_CSP_POLICY): CspPolicy {
  const existing = base.scriptSrc ?? ["'self'"];
  return {
    ...base,
    scriptSrc: [...existing, `'nonce-${nonce}'`],
  };
}
