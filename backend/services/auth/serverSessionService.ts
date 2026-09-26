/**
 * Server-Side Session Management with Device Tracking — SubTrackr
 *
 * Issue #1160: Implement session management with device tracking
 *
 * Features:
 *   - Cryptographically secure session token generation (crypto.randomBytes)
 *   - Device fingerprinting (User-Agent, platform, OS, browser)
 *   - Geo location enrichment from IP (header-based; hook for real IP→geo)
 *   - Concurrent session limit enforcement per user
 *   - Configurable session TTL with sliding expiry on activity
 *   - Suspicious session detection (new device, impossible travel, concurrent anomaly)
 *   - Session revocation (single / all / other-devices)
 *   - Full audit trail per session lifecycle event
 *   - Prometheus metrics export
 */

import { randomBytes, createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus = 'active' | 'expired' | 'revoked';
export type SuspiciousReason =
  | 'new_device'
  | 'concurrent_session_limit'
  | 'rapid_ip_change'
  | 'impossible_travel'
  | 'unusual_activity';

export interface DeviceInfo {
  /** SHA-256 fingerprint of (userAgent + platform + language) */
  fingerprint: string;
  userAgent: string;
  platform: string;
  browser: string;
  os: string;
  isMobile: boolean;
  /** Was this device seen before for this user? */
  isKnownDevice: boolean;
}

export interface GeoInfo {
  ip: string;
  country: string | null;
  region: string | null;
  city: string | null;
  /** Approximate latitude (from header or null) */
  lat: number | null;
  /** Approximate longitude (from header or null) */
  lon: number | null;
}

export interface SessionRecord {
  /** Opaque session token (256-bit hex) */
  token: string;
  /** Stable session ID (same token but stored separately for indexing) */
  id: string;
  userId: string;
  device: DeviceInfo;
  geo: GeoInfo;
  status: SessionStatus;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  revokedAt?: number;
  revocationReason?: string;
  isSuspicious: boolean;
  suspiciousReasons: SuspiciousReason[];
  metadata: Record<string, unknown>;
}

export interface SessionCreateOptions {
  userId: string;
  req: IncomingMessage;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

export interface SessionValidateResult {
  valid: boolean;
  session?: SessionRecord;
  reason?: string;
}

export interface SessionServiceConfig {
  /** Default session TTL in ms. Default: 30 minutes */
  defaultTtlMs: number;
  /** Sliding TTL extension on each touch. Default: 30 minutes */
  slidingTtlMs: number;
  /** Max active sessions per user before forcing oldest out. Default: 5 */
  maxConcurrentSessions: number;
  /** Enable sliding expiry on activity touch. Default: true */
  slidingExpiry: boolean;
  /** Suspicious threshold: new device + N concurrent sessions */
  suspiciousConcurrentThreshold: number;
}

export interface SessionAuditEntry {
  sessionId: string;
  userId: string;
  action: 'created' | 'validated' | 'touched' | 'revoked' | 'expired' | 'suspicious_flagged';
  ip: string;
  userAgent: string;
  timestamp: number;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Device fingerprinting
// ---------------------------------------------------------------------------

function parseUserAgent(ua: string): Pick<DeviceInfo, 'platform' | 'browser' | 'os' | 'isMobile'> {
  const isMobile = /mobile|android|iphone|ipad|tablet/i.test(ua);

  let browser = 'unknown';
  if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua)) browser = 'Safari';
  else if (/opera|opr/i.test(ua)) browser = 'Opera';

  let os = 'unknown';
  if (/windows nt/i.test(ua)) os = 'Windows';
  else if (/mac os x/i.test(ua)) os = 'macOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad/i.test(ua)) os = 'iOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let platform = 'web';
  if (isMobile) platform = 'mobile';
  else if (/electron/i.test(ua)) platform = 'desktop';

  return { platform, browser, os, isMobile };
}

function fingerprintDevice(userAgent: string, acceptLanguage: string): string {
  const raw = `${userAgent}|${acceptLanguage}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function buildDeviceInfo(req: IncomingMessage, isKnownDevice: boolean): DeviceInfo {
  const userAgent = (req.headers['user-agent'] as string) ?? 'unknown';
  const acceptLanguage = (req.headers['accept-language'] as string) ?? '';
  const parsed = parseUserAgent(userAgent);
  const fingerprint = fingerprintDevice(userAgent, acceptLanguage);
  return {
    fingerprint,
    userAgent,
    isKnownDevice,
    ...parsed,
  };
}

// ---------------------------------------------------------------------------
// Geo extraction (header-based; replace with MaxMind or ip-api in production)
// ---------------------------------------------------------------------------

function buildGeoInfo(req: IncomingMessage): GeoInfo {
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ??
    req.socket?.remoteAddress ??
    '0.0.0.0';

  // Cloud providers inject geo headers; use them when present
  const country = (req.headers['cf-ipcountry'] as string) ?? null;
  const city = (req.headers['x-vercel-ip-city'] as string) ?? null;
  const region = (req.headers['x-vercel-ip-country-region'] as string) ?? null;
  const latStr = req.headers['x-vercel-ip-latitude'];
  const lonStr = req.headers['x-vercel-ip-longitude'];
  const lat = latStr ? parseFloat(latStr as string) : null;
  const lon = lonStr ? parseFloat(lonStr as string) : null;

  return { ip, country, city, region, lat, lon };
}

// ---------------------------------------------------------------------------
// Impossible travel detection (rough heuristic — no geo DB needed)
// ---------------------------------------------------------------------------

/**
 * Returns true if the two geo points are more than ~1000 km apart within a
 * suspiciously short time window (< 30 min).
 */
function isPossiblyImpossibleTravel(
  prevGeo: GeoInfo,
  newGeo: GeoInfo,
  elapsedMs: number,
): boolean {
  if (!prevGeo.lat || !prevGeo.lon || !newGeo.lat || !newGeo.lon) return false;
  if (elapsedMs > 30 * 60 * 1000) return false; // more than 30 min — OK

  const dLat = (prevGeo.lat - newGeo.lat) * (Math.PI / 180);
  const dLon = (prevGeo.lon - newGeo.lon) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(prevGeo.lat * (Math.PI / 180)) *
      Math.cos(newGeo.lat * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distanceKm > 1000;
}

// ---------------------------------------------------------------------------
// ServerSessionService
// ---------------------------------------------------------------------------

export class ServerSessionService {
  private sessions = new Map<string, SessionRecord>(); // token → session
  private userSessionIndex = new Map<string, Set<string>>(); // userId → Set<token>
  private knownDevices = new Map<string, Set<string>>(); // userId → Set<fingerprint>
  private auditLog: SessionAuditEntry[] = [];
  private readonly maxAuditEntries = 100_000;

  private config: SessionServiceConfig;

  constructor(config: Partial<SessionServiceConfig> = {}) {
    this.config = {
      defaultTtlMs: 30 * 60 * 1000, // 30 min
      slidingTtlMs: 30 * 60 * 1000,
      maxConcurrentSessions: 5,
      slidingExpiry: true,
      suspiciousConcurrentThreshold: 3,
      ...config,
    };
  }

  // -------------------------------------------------------------------------
  // Session creation
  // -------------------------------------------------------------------------

  createSession(opts: SessionCreateOptions): SessionRecord {
    const { userId, req, ttlMs = this.config.defaultTtlMs, metadata = {} } = opts;
    const now = Date.now();

    // Device fingerprint
    const knownFingerprints = this.knownDevices.get(userId) ?? new Set<string>();
    const geo = buildGeoInfo(req);
    const device = buildDeviceInfo(req, knownFingerprints.size > 0);

    // Learn this device
    knownFingerprints.add(device.fingerprint);
    this.knownDevices.set(userId, knownFingerprints);

    // Generate secure token
    const token = randomBytes(32).toString('hex');
    const id = `sess_${token.slice(0, 12)}`;

    // Suspicious checks
    const suspiciousReasons: SuspiciousReason[] = [];
    const userSessions = this.getActiveSessionsForUser(userId);

    if (!device.isKnownDevice && userSessions.length === 0) {
      // first session from an unknown device is fine
    } else if (!device.isKnownDevice) {
      suspiciousReasons.push('new_device');
    }

    if (userSessions.length >= this.config.suspiciousConcurrentThreshold) {
      suspiciousReasons.push('concurrent_session_limit');
    }

    // Impossible travel check vs. most recent active session
    const mostRecent = userSessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
    if (mostRecent) {
      const elapsed = now - mostRecent.lastActiveAt;
      if (isPossiblyImpossibleTravel(mostRecent.geo, geo, elapsed)) {
        suspiciousReasons.push('impossible_travel');
      }
      if (mostRecent.geo.ip !== geo.ip && elapsed < 5 * 60 * 1000) {
        suspiciousReasons.push('rapid_ip_change');
      }
    }

    const session: SessionRecord = {
      token,
      id,
      userId,
      device,
      geo,
      status: 'active',
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + ttlMs,
      isSuspicious: suspiciousReasons.length > 0,
      suspiciousReasons,
      metadata,
    };

    // Enforce concurrent session limit (evict oldest)
    this.enforceConcurrentLimit(userId);

    this.sessions.set(token, session);
    const userTokens = this.userSessionIndex.get(userId) ?? new Set<string>();
    userTokens.add(token);
    this.userSessionIndex.set(userId, userTokens);

    this.audit({
      sessionId: id,
      userId,
      action: 'created',
      ip: geo.ip,
      userAgent: device.userAgent,
      timestamp: now,
      detail: `device=${device.fingerprint} suspicious=${session.isSuspicious}`,
    });

    if (session.isSuspicious) {
      this.audit({
        sessionId: id,
        userId,
        action: 'suspicious_flagged',
        ip: geo.ip,
        userAgent: device.userAgent,
        timestamp: now,
        detail: suspiciousReasons.join(','),
      });
    }

    return session;
  }

  // -------------------------------------------------------------------------
  // Session validation
  // -------------------------------------------------------------------------

  validateSession(token: string, req?: IncomingMessage): SessionValidateResult {
    const session = this.sessions.get(token);
    if (!session) {
      return { valid: false, reason: 'session_not_found' };
    }

    const now = Date.now();

    if (session.status === 'revoked') {
      return { valid: false, session, reason: 'session_revoked' };
    }

    if (now > session.expiresAt) {
      session.status = 'expired';
      this.audit({
        sessionId: session.id,
        userId: session.userId,
        action: 'expired',
        ip: session.geo.ip,
        userAgent: session.device.userAgent,
        timestamp: now,
      });
      return { valid: false, session, reason: 'session_expired' };
    }

    // Sliding expiry
    if (this.config.slidingExpiry) {
      session.lastActiveAt = now;
      session.expiresAt = now + this.config.slidingTtlMs;
    }

    if (req) {
      const newGeo = buildGeoInfo(req);
      // Detect rapid IP change post-validation
      if (newGeo.ip !== session.geo.ip) {
        const elapsed = now - session.lastActiveAt;
        if (elapsed < 5 * 60 * 1000 && !session.suspiciousReasons.includes('rapid_ip_change')) {
          session.suspiciousReasons.push('rapid_ip_change');
          session.isSuspicious = true;
          this.audit({
            sessionId: session.id,
            userId: session.userId,
            action: 'suspicious_flagged',
            ip: newGeo.ip,
            userAgent: session.device.userAgent,
            timestamp: now,
            detail: 'rapid_ip_change detected on validation',
          });
        }
        session.geo = newGeo; // update to latest IP
      }
    }

    this.audit({
      sessionId: session.id,
      userId: session.userId,
      action: 'validated',
      ip: session.geo.ip,
      userAgent: session.device.userAgent,
      timestamp: now,
    });

    return { valid: true, session };
  }

  // -------------------------------------------------------------------------
  // Touch (keepalive)
  // -------------------------------------------------------------------------

  touchSession(token: string): SessionRecord | null {
    const session = this.sessions.get(token);
    if (!session || session.status !== 'active') return null;
    const now = Date.now();
    if (now > session.expiresAt) {
      session.status = 'expired';
      return null;
    }
    session.lastActiveAt = now;
    if (this.config.slidingExpiry) {
      session.expiresAt = now + this.config.slidingTtlMs;
    }
    this.audit({
      sessionId: session.id,
      userId: session.userId,
      action: 'touched',
      ip: session.geo.ip,
      userAgent: session.device.userAgent,
      timestamp: now,
    });
    return session;
  }

  // -------------------------------------------------------------------------
  // Revocation
  // -------------------------------------------------------------------------

  revokeSession(token: string, reason = 'user_logout'): boolean {
    const session = this.sessions.get(token);
    if (!session || session.status !== 'active') return false;
    session.status = 'revoked';
    session.revokedAt = Date.now();
    session.revocationReason = reason;
    this.audit({
      sessionId: session.id,
      userId: session.userId,
      action: 'revoked',
      ip: session.geo.ip,
      userAgent: session.device.userAgent,
      timestamp: session.revokedAt,
      detail: reason,
    });
    return true;
  }

  revokeAllSessions(userId: string, reason = 'admin_revoke_all'): number {
    const tokens = this.userSessionIndex.get(userId);
    if (!tokens) return 0;
    let count = 0;
    for (const token of tokens) {
      if (this.revokeSession(token, reason)) count++;
    }
    return count;
  }

  revokeOtherSessions(currentToken: string, reason = 'user_signed_out_others'): number {
    const current = this.sessions.get(currentToken);
    if (!current) return 0;
    const tokens = this.userSessionIndex.get(current.userId);
    if (!tokens) return 0;
    let count = 0;
    for (const token of tokens) {
      if (token !== currentToken) {
        if (this.revokeSession(token, reason)) count++;
      }
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getSession(token: string): SessionRecord | undefined {
    return this.sessions.get(token);
  }

  getSessionById(id: string): SessionRecord | undefined {
    for (const session of this.sessions.values()) {
      if (session.id === id) return session;
    }
    return undefined;
  }

  getActiveSessionsForUser(userId: string): SessionRecord[] {
    const tokens = this.userSessionIndex.get(userId);
    if (!tokens) return [];
    const now = Date.now();
    const active: SessionRecord[] = [];
    for (const token of tokens) {
      const s = this.sessions.get(token);
      if (s && s.status === 'active' && now <= s.expiresAt) {
        active.push(s);
      }
    }
    return active;
  }

  getAllSessionsForUser(userId: string): SessionRecord[] {
    const tokens = this.userSessionIndex.get(userId);
    if (!tokens) return [];
    const sessions: SessionRecord[] = [];
    for (const token of tokens) {
      const s = this.sessions.get(token);
      if (s) sessions.push(s);
    }
    return sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  getSuspiciousSessions(userId?: string): SessionRecord[] {
    const all = userId
      ? this.getAllSessionsForUser(userId)
      : Array.from(this.sessions.values());
    return all.filter((s) => s.isSuspicious);
  }

  // -------------------------------------------------------------------------
  // Concurrent session enforcement
  // -------------------------------------------------------------------------

  private enforceConcurrentLimit(userId: string): void {
    const active = this.getActiveSessionsForUser(userId)
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt); // oldest first

    while (active.length >= this.config.maxConcurrentSessions) {
      const oldest = active.shift();
      if (oldest) {
        this.revokeSession(oldest.token, 'concurrent_session_limit');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Expiry sweep (call periodically or on request)
  // -------------------------------------------------------------------------

  sweepExpiredSessions(): number {
    const now = Date.now();
    let count = 0;
    for (const [token, session] of this.sessions) {
      if (session.status === 'active' && now > session.expiresAt) {
        session.status = 'expired';
        this.audit({
          sessionId: session.id,
          userId: session.userId,
          action: 'expired',
          ip: session.geo.ip,
          userAgent: session.device.userAgent,
          timestamp: now,
        });
        count++;
      }
      // Evict very old sessions to save memory (> 7 days since last activity)
      if (
        session.status !== 'active' &&
        now - session.lastActiveAt > 7 * 24 * 60 * 60 * 1000
      ) {
        this.sessions.delete(token);
      }
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------

  updateConfig(patch: Partial<SessionServiceConfig>): SessionServiceConfig {
    this.config = { ...this.config, ...patch };
    return this.config;
  }

  getConfig(): SessionServiceConfig {
    return { ...this.config };
  }

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  private audit(entry: SessionAuditEntry): void {
    this.auditLog.push(entry);
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-this.maxAuditEntries / 2);
    }
  }

  getAuditLog(options: {
    userId?: string;
    sessionId?: string;
    action?: SessionAuditEntry['action'];
    since?: number;
    limit?: number;
  } = {}): SessionAuditEntry[] {
    const { userId, sessionId, action, since, limit = 200 } = options;
    let log = this.auditLog;
    if (userId) log = log.filter((e) => e.userId === userId);
    if (sessionId) log = log.filter((e) => e.sessionId === sessionId);
    if (action) log = log.filter((e) => e.action === action);
    if (since) log = log.filter((e) => e.timestamp >= since);
    return log.slice(-limit);
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  getStats(): {
    totalSessions: number;
    activeSessions: number;
    expiredSessions: number;
    revokedSessions: number;
    suspiciousSessions: number;
    uniqueUsers: number;
    avgSessionDurationMs: number;
  } {
    const now = Date.now();
    let active = 0, expired = 0, revoked = 0, suspicious = 0;
    let totalDurationMs = 0;
    let completedSessions = 0;

    for (const s of this.sessions.values()) {
      if (s.status === 'active' && now <= s.expiresAt) active++;
      else if (s.status === 'expired') expired++;
      else if (s.status === 'revoked') revoked++;
      if (s.isSuspicious) suspicious++;

      if (s.status !== 'active') {
        const endTime = s.revokedAt ?? s.expiresAt;
        totalDurationMs += endTime - s.createdAt;
        completedSessions++;
      }
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions: active,
      expiredSessions: expired,
      revokedSessions: revoked,
      suspiciousSessions: suspicious,
      uniqueUsers: this.userSessionIndex.size,
      avgSessionDurationMs: completedSessions > 0
        ? Math.round(totalDurationMs / completedSessions)
        : 0,
    };
  }

  // -------------------------------------------------------------------------
  // Prometheus metrics
  // -------------------------------------------------------------------------

  prometheusMetrics(): string {
    const stats = this.getStats();
    const lines = [
      '# HELP subtrackr_sessions_total Total sessions by status',
      '# TYPE subtrackr_sessions_total gauge',
      `subtrackr_sessions_total{status="active"} ${stats.activeSessions}`,
      `subtrackr_sessions_total{status="expired"} ${stats.expiredSessions}`,
      `subtrackr_sessions_total{status="revoked"} ${stats.revokedSessions}`,
      '',
      '# HELP subtrackr_sessions_suspicious Total suspicious sessions',
      '# TYPE subtrackr_sessions_suspicious gauge',
      `subtrackr_sessions_suspicious ${stats.suspiciousSessions}`,
      '',
      '# HELP subtrackr_sessions_unique_users Unique users with at least one session',
      '# TYPE subtrackr_sessions_unique_users gauge',
      `subtrackr_sessions_unique_users ${stats.uniqueUsers}`,
    ];
    return lines.join('\n') + '\n';
  }
}

// Singleton instance
export const serverSessionService = new ServerSessionService();
