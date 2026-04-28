export enum SandboxEnvironment {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  TESTING = 'testing',
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
  dataIsolation: boolean;
  rateLimit: RateLimitConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  description?: string;
  sandboxId: string;
  status: ApiKeyStatus;
  scopes: ApiKeyScope[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  usageCount: number;
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
}

export interface DeveloperProfile {
  id: string;
  email: string;
  name: string;
  company?: string;
  website?: string;
  isOnboarded: boolean;
  onboardingStep: number;
  sandboxConfig: SandboxConfig;
  apiKeys: ApiKey[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationGuide {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: string;
  steps: IntegrationStep[];
  tags: string[];
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
  subscriptions: Array<{
    name: string;
    category: string;
    price: number;
    currency: string;
    billingCycle: string;
    isActive: boolean;
  }>;
  merchants: Array<{
    name: string;
    walletAddress: string;
    planCount: number;
  }>;
  transactions: Array<{
    type: string;
    amount: number;
    currency: string;
    status: string;
    timestamp: Date;
  }>;
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
