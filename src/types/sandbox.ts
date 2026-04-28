import { z } from 'zod';

export enum SandboxEnvironment {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
}

export enum SandboxStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  EXPIRED = 'expired',
  DESTROYED = 'destroyed',
}

export enum ApiKeyStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

export enum ApiKeyScope {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
  ADMIN = 'admin',
  WEBHOOKS = 'webhooks',
  ANALYTICS = 'analytics',
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
  description?: string;
  isActive: boolean;
  status?: SandboxStatus;
  dataIsolation?: boolean;
  rateLimit: RateLimitConfig;
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

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  description?: string;
  sandboxId: string;
  developerId?: string;
  status: ApiKeyStatus;
  scopes: ApiKeyScope[];
  environment?: SandboxEnvironment;
  rateLimit?: number;
  usageCount: number;
  lastUsedAt?: Date | null;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeveloperProfile {
  id: string;
  email: string;
  name: string;
  company?: string;
  website?: string;
  onboardingStep: DeveloperOnboardingStep;
  completedSteps: DeveloperOnboardingStep[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OnboardingStepInfo {
  id: string;
  title: string;
  description: string;
  step: DeveloperOnboardingStep;
  completed: boolean;
  required: boolean;
}

export interface TestSubscription {
  id: string;
  name: string;
  price: number;
  currency: string;
  status: 'active' | 'paused' | 'cancelled';
  billingCycle: 'monthly' | 'yearly' | 'weekly';
  nextBillingDate: Date;
  createdAt: Date;
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

export interface UsageMetric {
  id: string;
  apiKeyId: string;
  sandboxId?: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  responseTimeMs?: number;
  timestamp: Date;
  environment?: SandboxEnvironment;
  metadata?: Record<string, unknown>;
}

export interface UsageStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  avgResponseTimeMs?: number;
  requestsByEndpoint: Record<string, number>;
  requestsByDay: Record<string, number>;
  topErrors: Array<{
    code: number;
    count: number;
    message: string;
  }>;
  errorRate?: number;
  periodStart?: Date;
  periodEnd?: Date;
}

export interface IntegrationStep {
  id: string;
  title: string;
  content: string;
  codeExample?: string;
  code?: string;
  language?: string;
}

export interface IntegrationGuide {
  id: string;
  title: string;
  description: string;
  category: IntegrationGuideCategory;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: string;
  steps: IntegrationStep[];
  tags: string[];
  isCompleted?: boolean;
}

export interface DocumentationSection {
  id: string;
  title: string;
  content: string;
  category?: string;
  slug?: string;
  order?: number;
  tags?: string[];
  subsections: Array<{
    id?: string;
    title: string;
    content: string;
  }>;
  lastUpdated?: Date;
}

export interface SandboxMetrics {
  totalSubscriptions: number;
  totalTransactions: number;
  totalVolume: number;
  totalApiCalls: number;
}
