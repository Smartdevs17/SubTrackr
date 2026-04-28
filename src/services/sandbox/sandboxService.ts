import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SandboxConfig,
  SandboxEnvironment,
  TestSubscription,
} from '../../types/sandbox';
import { SubscriptionCategory, BillingCycle } from '../../types/subscription';

const SANDBOX_STORAGE_KEY = '@subtrackr_sandbox_config';

const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
};

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  id: 'sandbox-default',
  environment: SandboxEnvironment.DEVELOPMENT,
  name: 'Development Sandbox',
  description: 'Isolated sandbox environment for testing integrations',
  isActive: true,
  dataResetInterval: 'weekly',
  maxTestSubscriptions: 50,
  maxApiCalls: 10000,
  allowedFeatures: [
    'subscription_create',
    'subscription_read',
    'subscription_update',
    'subscription_delete',
    'payment_process',
    'webhook_test',
    'analytics_read',
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
};

class SandboxService {
  private static instance: SandboxService;
  private config: SandboxConfig = DEFAULT_SANDBOX_CONFIG;
  private testSubscriptions: TestSubscription[] = [];
  private isolatedStorage: Map<string, unknown> = new Map();

  private constructor() {
    this.loadConfig();
    this.generateTestData();
  }

  static getInstance(): SandboxService {
    if (!SandboxService.instance) {
      SandboxService.instance = new SandboxService();
    }
    return SandboxService.instance;
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
  }

  private async saveConfig(): Promise<void> {
    try {
      await AsyncStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(this.config));
    } catch (error) {
      console.warn('Failed to save sandbox config:', error);
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
    return this.updateConfig({
      environment,
      name: `${environment.charAt(0).toUpperCase() + environment.slice(1)} Sandbox`,
    });
  }

  isActive(): boolean {
    return this.config.isActive;
  }

  getEnvironment(): SandboxEnvironment {
    return this.config.environment;
  }

  isFeatureAllowed(feature: string): boolean {
    return this.config.allowedFeatures.includes(feature);
  }

  generateTestData(): TestSubscription[] {
    const testNames = [
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
    ];

    const categories = [
      SubscriptionCategory.STREAMING,
      SubscriptionCategory.STREAMING,
      SubscriptionCategory.SOFTWARE,
      SubscriptionCategory.SOFTWARE,
      SubscriptionCategory.SOFTWARE,
      SubscriptionCategory.PRODUCTIVITY,
      SubscriptionCategory.PRODUCTIVITY,
      SubscriptionCategory.SOFTWARE,
      SubscriptionCategory.SOFTWARE,
      SubscriptionCategory.SOFTWARE,
    ];

    const prices = [15.99, 14.99, 54.99, 4.00, 12.00, 8.00, 12.50, 13.33, 9.99, 6.00];
    const cycles = [
      BillingCycle.MONTHLY,
      BillingCycle.MONTHLY,
      BillingCycle.MONTHLY,
      BillingCycle.MONTHLY,
      BillingCycle.MONTHLY,
      BillingCycle.MONTHLY,
      BillingCycle.MONTHLY,
      BillingCycle.MONTHLY,
      BillingCycle.MONTHLY,
      BillingCycle.MONTHLY,
    ];

    this.testSubscriptions = testNames.map((name, index) => {
      const nextBilling = new Date();
      nextBilling.setDate(nextBilling.getDate() + Math.floor(Math.random() * 30) + 1);

      return {
        id: `test-sub-${generateId()}`,
        name,
        price: prices[index],
        currency: 'USD',
        status: 'active' as const,
        billingCycle: cycles[index],
        nextBillingDate: nextBilling,
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 90 * 24 * 60 * 60 * 1000)),
      };
    });

    return this.testSubscriptions;
  }

  getTestSubscriptions(): TestSubscription[] {
    return [...this.testSubscriptions];
  }

  addTestSubscription(subscription: Omit<TestSubscription, 'id' | 'createdAt'>): TestSubscription {
    const newSub: TestSubscription = {
      ...subscription,
      id: `test-sub-${generateId()}`,
      createdAt: new Date(),
    };
    this.testSubscriptions.push(newSub);
    return newSub;
  }

  removeTestSubscription(id: string): boolean {
    const initialLength = this.testSubscriptions.length;
    this.testSubscriptions = this.testSubscriptions.filter((sub) => sub.id !== id);
    return this.testSubscriptions.length < initialLength;
  }

  resetTestData(): void {
    this.testSubscriptions = [];
    this.isolatedStorage.clear();
    this.generateTestData();
  }

  getIsolatedData<T>(key: string): T | null {
    return (this.isolatedStorage.get(key) as T) ?? null;
  }

  setIsolatedData<T>(key: string, value: T): void {
    this.isolatedStorage.set(key, value);
  }

  clearIsolatedData(): void {
    this.isolatedStorage.clear();
  }

  async checkRateLimit(_apiKeyId: string): Promise<{ allowed: boolean; remaining: number }> {
    return {
      allowed: true,
      remaining: this.config.maxApiCalls,
    };
  }

  validateSandboxOperation(operation: string): { valid: boolean; reason?: string } {
    if (!this.config.isActive) {
      return { valid: false, reason: 'Sandbox is currently inactive' };
    }

    if (!this.isFeatureAllowed(operation)) {
      return { valid: false, reason: `Operation '${operation}' is not allowed in sandbox` };
    }

    return { valid: true };
  }
}

export const sandboxService = SandboxService.getInstance();
