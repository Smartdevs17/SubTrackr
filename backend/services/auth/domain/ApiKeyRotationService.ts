import { randomBytes, createHash } from 'crypto';
import { AuthError } from '../errors';
import { logger } from '../../shared/logging';
import type { ApiKeyRecord, ApiKeyRotationPolicy, IApiKeyRotationService } from '../interfaces';

const KEY_PREFIX_LENGTH = 8;
const KEY_BYTE_LENGTH = 32;
const KEY_HASH_ALGORITHM = 'sha256';
const MAX_HISTORY = 5;

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

  async registerKey(merchantId: string): Promise<{ keyId: string; rawKey: string; record: ApiKeyRecord }> {
    const keyId = `key_${randomBytes(8).toString('hex')}`;
    const key = this.generateKey();
    const policy = this.policies.get(merchantId) ?? this.policies.get('default')!;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + policy.intervalDays * 24 * 60 * 60 * 1000);

    const record: ApiKeyRecord = {
      id: keyId,
      merchantId,
      keyPrefix: key.prefix,
      keyHash: key.hash,
      status: 'active',
      rotatedAt: null,
      expiresAt: expiresAt.toISOString(),
      gracePeriodEndsAt: null,
      createdAt: now.toISOString(),
    };

    this.keys.set(keyId, record);
    return { keyId, rawKey: key.raw, record };
  }

  async validateKey(rawKey: string): Promise<ApiKeyRecord | null> {
    const hash = createHash(KEY_HASH_ALGORITHM).update(rawKey).digest('hex');
    for (const [, record] of this.keys) {
      if (record.keyHash === hash) {
        if (record.status === 'revoked') throw AuthError.apiKeyRevoked(record.id);
        if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
          throw AuthError.apiKeyExpired(record.id);
        }
        return record;
      }
    }
    return null;
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
    const hash = createHash(KEY_HASH_ALGORITHM).update(raw).digest('hex');
    return { raw, prefix, hash };
  }
}

export const apiKeyRotationService = new ApiKeyRotationService();
