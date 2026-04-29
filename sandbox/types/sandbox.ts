export interface SandboxEnvironment {
  id: string;
  developerId: string;
  name: string;
  config: SandboxConfig;
  apiKeys: ApiKey[];
  testData: SandboxTestData;
  usage: SandboxUsageSummary;
  status: 'active' | 'suspended' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface SandboxResourceLimits {
  maxRequestsPerMinute: number;
  maxRequestsPerDay: number;
  maxStorageMB: number;
  maxConcurrentConnections: number;
  maxSubscriptions: number;
  maxWebhooks: number;
}

export interface SandboxConfig {
  environmentId?: string;
  name?: string;
  apiVersion: string;
  isolationLevel: 'strict' | 'moderate' | 'relaxed';
  dataRetentionDays: number;
  rateLimits: RateLimit;
  features: SandboxFeatures;
  testDataSeed?: string;
  customDomain?: string;
  webhookUrl?: string;
  callbackUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SandboxFeatures {
  cryptoPayments: boolean;
  webhooks: boolean;
  analytics: boolean;
  invoicing: boolean;
  sla: boolean;
  gamification: boolean;
  subscriptions?: boolean;
  payments?: boolean;
  notifications?: boolean;
}

export interface RateLimit {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  maxConcurrentRequests: number;
}

export type Permission = 'read' | 'write' | 'delete' | 'admin' | 'webhooks' | 'analytics';

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  permissions: Permission[];
  rateLimit: RateLimit;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  status: 'active' | 'revoked' | 'expired';
}

export interface SandboxTestData {
  subscriptions: TestSubscription[];
  payments: TestPayment[];
  webhooks: TestWebhook[];
  users: TestUser[];
}

export interface TestSubscription {
  id: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly' | 'weekly';
  status: 'active' | 'cancelled' | 'paused';
  startDate: Date;
  nextBillingDate: Date;
}

export interface TestPayment {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
  method: 'card' | 'crypto' | 'bank';
  timestamp: Date;
}

export interface TestWebhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  status: 'active' | 'inactive';
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  apiKeys: TestApiKey[];
  walletAddress?: string;
  createdAt?: Date;
}

export interface TestApiKey {
  id: string;
  key: string;
  name: string;
  permissions: string[];
  lastUsed?: Date;
  expiresAt?: Date;
}

export interface SandboxMetrics {
  requestCount: number;
  errorCount: number;
  avgResponseTime: number;
  storageUsedMB: number;
  activeConnections: number;
  lastActivity: Date;
}

export interface SandboxIsolationContext {
  environmentId: string;
  developerId: string;
  dataNamespace: string;
  resourceQuota: SandboxResourceLimits;
  currentUsage: SandboxMetrics;
  isWithinLimits: boolean;
}

export interface SandboxUsageSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  last24Hours: HourlyUsage[];
  last7Days: DailyUsage[];
}

export interface HourlyUsage {
  hour: number;
  requests: number;
  errors: number;
  avgResponseTime: number;
}

export interface DailyUsage {
  date: string;
  requests: number;
  errors: number;
  avgResponseTime: number;
}

export interface UsageMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  last24Hours: HourlyUsage[];
  last7Days: DailyUsage[];
}

export interface Developer {
  id: string;
  email: string;
  name: string;
  company: string;
  sandboxEnvironments: string[];
  onboardingStatus: OnboardingStatus;
  createdAt: Date;
}

export interface OnboardingStatus {
  step: number;
  completed: boolean;
  steps: OnboardingStep[];
}

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  completedAt: Date | null;
}

// Additional types for test data generation
export interface TestData {
  users: TestUserData[];
  subscriptions: TestDataSubscription[];
  payments: TestDataPayment[];
  merchants: TestMerchant[];
}

export interface TestUserData {
  id: string;
  email: string;
  name: string;
  walletAddress: string;
  createdAt: Date;
}

export interface TestMerchant {
  id: string;
  name: string;
  email: string;
  walletAddress: string;
  plans: TestPlan[];
}

export interface TestPlan {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
  features: string[];
}

export interface TestDataSubscription {
  id: string;
  userId: string;
  merchantId: string;
  plan: string;
  amount: number;
  currency: string;
  status: 'active' | 'paused' | 'cancelled';
  nextBillingDate: Date;
  createdAt: Date;
}

export interface TestDataPayment {
  id: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  status: 'completed' | 'pending' | 'failed';
  transactionHash: string;
  createdAt: Date;
}
