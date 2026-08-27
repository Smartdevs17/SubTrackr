/**
 * Subscription Trial Management and Conversion Optimization Service
 * 
 * Provides end-to-end trial lifecycle orchestration, propensity-to-convert scoring,
 * automated reminder scheduling with dynamic incentives, trial auto-conversion,
 * smart extension workflows, and multi-cohort conversion analytics.
 */

export interface TrialPolicy {
  planId: string;
  durationDays: number;
  gracePeriodDays: number;
  autoConvertOnExpiry: boolean;
  earlyConversionDiscountBps: number; // e.g. 2000 = 20%
  maxExtensionsAllowed: number;
  extensionBonusDays: number;
  incentiveThresholdScore: number;
}

export type TrialStatus = 'active' | 'extended' | 'converted' | 'expired' | 'cancelled';

export type PropensityCategory = 'high_propensity' | 'medium_propensity' | 'at_risk' | 'disengaged';

export interface UserActivitySignals {
  userId: string;
  loginCount: number;
  featureUsageCount: number;
  dashboardViews: number;
  exportsTriggered: number;
  reminderInteractions: number;
  daysActive: number;
}

export interface TrialSubscriptionRecord {
  id: string;
  userId: string;
  planId: string;
  planPriceUsd: number;
  startDate: Date;
  endDate: Date;
  originalEndDate: Date;
  gracePeriodEndDate: Date;
  status: TrialStatus;
  autoConvert: boolean;
  extensionCount: number;
  conversionDiscountBps: number;
  convertedAt?: Date;
  conversionTrigger?: string;
  activitySignals: UserActivitySignals;
  metadata?: Record<string, any>;
}

export interface ConversionIncentive {
  id: string;
  trialId: string;
  userId: string;
  discountPercentage: number;
  bonusDays: number;
  offerType: 'early_bird_discount' | 'retention_extension' | 'vip_onboarding_call' | 'feature_unlock';
  expiresAt: Date;
  promoCode: string;
  isClaimed: boolean;
}

export interface TrialReminderItem {
  id: string;
  trialId: string;
  userId: string;
  reminderType: 'D-3' | 'D-1' | 'D-DAY' | 'GRACE-FINAL';
  scheduledFor: Date;
  isSent: boolean;
  sentAt?: Date;
  subject: string;
  content: string;
  attachedIncentive?: ConversionIncentive;
}

export interface TrialConversionFunnel {
  totalStarted: number;
  featureActivated: number;
  engagedUsers: number;
  reminderInteracted: number;
  convertedCount: number;
  expiredCount: number;
  extendedCount: number;
  cancelledCount: number;
  conversionRatePercent: number;
  averageDaysToConversion: number;
  attributedRevenueUsd: number;
}

export const DEFAULT_TRIAL_POLICY: TrialPolicy = {
  planId: 'default-plan',
  durationDays: 14,
  gracePeriodDays: 3,
  autoConvertOnExpiry: true,
  earlyConversionDiscountBps: 2000, // 20%
  maxExtensionsAllowed: 2,
  extensionBonusDays: 5,
  incentiveThresholdScore: 60,
};

export class TrialManagementService {
  private policies: Map<string, TrialPolicy> = new Map();
  private trials: Map<string, TrialSubscriptionRecord> = new Map();
  private incentives: Map<string, ConversionIncentive> = new Map();
  private reminderQueue: TrialReminderItem[] = [];

  constructor() {
    this.registerPolicy(DEFAULT_TRIAL_POLICY);
  }

  /**
   * Register or update a plan trial policy
   */
  public registerPolicy(policy: TrialPolicy): void {
    this.policies.set(policy.planId, { ...policy });
  }

  public getPolicy(planId: string): TrialPolicy {
    return this.policies.get(planId) || { ...DEFAULT_TRIAL_POLICY, planId };
  }

  /**
   * Enroll a user into a new subscription trial
   */
  public startTrial(
    userId: string,
    planId: string,
    planPriceUsd: number,
    customPolicyOverrides?: Partial<TrialPolicy>,
    metadata?: Record<string, any>
  ): TrialSubscriptionRecord {
    const basePolicy = this.getPolicy(planId);
    const policy = { ...basePolicy, ...customPolicyOverrides };

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + policy.durationDays * 86_400_000);
    const gracePeriodEndDate = new Date(endDate.getTime() + policy.gracePeriodDays * 86_400_000);

    const trialId = `trial_${userId}_${Date.now()}`;
    const record: TrialSubscriptionRecord = {
      id: trialId,
      userId,
      planId,
      planPriceUsd,
      startDate,
      endDate,
      originalEndDate: new Date(endDate.getTime()),
      gracePeriodEndDate,
      status: 'active',
      autoConvert: policy.autoConvertOnExpiry,
      extensionCount: 0,
      conversionDiscountBps: policy.earlyConversionDiscountBps,
      activitySignals: {
        userId,
        loginCount: 1,
        featureUsageCount: 0,
        dashboardViews: 1,
        exportsTriggered: 0,
        reminderInteractions: 0,
        daysActive: 1,
      },
      metadata: { ...(metadata || {}), maxExtensionsAllowed: policy.maxExtensionsAllowed },
    };

    this.trials.set(trialId, record);
    this.scheduleTrialReminders(record, policy);

    return record;
  }

  /**
   * Update subscriber activity signals during trial
   */
  public recordActivity(
    trialId: string,
    activity: Partial<Omit<UserActivitySignals, 'userId'>>
  ): UserActivitySignals | undefined {
    const trial = this.trials.get(trialId);
    if (!trial) return undefined;

    if (activity.loginCount) trial.activitySignals.loginCount += activity.loginCount;
    if (activity.featureUsageCount) trial.activitySignals.featureUsageCount += activity.featureUsageCount;
    if (activity.dashboardViews) trial.activitySignals.dashboardViews += activity.dashboardViews;
    if (activity.exportsTriggered) trial.activitySignals.exportsTriggered += activity.exportsTriggered;
    if (activity.reminderInteractions) trial.activitySignals.reminderInteractions += activity.reminderInteractions;
    if (activity.daysActive) trial.activitySignals.daysActive += activity.daysActive;

    return trial.activitySignals;
  }

  /**
   * Calculate conversion propensity score (0 - 100) based on engagement signals
   */
  public calculatePropensityScore(trialId: string): {
    score: number;
    category: PropensityCategory;
    recommendedIncentive?: ConversionIncentive;
  } {
    const trial = this.trials.get(trialId);
    if (!trial) {
      return { score: 0, category: 'disengaged' };
    }

    const { loginCount, featureUsageCount, dashboardViews, exportsTriggered, daysActive } = trial.activitySignals;

    // Weighted scoring model:
    // Feature usage (40%) + Logins & active days (30%) + Dashboard views (15%) + Export actions (15%)
    const featureScore = Math.min(40, featureUsageCount * 8);
    const loginScore = Math.min(30, (loginCount * 3) + (daysActive * 4));
    const viewScore = Math.min(15, dashboardViews * 2.5);
    const exportScore = Math.min(15, exportsTriggered * 5);

    const totalScore = Math.min(100, Math.round(featureScore + loginScore + viewScore + exportScore));

    let category: PropensityCategory = 'disengaged';
    if (totalScore >= 75) {
      category = 'high_propensity';
    } else if (totalScore >= 50) {
      category = 'medium_propensity';
    } else if (totalScore >= 25) {
      category = 'at_risk';
    }

    // Generate dynamic conversion incentive if user is at risk or high propensity
    let recommendedIncentive: ConversionIncentive | undefined;
    if (category === 'at_risk' || category === 'medium_propensity') {
      recommendedIncentive = this.generateIncentive(trial, category);
    }

    return { score: totalScore, category, recommendedIncentive };
  }

  /**
   * Generate targeted conversion incentive
   */
  public generateIncentive(trial: TrialSubscriptionRecord, category: PropensityCategory): ConversionIncentive {
    const discount = category === 'at_risk' ? 25 : 15;
    const bonusDays = category === 'at_risk' ? 5 : 0;
    const offerType = category === 'at_risk' ? 'retention_extension' : 'early_bird_discount';

    const incentive: ConversionIncentive = {
      id: `inc_${trial.id}_${Date.now()}`,
      trialId: trial.id,
      userId: trial.userId,
      discountPercentage: discount,
      bonusDays,
      offerType,
      expiresAt: new Date(trial.endDate.getTime()),
      promoCode: `SAVE${discount}_${trial.userId.slice(-4).toUpperCase()}`,
      isClaimed: false,
    };

    this.incentives.set(incentive.id, incentive);
    return incentive;
  }

  /**
   * Apply smart trial extension
   */
  public extendTrial(trialId: string, additionalDays?: number, reason?: string): TrialSubscriptionRecord | undefined {
    const trial = this.trials.get(trialId);
    if (!trial || (trial.status !== 'active' && trial.status !== 'extended')) {
      return undefined;
    }

    const policy = this.getPolicy(trial.planId);
    const maxExt = trial.metadata?.maxExtensionsAllowed !== undefined ? trial.metadata.maxExtensionsAllowed : policy.maxExtensionsAllowed;
    if (trial.extensionCount >= maxExt) {
      return undefined;
    }

    const daysToAdd = additionalDays || policy.extensionBonusDays;
    trial.endDate = new Date(trial.endDate.getTime() + daysToAdd * 86_400_000);
    trial.gracePeriodEndDate = new Date(trial.endDate.getTime() + policy.gracePeriodDays * 86_400_000);
    trial.extensionCount += 1;
    trial.status = 'extended';

    if (reason) {
      trial.metadata = { ...(trial.metadata || {}), lastExtensionReason: reason };
    }

    return trial;
  }

  /**
   * Convert trial to paid subscription
   */
  public convertTrial(
    trialId: string,
    conversionTrigger: string = 'manual_upgrade',
    appliedDiscountBps?: number
  ): TrialSubscriptionRecord | undefined {
    const trial = this.trials.get(trialId);
    if (!trial || trial.status === 'converted' || trial.status === 'cancelled') {
      return undefined;
    }

    trial.status = 'converted';
    trial.convertedAt = new Date();
    trial.conversionTrigger = conversionTrigger;
    if (appliedDiscountBps !== undefined) {
      trial.conversionDiscountBps = appliedDiscountBps;
    }

    return trial;
  }

  /**
   * Cancel trial subscription
   */
  public cancelTrial(trialId: string, reason?: string): TrialSubscriptionRecord | undefined {
    const trial = this.trials.get(trialId);
    if (!trial) return undefined;

    trial.status = 'cancelled';
    trial.metadata = { ...(trial.metadata || {}), cancellationReason: reason || 'user_cancelled' };
    return trial;
  }

  /**
   * Evaluate all active trials for auto-conversion or expiration
   */
  public processTrialExpirations(referenceDate: Date = new Date()): {
    autoConverted: TrialSubscriptionRecord[];
    expired: TrialSubscriptionRecord[];
  } {
    const autoConverted: TrialSubscriptionRecord[] = [];
    const expired: TrialSubscriptionRecord[] = [];

    for (const trial of this.trials.values()) {
      if (trial.status !== 'active' && trial.status !== 'extended') {
        continue;
      }

      // Check if trial has passed grace period
      if (referenceDate > trial.gracePeriodEndDate) {
        if (trial.autoConvert) {
          trial.status = 'converted';
          trial.convertedAt = new Date(referenceDate.getTime());
          trial.conversionTrigger = 'auto_convert_expiry';
          autoConverted.push(trial);
        } else {
          trial.status = 'expired';
          expired.push(trial);
        }
      }
    }

    return { autoConverted, expired };
  }

  /**
   * Schedule automated trial reminders
   */
  private scheduleTrialReminders(trial: TrialSubscriptionRecord, policy: TrialPolicy): void {
    const endMs = trial.endDate.getTime();

    // D-3 reminder
    const d3Date = new Date(endMs - 3 * 86_400_000);
    this.reminderQueue.push({
      id: `rem_d3_${trial.id}`,
      trialId: trial.id,
      userId: trial.userId,
      reminderType: 'D-3',
      scheduledFor: d3Date,
      isSent: false,
      subject: '3 days left on your SubTrackr trial',
      content: 'Unlock full automated subscription renewal without interruption.',
    });

    // D-1 reminder with conversion incentive
    const d1Date = new Date(endMs - 1 * 86_400_000);
    const incentive = this.generateIncentive(trial, 'medium_propensity');
    this.reminderQueue.push({
      id: `rem_d1_${trial.id}`,
      trialId: trial.id,
      userId: trial.userId,
      reminderType: 'D-1',
      scheduledFor: d1Date,
      isSent: false,
      subject: 'Final day of free trial - Claim your exclusive discount!',
      content: `Use promo code ${incentive.promoCode} to save ${incentive.discountPercentage}% when upgrading today.`,
      attachedIncentive: incentive,
    });

    // D-DAY reminder
    this.reminderQueue.push({
      id: `rem_dday_${trial.id}`,
      trialId: trial.id,
      userId: trial.userId,
      reminderType: 'D-DAY',
      scheduledFor: new Date(endMs),
      isSent: false,
      subject: 'Your trial expires today',
      content: 'Your subscription will smoothly transition to paid. Manage billing preferences anytime.',
    });
  }

  /**
   * Get scheduled reminder items
   */
  public getPendingReminders(currentDate: Date = new Date()): TrialReminderItem[] {
    return this.reminderQueue.filter((r) => !r.isSent && r.scheduledFor <= currentDate);
  }

  /**
   * Mark reminder as dispatched
   */
  public markReminderSent(reminderId: string): boolean {
    const reminder = this.reminderQueue.find((r) => r.id === reminderId);
    if (!reminder) return false;
    reminder.isSent = true;
    reminder.sentAt = new Date();
    return true;
  }

  /**
   * Aggregate conversion funnel metrics and revenue analytics
   */
  public getFunnelMetrics(planId?: string): TrialConversionFunnel {
    const trials = Array.from(this.trials.values()).filter(
      (t) => !planId || t.planId === planId
    );

    const totalStarted = trials.length;
    if (totalStarted === 0) {
      return {
        totalStarted: 0,
        featureActivated: 0,
        engagedUsers: 0,
        reminderInteracted: 0,
        convertedCount: 0,
        expiredCount: 0,
        extendedCount: 0,
        cancelledCount: 0,
        conversionRatePercent: 0,
        averageDaysToConversion: 0,
        attributedRevenueUsd: 0,
      };
    }

    const featureActivated = trials.filter((t) => t.activitySignals.featureUsageCount > 0).length;
    const engagedUsers = trials.filter((t) => t.activitySignals.loginCount >= 2).length;
    const reminderInteracted = trials.filter((t) => t.activitySignals.reminderInteractions > 0).length;
    const convertedTrials = trials.filter((t) => t.status === 'converted');
    const convertedCount = convertedTrials.length;
    const expiredCount = trials.filter((t) => t.status === 'expired').length;
    const extendedCount = trials.filter((t) => t.status === 'extended' || t.extensionCount > 0).length;
    const cancelledCount = trials.filter((t) => t.status === 'cancelled').length;

    const conversionRatePercent = Number(((convertedCount / totalStarted) * 100).toFixed(2));

    // Calculate average days to conversion
    let totalDaysToConvert = 0;
    let attributedRevenueUsd = 0;

    for (const ct of convertedTrials) {
      if (ct.convertedAt) {
        const diffMs = ct.convertedAt.getTime() - ct.startDate.getTime();
        totalDaysToConvert += Math.max(1, Math.round(diffMs / 86_400_000));
      }
      const discount = ct.conversionDiscountBps / 10000;
      const finalPrice = ct.planPriceUsd * (1 - discount);
      attributedRevenueUsd += finalPrice;
    }

    const averageDaysToConversion =
      convertedCount > 0 ? Number((totalDaysToConvert / convertedCount).toFixed(1)) : 0;

    return {
      totalStarted,
      featureActivated,
      engagedUsers,
      reminderInteracted,
      convertedCount,
      expiredCount,
      extendedCount,
      cancelledCount,
      conversionRatePercent,
      averageDaysToConversion,
      attributedRevenueUsd: Number(attributedRevenueUsd.toFixed(2)),
    };
  }

  public getTrialById(trialId: string): TrialSubscriptionRecord | undefined {
    return this.trials.get(trialId);
  }

  public getAllTrials(): TrialSubscriptionRecord[] {
    return Array.from(this.trials.values());
  }

  public clear(): void {
    this.trials.clear();
    this.incentives.clear();
    this.reminderQueue = [];
  }
}

export const trialManagementService = new TrialManagementService();
