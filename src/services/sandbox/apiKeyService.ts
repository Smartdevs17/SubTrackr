import AsyncStorage from '@react-native-async-storage/async-storage';
import bcrypt from 'bcryptjs';
import {
  ApiKey,
  ApiKeyStatus,
  SandboxEnvironment,
  ApiKeyAuditEntry,
} from '../../types/sandbox';

const API_KEYS_STORAGE_KEY = '@subtrackr_api_keys';
const KEY_PREFIX_LENGTH = 8;
const HASH_COST = 10;
const API_KEY_PREFIX = 'sk_sandbox_';

const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
};

const getRandomChars = (length: number): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const result: string[] = [];

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const values = crypto.getRandomValues(new Uint8Array(length));
    for (let i = 0; i < values.length; i += 1) {
      result.push(chars[values[i] % chars.length]);
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      result.push(chars.charAt(Math.floor(Math.random() * chars.length)));
    }
  }

  return result.join('');
};

const generateApiKey = (): string => {
  return `${API_KEY_PREFIX}${getRandomChars(48)}`;
};

const createAuditEntry = (
  apiKeyId: string,
  event: ApiKeyAuditEntry['event'],
  message: string
): ApiKeyAuditEntry => ({
  id: generateId(),
  apiKeyId,
  event,
  message,
  timestamp: new Date(),
});

class ApiKeyService {
  private static instance: ApiKeyService;
  private apiKeys: ApiKey[] = [];
  private fallbackHash = bcrypt.hashSync('fallback-placeholder', HASH_COST);

  private constructor() {
    this.loadKeys();
  }

  static getInstance(): ApiKeyService {
    if (!ApiKeyService.instance) {
      ApiKeyService.instance = new ApiKeyService();
    }
    return ApiKeyService.instance;
  }

  private async loadKeys(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(API_KEYS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.apiKeys = await Promise.all(
          parsed.map(async (key: Record<string, unknown>) => {
            const loadedKey = {
              ...key,
              createdAt: new Date(key.createdAt as string),
              updatedAt: new Date(key.updatedAt as string),
              lastUsedAt: key.lastUsedAt ? new Date(key.lastUsedAt as string) : null,
              expiresAt: key.expiresAt ? new Date(key.expiresAt as string) : null,
            } as ApiKey;

            if (!loadedKey.hashedKey && typeof loadedKey.key === 'string') {
              loadedKey.hashedKey = await bcrypt.hash(loadedKey.key, HASH_COST);
              loadedKey.keyPrefix = loadedKey.key.substring(0, KEY_PREFIX_LENGTH);
              loadedKey.key = loadedKey.keyPrefix;
              loadedKey.auditLogs = [
                createAuditEntry(
                  loadedKey.id,
                  'migration',
                  'Migrated a plaintext key to hashed storage'
                ),
              ];
            }

            loadedKey.auditLogs = loadedKey.auditLogs ?? [];
            loadedKey.usageCount = loadedKey.usageCount ?? 0;
            loadedKey.keyPrefix = loadedKey.keyPrefix ?? loadedKey.key.substring(0, KEY_PREFIX_LENGTH);
            return loadedKey;
          })
        );
        await this.saveKeys();
      }
    } catch {
      this.apiKeys = [];
    }
  }

  private async saveKeys(): Promise<void> {
    try {
      const payload = this.apiKeys.map((key) => {
        const record = { ...key } as Record<string, unknown>;
        delete record.plainKey;
        return record;
      });
      await AsyncStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to save API keys:', error);
    }
  }

  async createApiKey(
    developerId: string,
    name: string,
    environment: SandboxEnvironment = SandboxEnvironment.DEVELOPMENT,
    permissions: string[] = ['read', 'write']
  ): Promise<ApiKey> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const plainKey = generateApiKey();
    const hashedKey = await bcrypt.hash(plainKey, HASH_COST);
    const keyPrefix = plainKey.substring(0, KEY_PREFIX_LENGTH);

    const newKey: ApiKey = {
      id: generateId(),
      key: keyPrefix,
      keyPrefix,
      hashedKey,
      plainKey,
      name,
      developerId,
      environment,
      status: ApiKeyStatus.ACTIVE,
      permissions,
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerDay: 10000,
      },
      expiresAt,
      lastUsedAt: null,
      usageCount: 0,
      auditLogs: [createAuditEntry('', 'created', 'API key created')],
      createdAt: now,
      updatedAt: now,
    };

    newKey.auditLogs![0].apiKeyId = newKey.id;
    this.apiKeys.push(newKey);
    await this.saveKeys();

    return { ...this.sanitizeApiKey(newKey), key: plainKey, plainKey };
  }

  async revokeApiKey(keyId: string): Promise<boolean> {
    const key = this.apiKeys.find((k) => k.id === keyId);
    if (!key) return false;

    key.status = ApiKeyStatus.REVOKED;
    key.updatedAt = new Date();
    key.auditLogs = [
      ...(key.auditLogs ?? []),
      createAuditEntry(key.id, 'revoked', 'API key revoked immediately'),
    ];
    await this.saveKeys();
    return true;
  }

  async deleteApiKey(keyId: string): Promise<boolean> {
    const initialLength = this.apiKeys.length;
    this.apiKeys = this.apiKeys.filter((k) => k.id !== keyId);
    if (this.apiKeys.length < initialLength) {
      await this.saveKeys();
      return true;
    }
    return false;
  }

  getApiKey(keyId: string): ApiKey | null {
    return this.apiKeys.find((k) => k.id === keyId) ?? null;
  }

  getApiKeysByDeveloper(developerId: string): ApiKey[] {
    return this.apiKeys
      .filter((k) => k.developerId === developerId)
      .map((key) => this.sanitizeApiKey(key));
  }

  getActiveKeys(developerId: string): ApiKey[] {
    return this.apiKeys
      .filter((k) => k.developerId === developerId && k.status === ApiKeyStatus.ACTIVE)
      .map((key) => this.sanitizeApiKey(key));
  }

  async validateApiKey(key: string): Promise<{ valid: boolean; key?: ApiKey; reason?: string }> {
    const apiKey = await this.findApiKeyBySecret(key);
    if (!apiKey) {
      await bcrypt.compare(key, this.fallbackHash);
      return { valid: false, reason: 'API key not found' };
    }

    if (apiKey.status === ApiKeyStatus.REVOKED) {
      apiKey.auditLogs = [
        ...(apiKey.auditLogs ?? []),
        createAuditEntry(apiKey.id, 'revoked', 'Validation rejected for revoked API key'),
      ];
      await this.saveKeys();
      return { valid: false, reason: 'API key has been revoked' };
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      apiKey.status = ApiKeyStatus.EXPIRED;
      apiKey.updatedAt = new Date();
      apiKey.auditLogs = [
        ...(apiKey.auditLogs ?? []),
        createAuditEntry(apiKey.id, 'expired', 'API key expired during validation'),
      ];
      await this.saveKeys();
      return { valid: false, reason: 'API key has expired' };
    }

    apiKey.lastUsedAt = new Date();
    apiKey.updatedAt = new Date();
    apiKey.usageCount = (apiKey.usageCount ?? 0) + 1;
    apiKey.auditLogs = [
      ...(apiKey.auditLogs ?? []),
      createAuditEntry(apiKey.id, 'validated', `Validated key prefix ${apiKey.keyPrefix}`),
    ];
    await this.saveKeys();

    return { valid: true, key: this.sanitizeApiKey(apiKey) };
  }

  async updateKeyPermissions(keyId: string, permissions: string[]): Promise<boolean> {
    const key = this.apiKeys.find((k) => k.id === keyId);
    if (!key) return false;

    key.permissions = permissions;
    key.updatedAt = new Date();
    key.auditLogs = [
      ...(key.auditLogs ?? []),
      createAuditEntry(key.id, 'validated', 'API key permissions updated'),
    ];
    await this.saveKeys();
    return true;
  }

  async updateRateLimit(
    keyId: string,
    requestsPerMinute: number,
    requestsPerDay: number
  ): Promise<boolean> {
    const key = this.apiKeys.find((k) => k.id === keyId);
    if (!key) return false;

    key.rateLimit = { requestsPerMinute, requestsPerDay };
    key.updatedAt = new Date();
    await this.saveKeys();
    return true;
  }

  getKeyStats(developerId: string): {
    total: number;
    active: number;
    revoked: number;
    expired: number;
  } {
    const keys = this.getApiKeysByDeveloper(developerId);
    return {
      total: keys.length,
      active: keys.filter((k) => k.status === ApiKeyStatus.ACTIVE).length,
      revoked: keys.filter((k) => k.status === ApiKeyStatus.REVOKED).length,
      expired: keys.filter((k) => k.status === ApiKeyStatus.EXPIRED).length,
    };
  }

  maskApiKey(key: string): string {
    if (key.length <= 12) return key;
    return `${key.substring(0, 12)}${'*'.repeat(key.length - 16)}${key.substring(key.length - 4)}`;
  }

  async loadApiKeys(): Promise<void> {
    await this.loadKeys();
  }

  async rotateApiKey(keyId: string): Promise<ApiKey | null> {
    const key = this.apiKeys.find((k) => k.id === keyId);
    if (!key) return null;

    const plainKey = generateApiKey();
    key.hashedKey = await bcrypt.hash(plainKey, HASH_COST);
    key.keyPrefix = plainKey.substring(0, KEY_PREFIX_LENGTH);
    key.key = key.keyPrefix;
    key.plainKey = plainKey;
    key.updatedAt = new Date();
    key.lastUsedAt = null;
    key.usageCount = 0;
    key.auditLogs = [
      ...(key.auditLogs ?? []),
      createAuditEntry(key.id, 'rotated', 'API key rotated'),
    ];
    await this.saveKeys();

    return { ...this.sanitizeApiKey(key), key: plainKey, plainKey };
  }

  private async findApiKeyBySecret(secret: string): Promise<ApiKey | null> {
    const prefix = secret.substring(0, KEY_PREFIX_LENGTH);
    const candidates = this.apiKeys.filter((key) => key.keyPrefix === prefix && key.hashedKey);

    for (const candidate of candidates) {
      if (await bcrypt.compare(secret, candidate.hashedKey!)) {
        return candidate;
      }
    }

    return null;
  }

  private sanitizeApiKey(apiKey: ApiKey): ApiKey {
    const sanitized = { ...apiKey };
    delete sanitized.plainKey;
    delete sanitized.hashedKey;
    delete sanitized.auditLogs;
    return sanitized;
  }
}

export const apiKeyService = ApiKeyService.getInstance();
