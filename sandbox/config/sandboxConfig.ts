import { SandboxConfig, SandboxResourceLimits, SandboxFeatures, RateLimit } from '../types/sandbox';

export const DEFAULT_RATE_LIMITS: RateLimit = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  maxConcurrentRequests: 10,
};

export const DEFAULT_RESOURCE_LIMITS: SandboxResourceLimits = {
  maxRequestsPerMinute: 60,
  maxRequestsPerDay: 10000,
  maxStorageMB: 100,
  maxConcurrentConnections: 10,
  maxSubscriptions: 50,
  maxWebhooks: 5,
};

export const DEFAULT_FEATURES: SandboxFeatures = {
  cryptoPayments: true,
  webhooks: true,
  analytics: true,
  invoicing: true,
  sla: true,
  gamification: false,
};

export const SANDBOX_TIERS = {
  free: {
    name: 'Free Sandbox',
    resourceLimits: {
      maxRequestsPerMinute: 30,
      maxRequestsPerDay: 5000,
      maxStorageMB: 50,
      maxConcurrentConnections: 5,
      maxSubscriptions: 20,
      maxWebhooks: 2,
    } as SandboxResourceLimits,
    rateLimits: {
      requestsPerMinute: 30,
      requestsPerHour: 500,
      requestsPerDay: 5000,
      maxConcurrentRequests: 5,
    } as RateLimit,
    features: {
      cryptoPayments: false,
      webhooks: false,
      analytics: true,
      invoicing: false,
      sla: false,
      gamification: false,
    } as SandboxFeatures,
    dataRetentionDays: 7,
  },
  pro: {
    name: 'Pro Sandbox',
    resourceLimits: {
      maxRequestsPerMinute: 120,
      maxRequestsPerDay: 50000,
      maxStorageMB: 500,
      maxConcurrentConnections: 20,
      maxSubscriptions: 100,
      maxWebhooks: 10,
    } as SandboxResourceLimits,
    rateLimits: {
      requestsPerMinute: 120,
      requestsPerHour: 5000,
      requestsPerDay: 50000,
      maxConcurrentRequests: 20,
    } as RateLimit,
    features: {
      cryptoPayments: true,
      webhooks: true,
      analytics: true,
      invoicing: true,
      sla: true,
      gamification: false,
    } as SandboxFeatures,
    dataRetentionDays: 30,
  },
  enterprise: {
    name: 'Enterprise Sandbox',
    resourceLimits: {
      maxRequestsPerMinute: 300,
      maxRequestsPerDay: 200000,
      maxStorageMB: 2000,
      maxConcurrentConnections: 50,
      maxSubscriptions: 500,
      maxWebhooks: 50,
    } as SandboxResourceLimits,
    rateLimits: {
      requestsPerMinute: 300,
      requestsPerHour: 15000,
      requestsPerDay: 200000,
      maxConcurrentRequests: 50,
    } as RateLimit,
    features: {
      cryptoPayments: true,
      webhooks: true,
      analytics: true,
      invoicing: true,
      sla: true,
      gamification: true,
    } as SandboxFeatures,
    dataRetentionDays: 90,
  },
};

export const SANDBOX_CONSTANTS = {
  MAX_API_KEYS_PER_SANDBOX: 10,
  MAX_TEST_DATA_ENTRIES: 1000,
  API_KEY_PREFIX: 'sk_test_',
  PRODUCTION_KEY_PREFIX: 'sk_live_',
  SANDBOX_BASE_URL: 'https://sandbox.api.subtrackr.io',
  PRODUCTION_BASE_URL: 'https://api.subtrackr.io',
  SUPPORTED_CURRENCIES: ['USD', 'EUR', 'GBP', 'ETH', 'BTC', 'XLM'],
  SUPPORTED_NETWORKS: ['ethereum', 'polygon', 'stellar', 'solana'],
  DEFAULT_ENVIRONMENT_TTL_DAYS: 90,
};

export function getSandboxConfig(
  tier: 'free' | 'pro' | 'enterprise' = 'free'
): { resourceLimits: SandboxResourceLimits; rateLimits: RateLimit; features: SandboxFeatures; dataRetentionDays: number } {
  return SANDBOX_TIERS[tier] || SANDBOX_TIERS.free;
}

export function createSandboxConfig(
  tier: 'free' | 'pro' | 'enterprise' = 'free',
  overrides?: Partial<SandboxConfig>
): SandboxConfig {
  const tierConfig = getSandboxConfig(tier);

  return {
    apiVersion: 'v1',
    isolationLevel: tier === 'enterprise' ? 'strict' : tier === 'pro' ? 'moderate' : 'relaxed',
    dataRetentionDays: tierConfig.dataRetentionDays,
    rateLimits: tierConfig.rateLimits,
    features: tierConfig.features,
    ...overrides,
  };
}
