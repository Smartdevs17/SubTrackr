import {
  TrialManagementService,
  trialManagementService,
  type PropensityCategory,
  type TrialConversionFunnel,
  type TrialReminderItem,
  type ConversionIncentive,
} from './trialManagementService';

export type TrialOptimizationAction =
  | 'convert_now'
  | 'offer_incentive'
  | 'send_reminder'
  | 'extend_trial'
  | 'monitor';

export interface TrialOptimizationRecommendation {
  trialId: string;
  userId: string;
  planId: string;
  score: number;
  category: PropensityCategory;
  action: TrialOptimizationAction;
  reason: string;
  incentive?: ConversionIncentive;
  nextReminder?: TrialReminderItem;
}

export interface TrialExpirationWorkflowReport {
  processedAt: Date;
  autoConverted: number;
  expired: number;
  pendingReminders: number;
  trialIds: string[];
}

function recommendAction(
  category: PropensityCategory,
  hasReminder: boolean,
): { action: TrialOptimizationAction; reason: string } {
  switch (category) {
    case 'high_propensity':
      return {
        action: 'convert_now',
        reason: 'Engagement is high; present the standard upgrade path without a discount.',
      };
    case 'medium_propensity':
      return {
        action: 'offer_incentive',
        reason: 'Engagement is moderate; a time-boxed discount improves conversion odds.',
      };
    case 'at_risk':
      return {
        action: hasReminder ? 'send_reminder' : 'extend_trial',
        reason: hasReminder
          ? 'Engagement is low; deliver the queued reminder with a retention offer.'
          : 'Engagement is low; extend the trial and offer guided onboarding.',
      };
    case 'disengaged':
      return { action: 'monitor', reason: 'No meaningful activity recorded yet; keep monitoring.' };
  }
}

export class TrialOptimizationService {
  constructor(private readonly trials: TrialManagementService = trialManagementService) {}

  evaluateTrial(trialId: string, now: Date = new Date()): TrialOptimizationRecommendation | undefined {
    const trial = this.trials.getTrialById(trialId);
    if (!trial) return undefined;

    const propensity = this.trials.calculatePropensityScore(trialId);
    const nextReminder = this.trials
      .getPendingReminders(now)
      .find((reminder) => reminder.trialId === trialId);
    const { action, reason } = recommendAction(propensity.category, Boolean(nextReminder));

    return {
      trialId: trial.id,
      userId: trial.userId,
      planId: trial.planId,
      score: propensity.score,
      category: propensity.category,
      action,
      reason,
      incentive: propensity.recommendedIncentive,
      nextReminder,
    };
  }

  evaluateAllTrials(now: Date = new Date()): TrialOptimizationRecommendation[] {
    return this.trials
      .getAllTrials()
      .filter((trial) => trial.status === 'active' || trial.status === 'extended')
      .map((trial) => this.evaluateTrial(trial.id, now))
      .filter((recommendation): recommendation is TrialOptimizationRecommendation => Boolean(recommendation));
  }

  runExpirationWorkflow(now: Date = new Date()): TrialExpirationWorkflowReport {
    const outcome = this.trials.processTrialExpirations(now);
    const pendingReminders = this.trials.getPendingReminders(now);
    return {
      processedAt: now,
      autoConverted: outcome.autoConverted.length,
      expired: outcome.expired.length,
      pendingReminders: pendingReminders.length,
      trialIds: [...outcome.autoConverted, ...outcome.expired].map((trial) => trial.id),
    };
  }

  getFunnelMetrics(planId?: string): TrialConversionFunnel {
    return this.trials.getFunnelMetrics(planId);
  }

  getPendingReminders(now: Date = new Date()): TrialReminderItem[] {
    return this.trials.getPendingReminders(now);
  }
}

export const trialOptimizationService = new TrialOptimizationService();
