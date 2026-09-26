import {
  TrialRecord,
  TrialExtensionRule,
  TrialNotificationTemplate,
  TrialAnalyticsSummary,
  TrialConversionTrigger,
} from '../types/trialOptimization';
import { Subscription } from '../types/subscription';

export const DEFAULT_EXTENSION_RULES: TrialExtensionRule[] = [
  {
    id: 'ext-high-engagement',
    name: 'High Engagement Reward (+7 Days)',
    condition: 'high_engagement',
    extensionDays: 7,
    isEnabled: true,
  },
  {
    id: 'ext-inactive-nudge',
    name: 'Re-engagement Inactive Extension (+3 Days)',
    condition: 'inactive_reminder',
    extensionDays: 3,
    isEnabled: true,
  },
  {
    id: 'ext-promo-discount',
    name: 'Special Offer Extension (+5 Days)',
    condition: 'promo_offer',
    extensionDays: 5,
    isEnabled: true,
  },
];

export const DEFAULT_TRIAL_NOTIFICATIONS: TrialNotificationTemplate[] = [
  {
    id: 'notif-3day',
    title: 'Your SubTrackr trial is ending in 3 days',
    message: 'Upgrade now to keep uninterrupted automated subscription management.',
    daysBeforeExpiration: 3,
  },
  {
    id: 'notif-1day',
    title: 'Final Day of Free Trial!',
    message: 'Claim 20% off your first month when converting today.',
    daysBeforeExpiration: 1,
    incentiveDiscountPercent: 20,
  },
];

export class TrialOptimizationService {
  private static extensionRules: TrialExtensionRule[] = [...DEFAULT_EXTENSION_RULES];
  private static notifications: TrialNotificationTemplate[] = [...DEFAULT_TRIAL_NOTIFICATIONS];
  private static trialRecords: TrialRecord[] = [];

  /**
   * Process trials and calculate conversion analytics
   */
  public static processTrials(subscriptions: Subscription[]): TrialAnalyticsSummary {
    const now = new Date();

    const records: TrialRecord[] = subscriptions.map((sub, idx) => {
      const startDate = new Date(sub.createdAt);
      const originalEndDate = new Date(startDate.getTime() + 14 * 86400000); // 14-day trial
      const isConverted = sub.isActive && (sub.chargeCount || 0) > 0;
      const isExpired = !isConverted && now > originalEndDate;

      return {
        id: `trial-${sub.id}`,
        userId: `user-${sub.id.slice(0, 5)}`,
        planId: sub.category || 'pro',
        status: isConverted
          ? 'converted'
          : isExpired
            ? 'expired'
            : idx % 4 === 0
              ? 'extended'
              : 'active',
        startDate: startDate.toISOString(),
        endDate: originalEndDate.toISOString(),
        originalEndDate: originalEndDate.toISOString(),
        extensionsGranted: idx % 4 === 0 ? 1 : 0,
        convertedAt: isConverted ? now.toISOString() : undefined,
        conversionTrigger: isConverted ? 'automatic_time_based' : undefined,
        engagementScore: Math.min(100, 40 + (idx * 15) % 60),
      };
    });

    this.trialRecords = records;
    return this.getAnalyticsSummary(subscriptions);
  }

  /**
   * Apply trial extension rule to an active trial
   */
  public static applyExtension(trialId: string, ruleId: string): TrialRecord | undefined {
    const trial = this.trialRecords.find((t) => t.id === trialId);
    const rule = this.extensionRules.find((r) => r.id === ruleId);

    if (trial && rule && rule.isEnabled) {
      const currentEnd = new Date(trial.endDate);
      const newEnd = new Date(currentEnd.getTime() + rule.extensionDays * 86400000);
      trial.endDate = newEnd.toISOString();
      trial.status = 'extended';
      trial.extensionsGranted += 1;
      return trial;
    }
    return undefined;
  }

  /**
   * Automated Trial-to-Paid Conversion Trigger
   */
  public static convertTrialToPaid(
    trialId: string,
    trigger: TrialConversionTrigger = 'discount_incentive'
  ): TrialRecord | undefined {
    const trial = this.trialRecords.find((t) => t.id === trialId);
    if (trial) {
      trial.status = 'converted';
      trial.convertedAt = new Date().toISOString();
      trial.conversionTrigger = trigger;
      return trial;
    }
    return undefined;
  }

  public static getExtensionRules(): TrialExtensionRule[] {
    return this.extensionRules;
  }

  public static getNotifications(): TrialNotificationTemplate[] {
    return this.notifications;
  }

  public static getTrials(): TrialRecord[] {
    return this.trialRecords;
  }

  /**
   * Get trial conversion analytics summary
   */
  public static getAnalyticsSummary(subscriptions: Subscription[] = []): TrialAnalyticsSummary {
    const totalTrials = this.trialRecords.length;
    const active = this.trialRecords.filter((t) => t.status === 'active' || t.status === 'extended').length;
    const converted = this.trialRecords.filter((t) => t.status === 'converted').length;
    const extended = this.trialRecords.filter((t) => t.status === 'extended').length;

    const conversionRate = totalTrials > 0 ? (converted / totalTrials) * 100 : 0;
    const estimatedRev = subscriptions.reduce(
      (acc, s) => acc + (s.isActive ? s.price : 0),
      0
    );

    return {
      totalTrialsStarted: totalTrials,
      activeTrialsCount: active,
      convertedTrialsCount: converted,
      trialConversionRate: Number(conversionRate.toFixed(1)),
      averageTrialDurationDays: 14,
      revenueFromConversions: Number(estimatedRev.toFixed(2)),
      extendedTrialsCount: extended,
    };
  }

  /**
   * Generate downloadable trial optimization report
   */
  public static generateReport(format: 'json' | 'csv' = 'json'): string {
    const summary = this.getAnalyticsSummary();
    if (format === 'csv') {
      const headers = 'Trial ID,User ID,Plan,Status,Engagement Score,Extensions,Converted At\n';
      const rows = this.trialRecords
        .map(
          (t) =>
            `"${t.id}","${t.userId}","${t.planId}","${t.status}","${t.engagementScore}","${t.extensionsGranted}","${t.convertedAt || ''}"`
        )
        .join('\n');
      return headers + rows;
    }

    return JSON.stringify(
      {
        summary,
        extensionRules: this.extensionRules,
        notifications: this.notifications,
        trials: this.trialRecords,
      },
      null,
      2
    );
  }
}
