/**
 * API Key Rotation Service — SubTrackr
 *
 * Issue #1009: Implement API key rotation with grace period
 *
 * Features:
 *  - Generate new API key while keeping the old one valid for a configurable grace period
 *  - Dual-key acceptance window: requests authenticated with the old key continue to work
 *    until the grace period expires
 *  - Automatic expiry + cleanup of keys past their grace deadline
 *  - Per-key rotation history (audit trail)
 *  - Rotation event emission via the domain EventBus
 *  - Prometheus metrics export
 */

import { randomBytes, createHmac } from 'crypto';
import { eventBus, buildEvent } from './events';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1_000; // 24 h
const DEFAULT_KEY_TTL_MS = 365 * 24 * 60 * 60 * 1_000; // 1 year
const KEY_PREFIX_TEST = 'sk_test_';
const KEY_PREFIX_LIVE = 'sk_live_';
const HMAC_ALG = 'sha256';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApiKeyEnvironment = 'test' | 'production';

export type ApiKeyStatus = 'active' | 'grace' | 'expired' | 'revoked';

export interface ManagedApiKey {
  /** Opaque record identifier (not the secret value). */
  readonly id: string;
  /** The actual secret key string sent in Authorization headers. */
  readonly key: string;
  readonly name: string;
  readonly developerId: string;
  readonly environment: ApiKeyEnvironment;
  readonly permissions: string[];
  status: ApiKeyStatus;
  readonly createdAt: number;
  expiresAt: number;
  /** Set when rotation starts — old key stays valid until this timestamp. */
  gracePeriodEndsAt?: number;
  /** ID of the successor key created by rotation (if any). */
  replacedByKeyId?: string;
  /** ID of the predecessor key this one replaced (if any). */
  replacesKeyId?: string;
  revokedAt?: number;
  lastUsedAt?: number;
  usageCount: number;
}

export interface RotationOptions {
  /** Grace period in milliseconds (default: 24 h). */
  gracePeriodMs?: number;
  /** TTL for the new key in milliseconds (default: 1 year). */
  newKeyTtlMs?: number;
  /** Human-readable reason stored in the rotation record. */
  reason?: string;
}

export interface RotationResult {
  /** The newly created key. */
  newKey: ManagedApiKey;
  /** The old key (now in grace period). */
  oldKey: ManagedApiKey;
  /** When the old key will stop being accepted. */
  gracePeriodEndsAt: number;
  /** Milliseconds until old key expires. */
  gracePeriodRemainingMs: number;
}

export interface RotationRecord {
  readonly id: string;
  readonly developerId: string;
  readonly oldKeyId: string;
  readonly newKeyId: string;
  readonly rotatedAt: number;
  readonly gracePeriodEndsAt: number;
  readonly reason?: string;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  key?: ManagedApiKey;
  /** True if the key is in grace period (warn callers to update). */
  isGrace: boolean;
  /** Milliseconds remaining in grace period (0 when not in grace). */
  graceRemainingMs: number;
  reason?: string;
}

export interface ApiKeyRotationMetrics {
  totalKeys: number;
  activeKeys: number;
  graceKeys: number;
  expiredKeys: number;
  revokedKeys: number;
  totalRotations: number;
  totalValidations: number;
  gracePeriodHits: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ApiKeyRotationService {
  /** All managed keys, keyed by key ID. */
  private readonly keys = new Map<string, ManagedApiKey>();
  /** Fast lookup: secret key string → key ID. */
  private readonly keyIndex = new Map<string, string>();
  /** Rotation audit records. */
  private readonly rotationHistory: RotationRecord[] = [];

  private totalValidations = 0;
  private gracePeriodHits = 0;

  // ── Key creation ──────────────────────────────────────────────────────────

  /**
   * Create a fresh API key (no rotation — first key for a developer).
   */
  createKey(
    developerId: string,
    name: string,
    environment: ApiKeyEnvironment,
    permissions: string[] = [],
    ttlMs = DEFAULT_KEY_TTL_MS,
  ): ManagedApiKey {
    const id = this.generateId('key');
    const secret = this.generateSecret(environment);
    const now = Date.now();

    const key: ManagedApiKey = {
      id,
      key: secret,
      name,
      developerId,
      environment,
      permissions: [...permissions],
      status: 'active',
      createdAt: now,
      expiresAt: now + ttlMs,
      usageCount: 0,
    };

    this.keys.set(id, key);
    this.keyIndex.set(secret, id);
    return key;
  }

  // ── Rotation ──────────────────────────────────────────────────────────────

  /**
   * Rotate an API key.
   *
   * 1. Creates a new key with the same settings.
   * 2. Marks the old key as `grace` and sets `gracePeriodEndsAt`.
   * 3. Both keys are accepted by `validateKey()` during the grace window.
   * 4. Emits an `auth.api_key_rotated` domain event.
   */
  async rotateKey(keyId: string, options: RotationOptions = {}): Promise<RotationResult> {
    const oldKey = this.keys.get(keyId);
    if (!oldKey) {
      throw new Error(`API key not found: ${keyId}`);
    }
    if (oldKey.status === 'revoked') {
      throw new Error(`Cannot rotate a revoked key: ${keyId}`);
    }
    if (oldKey.status === 'expired') {
      throw new Error(`Cannot rotate an expired key: ${keyId}`);
    }

    const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
    const newKeyTtlMs = options.newKeyTtlMs ?? DEFAULT_KEY_TTL_MS;
    const now = Date.now();
    const gracePeriodEndsAt = now + gracePeriodMs;

    // Create replacement key
    const newKeySecret = this.generateSecret(oldKey.environment);
    const newId = this.generateId('key');
    const newKey: ManagedApiKey = {
      id: newId,
      key: newKeySecret,
      name: oldKey.name,
      developerId: oldKey.developerId,
      environment: oldKey.environment,
      permissions: [...oldKey.permissions],
      status: 'active',
      createdAt: now,
      expiresAt: now + newKeyTtlMs,
      replacesKeyId: oldKey.id,
      usageCount: 0,
    };

    // Transition old key to grace period
    oldKey.status = 'grace';
    oldKey.gracePeriodEndsAt = gracePeriodEndsAt;
    oldKey.replacedByKeyId = newId;

    this.keys.set(newId, newKey);
    this.keyIndex.set(newKeySecret, newId);

    // Rotation audit record
    const record: RotationRecord = {
      id: this.generateId('rot'),
      developerId: oldKey.developerId,
      oldKeyId: oldKey.id,
      newKeyId: newId,
      rotatedAt: now,
      gracePeriodEndsAt,
      reason: options.reason,
    };
    this.rotationHistory.push(record);

    // Domain event
    await eventBus.publish(
      buildEvent(
        'auth',
        'api_key_rotated',
        {
          keyId: newId,
          merchantId: oldKey.developerId,
          rotatedAt: now,
          expiresAt: gracePeriodEndsAt,
        },
        { aggregateId: oldKey.developerId, correlationId: record.id },
      ),
    );

    return {
      newKey,
      oldKey,
      gracePeriodEndsAt,
      gracePeriodRemainingMs: gracePeriodMs,
    };
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Validate an API key string.
   *
   * - Expired grace-period keys are automatically transitioned to `expired`.
   * - Returns `isGrace: true` with the remaining grace window when the old
   *   key is used after rotation so callers can surface a deprecation warning.
   */
  validateKey(secret: string): ApiKeyValidationResult {
    this.totalValidations++;

    const id = this.keyIndex.get(secret);
    if (!id) {
      return { valid: false, isGrace: false, graceRemainingMs: 0, reason: 'key_not_found' };
    }

    const key = this.keys.get(id)!;
    const now = Date.now();

    // Auto-expire grace keys whose window has closed
    if (key.status === 'grace' && key.gracePeriodEndsAt && now > key.gracePeriodEndsAt) {
      key.status = 'expired';
    }

    if (key.status === 'revoked') {
      return { valid: false, key, isGrace: false, graceRemainingMs: 0, reason: 'revoked' };
    }
    if (key.status === 'expired') {
      return { valid: false, key, isGrace: false, graceRemainingMs: 0, reason: 'expired' };
    }
    if (now > key.expiresAt && key.status === 'active') {
      key.status = 'expired';
      return { valid: false, key, isGrace: false, graceRemainingMs: 0, reason: 'expired' };
    }

    // Record usage
    key.lastUsedAt = now;
    key.usageCount++;

    if (key.status === 'grace') {
      const graceRemainingMs = Math.max(0, (key.gracePeriodEndsAt ?? now) - now);
      this.gracePeriodHits++;
      return { valid: true, key, isGrace: true, graceRemainingMs };
    }

    return { valid: true, key, isGrace: false, graceRemainingMs: 0 };
  }

  // ── Revocation ────────────────────────────────────────────────────────────

  /**
   * Immediately revoke a key (no grace period).
   */
  revokeKey(keyId: string): boolean {
    const key = this.keys.get(keyId);
    if (!key || key.status === 'revoked') return false;
    key.status = 'revoked';
    key.revokedAt = Date.now();
    return true;
  }

  /**
   * Revoke all keys for a developer (e.g., account suspension).
   */
  revokeAllKeys(developerId: string): number {
    let count = 0;
    for (const key of this.keys.values()) {
      if (key.developerId === developerId && key.status !== 'revoked') {
        key.status = 'revoked';
        key.revokedAt = Date.now();
        count++;
      }
    }
    return count;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Expire any grace-period or active keys whose time has passed.
   * Returns the count of keys transitioned to `expired`.
   */
  cleanupExpiredKeys(): number {
    const now = Date.now();
    let count = 0;
    for (const key of this.keys.values()) {
      if (
        key.status === 'grace' &&
        key.gracePeriodEndsAt &&
        now > key.gracePeriodEndsAt
      ) {
        key.status = 'expired';
        count++;
      } else if (key.status === 'active' && now > key.expiresAt) {
        key.status = 'expired';
        count++;
      }
    }
    return count;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getKey(keyId: string): ManagedApiKey | undefined {
    return this.keys.get(keyId);
  }

  getKeysByDeveloper(developerId: string): ManagedApiKey[] {
    return Array.from(this.keys.values()).filter((k) => k.developerId === developerId);
  }

  getActiveKeysByDeveloper(developerId: string): ManagedApiKey[] {
    return this.getKeysByDeveloper(developerId).filter(
      (k) => k.status === 'active' || k.status === 'grace',
    );
  }

  getRotationHistory(developerId?: string): RotationRecord[] {
    if (!developerId) return [...this.rotationHistory];
    return this.rotationHistory.filter((r) => r.developerId === developerId);
  }

  /**
   * Returns the grace period status for a key currently in rotation.
   * Returns `null` if the key is not in grace period.
   */
  getGracePeriodStatus(
    keyId: string,
  ): { gracePeriodEndsAt: number; remainingMs: number; successorKeyId: string } | null {
    const key = this.keys.get(keyId);
    if (!key || key.status !== 'grace' || !key.gracePeriodEndsAt) return null;
    const now = Date.now();
    if (now > key.gracePeriodEndsAt) {
      key.status = 'expired';
      return null;
    }
    return {
      gracePeriodEndsAt: key.gracePeriodEndsAt,
      remainingMs: key.gracePeriodEndsAt - now,
      successorKeyId: key.replacedByKeyId ?? '',
    };
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(): ApiKeyRotationMetrics {
    let activeKeys = 0;
    let graceKeys = 0;
    let expiredKeys = 0;
    let revokedKeys = 0;
    for (const key of this.keys.values()) {
      if (key.status === 'active') activeKeys++;
      else if (key.status === 'grace') graceKeys++;
      else if (key.status === 'expired') expiredKeys++;
      else if (key.status === 'revoked') revokedKeys++;
    }
    return {
      totalKeys: this.keys.size,
      activeKeys,
      graceKeys,
      expiredKeys,
      revokedKeys,
      totalRotations: this.rotationHistory.length,
      totalValidations: this.totalValidations,
      gracePeriodHits: this.gracePeriodHits,
    };
  }

  prometheusMetrics(namespace = 'subtrackr_api_key'): string {
    const m = this.getMetrics();
    return [
      `# HELP ${namespace}_total Total managed API keys`,
      `# TYPE ${namespace}_total gauge`,
      `${namespace}_total ${m.totalKeys}`,
      `# HELP ${namespace}_active_total Active (non-expired, non-revoked) keys`,
      `# TYPE ${namespace}_active_total gauge`,
      `${namespace}_active_total ${m.activeKeys}`,
      `# HELP ${namespace}_grace_total Keys currently in grace period`,
      `# TYPE ${namespace}_grace_total gauge`,
      `${namespace}_grace_total ${m.graceKeys}`,
      `# HELP ${namespace}_expired_total Expired keys`,
      `# TYPE ${namespace}_expired_total gauge`,
      `${namespace}_expired_total ${m.expiredKeys}`,
      `# HELP ${namespace}_revoked_total Revoked keys`,
      `# TYPE ${namespace}_revoked_total gauge`,
      `${namespace}_revoked_total ${m.revokedKeys}`,
      `# HELP ${namespace}_rotations_total Total key rotations performed`,
      `# TYPE ${namespace}_rotations_total counter`,
      `${namespace}_rotations_total ${m.totalRotations}`,
      `# HELP ${namespace}_validations_total Total key validation attempts`,
      `# TYPE ${namespace}_validations_total counter`,
      `${namespace}_validations_total ${m.totalValidations}`,
      `# HELP ${namespace}_grace_hits_total Validations that succeeded via grace period`,
      `# TYPE ${namespace}_grace_hits_total counter`,
      `${namespace}_grace_hits_total ${m.gracePeriodHits}`,
    ].join('\n');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
  }

  private generateSecret(environment: ApiKeyEnvironment): string {
    const prefix = environment === 'test' ? KEY_PREFIX_TEST : KEY_PREFIX_LIVE;
    return prefix + randomBytes(24).toString('base64url');
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const apiKeyRotationService = new ApiKeyRotationService();
