/**
 * Renewal Reminder Scheduler
 *
 * Automatically creates calendar events in connected calendars for upcoming
 * subscription renewals, payment due dates, and trial endings.
 *
 * How it works:
 *   1. Call `scheduleRenewals(subscriptions)` — compares each subscription's
 *      next billing date against the configured lead-time windows and creates
 *      (or updates) calendar events in every connected calendar for that user.
 *   2. Call `processReminders()` on a cron (e.g. daily) to sweep all active
 *      subscriptions and keep calendar events in sync.
 *   3. When a subscription is cancelled/updated, call `cancelRenewalReminders()`
 *      to soft-delete the associated calendar events.
 *
 * Lead-time windows (configurable):
 *   - 30 days before renewal  → "early warning" event
 *   - 7 days before renewal   → "upcoming renewal" event  (default)
 *   - 1 day before renewal    → "renewal tomorrow" event
 *
 * Duplicate prevention: the scheduler tracks which (subscriptionId, eventType,
 * billingDate) tuples already have events and skips re-creation.
 */

import type { CalendarSyncService } from './CalendarSyncService';
import type { CalendarEventType } from './types';

// ── Domain Types ──────────────────────────────────────────────────────────────

export interface SubscriptionForReminder {
  id: string;
  userId: string;
  name: string;
  amount: number;
  currency: string;
  /** ISO date string of the next charge */
  nextBillingDate: string;
  billingCycle: string;
  status: 'active' | 'paused' | 'trialing' | 'cancelled';
  /** ISO date string when the trial ends (if trialing) */
  trialEndDate?: string;
}

export interface ReminderLeadTime {
  /** How many days before the event to create the calendar entry */
  daysBeforeRenewal: number;
  /** CalendarEventType to assign */
  eventType: CalendarEventType;
  /** Human-readable label used in the event title */
  label: string;
}

export interface ReminderSchedulerConfig {
  /** Lead-time windows to create. Default: 7-day and 1-day warnings. */
  leadTimes: ReminderLeadTime[];
  /** Event duration in minutes. Default: 60. */
  eventDurationMinutes: number;
  /** Whether to update existing events when billing dates change. Default: true. */
  updateExistingEvents: boolean;
}

export interface ScheduleRenewalsResult {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  errors: Array<{ subscriptionId: string; error: string }>;
}

export interface ReminderRecord {
  subscriptionId: string;
  userId: string;
  billingDate: string; // ISO date (YYYY-MM-DD) used as dedup key
  eventType: CalendarEventType;
  calendarEventId: string;
  connectionId: string;
  createdAt: string;
}

// ── Default configuration ─────────────────────────────────────────────────────

export const DEFAULT_LEAD_TIMES: ReminderLeadTime[] = [
  {
    daysBeforeRenewal: 30,
    eventType: 'renewal',
    label: 'Renewal in 30 Days',
  },
  {
    daysBeforeRenewal: 7,
    eventType: 'renewal',
    label: 'Renewal Upcoming',
  },
  {
    daysBeforeRenewal: 1,
    eventType: 'payment_due',
    label: 'Renewal Tomorrow',
  },
];

export const DEFAULT_SCHEDULER_CONFIG: ReminderSchedulerConfig = {
  leadTimes: DEFAULT_LEAD_TIMES,
  eventDurationMinutes: 60,
  updateExistingEvents: true,
};

// ── Scheduler ─────────────────────────────────────────────────────────────────

export class RenewalReminderScheduler {
  private readonly calendarService: CalendarSyncService;
  private readonly config: ReminderSchedulerConfig;

  /** Records of already-created reminders — keyed by dedup string */
  private readonly reminderRecords = new Map<string, ReminderRecord>();

  constructor(
    calendarService: CalendarSyncService,
    config: Partial<ReminderSchedulerConfig> = {},
  ) {
    this.calendarService = calendarService;
    this.config = {
      leadTimes: config.leadTimes ?? DEFAULT_SCHEDULER_CONFIG.leadTimes,
      eventDurationMinutes:
        config.eventDurationMinutes ?? DEFAULT_SCHEDULER_CONFIG.eventDurationMinutes,
      updateExistingEvents:
        config.updateExistingEvents ?? DEFAULT_SCHEDULER_CONFIG.updateExistingEvents,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Schedule renewal reminders for a list of subscriptions.
   * Creates calendar events in all calendars connected for each subscription's user.
   * Safe to call repeatedly — existing events are updated rather than duplicated.
   */
  scheduleRenewals(
    subscriptions: SubscriptionForReminder[],
    now: Date = new Date(),
  ): ScheduleRenewalsResult {
    const result: ScheduleRenewalsResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      errors: [],
    };

    for (const subscription of subscriptions) {
      try {
        const subResult = this.processSubscription(subscription, now);
        result.created += subResult.created;
        result.updated += subResult.updated;
        result.skipped += subResult.skipped;
        result.deleted += subResult.deleted;
      } catch (err) {
        result.errors.push({
          subscriptionId: subscription.id,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  /**
   * Schedule or update reminders for a single subscription.
   */
  scheduleForSubscription(
    subscription: SubscriptionForReminder,
    now: Date = new Date(),
  ): ScheduleRenewalsResult {
    const result: ScheduleRenewalsResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      errors: [],
    };

    try {
      const subResult = this.processSubscription(subscription, now);
      result.created += subResult.created;
      result.updated += subResult.updated;
      result.skipped += subResult.skipped;
      result.deleted += subResult.deleted;
    } catch (err) {
      result.errors.push({
        subscriptionId: subscription.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    return result;
  }

  /**
   * Cancel all calendar reminders for a subscription (e.g. on cancellation).
   */
  cancelRenewalReminders(subscriptionId: string): number {
    let deleted = 0;
    for (const [key, record] of this.reminderRecords) {
      if (record.subscriptionId !== subscriptionId) continue;
      try {
        this.calendarService.deleteEvent(record.calendarEventId);
        this.reminderRecords.delete(key);
        deleted++;
      } catch {
        // Event may already be deleted from the calendar provider side
        this.reminderRecords.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Get all reminder records for a subscription.
   */
  getRemindersForSubscription(subscriptionId: string): ReminderRecord[] {
    return Array.from(this.reminderRecords.values()).filter(
      r => r.subscriptionId === subscriptionId,
    );
  }

  /**
   * Get all reminder records for a user.
   */
  getRemindersForUser(userId: string): ReminderRecord[] {
    return Array.from(this.reminderRecords.values()).filter(r => r.userId === userId);
  }

  /**
   * Returns upcoming reminders that will fire within the next `withinDays` days.
   */
  getUpcomingReminders(withinDays: number, now: Date = new Date()): ReminderRecord[] {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + withinDays);

    return Array.from(this.reminderRecords.values()).filter(record => {
      const billingDate = new Date(record.billingDate);
      return billingDate >= now && billingDate <= cutoff;
    });
  }

  /**
   * Re-schedule all reminders across a full list — useful for a daily cron job.
   */
  processReminders(
    subscriptions: SubscriptionForReminder[],
    now: Date = new Date(),
  ): ScheduleRenewalsResult {
    return this.scheduleRenewals(subscriptions, now);
  }

  // ── Internal processing ────────────────────────────────────────────────────

  private processSubscription(
    subscription: SubscriptionForReminder,
    now: Date,
  ): ScheduleRenewalsResult {
    const result: ScheduleRenewalsResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      errors: [],
    };

    // Skip non-active subscriptions; clean up their events
    if (subscription.status === 'cancelled') {
      result.deleted += this.cancelRenewalReminders(subscription.id);
      return result;
    }

    const connections = this.calendarService.listConnections(subscription.userId);
    if (connections.length === 0) {
      result.skipped++;
      return result;
    }

    const activeConnections = connections.filter(c => c.status === 'connected');

    // ── Renewal reminders ──────────────────────────────────────────────────
    const renewalDate = new Date(subscription.nextBillingDate);

    for (const leadTime of this.config.leadTimes) {
      const reminderDate = new Date(renewalDate);
      reminderDate.setDate(reminderDate.getDate() - leadTime.daysBeforeRenewal);

      // Skip if reminder date is already in the past
      if (reminderDate <= now) continue;

      for (const connection of activeConnections) {
        // Check if this event type is enabled for the connection
        if (!connection.enabledEventTypes.includes(leadTime.eventType)) continue;
        if (connection.syncDirection === 'from_calendar') continue;

        const dedupKey = this.makeDedupKey(
          subscription.id,
          leadTime.eventType,
          formatDate(renewalDate),
          connection.id,
        );

        const title = this.buildEventTitle(subscription, leadTime);
        const description = this.buildEventDescription(subscription, leadTime, renewalDate);
        const startTime = reminderDate.toISOString();
        const endTime = this.addMinutes(reminderDate, this.config.eventDurationMinutes).toISOString();

        const existing = this.reminderRecords.get(dedupKey);

        if (existing) {
          if (this.config.updateExistingEvents) {
            try {
              this.calendarService.updateEventLocally(existing.calendarEventId, {
                title,
                description,
                startTime,
                endTime,
              });
              result.updated++;
            } catch {
              result.skipped++;
            }
          } else {
            result.skipped++;
          }
        } else {
          try {
            const event = this.calendarService.createEvent(
              connection.id,
              subscription.id,
              leadTime.eventType,
              title,
              description,
              startTime,
              endTime,
              false,
            );

            const record: ReminderRecord = {
              subscriptionId: subscription.id,
              userId: subscription.userId,
              billingDate: formatDate(renewalDate),
              eventType: leadTime.eventType,
              calendarEventId: event.id,
              connectionId: connection.id,
              createdAt: new Date().toISOString(),
            };
            this.reminderRecords.set(dedupKey, record);
            result.created++;
          } catch (err) {
            result.errors.push({
              subscriptionId: subscription.id,
              error: err instanceof Error ? err.message : 'Failed to create event',
            });
          }
        }
      }
    }

    // ── Trial ending reminders ─────────────────────────────────────────────
    if (subscription.status === 'trialing' && subscription.trialEndDate) {
      const trialEnd = new Date(subscription.trialEndDate);
      const trialReminder = new Date(trialEnd);
      trialReminder.setDate(trialReminder.getDate() - 3); // 3-day warning

      if (trialReminder > now) {
        for (const connection of activeConnections) {
          if (!connection.enabledEventTypes.includes('trial_ending')) continue;
          if (connection.syncDirection === 'from_calendar') continue;

          const dedupKey = this.makeDedupKey(
            subscription.id,
            'trial_ending',
            formatDate(trialEnd),
            connection.id,
          );

          if (!this.reminderRecords.has(dedupKey)) {
            try {
              const title = `Trial Ending: ${subscription.name}`;
              const description = this.buildTrialDescription(subscription, trialEnd);
              const startTime = trialReminder.toISOString();
              const endTime = this.addMinutes(trialReminder, this.config.eventDurationMinutes).toISOString();

              const event = this.calendarService.createEvent(
                connection.id,
                subscription.id,
                'trial_ending',
                title,
                description,
                startTime,
                endTime,
                false,
              );

              const record: ReminderRecord = {
                subscriptionId: subscription.id,
                userId: subscription.userId,
                billingDate: formatDate(trialEnd),
                eventType: 'trial_ending',
                calendarEventId: event.id,
                connectionId: connection.id,
                createdAt: new Date().toISOString(),
              };
              this.reminderRecords.set(dedupKey, record);
              result.created++;
            } catch (err) {
              result.errors.push({
                subscriptionId: subscription.id,
                error: err instanceof Error ? err.message : 'Failed to create trial event',
              });
            }
          }
        }
      }
    }

    return result;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private buildEventTitle(
    subscription: SubscriptionForReminder,
    leadTime: ReminderLeadTime,
  ): string {
    return `${leadTime.label}: ${subscription.name}`;
  }

  private buildEventDescription(
    subscription: SubscriptionForReminder,
    leadTime: ReminderLeadTime,
    renewalDate: Date,
  ): string {
    const amount = `${subscription.currency.toUpperCase()} ${subscription.amount.toFixed(2)}`;
    return [
      `Subscription: ${subscription.name}`,
      `Amount: ${amount} / ${subscription.billingCycle}`,
      `Renewal Date: ${formatDate(renewalDate)}`,
      `Reminder: ${leadTime.daysBeforeRenewal} day${leadTime.daysBeforeRenewal === 1 ? '' : 's'} before renewal`,
      '',
      'Manage your subscription at https://subtrackr.app',
    ].join('\n');
  }

  private buildTrialDescription(
    subscription: SubscriptionForReminder,
    trialEnd: Date,
  ): string {
    const amount = `${subscription.currency.toUpperCase()} ${subscription.amount.toFixed(2)}`;
    return [
      `Your trial for ${subscription.name} ends on ${formatDate(trialEnd)}.`,
      `After the trial, you will be charged ${amount} / ${subscription.billingCycle}.`,
      '',
      'Manage your subscription at https://subtrackr.app',
    ].join('\n');
  }

  private makeDedupKey(
    subscriptionId: string,
    eventType: CalendarEventType,
    billingDate: string,
    connectionId: string,
  ): string {
    return `${subscriptionId}::${eventType}::${billingDate}::${connectionId}`;
  }

  private addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ── Singleton ─────────────────────────────────────────────────────────────────
// Lazily instantiated so tests can inject their own CalendarSyncService.
let _instance: RenewalReminderScheduler | undefined;

export function getRenewalReminderScheduler(
  calendarService: CalendarSyncService,
  config?: Partial<ReminderSchedulerConfig>,
): RenewalReminderScheduler {
  if (!_instance) {
    _instance = new RenewalReminderScheduler(calendarService, config);
  }
  return _instance;
}
