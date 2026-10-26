/**
 * Issue #1746 — digest batching on the client delivery path.
 *
 * When a subscriber chooses a daily/weekly digest, non-critical notifications
 * are buffered and flushed as one grouped `digest` notification.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { useNotificationPreferencesStore } from '../../store/notificationPreferencesStore';
import {
  deliverNotification,
  registerChannelTransport,
  clearChannelTransports,
  flushDigestNow,
  maybeFlushDueDigest,
  pendingDigestCount,
  resetDigestBuffer,
} from '../notificationService';
import type { NotificationChannel } from '../../types/notification';

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

jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: { isReady: () => false, navigate: jest.fn() },
}));

const store = () => useNotificationPreferencesStore.getState();

const delivered: { channel: NotificationChannel; subject: string; body: string }[] = [];

const acceptAll = () => {
  (['email', 'push', 'sms', 'in_app'] as NotificationChannel[]).forEach((channel) =>
    registerChannelTransport(channel, async ({ subject, body }) => {
      delivered.push({ channel, subject, body });
      return true;
    })
  );
};

beforeEach(() => {
  delivered.length = 0;
  clearChannelTransports();
  store().resetToDefaults();
  store().clearHistory();
  resetDigestBuffer();
  acceptAll();
});

describe('digest batching (#1746)', () => {
  it('buffers non-critical notifications instead of sending them', async () => {
    store().updatePreferences({ digestFrequency: 'daily' });

    const result = await deliverNotification({
      type: 'renewal_reminder',
      subject: 'Netflix renews tomorrow',
      body: 'Your plan goes up to $15.99.',
      at: new Date('2026-03-01T10:00:00.000Z'),
    });

    expect(result.scheduled).toBe(true);
    expect(result.delivered).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].status).toBe('scheduled');
    // Daily digest window: next 09:00 UTC after 10:00 on Mar 1.
    expect(result.scheduledFor).toBe('2026-03-02T09:00:00.000Z');
    expect(pendingDigestCount('me')).toBe(1);
    expect(delivered).toEqual([]);
  });

  it('flushes buffered items as one grouped digest notification', async () => {
    store().updatePreferences({ digestFrequency: 'daily' });

    await deliverNotification({
      type: 'renewal_reminder',
      subject: 'Netflix renews tomorrow',
      body: 'Plan goes up to $15.99.',
      at: new Date('2026-03-01T10:00:00.000Z'),
    });
    await deliverNotification({
      type: 'trial_ending',
      subject: 'Spotify trial ends Friday',
      body: 'You will be charged $10.99.',
      at: new Date('2026-03-01T11:00:00.000Z'),
    });
    expect(pendingDigestCount('me')).toBe(2);

    const flush = await flushDigestNow('me', new Date('2026-03-02T09:00:00.000Z'));

    expect(flush).not.toBeNull();
    expect(flush!.records[0].type).toBe('digest');
    expect(pendingDigestCount('me')).toBe(0);

    // Grouped content: both items appear in the single digest body.
    const digest = delivered.find((d) => d.subject.includes('digest'));
    expect(digest).toBeDefined();
    expect(digest!.subject).toContain('2 updates');
    expect(digest!.body).toContain('Netflix renews tomorrow');
    expect(digest!.body).toContain('Spotify trial ends Friday');
  });

  it('sends critical notifications immediately, bypassing the digest', async () => {
    store().updatePreferences({ digestFrequency: 'daily' });

    const result = await deliverNotification({
      type: 'security_alert',
      subject: 'Suspicious sign-in',
      body: 'New login from Chrome on Windows.',
      at: new Date('2026-03-01T23:30:00.000Z'),
    });

    expect(result.delivered.length).toBeGreaterThan(0);
    expect(result.scheduled).toBe(false);
    expect(pendingDigestCount('me')).toBe(0);
  });

  it('auto-flushes the previous batch once the digest window has passed', async () => {
    store().updatePreferences({ digestFrequency: 'daily' });

    await deliverNotification({
      type: 'renewal_reminder',
      subject: 'Netflix renews tomorrow',
      body: 'Plan goes up to $15.99.',
      at: new Date('2026-03-01T10:00:00.000Z'),
    });
    expect(pendingDigestCount('me')).toBe(1);

    // A later delivery on the other side of the window flushes the old batch.
    await deliverNotification({
      type: 'renewal_reminder',
      subject: 'Hulu renews today',
      body: 'Annual plan.',
      at: new Date('2026-03-03T12:00:00.000Z'),
    });

    // Old batch flushed as a grouped digest; the new item is buffered.
    const digest = delivered.find((d) => d.subject.includes('digest'));
    expect(digest).toBeDefined();
    expect(digest!.body).toContain('Netflix renews tomorrow');
    expect(digest!.body).not.toContain('Hulu renews today');
    expect(pendingDigestCount('me')).toBe(1);
  });

  it('does not buffer when the subscriber wants immediate delivery', async () => {
    // Default digestFrequency is 'immediate'.
    const result = await deliverNotification({
      type: 'renewal_reminder',
      subject: 'Netflix renews tomorrow',
      body: 'Plan goes up to $15.99.',
      at: new Date('2026-03-01T10:00:00.000Z'),
    });

    expect(result.scheduled).toBe(false);
    expect(result.delivered.length).toBeGreaterThan(0);
    expect(pendingDigestCount('me')).toBe(0);
  });

  it('maybeFlushDueDigest is a no-op with an empty buffer', async () => {
    const out = await maybeFlushDueDigest();
    expect(out).toBeNull();
  });

  it('does not batch digest notifications themselves', async () => {
    store().updatePreferences({ digestFrequency: 'daily' });
    await deliverNotification({
      type: 'renewal_reminder',
      subject: 'Netflix renews tomorrow',
      body: 'Plan goes up.',
      at: new Date('2026-03-01T10:00:00.000Z'),
    });
    const flush = await flushDigestNow('me', new Date('2026-03-02T09:00:00.000Z'));

    // The digest went out immediately (was not re-buffered).
    expect(flush!.scheduled).toBe(false);
    expect(flush!.records[0].type).toBe('digest');
    expect(pendingDigestCount('me')).toBe(0);
  });
});
