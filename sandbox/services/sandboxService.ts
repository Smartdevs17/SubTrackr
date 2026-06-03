import {
  SandboxEnvironment,
  SandboxConfig,
  SandboxTestData,
  SandboxMetrics,
  SandboxIsolationContext,
  SandboxResourceLimits,
  TestSubscription,
  TestPayment,
  TestWebhook,
  TestUser,
} from '../types/sandbox';

export class SandboxService {
  private environments: Map<string, SandboxEnvironment> = new Map();
  private configs: Map<string, SandboxConfig> = new Map();
  private testData: Map<string, SandboxTestData> = new Map();
  private metrics: Map<string, SandboxMetrics> = new Map();

  async createEnvironment(
    developerId: string,
    name: string,
    config?: Partial<SandboxConfig>
  ): Promise<SandboxEnvironment> {
    const envId = this.generateEnvironmentId();

    const environment: SandboxEnvironment = {
      id: envId,
      developerId,
      name,
      config: {
        apiVersion: 'v1',
        isolationLevel: config?.features ? 'strict' : 'moderate',
        dataRetentionDays: 90,
        rateLimits: {
          requestsPerMinute: 60,
          requestsPerHour: 1000,
          requestsPerDay: 10000,
          maxConcurrentRequests: 10,
        },
        features: {
          cryptoPayments: true,
          webhooks: true,
          analytics: true,
          invoicing: true,
          sla: true,
          gamification: false,
          ...config?.features,
        },
        testDataSeed: config?.testDataSeed || this.generateSeed(),
        ...config,
      },
      apiKeys: [],
      testData: { subscriptions: [], payments: [], webhooks: [], users: [] },
      usage: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        last24Hours: [],
        last7Days: [],
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    };

    this.environments.set(envId, environment);
    this.configs.set(envId, environment.config);

    const testData = await this.generateTestData(envId);
    this.testData.set(envId, testData);
    environment.testData = testData;

    this.metrics.set(envId, {
      requestCount: 0,
      errorCount: 0,
      avgResponseTime: 0,
      storageUsedMB: 0,
      activeConnections: 0,
      lastActivity: new Date(),
    });

    return environment;
  }

  async getEnvironment(envId: string): Promise<SandboxEnvironment | null> {
    return this.environments.get(envId) || null;
  }

  async getEnvironmentsByDeveloper(developerId: string): Promise<SandboxEnvironment[]> {
    return Array.from(this.environments.values()).filter((env) => env.developerId === developerId);
  }

  async updateEnvironment(
    envId: string,
    updates: Partial<SandboxEnvironment>
  ): Promise<SandboxEnvironment | null> {
    const env = this.environments.get(envId);
    if (!env) return null;

    const updatedEnv = { ...env, ...updates, updatedAt: new Date() };
    this.environments.set(envId, updatedEnv);
    return updatedEnv;
  }

  async deleteEnvironment(envId: string): Promise<boolean> {
    const env = this.environments.get(envId);
    if (!env) return false;

    env.status = 'deleted';
    this.environments.set(envId, env);
    return true;
  }

  async suspendEnvironment(envId: string): Promise<boolean> {
    const env = this.environments.get(envId);
    if (!env) return false;

    env.status = 'suspended';
    this.environments.set(envId, env);
    return true;
  }

  async getConfig(envId: string): Promise<SandboxConfig | null> {
    return this.configs.get(envId) || null;
  }

  async updateConfig(envId: string, config: Partial<SandboxConfig>): Promise<SandboxConfig | null> {
    const existingConfig = this.configs.get(envId);
    if (!existingConfig) return null;

    const updatedConfig = { ...existingConfig, ...config };
    this.configs.set(envId, updatedConfig);
    return updatedConfig;
  }

  async getTestData(envId: string): Promise<SandboxTestData | null> {
    return this.testData.get(envId) || null;
  }

  async resetTestData(envId: string): Promise<SandboxTestData | null> {
    const env = this.environments.get(envId);
    if (!env) return null;

    const newData = await this.generateTestData(envId);
    this.testData.set(envId, newData);
    env.testData = newData;
    return newData;
  }

  async getMetrics(envId: string): Promise<SandboxMetrics | null> {
    return this.metrics.get(envId) || null;
  }

  async recordRequest(envId: string, responseTime: number, isError: boolean): Promise<void> {
    const metrics = this.metrics.get(envId);
    if (!metrics) return;

    metrics.requestCount++;
    if (isError) metrics.errorCount++;
    metrics.avgResponseTime =
      (metrics.avgResponseTime * (metrics.requestCount - 1) + responseTime) / metrics.requestCount;
    metrics.lastActivity = new Date();

    this.metrics.set(envId, metrics);
  }

  async getIsolationContext(envId: string): Promise<SandboxIsolationContext | null> {
    const env = this.environments.get(envId);
    const metrics = this.metrics.get(envId);
    if (!env || !metrics) return null;

    const isWithinLimits = this.checkResourceLimits(
      env.config.features
        ? {
            maxRequestsPerMinute: env.config.rateLimits.requestsPerMinute,
            maxRequestsPerDay: env.config.rateLimits.requestsPerDay,
            maxStorageMB: 100,
            maxConcurrentConnections: env.config.rateLimits.maxConcurrentRequests,
            maxSubscriptions: 50,
            maxWebhooks: 5,
          }
        : this.getDefaultResourceLimits(),
      metrics
    );

    return {
      environmentId: envId,
      developerId: env.developerId,
      dataNamespace: `sandbox_${envId}`,
      resourceQuota: env.config.features
        ? {
            maxRequestsPerMinute: env.config.rateLimits.requestsPerMinute,
            maxRequestsPerDay: env.config.rateLimits.requestsPerDay,
            maxStorageMB: 100,
            maxConcurrentConnections: env.config.rateLimits.maxConcurrentRequests,
            maxSubscriptions: 50,
            maxWebhooks: 5,
          }
        : this.getDefaultResourceLimits(),
      currentUsage: metrics,
      isWithinLimits,
    };
  }

  async validateAccess(envId: string, apiKey: string): Promise<boolean> {
    const env = this.environments.get(envId);
    if (!env || env.status !== 'active') return false;

    return env.apiKeys.some((key) => key.key === apiKey && key.status === 'active');
  }

  private getDefaultResourceLimits(): SandboxResourceLimits {
    return {
      maxRequestsPerMinute: 60,
      maxRequestsPerDay: 10000,
      maxStorageMB: 100,
      maxConcurrentConnections: 10,
      maxSubscriptions: 50,
      maxWebhooks: 5,
    };
  }

  private generateEnvironmentId(): string {
    return `sbx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateSeed(): string {
    return Math.random().toString(36).substring(2, 16);
  }

  private async generateTestData(_envId: string): Promise<SandboxTestData> {
    const subscriptions = this.generateTestSubscriptions();
    const payments = this.generateTestPayments(subscriptions);
    const webhooks = this.generateTestWebhooks();
    const users = this.generateTestUsers();

    return { subscriptions, payments, webhooks, users };
  }

  private generateTestSubscriptions(): TestSubscription[] {
    const categories = ['streaming', 'software', 'gaming', 'productivity', 'fitness'];
    const names = [
      'Netflix',
      'Spotify',
      'Adobe CC',
      'Slack',
      'Gym Membership',
      'GitHub Pro',
      'Figma',
      'Notion',
    ];

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

  private generateTestPayments(subscriptions: TestSubscription[]): TestPayment[] {
    const payments: TestPayment[] = [];
    const methods: ('card' | 'crypto' | 'bank')[] = ['card', 'crypto', 'bank'];

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

  private generateTestWebhooks(): TestWebhook[] {
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

  private generateTestUsers(): TestUser[] {
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

  private checkResourceLimits(limits: SandboxResourceLimits, metrics: SandboxMetrics): boolean {
    return (
      metrics.requestCount < limits.maxRequestsPerDay &&
      metrics.storageUsedMB < limits.maxStorageMB &&
      metrics.activeConnections < limits.maxConcurrentConnections
    );
  }
}

export const sandboxService = new SandboxService();
