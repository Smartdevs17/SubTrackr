import { Developer, ApiKey, ApiPermission, UsageMetrics } from '../types/developer';

export class DeveloperPortalUtils {
  static validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static validateApiKey(key: string): {
    valid: boolean;
    type?: 'test' | 'production';
    error?: string;
  } {
    if (!key) {
      return { valid: false, error: 'API key is required' };
    }

    if (key.startsWith('sk_test_')) {
      return { valid: true, type: 'test' };
    }

    if (key.startsWith('sk_live_')) {
      return { valid: true, type: 'production' };
    }

    return { valid: false, error: 'Invalid API key format' };
  }

  static maskApiKey(key: string): string {
    if (key.length <= 8) return '****';
    return key.substring(0, 8) + '****' + key.substring(key.length - 4);
  }

  static hasPermission(apiKey: ApiKey, permission: ApiPermission): boolean {
    return apiKey.permissions.includes(permission);
  }

  static checkRateLimit(
    apiKey: ApiKey,
    currentUsage: { requestsPerMinute: number; requestsPerHour: number; requestsPerDay: number }
  ): { allowed: boolean; retryAfter?: number } {
    if (currentUsage.requestsPerMinute >= apiKey.rateLimit.requestsPerMinute) {
      return { allowed: false, retryAfter: 60 };
    }

    if (currentUsage.requestsPerHour >= apiKey.rateLimit.requestsPerHour) {
      return { allowed: false, retryAfter: 3600 };
    }

    if (currentUsage.requestsPerDay >= apiKey.rateLimit.requestsPerDay) {
      return { allowed: false, retryAfter: 86400 };
    }

    return { allowed: true };
  }

  static calculateUsageTier(usage: UsageMetrics): 'low' | 'medium' | 'high' | 'very_high' {
    const dailyAvg = usage.totalRequests / 30;

    if (dailyAvg > 10000) return 'very_high';
    if (dailyAvg > 1000) return 'high';
    if (dailyAvg > 100) return 'medium';
    return 'low';
  }

  static formatUsageMetrics(metrics: UsageMetrics): {
    totalRequests: string;
    successRate: string;
    avgResponseTime: string;
    errorRate: string;
  } {
    const successRate =
      metrics.totalRequests > 0
        ? ((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(2)
        : '0.00';

    const errorRate =
      metrics.totalRequests > 0
        ? ((metrics.failedRequests / metrics.totalRequests) * 100).toFixed(2)
        : '0.00';

    return {
      totalRequests: metrics.totalRequests.toLocaleString(),
      successRate: `${successRate}%`,
      avgResponseTime: `${metrics.avgResponseTime.toFixed(0)}ms`,
      errorRate: `${errorRate}%`,
    };
  }

  static generateOnboardingChecklist(
    developer: Developer
  ): { step: string; completed: boolean; description: string }[] {
    return [
      {
        step: 'register',
        completed: developer.onboardingStatus.completedSteps.includes('registration'),
        description: 'Create your developer account',
      },
      {
        step: 'verify_email',
        completed: developer.onboardingStatus.completedSteps.includes('email_verification'),
        description: 'Verify your email address',
      },
      {
        step: 'complete_profile',
        completed: developer.onboardingStatus.completedSteps.includes('profile_completion'),
        description: 'Complete your profile information',
      },
      {
        step: 'setup_sandbox',
        completed: developer.onboardingStatus.completedSteps.includes('sandbox_setup'),
        description: 'Set up your sandbox environment',
      },
      {
        step: 'create_api_key',
        completed: developer.apiKeys.length > 0,
        description: 'Create your first API key',
      },
      {
        step: 'make_first_request',
        completed: developer.usage.totalRequests > 0,
        description: 'Make your first API request',
      },
    ];
  }

  static getPermissionDescription(permission: ApiPermission): string {
    const descriptions: Record<ApiPermission, string> = {
      'subscriptions:read': 'Read subscription data',
      'subscriptions:write': 'Create and modify subscriptions',
      'payments:read': 'Read payment data',
      'payments:write': 'Create and process payments',
      'webhooks:read': 'Read webhook configurations',
      'webhooks:write': 'Create and modify webhooks',
      'analytics:read': 'Access analytics data',
      'users:read': 'Read user data',
      'users:write': 'Create and modify users',
      'sandbox:manage': 'Manage sandbox environments',
    };

    return descriptions[permission] || 'Unknown permission';
  }

  static getTierLimits(tier: string): {
    maxApiKeys: number;
    maxSandboxEnvironments: number;
    maxRequestsPerMonth: number;
    features: string[];
  } {
    switch (tier) {
      case 'enterprise':
        return {
          maxApiKeys: 50,
          maxSandboxEnvironments: 10,
          maxRequestsPerMonth: 1000000,
          features: [
            'priority_support',
            'custom_sla',
            'dedicated_account_manager',
            'advanced_analytics',
            'webhooks',
            'team_management',
          ],
        };
      case 'pro':
        return {
          maxApiKeys: 10,
          maxSandboxEnvironments: 5,
          maxRequestsPerMonth: 100000,
          features: ['email_support', 'webhooks', 'advanced_analytics'],
        };
      default:
        return {
          maxApiKeys: 3,
          maxSandboxEnvironments: 1,
          maxRequestsPerMonth: 10000,
          features: ['community_support', 'basic_analytics'],
        };
    }
  }

  static validateWebhookUrl(url: string): { valid: boolean; error?: string } {
    try {
      const parsed = new URL(url);

      if (parsed.protocol !== 'https:') {
        return { valid: false, error: 'Webhook URL must use HTTPS' };
      }

      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return { valid: false, error: 'Webhook URL cannot be localhost' };
      }

      return { valid: true };
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }
  }

  static generateWebhookSecret(): string {
    return (
      'whsec_' + Array.from({ length: 32 }, () => Math.random().toString(36).charAt(2)).join('')
    );
  }

  static formatCurrency(amount: number, currency: string = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  }

  static formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  static calculateNextBillingDate(startDate: Date, billingCycle: 'monthly' | 'yearly'): Date {
    const nextDate = new Date(startDate);
    if (billingCycle === 'monthly') {
      nextDate.setMonth(nextDate.getMonth() + 1);
    } else {
      nextDate.setFullYear(nextDate.getFullYear() + 1);
    }
    return nextDate;
  }

  static isTrialActive(trialEndDate: Date): boolean {
    return trialEndDate > new Date();
  }

  static calculateTrialDaysRemaining(trialEndDate: Date): number {
    const now = new Date();
    const diffTime = trialEndDate.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}
