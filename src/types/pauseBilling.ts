/** Billing adjustment types for subscription pause / resume (Issue #786) */

export type BillingAdjustmentType = 'pause_credit' | 'early_resume_clawback' | 'resume_restart';

export type PauseNotificationType = 'paused' | 'resume_reminder' | 'resumed' | 'limit_warning';

export type PauseNotificationChannel = 'email' | 'push' | 'in_app';

export interface BillingAdjustment {
  id: string;
  subscriptionId: string;
  type: BillingAdjustmentType;
  amount: number;
  currency: string;
  periodDays: number;
  pauseDays: number;
  createdAt: Date;
  appliedAt?: Date;
  /** Present on resume_restart adjustments — shifted next billing date */
  nextBillingDate?: Date;
}

export interface PauseNotification {
  id: string;
  subscriptionId: string;
  type: PauseNotificationType;
  channel: PauseNotificationChannel;
  title: string;
  body: string;
  scheduledFor: Date;
  sentAt?: Date;
}

export interface PauseAnalyticsReport {
  totalPauses: number;
  activePauses: number;
  averagePauseDays: number;
  totalCreditsIssued: number;
  totalCreditsRemaining: number;
  resumeRate: number;
  earlyResumeRate: number;
  byReason: Record<string, number>;
}

export interface AdjustmentPreview {
  creditAmount: number;
  periodDays: number;
  pauseDays: number;
  dailyRate: number;
  currency?: string;
}

export interface LimitEnforcementResult {
  allowed: boolean;
  reason?: string;
  /** True when approaching max pauses per year */
  warning?: boolean;
}

/** Lightweight pause history entry used for analytics & limit checks */
export interface PauseBillingRecord {
  id: string;
  subscriptionId: string;
  pauseDays: number;
  reason?: string;
  pausedAt: Date;
  scheduledResumeAt: Date;
  resumedAt?: Date;
  earlyResume?: boolean;
  creditAmount: number;
  creditRemaining: number;
  currency: string;
  status: 'active' | 'resumed';
}
