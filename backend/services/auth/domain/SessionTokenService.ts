/**
 * Session token issuance with refresh-token rotation — SubTrackr
 *
 * Issues #1776 (refresh-token rotation), #1777 (session listing and remote
 * revocation), #1778 (passkey / password login issue the same session pair)
 * and #1779 (device-flow sessions with scopes).
 *
 * Model:
 *   - A *session* is a `ServerSessionService` record. Its token is the access
 *     token: opaque, short-lived (sliding TTL) and limited to `session.scopes`.
 *   - Every session issued here owns exactly one refresh-token *family*.
 *     A family holds the hash of the one refresh token that is currently
 *     redeemable plus the hashes of every token it has already rotated away.
 *   - Redeeming the current refresh token rotates both tokens: a new refresh
 *     token replaces the old one in the family and the session's access token
 *     is re-keyed, so the previous pair stops working at once.
 *   - Presenting a refresh token that was already rotated away is *reuse*:
 *     either the legitimate client or an attacker holds a copy. The server
 *     cannot tell which, so the whole family and its session are revoked
 *     (OAuth 2.0 Security BCP, RFC 9700 §4.14.2).
 *   - Revoking the session by any path (logout, remote revocation, revoke-all,
 *     concurrent-session eviction) revokes the family through the session
 *     service's revocation listener, so a revoked session can never be revived
 *     with its refresh token.
 *
 * Only SHA-256 digests of refresh tokens are stored. Refresh tokens carry 256
 * bits of entropy, so an unsalted digest is not brute-forceable, and the
 * lookup is keyed by digest rather than compared character by character.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { IncomingMessage } from 'node:http';
import { AuthError } from '../errors';
import { logger } from '../../shared/logging';
import { buildEvent, eventBus } from '../../shared/events';
import {
  serverSessionService,
  type ServerSessionService,
  type SessionRecord,
} from '../serverSessionService';

const REFRESH_TOKEN_PREFIX = 'rt_';
const REFRESH_TOKEN_BYTES = 32;
const MAX_AUDIT_ENTRIES = 10_000;

export type AuthMethod = 'passkey' | 'password' | 'device_code' | 'session';

export type TokenFamilyStatus = 'active' | 'revoked' | 'expired';

export interface RefreshTokenConfig {
  /** A refresh token not redeemed within this window expires. Default: 7 days. */
  idleTtlMs: number;
  /** Hard cap on a family's lifetime regardless of activity. Default: 30 days. */
  absoluteTtlMs: number;
}

export const DEFAULT_REFRESH_TOKEN_CONFIG: RefreshTokenConfig = {
  idleTtlMs: 7 * 24 * 60 * 60 * 1000,
  absoluteTtlMs: 30 * 24 * 60 * 60 * 1000,
};

export interface TokenFamily {
  id: string;
  sessionId: string;
  userId: string;
  authMethod: AuthMethod;
  clientId: string | null;
  /** SHA-256 (hex) of the only refresh token that may be redeemed. */
  currentTokenHash: string;
  /** Incremented on every rotation; the current token has this generation. */
  generation: number;
  status: TokenFamilyStatus;
  createdAt: number;
  lastRotatedAt: number;
  /** Idle expiry of the current refresh token (never beyond `absoluteExpiresAt`). */
  expiresAt: number;
  absoluteExpiresAt: number;
  revokedAt?: number;
  revokedReason?: string;
}

export interface IssueSessionInput {
  userId: string;
  req: IncomingMessage;
  authMethod: AuthMethod;
  /** Defaults to `['*']` (interactive login). */
  scopes?: string[];
  clientId?: string;
  metadata?: Record<string, unknown>;
}

export interface IssuedSession {
  accessToken: string;
  tokenType: 'Bearer';
  /** Seconds until the access token's current expiry. */
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
  scopes: string[];
  session: SessionRecord;
  family: TokenFamily;
}

/** Listing view of a session — never includes token material. */
export interface SessionSummary {
  id: string;
  current: boolean;
  authMethod: AuthMethod | 'unknown';
  clientId: string | null;
  scopes: string[];
  device: {
    platform: string;
    browser: string;
    os: string;
    isMobile: boolean;
  };
  location: { country: string | null; region: string | null; city: string | null };
  createdAt: number;
  lastActiveAt: number;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number | null;
  isSuspicious: boolean;
}

export interface TokenAuditEntry {
  familyId: string;
  sessionId: string;
  userId: string;
  action: 'issued' | 'rotated' | 'reuse_detected' | 'revoked' | 'rejected';
  generation: number;
  timestamp: number;
  detail?: string;
}

interface TokenIndexEntry {
  familyId: string;
  generation: number;
}

export interface SessionTokenServiceOptions {
  sessions?: ServerSessionService;
  config?: Partial<RefreshTokenConfig>;
  now?: () => number;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export class SessionTokenService {
  private readonly sessions: ServerSessionService;
  private readonly config: RefreshTokenConfig;
  private readonly now: () => number;
  private families = new Map<string, TokenFamily>(); // familyId → family
  private familyBySession = new Map<string, string>(); // sessionId → familyId
  private tokenIndex = new Map<string, TokenIndexEntry>(); // token hash → family + generation
  private familyTokenHashes = new Map<string, Set<string>>(); // familyId → every hash issued
  private auditLog: TokenAuditEntry[] = [];
  private readonly unsubscribe: () => void;

  constructor(options: SessionTokenServiceOptions = {}) {
    this.sessions = options.sessions ?? serverSessionService;
    this.config = { ...DEFAULT_REFRESH_TOKEN_CONFIG, ...options.config };
    this.now = options.now ?? Date.now;
    // Any revocation of the session — wherever it originates — kills the family.
    this.unsubscribe = this.sessions.onRevoke((session, reason) => {
      const familyId = this.familyBySession.get(session.id);
      if (familyId) this.revokeFamily(familyId, `session_revoked:${reason}`);
    });
  }

  /** The session store this service issues into. */
  get sessionStore(): ServerSessionService {
    return this.sessions;
  }

  /** Detach from the session service (tests / hot reload). */
  dispose(): void {
    this.unsubscribe();
  }

  // ── Issuance ──────────────────────────────────────────────────────────────

  /**
   * Create a session and its refresh-token family. Every login path (passkey,
   * password, device flow) goes through here so they all get identical
   * rotation, listing and revocation behaviour.
   */
  issue(input: IssueSessionInput): IssuedSession {
    const scopes = input.scopes && input.scopes.length > 0 ? [...input.scopes] : ['*'];
    const session = this.sessions.createSession({
      userId: input.userId,
      req: input.req,
      scopes,
      metadata: {
        ...input.metadata,
        authMethod: input.authMethod,
        ...(input.clientId ? { clientId: input.clientId } : {}),
      },
    });

    const now = this.now();
    const refreshToken = this.generateRefreshToken();
    const tokenHash = hashRefreshToken(refreshToken);
    const absoluteExpiresAt = now + this.config.absoluteTtlMs;
    const family: TokenFamily = {
      id: `rtf_${randomBytes(12).toString('hex')}`,
      sessionId: session.id,
      userId: input.userId,
      authMethod: input.authMethod,
      clientId: input.clientId ?? null,
      currentTokenHash: tokenHash,
      generation: 1,
      status: 'active',
      createdAt: now,
      lastRotatedAt: now,
      expiresAt: Math.min(now + this.config.idleTtlMs, absoluteExpiresAt),
      absoluteExpiresAt,
    };

    this.families.set(family.id, family);
    this.familyBySession.set(session.id, family.id);
    this.tokenIndex.set(tokenHash, { familyId: family.id, generation: 1 });
    this.familyTokenHashes.set(family.id, new Set([tokenHash]));
    this.audit(family, 'issued', `method=${input.authMethod}`);

    return this.toIssued(session, family, refreshToken);
  }

  // ── Rotation ──────────────────────────────────────────────────────────────

  /**
   * Redeem a refresh token: returns a new access token and a new refresh
   * token. Throws `AUTH_REFRESH_TOKEN_REUSED` (and revokes the session) when a
   * token that was already rotated is presented again, and
   * `AUTH_REFRESH_TOKEN_INVALID` for unknown, expired or revoked tokens.
   */
  refresh(refreshToken: string, req?: IncomingMessage): IssuedSession {
    if (typeof refreshToken !== 'string' || !refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) {
      throw AuthError.refreshTokenInvalid('malformed');
    }

    const presentedHash = hashRefreshToken(refreshToken);
    const entry = this.tokenIndex.get(presentedHash);
    const family = entry ? this.families.get(entry.familyId) : undefined;
    if (!entry || !family) throw AuthError.refreshTokenInvalid('unknown');

    if (family.status === 'revoked') {
      this.audit(family, 'rejected', `family revoked (${family.revokedReason ?? 'unknown'})`);
      throw AuthError.refreshTokenInvalid('revoked');
    }

    const isCurrent =
      entry.generation === family.generation && hashesEqual(presentedHash, family.currentTokenHash);
    if (!isCurrent) {
      this.handleReuse(family, entry.generation);
      throw AuthError.refreshTokenReused();
    }

    const now = this.now();
    if (now > family.expiresAt) {
      family.status = 'expired';
      this.audit(family, 'rejected', 'expired');
      throw AuthError.refreshTokenInvalid('expired');
    }

    const session = this.sessions.getSessionById(family.sessionId);
    if (!session) {
      // The session record was swept; the family cannot outlive it.
      this.revokeFamily(family.id, 'session_missing');
      throw AuthError.refreshTokenInvalid('session_ended');
    }

    const rotation = this.sessions.rotateSessionToken(session.token, req);
    if (!rotation.rotated || !rotation.session) {
      this.audit(family, 'rejected', rotation.reason);
      if (rotation.reason === 'session_revoked') {
        this.revokeFamily(family.id, 'session_revoked');
        throw AuthError.refreshTokenInvalid('revoked');
      }
      // Device-binding mismatch: refuse without rotating, so the legitimate
      // device's token stays valid.
      throw AuthError.refreshTokenInvalid(rotation.reason ?? 'rejected');
    }

    const nextToken = this.generateRefreshToken();
    const nextHash = hashRefreshToken(nextToken);
    family.generation += 1;
    family.currentTokenHash = nextHash;
    family.lastRotatedAt = now;
    family.expiresAt = Math.min(now + this.config.idleTtlMs, family.absoluteExpiresAt);
    this.tokenIndex.set(nextHash, { familyId: family.id, generation: family.generation });
    this.familyTokenHashes.get(family.id)?.add(nextHash);
    this.audit(family, 'rotated');

    return this.toIssued(rotation.session, family, nextToken);
  }

  private handleReuse(family: TokenFamily, presentedGeneration: number): void {
    const detectedAt = this.now();
    this.audit(
      family,
      'reuse_detected',
      `presented generation ${presentedGeneration}, current ${family.generation}`
    );
    logger.warn('Refresh token reuse detected; revoking session', {
      familyId: family.id,
      sessionId: family.sessionId,
      userId: family.userId,
    });
    this.revokeFamily(family.id, 'reuse_detected');

    const event = buildEvent(
      'auth',
      'refresh_token_reuse_detected',
      {
        familyId: family.id,
        sessionId: family.sessionId,
        userId: family.userId,
        presentedGeneration,
        currentGeneration: family.generation,
        detectedAt,
      },
      { aggregateId: family.sessionId }
    );
    // A failing subscriber must never undo or block the revocation.
    eventBus.publish(event).catch((err: unknown) => {
      logger.error('Failed to publish refresh token reuse event', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // ── Revocation ────────────────────────────────────────────────────────────

  /**
   * Revoke a family and the session it belongs to. Idempotent. The session
   * revocation re-enters through the listener, which is a no-op once the
   * family is already revoked.
   */
  revokeFamily(familyId: string, reason: string): boolean {
    const family = this.families.get(familyId);
    if (!family || family.status === 'revoked') return false;
    family.status = 'revoked';
    family.revokedAt = this.now();
    family.revokedReason = reason;
    this.audit(family, 'revoked', reason);
    this.sessions.revokeSessionById(family.sessionId, reason);
    return true;
  }

  /**
   * Revoke one of `userId`'s sessions by id. Sessions owned by someone else
   * are reported as not found so ids cannot be probed.
   */
  revokeSession(userId: string, sessionId: string, reason = 'user_revoked'): boolean {
    const session = this.sessions.getSessionById(sessionId);
    if (!session || session.userId !== userId || session.status === 'revoked') return false;
    return this.sessions.revokeSession(session.token, reason);
  }

  /** Revoke every session of `userId` except `keepSessionId`. Returns the count. */
  revokeOtherSessions(
    userId: string,
    keepSessionId: string,
    reason = 'user_signed_out_others'
  ): number {
    let count = 0;
    for (const session of this.sessions.getAllSessionsForUser(userId)) {
      if (session.id === keepSessionId) continue;
      if (this.revokeSession(userId, session.id, reason)) count++;
    }
    return count;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getFamilyForSession(sessionId: string): TokenFamily | undefined {
    const familyId = this.familyBySession.get(sessionId);
    return familyId ? this.families.get(familyId) : undefined;
  }

  /**
   * A session is listed while it can still be used: its access token is live,
   * or its refresh token can still mint a new one. Revoked sessions and
   * sessions whose access and refresh tokens have both lapsed are excluded.
   */
  listSessions(userId: string, currentSessionId?: string): SessionSummary[] {
    const now = this.now();
    const summaries: SessionSummary[] = [];
    for (const session of this.sessions.getAllSessionsForUser(userId)) {
      if (session.status === 'revoked') continue;
      const family = this.getFamilyForSession(session.id);
      const accessLive = session.status === 'active' && now <= session.expiresAt;
      const refreshLive = !!family && family.status === 'active' && now <= family.expiresAt;
      if (!accessLive && !refreshLive) continue;

      const authMethod = (session.metadata['authMethod'] as AuthMethod | undefined) ?? 'unknown';
      summaries.push({
        id: session.id,
        current: session.id === currentSessionId,
        authMethod,
        clientId: family?.clientId ?? null,
        scopes: [...session.scopes],
        device: {
          platform: session.device.platform,
          browser: session.device.browser,
          os: session.device.os,
          isMobile: session.device.isMobile,
        },
        location: {
          country: session.geo.country,
          region: session.geo.region,
          city: session.geo.city,
        },
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        accessTokenExpiresAt: session.expiresAt,
        refreshTokenExpiresAt: refreshLive && family ? family.expiresAt : null,
        isSuspicious: session.isSuspicious,
      });
    }
    return summaries.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  getAuditLog(
    filter: { userId?: string; sessionId?: string; limit?: number } = {}
  ): TokenAuditEntry[] {
    let log = this.auditLog;
    if (filter.userId) log = log.filter((e) => e.userId === filter.userId);
    if (filter.sessionId) log = log.filter((e) => e.sessionId === filter.sessionId);
    return log.slice(-(filter.limit ?? 200));
  }

  /**
   * Drop families that can no longer be redeemed together with their token
   * hashes. Reuse of a purged token is then reported as `unknown`, which is
   * still a rejection. Returns the number of families removed.
   */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [id, family] of this.families) {
      const dead = family.status !== 'active' || now > family.expiresAt;
      if (!dead || now <= family.absoluteExpiresAt) continue;
      for (const hash of this.familyTokenHashes.get(id) ?? []) this.tokenIndex.delete(hash);
      this.familyTokenHashes.delete(id);
      this.familyBySession.delete(family.sessionId);
      this.families.delete(id);
      removed++;
    }
    return removed;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private generateRefreshToken(): string {
    return `${REFRESH_TOKEN_PREFIX}${randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')}`;
  }

  private toIssued(
    session: SessionRecord,
    family: TokenFamily,
    refreshToken: string
  ): IssuedSession {
    return {
      accessToken: session.token,
      tokenType: 'Bearer',
      expiresIn: Math.max(0, Math.floor((session.expiresAt - this.now()) / 1000)),
      refreshToken,
      refreshTokenExpiresAt: family.expiresAt,
      scopes: [...session.scopes],
      session,
      family,
    };
  }

  private audit(family: TokenFamily, action: TokenAuditEntry['action'], detail?: string): void {
    this.auditLog.push({
      familyId: family.id,
      sessionId: family.sessionId,
      userId: family.userId,
      action,
      generation: family.generation,
      timestamp: this.now(),
      detail,
    });
    if (this.auditLog.length > MAX_AUDIT_ENTRIES) {
      this.auditLog = this.auditLog.slice(-MAX_AUDIT_ENTRIES / 2);
    }
  }
}

export const sessionTokenService = new SessionTokenService();
