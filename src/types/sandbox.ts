import { z } from 'zod';

export enum SandboxEnvironment {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
}

export enum ApiKeyStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

export enum DeveloperOnboardingStep {
  WELCOME = 'welcome',
  CREATE_ACCOUNT = 'create_account',
  GENERATE_API_KEY = 'generate_api_key',
  EXPLORE_SANDBOX = 'explore_sandbox',
  BUILD_INTEGRATION = 'build_integration',
  GO_LIVE = 'go_live',
}

export enum IntegrationGuideCategory {
  GETTING_STARTED = 'getting_started',
  SUBSCRIPTION_MANAGEMENT = 'subscription_management',
  PAYMENT_PROCESSING = 'payment_processing',
  WEBHOOK_INTEGRATION = 'webhook_integration',
  ANALYTICS_REPORTING = 'analytics_reporting',
  ADVANCED_FEATURES = 'advanced_features',
}

export const SandboxConfigSchema = z.object({
  id: z.string(),
  environment: z.nativeEnum(SandboxEnvironment),
  name: z.string(),
  description: z.string().optional(),
  isActive: z.boolean(),
  dataResetInterval: z.enum(['daily', 'weekly', 'monthly', 'manual']),
  maxTestSubscriptions: z.number(),
  maxApiCalls: z.number(),
  allowedFeatures: z.array(z.string()),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export const ApiKeySchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  developerId: z.string(),
  environment: z.nativeEnum(SandboxEnvironment),
  status: z.nativeEnum(ApiKeyStatus),
  permissions: z.array(z.string()),
  rateLimit: z.object({
    requestsPerMinute: z.number(),
    requestsPerDay: z.number(),
  }),
  lastUsedAt: z.union([z.string(), z.date()]).optional(),
  expiresAt: z.union([z.string(), z.date()]).optional(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export const DeveloperProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  company: z.string().optional(),
  website: z.string().url().optional(),
  onboardingStep: z.nativeEnum(DeveloperOnboardingStep),
  completedSteps: z.array(z.nativeEnum(DeveloperOnboardingStep)),
  sandboxConfig: SandboxConfigSchema,
  apiKeys: z.array(ApiKeySchema),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export const UsageMetricSchema = z.object({
  id: z.string(),
  developerId: z.string(),
  apiKeyId: z.string(),
  endpoint: z.string(),
  method: z.string(),
  statusCode: z.number(),
  responseTime: z.number(),
  timestamp: z.union([z.string(), z.date()]),
  environment: z.nativeEnum(SandboxEnvironment),
});

export const UsageStatsSchema = z.object({
  totalRequests: z.number(),
  successfulRequests: z.number(),
  failedRequests: z.number(),
  averageResponseTime: z.number(),
  requestsByEndpoint: z.record(z.number()),
  requestsByDay: z.record(z.number()),
  topErrors: z.array(z.object({
    code: z.number(),
    count: z.number(),
    message: z.string(),
  })),
});

export const TestSubscriptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  currency: z.string(),
  status: z.enum(['active', 'paused', 'cancelled']),
  billingCycle: z.enum(['monthly', 'yearly', 'weekly']),
  nextBillingDate: z.union([z.string(), z.date()]),
  createdAt: z.union([z.string(), z.date()]),
});

export const IntegrationGuideSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.nativeEnum(IntegrationGuideCategory),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
  estimatedTime: z.string(),
  steps: z.array(z.object({
    title: z.string(),
    content: z.string(),
    codeExample: z.string().optional(),
  })),
  tags: z.array(z.string()),
  isCompleted: z.boolean().optional(),
});

export const DocumentationSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  category: z.string(),
  order: z.number(),
  subsections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
  })).optional(),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
export type ApiKey = z.infer<typeof ApiKeySchema>;
export type DeveloperProfile = z.infer<typeof DeveloperProfileSchema>;
export type UsageMetric = z.infer<typeof UsageMetricSchema>;
export type UsageStats = z.infer<typeof UsageStatsSchema>;
export type TestSubscription = z.infer<typeof TestSubscriptionSchema>;
export type IntegrationGuide = z.infer<typeof IntegrationGuideSchema>;
export type DocumentationSection = z.infer<typeof DocumentationSectionSchema>;
