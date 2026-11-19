import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { logger } from '../../shared/logging';
import { eventBus, buildEvent } from '../../shared/events';
import { AuthError, AuthErrorCode } from '../errors';

export interface AccountRecoveryConfig {
  tokenTtlMs: number;          // Default 15 minutes
  grantTtlMs: number;          // Default 5 minutes
  maxVerificationAttempts: number; // Max 3 failed attempts per session
  rateLimitWindowMs: number;   // 15 minutes sliding window
  maxInitiationsPerIdentifier: number; // Max 3 per 15 minutes
  maxInitiationsPerIp: number; // Max 5 per 15 minutes
  pepper: string;
}

export const DEFAULT_RECOVERY_CONFIG: AccountRecoveryConfig = {
  tokenTtlMs: 15 * 60 * 1000,
  grantTtlMs: 5 * 60 * 1000,
  maxVerificationAttempts: 3,
  rateLimitWindowMs: 15 * 60 * 1000,
  maxInitiationsPerIdentifier: 3,
  maxInitiationsPerIp: 5,
  pepper: process.env['ACCOUNT_RECOVERY_PEPPER'] || 'subtrackr_default_recovery_pepper_sec_key',
};

export type RecoveryAction =
  | 'recovery_initiated'
  | 'identity_verified'
  | 'identity_verification_failed'
  | 'recovery_completed'
  | 'rate_limit_exceeded'
  | 'recovery_expired';

export interface RecoveryAuditEntry {
  id: string;
  recoveryId: string | null;
  identifier: string;
  action: RecoveryAction;
  ip: string;
  userAgent: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface RecoverySession {
  id: string;
  identifier: string;
  tokenHash: string;
  challengeAnswerHash?: string;
  status: 'pending' | 'verified' | 'completed' | 'expired' | 'locked';
  failedAttempts: number;
  grantTokenHash?: string;
  grantExpiresAt?: number;
  createdAt: number;
  expiresAt: number;
  ip: string;
  userAgent: string;
}

export class AccountRecoveryService {
  private config: AccountRecoveryConfig;
  private sessions = new Map<string, RecoverySession>(); // recoveryId -> session
  private auditLog: RecoveryAuditEntry[] = [];
  private initiationTracker = new Map<string, number[]>(); // key (ip or id) -> timestamps

  constructor(customConfig: Partial<AccountRecoveryConfig> = {}) {
    this.config = { ...DEFAULT_RECOVERY_CONFIG, ...customConfig };
  }

  getConfig(): AccountRecoveryConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<AccountRecoveryConfig>): AccountRecoveryConfig {
    this.config = { ...this.config, ...patch };
    return this.getConfig();
  }

  getAuditTrail(identifier?: string): RecoveryAuditEntry[] {
    if (!identifier) return [...this.auditLog];
    return this.auditLog.filter((a) => a.identifier === identifier);
  }

  private audit(entry: Omit<RecoveryAuditEntry, 'id' | 'timestamp'>): void {
    const record: RecoveryAuditEntry = {
      id: `aud_${randomBytes(8).toString('hex')}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.auditLog.push(record);
    if (this.auditLog.length > 10_000) this.auditLog.shift();
  }

  private checkRateLimit(key: string, maxLimit: number): boolean {
    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindowMs;
    const history = (this.initiationTracker.get(key) ?? []).filter((ts) => ts > windowStart);
    if (history.length >= maxLimit) {
      return false;
    }
    history.push(now);
    this.initiationTracker.set(key, history);
    return true;
  }

  private hashValue(value: string): string {
    return createHmac('sha256', this.config.pepper).update(value).digest('hex');
  }

  private constantTimeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  /**
   * Step 1: Initiate recovery process with identity verification token.
   * Rate limited per identifier and per IP.
   */
  async initiateRecovery(params: {
    identifier: string; // email or username
    ip: string;
    userAgent: string;
    challengeAnswer?: string; // Optional security question answer
  }): Promise<{ recoveryId: string; rawToken: string; expiresAt: string }> {
    const { identifier, ip, userAgent, challengeAnswer } = params;

    // Enforce rate limiting
    const allowedById = this.checkRateLimit(`id:${identifier.toLowerCase()}`, this.config.maxInitiationsPerIdentifier);
    const allowedByIp = this.checkRateLimit(`ip:${ip}`, this.config.maxInitiationsPerIp);

    if (!allowedById || !allowedByIp) {
      this.audit({
        recoveryId: null,
        identifier,
        action: 'rate_limit_exceeded',
        ip,
        userAgent,
        details: { allowedById, allowedByIp },
      });
      throw new AuthError(
        'RATE_LIMIT_EXCEEDED' as any,
        'Too many recovery requests. Please wait before trying again.',
        { identifier, ip }
      );
    }

    const recoveryId = `rec_${randomBytes(12).toString('hex')}`;
    const rawToken = randomBytes(24).toString('hex');
    const now = Date.now();
    const expiresAt = now + this.config.tokenTtlMs;

    const session: RecoverySession = {
      id: recoveryId,
      identifier,
      tokenHash: this.hashValue(rawToken),
      challengeAnswerHash: challengeAnswer ? this.hashValue(challengeAnswer.trim().toLowerCase()) : undefined,
      status: 'pending',
      failedAttempts: 0,
      createdAt: now,
      expiresAt,
      ip,
      userAgent,
    };

    this.sessions.set(recoveryId, session);

    this.audit({
      recoveryId,
      identifier,
      action: 'recovery_initiated',
      ip,
      userAgent,
      details: { hasChallenge: Boolean(challengeAnswer), expiresAt: new Date(expiresAt).toISOString() },
    });

    return {
      recoveryId,
      rawToken,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /**
   * Step 2: Verify Identity using the recovery token and optional challenge answer.
   * On success, issues a temporary, short-lived grant token.
   */
  async verifyIdentity(params: {
    recoveryId: string;
    token: string;
    challengeAnswer?: string;
    ip: string;
    userAgent: string;
  }): Promise<{ verified: boolean; grantToken: string; expiresAt: string }> {
    const { recoveryId, token, challengeAnswer, ip, userAgent } = params;
    const session = this.sessions.get(recoveryId);

    if (!session) {
      throw new AuthError('NOT_FOUND' as any, 'Recovery session not found or invalid');
    }

    const now = Date.now();

    if (session.status === 'locked') {
      this.audit({
        recoveryId,
        identifier: session.identifier,
        action: 'identity_verification_failed',
        ip,
        userAgent,
        details: { reason: 'session_locked' },
      });
      throw new AuthError('FORBIDDEN' as any, 'Recovery session is locked due to too many failed attempts');
    }

    if (now > session.expiresAt || session.status === 'expired') {
      session.status = 'expired';
      this.audit({
        recoveryId,
        identifier: session.identifier,
        action: 'recovery_expired',
        ip,
        userAgent,
      });
      throw new AuthError('BAD_REQUEST' as any, 'Recovery session has expired');
    }

    // Verify token with timing-safe comparison
    const incomingTokenHash = this.hashValue(token);
    const tokenValid = this.constantTimeCompare(session.tokenHash, incomingTokenHash);

    // Verify optional challenge answer
    let challengeValid = true;
    if (session.challengeAnswerHash) {
      if (!challengeAnswer) {
        challengeValid = false;
      } else {
        const incomingChallengeHash = this.hashValue(challengeAnswer.trim().toLowerCase());
        challengeValid = this.constantTimeCompare(session.challengeAnswerHash, incomingChallengeHash);
      }
    }

    if (!tokenValid || !challengeValid) {
      session.failedAttempts += 1;
      if (session.failedAttempts >= this.config.maxVerificationAttempts) {
        session.status = 'locked';
      }

      this.audit({
        recoveryId,
        identifier: session.identifier,
        action: 'identity_verification_failed',
        ip,
        userAgent,
        details: {
          failedAttempts: session.failedAttempts,
          tokenValid,
          challengeValid,
          locked: session.status === 'locked',
        },
      });

      throw new AuthError(
        'UNAUTHORIZED' as any,
        'Identity verification failed. Invalid recovery token or challenge.',
        { remainingAttempts: String(Math.max(0, this.config.maxVerificationAttempts - session.failedAttempts)) }
      );
    }

    // Identity verified! Issue grant token
    const rawGrantToken = randomBytes(32).toString('hex');
    const grantExpiresAt = now + this.config.grantTtlMs;

    session.status = 'verified';
    session.grantTokenHash = this.hashValue(rawGrantToken);
    session.grantExpiresAt = grantExpiresAt;

    this.audit({
      recoveryId,
      identifier: session.identifier,
      action: 'identity_verified',
      ip,
      userAgent,
      details: { grantExpiresAt: new Date(grantExpiresAt).toISOString() },
    });

    return {
      verified: true,
      grantToken: rawGrantToken,
      expiresAt: new Date(grantExpiresAt).toISOString(),
    };
  }

  /**
   * Step 3: Complete recovery (e.g. set new password / rotate access).
   * Consumes grant token ensuring single-use.
   */
  async completeRecovery(params: {
    recoveryId: string;
    grantToken: string;
    ip: string;
    userAgent: string;
  }): Promise<{ success: boolean; identifier: string; completedAt: string }> {
    const { recoveryId, grantToken, ip, userAgent } = params;
    const session = this.sessions.get(recoveryId);

    if (!session || session.status !== 'verified') {
      throw new AuthError('BAD_REQUEST' as any, 'Recovery session is not in verified status');
    }

    const now = Date.now();
    if (!session.grantExpiresAt || now > session.grantExpiresAt) {
      session.status = 'expired';
      this.audit({
        recoveryId,
        identifier: session.identifier,
        action: 'recovery_expired',
        ip,
        userAgent,
        details: { reason: 'grant_token_expired' },
      });
      throw new AuthError('BAD_REQUEST' as any, 'Recovery grant has expired. Please re-verify.');
    }

    const incomingGrantHash = this.hashValue(grantToken);
    if (!session.grantTokenHash || !this.constantTimeCompare(session.grantTokenHash, incomingGrantHash)) {
      this.audit({
        recoveryId,
        identifier: session.identifier,
        action: 'identity_verification_failed',
        ip,
        userAgent,
        details: { reason: 'invalid_grant_token' },
      });
      throw new AuthError('UNAUTHORIZED' as any, 'Invalid recovery grant token');
    }

    // Mark as completed and revoke tokens (single-use)
    session.status = 'completed';
    session.grantTokenHash = undefined;

    const completedAt = new Date().toISOString();

    this.audit({
      recoveryId,
      identifier: session.identifier,
      action: 'recovery_completed',
      ip,
      userAgent,
      details: { completedAt },
    });

    // Publish domain event
    try {
      await eventBus.publish(
        buildEvent(
          'auth',
          'account_recovery_completed',
          {
            recoveryId: session.id,
            identifier: session.identifier,
            completedAt,
            ip,
          },
          { aggregateId: session.identifier, correlationId: session.id }
        )
      );
    } catch (err) {
      logger.warn('Failed to publish account_recovery_completed event', { error: (err as Error).message });
    }

    return {
      success: true,
      identifier: session.identifier,
      completedAt,
    };
  }
}

export const accountRecoveryService = new AccountRecoveryService();
