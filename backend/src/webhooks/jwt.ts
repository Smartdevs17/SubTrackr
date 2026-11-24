/**
 * backend/src/webhooks/jwt.ts
 *
 * Webhook JWT claim validation for the backend. Enforces that every inbound
 * webhook JWT carries a correct `aud` (audience) and `origin` claim, so a
 * token minted for one webhook consumer cannot be replayed against another
 * origin or endpoint.
 *
 * Design rules (issue #2274):
 *  - Pure functions only: no I/O, no network calls, no clock reads unless a
 *    `now` argument is supplied (defaults to Date.now in the validator only).
 *  - Zero dependencies: Base64URL + UTF-8 decoded with a small lookup table.
 *  - Every rejection is a typed `WebhookJwtError` with a stable `code`.
 *  - Audience may be a string or string[]; any intersection with the policy
 *    audiences is accepted. Origin is normalized (scheme + host + port,
 *    lower-cased, trailing slashes removed) before exact comparison.
 *  - Observability hooks for metrics and audit logging on every decision.
 *
 * Signature verification is intentionally delegated to the caller's JOSE
 * layer: this module validates the *claims* envelope only. The dispatcher
 * must still verify the cryptographic signature before trusting delivery.
 */

// ?? Types ???????????????????????????????????????????????????????????????

export type WebhookJwtErrorCode =
  | 'MALFORMED_TOKEN'
  | 'INVALID_BASE64URL'
  | 'INVALID_JSON'
  | 'MISSING_AUDIENCE'
  | 'INVALID_AUDIENCE'
  | 'MISSING_ORIGIN'
  | 'INVALID_ORIGIN'
  | 'MISSING_ISSUER'
  | 'INVALID_ISSUER'
  | 'MISSING_EXPIRY'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_NOT_YET_VALID'
  | 'INVALID_CONFIG';

export class WebhookJwtError extends Error {
  readonly code: WebhookJwtErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: WebhookJwtErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'WebhookJwtError';
    this.code = code;
    this.details = details;
  }
}

export interface WebhookJwtPolicy {
  /** Expected audience value(s). Token `aud` must intersect this list. */
  audiences: readonly string[];
  /** Allowed origin URL(s). Token `origin` must normalize-match one. */
  allowedOrigins: readonly string[];
  /** Expected issuer (`iss`), if the policy requires one. */
  issuer?: string;
  /** Require an `exp` claim. Default true. */
  requireExpiration?: boolean;
  /** Clock-skew tolerance in seconds. Default 30. */
  clockToleranceSeconds?: number;
}

export interface WebhookJwtClaims {
  aud?: string | readonly string[];
  origin?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  jti?: string;
  [key: string]: unknown;
}

export interface WebhookJwtHeader {
  alg: string;
  typ?: string;
  kid?: string;
  [key: string]: unknown;
}

export interface ParsedWebhookJwt {
  header: WebhookJwtHeader;
  claims: WebhookJwtClaims;
  /** Raw (undecoded) signature segment, retained for the JOSE layer. */
  signature: string;
  /** Exact signing input `header.payload`, for the JOSE layer. */
  signingInput: string;
}

export interface WebhookJwtValidationResult {
  valid: boolean;
  claims?: WebhookJwtClaims;
  normalizedOrigin?: string;
  matchedAudience?: string;
  error?: WebhookJwtError;
}

export interface JwtValidationMetrics {
  /** e.g. increment('webhook.jwt.rejected', { code }) */
  increment(name: string, labels?: Readonly<Record<string, string>>): void;
}

export interface JwtValidationLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
}

// ?? Base64URL / UTF-8 ???????????????????????????????????????????????????

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Decode a Base64URL string into raw bytes (pure JS, no Buffer/atob). */
export function base64UrlDecodeToBytes(input: string): Uint8Array {
  if (typeof input !== 'string') {
    throw new WebhookJwtError('INVALID_BASE64URL', 'Base64URL input must be a string');
  }
  const clean = input.trim().replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const idx = B64URL.indexOf(clean[i]);
    if (idx === -1) {
      throw new WebhookJwtError('INVALID_BASE64URL', `Invalid Base64URL character at index ${i}`);
    }
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/** Decode raw bytes into a UTF-8 string (pure JS). */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if ((b & 0xe0) === 0xc0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if ((b & 0xf0) === 0xe0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      );
      i += 3;
    } else if ((b & 0xf8) === 0xf0) {
      let cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      // Astral code points must be emitted as a UTF-16 surrogate pair.
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      i += 4;
    } else {
      throw new WebhookJwtError('INVALID_BASE64URL', 'Invalid UTF-8 byte sequence');
    }
  }
  return out;
}

/** Decode a Base64URL JSON segment into a plain object. */
export function decodeJsonSegment(segment: string): Record<string, unknown> {
  const json = utf8Decode(base64UrlDecodeToBytes(segment));
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new WebhookJwtError('INVALID_JSON', 'JWT segment is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WebhookJwtError('INVALID_JSON', 'JWT segment must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

// ?? Parsing ?????????????????????????????????????????????????????????????

/** Split and decode a compact JWT without verifying the signature. */
export function parseWebhookJwt(token: string): ParsedWebhookJwt {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new WebhookJwtError('MALFORMED_TOKEN', 'Token must be a non-empty string');
  }
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts.some((p) => p === '')) {
    throw new WebhookJwtError(
      'MALFORMED_TOKEN',
      'Token must have exactly three non-empty segments (header.payload.signature)'
    );
  }
  const [headerSeg, payloadSeg, signature] = parts;
  const header = decodeJsonSegment(headerSeg) as unknown as WebhookJwtHeader;
  if (typeof header.alg !== 'string' || header.alg === '') {
    throw new WebhookJwtError('INVALID_JSON', 'JWT header must include a non-empty alg');
  }
  const claims = decodeJsonSegment(payloadSeg) as unknown as WebhookJwtClaims;
  return {
    header,
    claims,
    signature,
    signingInput: `${headerSeg}.${payloadSeg}`,
  };
}

// ?? Claim validation ????????????????????????????????????????????????????

/** Normalize an origin to `scheme://host[:port]`, lower-cased. */
export function normalizeOrigin(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WebhookJwtError('INVALID_ORIGIN', 'Origin claim must be a non-empty string');
  }
  const trimmed = value.trim().replace(/\/+$/, '');
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)(.*)$/i.exec(trimmed);
  if (!match) {
    throw new WebhookJwtError('INVALID_ORIGIN', `Origin is not an absolute URL: ${value}`);
  }
  const scheme = match[1].toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    throw new WebhookJwtError('INVALID_ORIGIN', `Origin scheme must be http or https: ${scheme}`);
  }
  return `${scheme}://${match[2].toLowerCase()}`;
}

/** Validate a compiled policy's shape. */
export function compilePolicy(policy: WebhookJwtPolicy): WebhookJwtPolicy {
  if (!policy || !Array.isArray(policy.audiences) || policy.audiences.length === 0) {
    throw new WebhookJwtError('INVALID_CONFIG', 'Policy must define at least one audience');
  }
  if (!Array.isArray(policy.allowedOrigins) || policy.allowedOrigins.length === 0) {
    throw new WebhookJwtError('INVALID_CONFIG', 'Policy must define at least one allowed origin');
  }
  const tolerance = policy.clockToleranceSeconds ?? 30;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new WebhookJwtError('INVALID_CONFIG', 'clockToleranceSeconds must be a non-negative number');
  }
  const normalizedOrigins = policy.allowedOrigins.map((o) => normalizeOrigin(o));
  return {
    ...policy,
    allowedOrigins: normalizedOrigins,
    requireExpiration: policy.requireExpiration ?? true,
    clockToleranceSeconds: tolerance,
  };
}

function claimAudiences(aud: string | readonly string[] | undefined): string[] {
  if (typeof aud === 'string') return [aud];
  if (Array.isArray(aud)) return aud.filter((a): a is string => typeof a === 'string');
  return [];
}

/**
 * Validate decoded claims against a compiled policy. Pure: `nowSeconds` is
 * supplied by the caller so tests are deterministic.
 */
export function validateWebhookClaims(
  claims: WebhookJwtClaims,
  policy: WebhookJwtPolicy,
  nowSeconds: number
): WebhookJwtValidationResult {
  try {
    const compiled = compilePolicy(policy);

    // audience
    const audiences = claimAudiences(claims.aud);
    if (audiences.length === 0) {
      throw new WebhookJwtError('MISSING_AUDIENCE', 'JWT is missing an aud claim');
    }
    const matchedAudience = audiences.find((a) => compiled.audiences.includes(a));
    if (matchedAudience === undefined) {
      throw new WebhookJwtError('INVALID_AUDIENCE', 'JWT aud does not match any policy audience', {
        received: audiences,
      });
    }

    // origin
    if (claims.origin === undefined || claims.origin === null) {
      throw new WebhookJwtError('MISSING_ORIGIN', 'JWT is missing an origin claim');
    }
    const normalizedOrigin = normalizeOrigin(claims.origin);
    if (!compiled.allowedOrigins.includes(normalizedOrigin)) {
      throw new WebhookJwtError('INVALID_ORIGIN', 'JWT origin is not in the allow-list', {
        received: normalizedOrigin,
      });
    }

    // issuer (optional)
    if (compiled.issuer !== undefined) {
      if (typeof claims.iss !== 'string' || claims.iss === '') {
        throw new WebhookJwtError('MISSING_ISSUER', 'JWT is missing an iss claim');
      }
      if (claims.iss !== compiled.issuer) {
        throw new WebhookJwtError('INVALID_ISSUER', 'JWT iss does not match policy issuer', {
          received: claims.iss,
        });
      }
    }

    // temporal claims
    const requireExp = compiled.requireExpiration ?? true;
    const tolerance = compiled.clockToleranceSeconds ?? 30;
    if (claims.exp === undefined && requireExp) {
      throw new WebhookJwtError('MISSING_EXPIRY', 'JWT is missing an exp claim');
    }
    if (typeof claims.exp === 'number') {
      if (nowSeconds > claims.exp + tolerance) {
        throw new WebhookJwtError('TOKEN_EXPIRED', 'JWT has expired', {
          exp: claims.exp,
          now: nowSeconds,
        });
      }
    }
    if (typeof claims.nbf === 'number' && nowSeconds + tolerance < claims.nbf) {
      throw new WebhookJwtError('TOKEN_NOT_YET_VALID', 'JWT is not yet valid', {
        nbf: claims.nbf,
        now: nowSeconds,
      });
    }

    return { valid: true, claims, normalizedOrigin, matchedAudience };
  } catch (err) {
    if (err instanceof WebhookJwtError) {
      return { valid: false, error: err };
    }
    throw err;
  }
}

/** Parse + validate a compact webhook JWT. Never throws on claim failures. */
export function validateWebhookJwt(
  token: string,
  policy: WebhookJwtPolicy,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): WebhookJwtValidationResult {
  let parsed: ParsedWebhookJwt;
  try {
    parsed = parseWebhookJwt(token);
  } catch (err) {
    if (err instanceof WebhookJwtError) {
      return { valid: false, error: err };
    }
    throw err;
  }
  return validateWebhookClaims(parsed.claims, policy, nowSeconds);
}

/** Strict variant: throws `WebhookJwtError` on any claim failure. */
export function enforceWebhookJwt(
  token: string,
  policy: WebhookJwtPolicy,
  nowSeconds?: number
): WebhookJwtValidationResult {
  const result = validateWebhookJwt(token, policy, nowSeconds);
  if (!result.valid && result.error) throw result.error;
  return result;
}

/** Build a validator bound to a policy, with metrics + logging hooks. */
export function createWebhookJwtValidator(
  policy: WebhookJwtPolicy,
  hooks?: { metrics?: JwtValidationMetrics; logger?: JwtValidationLogger }
) {
  const compiled = compilePolicy(policy);
  return {
    policy: compiled,
    validate(token: string, nowSeconds?: number): WebhookJwtValidationResult {
      const result = validateWebhookJwt(token, compiled, nowSeconds);
      if (hooks?.metrics) {
        if (result.valid) {
          hooks.metrics.increment('webhook.jwt.valid', { audience: result.matchedAudience ?? '' });
        } else {
          hooks.metrics.increment('webhook.jwt.rejected', { code: result.error?.code ?? 'UNKNOWN' });
        }
      }
      if (hooks?.logger && !result.valid) {
        hooks.logger.warn('Webhook JWT claim validation failed', {
          code: result.error?.code,
          details: result.error?.details,
        });
      }
      return result;
    },
    enforce(token: string, nowSeconds?: number): WebhookJwtValidationResult {
      return enforceWebhookJwt(token, compiled, nowSeconds);
    },
  };
}
