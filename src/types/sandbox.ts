export enum SandboxEnvironment {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  TESTING = 'testing',
  PRODUCTION = 'production',
}

export enum SandboxStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  EXPIRED = 'expired',
  DESTROYED = 'destroyed',
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
  WEBHOOK_INTEGRATION = 'webhook_integration',
  PAYMENT_PROCESSING = 'payment_processing',
  ANALYTICS_REPORTING = 'analytics_reporting',
  ADVANCED_FEATURES = 'advanced_features',
}

export enum ApiKeyStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

export enum ApiKeyScope {
  READ = 'read',
  WRITE = 'write',
  ADMIN = 'admin',
  WEBHOOKS = 'webhooks',
  ANALYTICS = 'analytics',
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  burstLimit: number;
}

export interface SandboxConfig {
  id: string;
  environment: SandboxEnvironment;
  name: string;
  description: string;
  isActive: boolean;
  status: SandboxStatus;
  dataIsolation?: boolean;
  rateLimit: RateLimitConfig;
  dataResetInterval?: string;
  maxTestSubscriptions?: number;
  maxApiCalls?: number;
  allowedFeatures?: string[];
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  description?: string;
  sandboxId?: string;
  developerId?: string;
  environment?: SandboxEnvironment;
  status: ApiKeyStatus;
  scopes?: ApiKeyScope[];
  permissions?: string[];
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  usageCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyCreateRequest {
  name: string;
  description?: string;
  sandboxId: string;
  scopes: ApiKeyScope[];
  expiresAt?: Date;
}

export interface UsageRecord {
  id: string;
  apiKeyId: string;
  sandboxId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  requestSize: number;
  responseSize: number;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface UsageStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  totalDataTransferred: number;
  periodStart: Date;
  periodEnd: Date;
  requestsByEndpoint?: Record<string, number>;
  requestsByDay?: Record<string, number>;
  topErrors?: { code: number; count: number; message: string }[];
}

export interface UsageMetric {
  id: string;
  apiKeyId: string;
  sandboxId: string;
  developerId?: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  requestSize?: number;
  responseSize?: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface TestSubscription {
  id: string;
  name: string;
  price: number;
  currency: string;
  status: string;
  billingCycle: string;
  nextBillingDate: Date;
  createdAt: Date;
  category?: string;
  isActive?: boolean;
  isCryptoEnabled?: boolean;
  cryptoToken?: string;
}

export interface SandboxMetrics {
  totalSubscriptions: number;
  totalTransactions: number;
  totalVolume: number;
  totalApiCalls: number;
  apiCallsMade?: number;
}

export interface OnboardingStepInfo {
  id: string;
  title: string;
  description: string;
  step: DeveloperOnboardingStep;
  completed: boolean;
  required: boolean;
}

export interface DeveloperProfile {
  id: string;
  email: string;
  name: string;
  company?: string;
  website?: string;
  isOnboarded?: boolean;
  onboardingStep: number | DeveloperOnboardingStep;
  completedSteps?: DeveloperOnboardingStep[];
  sandboxConfig: SandboxConfig;
  apiKeys: ApiKey[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationGuide {
  id: string;
  title: string;
  description: string;
  category: string | IntegrationGuideCategory;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: string;
  steps: IntegrationStep[];
  tags: string[];
  isCompleted?: boolean;
}

export interface IntegrationStep {
  id?: string;
  order?: number;
  title: string;
  content: string;
  codeSnippet?: string;
  codeExample?: string;
  code?: string;
  language?: string;
}

export interface DocumentationSection {
  id: string;
  title: string;
  description?: string;
  content: string;
  icon?: string;
  path?: string;
  slug?: string;
  category?: string;
  order?: number;
  tags?: string[];
  subsections: DocumentationSection[];
  lastUpdated: Date;
}

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  isCompleted: boolean;
  isRequired: boolean;
  order?: number;
  action?: string;
  link?: string;
}

export interface SandboxTestData {
  subscriptions: {
    name: string;
    category: string;
    price: number;
    currency: string;
    billingCycle: string;
    isActive: boolean;
  }[];
  merchants: {
    name: string;
    walletAddress: string;
    planCount: number;
  }[];
  transactions: {
    type: string;
    amount: number;
    currency: string;
    status: string;
    timestamp: Date;
  }[];
}

export interface TestDataConfig {
  subscriptions: number;
  categories: string[];
  priceRange: { min: number; max: number };
  billingCycles: string[];
  currencies: string[];
  includeInactive: boolean;
  includeCrypto: boolean;
}
