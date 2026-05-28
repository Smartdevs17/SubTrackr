import type {
  DunningAnalytics,
  DunningCommunication,
  DunningCommunicationTemplate,
  DunningConfiguration,
  DunningEntry,
  DunningStage,
  DunningStageConfig,
} from '../../src/types/dunning';
import { DEFAULT_DUNNING_STAGES, DUNNING_TEMPLATES } from '../../src/types/dunning';

const ONE_HOUR_MS = 3_600_000;

const now = (): number => Date.now();

const createId = (prefix: string): string =>
  `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class DunningService {
  private entries = new Map<string, DunningEntry>();
  private configurations = new Map<string, DunningConfiguration>();
  private communicationLog = new Map<string, DunningCommunication[]>();

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
    return entry;
  }

  recordFailedCharge(subscriptionId: string): DunningEntry | null {
    const entry = this.entries.get(subscriptionId);
    if (!entry || entry.isPaused) return null;

    const config = this.configurations.get(entry.planId);
    const now_ts = now();

    entry.failedAttempts += 1;
    entry.totalFailedCharges += 1;
    entry.lastFailureAt = now_ts;
    entry.lastAttemptAt = now_ts;
    entry.updatedAt = now_ts;

    const currentStageIndex = config
      ? config.stages.findIndex((s) => s.stage === entry.currentStage)
      : -1;

    const shouldAdvanceStage = (): boolean => {
      if (currentStageIndex < 0) return false;
      if (!config) return false;
      const stageConfig = config.stages[currentStageIndex];
      return entry.failedAttempts >= stageConfig.maxAttempts;
    };

    if (shouldAdvanceStage() && config) {
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
      const retryDelay = config?.retryIntervalHours ?? 1;
      entry.nextActionAt = now_ts + retryDelay * ONE_HOUR_MS;
    }

    this.entries.set(subscriptionId, entry);
    return entry;
  }

  recordSuccessfulCharge(subscriptionId: string): void {
    const entry = this.entries.get(subscriptionId);
    if (!entry) return;

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

    const totalRecovered = Array.from(this.entries.values()).filter(
      (e) => e.totalFailedCharges === 0
    ).length;

    return {
      totalActiveDunning: allEntries.length,
      stageBreakdown,
      recoveryRate: 0,
      totalRecovered,
      totalLost: stageBreakdown.cancel,
      averageDaysToRecovery: 0,
      stageSuccessRates: {
        retry: 0,
        warn: 0,
        suspend: 0,
        cancel: 0,
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
