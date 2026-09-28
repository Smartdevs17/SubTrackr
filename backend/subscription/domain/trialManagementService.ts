/**
 * Trial Management Service – trial period lifecycle with conversion tracking.
 *
 * Manages trial creation, activation, expiry, extension, and conversion
 * to paid subscriptions. Tracks conversion funnel events and provides
 * analytics for trial-to-paid conversion rates.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1118
 */

export type TrialStatus = 'active' | 'converted' | 'expired' | 'cancelled';

export type TrialDurationDays = 7 | 14 | 21 | 30;

export type ConversionTrigger =
  | 'automatic_time_based'
  | 'feature_usage_threshold'
  | 'discount_incentive'
  | 'manual_upgrade';

export type FunnelEventType =
  | 'trial_started'
  | 'feature_accessed'
  | 'reminder_sent'
  | 'dashboard_visited'
  | 'payment_clicked'
  | 'payment_completed'
  | 'trial_expired'
  | 'trial_cancelled'
  | 'trial_converted';

export type ExtensionCondition =
  | 'high_engagement'
  | 'inactive_reminder'
  | 'support_ticket'
  | 'promo_offer';

export interface TrialRecord {
  id: string;
  subscriptionId: string;
  userId: string;
  planId: string;
  status: TrialStatus;
  durationDays: TrialDurationDays;
  startDate: number;
  endDate: number;
  originalEndDate: number;
  extensionsGranted: number;
  convertedAt?: number;
  conversionTrigger?: ConversionTrigger;
  cancelledAt?: number;
  engagementScore: number; // 0-100
  createdAt: number;
  updatedAt: number;
}

export interface FunnelEvent {
  id: string;
  trialId: string;
  eventType: FunnelEventType;
  userId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface TrialExtensionRule {
  id: string;
  name: string;
  extensionDays: number;
  condition: ExtensionCondition;
  isEnabled: boolean;
}

export interface TrialAnalyticsSummary {
  totalTrialsStarted: number;
  activeTrialsCount: number;
  convertedTrialsCount: number;
  expiredTrialsCount: number;
  cancelledTrialsCount: number;
  trialConversionRate: number; // percentage
  averageTrialDurationDays: number;
  revenueFromConversions: number;
  extendedTrialsCount: number;
  averageEngagementScore: number;
  conversionByTrigger: Record<string, number>;
  funnelStats: {
    trialStarted: number;
    featureAccessed: number;
    reminderSent: number;
    dashboardVisited: number;
    paymentClicked: number;
    paymentCompleted: number;
    trialExpired: number;
    trialCancelled: number;
    trialConverted: number;
  };
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const DEFAULT_EXTENSION_RULES: TrialExtensionRule[] = [
  {
    id: 'ext-high-engagement',
    name: 'High Engagement Reward (+7 Days)',
    extensionDays: 7,
    condition: 'high_engagement',
    isEnabled: true,
  },
  {
    id: 'ext-inactive-nudge',
    name: 'Re-engagement Extension (+3 Days)',
    extensionDays: 3,
    condition: 'inactive_reminder',
    isEnabled: true,
  },
  {
    id: 'ext-promo',
    name: 'Special Offer Extension (+5 Days)',
    extensionDays: 5,
    condition: 'promo_offer',
    isEnabled: true,
  },
];

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

export class TrialManagementService {
  private trials = new Map<string, TrialRecord>();
  private events: FunnelEvent[] = [];
  private extensionRules: TrialExtensionRule[] = [...DEFAULT_EXTENSION_RULES];
  private conversionRevenue = 0;

  /**
   * Start a new trial for a subscription.
   */
  startTrial(params: {
    subscriptionId: string;
    userId: string;
    planId: string;
    durationDays?: TrialDurationDays;
  }): TrialRecord {
    // Check for existing active trial on the same subscription
    const existing = this.getActiveTrial(params.subscriptionId);
    if (existing) {
      throw new Error(
        `Subscription ${params.subscriptionId} already has an active trial (${existing.id})`,
      );
    }

    const now = Date.now();
    const durationDays = params.durationDays ?? 14;
    const endDate = now + durationDays * MS_PER_DAY;

    const trial: TrialRecord = {
      id: generateId('trial'),
      subscriptionId: params.subscriptionId,
      userId: params.userId,
      planId: params.planId,
      status: 'active',
      durationDays,
      startDate: now,
      endDate,
      originalEndDate: endDate,
      extensionsGranted: 0,
      engagementScore: 50,
      createdAt: now,
      updatedAt: now,
    };

    this.trials.set(trial.id, trial);
    this.recordEvent(trial.id, 'trial_started', params.userId);

    return trial;
  }

  /**
   * Convert an active trial to a paid subscription.
   */
  convertTrial(
    trialId: string,
    trigger: ConversionTrigger = 'manual_upgrade',
    revenue?: number,
  ): TrialRecord {
    const trial = this.trials.get(trialId);
    if (!trial) throw new Error(`Trial ${trialId} not found`);
    if (trial.status !== 'active') throw new Error(`Trial ${trialId} is not active (status: ${trial.status})`);

    const now = Date.now();
    trial.status = 'converted';
    trial.convertedAt = now;
    trial.conversionTrigger = trigger;
    trial.updatedAt = now;

    if (revenue && revenue > 0) {
      this.conversionRevenue += revenue;
    }

    this.recordEvent(trialId, 'trial_converted', trial.userId, { trigger, revenue });
    this.recordEvent(trialId, 'payment_completed', trial.userId, { trigger });

    return trial;
  }

  /**
   * Cancel an active trial.
   */
  cancelTrial(trialId: string): TrialRecord {
    const trial = this.trials.get(trialId);
    if (!trial) throw new Error(`Trial ${trialId} not found`);
    if (trial.status !== 'active') throw new Error(`Trial ${trialId} is not active`);

    const now = Date.now();
    trial.status = 'cancelled';
    trial.cancelledAt = now;
    trial.updatedAt = now;

    this.recordEvent(trialId, 'trial_cancelled', trial.userId);

    return trial;
  }

  /**
   * Extend a trial by a number of days based on a condition.
   */
  extendTrial(trialId: string, condition: ExtensionCondition): TrialRecord {
    const trial = this.trials.get(trialId);
    if (!trial) throw new Error(`Trial ${trialId} not found`);
    if (trial.status !== 'active') throw new Error(`Trial ${trialId} is not active`);

    const rule = this.extensionRules.find(
      (r) => r.condition === condition && r.isEnabled,
    );
    if (!rule) throw new Error(`No enabled extension rule for condition: ${condition}`);

    trial.endDate += rule.extensionDays * MS_PER_DAY;
    trial.extensionsGranted += 1;
    trial.updatedAt = Date.now();

    return trial;
  }

  /**
   * Update the engagement score for a trial (0-100).
   */
  updateEngagement(trialId: string, score: number): TrialRecord {
    const trial = this.trials.get(trialId);
    if (!trial) throw new Error(`Trial ${trialId} not found`);

    if (score < 0 || score > 100) {
      throw new Error('Engagement score must be between 0 and 100');
    }

    trial.engagementScore = Math.round(score);
    trial.updatedAt = Date.now();

    // Auto-extend if high engagement
    if (score >= 80 && trial.extensionsGranted === 0) {
      this.extendTrial(trialId, 'high_engagement');
    }

    return trial;
  }

  /**
   * Record a conversion funnel event.
   */
  recordEvent(
    trialId: string,
    eventType: FunnelEventType,
    userId: string,
    metadata?: Record<string, unknown>,
  ): FunnelEvent {
    const event: FunnelEvent = {
      id: generateId('evt'),
      trialId,
      eventType,
      userId,
      timestamp: Date.now(),
      metadata,
    };
    this.events.push(event);
    return event;
  }

  /**
   * Track a feature access during a trial.
   */
  trackFeatureAccess(trialId: string, featureName: string): void {
    const trial = this.trials.get(trialId);
    if (!trial || trial.status !== 'active') return;

    this.recordEvent(trialId, 'feature_accessed', trial.userId, { feature: featureName });

    // Boost engagement score slightly on feature access
    trial.engagementScore = Math.min(100, trial.engagementScore + 5);
    trial.updatedAt = Date.now();
  }

  /**
   * Track a dashboard visit during a trial.
   */
  trackDashboardVisit(trialId: string): void {
    const trial = this.trials.get(trialId);
    if (!trial || trial.status !== 'active') return;

    this.recordEvent(trialId, 'dashboard_visited', trial.userId);
  }

  /**
   * Track a payment page click during a trial.
   */
  trackPaymentClick(trialId: string): void {
    const trial = this.trials.get(trialId);
    if (!trial || trial.status !== 'active') return;

    this.recordEvent(trialId, 'payment_clicked', trial.userId);
  }

  /**
   * Send a trial reminder (e.g., "3 days left").
   */
  sendReminder(trialId: string, daysRemaining: number): void {
    const trial = this.trials.get(trialId);
    if (!trial) return;

    this.recordEvent(trialId, 'reminder_sent', trial.userId, { daysRemaining });
  }

  /**
   * Process expired trials — mark them expired and record events.
   */
  processExpirations(now: number = Date.now()): TrialRecord[] {
    const expired: TrialRecord[] = [];

    for (const trial of this.trials.values()) {
      if (trial.status === 'active' && trial.endDate <= now) {
        trial.status = 'expired';
        trial.updatedAt = now;
        this.recordEvent(trial.id, 'trial_expired', trial.userId);
        expired.push(trial);
      }
    }

    return expired;
  }

  /**
   * Get the active trial for a subscription.
   */
  getActiveTrial(subscriptionId: string): TrialRecord | null {
    for (const t of this.trials.values()) {
      if (t.subscriptionId === subscriptionId && t.status === 'active') {
        return t;
      }
    }
    return null;
  }

  /** Get trial by ID. */
  getTrial(trialId: string): TrialRecord | undefined {
    return this.trials.get(trialId);
  }

  /** List all trials for a user. */
  listByUser(userId: string): TrialRecord[] {
    return Array.from(this.trials.values()).filter((t) => t.userId === userId);
  }

  /** List all trials for a subscription. */
  listBySubscription(subscriptionId: string): TrialRecord[] {
    return Array.from(this.trials.values()).filter((t) => t.subscriptionId === subscriptionId);
  }

  /** Get funnel events for a trial. */
  getFunnelEvents(trialId: string): FunnelEvent[] {
    return this.events.filter((e) => e.trialId === trialId);
  }

  /** Get extension rules. */
  getExtensionRules(): TrialExtensionRule[] {
    return [...this.extensionRules];
  }

  /** Enable/disable an extension rule. */
  setExtensionRuleEnabled(ruleId: string, isEnabled: boolean): TrialExtensionRule | null {
    const rule = this.extensionRules.find((r) => r.id === ruleId);
    if (!rule) return null;
    rule.isEnabled = isEnabled;
    return rule;
  }

  /** Get days remaining for a trial. */
  getDaysRemaining(trialId: string, now: number = Date.now()): number {
    const trial = this.trials.get(trialId);
    if (!trial) return 0;
    return Math.max(0, Math.ceil((trial.endDate - now) / MS_PER_DAY));
  }

  /**
   * Build trial conversion analytics.
   */
  getAnalytics(): TrialAnalyticsSummary {
    const all = Array.from(this.trials.values());
    const total = all.length;
    const active = all.filter((t) => t.status === 'active').length;
    const converted = all.filter((t) => t.status === 'converted').length;
    const expired = all.filter((t) => t.status === 'expired').length;
    const cancelled = all.filter((t) => t.status === 'cancelled').length;
    const extended = all.filter((t) => t.extensionsGranted > 0).length;

    const conversionRate = total > 0 ? (converted / total) * 100 : 0;

    // Average duration (actual, not configured)
    let durationSum = 0;
    let durationCount = 0;
    for (const t of all) {
      if (t.status !== 'active') {
        const endTime = t.convertedAt ?? t.cancelledAt ?? t.endDate;
        durationSum += (endTime - t.startDate) / MS_PER_DAY;
        durationCount++;
      }
    }

    // Average engagement
    const engagementSum = all.reduce((sum, t) => sum + t.engagementScore, 0);

    // Conversion by trigger
    const conversionByTrigger: Record<string, number> = {};
    for (const t of all) {
      if (t.conversionTrigger) {
        conversionByTrigger[t.conversionTrigger] =
          (conversionByTrigger[t.conversionTrigger] ?? 0) + 1;
      }
    }

    // Funnel stats
    const funnelStats = {
      trialStarted: this.events.filter((e) => e.eventType === 'trial_started').length,
      featureAccessed: this.events.filter((e) => e.eventType === 'feature_accessed').length,
      reminderSent: this.events.filter((e) => e.eventType === 'reminder_sent').length,
      dashboardVisited: this.events.filter((e) => e.eventType === 'dashboard_visited').length,
      paymentClicked: this.events.filter((e) => e.eventType === 'payment_clicked').length,
      paymentCompleted: this.events.filter((e) => e.eventType === 'payment_completed').length,
      trialExpired: this.events.filter((e) => e.eventType === 'trial_expired').length,
      trialCancelled: this.events.filter((e) => e.eventType === 'trial_cancelled').length,
      trialConverted: this.events.filter((e) => e.eventType === 'trial_converted').length,
    };

    return {
      totalTrialsStarted: total,
      activeTrialsCount: active,
      convertedTrialsCount: converted,
      expiredTrialsCount: expired,
      cancelledTrialsCount: cancelled,
      trialConversionRate: Math.round(conversionRate * 100) / 100,
      averageTrialDurationDays:
        durationCount > 0 ? Math.round((durationSum / durationCount) * 100) / 100 : 0,
      revenueFromConversions: Math.round(this.conversionRevenue * 100) / 100,
      extendedTrialsCount: extended,
      averageEngagementScore: total > 0 ? Math.round(engagementSum / total) : 0,
      conversionByTrigger,
      funnelStats,
    };
  }
}

export const trialManagementService = new TrialManagementService();
