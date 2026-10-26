import { randomBytes, createHmac } from 'crypto';
import { AuthError } from '../errors';
import { logger } from '../../shared/logging';
import type { ApiKeyRecord, ApiKeyRotationPolicy, IApiKeyRotationService } from '../interfaces';

const KEY_PREFIX_LENGTH = 8;
const KEY_BYTE_LENGTH = 32;
const KEY_HASH_ALGORITHM = 'sha256';
const MAX_HISTORY = 5;

/**
 * Server-side pepper for API key hashing.
 *
 * API keys are high-entropy random values, so a plain hash resists brute
 * force — but an unsalted SHA-256 is still trivially attackable in bulk via
 * precomputation, and it means a database disclosure immediately yields
 * directly comparable key material. A keyed HMAC removes that: without the
 * pepper, a leaked table cannot be attacked offline at all.
 *
 * Required in production; ephemeral per-process outside it (with a warning),
 * because a checked-in fallback pepper would be no better than none.
 */
function resolveApiKeyPepper(): string {
  const configured = process.env['API_KEY_HASH_PEPPER'];

  if (configured && configured.trim().length >= 16) {
    return configured;
  }

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'API_KEY_HASH_PEPPER must be set to a random value of at least 16 characters in production.'
    );
  }

  console.warn(
    '[ApiKeyRotationService] API_KEY_HASH_PEPPER is not configured; using an ephemeral pepper. API keys will not resolve across restarts.'
  );

  return randomBytes(32).toString('hex');
}

let _pepper: string | null = null;

/** Test seam: forces a specific pepper, or `null` to re-resolve. */
export function __setApiKeyPepperForTesting(pepper: string | null): void {
  _pepper = pepper;
}

function apiKeyPepper(): string {
  if (_pepper === null) {
    _pepper = resolveApiKeyPepper();
  }
  return _pepper;
}

/**
 * Deterministic keyed digest of an API key.
 *
 * Stays deterministic so stored hashes remain searchable by lookup.
 */
export function hashApiKey(rawKey: string): string {
  return createHmac(KEY_HASH_ALGORITHM, apiKeyPepper()).update(rawKey).digest('hex');
}

/**
 * Checks if a set of granted scopes satisfies a required scope.
 * Supports exact match, universal wildcard ('*'), and prefix wildcards ('read:*').
 */
export function hasScope(grantedScopes: string[] | undefined, requiredScope: string): boolean {
  if (!grantedScopes || grantedScopes.length === 0) return false;
  if (grantedScopes.includes('*')) return true;
  if (grantedScopes.includes(requiredScope)) return true;

  return grantedScopes.some((scope) => {
    if (scope.endsWith(':*')) {
      const prefix = scope.slice(0, -1);
      return requiredScope.startsWith(prefix);
    }
    return false;
  });
}

export class ApiKeyRotationService implements IApiKeyRotationService {
  private keys = new Map<string, ApiKeyRecord>();
  private history = new Map<string, ApiKeyRecord[]>();
  private policies = new Map<string, ApiKeyRotationPolicy>();

  constructor() {
    this.policies.set('default', { intervalDays: 30, gracePeriodHours: 24 });
  }

  async rotateKey(keyId: string): Promise<ApiKeyRecord> {
    const existing = this.keys.get(keyId);
    if (!existing) throw AuthError.apiKeyNotFound(keyId);

    const policy = this.policies.get(existing.merchantId) ?? this.policies.get('default')!;

    const newKey = this.generateKey();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + policy.intervalDays * 24 * 60 * 60 * 1000);
    const gracePeriodEndsAt = new Date(now.getTime() + policy.gracePeriodHours * 60 * 60 * 1000);

    existing.status = 'expired';
    existing.rotatedAt = now.toISOString();
    existing.expiresAt = now.toISOString();

    const oldHistory = this.history.get(keyId) ?? [];
    oldHistory.push({ ...existing });
    if (oldHistory.length > MAX_HISTORY) oldHistory.shift();
    this.history.set(keyId, oldHistory);

    const newRecord: ApiKeyRecord = {
      id: keyId + '_' + Date.now(),
      merchantId: existing.merchantId,
      keyPrefix: newKey.prefix,
      keyHash: newKey.hash,
      scopes: existing.scopes ? [...existing.scopes] : ['*'],
      status: 'active',
      rotatedAt: null,
      expiresAt: expiresAt.toISOString(),
      gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
      createdAt: now.toISOString(),
    };

    this.keys.set(keyId, newRecord);
    logger.info('API key rotated', { keyId, merchantId: existing.merchantId, expiresAt: newRecord.expiresAt });

    return newRecord;
  }

  async forceRotateKey(keyId: string): Promise<ApiKeyRecord> {
    const existing = this.keys.get(keyId);
    if (!existing) throw AuthError.apiKeyNotFound(keyId);

    existing.status = 'revoked';
    existing.rotatedAt = new Date().toISOString();
    existing.expiresAt = new Date().toISOString();

    const policy = this.policies.get(existing.merchantId) ?? this.policies.get('default')!;
    const newKey = this.generateKey();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + policy.intervalDays * 24 * 60 * 60 * 1000);

    const newRecord: ApiKeyRecord = {
      id: keyId + '_' + Date.now(),
      merchantId: existing.merchantId,
      keyPrefix: newKey.prefix,
      keyHash: newKey.hash,
      scopes: existing.scopes ? [...existing.scopes] : ['*'],
      status: 'active',
      rotatedAt: null,
      expiresAt: expiresAt.toISOString(),
      gracePeriodEndsAt: null,
      createdAt: now.toISOString(),
    };

    this.keys.set(keyId, newRecord);
    logger.info('API key force-rotated (immediate revoke)', { keyId, merchantId: existing.merchantId });

    return newRecord;
  }

  async getRotationHistory(keyId: string): Promise<ApiKeyRecord[]> {
    return this.history.get(keyId) ?? [];
  }

  async getPolicy(merchantId: string): Promise<ApiKeyRotationPolicy> {
    return this.policies.get(merchantId) ?? this.policies.get('default')!;
  }

  async updatePolicy(merchantId: string, policy: Partial<ApiKeyRotationPolicy>): Promise<ApiKeyRotationPolicy> {
    const current = this.policies.get(merchantId) ?? { ...this.policies.get('default')! };
    const updated: ApiKeyRotationPolicy = {
      intervalDays: policy.intervalDays ?? current.intervalDays,
      gracePeriodHours: policy.gracePeriodHours ?? current.gracePeriodHours,
    };
    this.policies.set(merchantId, updated);
    logger.info('API key rotation policy updated', { merchantId, policy: updated });
    return updated;
  }

  async registerKey(
    merchantId: string,
    options?: { scopes?: string[]; expiresInDays?: number }
  ): Promise<{ keyId: string; rawKey: string; record: ApiKeyRecord }> {
    const keyId = `key_${randomBytes(8).toString('hex')}`;
    const key = this.generateKey();
    const policy = this.policies.get(merchantId) ?? this.policies.get('default')!;
    const now = new Date();
    const intervalDays = options?.expiresInDays ?? policy.intervalDays;
    const expiresAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

    const record: ApiKeyRecord = {
      id: keyId,
      merchantId,
      keyPrefix: key.prefix,
      keyHash: key.hash,
      scopes: options?.scopes ? [...options.scopes] : ['*'],
      status: 'active',
      rotatedAt: null,
      expiresAt: expiresAt.toISOString(),
      gracePeriodEndsAt: null,
      createdAt: now.toISOString(),
    };

    this.keys.set(keyId, record);
    return { keyId, rawKey: key.raw, record };
  }

  async validateKey(rawKey: string, requiredScope?: string): Promise<ApiKeyRecord | null> {
    const hash = hashApiKey(rawKey);
    for (const [, record] of this.keys) {
      if (record.keyHash === hash) {
        if (record.status === 'revoked') throw AuthError.apiKeyRevoked(record.id);
        if (record.expiresAt && new Date(record.expiresAt) <= new Date()) {
          record.status = 'expired';
          throw AuthError.apiKeyExpired(record.id);
        }
        if (requiredScope && !hasScope(record.scopes, requiredScope)) {
          throw AuthError.apiKeyInsufficientScope(record.id, requiredScope);
        }
        return record;
      }
    }
    return null;
  }

  /**
   * Immediately revoke a key. Unlike `forceRotateKey`, no replacement is
   * issued — used when a key is compromised or no longer needed.
   */
  async revokeKey(keyId: string, reason = 'manual'): Promise<ApiKeyRecord> {
    const existing = this.keys.get(keyId);
    if (!existing) throw AuthError.apiKeyNotFound(keyId);
    if (existing.status === 'revoked') throw AuthError.apiKeyAlreadyRevoked(keyId);

    const now = new Date().toISOString();
    existing.status = 'revoked';
    existing.revokedAt = now;
    existing.revocationReason = reason;
    existing.gracePeriodEndsAt = null;

    logger.warn('API key revoked', { keyId, merchantId: existing.merchantId, reason });
    return { ...existing };
  }

  getKey(keyId: string): ApiKeyRecord | undefined {
    const record = this.keys.get(keyId);
    return record ? { ...record } : undefined;
  }

  /** Resolve the key ID for a SHA-256 key hash (hex). Returns null when unknown. */
  findKeyIdByHash(keyHash: string): string | null {
    const normalized = keyHash.toLowerCase();
    for (const [keyId, record] of this.keys) {
      if (record.keyHash === normalized) return keyId;
    }
    return null;
  }

  listKeyIds(merchantId?: string): string[] {
    const ids: string[] = [];
    for (const [keyId, record] of this.keys) {
      if (!merchantId || record.merchantId === merchantId) ids.push(keyId);
    }
    return ids;
  }

  async getKeysDueForRotation(): Promise<ApiKeyRecord[]> {
    const due: ApiKeyRecord[] = [];
    const now = new Date();

    for (const [, record] of this.keys) {
      if (record.status !== 'active') continue;
      if (record.expiresAt && new Date(record.expiresAt) <= now) {
        due.push(record);
      }
    }

    return due;
  }

  private generateKey(): { raw: string; prefix: string; hash: string } {
    const raw = 'sk_' + randomBytes(KEY_BYTE_LENGTH).toString('base64url');
    const prefix = raw.substring(0, KEY_PREFIX_LENGTH);
    const hash = hashApiKey(raw);
    return { raw, prefix, hash };
  }
}

export const apiKeyRotationService = new ApiKeyRotationService();
