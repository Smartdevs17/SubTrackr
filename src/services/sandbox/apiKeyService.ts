import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiKey, ApiKeyStatus, SandboxEnvironment } from '../../types/sandbox';

const API_KEYS_STORAGE_KEY = '@subtrackr_api_keys';

const generateApiKey = (): string => {
  const prefix = 'sk_sandbox_';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = prefix;
  for (let i = 0; i < 48; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
};

class ApiKeyService {
  private static instance: ApiKeyService;
  private apiKeys: ApiKey[] = [];

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
        this.apiKeys = parsed.map((key: Record<string, unknown>) => ({
          ...key,
          createdAt: new Date(key.createdAt as string),
          updatedAt: new Date(key.updatedAt as string),
          lastUsedAt: key.lastUsedAt ? new Date(key.lastUsedAt as string) : null,
          expiresAt: key.expiresAt ? new Date(key.expiresAt as string) : null,
        }));
      }
    } catch {
      this.apiKeys = [];
    }
  }

  private async saveKeys(): Promise<void> {
    try {
      await AsyncStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(this.apiKeys));
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

    const newKey: ApiKey = {
      id: generateId(),
      key: generateApiKey(),
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
      createdAt: now,
      updatedAt: now,
    };

    this.apiKeys.push(newKey);
    await this.saveKeys();
    return newKey;
  }

  async revokeApiKey(keyId: string): Promise<boolean> {
    const key = this.apiKeys.find((k) => k.id === keyId);
    if (!key) return false;

    key.status = ApiKeyStatus.REVOKED;
    key.updatedAt = new Date();
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
    return this.apiKeys.filter((k) => k.developerId === developerId);
  }

  getActiveKeys(developerId: string): ApiKey[] {
    return this.apiKeys.filter(
      (k) => k.developerId === developerId && k.status === ApiKeyStatus.ACTIVE
    );
  }

  async validateApiKey(key: string): Promise<{ valid: boolean; key?: ApiKey; reason?: string }> {
    const foundKey = this.apiKeys.find((k) => k.key === key);

    if (!foundKey) {
      return { valid: false, reason: 'API key not found' };
    }

    if (foundKey.status === ApiKeyStatus.REVOKED) {
      return { valid: false, reason: 'API key has been revoked' };
    }

    if (foundKey.expiresAt && new Date(foundKey.expiresAt) < new Date()) {
      foundKey.status = ApiKeyStatus.EXPIRED;
      foundKey.updatedAt = new Date();
      await this.saveKeys();
      return { valid: false, reason: 'API key has expired' };
    }

    foundKey.lastUsedAt = new Date();
    foundKey.updatedAt = new Date();
    await this.saveKeys();

    return { valid: true, key: foundKey };
  }

  async updateKeyPermissions(keyId: string, permissions: string[]): Promise<boolean> {
    const key = this.apiKeys.find((k) => k.id === keyId);
    if (!key) return false;

    key.permissions = permissions;
    key.updatedAt = new Date();
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
}

export const apiKeyService = ApiKeyService.getInstance();
