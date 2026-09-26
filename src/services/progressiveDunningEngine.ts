/**
 * ProgressiveDunningEngine — configurable progressive escalation for failed-payment recovery.
 *
 * Pure TypeScript (no Express/DB). Policies define when to move forward through
 * retry → warn → suspend → cancel; analytics and optimizePolicy drive improvements.
 */

import type { DunningEntry } from '../types/dunning';
import { DUNNING_TEMPLATES } from '../types/dunning';
import type {
  EscalationEvent,
  EscalationPolicy,
  EscalationRule,
  OptimizationSuggestion,
  ProgressiveDunningAnalytics,
  StageFunnelStats,
  TimeInStageStats,
  EscalationPathRecovery,
} from '../types/dunningEscalation';
import {
  STAGE_ORDER,
  createDefaultEscalationPolicy,
  isForwardEscalation,
  stageIndex,
} from '../types/dunningEscalation';
import type { DunningStage } from '../types/dunning';

const ONE_HOUR_MS = 3_600_000;

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export interface ApplyEscalationResult {
  entry: DunningEntry;
  event: EscalationEvent;
}

export interface ProcessDueResult {
  processed: ApplyEscalationResult[];
  skipped: string[];
}

interface StageTimingSample {
  stage: DunningStage;
  hours: number;
}

interface RecoveryRecord {
  subscriptionId: string;
  path: string;
  recovered: boolean;
  escalationCount: number;
  at: number;
}

export class ProgressiveDunningEngine {
  private policies = new Map<string, EscalationPolicy>();
  private events: EscalationEvent[] = [];
  private escalationCounts = new Map<string, number>();
  private stageEnteredAt = new Map<string, number>();
  private recoveryEstimates = new Map<string, number>();
  private timingSamples: StageTimingSample[] = [];
  private recoveryRecords: RecoveryRecord[] = [];
  private stageEntries: Record<DunningStage, number> = {
    retry: 0,
    warn: 0,
    suspend: 0,
    cancel: 0,
  };
  private stageExits: Record<DunningStage, number> = {
    retry: 0,
    warn: 0,
    suspend: 0,
    cancel: 0,
  };
  private stageRecoveries: Record<DunningStage, number> = {
    retry: 0,
    warn: 0,
    suspend: 0,
    cancel: 0,
  };
  private stageEscalations: Record<DunningStage, number> = {
    retry: 0,
    warn: 0,
    suspend: 0,
    cancel: 0,
  };
  private pathCounts = new Map<string, { escalations: number; recoveries: number }>();
  private activeStageCounts = new Map<string, DunningStage>();

  constructor(seedDefaultPolicy = true) {
    if (seedDefaultPolicy) {
      this.configurePolicy(createDefaultEscalationPolicy('default'));
    }
  }

  configurePolicy(policy: EscalationPolicy): EscalationPolicy {
    const sanitizedRules = policy.rules
      .filter((r) => isForwardEscalation(r.fromStage, r.toStage))
      .slice()
      .sort((a, b) => b.priority - a.priority);

    const normalized: EscalationPolicy = {
      ...policy,
      rules: sanitizedRules,
      maxEscalations: Math.max(1, policy.maxEscalations),
    };
    this.policies.set(policy.planId, normalized);
    return normalized;
  }

  getPolicy(planId: string): EscalationPolicy | undefined {
    return this.policies.get(planId);
  }

  /** Optional recovery probability estimate (0–1) used by minRecoveryProbability rules. */
  setRecoveryEstimate(subscriptionId: string, probability: number): void {
    this.recoveryEstimates.set(subscriptionId, Math.max(0, Math.min(1, probability)));
  }

  /**
   * Track that an entry entered a stage (for time-in-stage analytics).
   * Called automatically by applyEscalation; call when starting dunning too.
   */
  trackStageEntry(entry: DunningEntry, at = Date.now()): void {
    this.stageEnteredAt.set(entry.subscriptionId, at);
    this.stageEntries[entry.currentStage] = (this.stageEntries[entry.currentStage] ?? 0) + 1;
    this.activeStageCounts.set(entry.subscriptionId, entry.currentStage);
  }

  /** Record a successful recovery for analytics. */
  recordRecovery(entry: DunningEntry, at = Date.now()): void {
    const path = this.buildPath(entry.subscriptionId, entry.currentStage);
    this.stageRecoveries[entry.currentStage] = (this.stageRecoveries[entry.currentStage] ?? 0) + 1;
    this.stageExits[entry.currentStage] = (this.stageExits[entry.currentStage] ?? 0) + 1;

    const enteredAt = this.stageEnteredAt.get(entry.subscriptionId);
    if (enteredAt !== undefined) {
      this.timingSamples.push({
        stage: entry.currentStage,
        hours: (at - enteredAt) / ONE_HOUR_MS,
      });
    }

    const escalationCount = this.escalationCounts.get(entry.subscriptionId) ?? 0;
    this.recoveryRecords.push({
      subscriptionId: entry.subscriptionId,
      path,
      recovered: true,
      escalationCount,
      at,
    });

    const pathStats = this.pathCounts.get(path) ?? { escalations: 0, recoveries: 0 };
    pathStats.recoveries += 1;
    this.pathCounts.set(path, pathStats);

    this.activeStageCounts.delete(entry.subscriptionId);
    this.stageEnteredAt.delete(entry.subscriptionId);
    this.escalationCounts.delete(entry.subscriptionId);
    this.recoveryEstimates.delete(entry.subscriptionId);
  }

  /**
   * Evaluate whether the entry should escalate. Returns the next stage or null.
   * Progressive-only: never moves backward or sideways.
   */
  evaluateEscalation(entry: DunningEntry, now = Date.now()): DunningStage | null {
    const rule = this.findMatchingRule(entry, now);
    return rule?.toStage ?? null;
  }

  /** Find the highest-priority matching forward rule, or null. */
  findMatchingRule(entry: DunningEntry, now = Date.now()): EscalationRule | null {
    if (entry.isPaused) return null;

    const policy = this.policies.get(entry.planId) ?? this.policies.get('default');
    if (!policy || !policy.enabled) return null;

    const escalationsSoFar = this.escalationCounts.get(entry.subscriptionId) ?? 0;
    if (escalationsSoFar >= policy.maxEscalations) return null;

    const hoursInStage = this.hoursInCurrentStage(entry, now);
    const recoveryProb = this.recoveryEstimates.get(entry.subscriptionId) ?? 0.5;

    const candidates = policy.rules
      .filter((rule) => rule.fromStage === entry.currentStage)
      .filter((rule) => isForwardEscalation(rule.fromStage, rule.toStage))
      .filter((rule) => this.ruleMatches(rule, entry, hoursInStage, recoveryProb))
      .sort((a, b) => b.priority - a.priority);

    return candidates[0] ?? null;
  }

  applyEscalation(entry: DunningEntry, rule: EscalationRule): ApplyEscalationResult {
    if (!isForwardEscalation(rule.fromStage, rule.toStage)) {
      throw new Error(`Non-progressive escalation blocked: ${rule.fromStage} → ${rule.toStage}`);
    }
    if (entry.currentStage !== rule.fromStage) {
      throw new Error(
        `Rule fromStage ${rule.fromStage} does not match entry stage ${entry.currentStage}`
      );
    }

    const now = Date.now();
    const enteredAt = this.stageEnteredAt.get(entry.subscriptionId) ?? entry.updatedAt;
    this.timingSamples.push({
      stage: entry.currentStage,
      hours: (now - enteredAt) / ONE_HOUR_MS,
    });

    this.stageExits[entry.currentStage] = (this.stageExits[entry.currentStage] ?? 0) + 1;
    this.stageEscalations[entry.currentStage] =
      (this.stageEscalations[entry.currentStage] ?? 0) + 1;

    const reason = this.describeReason(rule, entry, now);
    const event: EscalationEvent = {
      id: createId('esc'),
      subscriptionId: entry.subscriptionId,
      planId: entry.planId,
      ruleId: rule.id,
      fromStage: rule.fromStage,
      toStage: rule.toStage,
      channels: [...rule.channels],
      templateId: rule.templateId,
      triggeredAt: now,
      reason,
    };
    this.events.push(event);

    const count = (this.escalationCounts.get(entry.subscriptionId) ?? 0) + 1;
    this.escalationCounts.set(entry.subscriptionId, count);

    const path = `${rule.fromStage}->${rule.toStage}`;
    const pathStats = this.pathCounts.get(path) ?? { escalations: 0, recoveries: 0 };
    pathStats.escalations += 1;
    this.pathCounts.set(path, pathStats);

    const updated: DunningEntry = {
      ...entry,
      currentStage: rule.toStage,
      failedAttempts: 0,
      nextActionAt: now + this.delayHoursForStage(rule.toStage) * ONE_HOUR_MS,
      updatedAt: now,
    };

    this.stageEnteredAt.set(entry.subscriptionId, now);
    this.stageEntries[rule.toStage] = (this.stageEntries[rule.toStage] ?? 0) + 1;
    this.activeStageCounts.set(entry.subscriptionId, rule.toStage);

    return { entry: updated, event };
  }

  processDueEscalations(entries: DunningEntry[], now = Date.now()): ProcessDueResult {
    const processed: ApplyEscalationResult[] = [];
    const skipped: string[] = [];

    for (const entry of entries) {
      if (entry.isPaused) {
        skipped.push(entry.subscriptionId);
        continue;
      }

      const rule = this.findMatchingRule(entry, now);
      if (!rule) {
        skipped.push(entry.subscriptionId);
        continue;
      }

      processed.push(this.applyEscalation(entry, rule));
    }

    return { processed, skipped };
  }

  getAnalytics(): ProgressiveDunningAnalytics {
    const currentlyInStage: Record<DunningStage, number> = {
      retry: 0,
      warn: 0,
      suspend: 0,
      cancel: 0,
    };
    for (const stage of this.activeStageCounts.values()) {
      currentlyInStage[stage] = (currentlyInStage[stage] ?? 0) + 1;
    }

    const stageFunnel: StageFunnelStats[] = STAGE_ORDER.map((stage) => ({
      stage,
      entered: this.stageEntries[stage] ?? 0,
      exited: this.stageExits[stage] ?? 0,
      recovered: this.stageRecoveries[stage] ?? 0,
      escalated: this.stageEscalations[stage] ?? 0,
      currentlyInStage: currentlyInStage[stage] ?? 0,
    }));

    const timeInStage: TimeInStageStats[] = STAGE_ORDER.map((stage) => {
      const samples = this.timingSamples
        .filter((s) => s.stage === stage)
        .map((s) => s.hours)
        .sort((a, b) => a - b);
      const sampleSize = samples.length;
      const averageHours =
        sampleSize > 0
          ? Math.round((samples.reduce((a, b) => a + b, 0) / sampleSize) * 10) / 10
          : 0;
      const medianHours =
        sampleSize === 0
          ? 0
          : sampleSize % 2 === 1
            ? samples[Math.floor(sampleSize / 2)]
            : Math.round(((samples[sampleSize / 2 - 1] + samples[sampleSize / 2]) / 2) * 10) / 10;
      return { stage, averageHours, medianHours, sampleSize };
    });

    const recoveryByEscalationPath: EscalationPathRecovery[] = Array.from(
      this.pathCounts.entries()
    ).map(([path, stats]) => ({
      path,
      escalations: stats.escalations,
      recoveries: stats.recoveries,
      recoveryRate:
        stats.escalations > 0 ? Math.round((stats.recoveries / stats.escalations) * 100) : 0,
    }));

    const recovered = this.recoveryRecords.filter((r) => r.recovered);
    const averageEscalationsBeforeRecovery =
      recovered.length > 0
        ? Math.round(
            (recovered.reduce((s, r) => s + r.escalationCount, 0) / recovered.length) * 10
          ) / 10
        : 0;

    const totalEscalations = this.events.length;
    const overallRecoveryRate =
      totalEscalations > 0
        ? Math.round((recovered.length / Math.max(totalEscalations, 1)) * 100)
        : recovered.length > 0
          ? 100
          : 0;

    return {
      totalEscalations,
      activePolicies: Array.from(this.policies.values()).filter((p) => p.enabled).length,
      stageFunnel,
      timeInStage,
      recoveryByEscalationPath,
      averageEscalationsBeforeRecovery,
      overallRecoveryRate,
    };
  }

  optimizePolicy(planId: string): OptimizationSuggestion[] {
    const policy = this.policies.get(planId);
    if (!policy) {
      return [
        {
          id: createId('opt'),
          planId,
          type: 'under_escalation',
          severity: 'warning',
          title: 'No escalation policy configured',
          description: `Plan "${planId}" has no progressive escalation policy.`,
          recommendedAction: 'Call configurePolicy with createDefaultEscalationPolicy(planId).',
        },
      ];
    }

    const analytics = this.getAnalytics();
    const suggestions: OptimizationSuggestion[] = [];

    for (const timing of analytics.timeInStage) {
      const rule = policy.rules.find((r) => r.fromStage === timing.stage);
      if (
        timing.sampleSize >= 3 &&
        rule?.afterHours !== undefined &&
        timing.averageHours > rule.afterHours * 1.5
      ) {
        suggestions.push({
          id: createId('opt'),
          planId,
          type: 'slow_stage',
          severity: timing.averageHours > rule.afterHours * 3 ? 'critical' : 'warning',
          title: `Slow dwell time in ${timing.stage}`,
          description: `Average time in ${timing.stage} is ${timing.averageHours}h vs rule threshold ${rule.afterHours}h.`,
          recommendedAction: `Lower afterHours on rule ${rule.id} or increase outreach frequency.`,
          relatedStage: timing.stage,
          relatedRuleId: rule.id,
          metricValue: timing.averageHours,
        });
      }
    }

    for (const path of analytics.recoveryByEscalationPath) {
      if (path.escalations >= 3 && path.recoveryRate < 20) {
        const [fromStage] = path.path.split('->') as [DunningStage, string];
        const rule = policy.rules.find((r) => `${r.fromStage}->${r.toStage}` === path.path);
        suggestions.push({
          id: createId('opt'),
          planId,
          type: 'low_recovery',
          severity: path.recoveryRate < 10 ? 'critical' : 'warning',
          title: `Low recovery on path ${path.path}`,
          description: `Recovery rate is ${path.recoveryRate}% across ${path.escalations} escalations.`,
          recommendedAction:
            'Review template copy and channel mix; consider delaying escalation or adding a softer warn step.',
          relatedStage: fromStage,
          relatedRuleId: rule?.id,
          metricValue: path.recoveryRate,
        });
      }
    }

    if (analytics.averageEscalationsBeforeRecovery > policy.maxEscalations * 0.8) {
      suggestions.push({
        id: createId('opt'),
        planId,
        type: 'over_escalation',
        severity: 'info',
        title: 'High escalation depth before recovery',
        description: `Recoveries average ${analytics.averageEscalationsBeforeRecovery} escalations (max ${policy.maxEscalations}).`,
        recommendedAction:
          'Tighten earlier-stage messaging or raise afterFailedAttempts on late-stage rules.',
        metricValue: analytics.averageEscalationsBeforeRecovery,
      });
    }

    const funnel = analytics.stageFunnel;
    const retry = funnel.find((s) => s.stage === 'retry');
    const warn = funnel.find((s) => s.stage === 'warn');
    if (retry && warn && retry.entered >= 5 && warn.entered / retry.entered < 0.1) {
      suggestions.push({
        id: createId('opt'),
        planId,
        type: 'under_escalation',
        severity: 'info',
        title: 'Few accounts escalate past retry',
        description: `Only ${warn.entered} of ${retry.entered} retry entries reached warn.`,
        recommendedAction:
          'Lower afterFailedAttempts on the retry→warn rule if retries are stalling.',
        relatedStage: 'retry',
        metricValue: warn.entered / retry.entered,
      });
    }

    for (const rule of policy.rules) {
      const template = DUNNING_TEMPLATES.find((t) => t.id === rule.templateId);
      if (!template) {
        suggestions.push({
          id: createId('opt'),
          planId,
          type: 'template_gap',
          severity: 'warning',
          title: `Missing template ${rule.templateId}`,
          description: `Rule ${rule.id} references template "${rule.templateId}" which is not in DUNNING_TEMPLATES.`,
          recommendedAction: 'Point templateId at an existing template or add a new one.',
          relatedRuleId: rule.id,
          relatedStage: rule.toStage,
        });
      }

      if (rule.channels.length === 1 && rule.toStage !== 'retry') {
        suggestions.push({
          id: createId('opt'),
          planId,
          type: 'channel_mix',
          severity: 'info',
          title: `Single-channel escalation for ${rule.fromStage}→${rule.toStage}`,
          description: `Rule ${rule.id} only uses ${rule.channels[0]}.`,
          recommendedAction: 'Add a second channel (email + push) to improve reach.',
          relatedRuleId: rule.id,
          relatedStage: rule.toStage,
        });
      }
    }

    return suggestions;
  }

  renderTemplate(
    templateId: string,
    vars: Record<string, string | number>
  ): {
    subject: string;
    body: string;
    pushTitle: string;
    pushBody: string;
    actionLabel: string;
    actionUrl: string;
  } | null {
    const template = DUNNING_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return null;

    const replace = (text: string): string =>
      text.replace(/\{([a-z_]+)\}/g, (_, key: string) =>
        vars[key] !== undefined ? String(vars[key]) : `{${key}}`
      );

    return {
      subject: replace(template.subject),
      body: replace(template.body),
      pushTitle: replace(template.pushTitle),
      pushBody: replace(template.pushBody),
      actionLabel: replace(template.actionLabel),
      actionUrl: replace(template.actionUrl),
    };
  }

  getEvents(subscriptionId?: string): EscalationEvent[] {
    if (!subscriptionId) return [...this.events];
    return this.events.filter((e) => e.subscriptionId === subscriptionId);
  }

  listTemplates() {
    return [...DUNNING_TEMPLATES];
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private ruleMatches(
    rule: EscalationRule,
    entry: DunningEntry,
    hoursInStage: number,
    recoveryProb: number
  ): boolean {
    if (rule.minRecoveryProbability !== undefined && recoveryProb < rule.minRecoveryProbability) {
      return false;
    }

    const hasAttempts = rule.afterFailedAttempts !== undefined;
    const hasHours = rule.afterHours !== undefined;

    // If neither threshold is set, match on stage alone (explicit escalate).
    if (!hasAttempts && !hasHours) {
      return true;
    }

    const attemptOk = hasAttempts && entry.failedAttempts >= (rule.afterFailedAttempts as number);
    const hoursOk = hasHours && hoursInStage >= (rule.afterHours as number);

    // OR semantics: either attempts or hours can trigger (progressive pressure).
    return attemptOk || hoursOk;
  }

  private hoursInCurrentStage(entry: DunningEntry, now: number): number {
    const enteredAt =
      this.stageEnteredAt.get(entry.subscriptionId) ?? entry.updatedAt ?? entry.createdAt;
    return Math.max(0, (now - enteredAt) / ONE_HOUR_MS);
  }

  private delayHoursForStage(stage: DunningStage): number {
    const defaults: Record<DunningStage, number> = {
      retry: 1,
      warn: 24,
      suspend: 72,
      cancel: 168,
    };
    return defaults[stage];
  }

  private describeReason(rule: EscalationRule, entry: DunningEntry, now: number): string {
    const parts: string[] = [];
    if (
      rule.afterFailedAttempts !== undefined &&
      entry.failedAttempts >= rule.afterFailedAttempts
    ) {
      parts.push(`${entry.failedAttempts} failed attempts`);
    }
    if (rule.afterHours !== undefined) {
      const hours = Math.round(this.hoursInCurrentStage(entry, now) * 10) / 10;
      if (hours >= rule.afterHours) {
        parts.push(`${hours}h in ${entry.currentStage}`);
      }
    }
    if (parts.length === 0) {
      parts.push(`rule ${rule.id} matched`);
    }
    return `Escalated ${rule.fromStage} → ${rule.toStage}: ${parts.join(', ')}`;
  }

  private buildPath(subscriptionId: string, currentStage: DunningStage): string {
    const history = this.events
      .filter((e) => e.subscriptionId === subscriptionId)
      .map((e) => e.toStage);
    if (history.length === 0) return currentStage;
    const from = this.events.find((e) => e.subscriptionId === subscriptionId)?.fromStage;
    return [from, ...history].filter(Boolean).join('->');
  }
}

export const progressiveDunningEngine = new ProgressiveDunningEngine();

export { createDefaultEscalationPolicy, isForwardEscalation, stageIndex, STAGE_ORDER };
