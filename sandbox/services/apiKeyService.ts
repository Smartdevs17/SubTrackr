import { ApiKey, Permission, RateLimit } from '../types/sandbox';
import { SANDBOX_CONSTANTS, DEFAULT_RATE_LIMITS } from '../config/sandboxConfig';

export class ApiKeyService {
  private apiKeys: Map<string, ApiKey> = new Map();
  private environmentKeys: Map<string, string[]> = new Map();

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

    const key = this.generateSecureKey();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const apiKey: ApiKey = {
      id: crypto.randomUUID(),
      key,
      name,
      permissions,
      rateLimit: { ...DEFAULT_RATE_LIMITS, ...customRateLimit },
      expiresAt,
      lastUsedAt: null,
      createdAt: new Date(),
      status: 'active',
    };

    this.apiKeys.set(apiKey.id, apiKey);
    this.environmentKeys.set(environmentId, [...existingKeys, apiKey.id]);

    return apiKey;
  }

  async validateApiKey(key: string): Promise<ApiKeyValidation> {
    const apiKey = Array.from(this.apiKeys.values()).find((k) => k.key === key);

    if (!apiKey) {
      return { valid: false, error: 'API key not found' };
    }

    if (apiKey.status === 'revoked') {
      return { valid: false, error: 'API key has been revoked' };
    }

    if (apiKey.status === 'expired') {
      return { valid: false, error: 'API key has expired' };
    }

    if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
      apiKey.status = 'expired';
      this.apiKeys.set(apiKey.id, apiKey);
      return { valid: false, error: 'API key has expired' };
    }

    apiKey.lastUsedAt = new Date();
    this.apiKeys.set(apiKey.id, apiKey);

    return { valid: true, apiKey };
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
    this.apiKeys.set(keyId, apiKey);
    return true;
  }

  async rotateApiKey(keyId: string): Promise<ApiKey | null> {
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) return null;

    const newKey = this.generateSecureKey();
    apiKey.key = newKey;
    apiKey.lastUsedAt = null;
    this.apiKeys.set(keyId, apiKey);

    return apiKey;
  }

  async getApiKeysForEnvironment(environmentId: string): Promise<ApiKey[]> {
    const keyIds = this.environmentKeys.get(environmentId) || [];
    return keyIds
      .map((id) => this.apiKeys.get(id))
      .filter((key): key is ApiKey => key !== undefined);
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
    return apiKey;
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
    };
  }

  private generateSecureKey(): string {
    const prefix = SANDBOX_CONSTANTS.API_KEY_PREFIX;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = prefix;

    for (let i = 0; i < 48; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
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
}
