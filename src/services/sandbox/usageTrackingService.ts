import AsyncStorage from '@react-native-async-storage/async-storage';
import { UsageMetric, UsageStats, SandboxEnvironment } from '../../types/sandbox';

const USAGE_STORAGE_KEY = '@subtrackr_usage_metrics';

const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
};

const MOCK_ENDPOINTS = [
  { path: '/api/v1/subscriptions', method: 'GET' },
  { path: '/api/v1/subscriptions', method: 'POST' },
  { path: '/api/v1/subscriptions/:id', method: 'GET' },
  { path: '/api/v1/subscriptions/:id', method: 'PUT' },
  { path: '/api/v1/subscriptions/:id', method: 'DELETE' },
  { path: '/api/v1/payments', method: 'POST' },
  { path: '/api/v1/analytics', method: 'GET' },
  { path: '/api/v1/webhooks', method: 'GET' },
  { path: '/api/v1/webhooks', method: 'POST' },
  { path: '/api/v1/invoices', method: 'GET' },
];

class UsageTrackingService {
  private static instance: UsageTrackingService;
  private metrics: UsageMetric[] = [];

  private constructor() {
    this.loadMetrics();
  }

  static getInstance(): UsageTrackingService {
    if (!UsageTrackingService.instance) {
      UsageTrackingService.instance = new UsageTrackingService();
    }
    return UsageTrackingService.instance;
  }

  private async loadMetrics(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(USAGE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.metrics = parsed.map((m: Record<string, unknown>) => ({
          ...m,
          timestamp: new Date(m.timestamp as string),
        }));
      }
    } catch {
      this.metrics = [];
    }
  }

  private async saveMetrics(): Promise<void> {
    try {
      await AsyncStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(this.metrics));
    } catch (error) {
      console.warn('Failed to save usage metrics:', error);
    }
  }

  async trackRequest(
    developerId: string,
    apiKeyId: string,
    endpoint: string,
    method: string,
    statusCode: number,
    responseTime: number,
    environment: SandboxEnvironment = SandboxEnvironment.DEVELOPMENT
  ): Promise<UsageMetric> {
    const metric: UsageMetric = {
      id: generateId(),
      developerId,
      apiKeyId,
      endpoint,
      method,
      statusCode,
      responseTime,
      timestamp: new Date(),
      environment,
    };

    this.metrics.push(metric);
    await this.saveMetrics();
    return metric;
  }

  generateMockUsageData(developerId: string, apiKeyId: string, days: number = 30): void {
    const now = new Date();
    this.metrics = [];

    for (let d = days; d >= 0; d--) {
      const date = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
      const requestsPerDay = Math.floor(Math.random() * 50) + 10;

      for (let i = 0; i < requestsPerDay; i++) {
        const endpoint = MOCK_ENDPOINTS[Math.floor(Math.random() * MOCK_ENDPOINTS.length)];
        const statusCode = Math.random() > 0.1 ? 200 : Math.random() > 0.5 ? 400 : 500;
        const responseTime = Math.floor(Math.random() * 500) + 50;

        const timestamp = new Date(date);
        timestamp.setHours(Math.floor(Math.random() * 24));
        timestamp.setMinutes(Math.floor(Math.random() * 60));

        this.metrics.push({
          id: generateId(),
          developerId,
          apiKeyId,
          endpoint: endpoint.path,
          method: endpoint.method,
          statusCode,
          responseTime,
          timestamp,
          environment: SandboxEnvironment.DEVELOPMENT,
        });
      }
    }

    this.saveMetrics();
  }

  getUsageStats(developerId: string): UsageStats {
    const devMetrics = this.metrics.filter((m) => m.developerId === developerId);

    const totalRequests = devMetrics.length;
    const successfulRequests = devMetrics.filter((m) => m.statusCode >= 200 && m.statusCode < 300).length;
    const failedRequests = totalRequests - successfulRequests;
    const averageResponseTime =
      totalRequests > 0
        ? devMetrics.reduce((sum, m) => sum + m.responseTime, 0) / totalRequests
        : 0;

    const requestsByEndpoint: Record<string, number> = {};
    devMetrics.forEach((m) => {
      const key = `${m.method} ${m.endpoint}`;
      requestsByEndpoint[key] = (requestsByEndpoint[key] || 0) + 1;
    });

    const requestsByDay: Record<string, number> = {};
    devMetrics.forEach((m) => {
      const day = m.timestamp instanceof Date ? m.timestamp.toISOString().split('T')[0] : new Date(m.timestamp).toISOString().split('T')[0];
      requestsByDay[day] = (requestsByDay[day] || 0) + 1;
    });

    const errorCounts: Record<number, { count: number; message: string }> = {};
    devMetrics
      .filter((m) => m.statusCode >= 400)
      .forEach((m) => {
        if (!errorCounts[m.statusCode]) {
          errorCounts[m.statusCode] = {
            count: 0,
            message: this.getErrorMessage(m.statusCode),
          };
        }
        errorCounts[m.statusCode].count += 1;
      });

    const topErrors = Object.entries(errorCounts)
      .map(([code, data]) => ({
        code: parseInt(code, 10),
        count: data.count,
        message: data.message,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      averageResponseTime: Math.round(averageResponseTime),
      requestsByEndpoint,
      requestsByDay,
      topErrors,
    };
  }

  getRecentMetrics(developerId: string, limit: number = 50): UsageMetric[] {
    return this.metrics
      .filter((m) => m.developerId === developerId)
      .sort((a, b) => {
        const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
        const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
        return bTime - aTime;
      })
      .slice(0, limit);
  }

  getMetricsByApiKey(apiKeyId: string): UsageMetric[] {
    return this.metrics.filter((m) => m.apiKeyId === apiKeyId);
  }

  async clearMetrics(developerId: string): Promise<void> {
    this.metrics = this.metrics.filter((m) => m.developerId !== developerId);
    await this.saveMetrics();
  }

  private getErrorMessage(statusCode: number): string {
    const messages: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };
    return messages[statusCode] || `HTTP ${statusCode}`;
  }

  getDailyRequestCounts(developerId: string, days: number = 7): { date: string; count: number }[] {
    const stats = this.getUsageStats(developerId);
    const now = new Date();
    const result: { date: string; count: number }[] = [];

    for (let d = days - 1; d >= 0; d--) {
      const date = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      result.push({
        date: dateStr,
        count: stats.requestsByDay[dateStr] || 0,
      });
    }

    return result;
  }
}

export const usageTrackingService = UsageTrackingService.getInstance();
