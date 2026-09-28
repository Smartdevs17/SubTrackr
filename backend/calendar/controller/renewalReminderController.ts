/**
 * Renewal Reminder Controller
 *
 * HTTP controller for the renewal reminder scheduler.
 *
 * Routes (mounted at /api/v1/calendar/reminders):
 *   POST   /schedule          — schedule reminders for a list of subscriptions
 *   POST   /schedule/:id      — schedule reminders for a single subscription
 *   DELETE /:subscriptionId   — cancel all reminders for a subscription
 *   GET    /subscription/:id  — get reminders for a subscription
 *   GET    /user/:userId      — get reminders for a user
 *   GET    /upcoming          — get reminders firing within N days
 *   POST   /process           — run the full reminder sweep (cron endpoint)
 */

import type {
  RenewalReminderScheduler,
  SubscriptionForReminder,
  ScheduleRenewalsResult,
  ReminderRecord,
} from '../domain/RenewalReminderScheduler';

interface ControllerResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export function createRenewalReminderController(deps: {
  scheduler: RenewalReminderScheduler;
}) {
  const { scheduler } = deps;

  return {
    /**
     * POST /reminders/schedule
     * Body: { subscriptions: SubscriptionForReminder[], now?: string }
     */
    scheduleRenewals(body: {
      subscriptions?: SubscriptionForReminder[];
      now?: string;
    }): ControllerResult<ScheduleRenewalsResult> {
      if (!Array.isArray(body.subscriptions)) {
        return { success: false, error: 'subscriptions array is required', status: 400 };
      }

      const now = body.now ? new Date(body.now) : new Date();
      if (isNaN(now.getTime())) {
        return { success: false, error: 'Invalid "now" date', status: 400 };
      }

      const result = scheduler.scheduleRenewals(body.subscriptions, now);
      return { success: true, data: result };
    },

    /**
     * POST /reminders/schedule/:subscriptionId
     * Body: { subscription: SubscriptionForReminder, now?: string }
     */
    scheduleForSubscription(
      _subscriptionId: string,
      body: { subscription?: SubscriptionForReminder; now?: string },
    ): ControllerResult<ScheduleRenewalsResult> {
      if (!body.subscription) {
        return { success: false, error: 'subscription is required', status: 400 };
      }

      const now = body.now ? new Date(body.now) : new Date();
      if (isNaN(now.getTime())) {
        return { success: false, error: 'Invalid "now" date', status: 400 };
      }

      const result = scheduler.scheduleForSubscription(body.subscription, now);
      return { success: true, data: result };
    },

    /**
     * DELETE /reminders/:subscriptionId
     */
    cancelReminders(subscriptionId: string): ControllerResult<{ deleted: number }> {
      if (!subscriptionId) {
        return { success: false, error: 'subscriptionId is required', status: 400 };
      }
      const deleted = scheduler.cancelRenewalReminders(subscriptionId);
      return { success: true, data: { deleted } };
    },

    /**
     * GET /reminders/subscription/:subscriptionId
     */
    getBySubscription(subscriptionId: string): ControllerResult<ReminderRecord[]> {
      const records = scheduler.getRemindersForSubscription(subscriptionId);
      return { success: true, data: records };
    },

    /**
     * GET /reminders/user/:userId
     */
    getByUser(userId: string): ControllerResult<ReminderRecord[]> {
      const records = scheduler.getRemindersForUser(userId);
      return { success: true, data: records };
    },

    /**
     * GET /reminders/upcoming?withinDays=7
     */
    getUpcoming(
      withinDaysParam: string | undefined,
      nowParam?: string,
    ): ControllerResult<ReminderRecord[]> {
      const withinDays = withinDaysParam ? parseInt(withinDaysParam, 10) : 7;
      if (isNaN(withinDays) || withinDays < 1) {
        return { success: false, error: 'withinDays must be a positive integer', status: 400 };
      }
      const now = nowParam ? new Date(nowParam) : new Date();
      if (isNaN(now.getTime())) {
        return { success: false, error: 'Invalid "now" param', status: 400 };
      }
      const records = scheduler.getUpcomingReminders(withinDays, now);
      return { success: true, data: records };
    },

    /**
     * POST /reminders/process
     * Body: { subscriptions: SubscriptionForReminder[], now?: string }
     * Intended for a cron job or scheduled worker.
     */
    processReminders(body: {
      subscriptions?: SubscriptionForReminder[];
      now?: string;
    }): ControllerResult<ScheduleRenewalsResult> {
      if (!Array.isArray(body.subscriptions)) {
        return { success: false, error: 'subscriptions array is required', status: 400 };
      }
      const now = body.now ? new Date(body.now) : new Date();
      const result = scheduler.processReminders(body.subscriptions, now);
      return { success: true, data: result };
    },
  };
}
