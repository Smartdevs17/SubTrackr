import type {
  DunningAnalytics,
  DunningCommunication,
  DunningCommunicationTemplate,
  DunningConfiguration,
  DunningEntry,
  DunningStage,
  DunningStageConfig,
  FailureReason,
  RetryStrategy
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

/**
 * Shape of the delay curve applied between retries of the same stage.
 *
 * - `fixed`       — every attempt waits `baseDelayHours`.
 * - `linear`      — attempt N waits `baseDelayHours * N`.
 * - `exponential` — attempt N waits `baseDelayHours * multiplier^(N-1)`.
 * - `exponential_jitter` — as `exponential`, with a random ± `jitterRatio`
 *   spread so a batch of failures caused by one upstream outage does not
 *   retry in lockstep.
 */
export type BackoffPolicy = 'fixed' | 'linear' | 'exponential' | 'exponential_jitter';

export interface RetryScheduleConfig {
  failureType: FailureType;
  baseDelayHours: number;
  maxRetries: number;
  backoffMultiplier: number;
  maxDelayHours: number;
  backoffPolicy: BackoffPolicy;
  /** Fraction of the computed delay used as jitter spread, e.g. 0.2 = ±20%. */
  jitterRatio: number;
  /** When false the failure type is treated as terminal and is never retried. */
  retryable: boolean;
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

const FAILURE_TYPES: FailureType[] = [
  'insufficient_funds',
  'card_declined',
  'expired_card',
  'network_error',
  'processing_error',
  'auth_required',
  'unknown',
];

const DEFAULT_RETRY_SCHEDULES: RetryScheduleConfig[] = [
  { failureType: 'insufficient_funds', baseDelayHours: 1, maxRetries: 5, backoffMultiplier: 2, maxDelayHours: 48, backoffPolicy: 'exponential_jitter', jitterRatio: 0.2, retryable: true },
  { failureType: 'card_declined', baseDelayHours: 2, maxRetries: 3, backoffMultiplier: 3, maxDelayHours: 72, backoffPolicy: 'exponential', jitterRatio: 0, retryable: true },
  // A card that has expired will keep failing until the payer acts, so a flat
  // daily nudge beats an escalating backoff here.
  { failureType: 'expired_card', baseDelayHours: 24, maxRetries: 2, backoffMultiplier: 1, maxDelayHours: 24, backoffPolicy: 'fixed', jitterRatio: 0, retryable: true },
  { failureType: 'network_error', baseDelayHours: 0.5, maxRetries: 6, backoffMultiplier: 1.5, maxDelayHours: 12, backoffPolicy: 'exponential_jitter', jitterRatio: 0.3, retryable: true },
  { failureType: 'processing_error', baseDelayHours: 1, maxRetries: 4, backoffMultiplier: 2, maxDelayHours: 24, backoffPolicy: 'exponential', jitterRatio: 0, retryable: true },
  { failureType: 'auth_required', baseDelayHours: 0.25, maxRetries: 3, backoffMultiplier: 1, maxDelayHours: 1, backoffPolicy: 'linear', jitterRatio: 0, retryable: true },
  { failureType: 'unknown', baseDelayHours: 1, maxRetries: 3, backoffMultiplier: 2, maxDelayHours: 24, backoffPolicy: 'exponential', jitterRatio: 0, retryable: true },
];

/** Failure types share names with `FailureReason` only partially; map them across. */
const FAILURE_TYPE_TO_REASON: Record<FailureType, FailureReason> = {
  insufficient_funds: 'insufficient_funds',
  card_declined: 'default',
  expired_card: 'expired_card',
  network_error: 'network',
  processing_error: 'default',
  auth_required: 'default',
  unknown: 'default',
};

const emptyStageRecord = (): Record<DunningStage, number> => ({
  retry: 0,
  warn: 0,
  suspend: 0,
  cancel: 0,
});

const emptyFailureTypeRecord = (): Record<FailureType, number> =>
  FAILURE_TYPES.reduce((acc, type) => {
    acc[type] = 0;
    return acc;
  }, {} as Record<FailureType, number>);

const FALLBACK_STRATEGY: RetryStrategy = {
  stages: DEFAULT_DUNNING_STAGES,
  maxRetries: 3,
  retryIntervalHours: 1,
  warnAfterFailures: 3,
  suspendAfterDays: 3,
  cancelAfterDays: 7,
  communicationChannels: ['email', 'push'],
};

interface RetryHistoryRecord {
  subscriptionId: string;
  merchantId: string;
  failureType: FailureType;
  attempt: number;
  success: boolean;
  timestamp: number;
  delayHours: number;
}

export class DunningService {
  private entries = new Map<string, DunningEntry>();
  private configurations = new Map<string, DunningConfiguration>();
  private communicationLog = new Map<string, DunningCommunication[]>();
  private templates: DunningCommunicationTemplate[] = [...DUNNING_TEMPLATES];
  private retrySchedules: RetryScheduleConfig[] = [...DEFAULT_RETRY_SCHEDULES];
  private retryHistory: RetryHistoryRecord[] = [];
  private recoveredEntries: DunningEntry[] = [];
  private progressiveEngine: ProgressiveDunningEngine;

  constructor(engine: ProgressiveDunningEngine = progressiveDunningEngine) {
    this.progressiveEngine = engine;
  }

  configurePlan(planId: string, config: Partial<DunningConfiguration>): DunningConfiguration {
    const existing = this.configurations.get(planId);

    const defaultStrategy: RetryStrategy =
      config.defaultStrategy ?? existing?.defaultStrategy ?? { ...FALLBACK_STRATEGY };

    const merged: DunningConfiguration = {
      planId,
      defaultStrategy,
      strategies: config.strategies ?? existing?.strategies ?? {},
      abTestConfig: config.abTestConfig ?? existing?.abTestConfig,
    };

    this.configurations.set(planId, merged);
    return merged;
  }

  configureABTest(planId: string, enabled: boolean, variants: Array<{ id: string; weight: number; strategy: RetryStrategy }>): void {
    const config = this.configurations.get(planId);
    if (config) {
      config.abTestConfig = { enabled, variants };
      this.configurations.set(planId, config);
    } else {
      this.configurePlan(planId, { abTestConfig: { enabled, variants } });
    }
  }

  getConfiguration(planId: string): DunningConfiguration | undefined {
    return this.configurations.get(planId);
  }

  /**
   * Resolves the retry strategy in force for a subscription, most specific
   * first: A/B variant → failure-reason override → plan default → built-in.
   */
  getStrategy(planId: string, failureReason: FailureReason, abTestVariant?: string): RetryStrategy {
    const config = this.configurations.get(planId);
    if (!config) return FALLBACK_STRATEGY;

    if (abTestVariant && config.abTestConfig?.enabled) {
      const variant = config.abTestConfig.variants.find((v) => v.id === abTestVariant);
      if (variant) return variant.strategy;
    }

    return config.strategies?.[failureReason] ?? config.defaultStrategy ?? FALLBACK_STRATEGY;
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
      backoffPolicy: schedule.backoffPolicy ?? existing?.backoffPolicy ?? 'exponential',
      jitterRatio: schedule.jitterRatio ?? existing?.jitterRatio ?? 0,
      retryable: schedule.retryable ?? existing?.retryable ?? true,
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
      this.retrySchedules.find((s) => s.failureType === 'unknown') ??
      DEFAULT_RETRY_SCHEDULES[DEFAULT_RETRY_SCHEDULES.length - 1]
    );
  }

  listRetrySchedules(): RetryScheduleConfig[] {
    return this.retrySchedules.map((s) => ({ ...s }));
  }

  /** Delay in hours before attempt `attemptNumber` (1-based), capped at `maxDelayHours`. */
  calculateRetryDelay(failureType: FailureType, attemptNumber: number): number {
    const schedule = this.getRetrySchedule(failureType);
    const attempt = Math.max(1, attemptNumber);

    let delay: number;
    switch (schedule.backoffPolicy) {
      case 'fixed':
        delay = schedule.baseDelayHours;
        break;
      case 'linear':
        delay = schedule.baseDelayHours * attempt;
        break;
      case 'exponential':
      case 'exponential_jitter':
      default:
        delay = schedule.baseDelayHours * Math.pow(schedule.backoffMultiplier, attempt - 1);
        break;
    }

    delay = Math.min(delay, schedule.maxDelayHours);

    if (schedule.backoffPolicy === 'exponential_jitter' && schedule.jitterRatio > 0) {
      const spread = delay * schedule.jitterRatio;
      // Jitter both directions, then clamp so the delay stays inside the
      // configured envelope.
      delay = delay + (Math.random() * 2 - 1) * spread;
      delay = Math.min(Math.max(delay, 0), schedule.maxDelayHours);
    }

    return delay;
  }

  startDunning(
    subscriptionId: string,
    subscriberId: string,
    merchantId: string,
    planId: string,
    failureReason: FailureReason = 'default'
  ): DunningEntry {
    const existing = this.entries.get(subscriptionId);
    if (existing) {
      return existing;
    }

    const config = this.configurations.get(planId);
    let abTestVariant: string | undefined;
    if (config?.abTestConfig?.enabled && config.abTestConfig.variants.length > 0) {
      // Pick variant randomly based on weight
      const totalWeight = config.abTestConfig.variants.reduce((sum, v) => sum + v.weight, 0);
      let r = Math.random() * totalWeight;
      for (const v of config.abTestConfig.variants) {
        r -= v.weight;
        if (r <= 0) {
          abTestVariant = v.id;
          break;
        }
      }
    }

    const strategy = this.getStrategy(planId, failureReason, abTestVariant);
    const firstStage = strategy.stages[0] ?? DEFAULT_DUNNING_STAGES[0];
    const now_ts = now();

    const entry: DunningEntry = {
      id: createId('dun'),
      subscriptionId,
      subscriberId,
      merchantId,
      planId,
      failureReason,
      abTestVariant,
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

    const strategy = this.getStrategy(updated.planId, updated.failureReason, updated.abTestVariant);
    const stageConfig =
      strategy.stages.find((s) => s.stage === updated.currentStage) ??
      DEFAULT_DUNNING_STAGES.find((s) => s.stage === updated.currentStage);

    if (stageConfig) {
      this.sendCommunication(updated, stageConfig, strategy);
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

    const strategy = this.getStrategy(entry.planId, entry.failureReason, entry.abTestVariant);
    const schedule = this.getRetrySchedule(failureType);
    const now_ts = now();

    entry.failedAttempts += 1;
    entry.totalFailedCharges += 1;
    entry.lastFailureAt = now_ts;
    entry.lastAttemptAt = now_ts;
    entry.updatedAt = now_ts;

    const stages = strategy.stages.length > 0 ? strategy.stages : DEFAULT_DUNNING_STAGES;
    const currentStageIndex = stages.findIndex((s) => s.stage === entry.currentStage);
    const stageConfig = currentStageIndex >= 0 ? stages[currentStageIndex] : undefined;

    // A non-retryable failure (e.g. a hard decline) skips the retry budget and
    // escalates on the first occurrence.
    const budgetExhausted =
      !schedule.retryable ||
      entry.failedAttempts >= schedule.maxRetries ||
      (stageConfig !== undefined && entry.failedAttempts >= stageConfig.maxAttempts);

    let delayHours = 0;

    if (budgetExhausted) {
      const nextStageIndex = currentStageIndex + 1;
      if (currentStageIndex >= 0 && nextStageIndex < stages.length) {
        const nextStage = stages[nextStageIndex];
        entry.currentStage = nextStage.stage;
        entry.failedAttempts = 0;
        delayHours = nextStage.delayHours;
        entry.nextActionAt = now_ts + delayHours * ONE_HOUR_MS;
        this.progressiveEngine.trackStageEntry(entry, now_ts);
        this.sendCommunication(entry, nextStage, strategy);
      } else {
        entry.currentStage = 'cancel';
        entry.failedAttempts = 0;
        delayHours = 24;
        entry.nextActionAt = now_ts + delayHours * ONE_HOUR_MS;
        this.progressiveEngine.trackStageEntry(entry, now_ts);
        const cancelStage =
          stages.find((s) => s.stage === 'cancel') ??
          DEFAULT_DUNNING_STAGES.find((s) => s.stage === 'cancel');
        if (cancelStage) {
          this.sendCommunication(entry, cancelStage, strategy);
        }
      }
    } else {
      delayHours = this.calculateRetryDelay(failureType, entry.failedAttempts);
      entry.nextActionAt = now_ts + delayHours * ONE_HOUR_MS;
    }

    this.retryHistory.push({
      subscriptionId,
      merchantId: entry.merchantId,
      failureType,
      attempt: entry.totalFailedCharges,
      success: false,
      timestamp: now_ts,
      delayHours,
    });

    this.entries.set(subscriptionId, entry);
    return entry;
  }

  recordSuccessfulCharge(subscriptionId: string): DunningEntry | null {
    const entry = this.entries.get(subscriptionId);
    if (!entry) return null;

    const now_ts = now();
    this.retryHistory.push({
      subscriptionId,
      merchantId: entry.merchantId,
      failureType: FAILURE_TYPES.find((t) => FAILURE_TYPE_TO_REASON[t] === entry.failureReason) ?? 'unknown',
      attempt: entry.totalFailedCharges + 1,
      success: true,
      timestamp: now_ts,
      delayHours: 0,
    });
    this.progressiveEngine.recordRecovery(entry, now_ts);

    entry.updatedAt = now_ts;
    this.recoveredEntries.push(entry);
    this.entries.delete(subscriptionId);
    return entry;
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

  listRecoveredDunning(merchantId?: string): DunningEntry[] {
    if (merchantId) {
      return this.recoveredEntries.filter((e) => e.merchantId === merchantId);
    }
    return [...this.recoveredEntries];
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

    const strategy = this.getStrategy(entry.planId, entry.failureReason, entry.abTestVariant);
    const stageConfig = strategy.stages.find((s) => s.stage === entry.currentStage);
    entry.isPaused = false;
    entry.nextActionAt = now() + (stageConfig?.delayHours ?? 24) * ONE_HOUR_MS;
    entry.updatedAt = now();
    this.entries.set(subscriptionId, entry);
    return entry;
  }

  overrideStage(subscriptionId: string, stage: DunningStage): DunningEntry | null {
    const entry = this.entries.get(subscriptionId);
    if (!entry) return null;

    const strategy = this.getStrategy(entry.planId, entry.failureReason, entry.abTestVariant);
    const stageConfig = strategy.stages.find((s) => s.stage === stage);
    entry.currentStage = stage;
    entry.failedAttempts = 0;
    entry.nextActionAt = now() + (stageConfig?.delayHours ?? 24) * ONE_HOUR_MS;
    entry.updatedAt = now();
    this.entries.set(subscriptionId, entry);
    this.progressiveEngine.trackStageEntry(entry);
    return entry;
  }

  getCommunications(subscriptionId: string): DunningCommunication[] {
    return this.communicationLog.get(subscriptionId) ?? [];
  }

  getRetryAnalytics(merchantId?: string): RetryAnalytics {
    const relevantHistory = merchantId
      ? this.retryHistory.filter((h) => h.merchantId === merchantId)
      : this.retryHistory;

    const totalRetries = relevantHistory.length;
    const successfulRetries = relevantHistory.filter((h) => h.success).length;
    const failedRetries = totalRetries - successfulRetries;

    const retriesByFailureType = emptyFailureTypeRecord();
    const retriesByStage = emptyStageRecord();

    for (const entry of this.listActiveDunning(merchantId)) {
      retriesByStage[entry.currentStage] = (retriesByStage[entry.currentStage] ?? 0) + 1;
    }

    for (const h of relevantHistory) {
      retriesByFailureType[h.failureType] = (retriesByFailureType[h.failureType] ?? 0) + 1;
    }

    const successfulSubscriptionIds = new Set(
      relevantHistory.filter((h) => h.success).map((h) => h.subscriptionId)
    );

    const recoveryTimes: number[] = [];
    const attemptsPerSuccess: number[] = [];
    for (const subId of successfulSubscriptionIds) {
      const subHistory = relevantHistory.filter((h) => h.subscriptionId === subId);
      attemptsPerSuccess.push(subHistory.length);
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
    const recovered = this.listRecoveredDunning(merchantId);

    const stageBreakdown = emptyStageRecord();
    for (const entry of allEntries) {
      stageBreakdown[entry.currentStage] = (stageBreakdown[entry.currentStage] ?? 0) + 1;
    }

    const retryAnalytics = this.getRetryAnalytics(merchantId);

    // Recovery rate is measured over closed outcomes only: entries that were
    // recovered versus entries that reached `cancel`.
    const closed = recovered.length + stageBreakdown.cancel;
    const recoveryRate = closed > 0 ? Math.round((recovered.length / closed) * 100) : 0;

    const recoveryDays = recovered
      .map((e) => (e.updatedAt - e.firstFailureAt) / ONE_DAY_MS)
      .filter((d) => d >= 0);
    const averageDaysToRecovery =
      recoveryDays.length > 0
        ? Math.round((recoveryDays.reduce((s, d) => s + d, 0) / recoveryDays.length) * 10) / 10
        : 0;

    return {
      totalActiveDunning: allEntries.length,
      stageBreakdown,
      recoveryRate,
      totalRecovered: recovered.length,
      totalLost: stageBreakdown.cancel,
      averageDaysToRecovery,
      stageSuccessRates: retryAnalytics.retriesByStage,
    };
  }

  private sendCommunication(
    entry: DunningEntry,
    stageConfig: DunningStageConfig,
    strategy?: RetryStrategy
  ): DunningCommunication {
    const template = this.templates.find((t) => t.id === stageConfig.templateId);
    const channel = strategy?.communicationChannels?.[0] ?? 'push';
    const comm: DunningCommunication = {
      id: createId('dcom'),
      stage: stageConfig.stage,
      channel,
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

  addTemplate(template: DunningCommunicationTemplate): void {
    if (!this.templates.find((t) => t.id === template.id)) {
      this.templates.push(template);
    }
  }

  updateTemplate(id: string, template: Partial<DunningCommunicationTemplate>): void {
    const index = this.templates.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.templates[index] = { ...this.templates[index], ...template };
    }
  }

  removeTemplate(id: string): void {
    this.templates = this.templates.filter((t) => t.id !== id);
  }

  getTemplates(): DunningCommunicationTemplate[] {
    return [...this.templates];
  }

  /** Clears all in-memory state. Intended for tests and worker restarts. */
  reset(): void {
    this.entries.clear();
    this.configurations.clear();
    this.communicationLog.clear();
    this.templates = [...DUNNING_TEMPLATES];
    this.retrySchedules = [...DEFAULT_RETRY_SCHEDULES];
    this.retryHistory = [];
    this.recoveredEntries = [];
  }
}

export const dunningService = new DunningService();
