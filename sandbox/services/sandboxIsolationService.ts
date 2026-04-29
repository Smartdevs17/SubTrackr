import {
  SandboxEnvironment,
  SandboxConfig,
  Developer,
  SandboxFeatures,
  RateLimit,
  ApiKey,
  SandboxTestData,
} from '../types/sandbox';
import { createSandboxConfig, SANDBOX_CONSTANTS } from '../config/sandboxConfig';

export class SandboxIsolationService {
  private environments: Map<string, SandboxEnvironment> = new Map();
  private developers: Map<string, Developer> = new Map();

  async createSandboxEnvironment(
    developerId: string,
    tier: 'free' | 'pro' | 'enterprise' = 'free'
  ): Promise<SandboxEnvironment> {
    const config = createSandboxConfig(tier);
    const envId = this.generateId();
    const testData = this.generateFullTestData();

    const environment: SandboxEnvironment = {
      id: envId,
      developerId,
      name: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Sandbox`,
      config,
      apiKeys: [],
      testData,
      usage: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        last24Hours: Array.from({ length: 24 }, (_, i) => ({
          hour: i,
          requests: 0,
          errors: 0,
          avgResponseTime: 0,
        })),
        last7Days: Array.from({ length: 7 }, (_, i) => {
          const date = new Date();
          date.setDate(date.getDate() - i);
          return {
            date: date.toISOString().split('T')[0],
            requests: 0,
            errors: 0,
            avgResponseTime: 0,
          };
        }),
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + config.dataRetentionDays * 24 * 60 * 60 * 1000),
    };

    this.environments.set(environment.id, environment);
    return environment;
  }

  async getEnvironment(environmentId: string): Promise<SandboxEnvironment | null> {
    return this.environments.get(environmentId) || null;
  }

  async getEnvironmentsByDeveloper(developerId: string): Promise<SandboxEnvironment[]> {
    return Array.from(this.environments.values()).filter(
      (env) => env.developerId === developerId
    );
  }

  async updateEnvironment(
    environmentId: string,
    updates: Partial<SandboxConfig>
  ): Promise<SandboxEnvironment | null> {
    const environment = this.environments.get(environmentId);
    if (!environment) return null;

    environment.config = {
      ...environment.config,
      ...updates,
    };
    environment.updatedAt = new Date();

    this.environments.set(environmentId, environment);
    return environment;
  }

  async deleteEnvironment(environmentId: string): Promise<boolean> {
    const environment = this.environments.get(environmentId);
    if (!environment) return false;

    environment.status = 'deleted';
    environment.updatedAt = new Date();
    this.environments.set(environmentId, environment);
    return true;
  }

  async suspendEnvironment(environmentId: string): Promise<boolean> {
    const environment = this.environments.get(environmentId);
    if (!environment) return false;

    environment.status = 'suspended';
    environment.updatedAt = new Date();
    this.environments.set(environmentId, environment);
    return true;
  }

  async reactivateEnvironment(environmentId: string): Promise<boolean> {
    const environment = this.environments.get(environmentId);
    if (!environment) return false;

    environment.status = 'active';
    environment.updatedAt = new Date();
    this.environments.set(environmentId, environment);
    return true;
  }

  async validateIsolation(environmentId: string): Promise<IsolationValidation> {
    const environment = this.environments.get(environmentId);
    if (!environment) {
      return { valid: false, errors: ['Environment not found'] };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    if (environment.status !== 'active') {
      errors.push(`Environment is ${environment.status}`);
    }

    if (environment.expiresAt && environment.expiresAt < new Date()) {
      errors.push('Environment has expired');
    }

    if (environment.config.isolationLevel === 'strict') {
      this.validateStrictIsolation(environment, errors, warnings);
    }

    this.validateRateLimits(environment.config.rateLimits, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private validateStrictIsolation(
    environment: SandboxEnvironment,
    errors: string[],
    warnings: string[]
  ): void {
    if (environment.apiKeys.length > SANDBOX_CONSTANTS.MAX_API_KEYS_PER_SANDBOX) {
      errors.push(
        `Too many API keys: ${environment.apiKeys.length}/${SANDBOX_CONSTANTS.MAX_API_KEYS_PER_SANDBOX}`
      );
    }

    const activeKeys = environment.apiKeys.filter((k) => k.status === 'active');
    if (activeKeys.length === 0) {
      warnings.push('No active API keys');
    }
  }

  private validateRateLimits(
    rateLimits: RateLimit,
    errors: string[],
    _warnings: string[]
  ): void {
    if (rateLimits.requestsPerMinute <= 0) {
      errors.push('Invalid requestsPerMinute rate limit');
    }
    if (rateLimits.requestsPerHour < rateLimits.requestsPerMinute) {
      errors.push('requestsPerHour must be >= requestsPerMinute');
    }
    if (rateLimits.requestsPerDay < rateLimits.requestsPerHour) {
      errors.push('requestsPerDay must be >= requestsPerHour');
    }
  }

  async registerDeveloper(
    email: string,
    name: string,
    company: string
  ): Promise<Developer> {
    const existingDeveloper = Array.from(this.developers.values()).find(
      (d) => d.email === email
    );

    if (existingDeveloper) {
      throw new Error('Developer already registered');
    }

    const developer: Developer = {
      id: this.generateId(),
      email,
      name,
      company,
      sandboxEnvironments: [],
      onboardingStatus: {
        step: 0,
        completed: false,
        steps: [
          {
            id: 'register',
            title: 'Register Account',
            description: 'Create your developer account',
            completed: true,
            completedAt: new Date(),
          },
          {
            id: 'create-sandbox',
            title: 'Create Sandbox',
            description: 'Set up your sandbox environment',
            completed: false,
            completedAt: null,
          },
          {
            id: 'generate-api-key',
            title: 'Generate API Key',
            description: 'Create your first API key',
            completed: false,
            completedAt: null,
          },
          {
            id: 'make-first-request',
            title: 'Make First Request',
            description: 'Test your integration with a sample request',
            completed: false,
            completedAt: null,
          },
          {
            id: 'explore-docs',
            title: 'Explore Documentation',
            description: 'Review API documentation and guides',
            completed: false,
            completedAt: null,
          },
        ],
      },
      createdAt: new Date(),
    };

    this.developers.set(developer.id, developer);
    return developer;
  }

  async getDeveloper(developerId: string): Promise<Developer | null> {
    return this.developers.get(developerId) || null;
  }

  async updateOnboardingStep(
    developerId: string,
    stepId: string,
    completed: boolean
  ): Promise<Developer | null> {
    const developer = this.developers.get(developerId);
    if (!developer) return null;

    const step = developer.onboardingStatus.steps.find((s) => s.id === stepId);
    if (!step) return null;

    step.completed = completed;
    step.completedAt = completed ? new Date() : null;

    developer.onboardingStatus.step = developer.onboardingStatus.steps.filter(
      (s) => s.completed
    ).length;
    developer.onboardingStatus.completed =
      developer.onboardingStatus.steps.every((s) => s.completed);

    this.developers.set(developerId, developer);
    return developer;
  }

  async resetTestData(environmentId: string): Promise<boolean> {
    const environment = this.environments.get(environmentId);
    if (!environment) return false;

    environment.testData = this.generateFullTestData();
    environment.updatedAt = new Date();
    this.environments.set(environmentId, environment);
    return true;
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateFullTestData(): SandboxTestData {
    const subscriptions = this.generateTestSubscriptions();
    const payments = this.generateTestPayments(subscriptions);
    const webhooks = this.generateTestWebhooks();
    const users = this.generateTestUsers();

    return { subscriptions, payments, webhooks, users };
  }

  private generateTestSubscriptions(): SandboxTestData['subscriptions'] {
    const categories = ['streaming', 'software', 'gaming', 'productivity', 'fitness'];
    const names = ['Netflix', 'Spotify', 'Adobe CC', 'Slack', 'Gym Membership', 'GitHub Pro', 'Figma', 'Notion'];

    return names.map((name, index) => ({
      id: `sub_test_${index + 1}`,
      name,
      category: categories[index % categories.length],
      price: Math.floor(Math.random() * 50) + 5,
      currency: 'USD',
      billingCycle: (['monthly', 'yearly', 'weekly'] as const)[Math.floor(Math.random() * 3)],
      status: 'active' as const,
      startDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000),
      nextBillingDate: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000),
    }));
  }

  private generateTestPayments(subscriptions: SandboxTestData['subscriptions']): SandboxTestData['payments'] {
    const payments: SandboxTestData['payments'] = [];
    const methods: Array<'card' | 'crypto' | 'bank'> = ['card', 'crypto', 'bank'];

    subscriptions.forEach((sub) => {
      for (let i = 0; i < 3; i++) {
        payments.push({
          id: `pay_test_${sub.id}_${i}`,
          subscriptionId: sub.id,
          amount: sub.price,
          currency: sub.currency,
          status: (['pending', 'completed', 'failed'] as const)[Math.floor(Math.random() * 3)],
          method: methods[Math.floor(Math.random() * methods.length)],
          timestamp: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000),
        });
      }
    });

    return payments;
  }

  private generateTestWebhooks(): SandboxTestData['webhooks'] {
    return [
      {
        id: 'wh_test_1',
        url: 'https://example.com/webhook',
        events: ['subscription.created', 'payment.completed'],
        secret: 'whsec_test_' + Math.random().toString(36).substring(2, 16),
        status: 'active',
      },
    ];
  }

  private generateTestUsers(): SandboxTestData['users'] {
    return [
      {
        id: 'user_test_1',
        email: 'developer@example.com',
        name: 'Test Developer',
        plan: 'pro',
        apiKeys: [
          {
            id: 'key_test_1',
            key: 'sk_test_' + Math.random().toString(36).substring(2, 24),
            name: 'Default API Key',
            permissions: ['read', 'write'],
            lastUsed: new Date(),
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          },
        ],
      },
    ];
  }
}

export interface IsolationValidation {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}
