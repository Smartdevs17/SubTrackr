import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SandboxConfig,
  SandboxEnvironment,
  TestSubscription,
  RateLimitConfig,
  SandboxStatus,
} from '../../types/sandbox';

const SANDBOX_STORAGE_KEY = '@subtrackr_sandbox_config';
const SANDBOX_DATA_KEY = '@subtrackr_sandbox_data';

const ENV_RATE_LIMITS: Record<SandboxEnvironment, RateLimitConfig> = {
  [SandboxEnvironment.DEVELOPMENT]: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    requestsPerDay: 10000,
    burstLimit: 100,
  },
  [SandboxEnvironment.STAGING]: {
    requestsPerMinute: 120,
    requestsPerHour: 5000,
    requestsPerDay: 50000,
    burstLimit: 200,
  },
  [SandboxEnvironment.TESTING]: {
    requestsPerMinute: 30,
    requestsPerHour: 500,
    requestsPerDay: 5000,
    burstLimit: 50,
  },
  [SandboxEnvironment.PRODUCTION]: {
    requestsPerMinute: 300,
    requestsPerHour: 10000,
    requestsPerDay: 100000,
    burstLimit: 500,
  },
};

const ENV_FEATURES: Record<SandboxEnvironment, string[]> = {
  [SandboxEnvironment.DEVELOPMENT]: [
    'subscription_create',
    'subscription_read',
    'subscription_update',
    'subscription_delete',
    'payment_process',
    'webhook_test',
    'analytics_read',
  ],
  [SandboxEnvironment.STAGING]: [
    'subscription_create',
    'subscription_read',
    'subscription_update',
    'subscription_delete',
    'payment_process',
    'webhook_test',
    'analytics_read',
    'invoice_generate',
    'export_data',
  ],
  [SandboxEnvironment.TESTING]: ['subscription_read', 'analytics_read'],
  [SandboxEnvironment.PRODUCTION]: [
    'subscription_create',
    'subscription_read',
    'subscription_update',
    'subscription_delete',
    'payment_process',
    'webhook_test',
    'analytics_read',
    'invoice_generate',
    'export_data',
    'team_management',
    'custom_reports',
  ],
};

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  id: 'sandbox-default',
  environment: SandboxEnvironment.DEVELOPMENT,
  name: 'Development Sandbox',
  description: 'Isolated sandbox environment for testing integrations',
  isActive: true,
  status: SandboxStatus.ACTIVE,
  dataIsolation: true,
  rateLimit: ENV_RATE_LIMITS[SandboxEnvironment.DEVELOPMENT],
  dataResetInterval: 'weekly',
  maxTestSubscriptions: 50,
  maxApiCalls: 10000,
  allowedFeatures: ENV_FEATURES[SandboxEnvironment.DEVELOPMENT],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
};

interface EnvironmentData {
  testSubscriptions: TestSubscription[];
  isolatedStorage: Map<string, unknown>;
  requestCounts: Map<string, { count: number; resetAt: number }>;
}

class SandboxService {
  private static instance: SandboxService;
  private config: SandboxConfig = DEFAULT_SANDBOX_CONFIG;
  private environmentData: Map<SandboxEnvironment, EnvironmentData> = new Map();

  private constructor() {
    this.initializeEnvironments();
    this.loadConfig();
  }

  static getInstance(): SandboxService {
    if (!SandboxService.instance) {
      SandboxService.instance = new SandboxService();
    }
    return SandboxService.instance;
  }

  private initializeEnvironments(): void {
    for (const env of Object.values(SandboxEnvironment)) {
      this.environmentData.set(env, {
        testSubscriptions: [],
        isolatedStorage: new Map(),
        requestCounts: new Map(),
      });
    }
  }

  private getCurrentEnvData(): EnvironmentData {
    return this.environmentData.get(this.config.environment)!;
  }

  private getEnvData(env: SandboxEnvironment): EnvironmentData {
    return this.environmentData.get(env)!;
  }

  private async loadConfig(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(SANDBOX_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.config = {
          ...DEFAULT_SANDBOX_CONFIG,
          ...parsed,
          createdAt: new Date(parsed.createdAt),
          updatedAt: new Date(parsed.updatedAt),
        };
      }
    } catch {
      this.config = DEFAULT_SANDBOX_CONFIG;
    }
    await this.loadEnvironmentData();
  }

  private async loadEnvironmentData(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(SANDBOX_DATA_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<
          string,
          { testSubscriptions: TestSubscription[] }
        >;
        for (const [env, data] of Object.entries(parsed)) {
          const envData = this.environmentData.get(env as SandboxEnvironment);
          if (envData && data.testSubscriptions) {
            envData.testSubscriptions = data.testSubscriptions.map((sub) => ({
              ...sub,
              nextBillingDate: new Date(sub.nextBillingDate),
              createdAt: new Date(sub.createdAt),
            }));
          }
        }
      }
    } catch {
      // Use default empty data
    }

    const currentEnvData = this.getCurrentEnvData();
    if (currentEnvData.testSubscriptions.length === 0) {
      this.generateTestData();
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      await AsyncStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(this.config));
    } catch (error) {
      console.warn('Failed to save sandbox config:', error);
    }
  }

  private async saveEnvironmentData(): Promise<void> {
    try {
      const dataToSave: Record<string, { testSubscriptions: TestSubscription[] }> = {};
      for (const [env, envData] of this.environmentData.entries()) {
        dataToSave[env] = { testSubscriptions: envData.testSubscriptions };
      }
      await AsyncStorage.setItem(SANDBOX_DATA_KEY, JSON.stringify(dataToSave));
    } catch (error) {
      console.warn('Failed to save sandbox environment data:', error);
    }
  }

  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  async updateConfig(updates: Partial<SandboxConfig>): Promise<SandboxConfig> {
    this.config = {
      ...this.config,
      ...updates,
      updatedAt: new Date(),
    };
    await this.saveConfig();
    return this.getConfig();
  }

  async switchEnvironment(environment: SandboxEnvironment): Promise<SandboxConfig> {
    const envData = this.getEnvData(environment);
    if (envData.testSubscriptions.length === 0) {
      this.generateTestDataForEnvironment(environment);
    }

    return this.updateConfig({
      environment,
      name: `${environment.charAt(0).toUpperCase() + environment.slice(1)} Sandbox`,
      rateLimit: ENV_RATE_LIMITS[environment],
      allowedFeatures: ENV_FEATURES[environment],
    });
  }

  isActive(): boolean {
    return this.config.isActive;
  }

  getEnvironment(): SandboxEnvironment {
    return this.config.environment;
  }

  isFeatureAllowed(feature: string): boolean {
    return this.config.allowedFeatures?.includes(feature) ?? true;
  }

  private generateTestDataForEnvironment(environment: SandboxEnvironment): TestSubscription[] {
    const testNames: Record<SandboxEnvironment, string[]> = {
      [SandboxEnvironment.DEVELOPMENT]: [
        'Netflix Premium',
        'Spotify Family',
        'Adobe Creative Cloud',
        'GitHub Teams',
        'Figma Professional',
        'Notion Team',
        'Slack Business+',
        'Zoom Pro',
        'Dropbox Business',
        'Microsoft 365',
      ],
      [SandboxEnvironment.STAGING]: [
        'Disney+ Bundle',
        'Apple One',
        'YouTube Premium',
        'Atlassian Cloud',
        'Linear Pro',
        'Vercel Pro',
        'Netlify Pro',
        'Heroku Basic',
        'DigitalOcean',
        'AWS Free Tier',
      ],
      [SandboxEnvironment.TESTING]: [
        'Test Service A',
        'Test Service B',
        'Test Service C',
        'Test Service D',
        'Test Service E',
      ],
      [SandboxEnvironment.PRODUCTION]: [
        'Netflix Premium',
        'Spotify Family',
        'Adobe Creative Cloud',
        'GitHub Teams',
        'Figma Professional',
      ],
    };

    const prices: Record<SandboxEnvironment, number[]> = {
      [SandboxEnvironment.DEVELOPMENT]: [
        15.99, 14.99, 54.99, 4.0, 12.0, 8.0, 12.5, 13.33, 9.99, 6.0,
      ],
      [SandboxEnvironment.STAGING]: [13.99, 16.95, 11.99, 7.75, 8.0, 20.0, 19.0, 7.0, 5.0, 0.0],
      [SandboxEnvironment.TESTING]: [9.99, 19.99, 29.99, 4.99, 14.99],
      [SandboxEnvironment.PRODUCTION]: [15.99, 14.99, 54.99, 4.0, 12.0],
    };

    const names = testNames[environment];
    const envPrices = prices[environment];
    const envData = this.getEnvData(environment);

    envData.testSubscriptions = names.map((name, index) => {
      const nextBilling = new Date();
      nextBilling.setDate(nextBilling.getDate() + Math.floor(Math.random() * 30) + 1);

      return {
        id: `test-sub-${generateId()}`,
        name,
        price: envPrices[index],
        currency: 'USD',
        status: 'active',
        billingCycle: 'monthly',
        nextBillingDate: nextBilling,
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 90 * 24 * 60 * 60 * 1000)),
      };
    });

    return envData.testSubscriptions;
  }

  generateTestData(): TestSubscription[] {
    return this.generateTestDataForEnvironment(this.config.environment);
  }

  getTestSubscriptions(): TestSubscription[] {
    return [...this.getCurrentEnvData().testSubscriptions];
  }

  getTestSubscriptionsForEnvironment(environment: SandboxEnvironment): TestSubscription[] {
    return [...this.getEnvData(environment).testSubscriptions];
  }

  addTestSubscription(subscription: Omit<TestSubscription, 'id' | 'createdAt'>): TestSubscription {
    const newSub: TestSubscription = {
      ...subscription,
      id: `test-sub-${generateId()}`,
      createdAt: new Date(),
    };
    this.getCurrentEnvData().testSubscriptions.push(newSub);
    this.saveEnvironmentData();
    return newSub;
  }

  removeTestSubscription(id: string): boolean {
    const envData = this.getCurrentEnvData();
    const initialLength = envData.testSubscriptions.length;
    envData.testSubscriptions = envData.testSubscriptions.filter((sub) => sub.id !== id);
    const removed = envData.testSubscriptions.length < initialLength;
    if (removed) {
      this.saveEnvironmentData();
    }
    return removed;
  }

  resetTestData(): void {
    const envData = this.getCurrentEnvData();
    envData.testSubscriptions = [];
    envData.isolatedStorage.clear();
    envData.requestCounts.clear();
    this.generateTestData();
    this.saveEnvironmentData();
  }

  resetEnvironmentData(environment: SandboxEnvironment): void {
    const envData = this.getEnvData(environment);
    envData.testSubscriptions = [];
    envData.isolatedStorage.clear();
    envData.requestCounts.clear();
    this.generateTestDataForEnvironment(environment);
    this.saveEnvironmentData();
  }

  getIsolatedData<T>(key: string): T | null {
    return (this.getCurrentEnvData().isolatedStorage.get(key) as T) ?? null;
  }

  setIsolatedData<T>(key: string, value: T): void {
    this.getCurrentEnvData().isolatedStorage.set(key, value);
  }

  getIsolatedDataForEnvironment<T>(environment: SandboxEnvironment, key: string): T | null {
    return (this.getEnvData(environment).isolatedStorage.get(key) as T) ?? null;
  }

  setIsolatedDataForEnvironment<T>(environment: SandboxEnvironment, key: string, value: T): void {
    this.getEnvData(environment).isolatedStorage.set(key, value);
  }

  clearIsolatedData(): void {
    this.getCurrentEnvData().isolatedStorage.clear();
  }

  async checkRateLimit(
    apiKeyId: string
  ): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
    const envData = this.getCurrentEnvData();
    const rateLimit = this.config.rateLimit;
    const now = Date.now();
    const minuteKey = `${apiKeyId}:${Math.floor(now / 60000)}`;

    const entry = envData.requestCounts.get(minuteKey);
    if (entry && entry.count >= rateLimit.requestsPerMinute) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter };
    }

    if (entry) {
      entry.count++;
    } else {
      envData.requestCounts.set(minuteKey, { count: 1, resetAt: now + 60000 });
    }

    const remaining = rateLimit.requestsPerMinute - (entry?.count || 1);
    return { allowed: true, remaining: Math.max(0, remaining) };
  }

  validateSandboxOperation(operation: string): { valid: boolean; reason?: string } {
    if (!this.config.isActive) {
      return { valid: false, reason: 'Sandbox is currently inactive' };
    }

    if (!this.isFeatureAllowed(operation)) {
      return { valid: false, reason: `Operation '${operation}' is not allowed in sandbox` };
    }

    const env = this.config.environment;
    if (env === SandboxEnvironment.PRODUCTION) {
      return { valid: false, reason: 'Write operations are not allowed in production sandbox' };
    }

    return { valid: true };
  }

  getEnvironmentStats(): Record<
    SandboxEnvironment,
    { subscriptionCount: number; storageKeys: number }
  > {
    const stats: Record<string, { subscriptionCount: number; storageKeys: number }> = {};
    for (const [env, envData] of this.environmentData.entries()) {
      stats[env] = {
        subscriptionCount: envData.testSubscriptions.length,
        storageKeys: envData.isolatedStorage.size,
      };
    }
    return stats as Record<SandboxEnvironment, { subscriptionCount: number; storageKeys: number }>;
  }

  isEnvironmentIsolated(env1: SandboxEnvironment, env2: SandboxEnvironment): boolean {
    if (env1 === env2) return true;
    const data1 = this.getEnvData(env1);
    const data2 = this.getEnvData(env2);
    const subs1Ids = new Set(data1.testSubscriptions.map((s) => s.id));
    const hasOverlap = data2.testSubscriptions.some((s) => subs1Ids.has(s.id));
    return !hasOverlap;
  }
}

export const sandboxService = SandboxService.getInstance();
