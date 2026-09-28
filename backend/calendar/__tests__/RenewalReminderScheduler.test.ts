/**
 * Tests for the Renewal Reminder Scheduler.
 */

import { CalendarSyncService } from '../domain/CalendarSyncService';
import {
  RenewalReminderScheduler,
  DEFAULT_LEAD_TIMES,
  type SubscriptionForReminder,
} from '../domain/RenewalReminderScheduler';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeService(): CalendarSyncService {
  return new CalendarSyncService({ pollIntervalMs: 1000, rateLimitPerMinute: 1000 });
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function isoDateIn(days: number, from: Date = new Date()): string {
  return addDays(from, days).toISOString();
}

function makeSubscription(overrides: Partial<SubscriptionForReminder> = {}): SubscriptionForReminder {
  return {
    id: 'sub_001',
    userId: 'user_001',
    name: 'Pro Plan',
    amount: 49.99,
    currency: 'USD',
    nextBillingDate: isoDateIn(10), // 10 days from now
    billingCycle: 'monthly',
    status: 'active',
    ...overrides,
  };
}

function connectCalendar(service: CalendarSyncService, userId: string) {
  return service.createConnection(
    userId,
    'google',
    'access_tok',
    'refresh_tok',
    `${userId}@example.com`,
    'primary',
    'bidirectional',
    ['payment_due', 'renewal', 'trial_ending', 'contract_end'],
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RenewalReminderScheduler — basic scheduling', () => {
  it('creates calendar events for active subscriptions with connected calendars', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');

    const scheduler = new RenewalReminderScheduler(svc, {
      leadTimes: [{ daysBeforeRenewal: 7, eventType: 'renewal', label: 'Renewal Upcoming' }],
    });

    const now = new Date();
    const result = scheduler.scheduleRenewals([makeSubscription()], now);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('creates one event per lead-time per connection', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');

    const scheduler = new RenewalReminderScheduler(svc, {
      leadTimes: [
        { daysBeforeRenewal: 7, eventType: 'renewal', label: 'Renewal Upcoming' },
        { daysBeforeRenewal: 1, eventType: 'payment_due', label: 'Renewal Tomorrow' },
      ],
    });

    const result = scheduler.scheduleRenewals([makeSubscription()], new Date());

    expect(result.created).toBe(2);
  });

  it('creates events for multiple connections for the same user', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');
    connectCalendar(svc, 'user_001');

    const scheduler = new RenewalReminderScheduler(svc, {
      leadTimes: [{ daysBeforeRenewal: 7, eventType: 'renewal', label: 'Upcoming' }],
    });

    const result = scheduler.scheduleRenewals([makeSubscription()], new Date());
    expect(result.created).toBe(2);
  });

  it('skips users with no connected calendars', () => {
    const svc = makeService();
    // No connection added for user_001
    const scheduler = new RenewalReminderScheduler(svc);

    const result = scheduler.scheduleRenewals([makeSubscription()], new Date());

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips subscriptions whose reminder date is already in the past', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');

    const scheduler = new RenewalReminderScheduler(svc, {
      leadTimes: [{ daysBeforeRenewal: 7, eventType: 'renewal', label: 'Upcoming' }],
    });

    // Billing date is 3 days from now — 7-day reminder is already in the past
    const sub = makeSubscription({ nextBillingDate: isoDateIn(3) });
    const result = scheduler.scheduleRenewals([sub], new Date());

    expect(result.created).toBe(0);
  });
});

describe('RenewalReminderScheduler — deduplication', () => {
  it('does not create duplicate events on repeated calls', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');

    const scheduler = new RenewalReminderScheduler(svc, {
      leadTimes: [{ daysBeforeRenewal: 7, eventType: 'renewal', label: 'Upcoming' }],
      updateExistingEvents: false,
    });

    const sub = makeSubscription();
    const now = new Date();

    const r1 = scheduler.scheduleRenewals([sub], now);
    const r2 = scheduler.scheduleRenewals([sub], now);

    expect(r1.created).toBe(1);
    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(1);
  });

  it('updates (not duplicates) existing events when updateExistingEvents=true', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');

    const scheduler = new RenewalReminderScheduler(svc, {
      leadTimes: [{ daysBeforeRenewal: 7, eventType: 'renewal', label: 'Upcoming' }],
      updateExistingEvents: true,
    });

    const sub = makeSubscription();
    const now = new Date();

    const r1 = scheduler.scheduleRenewals([sub], now);
    const r2 = scheduler.scheduleRenewals([sub], now);

    expect(r1.created).toBe(1);
    expect(r2.updated).toBe(1);
    expect(r2.created).toBe(0);
  });
});

describe('RenewalReminderScheduler — cancellation', () => {
  it('cancels all reminders for a subscription', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');

    const scheduler = new RenewalReminderScheduler(svc, {
      leadTimes: [
        { daysBeforeRenewal: 7, eventType: 'renewal', label: 'Upcoming' },
        { daysBeforeRenewal: 1, eventType: 'payment_due', label: 'Tomorrow' },
      ],
    });

    scheduler.scheduleRenewals([makeSubscription()], new Date());
    const deleted = scheduler.cancelRenewalReminders('sub_001');

    expect(deleted).toBe(2);
    expect(scheduler.getRemindersForSubscription('sub_001')).toHaveLength(0);
  });

  it('auto-cancels reminders for cancelled subscriptions during sweep', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');

    const scheduler = new RenewalReminderScheduler(svc, {
      leadTimes: [{ daysBeforeRenewal: 7, eventType: 'renewal', label: 'Upcoming' }],
    });

    const activeSub = makeSubscription();
    scheduler.scheduleRenewals([activeSub], new Date());
    expect(scheduler.getRemindersForSubscription('sub_001')).toHaveLength(1);

    // Now sweep with the subscription marked as cancelled
    const cancelledSub = makeSubscription({ status: 'cancelled' });
    const result = scheduler.processReminders([cancelledSub], new Date());

    expect(result.deleted).toBe(1);
    expect(scheduler.getRemindersForSubscription('sub_001')).toHaveLength(0);
  });
});

describe('RenewalReminderScheduler — trial ending reminders', () => {
  it('creates a trial_ending event 3 days before trial end', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');

    const scheduler = new RenewalReminderScheduler(svc, {
      leadTimes: [], // no renewal reminders — only trial
    });

    const sub = makeSubscription({
      status: 'trialing',
      trialEndDate: isoDateIn(10),
    });

    const result = scheduler.scheduleRenewals([sub], new Date());

    expect(result.created).toBe(1);
    const reminders = scheduler.getRemindersForSubscription('sub_001');
    expect(reminders[0]?.eventType).toBe('trial_ending');
  });

  it('skips trial reminder when trial end is in the past', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');

    const scheduler = new RenewalReminderScheduler(svc, { leadTimes: [] });

    const sub = makeSubscription({
      status: 'trialing',
      trialEndDate: isoDateIn(-5), // already ended
    });

    const result = scheduler.scheduleRenewals([sub], new Date());
    expect(result.created).toBe(0);
  });

  it('does not create trial reminder when trial_ending event type is not enabled', () => {
    const svc = makeService();
    // Connect with trial_ending disabled
    svc.createConnection(
      'user_001', 'google', 'tok', undefined, 'u@g.com', 'cal',
      'bidirectional',
      ['payment_due', 'renewal'], // no trial_ending
    );

    const scheduler = new RenewalReminderScheduler(svc, { leadTimes: [] });

    const sub = makeSubscription({
      status: 'trialing',
      trialEndDate: isoDateIn(10),
    });

    const result = scheduler.scheduleRenewals([sub], new Date());
    expect(result.created).toBe(0);
  });
});

describe('RenewalReminderScheduler — upcoming reminders query', () => {
  it('returns reminders within the requested window', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');

    const now = new Date();

    const scheduler = new RenewalReminderScheduler(svc, {
      leadTimes: [{ daysBeforeRenewal: 3, eventType: 'renewal', label: '3-day warning' }],
    });

    // Billing in 10 days → reminder fires in 7 days
    const sub = makeSubscription({ nextBillingDate: isoDateIn(10, now) });
    scheduler.scheduleRenewals([sub], now);

    const within14 = scheduler.getUpcomingReminders(14, now);
    const within3 = scheduler.getUpcomingReminders(3, now);

    expect(within14).toHaveLength(1);
    expect(within3).toHaveLength(0); // reminder is 7 days away
  });
});

describe('RenewalReminderScheduler — multi-subscription sweep', () => {
  it('handles multiple subscriptions for multiple users', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');
    connectCalendar(svc, 'user_002');

    const scheduler = new RenewalReminderScheduler(svc, {
      leadTimes: [{ daysBeforeRenewal: 7, eventType: 'renewal', label: 'Upcoming' }],
    });

    const subs: SubscriptionForReminder[] = [
      makeSubscription({ id: 'sub_001', userId: 'user_001', nextBillingDate: isoDateIn(10) }),
      makeSubscription({ id: 'sub_002', userId: 'user_002', nextBillingDate: isoDateIn(14) }),
    ];

    const result = scheduler.processReminders(subs, new Date());

    expect(result.created).toBe(2);
    expect(scheduler.getRemindersForUser('user_001')).toHaveLength(1);
    expect(scheduler.getRemindersForUser('user_002')).toHaveLength(1);
  });
});

describe('RenewalReminderScheduler — default config uses DEFAULT_LEAD_TIMES', () => {
  it('creates 3 events (30d, 7d, 1d) for a subscription 35 days away', () => {
    const svc = makeService();
    connectCalendar(svc, 'user_001');

    const scheduler = new RenewalReminderScheduler(svc);

    // Billing 35 days away — all 3 lead times (30d, 7d, 1d) are still future
    const sub = makeSubscription({ nextBillingDate: isoDateIn(35) });
    const result = scheduler.scheduleRenewals([sub], new Date());

    expect(result.created).toBe(DEFAULT_LEAD_TIMES.length);
  });
});
