import {
  Developer,
  ApiKey,
  ApiPermission,
  UsageMetrics,
  BillingInfo,
  DeveloperDashboard,
  Documentation,
  IntegrationGuide,
  ActivityLog,
  Alert,
} from '../types/developer';
import { sandboxService } from '../../sandbox/services/sandboxService';

export class DeveloperPortalService {
  private developers: Map<string, Developer> = new Map();
  private documentation: Map<string, Documentation> = new Map();
  private integrationGuides: Map<string, IntegrationGuide> = new Map();
  private activityLogs: Map<string, ActivityLog[]> = new Map();
  private alerts: Map<string, Alert[]> = new Map();

  async registerDeveloper(email: string, name: string, company?: string): Promise<Developer> {
    const existingDeveloper = this.findDeveloperByEmail(email);
    if (existingDeveloper) {
      throw new Error('Developer with this email already exists');
    }

    const developerId = this.generateDeveloperId();
    const developer: Developer = {
      id: developerId,
      email,
      name,
      company,
      status: 'pending',
      tier: 'free',
      onboardingStatus: {
        step: 'registration',
        completedSteps: ['registration'],
        startedAt: new Date(),
      },
      apiKeys: [],
      sandboxEnvironments: [],
      usage: this.initializeUsageMetrics(),
      billing: this.initializeBillingInfo(),
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.developers.set(developerId, developer);
    this.activityLogs.set(developerId, []);
    this.alerts.set(developerId, []);

    await this.logActivity(developerId, 'developer.registered', 'developer', developerId);
    await this.createAlert(
      developerId,
      'info',
      'Welcome!',
      'Your developer account has been created. Please verify your email to continue.'
    );

    return developer;
  }

  async verifyEmail(developerId: string, token: string): Promise<boolean> {
    const developer = this.developers.get(developerId);
    if (!developer) return false;

    if (developer.onboardingStatus.verificationToken !== token) {
      return false;
    }

    if (
      developer.onboardingStatus.verificationExpiresAt &&
      developer.onboardingStatus.verificationExpiresAt < new Date()
    ) {
      return false;
    }

    developer.status = 'active';
    developer.onboardingStatus.step = 'profile_completion';
    developer.onboardingStatus.completedSteps.push('email_verification');
    developer.updatedAt = new Date();

    this.developers.set(developerId, developer);
    await this.logActivity(developerId, 'email.verified', 'developer', developerId);

    return true;
  }

  async completeOnboarding(developerId: string): Promise<Developer | null> {
    const developer = this.developers.get(developerId);
    if (!developer) return null;

    const sandboxEnv = await sandboxService.createEnvironment(developerId, 'Default Sandbox');

    developer.onboardingStatus.step = 'completed';
    developer.onboardingStatus.completedSteps.push(
      'profile_completion',
      'sandbox_setup',
      'completed'
    );
    developer.onboardingStatus.completedAt = new Date();
    developer.sandboxEnvironments.push(sandboxEnv.id);
    developer.updatedAt = new Date();

    this.developers.set(developerId, developer);

    const _apiKey = await this.createApiKey(developerId, 'Default API Key', 'test', [
      'subscriptions:read',
      'subscriptions:write',
      'payments:read',
    ]);

    await this.logActivity(developerId, 'onboarding.completed', 'developer', developerId);
    await this.createAlert(
      developerId,
      'success',
      'Onboarding Complete',
      'Your developer account is now fully set up. You can start using the API!'
    );

    return developer;
  }

  async getDeveloper(developerId: string): Promise<Developer | null> {
    return this.developers.get(developerId) || null;
  }

  async updateDeveloper(
    developerId: string,
    updates: Partial<Developer>
  ): Promise<Developer | null> {
    const developer = this.developers.get(developerId);
    if (!developer) return null;

    const updatedDeveloper = { ...developer, ...updates, updatedAt: new Date() };
    this.developers.set(developerId, updatedDeveloper);
    return updatedDeveloper;
  }

  async createApiKey(
    developerId: string,
    name: string,
    type: 'test' | 'production',
    permissions: ApiPermission[]
  ): Promise<ApiKey | null> {
    const developer = this.developers.get(developerId);
    if (!developer) return null;

    const apiKey: ApiKey = {
      id: this.generateApiKeyId(),
      key: this.generateApiKey(type),
      name,
      type,
      permissions,
      rateLimit: this.getDefaultRateLimit(developer.tier),
      usageCount: 0,
      status: 'active',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    };

    developer.apiKeys.push(apiKey);
    developer.updatedAt = new Date();
    this.developers.set(developerId, developer);

    await this.logActivity(developerId, 'apikey.created', 'apikey', apiKey.id);
    return apiKey;
  }

  async revokeApiKey(developerId: string, apiKeyId: string): Promise<boolean> {
    const developer = this.developers.get(developerId);
    if (!developer) return false;

    const apiKey = developer.apiKeys.find((key) => key.id === apiKeyId);
    if (!apiKey) return false;

    apiKey.status = 'revoked';
    apiKey.revokedAt = new Date();
    developer.updatedAt = new Date();
    this.developers.set(developerId, developer);

    await this.logActivity(developerId, 'apikey.revoked', 'apikey', apiKeyId);
    return true;
  }

  async getApiKeys(developerId: string): Promise<ApiKey[]> {
    const developer = this.developers.get(developerId);
    if (!developer) return [];
    return developer.apiKeys;
  }

  async trackUsage(
    developerId: string,
    endpoint: string,
    method: string,
    responseTime: number,
    success: boolean
  ): Promise<void> {
    const developer = this.developers.get(developerId);
    if (!developer) return;

    developer.usage.totalRequests++;
    if (success) {
      developer.usage.successfulRequests++;
    } else {
      developer.usage.failedRequests++;
    }

    developer.usage.avgResponseTime =
      (developer.usage.avgResponseTime * (developer.usage.totalRequests - 1) + responseTime) /
      developer.usage.totalRequests;

    developer.updatedAt = new Date();
    this.developers.set(developerId, developer);
  }

  async getUsageMetrics(developerId: string): Promise<UsageMetrics | null> {
    const developer = this.developers.get(developerId);
    if (!developer) return null;
    return developer.usage;
  }

  async getDashboard(developerId: string): Promise<DeveloperDashboard | null> {
    const developer = this.developers.get(developerId);
    if (!developer) return null;

    const sandboxEnvironments = await Promise.all(
      developer.sandboxEnvironments.map(async (envId) => {
        const env = await sandboxService.getEnvironment(envId);
        const metrics = await sandboxService.getMetrics(envId);
        return {
          id: envId,
          name: env?.name || 'Unknown',
          status: env?.status || 'unknown',
          requestCount: metrics?.requestCount || 0,
          lastActivity: metrics?.lastActivity || new Date(),
        };
      })
    );

    const recentActivity = this.activityLogs.get(developerId) || [];
    const alerts = this.alerts.get(developerId) || [];

    return {
      developer,
      sandboxEnvironments,
      recentActivity: recentActivity.slice(-10),
      alerts: alerts.filter((a) => !a.isRead).slice(-5),
      quickLinks: this.getQuickLinks(developer.tier),
    };
  }

  async getDocumentation(category?: string): Promise<Documentation[]> {
    const docs = Array.from(this.documentation.values());
    if (category) {
      return docs.filter((doc) => doc.category === category && doc.isPublished);
    }
    return docs.filter((doc) => doc.isPublished);
  }

  async getIntegrationGuides(platform?: string): Promise<IntegrationGuide[]> {
    const guides = Array.from(this.integrationGuides.values());
    if (platform) {
      return guides.filter((guide) => guide.platform.toLowerCase() === platform.toLowerCase());
    }
    return guides;
  }

  async addDocumentation(
    doc: Omit<Documentation, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Documentation> {
    const documentation: Documentation = {
      ...doc,
      id: this.generateDocId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.documentation.set(documentation.id, documentation);
    return documentation;
  }

  async addIntegrationGuide(guide: Omit<IntegrationGuide, 'id'>): Promise<IntegrationGuide> {
    const integrationGuide: IntegrationGuide = {
      ...guide,
      id: this.generateGuideId(),
    };

    this.integrationGuides.set(integrationGuide.id, integrationGuide);
    return integrationGuide;
  }

  private findDeveloperByEmail(email: string): Developer | undefined {
    return Array.from(this.developers.values()).find((dev) => dev.email === email);
  }

  private generateDeveloperId(): string {
    return `dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateApiKeyId(): string {
    return `key_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateApiKey(type: string): string {
    const prefix = type === 'test' ? 'sk_test_' : 'sk_live_';
    return prefix + Math.random().toString(36).substr(2, 24);
  }

  private generateDocId(): string {
    return `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateGuideId(): string {
    return `guide_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDefaultRateLimit(tier: string): {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
    burstLimit: number;
  } {
    switch (tier) {
      case 'enterprise':
        return {
          requestsPerMinute: 1000,
          requestsPerHour: 50000,
          requestsPerDay: 500000,
          burstLimit: 2000,
        };
      case 'pro':
        return {
          requestsPerMinute: 100,
          requestsPerHour: 5000,
          requestsPerDay: 50000,
          burstLimit: 200,
        };
      default:
        return {
          requestsPerMinute: 20,
          requestsPerHour: 1000,
          requestsPerDay: 10000,
          burstLimit: 50,
        };
    }
  }

  private initializeUsageMetrics(): UsageMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      dataTransferMB: 0,
      period: { start: new Date(), end: new Date() },
      dailyBreakdown: [],
      endpointBreakdown: [],
    };
  }

  private initializeBillingInfo(): BillingInfo {
    return {
      plan: 'free',
      monthlyPrice: 0,
      currency: 'USD',
      invoices: [],
      usageCharges: [],
    };
  }

  private async logActivity(
    developerId: string,
    action: string,
    resource: string,
    resourceId: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    const logs = this.activityLogs.get(developerId) || [];
    logs.push({
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      action,
      resource,
      resourceId,
      timestamp: new Date(),
      details,
    });
    this.activityLogs.set(developerId, logs);
  }

  private async createAlert(
    developerId: string,
    type: 'info' | 'warning' | 'error' | 'success',
    title: string,
    message: string,
    actionUrl?: string
  ): Promise<void> {
    const alerts = this.alerts.get(developerId) || [];
    alerts.push({
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message,
      timestamp: new Date(),
      isRead: false,
      actionUrl,
    });
    this.alerts.set(developerId, alerts);
  }

  private getQuickLinks(
    tier: string
  ): { title: string; description: string; url: string; icon: string }[] {
    const links = [
      {
        title: 'API Documentation',
        description: 'View API reference documentation',
        url: '/docs/api',
        icon: 'book',
      },
      {
        title: 'Sandbox',
        description: 'Access your sandbox environment',
        url: '/sandbox',
        icon: 'code',
      },
      {
        title: 'API Keys',
        description: 'Manage your API keys',
        url: '/settings/api-keys',
        icon: 'key',
      },
      {
        title: 'Usage',
        description: 'View your API usage',
        url: '/analytics/usage',
        icon: 'chart',
      },
    ];

    if (tier === 'pro' || tier === 'enterprise') {
      links.push({
        title: 'Webhooks',
        description: 'Configure webhooks',
        url: '/settings/webhooks',
        icon: 'webhook',
      });
    }

    if (tier === 'enterprise') {
      links.push({
        title: 'Team',
        description: 'Manage team members',
        url: '/settings/team',
        icon: 'users',
      });
    }

    return links;
  }
}

export const developerPortalService = new DeveloperPortalService();
