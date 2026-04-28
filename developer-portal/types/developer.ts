export interface Developer {
  id: string;
  email: string;
  name: string;
  company?: string;
  status: 'pending' | 'active' | 'suspended' | 'banned';
  tier: 'free' | 'pro' | 'enterprise';
  onboardingStatus: OnboardingStatus;
  apiKeys: ApiKey[];
  sandboxEnvironments: string[];
  usage: UsageMetrics;
  billing: BillingInfo;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface OnboardingStatus {
  step: 'registration' | 'email_verification' | 'profile_completion' | 'sandbox_setup' | 'completed';
  completedSteps: string[];
  startedAt: Date;
  completedAt?: Date;
  verificationToken?: string;
  verificationExpiresAt?: Date;
}

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  type: 'test' | 'production';
  permissions: ApiPermission[];
  rateLimit: RateLimit;
  ipWhitelist?: string[];
  lastUsedAt?: Date;
  lastUsedIp?: string;
  usageCount: number;
  status: 'active' | 'revoked' | 'expired';
  createdAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
}

export type ApiPermission =
  | 'subscriptions:read'
  | 'subscriptions:write'
  | 'payments:read'
  | 'payments:write'
  | 'webhooks:read'
  | 'webhooks:write'
  | 'analytics:read'
  | 'users:read'
  | 'users:write'
  | 'sandbox:manage';

export interface RateLimit {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  burstLimit: number;
}

export interface UsageMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  dataTransferMB: number;
  period: UsagePeriod;
  dailyBreakdown: DailyUsage[];
  endpointBreakdown: EndpointUsage[];
}

export interface UsagePeriod {
  start: Date;
  end: Date;
}

export interface DailyUsage {
  date: Date;
  requests: number;
  errors: number;
  avgResponseTime: number;
}

export interface EndpointUsage {
  endpoint: string;
  method: string;
  calls: number;
  avgResponseTime: number;
  errorRate: number;
}

export interface BillingInfo {
  plan: 'free' | 'pro' | 'enterprise';
  monthlyPrice: number;
  currency: string;
  nextBillingDate?: Date;
  paymentMethod?: PaymentMethod;
  invoices: Invoice[];
  usageCharges: UsageCharge[];
}

export interface PaymentMethod {
  type: 'card' | 'bank' | 'crypto';
  last4: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
}

export interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  description: string;
  issuedAt: Date;
  dueAt: Date;
  paidAt?: Date;
}

export interface UsageCharge {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  period: UsagePeriod;
}

export interface Documentation {
  id: string;
  title: string;
  slug: string;
  category: DocCategory;
  content: string;
  format: 'markdown' | 'html';
  version: string;
  tags: string[];
  order: number;
  isPublished: boolean;
  author: string;
  createdAt: Date;
  updatedAt: Date;
}

export type DocCategory =
  | 'getting-started'
  | 'authentication'
  | 'subscriptions'
  | 'payments'
  | 'webhooks'
  | 'sandbox'
  | 'sdks'
  | 'tutorials'
  | 'reference';

export interface IntegrationGuide {
  id: string;
  title: string;
  description: string;
  platform: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: number;
  steps: IntegrationStep[];
  prerequisites: string[];
  tags: string[];
  order: number;
}

export interface IntegrationStep {
  order: number;
  title: string;
  description: string;
  code?: string;
  language?: string;
  notes?: string[];
}

export interface DeveloperDashboard {
  developer: Developer;
  sandboxEnvironments: SandboxEnvironmentSummary[];
  recentActivity: ActivityLog[];
  alerts: Alert[];
  quickLinks: QuickLink[];
}

export interface SandboxEnvironmentSummary {
  id: string;
  name: string;
  status: string;
  requestCount: number;
  lastActivity: Date;
}

export interface ActivityLog {
  id: string;
  action: string;
  resource: string;
  resourceId: string;
  timestamp: Date;
  details?: Record<string, unknown>;
}

export interface Alert {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: Date;
  isRead: boolean;
  actionUrl?: string;
}

export interface QuickLink {
  title: string;
  description: string;
  url: string;
  icon: string;
}
