import {
  UsageMetrics,
  HourlyUsage,
  DailyUsage,
} from '../types/sandbox';

export class UsageTrackingService {
  private usageData: Map<string, UsageMetrics> = new Map();
  private requestLog: RequestLogEntry[] = [];

  async trackRequest(
    environmentId: string,
    apiKeyId: string,
    endpoint: string,
    method: string,
    statusCode: number,
    responseTime: number
  ): Promise<void> {
    const entry: RequestLogEntry = {
      id: crypto.randomUUID(),
      environmentId,
      apiKeyId,
      endpoint,
      method,
      statusCode,
      responseTime,
      timestamp: new Date(),
    };

    this.requestLog.push(entry);

    const metrics = this.getOrCreateMetrics(environmentId);
    metrics.totalRequests++;

    if (statusCode >= 200 && statusCode < 400) {
      metrics.successfulRequests++;
    } else {
      metrics.failedRequests++;
    }

    metrics.averageResponseTime = this.calculateAverageResponseTime(environmentId);

    this.updateHourlyUsage(metrics, statusCode, responseTime);
    this.updateDailyUsage(metrics, statusCode, responseTime);

    this.usageData.set(environmentId, metrics);
  }

  async getUsageMetrics(environmentId: string): Promise<UsageMetrics | null> {
    return this.usageData.get(environmentId) || null;
  }

  async getRequestLog(
    environmentId: string,
    options?: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
      statusCode?: number;
    }
  ): Promise<RequestLogEntry[]> {
    let filtered = this.requestLog.filter(
      (entry) => entry.environmentId === environmentId
    );

    if (options?.startDate) {
      filtered = filtered.filter(
        (entry) => entry.timestamp >= options.startDate!
      );
    }

    if (options?.endDate) {
      filtered = filtered.filter(
        (entry) => entry.timestamp <= options.endDate!
      );
    }

    if (options?.statusCode) {
      filtered = filtered.filter(
        (entry) => entry.statusCode === options.statusCode
      );
    }

    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const offset = options?.offset || 0;
    const limit = options?.limit || 100;

    return filtered.slice(offset, offset + limit);
  }

  async getUsageSummary(environmentId: string): Promise<UsageSummary | null> {
    const metrics = this.usageData.get(environmentId);
    if (!metrics) return null;

    const last24Hours = this.requestLog.filter(
      (entry) =>
        entry.environmentId === environmentId &&
        entry.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000)
    );

    const last7Days = this.requestLog.filter(
      (entry) =>
        entry.environmentId === environmentId &&
        entry.timestamp > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );

    return {
      totalRequests: metrics.totalRequests,
      successfulRequests: metrics.successfulRequests,
      failedRequests: metrics.failedRequests,
      successRate:
        metrics.totalRequests > 0
          ? (metrics.successfulRequests / metrics.totalRequests) * 100
          : 0,
      averageResponseTime: metrics.averageResponseTime,
      requestsLast24Hours: last24Hours.length,
      requestsLast7Days: last7Days.length,
      topEndpoints: this.getTopEndpoints(environmentId, 5),
      errorBreakdown: this.getErrorBreakdown(environmentId),
    };
  }

  async resetUsage(environmentId: string): Promise<boolean> {
    this.usageData.delete(environmentId);
    this.requestLog = this.requestLog.filter(
      (entry) => entry.environmentId !== environmentId
    );
    return true;
  }

  private getOrCreateMetrics(environmentId: string): UsageMetrics {
    const existing = this.usageData.get(environmentId);
    if (existing) return existing;

    return {
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
    };
  }

  private calculateAverageResponseTime(environmentId: string): number {
    const entries = this.requestLog.filter(
      (entry) => entry.environmentId === environmentId
    );

    if (entries.length === 0) return 0;

    const total = entries.reduce((sum, entry) => sum + entry.responseTime, 0);
    return Math.round(total / entries.length);
  }

  private updateHourlyUsage(
    metrics: UsageMetrics,
    statusCode: number,
    responseTime: number
  ): void {
    const currentHour = new Date().getHours();
    const hourlyData = metrics.last24Hours[currentHour];

    if (hourlyData) {
      hourlyData.requests++;
      if (statusCode >= 400) {
        hourlyData.errors++;
      }
      hourlyData.avgResponseTime = Math.round(
        (hourlyData.avgResponseTime * (hourlyData.requests - 1) + responseTime) /
          hourlyData.requests
      );
    }
  }

  private updateDailyUsage(
    metrics: UsageMetrics,
    statusCode: number,
    responseTime: number
  ): void {
    const today = new Date().toISOString().split('T')[0];
    const dailyData = metrics.last7Days.find((d) => d.date === today);

    if (dailyData) {
      dailyData.requests++;
      if (statusCode >= 400) {
        dailyData.errors++;
      }
      dailyData.avgResponseTime = Math.round(
        (dailyData.avgResponseTime * (dailyData.requests - 1) + responseTime) /
          dailyData.requests
      );
    }
  }

  private getTopEndpoints(
    environmentId: string,
    limit: number
  ): EndpointUsage[] {
    const endpointMap = new Map<string, number>();

    this.requestLog
      .filter((entry) => entry.environmentId === environmentId)
      .forEach((entry) => {
        const key = `${entry.method} ${entry.endpoint}`;
        endpointMap.set(key, (endpointMap.get(key) || 0) + 1);
      });

    return Array.from(endpointMap.entries())
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  private getErrorBreakdown(environmentId: string): ErrorBreakdown[] {
    const errorMap = new Map<number, number>();

    this.requestLog
      .filter(
        (entry) =>
          entry.environmentId === environmentId && entry.statusCode >= 400
      )
      .forEach((entry) => {
        errorMap.set(entry.statusCode, (errorMap.get(entry.statusCode) || 0) + 1);
      });

    return Array.from(errorMap.entries())
      .map(([statusCode, count]) => ({ statusCode, count }))
      .sort((a, b) => b.count - a.count);
  }
}

export interface RequestLogEntry {
  id: string;
  environmentId: string;
  apiKeyId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  timestamp: Date;
}

export interface UsageSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  averageResponseTime: number;
  requestsLast24Hours: number;
  requestsLast7Days: number;
  topEndpoints: EndpointUsage[];
  errorBreakdown: ErrorBreakdown[];
}

export interface EndpointUsage {
  endpoint: string;
  count: number;
}

export interface ErrorBreakdown {
  statusCode: number;
  count: number;
}
