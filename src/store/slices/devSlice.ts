/**
 * Dev Slice – sandbox environment and developer portal.
 */
import type { StateCreator } from 'zustand';
import { SandboxConfig, SandboxEnvironment, SandboxStatus, DeveloperProfile, DeveloperOnboardingStep, OnboardingStepInfo, ApiKey, ApiKeyStatus, ApiKeyScope, TestSubscription, SandboxMetrics, IntegrationGuide, IntegrationGuideCategory } from '../../types/sandbox';
import { DeveloperProfile as DevProfile, ApiKey as DevApiKey, ApiKeyPermission, ApiKeyStatus as DevApiKeyStatus, UsageStats, UsageRecord, OnboardingStep as DevOnboardingStep, DocumentationSection, IntegrationGuide as DevIntegrationGuide } from '../../types/developerPortal';
import { AppError, errorHandler } from '../../services/errorHandler';

// ── Interfaces ──────────────────────────────────────────────────────────

export interface SandboxSlice {
  sandboxes: SandboxConfig[];
  currentSandbox: SandboxConfig | null;
  selectedSandbox: SandboxConfig | null;
  sandboxConfig: SandboxConfig;
  sandboxSubscriptions: TestSubscription[];
  sandboxTransactions: Array<{ id: string; type: string; amount: number; status: string; timestamp: Date }>;
  sandboxMetrics: SandboxMetrics;
  sandboxLoading: boolean;
  sandboxError: AppError | null;
  fetchSandboxes: (developerId: string) => Promise<void>;
  createSandbox: (name: string, description: string, environment: SandboxEnvironment) => Promise<void>;
  selectSandbox: (sandbox: SandboxConfig | string) => void;
  deleteSandbox: (id: string) => Promise<void>;
  pauseSandbox: (id: string) => Promise<void>;
  resumeSandbox: (id: string) => Promise<void>;
  toggleSandboxStatus: (id: string) => Promise<void>;
  generateTestData: (config?: { subscriptionCount?: number; transactionCount?: number }) => Promise<void>;
  resetSandboxData: () => void;
  refreshSandboxMetrics: () => Promise<void>;
  initializeSandbox: () => void;
  addTestSubscription: (name: string, price: number) => void;
  removeTestSubscription: (id: string) => void;
  clearSandboxError: () => void;
}

export interface DeveloperPortalSlice {
  devPortalDeveloper: DevProfile | null;
  devPortalApiKeys: DevApiKey[];
  devPortalUsageStats: UsageStats | null;
  devPortalRecentUsage: UsageRecord[];
  devPortalOnboardingSteps: DevOnboardingStep[];
  devPortalDocumentation: DocumentationSection[];
  devPortalIntegrationGuides: DevIntegrationGuide[];
  devPortalLoading: boolean;
  devPortalError: AppError | null;
  registerDeveloper: (email: string, name: string, company?: string, website?: string) => Promise<void>;
  fetchDeveloper: (developerId: string) => Promise<void>;
  updateDeveloper: (updates: Partial<DevProfile>) => Promise<void>;
  fetchApiKeys: (developerId: string) => Promise<void>;
  createApiKey: (developerId: string, name: string, permissions?: ApiKeyPermission[], options?: { rateLimit?: number; dailyLimit?: number; expiresAt?: Date }) => Promise<DevApiKey>;
  revokeApiKey: (keyId: string) => Promise<void>;
  rotateApiKey: (keyId: string) => Promise<void>;
  deleteApiKey: (keyId: string) => Promise<void>;
  fetchUsageStats: (developerId: string, period: { start: Date; end: Date }) => Promise<void>;
  fetchRecentUsage: (developerId: string, limit?: number) => Promise<void>;
  fetchOnboardingSteps: (developerId: string) => Promise<void>;
  completeOnboardingStep: (developerId: string, stepId: string) => Promise<void>;
  fetchDocumentation: () => void;
  searchDocumentation: (query: string) => void;
  fetchIntegrationGuides: () => void;
  searchIntegrationGuides: (query: string) => void;
  clearDevError: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const generateId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_RATE_LIMIT = { requestsPerMinute: 60, requestsPerHour: 1000, requestsPerDay: 10000, burstLimit: 10 };

type DevStore = SandboxSlice & DeveloperPortalSlice;
type DevCreator = StateCreator<DevStore & any, [], [], DevStore>;

// ═══════════════════════════════════════════════════════════════════════════
// Slice Factory
// ═══════════════════════════════════════════════════════════════════════════

export const createDevSlice: DevCreator = (set, get) => ({
  // ── Sandbox state ────────────────────────────────────────────────
  sandboxes: [],
  currentSandbox: null,
  selectedSandbox: null,
  sandboxConfig: { id: generateId('sandbox'), environment: SandboxEnvironment.DEVELOPMENT, name: 'Development Sandbox', description: 'Primary sandbox', isActive: true, dataIsolation: true, rateLimit: DEFAULT_RATE_LIMIT, createdAt: new Date(), updatedAt: new Date() } as SandboxConfig,
  sandboxSubscriptions: [],
  sandboxTransactions: [],
  sandboxMetrics: { totalSubscriptions: 0, totalTransactions: 0, totalVolume: 0, totalApiCalls: 0 },
  sandboxLoading: false,
  sandboxError: null,

  fetchSandboxes: async (_developerId) => {
    try {
      set({ sandboxLoading: true, sandboxError: null });
      const { sandboxes } = get();
      if (sandboxes.length > 0) {
        const active = sandboxes.find((s) => s.isActive) || sandboxes[0];
        set({ currentSandbox: active });
      }
      set({ sandboxLoading: false });
    } catch (err) {
      set({ sandboxError: errorHandler.handleError(err as Error, { action: 'fetchSandboxes' }), sandboxLoading: false });
    }
  },

  createSandbox: async (name, description, environment) => {
    try {
      set({ sandboxLoading: true, sandboxError: null });
      const sandbox: SandboxConfig = { id: generateId('sandbox'), environment, name, description, isActive: true, status: SandboxStatus.ACTIVE, dataIsolation: true, rateLimit: DEFAULT_RATE_LIMIT, createdAt: new Date(), updatedAt: new Date() };
      set((s) => ({ sandboxes: [...s.sandboxes, sandbox], currentSandbox: s.currentSandbox || sandbox, sandboxLoading: false }));
    } catch (err) {
      set({ sandboxError: errorHandler.handleError(err as Error, { action: 'createSandbox' }), sandboxLoading: false });
    }
  },

  selectSandbox: (sandboxOrId) => {
    const sandbox = typeof sandboxOrId === 'string' ? get().sandboxes.find((s) => s.id === sandboxOrId) || null : sandboxOrId;
    set({ selectedSandbox: sandbox, currentSandbox: sandbox });
  },

  deleteSandbox: async (id) => {
    set((s) => {
      const remaining = s.sandboxes.filter((sb) => sb.id !== id);
      return { sandboxes: remaining, currentSandbox: s.currentSandbox?.id === id ? remaining[0] || null : s.currentSandbox, selectedSandbox: s.selectedSandbox?.id === id ? null : s.selectedSandbox };
    });
  },

  pauseSandbox: async (id) => {
    set((s) => ({ sandboxes: s.sandboxes.map((sb) => sb.id === id ? { ...sb, isActive: false, status: SandboxStatus.PAUSED, updatedAt: new Date() } : sb), currentSandbox: s.currentSandbox?.id === id ? { ...s.currentSandbox, isActive: false } : s.currentSandbox }));
  },

  resumeSandbox: async (id) => {
    set((s) => ({ sandboxes: s.sandboxes.map((sb) => sb.id === id ? { ...sb, isActive: true, status: SandboxStatus.ACTIVE, updatedAt: new Date() } : sb), currentSandbox: s.currentSandbox?.id === id ? { ...s.currentSandbox, isActive: true } : s.currentSandbox }));
  },

  toggleSandboxStatus: async (id) => {
    const sandbox = get().sandboxes.find((s) => s.id === id);
    if (!sandbox) return;
    if (sandbox.isActive) await get().pauseSandbox(id); else await get().resumeSandbox(id);
  },

  generateTestData: async (_config) => {
    try {
      set({ sandboxLoading: true, sandboxError: null });
      const names = ['Netflix', 'Spotify', 'Adobe CC', 'Slack Pro', 'GitHub Team', 'Figma Pro'];
      const prices = [15.99, 9.99, 54.99, 8.75, 4.0, 12.0];
      const testSubs: TestSubscription[] = names.map((name, i) => ({ id: generateId('test_sub'), name, price: prices[i], currency: 'USD', status: 'active', billingCycle: 'monthly', nextBillingDate: new Date(Date.now() + (i + 1) * 30 * 24 * 60 * 60 * 1000), createdAt: new Date() } as TestSubscription));
      set({ sandboxSubscriptions: testSubs, sandboxMetrics: { totalSubscriptions: testSubs.length, totalTransactions: 0, totalVolume: 0, totalApiCalls: 100 }, sandboxLoading: false });
    } catch (err) {
      set({ sandboxError: errorHandler.handleError(err as Error, { action: 'generateTestData' }), sandboxLoading: false });
    }
  },

  resetSandboxData: () => set({ sandboxSubscriptions: [], sandboxTransactions: [], sandboxMetrics: { totalSubscriptions: 0, totalTransactions: 0, totalVolume: 0, totalApiCalls: 0 } }),
  refreshSandboxMetrics: async () => {
    const { sandboxSubscriptions, sandboxTransactions } = get();
    set({ sandboxMetrics: { totalSubscriptions: sandboxSubscriptions.length, totalTransactions: sandboxTransactions.length, totalVolume: sandboxTransactions.reduce((sum, t) => sum + t.amount, 0), totalApiCalls: get().sandboxMetrics.totalApiCalls } });
  },
  initializeSandbox: () => {
    const { sandboxes, sandboxSubscriptions } = get();
    if (sandboxes.length === 0) {
      const defaultSandbox: SandboxConfig = { id: generateId('sandbox'), environment: SandboxEnvironment.DEVELOPMENT, name: 'Development Sandbox', description: 'Primary sandbox', isActive: true, status: SandboxStatus.ACTIVE, dataIsolation: true, rateLimit: DEFAULT_RATE_LIMIT, createdAt: new Date(), updatedAt: new Date() };
      set({ sandboxes: [defaultSandbox], currentSandbox: defaultSandbox });
    }
    if (sandboxSubscriptions.length === 0) get().generateTestData();
  },
  addTestSubscription: (name, price) => {
    const sub: TestSubscription = { id: generateId('test_sub'), name, price, currency: 'USD', status: 'active', billingCycle: 'monthly', nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), createdAt: new Date() } as TestSubscription;
    set((s) => ({ sandboxSubscriptions: [...s.sandboxSubscriptions, sub] }));
  },
  removeTestSubscription: (id) => set((s) => ({ sandboxSubscriptions: s.sandboxSubscriptions.filter((sb) => sb.id !== id) })),
  clearSandboxError: () => set({ sandboxError: null }),

  // ── Developer Portal state ───────────────────────────────────────
  devPortalDeveloper: null,
  devPortalApiKeys: [],
  devPortalUsageStats: null,
  devPortalRecentUsage: [],
  devPortalOnboardingSteps: [],
  devPortalDocumentation: [],
  devPortalIntegrationGuides: [],
  devPortalLoading: false,
  devPortalError: null,

  registerDeveloper: async (_email, _name, _company, _website) => {
    set({ devPortalLoading: true, devPortalError: null });
    try {
      set({ devPortalLoading: false });
    } catch (error) {
      set({ devPortalError: errorHandler.handleError(error as Error, { action: 'registerDeveloper' }), devPortalLoading: false });
    }
  },

  fetchDeveloper: async (_developerId) => {
    set({ devPortalLoading: true, devPortalError: null });
    try {
      set({ devPortalLoading: false });
    } catch (error) {
      set({ devPortalError: errorHandler.handleError(error as Error, { action: 'fetchDeveloper' }), devPortalLoading: false });
    }
  },

  updateDeveloper: async (_updates) => {
    set({ devPortalLoading: true, devPortalError: null });
    try { set({ devPortalLoading: false }); } catch (error) { set({ devPortalError: errorHandler.handleError(error as Error, { action: 'updateDeveloper' }), devPortalLoading: false }); }
  },

  fetchApiKeys: async (_developerId) => {
    set({ devPortalLoading: true, devPortalError: null });
    try { set({ devPortalLoading: false }); } catch (error) { set({ devPortalError: errorHandler.handleError(error as Error, { action: 'fetchApiKeys' }), devPortalLoading: false }); }
  },

  createApiKey: async (_developerId, _name, _permissions, _options) => {
    set({ devPortalLoading: true, devPortalError: null });
    try {
      const apiKey: DevApiKey = { id: generateId('key'), key: `sk_test_${generateId('')}`, name: _name, status: DevApiKeyStatus.ACTIVE, createdAt: new Date(), expiresAt: null, lastUsedAt: null } as DevApiKey;
      set((s) => ({ devPortalApiKeys: [...s.devPortalApiKeys, apiKey], devPortalLoading: false }));
      return apiKey;
    } catch (error) {
      const appError = errorHandler.handleError(error as Error, { action: 'createApiKey' });
      set({ devPortalError: appError, devPortalLoading: false });
      throw appError;
    }
  },

  revokeApiKey: async (keyId) => set((s) => ({ devPortalApiKeys: s.devPortalApiKeys.map((k) => k.id === keyId ? { ...k, status: DevApiKeyStatus.REVOKED } : k) })),
  rotateApiKey: async (_keyId) => {},
  deleteApiKey: async (keyId) => set((s) => ({ devPortalApiKeys: s.devPortalApiKeys.filter((k) => k.id !== keyId) })),

  fetchUsageStats: async (_developerId, _period) => {
    set({ devPortalLoading: true, devPortalError: null });
    try { set({ devPortalLoading: false }); } catch (error) { set({ devPortalError: errorHandler.handleError(error as Error, { action: 'fetchUsageStats' }), devPortalLoading: false }); }
  },

  fetchRecentUsage: async (_developerId, _limit) => {
    set({ devPortalLoading: true, devPortalError: null });
    try { set({ devPortalLoading: false }); } catch (error) { set({ devPortalError: errorHandler.handleError(error as Error, { action: 'fetchRecentUsage' }), devPortalLoading: false }); }
  },

  fetchOnboardingSteps: async (_developerId) => {},
  completeOnboardingStep: async (_developerId, _stepId) => {},
  fetchDocumentation: () => {},
  searchDocumentation: (_query) => {},
  fetchIntegrationGuides: () => {},
  searchIntegrationGuides: (_query) => {},
  clearDevError: () => set({ devPortalError: null }),
});
