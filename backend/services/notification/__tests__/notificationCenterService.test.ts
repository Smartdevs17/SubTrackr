/**
 * Unit tests for notificationCenterService.ts
 *
 * Covers:
 *  - preferences per type and per channel, with required-type guards
 *  - multi-channel delivery with fallback ordering
 *  - notification history with read and click status
 *  - engagement analytics (delivery, open and click rates)
 *  - quiet-hours scheduling and the scheduled-queue flush
 *  - templates and variable rendering
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  NotificationCenterService,
  computeAnalytics,
  defaultPreferences,
  isInQuietHours,
  nextDeliveryTime,
  renderTemplate,
  resolveChannels,
  type ChannelTransport,
} from '../notificationCenterService';
import { NotificationError } from '../errors';
import type {
  NotificationChannel,
  NotificationRecord,
} from '../../../../src/types/notification';

const USER = 'user_1';

let clock: Date;
let service: NotificationCenterService;
let accepted: NotificationChannel[];

/** A transport that accepts on the listed channels and refuses elsewhere. */
const transportAccepting =
  (...channels: NotificationChannel[]): ChannelTransport =>
  async ({ channel }) => {
    const ok = channels.includes(channel);
    if (ok) accepted.push(channel);
    return ok;
  };

const registerAll = (transport: ChannelTransport) => {
  (['email', 'push', 'sms', 'in_app'] as NotificationChannel[]).forEach((channel) =>
    service.registerTransport(channel, transport)
  );
};

beforeEach(() => {
  // Noon UTC: outside the default quiet window.
  clock = new Date('2026-03-01T12:00:00.000Z');
  service = new NotificationCenterService(() => clock);
  accepted = [];
});

describe('preferences', () => {
  it('defaults each type to the channels its metadata declares', () => {
    const preferences = defaultPreferences(USER, clock);
    expect(preferences.types.renewal_reminder.channels).toMatchObject({
      push: true,
      email: true,
      sms: false,
    });
    expect(preferences.types.promotion.channels.email).toBe(true);
    expect(preferences.types.promotion.channels.push).toBe(false);
  });

  it('toggles one channel for one type without touching the others', () => {
    service.setChannelPreference(USER, 'renewal_reminder', 'sms', true);
    const preferences = service.getPreferences(USER);

    expect(preferences.types.renewal_reminder.channels.sms).toBe(true);
    expect(preferences.types.renewal_reminder.fallbackOrder).toContain('sms');
    expect(preferences.types.charge_success.channels.sms).toBe(false);
  });

  it('drops a disabled channel from the fallback order', () => {
    service.setChannelPreference(USER, 'renewal_reminder', 'email', false);
    expect(service.getPreferences(USER).types.renewal_reminder.fallbackOrder).not.toContain(
      'email'
    );
  });

  it('keeps a required type reachable on at least one channel', () => {
    service.setChannelPreference(USER, 'security_alert', 'email', false);
    service.setChannelPreference(USER, 'security_alert', 'sms', false);

    expect(() => service.setChannelPreference(USER, 'security_alert', 'push', false)).toThrow(
      NotificationError
    );
    expect(service.getPreferences(USER).types.security_alert.channels.push).toBe(true);
  });

  it('refuses to mute a required type', () => {
    expect(() => service.setMuted(USER, 'charge_failed', true)).toThrow(/cannot be muted/);
    service.setMuted(USER, 'promotion', true);
    expect(service.getPreferences(USER).types.promotion.muted).toBe(true);
  });

  it('rejects an unknown channel in a fallback order', () => {
    expect(() =>
      service.setFallbackOrder(USER, 'renewal_reminder', ['carrier_pigeon' as NotificationChannel])
    ).toThrow(/Unknown notification channel/);
  });
});

describe('channel resolution', () => {
  it('puts the fallback order first, then any other enabled channel', () => {
    service.setChannelPreference(USER, 'renewal_reminder', 'sms', true);
    service.setFallbackOrder(USER, 'renewal_reminder', ['email']);

    const channels = resolveChannels(service.getPreferences(USER), 'renewal_reminder');
    expect(channels[0]).toBe('email');
    expect(channels).toEqual(expect.arrayContaining(['push', 'sms']));
  });

  it('resolves nothing for a muted type', () => {
    service.setMuted(USER, 'promotion', true);
    expect(resolveChannels(service.getPreferences(USER), 'promotion')).toEqual([]);
  });

  it('filters a type below the subscriber minimum priority', () => {
    service.setMinimumPriority(USER, 'critical');
    const preferences = service.getPreferences(USER);

    expect(resolveChannels(preferences, 'promotion')).toEqual([]);
    expect(resolveChannels(preferences, 'renewal_reminder')).toEqual([]);
    // Critical types are never filtered out.
    expect(resolveChannels(preferences, 'security_alert').length).toBeGreaterThan(0);
  });

  it('keeps a guaranteed route for a required type with every channel off', () => {
    const preferences = defaultPreferences(USER, clock);
    (['email', 'push', 'sms', 'in_app'] as NotificationChannel[]).forEach((channel) => {
      preferences.types.charge_failed.channels[channel] = false;
    });
    expect(resolveChannels(preferences, 'charge_failed')).toEqual(['push']);
  });
});

describe('multi-channel delivery', () => {
  it('fans out to every enabled channel', async () => {
    registerAll(transportAccepting('push', 'email'));

    const result = await service.deliver({
      userId: USER,
      type: 'renewal_reminder',
      fallbackSubject: 'Renewal soon',
      fallbackBody: 'Netflix renews tomorrow.',
    });

    expect(result.delivered.sort()).toEqual(['email', 'push']);
    expect(result.failed).toEqual([]);
    expect(result.records).toHaveLength(2);
  });

  it('stops at the first success when asked to', async () => {
    registerAll(transportAccepting('push', 'email'));

    const result = await service.deliver({
      userId: USER,
      type: 'renewal_reminder',
      firstSuccessOnly: true,
    });

    expect(result.delivered).toEqual(['push']);
    expect(accepted).toEqual(['push']);
  });

  it('falls through to the next channel when one refuses', async () => {
    registerAll(transportAccepting('email'));

    const result = await service.deliver({
      userId: USER,
      type: 'renewal_reminder',
      firstSuccessOnly: true,
    });

    expect(result.failed).toEqual(['push']);
    expect(result.delivered).toEqual(['email']);
  });

  it('records a failure when a channel has no transport', async () => {
    service.registerTransport('push', transportAccepting('push'));

    const result = await service.deliver({ userId: USER, type: 'renewal_reminder' });
    expect(result.delivered).toEqual(['push']);
    expect(result.failed).toEqual(['email']);
    expect(result.records.find((r) => r.channel === 'email')?.reason).toMatch(/No transport/);
  });

  it('records a transport that throws as a failure with its message', async () => {
    registerAll(async () => {
      throw new Error('smtp unreachable');
    });

    const result = await service.deliver({ userId: USER, type: 'renewal_reminder' });
    expect(result.delivered).toEqual([]);
    expect(result.records[0].reason).toBe('smtp unreachable');
  });

  it('suppresses rather than drops a muted notification', async () => {
    registerAll(transportAccepting('email'));
    service.setMuted(USER, 'promotion', true);

    const result = await service.deliver({ userId: USER, type: 'promotion' });
    expect(result.delivered).toEqual([]);
    expect(result.suppressed).toEqual(['email']);
    expect(result.records[0].status).toBe('suppressed');
    expect(result.records[0].reason).toMatch(/Muted/);
  });
});

describe('scheduling', () => {
  it('detects a quiet window that wraps midnight', () => {
    const quiet = { enabled: true, startHour: 22, endHour: 8, timezone: 'UTC' };
    expect(isInQuietHours(new Date('2026-03-01T23:00:00.000Z'), quiet)).toBe(true);
    expect(isInQuietHours(new Date('2026-03-01T03:00:00.000Z'), quiet)).toBe(true);
    expect(isInQuietHours(new Date('2026-03-01T12:00:00.000Z'), quiet)).toBe(false);
  });

  it('defers to the end of the quiet window', () => {
    const quiet = { enabled: true, startHour: 22, endHour: 8, timezone: 'UTC' };
    const at = new Date('2026-03-01T23:00:00.000Z');
    expect(nextDeliveryTime(at, quiet).toISOString()).toBe('2026-03-02T08:00:00.000Z');
    // Outside the window nothing moves.
    const noon = new Date('2026-03-01T12:00:00.000Z');
    expect(nextDeliveryTime(noon, quiet)).toBe(noon);
  });

  it('schedules a non-critical notification that lands inside quiet hours', async () => {
    registerAll(transportAccepting('push', 'email'));
    service.setQuietHours(USER, { enabled: true, startHour: 22, endHour: 8 });

    const result = await service.deliver({
      userId: USER,
      type: 'renewal_reminder',
      at: new Date('2026-03-01T23:30:00.000Z'),
    });

    expect(result.scheduled).toBe(true);
    expect(result.scheduledFor).toBe('2026-03-02T08:00:00.000Z');
    expect(result.records.every((r) => r.status === 'scheduled')).toBe(true);
    expect(accepted).toEqual([]);
  });

  it('sends a critical notification through quiet hours', async () => {
    registerAll(transportAccepting('push', 'email', 'sms'));
    service.setQuietHours(USER, { enabled: true, startHour: 22, endHour: 8 });

    const result = await service.deliver({
      userId: USER,
      type: 'security_alert',
      at: new Date('2026-03-01T23:30:00.000Z'),
    });

    expect(result.scheduled).toBe(false);
    expect(result.delivered.length).toBeGreaterThan(0);
  });

  it('flushes scheduled notifications once their time arrives', async () => {
    registerAll(transportAccepting('push', 'email'));
    service.setQuietHours(USER, { enabled: true, startHour: 22, endHour: 8 });
    await service.deliver({
      userId: USER,
      type: 'renewal_reminder',
      at: new Date('2026-03-01T23:30:00.000Z'),
    });

    // Nothing is due before the window ends.
    expect(await service.flushScheduled(new Date('2026-03-02T07:00:00.000Z'))).toHaveLength(0);

    const sent = await service.flushScheduled(new Date('2026-03-02T08:00:00.000Z'));
    expect(sent).toHaveLength(2);
    expect(service.getHistory({ userId: USER, status: 'scheduled' })).toHaveLength(0);
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
    const first = service.upsertTemplate({
      type: 'renewal_reminder',
      channel: 'email',
      subject: 'Renewal',
      body: 'v1',
      variables: [],
    });
    const second = service.upsertTemplate({
      type: 'renewal_reminder',
      channel: 'email',
      subject: 'Renewal',
      body: 'v2',
      variables: [],
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(service.getTemplate('renewal_reminder', 'email')!.body).toBe('v2');
    expect(service.listTemplates('renewal_reminder')).toHaveLength(1);
  });

  it('renders a channel template during delivery, per channel', async () => {
    registerAll(transportAccepting('push', 'email'));
    service.upsertTemplate({
      type: 'renewal_reminder',
      channel: 'email',
      subject: '{{plan}} renews soon',
      body: 'Full email copy for {{plan}}.',
      variables: ['plan'],
    });

    const result = await service.deliver({
      userId: USER,
      type: 'renewal_reminder',
      variables: { plan: 'Netflix' },
      fallbackSubject: 'Renewal soon',
      fallbackBody: 'Short push copy.',
    });

    const email = result.records.find((r) => r.channel === 'email')!;
    const push = result.records.find((r) => r.channel === 'push')!;
    expect(email.title).toBe('Netflix renews soon');
    // Push has no template, so it uses the supplied copy.
    expect(push.title).toBe('Renewal soon');
  });
});

describe('history and read status', () => {
  beforeEach(() => registerAll(transportAccepting('push', 'email')));

  it('records every attempt, newest first', async () => {
    await service.deliver({ userId: USER, type: 'renewal_reminder' });
    const history = service.getHistory({ userId: USER });
    expect(history).toHaveLength(2);
    expect(history.every((record) => record.status === 'delivered')).toBe(true);
  });

  it('filters history by type, channel and status', async () => {
    await service.deliver({ userId: USER, type: 'renewal_reminder' });
    await service.deliver({ userId: USER, type: 'charge_success' });

    expect(service.getHistory({ type: 'charge_success' }).length).toBeGreaterThan(0);
    expect(service.getHistory({ channel: 'email', type: 'renewal_reminder' })).toHaveLength(1);
    expect(service.getHistory({ status: 'failed' })).toHaveLength(1); // in_app has no transport
  });

  it('marks a notification read once', async () => {
    const result = await service.deliver({ userId: USER, type: 'renewal_reminder' });
    const record = result.records[0];

    service.markRead(record.id);
    const firstRead = service.getHistory({ userId: USER }).find((r) => r.id === record.id)!.readAt;
    clock = new Date('2026-03-01T13:00:00.000Z');
    service.markRead(record.id);

    expect(service.getHistory({ userId: USER }).find((r) => r.id === record.id)!.readAt).toBe(
      firstRead
    );
  });

  it('counts and clears unread notifications', async () => {
    await service.deliver({ userId: USER, type: 'renewal_reminder' });
    expect(service.getUnreadCount(USER)).toBe(2);

    expect(service.markAllRead(USER)).toBe(2);
    expect(service.getUnreadCount(USER)).toBe(0);
    // A second pass has nothing left to do.
    expect(service.markAllRead(USER)).toBe(0);
  });

  it('treats a click as an implicit read', async () => {
    const result = await service.deliver({ userId: USER, type: 'renewal_reminder' });
    const record = service.markClicked(result.records[0].id);

    expect(record.clickedAt).toBeDefined();
    expect(record.readAt).toBe(record.clickedAt);
  });

  it('rejects marking an unknown notification', () => {
    expect(() => service.markRead('missing')).toThrow(NotificationError);
  });
});

describe('analytics', () => {
  const record = (patch: Partial<NotificationRecord>): NotificationRecord => ({
    id: patch.id ?? 'r1',
    userId: USER,
    type: patch.type ?? 'renewal_reminder',
    channel: patch.channel ?? 'push',
    title: 't',
    body: 'b',
    status: patch.status ?? 'delivered',
    createdAt: patch.createdAt ?? '2026-03-01T12:00:00.000Z',
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
      record({ id: 'a', readAt: '2026-03-01T12:05:00.000Z', clickedAt: '2026-03-01T12:05:00.000Z' }),
      record({ id: 'b' }),
      record({ id: 'c', status: 'failed' }),
    ]);

    expect(analytics.totals.delivered).toBe(2);
    expect(analytics.totals.failed).toBe(1);
    expect(analytics.totals.deliveryRate).toBeCloseTo(2 / 3);
    expect(analytics.totals.openRate).toBe(0.5);
    expect(analytics.totals.clickRate).toBe(0.5);
  });

  it('excludes suppressed notifications from the delivery rate', () => {
    const analytics = computeAnalytics([
      record({ id: 'a' }),
      record({ id: 'b', status: 'suppressed' }),
    ]);

    expect(analytics.totals.suppressed).toBe(1);
    expect(analytics.totals.sent).toBe(1);
    expect(analytics.totals.deliveryRate).toBe(1);
  });

  it('picks the channel the subscriber opens most', () => {
    const analytics = computeAnalytics([
      record({ id: 'a', channel: 'email', readAt: '2026-03-01T12:05:00.000Z' }),
      record({ id: 'b', channel: 'push' }),
      record({ id: 'c', channel: 'push' }),
    ]);

    expect(analytics.bestChannel).toBe('email');
    expect(analytics.byChannel.email.openRate).toBe(1);
    expect(analytics.byChannel.push.openRate).toBe(0);
  });

  it('averages time to read over read notifications only', () => {
    const analytics = computeAnalytics([
      record({
        id: 'a',
        sentAt: '2026-03-01T12:00:00.000Z',
        readAt: '2026-03-01T12:02:00.000Z',
      }),
      record({
        id: 'b',
        sentAt: '2026-03-01T12:00:00.000Z',
        readAt: '2026-03-01T12:04:00.000Z',
      }),
      record({ id: 'c', sentAt: '2026-03-01T12:00:00.000Z' }),
    ]);

    expect(analytics.averageTimeToReadMs).toBe(3 * 60 * 1000);
    expect(analytics.unreadCount).toBe(1);
  });

  it('partitions counters by type', async () => {
    registerAll(transportAccepting('push', 'email'));
    await service.deliver({ userId: USER, type: 'renewal_reminder' });

    const analytics = service.getAnalytics({ userId: USER });
    expect(analytics.byType.renewal_reminder.delivered).toBe(2);
    expect(analytics.byType.promotion.delivered).toBe(0);
  });
});
