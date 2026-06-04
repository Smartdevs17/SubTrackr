import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { ApiKey, Permission, RateLimit, ApiKeyAuditEntry } from '../types/sandbox';
import { SANDBOX_CONSTANTS, DEFAULT_RATE_LIMITS } from '../config/sandboxConfig';

export class ApiKeyService {
  private apiKeys: Map<string, ApiKey> = new Map();
  private environmentKeys: Map<string, string[]> = new Map();
  private prefixIndex: Map<string, Set<string>> = new Map();
  private readonly keyPrefixLength = 8;
  private readonly hashCost = 10;
  private readonly fallbackHash: string;

  constructor() {
    this.fallbackHash = bcrypt.hashSync('fallback-placeholder', this.hashCost);
  }

  async generateApiKey(
    environmentId: string,
    name: string,
    permissions: Permission[],
    customRateLimit?: Partial<RateLimit>,
    expiresInDays?: number
  ): Promise<ApiKey> {
    const existingKeys = this.environmentKeys.get(environmentId) || [];
    if (existingKeys.length >= SANDBOX_CONSTANTS.MAX_API_KEYS_PER_SANDBOX) {
      throw new Error(
        `Maximum API keys limit reached (${SANDBOX_CONSTANTS.MAX_API_KEYS_PER_SANDBOX})`
      );
    }

    const plainKey = this.generateSecureKey();
    const hashedKey = await this.hashKey(plainKey);
    const keyPrefix = plainKey.substring(0, this.keyPrefixLength);
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const storedKey: ApiKey = {
      id: crypto.randomUUID(),
      key: keyPrefix,
      keyPrefix,
      hashedKey,
      name,
      permissions,
      rateLimit: { ...DEFAULT_RATE_LIMITS, ...customRateLimit },
      expiresAt,
      lastUsedAt: null,
      usageCount: 0,
      auditLogs: [this.createAuditEntry('created', 'API key generated')],
      createdAt: new Date(),
      status: 'active',
    };

    this.apiKeys.set(storedKey.id, storedKey);
    this.environmentKeys.set(environmentId, [...existingKeys, storedKey.id]);
    this.indexKey(storedKey);

    return {
      ...storedKey,
      key: plainKey,
      plainKey,
    };
  }

  async validateApiKey(key: string): Promise<ApiKeyValidation> {
    const apiKey = await this.findApiKeyBySecret(key);
    if (!apiKey) {
      await bcrypt.compare(key, this.fallbackHash);
      return { valid: false, error: 'API key not found' };
    }

    if (apiKey.status === 'revoked') {
      this.recordAudit(apiKey, 'revoked', 'Validation denied for revoked API key');
      return { valid: false, error: 'API key has been revoked' };
    }

    if (apiKey.status === 'expired') {
      return { valid: false, error: 'API key has expired' };
    }

    if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
      apiKey.status = 'expired';
      this.recordAudit(apiKey, 'expired', 'API key expired during validation');
      this.apiKeys.set(apiKey.id, apiKey);
      return { valid: false, error: 'API key has expired' };
    }

    apiKey.lastUsedAt = new Date();
    apiKey.usageCount = (apiKey.usageCount ?? 0) + 1;
    this.recordAudit(apiKey, 'validated', `API key validated for prefix ${apiKey.keyPrefix}`);
    this.apiKeys.set(apiKey.id, apiKey);

    return { valid: true, apiKey: this.sanitizeApiKey(apiKey) };
  }

  async checkPermission(key: string, permission: Permission): Promise<boolean> {
    const validation = await this.validateApiKey(key);
    if (!validation.valid || !validation.apiKey) {
      return false;
    }

    return (
      validation.apiKey.permissions.includes(permission) ||
      validation.apiKey.permissions.includes('admin')
    );
  }

  async revokeApiKey(keyId: string): Promise<boolean> {
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) return false;

    apiKey.status = 'revoked';
    this.recordAudit(apiKey, 'revoked', 'API key revoked immediately');
    this.apiKeys.set(keyId, apiKey);
    return true;
  }

  async rotateApiKey(keyId: string): Promise<ApiKey | null> {
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) return null;

    const newKey = this.generateSecureKey();
    const newHash = await this.hashKey(newKey);
    this.unindexKey(apiKey);

    apiKey.hashedKey = newHash;
    apiKey.keyPrefix = newKey.substring(0, this.keyPrefixLength);
    apiKey.key = apiKey.keyPrefix;
    apiKey.plainKey = newKey;
    apiKey.lastUsedAt = null;
    apiKey.usageCount = 0;
    this.recordAudit(apiKey, 'rotated', 'API key rotated and reissued');
    this.apiKeys.set(keyId, apiKey);
    this.indexKey(apiKey);

    return {
      ...this.sanitizeApiKey(apiKey),
      key: newKey,
      plainKey: newKey,
    };
  }

  async getApiKeysForEnvironment(environmentId: string): Promise<ApiKey[]> {
    const keyIds = this.environmentKeys.get(environmentId) || [];
    return keyIds
      .map((id) => this.apiKeys.get(id))
      .filter((key): key is ApiKey => key !== undefined)
      .map((key) => this.sanitizeApiKey(key));
  }

  async updateApiKey(
    keyId: string,
    updates: Partial<Pick<ApiKey, 'name' | 'permissions' | 'rateLimit'>>
  ): Promise<ApiKey | null> {
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) return null;

    if (updates.name) apiKey.name = updates.name;
    if (updates.permissions) apiKey.permissions = updates.permissions;
    if (updates.rateLimit) apiKey.rateLimit = { ...apiKey.rateLimit, ...updates.rateLimit };

    this.apiKeys.set(keyId, apiKey);
    return this.sanitizeApiKey(apiKey);
  }

  async getApiKeyUsage(keyId: string): Promise<ApiKeyUsage | null> {
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) return null;

    return {
      keyId: apiKey.id,
      name: apiKey.name,
      lastUsedAt: apiKey.lastUsedAt,
      createdAt: apiKey.createdAt,
      status: apiKey.status,
      expiresAt: apiKey.expiresAt,
      usageCount: apiKey.usageCount ?? 0,
      auditLogCount: apiKey.auditLogs?.length ?? 0,
    } as ApiKeyUsage;
  }

  async getApiKeyAuditLog(keyId: string): Promise<ApiKeyAuditEntry[] | null> {
    const apiKey = this.apiKeys.get(keyId);
    return apiKey ? apiKey.auditLogs ?? [] : null;
  }

  private async hashKey(plainKey: string): Promise<string> {
    return bcrypt.hash(plainKey, this.hashCost);
  }

  private indexKey(apiKey: ApiKey): void {
    if (!apiKey.keyPrefix) {
      return;
    }

    const existing = this.prefixIndex.get(apiKey.keyPrefix) ?? new Set<string>();
    existing.add(apiKey.id);
    this.prefixIndex.set(apiKey.keyPrefix, existing);
  }

  private unindexKey(apiKey: ApiKey): void {
    if (!apiKey.keyPrefix) {
      return;
    }
    const set = this.prefixIndex.get(apiKey.keyPrefix);
    if (set) {
      set.delete(apiKey.id);
      if (set.size === 0) {
        this.prefixIndex.delete(apiKey.keyPrefix);
      }
    }
  }

  private async findApiKeyBySecret(secret: string): Promise<ApiKey | null> {
    const prefix = secret.substring(0, this.keyPrefixLength);
    const candidates = Array.from(this.prefixIndex.get(prefix) ?? []);

    for (const keyId of candidates) {
      const candidate = this.apiKeys.get(keyId);
      if (candidate && candidate.hashedKey) {
        if (await bcrypt.compare(secret, candidate.hashedKey)) {
          return candidate;
        }
      }
    }

    return null;
  }

  private sanitizeApiKey(apiKey: ApiKey, includePlainKey = false): ApiKey {
    const sanitized = { ...apiKey };
    if (!includePlainKey) {
      delete sanitized.plainKey;
    }
    delete sanitized.hashedKey;
    delete sanitized.auditLogs;
    return sanitized;
  }

  private createAuditEntry(event: ApiKeyAuditEntry['event'], message: string): ApiKeyAuditEntry {
    return {
      id: crypto.randomUUID(),
      apiKeyId: '',
      event,
      message,
      timestamp: new Date(),
    };
  }

  private recordAudit(apiKey: ApiKey, event: ApiKeyAuditEntry['event'], message: string): void {
    const entry: ApiKeyAuditEntry = {
      id: crypto.randomUUID(),
      apiKeyId: apiKey.id,
      event,
      message,
      timestamp: new Date(),
    };
    apiKey.auditLogs = [...(apiKey.auditLogs ?? []), entry];
  }

  private generateSecureKey(): string {
    const prefix = SANDBOX_CONSTANTS.API_KEY_PREFIX;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = randomBytes(48);
    let key = prefix;

    for (let i = 0; i < bytes.length; i += 1) {
      key += chars[bytes[i] % chars.length];
    }

    return key;
  }
}

export interface ApiKeyValidation {
  valid: boolean;
  apiKey?: ApiKey;
  error?: string;
}

export interface ApiKeyUsage {
  keyId: string;
  name: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  status: string;
  expiresAt: Date | null;
  usageCount?: number;
  auditLogCount?: number;
}
