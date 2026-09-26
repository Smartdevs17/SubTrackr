/**
 * Pause / resume billing adjustment service (Issue #786).
 *
 * Credit formula (matches pauseStore):
 *   credit = (pauseDays / periodDays) * price
 *
 * Early resume remaining / clawback:
 *   remaining = ((pauseDays - daysUsed) / pauseDays) * originalCredit
 */

import { DEFAULT_PAUSE_LIMITS, type PauseLimits } from '../types/pause';
import type {
  AdjustmentPreview,
  BillingAdjustment,
  LimitEnforcementResult,
  PauseAnalyticsReport,
  PauseBillingRecord,
  PauseNotification,
  PauseNotificationChannel,
} from '../types/pauseBilling';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

export class PauseBillingService {
  private adjustments: BillingAdjustment[] = [];
  private notifications: PauseNotification[] = [];
  private records: PauseBillingRecord[] = [];
  private limits: PauseLimits = { ...DEFAULT_PAUSE_LIMITS };
  private defaultChannel: PauseNotificationChannel = 'email';

  // ─── Credit math ───────────────────────────────────────────────────────────

  /**
   * Preview a pause credit without persisting.
   * credit = (pauseDays / billingCycleDays) * price
   */
  previewAdjustment(
    price: number,
    billingCycleDays: number,
    pauseDays: number,
    currency?: string
  ): AdjustmentPreview {
    const periodDays = Math.max(1, billingCycleDays);
    const days = Math.max(0, pauseDays);
    const dailyRate = price / periodDays;
    const creditAmount = roundMoney((days / periodDays) * price);

    return {
      creditAmount,
      periodDays,
      pauseDays: days,
      dailyRate: roundMoney(dailyRate),
      currency,
    };
  }

  /**
   * Create and store a prorated pause credit adjustment.
   */
  createPauseAdjustment(params: {
    subscriptionId: string;
    price: number;
    billingCycleDays: number;
    pauseDays: number;
    currency: string;
    reason?: string;
    applyImmediately?: boolean;
  }): BillingAdjustment {
    const preview = this.previewAdjustment(
      params.price,
      params.billingCycleDays,
      params.pauseDays,
      params.currency
    );

    const now = new Date();
    const adjustment: BillingAdjustment = {
      id: generateId(),
      subscriptionId: params.subscriptionId,
      type: 'pause_credit',
      amount: preview.creditAmount,
      currency: params.currency,
      periodDays: preview.periodDays,
      pauseDays: preview.pauseDays,
      createdAt: now,
      appliedAt: params.applyImmediately === false ? undefined : now,
    };

    this.adjustments.push(adjustment);

    const scheduledResumeAt = new Date(now.getTime() + preview.pauseDays * MS_PER_DAY);
    const record: PauseBillingRecord = {
      id: generateId(),
      subscriptionId: params.subscriptionId,
      pauseDays: preview.pauseDays,
      reason: params.reason,
      pausedAt: now,
      scheduledResumeAt,
      creditAmount: preview.creditAmount,
      creditRemaining: preview.creditAmount,
      currency: params.currency,
      status: 'active',
    };
    this.records.push(record);

    return adjustment;
  }

  /**
   * Early resume clawback: unused portion of the original pause credit.
   * remaining = ((pauseDays - daysUsed) / pauseDays) * originalAmount
   * The clawback adjustment amount equals that remaining (unused) credit.
   */
  createEarlyResumeAdjustment(
    originalAdjustment: BillingAdjustment,
    daysUsed: number
  ): BillingAdjustment {
    const pauseDays = Math.max(1, originalAdjustment.pauseDays);
    const used = Math.min(Math.max(0, daysUsed), pauseDays);
    const daysRemaining = pauseDays - used;
    const remainingCredit = roundMoney((daysRemaining / pauseDays) * originalAdjustment.amount);

    const now = new Date();
    const clawback: BillingAdjustment = {
      id: generateId(),
      subscriptionId: originalAdjustment.subscriptionId,
      type: 'early_resume_clawback',
      amount: remainingCredit,
      currency: originalAdjustment.currency,
      periodDays: originalAdjustment.periodDays,
      pauseDays: daysRemaining,
      createdAt: now,
      appliedAt: now,
    };

    this.adjustments.push(clawback);

    // Update matching active record
    const record = this.records.find(
      (r) => r.subscriptionId === originalAdjustment.subscriptionId && r.status === 'active'
    );
    if (record) {
      record.creditRemaining = remainingCredit;
      record.resumedAt = now;
      record.earlyResume = true;
      record.status = 'resumed';
      // Actual days used may differ from scheduled
      record.pauseDays = used;
    }

    return clawback;
  }

  /**
   * Resume with billing restart — shift next billing date by pause duration.
   */
  createResumeRestart(params: {
    subscriptionId: string;
    pauseDays: number;
    currentNextBillingDate: Date;
    currency: string;
    billingCycleDays: number;
    amount?: number;
    early?: boolean;
  }): BillingAdjustment {
    const shiftDays = Math.max(0, params.pauseDays);
    const nextBillingDate = new Date(
      params.currentNextBillingDate.getTime() + shiftDays * MS_PER_DAY
    );

    const now = new Date();
    const adjustment: BillingAdjustment = {
      id: generateId(),
      subscriptionId: params.subscriptionId,
      type: 'resume_restart',
      amount: params.amount ?? 0,
      currency: params.currency,
      periodDays: Math.max(1, params.billingCycleDays),
      pauseDays: shiftDays,
      createdAt: now,
      appliedAt: now,
      nextBillingDate,
    };

    this.adjustments.push(adjustment);

    // Mark active pause resumed if not already (scheduled / non-early)
    const record = this.records.find(
      (r) => r.subscriptionId === params.subscriptionId && r.status === 'active'
    );
    if (record) {
      record.resumedAt = now;
      record.earlyResume = params.early ?? false;
      record.status = 'resumed';
      if (!params.early) {
        record.creditRemaining = 0;
      }
    }

    return adjustment;
  }

  // ─── Limits ────────────────────────────────────────────────────────────────

  enforceLimits(
    history: PauseBillingRecord[],
    pauseDays: number,
    limits: PauseLimits = this.limits,
    subscriptionId?: string
  ): LimitEnforcementResult {
    if (pauseDays < limits.minDays) {
      return {
        allowed: false,
        reason: `Minimum pause duration is ${limits.minDays} days.`,
      };
    }
    if (pauseDays > limits.maxDays) {
      return {
        allowed: false,
        reason: `Maximum pause duration is ${limits.maxDays} days.`,
      };
    }

    const scoped = subscriptionId
      ? history.filter((r) => r.subscriptionId === subscriptionId)
      : history;

    const activePause = scoped.find((r) => r.status === 'active');
    if (activePause) {
      return { allowed: false, reason: 'This subscription is already paused.' };
    }

    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const pausesThisYear = scoped.filter((r) => new Date(r.pausedAt) >= yearStart).length;

    if (pausesThisYear >= limits.maxPausesPerYear) {
      return {
        allowed: false,
        reason: `Maximum of ${limits.maxPausesPerYear} pauses per year reached.`,
      };
    }

    const warning = pausesThisYear >= limits.maxPausesPerYear - 1;

    return { allowed: true, warning };
  }

  setLimits(limits: Partial<PauseLimits>): PauseLimits {
    this.limits = {
      ...this.limits,
      ...limits,
    };
    return { ...this.limits };
  }

  getLimits(): PauseLimits {
    return { ...this.limits };
  }

  // ─── Notifications ─────────────────────────────────────────────────────────

  /**
   * Schedule paused + resume_reminder + resumed notifications for a pause.
   */
  scheduleNotifications(
    subscriptionId: string,
    pauseDays: number,
    resumeAt: Date,
    channel: PauseNotificationChannel = this.defaultChannel
  ): PauseNotification[] {
    const now = new Date();
    const reminderAt = new Date(resumeAt.getTime() - MS_PER_DAY);

    const items: PauseNotification[] = [
      {
        id: generateId(),
        subscriptionId,
        type: 'paused',
        channel,
        title: 'Subscription paused',
        body: `Your subscription has been paused for ${pauseDays} days.`,
        scheduledFor: now,
        sentAt: now,
      },
      {
        id: generateId(),
        subscriptionId,
        type: 'resume_reminder',
        channel,
        title: 'Pause ending soon',
        body: 'Your subscription pause ends tomorrow. Billing will restart on resume.',
        scheduledFor: reminderAt > now ? reminderAt : now,
      },
      {
        id: generateId(),
        subscriptionId,
        type: 'resumed',
        channel,
        title: 'Subscription resumed',
        body: 'Your subscription has resumed and billing has restarted.',
        scheduledFor: resumeAt,
      },
    ];

    this.notifications.push(...items);
    return items;
  }

  scheduleLimitWarning(
    subscriptionId: string,
    message: string,
    channel: PauseNotificationChannel = this.defaultChannel
  ): PauseNotification {
    const notification: PauseNotification = {
      id: generateId(),
      subscriptionId,
      type: 'limit_warning',
      channel,
      title: 'Pause limit warning',
      body: message,
      scheduledFor: new Date(),
      sentAt: new Date(),
    };
    this.notifications.push(notification);
    return notification;
  }

  // ─── Analytics ─────────────────────────────────────────────────────────────

  getAnalytics(
    records: PauseBillingRecord[] = this.records,
    adjustments: BillingAdjustment[] = this.adjustments
  ): PauseAnalyticsReport {
    const totalPauses = records.length;
    const activePauses = records.filter((r) => r.status === 'active').length;
    const resumed = records.filter((r) => r.status === 'resumed');
    const earlyResumes = resumed.filter((r) => r.earlyResume);

    const averagePauseDays =
      totalPauses > 0
        ? roundMoney(
            records.reduce((sum, r) => {
              if (r.resumedAt) {
                const days = Math.max(
                  0,
                  Math.ceil(
                    (new Date(r.resumedAt).getTime() - new Date(r.pausedAt).getTime()) / MS_PER_DAY
                  )
                );
                return sum + days;
              }
              return sum + r.pauseDays;
            }, 0) / totalPauses
          )
        : 0;

    const totalCreditsIssued = roundMoney(
      adjustments.filter((a) => a.type === 'pause_credit').reduce((sum, a) => sum + a.amount, 0)
    );

    const totalCreditsRemaining = roundMoney(
      records.reduce((sum, r) => sum + r.creditRemaining, 0)
    );

    const resumeRate = totalPauses > 0 ? roundMoney((resumed.length / totalPauses) * 100) : 0;
    const earlyResumeRate =
      resumed.length > 0 ? roundMoney((earlyResumes.length / resumed.length) * 100) : 0;

    const byReason: Record<string, number> = {};
    for (const r of records) {
      const key = r.reason ?? 'unspecified';
      byReason[key] = (byReason[key] ?? 0) + 1;
    }

    return {
      totalPauses,
      activePauses,
      averagePauseDays,
      totalCreditsIssued,
      totalCreditsRemaining,
      resumeRate,
      earlyResumeRate,
      byReason,
    };
  }

  // ─── Store accessors ───────────────────────────────────────────────────────

  getAdjustments(subscriptionId?: string): BillingAdjustment[] {
    if (!subscriptionId) return [...this.adjustments];
    return this.adjustments.filter((a) => a.subscriptionId === subscriptionId);
  }

  getNotifications(subscriptionId?: string): PauseNotification[] {
    if (!subscriptionId) return [...this.notifications];
    return this.notifications.filter((n) => n.subscriptionId === subscriptionId);
  }

  getRecords(subscriptionId?: string): PauseBillingRecord[] {
    if (!subscriptionId) return [...this.records];
    return this.records.filter((r) => r.subscriptionId === subscriptionId);
  }

  getActivePause(subscriptionId: string): PauseBillingRecord | undefined {
    return this.records.find((r) => r.subscriptionId === subscriptionId && r.status === 'active');
  }

  getPauseCreditAdjustment(subscriptionId: string): BillingAdjustment | undefined {
    const active = this.getActivePause(subscriptionId);
    if (!active) return undefined;
    return this.adjustments
      .filter(
        (a) =>
          a.subscriptionId === subscriptionId &&
          a.type === 'pause_credit' &&
          a.createdAt.getTime() <= new Date(active.pausedAt).getTime() + 1000
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  /** Reset in-memory state (tests). */
  reset(): void {
    this.adjustments = [];
    this.notifications = [];
    this.records = [];
    this.limits = { ...DEFAULT_PAUSE_LIMITS };
  }
}

/** Shared singleton for API / app usage */
export const pauseBillingService = new PauseBillingService();
