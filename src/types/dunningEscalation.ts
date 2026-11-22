import type { DunningStage } from './dunning';
import { DEFAULT_DUNNING_STAGES } from './dunning';

export type EscalationChannel = 'email' | 'push' | 'in_app' | 'sms' | 'support';

export interface EscalationRule {
  id: string;
  fromStage: DunningStage;
  toStage: DunningStage;
  /** Escalate after this many failed attempts in the current stage. */
  afterFailedAttempts?: number;
  /** Escalate after this many hours spent in the current stage. */
  afterHours?: number;
  /**
   * Only apply this rule when estimated recovery probability is at least
   * this value (0–1). Useful to avoid harsh escalation for recoverable accounts.
   */
  minRecoveryProbability?: number;
  channels: EscalationChannel[];
  templateId: string;
  /** Higher priority wins when multiple rules match. */
  priority: number;
}

export interface EscalationPolicy {
  planId: string;
  rules: EscalationRule[];
  enabled: boolean;
  maxEscalations: number;
}

export interface EscalationEvent {
  id: string;
  subscriptionId: string;
  planId: string;
  ruleId: string;
  fromStage: DunningStage;
  toStage: DunningStage;
  channels: EscalationChannel[];
  templateId: string;
  triggeredAt: number;
  reason: string;
}

export interface StageFunnelStats {
  stage: DunningStage;
  entered: number;
  exited: number;
  recovered: number;
  escalated: number;
  currentlyInStage: number;
}

export interface TimeInStageStats {
  stage: DunningStage;
  averageHours: number;
  medianHours: number;
  sampleSize: number;
}

export interface EscalationPathRecovery {
  path: string;
  escalations: number;
  recoveries: number;
  recoveryRate: number;
}

export interface ProgressiveDunningAnalytics {
  totalEscalations: number;
  activePolicies: number;
  stageFunnel: StageFunnelStats[];
  timeInStage: TimeInStageStats[];
  recoveryByEscalationPath: EscalationPathRecovery[];
  averageEscalationsBeforeRecovery: number;
  overallRecoveryRate: number;
}

export type OptimizationSuggestionType =
  | 'slow_stage'
  | 'low_recovery'
  | 'over_escalation'
  | 'under_escalation'
  | 'template_gap'
  | 'channel_mix';

export interface OptimizationSuggestion {
  id: string;
  planId: string;
  type: OptimizationSuggestionType;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  recommendedAction: string;
  relatedStage?: DunningStage;
  relatedRuleId?: string;
  metricValue?: number;
}

/** Ordered stages used for progressive-forward checks. */
export const STAGE_ORDER: DunningStage[] = ['retry', 'warn', 'suspend', 'cancel'];

export function stageIndex(stage: DunningStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/** True when `to` is strictly further along the dunning funnel than `from`. */
export function isForwardEscalation(from: DunningStage, to: DunningStage): boolean {
  return stageIndex(to) > stageIndex(from);
}

/**
 * Default progressive policy aligned with DEFAULT_DUNNING_STAGES:
 * retry → warn → suspend → cancel.
 */
export function createDefaultEscalationPolicy(planId = 'default'): EscalationPolicy {
  const stages = DEFAULT_DUNNING_STAGES;
  const rules: EscalationRule[] = [];

  for (let i = 0; i < stages.length - 1; i++) {
    const from = stages[i];
    const to = stages[i + 1];
    rules.push({
      id: `rule_${from.stage}_to_${to.stage}`,
      fromStage: from.stage,
      toStage: to.stage,
      afterFailedAttempts: from.maxAttempts,
      afterHours: from.delayHours * Math.max(from.maxAttempts, 1),
      channels: ['email', 'push'],
      templateId: to.templateId,
      priority: 100 - i * 10,
    });
  }

  return {
    planId,
    rules,
    enabled: true,
    maxEscalations: STAGE_ORDER.length - 1,
  };
}
