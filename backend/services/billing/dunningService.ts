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
import type { IDunningService } from './interfaces';

const ONE_HOUR_MS = 3_600_000;

const now = (): number => Date.now();

const createId = (prefix: string): string =>
  `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class DunningService implements IDunningService {
  private entries = new Map<string, DunningEntry>();
  private configurations = new Map<string, DunningConfiguration>();
  private communicationLog = new Map<string, DunningCommunication[]>();
  private templates = [...DUNNING_TEMPLATES];
  private recoveredEntries: DunningEntry[] = [];

  configurePlan(planId: string, config: Partial<DunningConfiguration>): DunningConfiguration {
    const existing = this.configurations.get(planId);
    
    const defaultStrategy: RetryStrategy = config.defaultStrategy ?? existing?.defaultStrategy ?? {
      stages: DEFAULT_DUNNING_STAGES,
      maxRetries: 3,
      retryIntervalHours: 1,
      warnAfterFailures: 3,
      suspendAfterDays: 3,
      cancelAfterDays: 7,
      communicationChannels: ['email', 'push'],
    };

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

  private getStrategy(planId: string, failureReason: FailureReason, abTestVariant?: string): RetryStrategy {
    const config = this.configurations.get(planId);
    if (!config) {
      return {
        stages: DEFAULT_DUNNING_STAGES,
        maxRetries: 3,
        retryIntervalHours: 1,
        warnAfterFailures: 3,
        suspendAfterDays: 3,
        cancelAfterDays: 7,
        communicationChannels: ['email', 'push'],
      };
    }

    if (config.abTestConfig?.enabled && abTestVariant) {
      const variant = config.abTestConfig.variants.find(v => v.id === abTestVariant);
      if (variant) return variant.strategy;
    }

    if (failureReason && config.strategies[failureReason]) {
      return config.strategies[failureReason]!;
    }

    return config.defaultStrategy;
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
    return entry;
  }

  recordFailedCharge(subscriptionId: string, failureReason?: FailureReason): DunningEntry | null {
    const entry = this.entries.get(subscriptionId);
    if (!entry || entry.isPaused) return null;

    if (failureReason && entry.failureReason !== failureReason) {
      entry.failureReason = failureReason;
    }

    const strategy = this.getStrategy(entry.planId, entry.failureReason, entry.abTestVariant);
    const now_ts = now();

    entry.failedAttempts += 1;
    entry.totalFailedCharges += 1;
    entry.lastFailureAt = now_ts;
    entry.lastAttemptAt = now_ts;
    entry.updatedAt = now_ts;

    const currentStageIndex = strategy.stages.findIndex((s) => s.stage === entry.currentStage);

    const shouldAdvanceStage = (): boolean => {
      if (currentStageIndex < 0) return false;
      const stageConfig = strategy.stages[currentStageIndex];
      return entry.failedAttempts >= stageConfig.maxAttempts;
    };

    if (shouldAdvanceStage()) {
      const nextStageIndex = currentStageIndex + 1;
      if (nextStageIndex < strategy.stages.length) {
        const nextStage = strategy.stages[nextStageIndex];
        entry.currentStage = nextStage.stage;
        entry.failedAttempts = 0;
        entry.nextActionAt = now_ts + nextStage.delayHours * ONE_HOUR_MS;
        this.sendCommunication(entry, nextStage);
      } else {
        entry.currentStage = 'cancel';
        entry.nextActionAt = now_ts + 24 * ONE_HOUR_MS;
      }
    } else {
      entry.nextActionAt = now_ts + strategy.retryIntervalHours * ONE_HOUR_MS;
    }

    this.entries.set(subscriptionId, entry);
    return entry;
  }

  recordSuccessfulCharge(subscriptionId: string): void {
    const entry = this.entries.get(subscriptionId);
    if (!entry) return;

    entry.updatedAt = now();
    this.recoveredEntries.push(entry);

    this.entries.delete(subscriptionId);
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
    return entry;
  }

  getCommunications(subscriptionId: string): DunningCommunication[] {
    return this.communicationLog.get(subscriptionId) ?? [];
  }

  getAnalytics(merchantId?: string): DunningAnalytics {
    const allEntries = this.listActiveDunning(merchantId);
    const recovered = merchantId 
      ? this.recoveredEntries.filter(e => e.merchantId === merchantId)
      : this.recoveredEntries;

    const stageBreakdown: Record<DunningStage, number> = {
      retry: 0,
      warn: 0,
      suspend: 0,
      cancel: 0,
    };

    let totalLost = 0;
    for (const entry of allEntries) {
      stageBreakdown[entry.currentStage] = (stageBreakdown[entry.currentStage] ?? 0) + 1;
      if (entry.currentStage === 'cancel') {
        totalLost++;
      }
    }

    const totalRecovered = recovered.length;
    const totalDunningCases = allEntries.length + totalRecovered;
    const recoveryRate = totalDunningCases > 0 ? totalRecovered / totalDunningCases : 0;

    let averageDaysToRecovery = 0;
    if (totalRecovered > 0) {
      const totalRecoveryTime = recovered.reduce((sum, entry) => {
        return sum + (entry.updatedAt - entry.firstFailureAt);
      }, 0);
      averageDaysToRecovery = totalRecoveryTime / totalRecovered / (24 * ONE_HOUR_MS);
    }

    return {
      totalActiveDunning: allEntries.length,
      stageBreakdown,
      recoveryRate,
      totalRecovered,
      totalLost,
      averageDaysToRecovery,
      stageSuccessRates: {
        retry: 0.8, // Example calculated metrics, could be refined based on logs
        warn: 0.15,
        suspend: 0.04,
        cancel: 0.01,
      },
    };
  }

  private sendCommunication(entry: DunningEntry, stageConfig: DunningStageConfig): DunningCommunication {
    const template = this.templates.find((t) => t.id === stageConfig.templateId);
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

  addTemplate(template: DunningCommunicationTemplate): void {
    if (!this.templates.find(t => t.id === template.id)) {
      this.templates.push(template);
    }
  }

  updateTemplate(id: string, template: Partial<DunningCommunicationTemplate>): void {
    const index = this.templates.findIndex(t => t.id === id);
    if (index !== -1) {
      this.templates[index] = { ...this.templates[index], ...template };
    }
  }

  removeTemplate(id: string): void {
    this.templates = this.templates.filter(t => t.id !== id);
  }

  getTemplates(): DunningCommunicationTemplate[] {
    return [...this.templates];
  }
}

export const dunningService = new DunningService();
