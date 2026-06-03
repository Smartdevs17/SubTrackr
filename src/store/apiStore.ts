import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ApiKey,
  ApiKeyStatus,
  ApiKeyScope,
  RateLimitConfig,
  UsageStats,
} from '../types/sandbox';

const STORAGE_KEY = 'subtrackr-api-keys';
const STORE_VERSION = 1;

const generateId = (): string =>
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const generateKeyString = (prefix = 'sk_'): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = prefix;
  for (let i = 0; i < 48; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
};

const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  free: { requestsPerMinute: 100, requestsPerHour: 1000, requestsPerDay: 10000, burstLimit: 10 },
  basic: { requestsPerMinute: 1000, requestsPerHour: 10000, requestsPerDay: 100000, burstLimit: 50 },
  pro: { requestsPerMinute: 10000, requestsPerHour: 100000, requestsPerDay: 1000000, burstLimit: 200 },
  enterprise: { requestsPerMinute: 100000, requestsPerHour: 1000000, requestsPerDay: 10000000, burstLimit: 1000 },
};

interface ApiKeyState {
  apiKeys: ApiKey[];
  usageLogs: Record<string, UsageStats[]>;
  isLoading: boolean;
  error: string | null;

  createApiKey: (name: string, tier: keyof typeof DEFAULT_RATE_LIMITS) => ApiKey;
  revokeApiKey: (keyId: string) => void;
  rotateApiKey: (keyId: string) => string | null;
  deleteApiKey: (keyId: string) => void;
  getApiKey: (keyId: string) => ApiKey | undefined;
  getActiveKeys: () => ApiKey[];
  getKeyStats: () => { total: number; active: number; revoked: number; expired: number };
  maskKey: (key: string) => string;
  logUsage: (keyId: string, endpoint: string, statusCode: number) => void;
  clearError: () => void;
}

export const useApiStore = create<ApiKeyState>()(
  persist(
    (set, get) => ({
      apiKeys: [],
      usageLogs: {},
      isLoading: false,
      error: null,

      createApiKey: (name: string, tier: keyof typeof DEFAULT_RATE_LIMITS) => {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
        const rateLimit = DEFAULT_RATE_LIMITS[tier];
        const key: ApiKey = {
          id: generateId(),
          key: generateKeyString(),
          name,
          status: ApiKeyStatus.ACTIVE,
          scopes: [ApiKeyScope.READ, ApiKeyScope.WRITE],
          permissions: ['read', 'write'],
          rateLimit,
          expiresAt,
          lastUsedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ apiKeys: [...state.apiKeys, key] }));
        return key;
      },

      revokeApiKey: (keyId: string) => {
        set((state) => ({
          apiKeys: state.apiKeys.map((k) =>
            k.id === keyId
              ? { ...k, status: ApiKeyStatus.REVOKED, updatedAt: new Date() }
              : k
          ),
        }));
      },

      rotateApiKey: (keyId: string) => {
        const key = get().apiKeys.find((k) => k.id === keyId);
        if (!key || key.status !== ApiKeyStatus.ACTIVE) return null;
        const newKey = generateKeyString();
        set((state) => ({
          apiKeys: state.apiKeys.map((k) =>
            k.id === keyId
              ? { ...k, key: newKey, lastUsedAt: null, updatedAt: new Date() }
              : k
          ),
        }));
        return newKey;
      },

      deleteApiKey: (keyId: string) => {
        set((state) => ({
          apiKeys: state.apiKeys.filter((k) => k.id !== keyId),
        }));
      },

      getApiKey: (keyId: string) => {
        return get().apiKeys.find((k) => k.id === keyId);
      },

      getActiveKeys: () => {
        return get().apiKeys.filter((k) => k.status === ApiKeyStatus.ACTIVE);
      },

      getKeyStats: () => {
        const keys = get().apiKeys;
        return {
          total: keys.length,
          active: keys.filter((k) => k.status === ApiKeyStatus.ACTIVE).length,
          revoked: keys.filter((k) => k.status === ApiKeyStatus.REVOKED).length,
          expired: keys.filter((k) => k.status === ApiKeyStatus.EXPIRED).length,
        };
      },

      maskKey: (key: string) => {
        if (key.length <= 16) return key;
        return `${key.slice(0, 12)}${'*'.repeat(key.length - 16)}${key.slice(-4)}`;
      },

      logUsage: (keyId: string, endpoint: string, statusCode: number) => {
        const now = new Date();
        const stats: UsageStats = {
          totalRequests: 1,
          successfulRequests: statusCode < 400 ? 1 : 0,
          failedRequests: statusCode >= 400 ? 1 : 0,
          averageResponseTime: 0,
          totalDataTransferred: 0,
          periodStart: now,
          periodEnd: now,
        };
        set((state) => ({
          usageLogs: {
            ...state.usageLogs,
            [keyId]: [...(state.usageLogs[keyId] || []), stats],
          },
        }));
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
