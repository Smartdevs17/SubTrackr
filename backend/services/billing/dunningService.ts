import type {
  DunningAnalytics,
  DunningCommunication,
  DunningCommunicationTemplate,
  DunningConfiguration,
  DunningEntry,
  DunningStage,
  DunningStageConfig,
} from '../../../src/types/dunning';
import { DEFAULT_DUNNING_STAGES, DUNNING_TEMPLATES } from '../../../src/types/dunning';
import {
  ProgressiveDunningEngine,
  progressiveDunningEngine,
} from '../../../src/services/progressiveDunningEngine';
import type { EscalationEvent } from '../../../src/types/dunningEscalation';

const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

const now = (): number => Date.now();

const createId = (prefix: string): string =>
  `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export type FailureType =
  | 'insufficient_funds'
  | 'card_declined'
  | 'expired_card'
  | 'network_error'
  | 'processing_error'
  | 'auth_required'
  | 'unknown';

export interface RetryScheduleConfig {
  failureType: FailureType;
  baseDelayHours: number;
  maxRetries: number;
  backoffMultiplier: number;
  maxDelayHours: number;
}

export interface RetryAnalytics {
  totalRetries: number;
  successfulRetries: number;
  failedRetries: number;
  retryRate: number;
  successRate: number;
  averageRetriesBeforeSuccess: number;
  retriesByFailureType: Record<FailureType, number>;
  retriesByStage: Record<DunningStage, number>;
  averageTimeToRecovery: number;
}

const DEFAULT_RETRY_SCHEDULES: RetryScheduleConfig[] = [
  { failureType: 'insufficient_funds', baseDelayHours: 1, maxRetries: 5, backoffMultiplier: 2, maxDelayHours: 48 },
  { failureType: 'card_declined', baseDelayHours: 2, maxRetries: 3, backoffMultiplier: 3, maxDelayHours: 72 },
  { failureType: 'expired_card', baseDelayHours: 24, maxRetries: 2, backoffMultiplier: 1, maxDelayHours: 24 },
  { failureType: 'network_error', baseDelayHours: 0.5, maxRetries: 6, backoffMultiplier: 1.5, maxDelayHours: 12 },
  { failureType: 'processing_error', baseDelayHours: 1, maxRetries: 4, backoffMultiplier: 2, maxDelayHours: 24 },
  { failureType: 'auth_required', baseDelayHours: 0.25, maxRetries: 3, backoffMultiplier: 1, maxDelayHours: 1 },
  { failureType: 'unknown', baseDelayHours: 1, maxRetries: 3, backoffMultiplier: 2, maxDelayHours: 24 },
];

export class DunningService {
  private entries = new Map<string, DunningEntry>();
  private configurations = new Map<string, DunningConfiguration>();
  private communicationLog = new Map<string, DunningCommunication[]>();
  private retrySchedules: RetryScheduleConfig[] = [...DEFAULT_RETRY_SCHEDULES];
  private retryHistory: Array<{
    subscriptionId: string;
    failureType: FailureType;
    attempt: number;
    success: boolean;
    timestamp: number;
    delayHours: number;
  }> = [];
  private progressiveEngine: ProgressiveDunningEngine;

  constructor(engine: ProgressiveDunningEngine = progressiveDunningEngine) {
    this.progressiveEngine = engine;
  }

  configurePlan(planId: string, config: Partial<DunningConfiguration>): DunningConfiguration {
    const existing = this.configurations.get(planId);
    const merged: DunningConfiguration = {
      planId,
      stages: config.stages ?? existing?.stages ?? DEFAULT_DUNNING_STAGES,
      maxRetries: config.maxRetries ?? existing?.maxRetries ?? 3,
      retryIntervalHours: config.retryIntervalHours ?? existing?.retryIntervalHours ?? 1,
      warnAfterFailures: config.warnAfterFailures ?? existing?.warnAfterFailures ?? 3,
      suspendAfterDays: config.suspendAfterDays ?? existing?.suspendAfterDays ?? 3,
      cancelAfterDays: config.cancelAfterDays ?? existing?.cancelAfterDays ?? 7,
      communicationChannels: config.communicationChannels ?? existing?.communicationChannels ?? ['email', 'push'],
    };
    this.configurations.set(planId, merged);
    return merged;
  }

  getConfiguration(planId: string): DunningConfiguration | undefined {
    return this.configurations.get(planId);
  }

  configureRetrySchedule(schedule: Partial<RetryScheduleConfig> & { failureType: FailureType }): void {
    const existingIdx = this.retrySchedules.findIndex((s) => s.failureType === schedule.failureType);
    const existing = existingIdx >= 0 ? this.retrySchedules[existingIdx] : undefined;

    const merged: RetryScheduleConfig = {
      failureType: schedule.failureType,
      baseDelayHours: schedule.baseDelayHours ?? existing?.baseDelayHours ?? 1,
      maxRetries: schedule.maxRetries ?? existing?.maxRetries ?? 3,
      backoffMultiplier: schedule.backoffMultiplier ?? existing?.backoffMultiplier ?? 2,
      maxDelayHours: schedule.maxDelayHours ?? existing?.maxDelayHours ?? 24,
    };

    if (existingIdx >= 0) {
      this.retrySchedules[existingIdx] = merged;
    } else {
      this.retrySchedules.push(merged);
    }
  }

  getRetrySchedule(failureType: FailureType): RetryScheduleConfig {
    return (
      this.retrySchedules.find((s) => s.failureType === failureType) ??
      this.retrySchedules.find((s) => s.failureType === 'unknown')!
    );
  }

  calculateRetryDelay(failureType: FailureType, attemptNumber: number): number {
    const schedule = this.getRetrySchedule(failureType);
    const delay =
      schedule.baseDelayHours * Math.pow(schedule.backoffMultiplier, attemptNumber - 1);
    return Math.min(delay, schedule.maxDelayHours);
  }

  startDunning(
    subscriptionId: string,
    subscriberId: string,
    merchantId: string,
    planId: string,
  ): DunningEntry {
    const existing = this.entries.get(subscriptionId);
    if (existing) {
      return existing;
    }

    const config = this.configurations.get(planId);
    const firstStage = config?.stages[0] ?? DEFAULT_DUNNING_STAGES[0];
    const now_ts = now();

    const entry: DunningEntry = {
      id: createId('dun'),
      subscriptionId,
      subscriberId,
      merchantId,
      planId,
      currentStage: firstStage.stage,
      failedAttempts: 0,
      totalFailedCharges: 0,
      firstFailureAt: now_ts,
      lastFailureAt: now_ts,
      lastAttemptAt: now_ts,
      nextActionAt: now_ts + firstStage.delayHours * ONE_HOUR_MS,
      isPaused: false,
      communicationLog: [],
      createdAt: now_ts,
      updatedAt: now_ts,
    };

    this.entries.set(subscriptionId, entry);
    this.communicationLog.set(subscriptionId, []);
    this.progressiveEngine.trackStageEntry(entry);
    return entry;
  }

  /**
   * Evaluate and apply progressive escalation rules for a subscription.
   * Returns the escalation event when a stage change occurs, otherwise null.
   */
  progressiveEscalate(subscriptionId: string, now = Date.now()): {
    entry: DunningEntry;
    event: EscalationEvent;
  } | null {
    const entry = this.entries.get(subscriptionId);
    if (!entry || entry.isPaused) return null;

    const rule = this.progressiveEngine.findMatchingRule(entry, now);
    if (!rule) return null;

    const { entry: updated, event } = this.progressiveEngine.applyEscalation(entry, rule);
    this.entries.set(subscriptionId, updated);

    const stageConfig =
      this.configurations.get(updated.planId)?.stages.find((s) => s.stage === updated.currentStage) ??
      DEFAULT_DUNNING_STAGES.find((s) => s.stage === updated.currentStage);

    if (stageConfig) {
      this.sendCommunication(updated, stageConfig);
    }

    return { entry: updated, event };
  }

  getProgressiveEngine(): ProgressiveDunningEngine {
    return this.progressiveEngine;
  }

  recordFailedCharge(
    subscriptionId: string,
    failureType: FailureType = 'unknown'
  ): DunningEntry | null {
    const entry = this.entries.get(subscriptionId);
    if (!entry || entry.isPaused) return null;

    const config = this.configurations.get(entry.planId);
    const schedule = this.getRetrySchedule(failureType);
    const now_ts = now();

    entry.failedAttempts += 1;
    entry.totalFailedCharges += 1;
    entry.lastFailureAt = now_ts;
    entry.lastAttemptAt = now_ts;
    entry.updatedAt = now_ts;

    this.retryHistory.push({
      subscriptionId,
      failureType,
      attempt: entry.failedAttempts,
      success: false,
      timestamp: now_ts,
      delayHours: 0,
    });

    const shouldAdvanceStage = (): boolean => {
      if (entry.failedAttempts >= schedule.maxRetries) return true;
      const currentStageIndex = config
        ? config.stages.findIndex((s) => s.stage === entry.currentStage)
        : -1;
      if (currentStageIndex < 0 || !config) return false;
      const stageConfig = config.stages[currentStageIndex];
      return entry.failedAttempts >= stageConfig.maxAttempts;
    };

    if (shouldAdvanceStage() && config) {
      const currentStageIndex = config.stages.findIndex((s) => s.stage === entry.currentStage);
      const nextStageIndex = currentStageIndex + 1;
      if (nextStageIndex < config.stages.length) {
        const nextStage = config.stages[nextStageIndex];
        entry.currentStage = nextStage.stage;
        entry.failedAttempts = 0;
        entry.nextActionAt = now_ts + nextStage.delayHours * ONE_HOUR_MS;
        this.sendCommunication(entry, nextStage);
      } else {
        entry.currentStage = 'cancel';
        entry.nextActionAt = now_ts + 24 * ONE_HOUR_MS;
      }
    } else {
      const delay = this.calculateRetryDelay(failureType, entry.failedAttempts);
      entry.nextActionAt = now_ts + delay * ONE_HOUR_MS;
    }

    this.entries.set(subscriptionId, entry);
    return entry;
  }

  recordSuccessfulCharge(subscriptionId: string): void {
    const entry = this.entries.get(subscriptionId);
    if (entry) {
      this.retryHistory.push({
        subscriptionId,
        failureType: 'unknown',
        attempt: entry.failedAttempts,
        success: true,
        timestamp: now(),
        delayHours: 0,
      });
      this.progressiveEngine.recordRecovery(entry);
    }

    this.entries.delete(subscriptionId);
    this.communicationLog.delete(subscriptionId);
  }

  getDunningEntry(subscriptionId: string): DunningEntry | undefined {
    return this.entries.get(subscriptionId);
  }

  listActiveDunning(merchantId?: string): DunningEntry[] {
    const all = Array.from(this.entries.values());
    if (merchantId) {
      return all.filter((e) => e.merchantId === merchantId);
    }
    return all;
  }

  pauseDunning(subscriptionId: string): DunningEntry | null {
    const entry = this.entries.get(subscriptionId);
    if (!entry) return null;
    entry.isPaused = true;
    entry.updatedAt = now();
    this.entries.set(subscriptionId, entry);
    return entry;
  }

  resumeDunning(subscriptionId: string): DunningEntry | null {
    const entry = this.entries.get(subscriptionId);
    if (!entry) return null;

    const config = this.configurations.get(entry.planId);
    const stageConfig = config?.stages.find((s) => s.stage === entry.currentStage);
    entry.isPaused = false;
    entry.nextActionAt = now() + (stageConfig?.delayHours ?? 24) * ONE_HOUR_MS;
    entry.updatedAt = now();
    this.entries.set(subscriptionId, entry);
    return entry;
  }

  overrideStage(subscriptionId: string, stage: DunningStage): DunningEntry | null {
    const entry = this.entries.get(subscriptionId);
    if (!entry) return null;

    const config = this.configurations.get(entry.planId);
    const stageConfig = config?.stages.find((s) => s.stage === stage);
    entry.currentStage = stage;
    entry.failedAttempts = 0;
    entry.nextActionAt = now() + (stageConfig?.delayHours ?? 24) * ONE_HOUR_MS;
    entry.updatedAt = now();
    this.entries.set(subscriptionId, entry);
    return entry;
  }

  getCommunications(subscriptionId: string): DunningCommunication[] {
    return this.communicationLog.get(subscriptionId) ?? [];
  }

  getRetryAnalytics(merchantId?: string): RetryAnalytics {
    const entries = this.listActiveDunning(merchantId);
    const relevantHistory = merchantId
      ? this.retryHistory.filter((h) =>
          entries.some((e) => e.subscriptionId === h.subscriptionId)
        )
      : this.retryHistory;

    const totalRetries = relevantHistory.length;
    const successfulRetries = relevantHistory.filter((h) => h.success).length;
    const failedRetries = totalRetries - successfulRetries;

    const retriesByFailureType: Record<FailureType, number> = {
      insufficient_funds: 0,
      card_declined: 0,
      expired_card: 0,
      network_error: 0,
      processing_error: 0,
      auth_required: 0,
      unknown: 0,
    };

    const retriesByStage: Record<DunningStage, number> = {
      retry: 0,
      warn: 0,
      suspend: 0,
      cancel: 0,
    };

    for (const entry of entries) {
      retriesByStage[entry.currentStage] = (retriesByStage[entry.currentStage] ?? 0) + 1;
    }

    for (const h of relevantHistory) {
      retriesByFailureType[h.failureType] = (retriesByFailureType[h.failureType] ?? 0) + 1;
    }

    const successfulSubscriptionIds = new Set(
      relevantHistory.filter((h) => h.success).map((h) => h.subscriptionId)
    );

    const recoveryTimes: number[] = [];
    for (const subId of successfulSubscriptionIds) {
      const subHistory = relevantHistory.filter((h) => h.subscriptionId === subId);
      if (subHistory.length >= 2) {
        const first = subHistory[0];
        const last = subHistory[subHistory.length - 1];
        recoveryTimes.push((last.timestamp - first.timestamp) / ONE_DAY_MS);
      }
    }

    const avgRecoveryTime =
      recoveryTimes.length > 0
        ? recoveryTimes.reduce((s, t) => s + t, 0) / recoveryTimes.length
        : 0;

    const attemptsPerSuccess: number[] = [];
    for (const subId of successfulSubscriptionIds) {
      const subHistory = relevantHistory.filter((h) => h.subscriptionId === subId);
      attemptsPerSuccess.push(subHistory.length);
    }

    return {
      totalRetries,
      successfulRetries,
      failedRetries,
      retryRate: totalRetries > 0 ? Math.round((failedRetries / totalRetries) * 100) : 0,
      successRate: totalRetries > 0 ? Math.round((successfulRetries / totalRetries) * 100) : 0,
      averageRetriesBeforeSuccess:
        attemptsPerSuccess.length > 0
          ? Math.round(attemptsPerSuccess.reduce((s, a) => s + a, 0) / attemptsPerSuccess.length)
          : 0,
      retriesByFailureType,
      retriesByStage,
      averageTimeToRecovery: Math.round(avgRecoveryTime * 10) / 10,
    };
  }

  getAnalytics(merchantId?: string): DunningAnalytics {
    const allEntries = this.listActiveDunning(merchantId);
    const stageBreakdown: Record<DunningStage, number> = {
      retry: 0,
      warn: 0,
      suspend: 0,
      cancel: 0,
    };

    for (const entry of allEntries) {
      stageBreakdown[entry.currentStage] = (stageBreakdown[entry.currentStage] ?? 0) + 1;
    }

    const retryAnalytics = this.getRetryAnalytics(merchantId);

    return {
      totalActiveDunning: allEntries.length,
      stageBreakdown,
      recoveryRate: retryAnalytics.successRate,
      totalRecovered: retryAnalytics.successfulRetries,
      totalLost: stageBreakdown.cancel,
      averageDaysToRecovery: retryAnalytics.averageTimeToRecovery,
      stageSuccessRates: {
        retry: retryAnalytics.retriesByStage.retry,
        warn: retryAnalytics.retriesByStage.warn,
        suspend: retryAnalytics.retriesByStage.suspend,
        cancel: retryAnalytics.retriesByStage.cancel,
      },
    };
  }

  private sendCommunication(entry: DunningEntry, stageConfig: DunningStageConfig): DunningCommunication {
    const template = DUNNING_TEMPLATES.find((t) => t.id === stageConfig.templateId);
    const comm: DunningCommunication = {
      id: createId('dcom'),
      stage: stageConfig.stage,
      channel: 'push',
      templateId: stageConfig.templateId,
      sentAt: now(),
      status: 'sent',
      metadata: {
        subscription_id: entry.subscriptionId,
        template_subject: template?.subject ?? '',
      },
    };

    const log = this.communicationLog.get(entry.subscriptionId) ?? [];
    log.push(comm);
    this.communicationLog.set(entry.subscriptionId, log);
    entry.communicationLog.push(comm);

    return comm;
  }

  getProcessableEntries(): DunningEntry[] {
    const now_ts = now();
    return Array.from(this.entries.values()).filter(
      (e) => !e.isPaused && e.nextActionAt <= now_ts
    );
  }
}

export const dunningService = new DunningService();
