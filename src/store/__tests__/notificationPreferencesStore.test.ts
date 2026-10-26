/**
 * Unit tests for notificationPreferencesStore.ts and the multi-channel
 * delivery path in notificationService.ts.
 *
 * Covers:
 *  - preferences per type and per channel, with required-type guards
 *  - channel resolution and fallback ordering
 *  - templates and variable rendering
 *  - notification history with read and click status
 *  - engagement analytics (delivery, open and click rates)
 *  - multi-channel delivery, suppression and quiet-hours scheduling
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  useNotificationPreferencesStore,
  computeAnalytics,
  defaultTypePreferences,
  matchesHistoryFilter,
  renderTemplate,
  resolveChannels,
} from '../notificationPreferencesStore';
import {
  deliverNotification,
  registerChannelTransport,
  clearChannelTransports,
} from '../../services/notificationService';
import type { NotificationChannel, NotificationRecord } from '../../types/notification';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

jest.mock('expo-notifications', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied' },
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied' })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve()),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const store = () => useNotificationPreferencesStore.getState();

const accepted: NotificationChannel[] = [];

const acceptOn = (...channels: NotificationChannel[]) => {
  (['email', 'push', 'sms', 'in_app'] as NotificationChannel[]).forEach((channel) =>
    registerChannelTransport(channel, async () => {
      if (!channels.includes(channel)) return false;
      accepted.push(channel);
      return true;
    })
  );
};

beforeEach(() => {
  accepted.length = 0;
  clearChannelTransports();
  store().resetToDefaults();
  store().clearHistory();
  useNotificationPreferencesStore.setState({ templates: {} });
});

describe('preferences', () => {
  it('defaults each type to the channels its metadata declares', () => {
    const types = defaultTypePreferences();
    expect(types.renewal_reminder.channels).toMatchObject({ push: true, email: true, sms: false });
    expect(types.promotion.channels.email).toBe(true);
    expect(types.promotion.channels.push).toBe(false);
  });

  it('toggles one channel for one type without touching the others', () => {
    store().setChannelPreference('renewal_reminder', 'sms', true);

    expect(store().preferences.types.renewal_reminder.channels.sms).toBe(true);
    expect(store().preferences.types.renewal_reminder.fallbackOrder).toContain('sms');
    expect(store().preferences.types.charge_success.channels.sms).toBe(false);
  });

  it('drops a disabled channel from the fallback order', () => {
    store().setChannelPreference('renewal_reminder', 'email', false);
    expect(store().preferences.types.renewal_reminder.fallbackOrder).not.toContain('email');
  });

  it('keeps a required type reachable on at least one channel', () => {
    store().setChannelPreference('security_alert', 'email', false);
    store().setChannelPreference('security_alert', 'sms', false);
    store().setChannelPreference('security_alert', 'push', false);

    expect(store().preferences.types.security_alert.channels.push).toBe(true);
  });

  it('refuses to mute a required type', () => {
    store().setMuted('charge_failed', true);
    expect(store().preferences.types.charge_failed.muted).toBe(false);

    store().setMuted('promotion', true);
    expect(store().preferences.types.promotion.muted).toBe(true);
  });

  it('ignores unknown channels in a fallback order', () => {
    store().setFallbackOrder('renewal_reminder', [
      'email',
      'carrier_pigeon' as NotificationChannel,
    ]);
    expect(store().preferences.types.renewal_reminder.fallbackOrder).toEqual(['email']);
  });
});

describe('channel resolution', () => {
  it('puts the fallback order first, then any other enabled channel', () => {
    store().setChannelPreference('renewal_reminder', 'sms', true);
    store().setFallbackOrder('renewal_reminder', ['email']);

    const channels = store().channelsFor('renewal_reminder');
    expect(channels[0]).toBe('email');
    expect(channels).toEqual(expect.arrayContaining(['push', 'sms']));
  });

  it('resolves nothing for a muted or opted-out type', () => {
    store().setMuted('promotion', true);
    expect(store().channelsFor('promotion')).toEqual([]);

    store().setMuted('promotion', false);
    // Marketing is opted out by default.
    expect(store().channelsFor('promotion')).toEqual([]);
  });

  it('filters a type below the subscriber minimum priority', () => {
    store().updatePreferences({ minimumPriority: 'critical' });

    expect(store().channelsFor('renewal_reminder')).toEqual([]);
    expect(store().channelsFor('security_alert').length).toBeGreaterThan(0);
  });

  it('keeps a guaranteed route for a required type with every channel off', () => {
    const preferences = store().preferences;
    (['email', 'push', 'sms', 'in_app'] as NotificationChannel[]).forEach((channel) => {
      preferences.types.charge_failed.channels[channel] = false;
    });
    expect(resolveChannels(preferences, 'charge_failed')).toEqual(['push']);
  });
});

describe('templates', () => {
  it('substitutes declared variables and reports the missing ones', () => {
    const rendered = renderTemplate(
      {
        subject: 'Renewal for {{plan}}',
        body: 'We charge {{amount}} on {{date}}.',
        variables: ['plan', 'amount', 'date'],
      },
      { plan: 'Netflix', amount: '$15.99' }
    );

    expect(rendered.subject).toBe('Renewal for Netflix');
    expect(rendered.body).toBe('We charge $15.99 on .');
    expect(rendered.missingVariables).toEqual(['date']);
  });

  it('versions a template on every upsert', () => {
    const first = store().upsertTemplate({
      type: 'renewal_reminder',
      channel: 'email',
      subject: 'Renewal',
      body: 'v1',
      variables: [],
    });
    const second = store().upsertTemplate({
      type: 'renewal_reminder',
      channel: 'email',
      subject: 'Renewal',
      body: 'v2',
      variables: [],
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(store().getTemplate('renewal_reminder', 'email')!.body).toBe('v2');
  });

  it('falls back to the supplied copy when no template exists', () => {
    const rendered = store().renderFor(
      'renewal_reminder',
      'push',
      {},
      { subject: 'Hi', body: 'B' }
    );
    expect(rendered).toMatchObject({ subject: 'Hi', body: 'B' });
  });
});

describe('history and read status', () => {
  const seed = (patch: Partial<NotificationRecord> = {}) =>
    store().recordNotification({
      userId: patch.userId ?? 'me',
      type: patch.type ?? 'renewal_reminder',
      channel: patch.channel ?? 'push',
      title: patch.title ?? 'Renewal soon',
      body: patch.body ?? 'Netflix renews tomorrow.',
      status: patch.status ?? 'delivered',
      createdAt: patch.createdAt ?? '2026-03-01T12:00:00.000Z',
      sentAt: patch.sentAt ?? '2026-03-01T12:00:00.000Z',
    });

  it('filters history by type, channel and status', () => {
    seed({ channel: 'push' });
    seed({ channel: 'email', type: 'charge_success' });
    seed({ status: 'failed' });

    expect(store().getHistory({ channel: 'email' })).toHaveLength(1);
    expect(store().getHistory({ type: 'charge_success' })).toHaveLength(1);
    expect(store().getHistory({ status: 'failed' })).toHaveLength(1);
  });

  it('honours a time window', () => {
    seed({ createdAt: '2026-02-01T00:00:00.000Z' });
    seed({ createdAt: '2026-03-01T00:00:00.000Z' });

    expect(store().getHistory({ since: '2026-02-15T00:00:00.000Z' })).toHaveLength(1);
    expect(store().getHistory({ until: '2026-02-15T00:00:00.000Z' })).toHaveLength(1);
  });

  it('marks a notification read once', () => {
    const record = seed();
    store().markRead(record.id);
    const first = store().getHistory()[0].readAt;
    store().markRead(record.id);

    expect(store().getHistory()[0].readAt).toBe(first);
  });

  it('counts and clears unread notifications', () => {
    seed();
    seed({ channel: 'email' });
    // A suppressed notification was never seen, so it is not "unread".
    seed({ status: 'suppressed' });

    expect(store().unreadCount()).toBe(2);
    expect(store().markAllRead()).toBe(2);
    expect(store().unreadCount()).toBe(0);
    expect(store().markAllRead()).toBe(0);
  });

  it('treats a click as an implicit read', () => {
    const record = seed();
    store().markClicked(record.id);

    const stored = store().getHistory()[0];
    expect(stored.clickedAt).toBeDefined();
    expect(stored.readAt).toBe(stored.clickedAt);
  });

  it('matches a filter the same way the store does', () => {
    const record = seed({ channel: 'sms' });
    expect(matchesHistoryFilter(record, { channel: 'sms' })).toBe(true);
    expect(matchesHistoryFilter(record, { channel: 'email' })).toBe(false);
  });
});

describe('analytics', () => {
  const record = (patch: Partial<NotificationRecord>): NotificationRecord => ({
    id: patch.id ?? 'r1',
    userId: 'me',
    type: patch.type ?? 'renewal_reminder',
    channel: patch.channel ?? 'push',
    title: 't',
    body: 'b',
    status: patch.status ?? 'delivered',
    createdAt: '2026-03-01T12:00:00.000Z',
    sentAt: patch.sentAt,
    readAt: patch.readAt,
    clickedAt: patch.clickedAt,
  });

  it('reports zeroes for an empty history', () => {
    const analytics = computeAnalytics([]);
    expect(analytics.totals.sent).toBe(0);
    expect(analytics.totals.openRate).toBe(0);
    expect(analytics.bestChannel).toBeNull();
  });

  it('computes delivery, open and click rates', () => {
    const analytics = computeAnalytics([
      record({
        id: 'a',
        readAt: '2026-03-01T12:05:00.000Z',
        clickedAt: '2026-03-01T12:05:00.000Z',
      }),
      record({ id: 'b' }),
      record({ id: 'c', status: 'failed' }),
    ]);

    expect(analytics.totals.deliveryRate).toBeCloseTo(2 / 3);
    expect(analytics.totals.openRate).toBe(0.5);
    expect(analytics.totals.clickRate).toBe(0.5);
  });

  it('picks the channel the subscriber opens most', () => {
    const analytics = computeAnalytics([
      record({ id: 'a', channel: 'email', readAt: '2026-03-01T12:05:00.000Z' }),
      record({ id: 'b', channel: 'push' }),
    ]);

    expect(analytics.bestChannel).toBe('email');
  });

  it('averages time to read over read notifications only', () => {
    const analytics = computeAnalytics([
      record({ id: 'a', sentAt: '2026-03-01T12:00:00.000Z', readAt: '2026-03-01T12:02:00.000Z' }),
      record({ id: 'b', sentAt: '2026-03-01T12:00:00.000Z', readAt: '2026-03-01T12:04:00.000Z' }),
      record({ id: 'c', sentAt: '2026-03-01T12:00:00.000Z' }),
    ]);

    expect(analytics.averageTimeToReadMs).toBe(3 * 60 * 1000);
    expect(analytics.unreadCount).toBe(1);
  });
});

describe('multi-channel delivery', () => {
  it('fans out to every enabled channel and records each attempt', async () => {
    acceptOn('push', 'email');

    const result = await deliverNotification({
      type: 'renewal_reminder',
      subject: 'Renewal soon',
      body: 'Netflix renews tomorrow.',
      at: new Date('2026-03-01T12:00:00.000Z'),
    });

    expect(result.delivered.sort()).toEqual(['email', 'push']);
    expect(store().getHistory()).toHaveLength(2);
  });

  it('stops at the first success when asked to', async () => {
    acceptOn('push', 'email');

    const result = await deliverNotification({
      type: 'renewal_reminder',
      firstSuccessOnly: true,
      at: new Date('2026-03-01T12:00:00.000Z'),
    });

    expect(result.delivered).toEqual(['push']);
    expect(accepted).toEqual(['push']);
  });

  it('falls through to the next channel when one refuses', async () => {
    acceptOn('email');

    const result = await deliverNotification({
      type: 'renewal_reminder',
      firstSuccessOnly: true,
      at: new Date('2026-03-01T12:00:00.000Z'),
    });

    expect(result.failed).toEqual(['push']);
    expect(result.delivered).toEqual(['email']);
  });

  it('suppresses rather than drops a muted notification', async () => {
    acceptOn('push', 'email');
    store().setMuted('renewal_reminder', true);

    const result = await deliverNotification({
      type: 'renewal_reminder',
      at: new Date('2026-03-01T12:00:00.000Z'),
    });

    expect(result.delivered).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.records[0].status).toBe('suppressed');
    expect(result.records[0].reason).toMatch(/Muted/);
  });

  it('renders a channel template during delivery', async () => {
    acceptOn('push', 'email');
    store().upsertTemplate({
      type: 'renewal_reminder',
      channel: 'email',
      subject: '{{plan}} renews soon',
      body: 'Full email copy.',
      variables: ['plan'],
    });

    const result = await deliverNotification({
      type: 'renewal_reminder',
      variables: { plan: 'Netflix' },
      subject: 'Renewal soon',
      body: 'Short push copy.',
      at: new Date('2026-03-01T12:00:00.000Z'),
    });

    expect(result.records.find((r) => r.channel === 'email')!.title).toBe('Netflix renews soon');
    expect(result.records.find((r) => r.channel === 'push')!.title).toBe('Renewal soon');
  });

  it('schedules a non-critical notification that lands inside quiet hours', async () => {
    acceptOn('push', 'email');
    store().setQuietHours({ enabled: true, startHour: 22, endHour: 8 });

    const result = await deliverNotification({
      type: 'renewal_reminder',
      at: new Date('2026-03-01T23:30:00.000Z'),
    });

    expect(result.scheduled).toBe(true);
    expect(result.scheduledFor).toBe('2026-03-02T08:00:00.000Z');
    expect(accepted).toEqual([]);
  });

  it('sends a critical notification through quiet hours', async () => {
    acceptOn('push', 'email', 'sms');
    store().setQuietHours({ enabled: true, startHour: 22, endHour: 8 });

    const result = await deliverNotification({
      type: 'security_alert',
      at: new Date('2026-03-01T23:30:00.000Z'),
    });

    expect(result.scheduled).toBe(false);
    expect(result.delivered.length).toBeGreaterThan(0);
  });

  it('records a failure when a channel has no transport', async () => {
    registerChannelTransport('push', async () => true);

    const result = await deliverNotification({
      type: 'renewal_reminder',
      at: new Date('2026-03-01T12:00:00.000Z'),
    });

    expect(result.delivered).toEqual(['push']);
    expect(result.records.find((r) => r.channel === 'email')!.reason).toMatch(/No transport/);
  });
});
