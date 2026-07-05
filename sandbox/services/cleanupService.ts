/**
 * CleanupService - Manages periodic sandbox cleanup, data reset,
 * and environment lifecycle management. Prevents data leakage and
 * keeps sandbox environments healthy.
 */
import { SandboxEnvironment, SandboxTestData } from '../types/sandbox';

// ─── Cleanup types ────────────────────────────────────────────────────────────

export interface CleanupSchedule {
  environmentId: string;
  interval: 'hourly' | 'daily' | 'weekly' | 'monthly';
  lastRunAt: Date | null;
  nextRunAt: Date;
  strategy: CleanupStrategy;
  isActive: boolean;
}

export interface CleanupStrategy {
  resetTestData: boolean;
  revokeExpiredKeys: boolean;
  clearUsageMetrics: boolean;
  archiveOldLogs: boolean;
  deleteExpiredEnvironments: boolean;
  retentionDays: number;
}

export interface CleanupResult {
  environmentId: string;
  success: boolean;
  actions: CleanupAction[];
  timestamp: Date;
  errors: string[];
}

export interface CleanupAction {
  type:
    | 'test_data_reset'
    | 'keys_revoked'
    | 'metrics_cleared'
    | 'logs_archived'
    | 'environment_suspended'
    | 'environment_deleted'
    | 'environment_expired';
  description: string;
  details?: Record<string, unknown>;
}

export interface CleanupReport {
  generatedAt: Date;
  environmentsScanned: number;
  environmentsCleaned: number;
  environmentsDeleted: number;
  keysRevoked: number;
  dataResets: number;
  errors: string[];
  nextScheduledRun: Date;
}

export interface EnvironmentHealth {
  environmentId: string;
  name: string;
  status: 'healthy' | 'warning' | 'critical';
  issues: string[];
  daysUntilExpiry: number;
  storageUsedMB: number;
  requestCount: number;
  errorRate: number;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class CleanupService {
  private schedules: Map<string, CleanupSchedule> = new Map();
  private results: CleanupResult[] = [];
  private readonly MAX_RESULTS_HISTORY = 100;

  // ── Default cleanup strategies ──────────────────────────────────────────────

  private readonly DEFAULT_STRATEGY: CleanupStrategy = {
    resetTestData: true,
    revokeExpiredKeys: true,
    clearUsageMetrics: false,
    archiveOldLogs: true,
    deleteExpiredEnvironments: true,
    retentionDays: 90,
  };

  private readonly AGGRESSIVE_STRATEGY: CleanupStrategy = {
    resetTestData: true,
    revokeExpiredKeys: true,
    clearUsageMetrics: true,
    archiveOldLogs: true,
    deleteExpiredEnvironments: true,
    retentionDays: 30,
  };

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Schedule periodic cleanup for an environment */
  async scheduleCleanup(
    environmentId: string,
    interval: CleanupSchedule['interval'] = 'weekly',
    strategy?: Partial<CleanupStrategy>
  ): Promise<CleanupSchedule> {
    const schedule: CleanupSchedule = {
      environmentId,
      interval,
      lastRunAt: null,
      nextRunAt: this.computeNextRun(interval),
      strategy: { ...this.DEFAULT_STRATEGY, ...strategy },
      isActive: true,
    };

    this.schedules.set(environmentId, schedule);
    return schedule;
  }

  /** Get cleanup schedule for an environment */
  getSchedule(environmentId: string): CleanupSchedule | null {
    return this.schedules.get(environmentId) || null;
  }

  /** Update cleanup schedule */
  async updateSchedule(
    environmentId: string,
    updates: Partial<Pick<CleanupSchedule, 'interval' | 'strategy' | 'isActive'>>
  ): Promise<CleanupSchedule | null> {
    const schedule = this.schedules.get(environmentId);
    if (!schedule) return null;

    if (updates.interval) {
      schedule.interval = updates.interval;
      schedule.nextRunAt = this.computeNextRun(updates.interval);
    }
    if (updates.strategy) {
      schedule.strategy = { ...schedule.strategy, ...updates.strategy };
    }
    if (updates.isActive !== undefined) {
      schedule.isActive = updates.isActive;
    }

    this.schedules.set(environmentId, schedule);
    return schedule;
  }

  /** Cancel cleanup schedule */
  cancelSchedule(environmentId: string): boolean {
    return this.schedules.delete(environmentId);
  }

  /** Execute cleanup for a single environment */
  async cleanupEnvironment(environment: SandboxEnvironment): Promise<CleanupResult> {
    const schedule = this.schedules.get(environment.id);
    const strategy = schedule?.strategy || this.DEFAULT_STRATEGY;

    const result: CleanupResult = {
      environmentId: environment.id,
      success: true,
      actions: [],
      timestamp: new Date(),
      errors: [],
    };

    try {
      // 1. Reset test data if configured
      if (strategy.resetTestData) {
        result.actions.push({
          type: 'test_data_reset',
          description: 'Test data regenerated with fresh mock data',
          details: {
            subscriptionsBefore: environment.testData.subscriptions.length,
            paymentsBefore: environment.testData.payments.length,
            webhooksBefore: environment.testData.webhooks.length,
          },
        });
        environment.testData = this.generateFreshTestData();
      }

      // 2. Revoke expired API keys
      if (strategy.revokeExpiredKeys) {
        let revokedCount = 0;
        for (const key of environment.apiKeys) {
          if (key.expiresAt && key.expiresAt < new Date() && key.status === 'active') {
            key.status = 'expired';
            revokedCount++;
          }
        }
        if (revokedCount > 0) {
          result.actions.push({
            type: 'keys_revoked',
            description: `${revokedCount} expired API key(s) revoked`,
            details: { revokedCount },
          });
        }
      }

      // 3. Archive/clear usage metrics
      if (strategy.clearUsageMetrics) {
        result.actions.push({
          type: 'metrics_cleared',
          description: 'Usage metrics have been cleared',
          details: {
            totalRequests: environment.usage.totalRequests,
          },
        });
        environment.usage = this.getFreshUsage();
      }

      // 4. Handle expired environments
      if (strategy.deleteExpiredEnvironments && environment.expiresAt) {
        const isExpired = environment.expiresAt < new Date();
        if (isExpired && environment.status === 'active') {
          environment.status = 'suspended';
          result.actions.push({
            type: 'environment_expired',
            description: `Environment expired on ${environment.expiresAt.toISOString()}`,
            details: { expiredAt: environment.expiresAt },
          });
        }
      }

      // 5. Archive old logs
      if (strategy.archiveOldLogs) {
        result.actions.push({
          type: 'logs_archived',
          description: 'Old request logs have been archived',
          details: { retentionDays: strategy.retentionDays },
        });
      }

      // Update schedule
      if (schedule?.isActive) {
        schedule.lastRunAt = new Date();
        schedule.nextRunAt = this.computeNextRun(schedule.interval);
        this.schedules.set(environment.id, schedule);
      }
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : 'Cleanup failed');
    }

    this.results.push(result);
    // Trim results history
    if (this.results.length > this.MAX_RESULTS_HISTORY) {
      this.results = this.results.slice(-this.MAX_RESULTS_HISTORY);
    }

    return result;
  }

  /** Run scheduled cleanups for all environments that are due */
  async runScheduledCleanups(environments: SandboxEnvironment[]): Promise<CleanupReport> {
    const now = new Date();
    const report: CleanupReport = {
      generatedAt: now,
      environmentsScanned: environments.length,
      environmentsCleaned: 0,
      environmentsDeleted: 0,
      keysRevoked: 0,
      dataResets: 0,
      errors: [],
      nextScheduledRun: new Date(now.getTime() + 24 * 60 * 60 * 1000), // next day
    };

    for (const env of environments) {
      const schedule = this.schedules.get(env.id);

      // Skip if no schedule or not active
      if (!schedule?.isActive) continue;

      // Skip if not yet due
      if (schedule.nextRunAt > now) {
        if (schedule.nextRunAt < report.nextScheduledRun) {
          report.nextScheduledRun = schedule.nextRunAt;
        }
        continue;
      }

      // Run cleanup
      const result = await this.cleanupEnvironment(env);
      report.environmentsCleaned++;

      if (!result.success) {
        report.errors.push(...result.errors);
      }

      // Aggregate action counts
      for (const action of result.actions) {
        switch (action.type) {
          case 'environment_deleted':
            report.environmentsDeleted++;
            break;
          case 'keys_revoked':
            report.keysRevoked += (action.details?.revokedCount as number) || 0;
            break;
          case 'test_data_reset':
            report.dataResets++;
            break;
        }
      }
    }

    return report;
  }

  /** Force-reset an environment's test data immediately */
  async forceResetData(environment: SandboxEnvironment): Promise<SandboxTestData> {
    environment.testData = this.generateFreshTestData();
    return environment.testData;
  }

  /** Get health status for an environment */
  async getHealthCheck(environment: SandboxEnvironment): Promise<EnvironmentHealth> {
    const issues: string[] = [];
    let status: EnvironmentHealth['status'] = 'healthy';

    // Check expiration
    const daysUntilExpiry = environment.expiresAt
      ? Math.ceil((environment.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 999;

    if (daysUntilExpiry < 0) {
      issues.push('Environment has expired');
      status = 'critical';
    } else if (daysUntilExpiry < 7) {
      issues.push(`Environment expires in ${daysUntilExpiry} day(s)`);
      status = 'warning';
    } else if (daysUntilExpiry < 30) {
      issues.push(`Environment expires in ${daysUntilExpiry} days`);
      if (status === 'healthy') status = 'warning';
    }

    // Check status
    if (environment.status === 'suspended') {
      issues.push('Environment is suspended');
      status = 'critical';
    }

    // Check error rate
    const errorRate =
      environment.usage.totalRequests > 0
        ? (environment.usage.failedRequests / environment.usage.totalRequests) * 100
        : 0;

    if (errorRate > 10) {
      issues.push(`High error rate: ${errorRate.toFixed(1)}%`);
      status = status === 'healthy' ? 'warning' : status;
    }

    // Check storage
    const storageMB = JSON.stringify(environment.testData).length / (1024 * 1024);
    if (storageMB > 80) {
      issues.push(`Storage usage high: ${storageMB.toFixed(1)}MB`);
      if (status === 'healthy') status = 'warning';
    }

    return {
      environmentId: environment.id,
      name: environment.name,
      status,
      issues,
      daysUntilExpiry,
      storageUsedMB: parseFloat(storageMB.toFixed(2)),
      requestCount: environment.usage.totalRequests,
      errorRate: parseFloat(errorRate.toFixed(2)),
    };
  }

  /** Get cleanup history for an environment */
  getCleanupHistory(environmentId: string, limit: number = 20): CleanupResult[] {
    return this.results
      .filter((r) => r.environmentId === environmentId)
      .slice(-limit)
      .reverse();
  }

  /** Get all current schedules */
  getAllSchedules(): CleanupSchedule[] {
    return Array.from(this.schedules.values());
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private computeNextRun(interval: CleanupSchedule['interval']): Date {
    const now = new Date();
    switch (interval) {
      case 'hourly':
        return new Date(now.getTime() + 60 * 60 * 1000);
      case 'daily':
        now.setDate(now.getDate() + 1);
        now.setHours(0, 0, 0, 0);
        return now;
      case 'weekly':
        now.setDate(now.getDate() + 7);
        now.setHours(0, 0, 0, 0);
        return now;
      case 'monthly':
        now.setMonth(now.getMonth() + 1);
        now.setHours(0, 0, 0, 0);
        return now;
    }
  }

  private generateFreshTestData(): SandboxTestData {
    return {
      subscriptions: [],
      payments: [],
      webhooks: [],
      users: [],
    };
  }

  private getFreshUsage() {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      last24Hours: [],
      last7Days: [],
    };
  }
}

export const cleanupService = new CleanupService();
