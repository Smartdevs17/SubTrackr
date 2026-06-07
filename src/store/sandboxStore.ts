import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import bcrypt from 'bcryptjs';
import {
  SandboxConfig,
  SandboxEnvironment,
  SandboxStatus,
  DeveloperProfile,
  DeveloperOnboardingStep,
  OnboardingStepInfo,
  ApiKey,
  ApiKeyStatus,
  ApiKeyScope,
  UsageStats,
  UsageMetric,
  TestSubscription,
  SandboxMetrics,
  IntegrationGuide,
  IntegrationGuideCategory,
  ApiKeyAuditEntry,
} from '../types/sandbox';
import { AppError, errorHandler } from '../services/errorHandler';

const STORAGE_KEY = 'subtrackr-sandbox';
const STORE_VERSION = 3;
const API_KEY_PREFIX = 'sk_sandbox_';
const KEY_PREFIX_LENGTH = 8;
const HASH_COST = 10;
const _FALLBACK_HASH = bcrypt.hashSync('fallback-placeholder', HASH_COST);

const generateId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const getRandomChars = (length: number): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
    ? crypto.getRandomValues(new Uint8Array(length))
    : null;
  let result = '';

  if (values) {
    for (let i = 0; i < values.length; i += 1) {
      result += chars[values[i] % chars.length];
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }

  return result;
};

const generateApiKeyString = (): string => {
  return `${API_KEY_PREFIX}${getRandomChars(48)}`;
};

const createAuditEntry = (
  apiKeyId: string,
  event: ApiKeyAuditEntry['event'],
  message: string
): ApiKeyAuditEntry => ({
  id: generateId('audit'),
  apiKeyId,
  event,
  message,
  timestamp: new Date(),
});

const hashApiKey = async (plaintext: string): Promise<string> => bcrypt.hash(plaintext, HASH_COST);

const migrateStoredApiKeys = async (keys: ApiKey[]): Promise<ApiKey[]> => {
  return Promise.all(
    keys.map(async (key) => {
      if (!key.hashedKey && key.key.startsWith(API_KEY_PREFIX) && key.key.length > KEY_PREFIX_LENGTH) {
        const hashedKey = await hashApiKey(key.key);
        return {
          ...key,
          hashedKey,
          keyPrefix: key.key.substring(0, KEY_PREFIX_LENGTH),
          key: key.key.substring(0, KEY_PREFIX_LENGTH),
          usageCount: key.usageCount ?? 0,
          auditLogs: [
            ...(key.auditLogs ?? []),
            createAuditEntry(key.id, 'migration', 'Migrated stored plaintext API key to hashed storage'),
          ],
        };
      }

      return {
        ...key,
        keyPrefix: key.keyPrefix ?? key.key.substring(0, KEY_PREFIX_LENGTH),
        usageCount: key.usageCount ?? 0,
        auditLogs: key.auditLogs ?? [],
      };
    })
  );
};

const DEFAULT_RATE_LIMIT = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  burstLimit: 10,
};

const DEFAULT_ONBOARDING_STEPS: OnboardingStepInfo[] = [
  {
    id: DeveloperOnboardingStep.WELCOME,
    title: 'Welcome',
    description: 'Learn about the developer portal',
    step: DeveloperOnboardingStep.WELCOME,
    completed: false,
    required: true,
  },
  {
    id: DeveloperOnboardingStep.CREATE_ACCOUNT,
    title: 'Create Account',
    description: 'Set up your developer profile',
    step: DeveloperOnboardingStep.CREATE_ACCOUNT,
    completed: false,
    required: true,
  },
  {
    id: DeveloperOnboardingStep.GENERATE_API_KEY,
    title: 'Generate API Key',
    description: 'Create your sandbox API key',
    step: DeveloperOnboardingStep.GENERATE_API_KEY,
    completed: false,
    required: true,
  },
  {
    id: DeveloperOnboardingStep.EXPLORE_SANDBOX,
    title: 'Explore Sandbox',
    description: 'Test the sandbox environment',
    step: DeveloperOnboardingStep.EXPLORE_SANDBOX,
    completed: false,
    required: false,
  },
  {
    id: DeveloperOnboardingStep.BUILD_INTEGRATION,
    title: 'Build Integration',
    description: 'Build your integration',
    step: DeveloperOnboardingStep.BUILD_INTEGRATION,
    completed: false,
    required: false,
  },
  {
    id: DeveloperOnboardingStep.GO_LIVE,
    title: 'Go Live',
    description: 'Switch to production',
    step: DeveloperOnboardingStep.GO_LIVE,
    completed: false,
    required: false,
  },
];

const DEFAULT_INTEGRATION_GUIDES: IntegrationGuide[] = [
  {
    id: 'guide-getting-started',
    title: 'Getting Started with SubTrackr API',
    description: 'Set up your environment and make your first API call',
    category: IntegrationGuideCategory.GETTING_STARTED,
    difficulty: 'beginner',
    estimatedTime: '15 minutes',
    steps: [
      {
        title: 'Install SDK',
        content: 'npm install @subtrackr/sdk',
        codeExample: 'npm install @subtrackr/sdk',
        language: 'bash',
      },
      {
        title: 'Initialize Client',
        content: 'Create a SubTrackr client with your API key.',
        codeExample: `const client = new SubTrackr({\n  apiKey: 'sk_sandbox_your_key',\n});`,
        language: 'typescript',
      },
      {
        title: 'Make First Request',
        content: 'List subscriptions to verify setup.',
        codeExample: `const subs = await client.subscriptions.list();\nconsole.log(subs.data);`,
        language: 'typescript',
      },
    ],
    tags: ['setup', 'quickstart'],
    isCompleted: false,
  },
  {
    id: 'guide-subscription-management',
    title: 'Managing Subscriptions',
    description: 'Create, update, and manage subscriptions programmatically',
    category: IntegrationGuideCategory.SUBSCRIPTION_MANAGEMENT,
    difficulty: 'intermediate',
    estimatedTime: '30 minutes',
    steps: [
      {
        title: 'Create Subscription',
        content: 'Use POST to create subscriptions.',
        codeExample: `const sub = await client.subscriptions.create({\n  name: 'Pro Plan',\n  price: 29.99,\n  currency: 'USD',\n  billingCycle: 'monthly',\n});`,
        language: 'typescript',
      },
      { title: 'Update Status', content: 'Pause, resume, or cancel subscriptions.' },
    ],
    tags: ['subscriptions', 'billing'],
    isCompleted: false,
  },
  {
    id: 'guide-webhook-integration',
    title: 'Webhook Integration',
    description: 'Set up webhooks for real-time event notifications',
    category: IntegrationGuideCategory.WEBHOOK_INTEGRATION,
    difficulty: 'intermediate',
    estimatedTime: '25 minutes',
    steps: [
      { title: 'Register Endpoint', content: 'Register your server URL to receive events.' },
      { title: 'Verify Signatures', content: 'Verify HMAC signatures on webhook payloads.' },
    ],
    tags: ['webhooks', 'events'],
    isCompleted: false,
  },
  {
    id: 'guide-payment-processing',
    title: 'Payment Processing',
    description: 'Integrate crypto and traditional payment methods',
    category: IntegrationGuideCategory.PAYMENT_PROCESSING,
    difficulty: 'advanced',
    estimatedTime: '45 minutes',
    steps: [
      { title: 'Configure Gateway', content: 'Set up payment gateway credentials.' },
      { title: 'Process Crypto Payments', content: 'Integrate with Stellar and EVM chains.' },
    ],
    tags: ['payments', 'crypto'],
    isCompleted: false,
  },
  {
    id: 'guide-analytics-reporting',
    title: 'Analytics & Reporting',
    description: 'Access subscription analytics and generate reports',
    category: IntegrationGuideCategory.ANALYTICS_REPORTING,
    difficulty: 'intermediate',
    estimatedTime: '20 minutes',
    steps: [{ title: 'Fetch Analytics', content: 'Retrieve subscription metrics via API.' }],
    tags: ['analytics', 'reporting'],
    isCompleted: false,
  },
  {
    id: 'guide-advanced-features',
    title: 'Advanced Features',
    description: 'SLA monitoring, quota management, and enterprise features',
    category: IntegrationGuideCategory.ADVANCED_FEATURES,
    difficulty: 'advanced',
    estimatedTime: '60 minutes',
    steps: [
      { title: 'Configure SLA', content: 'Set up SLA targets and monitoring.' },
      { title: 'Manage Quotas', content: 'Define usage quotas for subscription tiers.' },
    ],
    tags: ['sla', 'quotas', 'enterprise'],
    isCompleted: false,
  },
];

interface SandboxState {
  sandboxes: SandboxConfig[];
  currentSandbox: SandboxConfig | null;
  selectedSandbox: SandboxConfig | null;
  sandboxConfig: SandboxConfig;
  developerProfile: DeveloperProfile | null;
  apiKeys: ApiKey[];
  usageStats: UsageStats | null;
  usageRecords: UsageMetric[];
  testSubscriptions: TestSubscription[];
  subscriptions: TestSubscription[];
  sandboxSubscriptions: TestSubscription[];
  transactions: {
    id: string;
    type: string;
    amount: number;
    status: string;
    timestamp: Date;
  }[];
  metrics: SandboxMetrics;
  onboardingSteps: OnboardingStepInfo[];
  integrationGuides: IntegrationGuide[];
  selectedGuide: IntegrationGuide | null;
  isLoading: boolean;
  error: AppError | null;

  fetchSandboxes: (developerId: string) => Promise<void>;
  createSandbox: (
    name: string,
    description: string,
    environment: SandboxEnvironment
  ) => Promise<void>;
  selectSandbox: (sandbox: SandboxConfig | string) => void;
  deleteSandbox: (id: string) => Promise<void>;
  pauseSandbox: (id: string) => Promise<void>;
  resumeSandbox: (id: string) => Promise<void>;
  toggleSandboxStatus: (id: string) => Promise<void>;
  generateTestData: (
    sandboxIdOrConfig?: string | { subscriptionCount?: number; transactionCount?: number }
  ) => Promise<void>;
  resetSandbox: () => void;
  resetTestData: () => void;
  refreshMetrics: () => Promise<void>;
  initializeSandbox: () => Promise<void>;
  initializeDeveloperPortal: () => Promise<void>;
  switchEnvironment: (env: SandboxEnvironment) => void;
  addTestSubscription: (name: string, price: number) => void;
  removeTestSubscription: (id: string) => void;
  completeOnboardingStep: (stepId: string) => void;
  createDeveloperProfile: (name: string, email: string, company?: string) => Promise<void>;
  generateApiKey: (name: string) => Promise<string>;
  createApiKey: (input: {
    name: string;
    description?: string;
    sandboxId: string;
    scopes: ApiKeyScope[];
  }) => Promise<void>;
  revokeApiKey: (id: string) => Promise<void>;
  reactivateApiKey: (id: string) => Promise<void>;
  deleteApiKey: (id: string) => Promise<void>;
  fetchUsageForSandbox: (sandboxId: string) => void;
  markGuideCompleted: (guideId: string) => void;
  clearError: () => void;
}

const defaultSandboxConfig: SandboxConfig = {
  id: generateId('sandbox'),
  environment: SandboxEnvironment.DEVELOPMENT,
  name: 'Development Sandbox',
  description: 'Primary sandbox for development and testing',
  status: SandboxStatus.ACTIVE,
  isActive: true,
  dataIsolation: true,
  rateLimit: DEFAULT_RATE_LIMIT,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const useSandboxStore = create<SandboxState>()(
  persist(
    (set, get) => ({
      sandboxes: [],
      currentSandbox: null,
      selectedSandbox: null,
      sandboxConfig: defaultSandboxConfig,
      developerProfile: null,
      apiKeys: [],
      usageStats: null,
      usageRecords: [],
      testSubscriptions: [],
      subscriptions: [],
      sandboxSubscriptions: [],
      transactions: [],
      metrics: { totalSubscriptions: 0, totalTransactions: 0, totalVolume: 0, totalApiCalls: 0 },
      onboardingSteps: DEFAULT_ONBOARDING_STEPS,
      integrationGuides: DEFAULT_INTEGRATION_GUIDES,
      selectedGuide: null,
      isLoading: false,
      error: null,

      fetchSandboxes: async (_developerId: string) => {
        try {
          set({ isLoading: true, error: null });
          const { sandboxes } = get();
          if (sandboxes.length > 0) {
            const active = sandboxes.find((s) => s.isActive) || sandboxes[0];
            set({ currentSandbox: active });
          }
          set({ isLoading: false });
        } catch (err) {
          set({
            error: errorHandler.handleError(err as Error, {
              action: 'fetchSandboxes',
              timestamp: new Date(),
            }),
            isLoading: false,
          });
        }
      },

      createSandbox: async (name, description, environment) => {
        try {
          set({ isLoading: true, error: null });
          const sandbox: SandboxConfig = {
            id: generateId('sandbox'),
            environment,
            name,
            description,
            isActive: true,
            status: SandboxStatus.ACTIVE,
            dataIsolation: true,
            rateLimit: DEFAULT_RATE_LIMIT,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          set((state) => ({
            sandboxes: [...state.sandboxes, sandbox],
            currentSandbox: state.currentSandbox || sandbox,
            isLoading: false,
          }));
        } catch (err) {
          set({
            error: errorHandler.handleError(err as Error, {
              action: 'createSandbox',
              timestamp: new Date(),
            }),
            isLoading: false,
          });
        }
      },

      selectSandbox: (sandboxOrId) => {
        const sandbox =
          typeof sandboxOrId === 'string'
            ? get().sandboxes.find((s) => s.id === sandboxOrId) || null
            : sandboxOrId;
        set({ selectedSandbox: sandbox, currentSandbox: sandbox });
      },

      deleteSandbox: async (id) => {
        set((state) => {
          const remaining = state.sandboxes.filter((s) => s.id !== id);
          return {
            sandboxes: remaining,
            currentSandbox:
              state.currentSandbox?.id === id ? remaining[0] || null : state.currentSandbox,
            selectedSandbox: state.selectedSandbox?.id === id ? null : state.selectedSandbox,
          };
        });
      },

      pauseSandbox: async (id) => {
        set((state) => ({
          sandboxes: state.sandboxes.map((s) =>
            s.id === id
              ? { ...s, isActive: false, status: SandboxStatus.PAUSED, updatedAt: new Date() }
              : s
          ),
          currentSandbox:
            state.currentSandbox?.id === id
              ? { ...state.currentSandbox, isActive: false, status: SandboxStatus.PAUSED }
              : state.currentSandbox,
        }));
      },

      resumeSandbox: async (id) => {
        set((state) => ({
          sandboxes: state.sandboxes.map((s) =>
            s.id === id
              ? { ...s, isActive: true, status: SandboxStatus.ACTIVE, updatedAt: new Date() }
              : s
          ),
          currentSandbox:
            state.currentSandbox?.id === id
              ? { ...state.currentSandbox, isActive: true, status: SandboxStatus.ACTIVE }
              : state.currentSandbox,
        }));
      },

      toggleSandboxStatus: async (id) => {
        const sandbox = get().sandboxes.find((s) => s.id === id);
        if (!sandbox) return;
        if (sandbox.isActive) {
          await get().pauseSandbox(id);
        } else {
          await get().resumeSandbox(id);
        }
      },

      generateTestData: async (
        sandboxIdOrConfig?: string | { subscriptionCount?: number; transactionCount?: number }
      ) => {
        try {
          set({ isLoading: true, error: null });
          const count =
            typeof sandboxIdOrConfig === 'object' ? sandboxIdOrConfig.subscriptionCount || 8 : 8;
          const names = [
            'Netflix',
            'Spotify',
            'Adobe CC',
            'Slack Pro',
            'GitHub Team',
            'Figma Pro',
            'Notion Plus',
            'Vercel Pro',
          ];
          const prices = [15.99, 9.99, 54.99, 8.75, 4.0, 12.0, 10.0, 20.0];
          const subCount = Math.min(count, names.length);

          const testSubs: TestSubscription[] = names.slice(0, subCount).map((name, i) => ({
            id: generateId('test_sub'),
            name,
            price: prices[i],
            currency: 'USD',
            status: i < Math.floor(subCount * 0.75) ? 'active' : 'paused',
            billingCycle: 'monthly',
            nextBillingDate: new Date(Date.now() + (i + 1) * 30 * 24 * 60 * 60 * 1000),
            createdAt: new Date(Date.now() - (8 - i) * 7 * 24 * 60 * 60 * 1000),
          }));

          const transactions = Array.from({ length: 15 }, (_, i) => ({
            id: generateId('tx'),
            type: i % 3 === 0 ? 'refund' : 'charge',
            amount: Math.round((Math.random() * 100 + 5) * 100) / 100,
            status: i < 12 ? 'completed' : 'pending',
            timestamp: new Date(Date.now() - i * 2 * 24 * 60 * 60 * 1000),
          }));

          set({
            testSubscriptions: testSubs,
            subscriptions: testSubs,
            sandboxSubscriptions: testSubs,
            transactions,
            metrics: {
              totalSubscriptions: testSubs.length,
              totalTransactions: transactions.length,
              totalVolume: transactions.reduce((sum, t) => sum + t.amount, 0),
              totalApiCalls: Math.floor(Math.random() * 5000) + 1000,
            },
            isLoading: false,
          });
        } catch (err) {
          set({
            error: errorHandler.handleError(err as Error, {
              action: 'generateTestData',
              timestamp: new Date(),
            }),
            isLoading: false,
          });
        }
      },

      resetSandbox: () => {
        set({
          testSubscriptions: [],
          subscriptions: [],
          sandboxSubscriptions: [],
          transactions: [],
          metrics: {
            totalSubscriptions: 0,
            totalTransactions: 0,
            totalVolume: 0,
            totalApiCalls: 0,
          },
          usageRecords: [],
          usageStats: null,
        });
      },

      resetTestData: () => {
        get().resetSandbox();
      },

      refreshMetrics: async () => {
        const { testSubscriptions, transactions } = get();
        set({
          metrics: {
            totalSubscriptions: testSubscriptions.length,
            totalTransactions: transactions.length,
            totalVolume: transactions.reduce((sum, t) => sum + t.amount, 0),
            totalApiCalls: get().metrics.totalApiCalls,
          },
        });
      },

      initializeSandbox: async () => {
        const { sandboxes, testSubscriptions, apiKeys } = get();

        if (apiKeys.length > 0) {
          const migratedKeys = await migrateStoredApiKeys(apiKeys);
          set({ apiKeys: migratedKeys });
        }

        if (sandboxes.length === 0) {
          const defaultSandbox: SandboxConfig = {
            id: generateId('sandbox'),
            environment: SandboxEnvironment.DEVELOPMENT,
            name: 'Development Sandbox',
            description: 'Primary sandbox for development and testing',
            isActive: true,
            status: SandboxStatus.ACTIVE,
            dataIsolation: true,
            rateLimit: DEFAULT_RATE_LIMIT,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          set({ sandboxes: [defaultSandbox], currentSandbox: defaultSandbox });
        }
        if (testSubscriptions.length === 0) {
          get().generateTestData();
        }
      },

      initializeDeveloperPortal: async () => {
        const { sandboxes, apiKeys } = get();
        if (apiKeys.length > 0) {
          const migratedKeys = await migrateStoredApiKeys(apiKeys);
          set({ apiKeys: migratedKeys });
        }
        if (sandboxes.length === 0) {
          set({ sandboxes: [], onboardingSteps: DEFAULT_ONBOARDING_STEPS });
        }
      },

      switchEnvironment: (env) => {
        set((state) => ({
          sandboxConfig: { ...state.sandboxConfig, environment: env, updatedAt: new Date() },
        }));
      },

      addTestSubscription: (name, price) => {
        const sub: TestSubscription = {
          id: generateId('test_sub'),
          name,
          price,
          currency: 'USD',
          status: 'active',
          billingCycle: 'monthly',
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
        };
        set((state) => ({
          testSubscriptions: [...state.testSubscriptions, sub],
          subscriptions: [...state.subscriptions, sub],
          sandboxSubscriptions: [...state.sandboxSubscriptions, sub],
        }));
      },

      removeTestSubscription: (id) => {
        set((state) => ({
          testSubscriptions: state.testSubscriptions.filter((s) => s.id !== id),
          subscriptions: state.subscriptions.filter((s) => s.id !== id),
          sandboxSubscriptions: state.sandboxSubscriptions.filter((s) => s.id !== id),
        }));
      },

      completeOnboardingStep: (stepId) => {
        set((state) => ({
          onboardingSteps: state.onboardingSteps.map((s) =>
            s.id === stepId ? { ...s, completed: true } : s
          ),
        }));
      },

      createDeveloperProfile: async (name, email, company) => {
        try {
          set({ isLoading: true, error: null });
          const sandboxConfig = get().sandboxConfig;
          const profile: DeveloperProfile = {
            id: generateId('dev'),
            email,
            name,
            company,
            onboardingStep: DeveloperOnboardingStep.CREATE_ACCOUNT,
            completedSteps: [DeveloperOnboardingStep.WELCOME],
            sandboxConfig,
            apiKeys: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          set((state) => ({
            developerProfile: profile,
            onboardingSteps: state.onboardingSteps.map((s) =>
              s.id === DeveloperOnboardingStep.WELCOME ? { ...s, completed: true } : s
            ),
            isLoading: false,
          }));
        } catch (err) {
          set({
            error: errorHandler.handleError(err as Error, {
              action: 'createDeveloperProfile',
              timestamp: new Date(),
            }),
            isLoading: false,
          });
        }
      },

      generateApiKey: async (name) => {
        try {
          set({ isLoading: true, error: null });
          const key = generateApiKeyString();
          const hashedKey = await hashApiKey(key);
          const sandboxId = get().currentSandbox?.id || get().sandboxConfig.id;
          const apiKey: ApiKey = {
            id: generateId('key'),
            key: key.substring(0, KEY_PREFIX_LENGTH),
            keyPrefix: key.substring(0, KEY_PREFIX_LENGTH),
            hashedKey,
            plainKey: key,
            name,
            sandboxId,
            status: ApiKeyStatus.ACTIVE,
            scopes: [ApiKeyScope.READ, ApiKeyScope.WRITE],
            expiresAt: null,
            lastUsedAt: null,
            usageCount: 0,
            auditLogs: [createAuditEntry('', 'created', 'Generated a new API key in state')],
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          apiKey.auditLogs[0].apiKeyId = apiKey.id;
          set((state) => ({
            apiKeys: [...state.apiKeys, apiKey],
            onboardingSteps: state.onboardingSteps.map((s) =>
              s.id === DeveloperOnboardingStep.GENERATE_API_KEY ? { ...s, completed: true } : s
            ),
            isLoading: false,
          }));
          return key;
        } catch (err) {
          set({
            error: errorHandler.handleError(err as Error, {
              action: 'generateApiKey',
              timestamp: new Date(),
            }),
            isLoading: false,
          });
          throw err;
        }
      },

      createApiKey: async (input) => {
        try {
          set({ isLoading: true, error: null });
          const key = generateApiKeyString();
          const hashedKey = await hashApiKey(key);
          const apiKey: ApiKey = {
            id: generateId('key'),
            key: key.substring(0, KEY_PREFIX_LENGTH),
            keyPrefix: key.substring(0, KEY_PREFIX_LENGTH),
            hashedKey,
            plainKey: key,
            name: input.name,
            description: input.description,
            sandboxId: input.sandboxId,
            status: ApiKeyStatus.ACTIVE,
            scopes: input.scopes,
            expiresAt: null,
            lastUsedAt: null,
            usageCount: 0,
            auditLogs: [createAuditEntry('', 'created', 'Created a new managed API key')],
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          apiKey.auditLogs[0].apiKeyId = apiKey.id;
          set((state) => ({
            apiKeys: [...state.apiKeys, apiKey],
            isLoading: false,
          }));
          get().completeOnboardingStep(DeveloperOnboardingStep.GENERATE_API_KEY);
        } catch (err) {
          set({
            error: errorHandler.handleError(err as Error, {
              action: 'createApiKey',
              timestamp: new Date(),
            }),
            isLoading: false,
          });
        }
      },

      revokeApiKey: async (id) => {
        set((state) => ({
          apiKeys: state.apiKeys.map((k) =>
            k.id === id ? { ...k, status: ApiKeyStatus.REVOKED, updatedAt: new Date() } : k
          ),
        }));
      },

      reactivateApiKey: async (id) => {
        set((state) => ({
          apiKeys: state.apiKeys.map((k) =>
            k.id === id ? { ...k, status: ApiKeyStatus.ACTIVE, updatedAt: new Date() } : k
          ),
        }));
      },

      deleteApiKey: async (id) => {
        set((state) => ({
          apiKeys: state.apiKeys.filter((k) => k.id !== id),
        }));
      },

      fetchUsageForSandbox: (sandboxId) => {
        const records = get().usageRecords.filter((r) => r.sandboxId === sandboxId);
        const totalRequests = records.length;
        const successfulRequests = records.filter(
          (r) => r.statusCode >= 200 && r.statusCode < 400
        ).length;
        const failedRequests = totalRequests - successfulRequests;
        const avgResponseTime =
          totalRequests > 0
            ? records.reduce((sum, r) => sum + r.responseTime, 0) / totalRequests
            : 0;

        const requestsByEndpoint: Record<string, number> = {};
        const requestsByDay: Record<string, number> = {};
        const errorCounts: Record<number, { count: number; message: string }> = {};

        records.forEach((r) => {
          const endpointKey = `${r.method} ${r.endpoint}`;
          requestsByEndpoint[endpointKey] = (requestsByEndpoint[endpointKey] || 0) + 1;
          const day = new Date(r.timestamp).toISOString().split('T')[0];
          requestsByDay[day] = (requestsByDay[day] || 0) + 1;
          if (r.statusCode >= 400) {
            if (!errorCounts[r.statusCode]) {
              errorCounts[r.statusCode] = { count: 0, message: `HTTP ${r.statusCode}` };
            }
            errorCounts[r.statusCode].count++;
          }
        });

        const now = new Date();
        const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        set({
          usageStats: {
            totalRequests,
            successfulRequests,
            failedRequests,
            averageResponseTime: Math.round(avgResponseTime),
            totalDataTransferred: records.reduce(
              (sum, r) => sum + (r.requestSize || 0) + (r.responseSize || 0),
              0
            ),
            periodStart,
            periodEnd: now,
            requestsByEndpoint,
            requestsByDay,
            topErrors: Object.entries(errorCounts).map(([code, data]) => ({
              code: Number(code),
              count: data.count,
              message: data.message,
            })),
          },
        });
      },

      markGuideCompleted: (guideId) => {
        set((state) => ({
          integrationGuides: state.integrationGuides.map((g) =>
            g.id === guideId ? { ...g, isCompleted: true } : g
          ),
        }));
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        sandboxes: state.sandboxes,
        currentSandbox: state.currentSandbox,
        developerProfile: state.developerProfile,
        apiKeys: state.apiKeys.map((key) => {
          const sanitized = { ...key } as ApiKey;
          delete sanitized.plainKey;
          return sanitized;
        }),
        onboardingSteps: state.onboardingSteps,
        integrationGuides: state.integrationGuides,
        testSubscriptions: state.testSubscriptions,
        transactions: state.transactions,
        metrics: state.metrics,
      }),
    }
  )
);
