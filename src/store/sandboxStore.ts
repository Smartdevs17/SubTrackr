import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SandboxConfig,
  SandboxEnvironment,
  SandboxStatus,
  ApiKey,
  ApiKeyStatus,
  ApiKeyScope,
  UsageMetric,
  UsageStats,
  TestSubscription,
  SandboxMetrics,
  DeveloperProfile,
  DeveloperOnboardingStep,
  OnboardingStepInfo,
  IntegrationGuide,
  IntegrationGuideCategory,
  IntegrationStep,
  RateLimitConfig,
} from '../types/sandbox';
import { errorHandler, AppError } from '../services/errorHandler';

const STORAGE_KEY = 'subtrackr-sandbox';
const STORE_VERSION = 2;

const generateId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const generateApiKeyString = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'sk_sandbox_';
  for (let i = 0; i < 48; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
};

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  burstLimit: 10,
};

const DEFAULT_ONBOARDING_STEPS: OnboardingStepInfo[] = [
  {
    id: 'welcome',
    title: 'Welcome to SubTrackr',
    description: 'Learn about the developer portal and sandbox environment',
    step: DeveloperOnboardingStep.WELCOME,
    completed: false,
    required: true,
  },
  {
    id: 'create-account',
    title: 'Create Developer Account',
    description: 'Set up your developer profile with basic information',
    step: DeveloperOnboardingStep.CREATE_ACCOUNT,
    completed: false,
    required: true,
  },
  {
    id: 'generate-api-key',
    title: 'Generate API Key',
    description: 'Create your first sandbox API key for testing',
    step: DeveloperOnboardingStep.GENERATE_API_KEY,
    completed: false,
    required: true,
  },
  {
    id: 'explore-sandbox',
    title: 'Explore Sandbox',
    description: 'Familiarize yourself with the sandbox environment',
    step: DeveloperOnboardingStep.EXPLORE_SANDBOX,
    completed: false,
    required: false,
  },
  {
    id: 'build-integration',
    title: 'Build Integration',
    description: 'Use our SDK and guides to build your integration',
    step: DeveloperOnboardingStep.BUILD_INTEGRATION,
    completed: false,
    required: false,
  },
  {
    id: 'go-live',
    title: 'Go Live',
    description: 'Switch to production and launch your integration',
    step: DeveloperOnboardingStep.GO_LIVE,
    completed: false,
    required: false,
  },
];

const DEFAULT_INTEGRATION_GUIDES: IntegrationGuide[] = [
  {
    id: 'getting-started-quickstart',
    title: 'Quick Start Guide',
    description: 'Get up and running with SubTrackr API in 5 minutes',
    category: IntegrationGuideCategory.GETTING_STARTED,
    difficulty: 'beginner',
    estimatedTime: '5 minutes',
    steps: [
      {
        id: 'qs-1',
        title: 'Install the SDK',
        content: 'Install the SubTrackr SDK using npm or yarn.',
        codeExample: 'npm install @subtrackr/sdk',
        language: 'bash',
      },
      {
        id: 'qs-2',
        title: 'Initialize the Client',
        content: 'Create a SubTrackr client with your API key.',
        codeExample: `import { SubTrackr } from '@subtrackr/sdk';\n\nconst client = new SubTrackr({\n  apiKey: 'sk_sandbox_your_key',\n  environment: 'sandbox',\n});`,
        language: 'typescript',
      },
      {
        id: 'qs-3',
        title: 'Make Your First Request',
        content: 'List all subscriptions to verify your setup.',
        codeExample: `const subscriptions = await client.subscriptions.list();\nconsole.log(subscriptions.data);`,
        language: 'typescript',
      },
    ],
    tags: ['quickstart', 'setup', 'sdk'],
    isCompleted: false,
  },
  {
    id: 'subscription-crud',
    title: 'Subscription CRUD Operations',
    description: 'Learn how to create, read, update, and delete subscriptions',
    category: IntegrationGuideCategory.SUBSCRIPTION_MANAGEMENT,
    difficulty: 'beginner',
    estimatedTime: '15 minutes',
    steps: [
      {
        id: 'crud-1',
        title: 'Create a Subscription',
        content: 'Create a new subscription with the required fields.',
        codeExample: `const subscription = await client.subscriptions.create({\n  name: 'Pro Plan',\n  price: 29.99,\n  currency: 'USD',\n  billingCycle: 'monthly',\n  category: 'software',\n});`,
        language: 'typescript',
      },
      {
        id: 'crud-2',
        title: 'Read Subscriptions',
        content: 'Fetch subscriptions with filtering and pagination.',
        codeExample: `const active = await client.subscriptions.list({\n  status: 'active',\n  page: 1,\n  limit: 20,\n});`,
        language: 'typescript',
      },
      {
        id: 'crud-3',
        title: 'Update a Subscription',
        content: 'Modify an existing subscription.',
        codeExample: `await client.subscriptions.update(subscription.id, {\n  price: 39.99,\n  name: 'Pro Plan Plus',\n});`,
        language: 'typescript',
      },
      {
        id: 'crud-4',
        title: 'Cancel a Subscription',
        content: 'Cancel a subscription with optional reason.',
        codeExample: `await client.subscriptions.cancel(subscription.id, {\n  reason: 'Switching to annual plan',\n});`,
        language: 'typescript',
      },
    ],
    tags: ['subscriptions', 'crud', 'management'],
    isCompleted: false,
  },
  {
    id: 'webhook-setup',
    title: 'Setting Up Webhooks',
    description: 'Receive real-time notifications for subscription events',
    category: IntegrationGuideCategory.WEBHOOK_INTEGRATION,
    difficulty: 'intermediate',
    estimatedTime: '20 minutes',
    steps: [
      {
        id: 'wh-1',
        title: 'Create Webhook Endpoint',
        content: 'Set up an Express endpoint to receive webhook events.',
        codeExample: `import express from 'express';\nimport crypto from 'crypto';\n\nconst app = express();\napp.post('/webhooks', express.json(), (req, res) => {\n  const sig = req.headers['x-subtrackr-signature'];\n  const hash = crypto\n    .createHmac('sha256', process.env.WEBHOOK_SECRET)\n    .update(JSON.stringify(req.body))\n    .digest('hex');\n  \n  if (sig !== \`sha256=\${hash}\`) {\n    return res.status(401).send('Invalid');\n  }\n  \n  console.log('Event:', req.body.type);\n  res.status(200).send('OK');\n});`,
        language: 'typescript',
      },
      {
        id: 'wh-2',
        title: 'Register Webhook URL',
        content: 'Register your endpoint in the SubTrackr dashboard.',
      },
      {
        id: 'wh-3',
        title: 'Test with Sandbox Events',
        content: 'Trigger test events from the sandbox environment.',
      },
    ],
    tags: ['webhooks', 'events', 'notifications'],
    isCompleted: false,
  },
  {
    id: 'crypto-payments',
    title: 'Crypto Payment Integration',
    description: 'Accept cryptocurrency payments for subscriptions',
    category: IntegrationGuideCategory.PAYMENT_PROCESSING,
    difficulty: 'advanced',
    estimatedTime: '45 minutes',
    steps: [
      {
        id: 'crypto-1',
        title: 'Configure Crypto Settings',
        content: 'Enable crypto payments in your SubTrackr configuration.',
        codeExample: `const client = new SubTrackr({\n  apiKey: 'sk_sandbox_your_key',\n  crypto: {\n    enabled: true,\n    networks: ['ethereum', 'polygon'],\n    tokens: ['USDC', 'DAI'],\n  },\n});`,
        language: 'typescript',
      },
      {
        id: 'crypto-2',
        title: 'Create Crypto Subscription',
        content: 'Create a subscription with crypto payment method.',
        codeExample: `const sub = await client.subscriptions.create({\n  name: 'Premium',\n  price: 99.99,\n  currency: 'USDC',\n  billingCycle: 'monthly',\n  paymentMethod: 'crypto',\n  crypto: { network: 'polygon', token: 'USDC' },\n});`,
        language: 'typescript',
      },
    ],
    tags: ['crypto', 'payments', 'blockchain', 'superfluid'],
    isCompleted: false,
  },
  {
    id: 'usage-analytics',
    title: 'Usage Tracking & Analytics',
    description: 'Track and analyze subscription usage patterns',
    category: IntegrationGuideCategory.ANALYTICS_REPORTING,
    difficulty: 'intermediate',
    estimatedTime: '25 minutes',
    steps: [
      {
        id: 'usage-1',
        title: 'Record Usage',
        content: 'Track usage events for metered subscriptions.',
        codeExample: `await client.usage.record({\n  subscriptionId: 'sub_123',\n  quantity: 10,\n  timestamp: new Date(),\n});`,
        language: 'typescript',
      },
      {
        id: 'usage-2',
        title: 'Fetch Analytics',
        content: 'Retrieve usage analytics and billing data.',
        codeExample: `const analytics = await client.analytics.getUsage({\n  subscriptionId: 'sub_123',\n  period: 'monthly',\n});\nconsole.log(analytics.totalUsage);`,
        language: 'typescript',
      },
    ],
    tags: ['analytics', 'usage', 'reporting'],
    isCompleted: false,
  },
];

interface SandboxState {
  sandboxes: SandboxConfig[];
  currentSandbox: SandboxConfig | null;
  selectedSandbox: SandboxConfig | null;
  sandboxConfig: SandboxConfig;
  subscriptions: TestSubscription[];
  sandboxSubscriptions: TestSubscription[];
  testSubscriptions: TestSubscription[];
  transactions: Array<{ id: string; type: string; amount: number; status: string; timestamp: Date }>;
  metrics: SandboxMetrics;
  usageStats: UsageStats | null;
  usageRecords: UsageMetric[];
  apiKeys: ApiKey[];
  onboardingSteps: OnboardingStepInfo[];
  integrationGuides: IntegrationGuide[];
  selectedGuide: IntegrationGuide | null;
  developerProfile: DeveloperProfile | null;
  isLoading: boolean;
  error: AppError | null;

  fetchSandboxes: (developerId: string) => Promise<void>;
  createSandbox: (name: string, description: string, environment: SandboxEnvironment) => Promise<void>;
  selectSandbox: (sandbox: SandboxConfig) => void;
  deleteSandbox: (id: string) => Promise<void>;
  pauseSandbox: (id: string) => Promise<void>;
  resumeSandbox: (id: string) => Promise<void>;
  toggleSandboxStatus: (id: string) => Promise<void>;
  generateTestData: (sandboxId?: string) => Promise<void>;
  resetSandbox: () => void;
  resetTestData: () => void;
  refreshMetrics: () => Promise<void>;
  initializeSandbox: () => void;
  initializeDeveloperPortal: () => void;
  switchEnvironment: (env: SandboxEnvironment) => void;
  addTestSubscription: (name: string, price: number) => void;
  removeTestSubscription: (id: string) => void;
  completeOnboardingStep: (stepId: string) => void;
  createApiKey: (input: { name: string; description?: string; sandboxId: string; scopes: ApiKeyScope[] }) => Promise<void>;
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
  name: 'Default Sandbox',
  description: 'Default development sandbox',
  isActive: true,
  status: SandboxStatus.ACTIVE,
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
      subscriptions: [],
      sandboxSubscriptions: [],
      testSubscriptions: [],
      transactions: [],
      metrics: {
        totalSubscriptions: 0,
        totalTransactions: 0,
        totalVolume: 0,
        totalApiCalls: 0,
      },
      usageStats: null,
      usageRecords: [],
      apiKeys: [],
      onboardingSteps: DEFAULT_ONBOARDING_STEPS,
      integrationGuides: DEFAULT_INTEGRATION_GUIDES,
      selectedGuide: null,
      developerProfile: null,
      isLoading: false,
      error: null,

      fetchSandboxes: async (_developerId: string) => {
        try {
          set({ isLoading: true, error: null });
          const { sandboxes } = get();
          if (sandboxes.length === 0) {
            set({ isLoading: false });
            return;
          }
          const active = sandboxes.find((s) => s.isActive) || sandboxes[0];
          set({ currentSandbox: active, isLoading: false });
        } catch (err) {
          set({
            error: errorHandler.handleError(err as Error, { action: 'fetchSandboxes', timestamp: new Date() }),
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
            error: errorHandler.handleError(err as Error, { action: 'createSandbox', timestamp: new Date() }),
            isLoading: false,
          });
        }
      },

      selectSandbox: (sandbox) => {
        set({ selectedSandbox: sandbox, currentSandbox: sandbox });
      },

      deleteSandbox: async (id) => {
        try {
          set((state) => {
            const remaining = state.sandboxes.filter((s) => s.id !== id);
            return {
              sandboxes: remaining,
              currentSandbox: state.currentSandbox?.id === id ? remaining[0] || null : state.currentSandbox,
              selectedSandbox: state.selectedSandbox?.id === id ? null : state.selectedSandbox,
            };
          });
        } catch (err) {
          set({
            error: errorHandler.handleError(err as Error, { action: 'deleteSandbox', timestamp: new Date() }),
          });
        }
      },

      pauseSandbox: async (id) => {
        set((state) => ({
          sandboxes: state.sandboxes.map((s) =>
            s.id === id ? { ...s, isActive: false, status: SandboxStatus.PAUSED, updatedAt: new Date() } : s
          ),
          currentSandbox: state.currentSandbox?.id === id
            ? { ...state.currentSandbox, isActive: false, status: SandboxStatus.PAUSED }
            : state.currentSandbox,
        }));
      },

      resumeSandbox: async (id) => {
        set((state) => ({
          sandboxes: state.sandboxes.map((s) =>
            s.id === id ? { ...s, isActive: true, status: SandboxStatus.ACTIVE, updatedAt: new Date() } : s
          ),
          currentSandbox: state.currentSandbox?.id === id
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

      generateTestData: async (sandboxId) => {
        try {
          set({ isLoading: true, error: null });
          const testSubs: TestSubscription[] = [];
          const count = 8;
          const names = ['Netflix', 'Spotify', 'Adobe CC', 'Slack Pro', 'GitHub Team', 'Figma Pro', 'Notion Plus', 'Vercel Pro'];
          const prices = [15.99, 9.99, 54.99, 8.75, 4.0, 12.0, 10.0, 20.0];
          const cycles: Array<'monthly' | 'yearly'> = ['monthly', 'monthly', 'monthly', 'monthly', 'monthly', 'monthly', 'monthly', 'yearly'];

          for (let i = 0; i < count; i++) {
            testSubs.push({
              id: generateId('test_sub'),
              name: names[i],
              price: prices[i],
              currency: 'USD',
              status: i < 6 ? 'active' : 'paused',
              billingCycle: cycles[i],
              nextBillingDate: new Date(Date.now() + (i + 1) * 30 * 24 * 60 * 60 * 1000),
              createdAt: new Date(Date.now() - (count - i) * 7 * 24 * 60 * 60 * 1000),
            });
          }

          const transactions = Array.from({ length: 15 }, (_, i) => ({
            id: generateId('tx'),
            type: i % 3 === 0 ? 'refund' : 'charge',
            amount: Math.round((Math.random() * 100 + 5) * 100) / 100,
            status: i < 12 ? 'completed' : 'pending',
            timestamp: new Date(Date.now() - i * 2 * 24 * 60 * 60 * 1000),
          }));

          set((state) => ({
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
          }));
        } catch (err) {
          set({
            error: errorHandler.handleError(err as Error, { action: 'generateTestData', timestamp: new Date() }),
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
          metrics: { totalSubscriptions: 0, totalTransactions: 0, totalVolume: 0, totalApiCalls: 0 },
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

      initializeSandbox: () => {
        const { sandboxes, testSubscriptions } = get();
        if (sandboxes.length === 0) {
          const defaultSandbox: SandboxConfig = {
            id: generateId('sandbox'),
            environment: SandboxEnvironment.DEVELOPMENT,
            name: 'Development Sandbox',
            description: 'Primary sandbox for development and testing',
            isActive: true,
            status: SandboxStatus.ACTIVE,
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

      initializeDeveloperPortal: () => {
        const { sandboxes } = get();
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

      createApiKey: async (input) => {
        try {
          set({ isLoading: true, error: null });
          const key = generateApiKeyString();
          const apiKey: ApiKey = {
            id: generateId('key'),
            key,
            name: input.name,
            description: input.description,
            sandboxId: input.sandboxId,
            status: ApiKeyStatus.ACTIVE,
            scopes: input.scopes,
            usageCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          set((state) => ({
            apiKeys: [...state.apiKeys, apiKey],
            isLoading: false,
          }));
          get().completeOnboardingStep('generate-api-key');
        } catch (err) {
          set({
            error: errorHandler.handleError(err as Error, { action: 'createApiKey', timestamp: new Date() }),
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
        const successfulRequests = records.filter((r) => r.statusCode >= 200 && r.statusCode < 400).length;
        const failedRequests = totalRequests - successfulRequests;
        const avgResponseTime = totalRequests > 0
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

        set({
          usageStats: {
            totalRequests,
            successfulRequests,
            failedRequests,
            averageResponseTime: Math.round(avgResponseTime),
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
        apiKeys: state.apiKeys,
        onboardingSteps: state.onboardingSteps,
        integrationGuides: state.integrationGuides,
        testSubscriptions: state.testSubscriptions,
        transactions: state.transactions,
        metrics: state.metrics,
      }),
    }
  )
);
