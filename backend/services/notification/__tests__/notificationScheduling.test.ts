/**
 * Tests for Issue #920 — Notification scheduling, digest management and
 * preference synchronisation.
 */

import {
  DigestNotificationManager,
  NotificationScheduler,
  NotificationPreferenceSync,
  type NotificationPreferences,
  type DigestNotificationItem,
} from '../preferenceService';

// ── Fixtures ─────────────────────────────────────────────────────────────

const makePrefs = (overrides: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  userId: 'user_test',
  channels: { push: true, email: true, sms: false, inApp: true },
  frequency: 'immediate',
  quietHours: {
    enabled: false,
    startTime: '22:00',
    endTime: '08:00',
    timezone: 'UTC',
  },
  types: {} as NotificationPreferences['types'],
  minimumPriority: 'informative',
  version: 1,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const futureTime = new Date(Date.now() + 3_600_000).toISOString(); // 1 hour from now
const pastTime = new Date(Date.now() - 1000).toISOString(); // 1 second ago

const makeItem = (
  scheduledFor: string,
  channel: 'push' | 'email' | 'sms' | 'inApp' = 'push'
): Omit<DigestNotificationItem, 'id' | 'createdAt'> => ({
  userId: 'user_test',
  type: 'billing_reminder' as never,
  channel,
  payload: { msg: 'test' },
  scheduledFor,
});

// ── DigestNotificationManager ─────────────────────────────────────────────

describe('DigestNotificationManager', () => {
  let manager: DigestNotificationManager;

  beforeEach(() => {
    manager = new (DigestNotificationManager as unknown as { new(): DigestNotificationManager })();
  });

  it('should return an immediate batch for "immediate" frequency', () => {
    const batch = manager.enqueue(makeItem(futureTime), 'immediate');
    expect(batch).not.toBeNull();
    expect(batch!.items).toHaveLength(1);
    expect(batch!.userId).toBe('user_test');
  });

  it('should buffer items for "daily" frequency', () => {
    const batch = manager.enqueue(makeItem(futureTime), 'daily');
    expect(batch).toBeNull();
    expect(manager.pendingCount('user_test')).toBe(1);
  });

  it('should buffer items for "weekly" frequency', () => {
    manager.enqueue(makeItem(futureTime), 'weekly');
    expect(manager.pendingCount('user_test')).toBe(1);
  });

  it('should flush items whose scheduledFor is in the past', () => {
    manager.enqueue(makeItem(pastTime), 'daily');
    manager.enqueue(makeItem(futureTime), 'daily'); // should NOT flush

    const batches = manager.flushDueDigests(new Date());

    expect(batches).toHaveLength(1);
    expect(batches[0].items).toHaveLength(1);
    // Future item remains buffered.
    expect(manager.pendingCount('user_test')).toBe(1);
  });

  it('should group flushed items by channel', () => {
    manager.enqueue(makeItem(pastTime, 'push'), 'daily');
    manager.enqueue(makeItem(pastTime, 'email'), 'daily');
    manager.enqueue(makeItem(pastTime, 'push'), 'daily');

    const batches = manager.flushDueDigests(new Date());

    const pushBatch = batches.find((b) => b.channel === 'push');
    const emailBatch = batches.find((b) => b.channel === 'email');

    expect(pushBatch?.items).toHaveLength(2);
    expect(emailBatch?.items).toHaveLength(1);
  });

  it('should clear a user\'s buffered items', () => {
    manager.enqueue(makeItem(futureTime), 'daily');
    manager.clearUser('user_test');
    expect(manager.pendingCount('user_test')).toBe(0);
  });

  it('should return empty when there are no due items', () => {
    manager.enqueue(makeItem(futureTime), 'daily');
    const batches = manager.flushDueDigests(new Date());
    expect(batches).toHaveLength(0);
  });
});

// ── NotificationScheduler ─────────────────────────────────────────────────

describe('NotificationScheduler', () => {
  let scheduler: NotificationScheduler;

  beforeEach(() => {
    scheduler = NotificationScheduler.getInstance();
  });

  it('should return "now" for immediate frequency outside quiet hours', () => {
    const prefs = makePrefs({ frequency: 'immediate' });
    const now = new Date('2026-06-15T14:00:00Z'); // 14:00 UTC — not in default quiet hours
    const result = new Date(scheduler.nextDeliveryTime(prefs, now));
    // Should be very close to "now" (within 1 second).
    expect(Math.abs(result.getTime() - now.getTime())).toBeLessThan(1000);
  });

  it('should not schedule immediate delivery when quiet hours are disabled', () => {
    const prefs = makePrefs({
      frequency: 'immediate',
      quietHours: {
        enabled: false,
        startTime: '01:00',
        endTime: '09:00',
        timezone: 'UTC',
      },
    });
    const anyTime = new Date('2026-06-16T03:00:00Z');
    const result = new Date(scheduler.nextDeliveryTime(prefs, anyTime));
    // Quiet hours disabled — should deliver now.
    expect(Math.abs(result.getTime() - anyTime.getTime())).toBeLessThan(1000);
  });

  it('should schedule daily delivery at 09:00 UTC', () => {
    const prefs = makePrefs({ frequency: 'daily' });
    const now = new Date('2026-06-15T12:00:00Z');
    const result = new Date(scheduler.nextDeliveryTime(prefs, now));
    // Next 09:00 is the following day.
    expect(result.getUTCHours()).toBe(9);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCDate()).toBeGreaterThan(now.getUTCDate());
  });

  it('should schedule daily delivery at 09:00 UTC (same day when before 09:00)', () => {
    const prefs = makePrefs({ frequency: 'daily' });
    const earlyMorning = new Date('2026-06-15T07:00:00Z');
    const result = new Date(scheduler.nextDeliveryTime(prefs, earlyMorning));
    expect(result.getUTCHours()).toBe(9);
    expect(result.getUTCDate()).toBe(earlyMorning.getUTCDate());
  });

  it('should schedule weekly delivery on the next Monday', () => {
    const prefs = makePrefs({ frequency: 'weekly' });
    // 2026-06-15 is a Monday.
    const monday = new Date('2026-06-15T12:00:00Z');
    const result = new Date(scheduler.nextDeliveryTime(prefs, monday));
    expect(result.getUTCDay()).toBe(1); // 1 = Monday
    // Should be the following Monday (7 days later).
    const diffMs = result.getTime() - monday.getTime();
    expect(diffMs).toBeGreaterThan(6 * 24 * 3_600_000); // more than 6 days
  });
});

// ── NotificationPreferenceSync ────────────────────────────────────────────

describe('NotificationPreferenceSync', () => {
  let sync: NotificationPreferenceSync;

  beforeEach(() => {
    sync = new (NotificationPreferenceSync as unknown as { new(): NotificationPreferenceSync })();
  });

  it('should record a change and detect changed fields', () => {
    const prev = makePrefs({ frequency: 'immediate', version: 1 });
    const next = makePrefs({ frequency: 'daily', version: 2 });

    const event = sync.recordChange('user_test', 1, next, prev);

    expect(event.userId).toBe('user_test');
    expect(event.previousVersion).toBe(1);
    expect(event.newVersion).toBe(2);
    expect(event.changedFields).toContain('frequency');
  });

  it('should notify registered listeners', () => {
    const events: unknown[] = [];
    const unsub = sync.addListener((e) => events.push(e));

    const prev = makePrefs({ version: 1 });
    const next = makePrefs({ version: 2, frequency: 'weekly' });
    sync.recordChange('user_test', 1, next, prev);

    expect(events).toHaveLength(1);
    unsub(); // unsubscribe
  });

  it('should stop notifying after unsubscribe', () => {
    const events: unknown[] = [];
    const unsub = sync.addListener((e) => events.push(e));
    unsub();

    const prev = makePrefs({ version: 1 });
    const next = makePrefs({ version: 2 });
    sync.recordChange('user_test', 1, next, prev);

    expect(events).toHaveLength(0);
  });

  it('should return changes since a given version', () => {
    const prev1 = makePrefs({ version: 1 });
    const next1 = makePrefs({ version: 2, frequency: 'daily' });
    const next2 = makePrefs({ version: 3, frequency: 'weekly' });

    sync.recordChange('user_test', 1, next1, prev1);
    sync.recordChange('user_test', 2, next2, next1);

    const changes = sync.changesSince('user_test', 1);
    expect(changes).toHaveLength(2);

    const changesFromV2 = sync.changesSince('user_test', 2);
    expect(changesFromV2).toHaveLength(1);
    expect(changesFromV2[0].newVersion).toBe(3);
  });

  it('should return no changes for an unknown user', () => {
    expect(sync.changesSince('unknown_user', 0)).toHaveLength(0);
  });

  it('should not report version/updatedAt as changed fields', () => {
    const prev = makePrefs({ version: 1, updatedAt: '2026-01-01T00:00:00Z' });
    const next = { ...prev, version: 2, updatedAt: new Date().toISOString() };
    const event = sync.recordChange('user_test', 1, next, prev);
    expect(event.changedFields).not.toContain('version');
    expect(event.changedFields).not.toContain('updatedAt');
  });
});
