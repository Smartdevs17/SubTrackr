/**
 * Subscription-share URLs backed by signed, scoped view tokens (#2025).
 *
 * A share link lets a subscriber give someone read-only access to one
 * subscription without handing over an account session. The URL carries a
 * token of the form `<payload>.<signature>`:
 *
 *   - payload   base64url(JSON) with the subscription ID, the view scopes the
 *               link grants, an issue time, an expiry and a unique token ID.
 *   - signature base64url(HMAC-SHA256(secret, payload)).
 *
 * Verification checks, in order: format, signature (constant time), expiry,
 * revocation, subscription match and the scope the caller needs. A token can
 * never grant more than the scopes it was signed with, and tampering with any
 * payload byte invalidates the signature.
 *
 * The revocation store is injected. The in-memory store below is for tests and
 * single-process use only; production needs a shared store.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const SHARE_SCOPES = ['summary', 'billing', 'usage', 'invoices'] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface ShareTokenClaims {
  /** Token ID. Used for revocation and log correlation. */
  jti: string;
  subscriptionId: string;
  scopes: ShareScope[];
  /** Issued-at, seconds since the epoch. */
  iat: number;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

export type ShareLinkErrorCode =
  | 'INVALID_SECRET'
  | 'INVALID_SUBSCRIPTION'
  | 'INVALID_SCOPES'
  | 'INVALID_TTL'
  | 'INVALID_BASE_URL';

export class ShareLinkError extends Error {
  constructor(
    public readonly code: ShareLinkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ShareLinkError';
  }
}

export type VerifyFailureReason =
  | 'MALFORMED'
  | 'BAD_SIGNATURE'
  | 'EXPIRED'
  | 'REVOKED'
  | 'WRONG_SUBSCRIPTION'
  | 'SCOPE_NOT_GRANTED';

export type VerifyResult =
  | { ok: true; claims: ShareTokenClaims }
  | { ok: false; reason: VerifyFailureReason };

export interface RevocationStore {
  revoke(jti: string, expiresAt: number): Promise<void>;
  isRevoked(jti: string): Promise<boolean>;
}

export function createInMemoryRevocationStore(): RevocationStore {
  const revoked = new Map<string, number>();
  return {
    async revoke(jti, expiresAt) {
      revoked.set(jti, expiresAt);
    },
    async isRevoked(jti) {
      return revoked.has(jti);
    },
  };
}

export interface ShareLinkEvent {
  type: 'created' | 'verified' | 'rejected' | 'revoked';
  jti?: string;
  subscriptionId?: string;
  reason?: VerifyFailureReason;
}

export interface ShareLinkServiceOptions {
  /** HMAC secret, at least 32 characters. Never log it. */
  secret: string;
  /** Origin and path prefix the token is appended to, for example https://app.example.com/share. */
  baseUrl: string;
  store?: RevocationStore;
  /** Clock in milliseconds. Injectable for tests. */
  now?: () => number;
  /** Observability hook. Receives token IDs only, never tokens or the secret. */
  onEvent?: (event: ShareLinkEvent) => void;
}

export interface CreateShareLinkInput {
  subscriptionId: string;
  scopes: readonly ShareScope[];
  ttlSeconds?: number;
}

export interface ShareLink {
  url: string;
  token: string;
  tokenId: string;
  expiresAt: string;
  scopes: ShareScope[];
}

export interface VerifyInput {
  token: string;
  requiredScope: ShareScope;
  /** When set, the token must have been issued for this subscription. */
  subscriptionId?: string;
}

export interface ShareLinkService {
  createShareLink(input: CreateShareLinkInput): ShareLink;
  /** Resolves with the failure reason instead of throwing, so callers map it to a status code. */
  verify(input: VerifyInput): Promise<VerifyResult>;
  extractToken(url: string): string | undefined;
  revoke(token: string): Promise<boolean>;
}

const b64 = (buf: Buffer): string => buf.toString('base64url');

function isScope(value: unknown): value is ShareScope {
  return typeof value === 'string' && (SHARE_SCOPES as readonly string[]).includes(value);
}

function parseClaims(raw: string): ShareTokenClaims | undefined {
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const c = data as Record<string, unknown>;
  if (
    typeof c.jti !== 'string' ||
    typeof c.subscriptionId !== 'string' ||
    !Number.isInteger(c.iat) ||
    !Number.isInteger(c.exp) ||
    !Array.isArray(c.scopes) ||
    c.scopes.length === 0 ||
    !c.scopes.every(isScope)
  ) {
    return undefined;
  }
  return c as unknown as ShareTokenClaims;
}

export function createShareLinkService(options: ShareLinkServiceOptions): ShareLinkService {
  if (typeof options.secret !== 'string' || options.secret.length < MIN_SECRET_LENGTH) {
    throw new ShareLinkError(
      'INVALID_SECRET',
      `Share link secret must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new ShareLinkError('INVALID_BASE_URL', 'baseUrl must be an absolute URL');
  }
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') {
    throw new ShareLinkError('INVALID_BASE_URL', 'baseUrl must use https');
  }

  const secret = options.secret;
  const store = options.store ?? createInMemoryRevocationStore();
  const now = options.now ?? Date.now;
  const emit = (event: ShareLinkEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      // Observability must never break the request path.
    }
  };

  const sign = (payload: string): Buffer => createHmac('sha256', secret).update(payload).digest();

  function splitToken(token: string): { payload: string; claims: ShareTokenClaims } | undefined {
    if (typeof token !== 'string') return undefined;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
    const claims = parseClaims(parts[0]);
    return claims ? { payload: parts[0], claims } : undefined;
  }

  function signatureMatches(payload: string, signature: string): boolean {
    const expected = sign(payload);
    const given = Buffer.from(signature, 'base64url');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  function reject(reason: VerifyFailureReason, jti?: string): VerifyResult {
    emit({ type: 'rejected', reason, jti });
    return { ok: false, reason };
  }

  return {
    createShareLink(input) {
      if (typeof input.subscriptionId !== 'string' || input.subscriptionId.trim() === '') {
        throw new ShareLinkError('INVALID_SUBSCRIPTION', 'subscriptionId is required');
      }
      const scopes = Array.from(new Set(input.scopes));
      if (scopes.length === 0 || !scopes.every(isScope)) {
        throw new ShareLinkError(
          'INVALID_SCOPES',
          `scopes must be a non-empty subset of: ${SHARE_SCOPES.join(', ')}`,
        );
      }
      const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
      if (!Number.isInteger(ttl) || ttl <= 0 || ttl > MAX_TTL_SECONDS) {
        throw new ShareLinkError(
          'INVALID_TTL',
          `ttlSeconds must be an integer between 1 and ${MAX_TTL_SECONDS}`,
        );
      }

      const iat = Math.floor(now() / 1000);
      const claims: ShareTokenClaims = {
        jti: randomBytes(16).toString('hex'),
        subscriptionId: input.subscriptionId,
        scopes,
        iat,
        exp: iat + ttl,
      };
      const payload = b64(Buffer.from(JSON.stringify(claims), 'utf8'));
      const token = `${payload}.${b64(sign(payload))}`;
      const url = new URL(base.toString());
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/${token}`;

      emit({ type: 'created', jti: claims.jti, subscriptionId: claims.subscriptionId });
      return {
        url: url.toString(),
        token,
        tokenId: claims.jti,
        expiresAt: new Date(claims.exp * 1000).toISOString(),
        scopes,
      };
    },

    async verify({ token, requiredScope, subscriptionId }) {
      const parsed = splitToken(token);
      if (!parsed) return reject('MALFORMED');
      const { payload, claims } = parsed;
      if (!signatureMatches(payload, token.split('.')[1])) return reject('BAD_SIGNATURE');

      // The signature is valid from here on, so claims can be trusted.
      if (Math.floor(now() / 1000) >= claims.exp) return reject('EXPIRED', claims.jti);
      if (await store.isRevoked(claims.jti)) return reject('REVOKED', claims.jti);
      if (subscriptionId !== undefined && subscriptionId !== claims.subscriptionId) {
        return reject('WRONG_SUBSCRIPTION', claims.jti);
      }
      if (!claims.scopes.includes(requiredScope)) {
        return reject('SCOPE_NOT_GRANTED', claims.jti);
      }
      emit({ type: 'verified', jti: claims.jti, subscriptionId: claims.subscriptionId });
      return { ok: true, claims };
    },

    extractToken(url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return undefined;
      }
      if (parsed.origin !== base.origin) return undefined;
      const prefix = `${base.pathname.replace(/\/+$/, '')}/`;
      if (!parsed.pathname.startsWith(prefix)) return undefined;
      const token = parsed.pathname.slice(prefix.length);
      return token && !token.includes('/') ? token : undefined;
    },

    async revoke(token) {
      const parsed = splitToken(token);
      if (!parsed || !signatureMatches(parsed.payload, token.split('.')[1])) return false;
      await store.revoke(parsed.claims.jti, parsed.claims.exp);
      emit({ type: 'revoked', jti: parsed.claims.jti, subscriptionId: parsed.claims.subscriptionId });
      return true;
    },
  };
}
