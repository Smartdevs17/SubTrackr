import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SandboxConfig,
  SandboxEnvironment,
  DeveloperProfile,
  DeveloperOnboardingStep,
  ApiKey,
  UsageStats,
  TestSubscription,
  IntegrationGuide,
  IntegrationGuideCategory,
} from '../types/sandbox';
import { sandboxService } from '../services/sandbox/sandboxService';
import { apiKeyService } from '../services/sandbox/apiKeyService';
import { developerOnboardingService } from '../services/sandbox/developerOnboardingService';
import { usageTrackingService } from '../services/sandbox/usageTrackingService';

interface SandboxState {
  sandboxConfig: SandboxConfig;
  developerProfile: DeveloperProfile | null;
  apiKeys: ApiKey[];
  usageStats: UsageStats | null;
  testSubscriptions: TestSubscription[];
  integrationGuides: IntegrationGuide[];
  isLoading: boolean;
  error: string | null;

  initializeSandbox: () => Promise<void>;
  switchEnvironment: (env: SandboxEnvironment) => Promise<void>;
  createDeveloperProfile: (name: string, email: string, company?: string) => Promise<void>;
  completeOnboardingStep: (step: DeveloperOnboardingStep) => Promise<void>;
  generateApiKey: (name: string) => Promise<string>;
  revokeApiKey: (keyId: string) => Promise<void>;
  deleteApiKey: (keyId: string) => Promise<void>;
  refreshUsageStats: () => void;
  resetTestData: () => void;
  addTestSubscription: (name: string, price: number) => void;
  removeTestSubscription: (id: string) => void;
  updateSandboxConfig: (updates: Partial<SandboxConfig>) => Promise<void>;
  markGuideCompleted: (guideId: string) => void;
}

const INTEGRATION_GUIDES: IntegrationGuide[] = [
  {
    id: 'guide-getting-started',
    title: 'Getting Started with SubTrackr API',
    description: 'Learn how to set up your development environment and make your first API call',
    category: IntegrationGuideCategory.GETTING_STARTED,
    difficulty: 'beginner',
    estimatedTime: '15 minutes',
    steps: [
      {
        title: 'Sign up for a Developer Account',
        content: 'Create your developer account on the SubTrackr Developer Portal. This gives you access to sandbox environment and API credentials.',
      },
      {
        title: 'Generate API Keys',
        content: 'Navigate to the API Keys section and generate your first sandbox API key. Keep this key secure and never expose it in client-side code.',
      },
      {
        title: 'Make Your First API Call',
        content: 'Use your API key to make a GET request to the subscriptions endpoint.',
        codeExample: `const response = await fetch('https://api.subtrackr.dev/v1/subscriptions', {
  headers: {
    'Authorization': 'Bearer sk_sandbox_your_key_here',
    'Content-Type': 'application/json',
  },
});
const data = await response.json();`,
      },
      {
        title: 'Explore the Response',
        content: 'The API returns subscription data in JSON format. Review the response structure to understand the data model.',
      },
    ],
    tags: ['setup', 'authentication', 'first-request'],
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
        title: 'Create a Subscription',
        content: 'Use the POST endpoint to create new subscriptions with billing details.',
        codeExample: `const response = await fetch('https://api.subtrackr.dev/v1/subscriptions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer sk_sandbox_your_key_here',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Premium Plan',
    price: 29.99,
    currency: 'USD',
    billingCycle: 'monthly',
    category: 'software',
  }),
});`,
      },
      {
        title: 'Update Subscription Status',
        content: 'Pause, resume, or cancel subscriptions using the status update endpoint.',
      },
      {
        title: 'Handle Billing Cycles',
        content: 'Understand how billing cycles work and how to manage renewal dates.',
      },
      {
        title: 'Process Refunds',
        content: 'Use the refund API to handle customer refund requests programmatically.',
      },
    ],
    tags: ['subscriptions', 'billing', 'crud'],
  },
  {
    id: 'guide-payment-processing',
    title: 'Payment Processing Integration',
    description: 'Integrate payment processing with crypto and traditional payment methods',
    category: IntegrationGuideCategory.PAYMENT_PROCESSING,
    difficulty: 'advanced',
    estimatedTime: '45 minutes',
    steps: [
      {
        title: 'Set Up Payment Gateway',
        content: 'Configure your payment gateway credentials in the sandbox environment.',
      },
      {
        title: 'Process Crypto Payments',
        content: 'Integrate with Stellar and EVM chains for cryptocurrency payments.',
        codeExample: `const payment = await fetch('https://api.subtrackr.dev/v1/payments', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer sk_sandbox_your_key_here',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    subscriptionId: 'sub_123',
    amount: 29.99,
    currency: 'USDC',
    network: 'stellar',
  }),
});`,
      },
      {
        title: 'Handle Payment Webhooks',
        content: 'Set up webhook endpoints to receive real-time payment status updates.',
      },
      {
        title: 'Implement Retry Logic',
        content: 'Handle failed payments with automatic retry and dunning management.',
      },
    ],
    tags: ['payments', 'crypto', 'stellar', 'webhooks'],
  },
  {
    id: 'guide-webhook-integration',
    title: 'Webhook Integration',
    description: 'Set up and manage webhooks for real-time event notifications',
    category: IntegrationGuideCategory.WEBHOOK_INTEGRATION,
    difficulty: 'intermediate',
    estimatedTime: '25 minutes',
    steps: [
      {
        title: 'Register a Webhook Endpoint',
        content: 'Register your server URL to receive webhook events.',
        codeExample: `const webhook = await fetch('https://api.subtrackr.dev/v1/webhooks', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer sk_sandbox_your_key_here',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://your-app.com/webhooks/subtrackr',
    events: ['subscription.created', 'payment.completed'],
  }),
});`,
      },
      {
        title: 'Verify Webhook Signatures',
        content: 'All webhooks include an HMAC signature. Always verify the signature before processing.',
      },
      {
        title: 'Handle Webhook Retries',
        content: 'Implement idempotency keys to handle webhook retries gracefully.',
      },
    ],
    tags: ['webhooks', 'events', 'real-time'],
  },
  {
    id: 'guide-analytics-reporting',
    title: 'Analytics & Reporting',
    description: 'Access subscription analytics and generate custom reports',
    category: IntegrationGuideCategory.ANALYTICS_REPORTING,
    difficulty: 'intermediate',
    estimatedTime: '20 minutes',
    steps: [
      {
        title: 'Fetch Analytics Data',
        content: 'Use the analytics endpoints to retrieve subscription metrics and trends.',
      },
      {
        title: 'Generate Custom Reports',
        content: 'Build custom reports by combining multiple analytics endpoints.',
      },
      {
        title: 'Export Data',
        content: 'Export analytics data in CSV or JSON format for external analysis.',
      },
    ],
    tags: ['analytics', 'reporting', 'export'],
  },
  {
    id: 'guide-advanced-features',
    title: 'Advanced Features',
    description: 'SLA monitoring, quota management, and enterprise features',
    category: IntegrationGuideCategory.ADVANCED_FEATURES,
    difficulty: 'advanced',
    estimatedTime: '60 minutes',
    steps: [
      {
        title: 'Configure SLA Monitoring',
        content: 'Set up SLA targets and monitor service availability.',
      },
      {
        title: 'Manage Quotas',
        content: 'Define and enforce usage quotas for different subscription tiers.',
      },
      {
        title: 'Implement Rate Limiting',
        content: 'Configure rate limits to protect your API endpoints.',
      },
      {
        title: 'Use the Invoice API',
        content: 'Generate, send, and manage invoices programmatically.',
      },
    ],
    tags: ['sla', 'quotas', 'rate-limiting', 'invoices', 'enterprise'],
  },
];

export const useSandboxStore = create<SandboxState>()(
  persist(
    (set, get) => ({
      sandboxConfig: sandboxService.getConfig(),
      developerProfile: developerOnboardingService.getProfile(),
      apiKeys: [],
      usageStats: null,
      testSubscriptions: sandboxService.getTestSubscriptions(),
      integrationGuides: INTEGRATION_GUIDES,
      isLoading: false,
      error: null,

      initializeSandbox: async () => {
        set({ isLoading: true, error: null });
        try {
          const config = sandboxService.getConfig();
          const profile = developerOnboardingService.getProfile();
          const testSubs = sandboxService.getTestSubscriptions();

          let apiKeys: ApiKey[] = [];
          if (profile) {
            apiKeys = apiKeyService.getApiKeysByDeveloper(profile.id);
            usageTrackingService.generateMockUsageData(profile.id, apiKeys[0]?.id || 'default');
          }

          const usageStats = profile
            ? usageTrackingService.getUsageStats(profile.id)
            : null;

          set({
            sandboxConfig: config,
            developerProfile: profile,
            apiKeys,
            usageStats,
            testSubscriptions: testSubs,
            isLoading: false,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to initialize sandbox',
            isLoading: false,
          });
        }
      },

      switchEnvironment: async (env: SandboxEnvironment) => {
        set({ isLoading: true });
        try {
          const config = await sandboxService.switchEnvironment(env);
          set({ sandboxConfig: config, isLoading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to switch environment',
            isLoading: false,
          });
        }
      },

      createDeveloperProfile: async (name: string, email: string, company?: string) => {
        set({ isLoading: true });
        try {
          const profile = await developerOnboardingService.createProfile(name, email, company);
          set({ developerProfile: profile, isLoading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to create profile',
            isLoading: false,
          });
        }
      },

      completeOnboardingStep: async (step: DeveloperOnboardingStep) => {
        try {
          const profile = await developerOnboardingService.completeStep(step);
          set({ developerProfile: profile });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to complete step',
          });
        }
      },

      generateApiKey: async (name: string) => {
        const profile = get().developerProfile;
        if (!profile) throw new Error('No developer profile');

        set({ isLoading: true });
        try {
          const key = await apiKeyService.createApiKey(profile.id, name);
          const apiKeys = apiKeyService.getApiKeysByDeveloper(profile.id);
          set({ apiKeys, isLoading: false });
          return key.key;
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to generate API key',
            isLoading: false,
          });
          throw error;
        }
      },

      revokeApiKey: async (keyId: string) => {
        try {
          await apiKeyService.revokeApiKey(keyId);
          const profile = get().developerProfile;
          if (profile) {
            const apiKeys = apiKeyService.getApiKeysByDeveloper(profile.id);
            set({ apiKeys });
          }
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to revoke API key',
          });
        }
      },

      deleteApiKey: async (keyId: string) => {
        try {
          await apiKeyService.deleteApiKey(keyId);
          const profile = get().developerProfile;
          if (profile) {
            const apiKeys = apiKeyService.getApiKeysByDeveloper(profile.id);
            set({ apiKeys });
          }
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to delete API key',
          });
        }
      },

      refreshUsageStats: () => {
        const profile = get().developerProfile;
        if (profile) {
          const usageStats = usageTrackingService.getUsageStats(profile.id);
          set({ usageStats });
        }
      },

      resetTestData: () => {
        sandboxService.resetTestData();
        const profile = get().developerProfile;
        if (profile) {
          usageTrackingService.generateMockUsageData(profile.id, 'default');
          const usageStats = usageTrackingService.getUsageStats(profile.id);
          set({ usageStats });
        }
        set({ testSubscriptions: sandboxService.getTestSubscriptions() });
      },

      addTestSubscription: (name: string, price: number) => {
        const sub = sandboxService.addTestSubscription({
          name,
          price,
          currency: 'USD',
          status: 'active',
          billingCycle: 'monthly',
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
        set({ testSubscriptions: [...get().testSubscriptions, sub] });
      },

      removeTestSubscription: (id: string) => {
        sandboxService.removeTestSubscription(id);
        set({
          testSubscriptions: get().testSubscriptions.filter((s) => s.id !== id),
        });
      },

      updateSandboxConfig: async (updates: Partial<SandboxConfig>) => {
        const config = await sandboxService.updateConfig(updates);
        set({ sandboxConfig: config });
      },

      markGuideCompleted: (guideId: string) => {
        set({
          integrationGuides: get().integrationGuides.map((g) =>
            g.id === guideId ? { ...g, isCompleted: true } : g
          ),
        });
      },
    }),
    {
      name: 'subtrackr-sandbox',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        sandboxConfig: state.sandboxConfig,
        integrationGuides: state.integrationGuides,
      }),
    }
  )
);
