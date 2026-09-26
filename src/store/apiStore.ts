import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import {
  ApiKey,
  ApiKeyStatus,
  ApiKeyScope,
  ApiKeyAuditEntry,
  RateLimitConfig,
  UsageStats,
} from '../types/sandbox';

const STORAGE_KEY = 'subtrackr-api-keys';
const STORE_VERSION = 2;

// ─── helpers ────────────────────────────────────────────────────────────────

const generateId = (): string =>
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Generates a cryptographically-random API key string.
 * Uses `crypto.getRandomValues` when available (React-Native ≥ 0.72 / Expo
 * ships a polyfill) and falls back to `Math.random` for older environments.
 */
const generateKeyString = (prefix = 'sk_live_'): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const length = 48;
  let key = prefix;

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    for (let i = 0; i < length; i++) {
      key += chars[bytes[i] % chars.length];
    }
  } else {
    for (let i = 0; i < length; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  return key;
};

const makeAuditEntry = (
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

const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  free: { requestsPerMinute: 100, requestsPerHour: 1000, requestsPerDay: 10_000, burstLimit: 10 },
  basic: { requestsPerMinute: 1_000, requestsPerHour: 10_000, requestsPerDay: 100_000, burstLimit: 50 },
  pro: { requestsPerMinute: 10_000, requestsPerHour: 100_000, requestsPerDay: 1_000_000, burstLimit: 200 },
  enterprise: { requestsPerMinute: 100_000, requestsPerHour: 1_000_000, requestsPerDay: 10_000_000, burstLimit: 1_000 },
};

export const TIER_LABELS: Record<string, { label: string; desc: string }> = {
  free:       { label: 'Free',       desc: '100 req/min · 10K/day' },
  basic:      { label: 'Basic',      desc: '1K req/min · 100K/day' },
  pro:        { label: 'Pro',        desc: '10K req/min · 1M/day' },
  enterprise: { label: 'Enterprise', desc: '100K req/min · 10M/day' },
};

export const ALL_SCOPES: ApiKeyScope[] = [
  ApiKeyScope.READ,
  ApiKeyScope.WRITE,
  ApiKeyScope.ADMIN,
  ApiKeyScope.WEBHOOKS,
  ApiKeyScope.ANALYTICS,
];

// ─── types ───────────────────────────────────────────────────────────────────

export interface KeyUsageSummary {
  keyId: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
}

interface ApiKeyState {
  apiKeys: ApiKey[];
  usageLogs: Record<string, UsageStats[]>;
  isLoading: boolean;
  error: string | null;

  // CRUD
  createApiKey: (name: string, tier: keyof typeof DEFAULT_RATE_LIMITS, description?: string) => ApiKey;
  revokeApiKey:  (keyId: string) => void;
  rotateApiKey:  (keyId: string) => string | null;
  deleteApiKey:  (keyId: string) => void;

  // Getters
  getApiKey:    (keyId: string) => ApiKey | undefined;
  getActiveKeys: () => ApiKey[];
  getKeyStats:  () => { total: number; active: number; revoked: number; expired: number };
  getKeyAuditLog: (keyId: string) => ApiKeyAuditEntry[];
  getKeyUsageSummary: (keyId: string) => KeyUsageSummary;

  // Updates
  updateKeyPermissions: (keyId: string, scopes: ApiKeyScope[]) => boolean;
  updateKeyExpiry:      (keyId: string, expiresAt: Date | null) => boolean;
  updateKeyDescription: (keyId: string, description: string) => boolean;

  // Utilities
  maskKey:   (key: string) => string;
  logUsage:  (keyId: string, endpoint: string, statusCode: number) => void;
  clearError: () => void;
}

// ─── store ───────────────────────────────────────────────────────────────────

export const useApiStore = create<ApiKeyState>()(
  persist(
    (set, get) => ({
      apiKeys: [],
      usageLogs: {},
      isLoading: false,
      error: null,

      // ── CRUD ──────────────────────────────────────────────────────────────

      createApiKey: (name, tier, description) => {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000);
        const rateLimit = DEFAULT_RATE_LIMITS[tier] ?? DEFAULT_RATE_LIMITS.free;
        const id = generateId();
        const rawKey = generateKeyString();

        const key: ApiKey = {
          id,
          key: rawKey,
          name,
          description,
          status: ApiKeyStatus.ACTIVE,
          scopes: [ApiKeyScope.READ, ApiKeyScope.WRITE],
          permissions: ['read', 'write'],
          rateLimit,
          expiresAt,
          lastUsedAt: null,
          usageCount: 0,
          auditLogs: [makeAuditEntry(id, 'created', `API key "${name}" created with ${tier} tier`)],
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({ apiKeys: [...state.apiKeys, key] }));
        return key;
      },

      revokeApiKey: (keyId) => {
        set((state) => ({
          apiKeys: state.apiKeys.map((k) => {
            if (k.id !== keyId) return k;
            return {
              ...k,
              status: ApiKeyStatus.REVOKED,
              updatedAt: new Date(),
              auditLogs: [
                ...(k.auditLogs ?? []),
                makeAuditEntry(k.id, 'revoked', 'Key revoked by user'),
              ],
            };
          }),
        }));
      },

      /**
       * Rotates the key secret for an active key.
       * Returns the new plain-text key string (shown once), or null if the key
       * is not found / not active.
       */
      rotateApiKey: (keyId) => {
        const key = get().apiKeys.find((k) => k.id === keyId);
        if (!key || key.status !== ApiKeyStatus.ACTIVE) return null;

        const newRawKey = generateKeyString();

        set((state) => ({
          apiKeys: state.apiKeys.map((k) => {
            if (k.id !== keyId) return k;
            return {
              ...k,
              key: newRawKey,
              lastUsedAt: null,
              usageCount: 0,
              updatedAt: new Date(),
              auditLogs: [
                ...(k.auditLogs ?? []),
                makeAuditEntry(k.id, 'rotated', 'Key rotated — previous secret invalidated'),
              ],
            };
          }),
        }));

        return newRawKey;
      },

      deleteApiKey: (keyId) => {
        set((state) => ({
          apiKeys: state.apiKeys.filter((k) => k.id !== keyId),
          usageLogs: Object.fromEntries(
            Object.entries(state.usageLogs).filter(([id]) => id !== keyId)
          ),
        }));
      },

      // ── Getters ───────────────────────────────────────────────────────────

      getApiKey: (keyId) => get().apiKeys.find((k) => k.id === keyId),

      getActiveKeys: () => get().apiKeys.filter((k) => k.status === ApiKeyStatus.ACTIVE),

      getKeyStats: () => {
        const keys = get().apiKeys;
        return {
          total:   keys.length,
          active:  keys.filter((k) => k.status === ApiKeyStatus.ACTIVE).length,
          revoked: keys.filter((k) => k.status === ApiKeyStatus.REVOKED).length,
          expired: keys.filter((k) => k.status === ApiKeyStatus.EXPIRED).length,
        };
      },

      getKeyAuditLog: (keyId) => {
        const key = get().apiKeys.find((k) => k.id === keyId);
        return [...(key?.auditLogs ?? [])].reverse(); // most-recent first
      },

      getKeyUsageSummary: (keyId) => {
        const logs = get().usageLogs[keyId] ?? [];
        return logs.reduce<KeyUsageSummary>(
          (acc, l) => ({
            keyId,
            totalRequests:      acc.totalRequests      + l.totalRequests,
            successfulRequests: acc.successfulRequests + l.successfulRequests,
            failedRequests:     acc.failedRequests     + l.failedRequests,
          }),
          { keyId, totalRequests: 0, successfulRequests: 0, failedRequests: 0 }
        );
      },

      // ── Updates ───────────────────────────────────────────────────────────

      updateKeyPermissions: (keyId, scopes) => {
        const key = get().apiKeys.find((k) => k.id === keyId);
        if (!key) return false;

        set((state) => ({
          apiKeys: state.apiKeys.map((k) => {
            if (k.id !== keyId) return k;
            return {
              ...k,
              scopes,
              permissions: scopes.map((s) => s.toString()),
              updatedAt: new Date(),
              auditLogs: [
                ...(k.auditLogs ?? []),
                makeAuditEntry(
                  k.id,
                  'validated',
                  `Scopes updated to: ${scopes.join(', ')}`
                ),
              ],
            };
          }),
        }));
        return true;
      },

      updateKeyExpiry: (keyId, expiresAt) => {
        const key = get().apiKeys.find((k) => k.id === keyId);
        if (!key) return false;

        set((state) => ({
          apiKeys: state.apiKeys.map((k) => {
            if (k.id !== keyId) return k;
            const label = expiresAt ? expiresAt.toLocaleDateString() : 'never';
            return {
              ...k,
              expiresAt,
              updatedAt: new Date(),
              auditLogs: [
                ...(k.auditLogs ?? []),
                makeAuditEntry(k.id, 'validated', `Expiry set to ${label}`),
              ],
            };
          }),
        }));
        return true;
      },

      updateKeyDescription: (keyId, description) => {
        const key = get().apiKeys.find((k) => k.id === keyId);
        if (!key) return false;

        set((state) => ({
          apiKeys: state.apiKeys.map((k) =>
            k.id !== keyId ? k : { ...k, description, updatedAt: new Date() }
          ),
        }));
        return true;
      },

      // ── Utilities ─────────────────────────────────────────────────────────

      maskKey: (key) => {
        if (key.length <= 16) return key;
        return `${key.slice(0, 12)}${'*'.repeat(Math.max(0, key.length - 16))}${key.slice(-4)}`;
      },

      logUsage: (keyId, _endpoint, statusCode) => {
        const now = new Date();
        const entry: UsageStats = {
          totalRequests:      1,
          successfulRequests: statusCode < 400 ? 1 : 0,
          failedRequests:     statusCode >= 400 ? 1 : 0,
          averageResponseTime: 0,
          totalDataTransferred: 0,
          periodStart: now,
          periodEnd:   now,
        };
        set((state) => ({
          apiKeys: state.apiKeys.map((k) =>
            k.id !== keyId ? k : { ...k, usageCount: (k.usageCount ?? 0) + 1, lastUsedAt: now }
          ),
          usageLogs: {
            ...state.usageLogs,
            [keyId]: [...(state.usageLogs[keyId] ?? []), entry],
          },
        }));
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => asyncStorageAdapter),
      migrate: (persistedState, version) => {
        // v1 → v2: no destructive change, just accept as-is
        if (version < 2) return persistedState as ApiKeyState;
        return persistedState as ApiKeyState;
      },
    }
  )
);
