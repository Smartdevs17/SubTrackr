/**
 * Unit tests for digestService.ts
 *
 * Covers:
 *  - daily and weekly window construction
 *  - widening the window when a subscriber's cadence changes
 *  - record selection by window and delivery status
 *  - grouping into sections with an inline limit and overflow count
 *  - subject, plain-text and HTML rendering, including the empty case
 *  - send suppression when digests are off, the address is missing, or the
 *    window is empty
 *  - one subscriber's transport failure not stopping the run
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  DigestEmailService,
  buildDigestWindow,
  windowForSubscriber,
  isWithinWindow,
  selectDigestRecords,
  groupIntoSections,
  renderDigest,
  summariseDigestRun,
  assertValidFrequency,
  DIGEST_INLINE_LIMIT,
  type DigestSection,
  type DigestSubscription,
} from '../digestService';
import { NotificationError } from '../errors';
import type { EmailMessage, EmailResult } from '../emailProvider';
import type { NotificationRecord, NotificationStatus } from '../../../../src/types/notification';

const USER = 'user_1';

// 2026-03-15T12:00:00Z — a fixed instant so windows are deterministic.
const NOW = new Date('2026-03-15T12:00:00.000Z');

const record = (
  id: string,
  createdAt: string,
  status: NotificationStatus = 'delivered',
  type: NotificationRecord['type'] = 'renewal_reminder'
): NotificationRecord => ({
  id,
  userId: USER,
  type,
  channel: type === 'product_update' ? 'in_app' : 'email',
  title: `Title for ${id}`,
  body: '',
  status,
  createdAt,
});

const subscription = (overrides: Partial<DigestSubscription> = {}): DigestSubscription => ({
  userId: USER,
  email: 'user@example.com',
  frequency: 'daily',
  displayName: 'Ada',
  ...overrides,
});

const section = (overrides: Partial<DigestSection> = {}): DigestSection => ({
  type: 'renewal_reminder',
  label: 'renewal reminder',
  items: [
    {
      recordId: 'n1',
      type: 'renewal_reminder',
      label: 'renewal reminder',
      title: 'Netflix renews tomorrow',
      createdAt: '2026-03-14T10:00:00.000Z',
      category: 'renewal_reminder',
    },
  ],
  overflowCount: 0,
  ...overrides,
});

let sent: EmailMessage[];

/** A provider that accepts, recording what it was asked to send. */
const acceptingProvider = (name: 'sendgrid' | 'ses' | 'stub' = 'stub') => ({
  providerName: name,
  send: async (message: EmailMessage): Promise<EmailResult> => {
    sent.push(message);
    return { success: true, messageId: `msg_${sent.length}` };
  },
});

/** A provider that always fails. */
const failingProvider = () => ({
  providerName: 'stub' as const,
  send: async (): Promise<EmailResult> => ({ success: false, error: 'provider unavailable' }),
});

/** A provider that throws instead of returning a result. */
const throwingProvider = () => ({
  providerName: 'stub' as const,
  send: async (): Promise<EmailResult> => {
    throw new Error('socket hang up');
  },
});

const buildService = (
  overrides: Partial<{
    provider: ReturnType<typeof acceptingProvider> | ReturnType<typeof failingProvider> | ReturnType<typeof throwingProvider>;
    subscribers: DigestSubscription[];
    preferences: (userId: string) => { frequency: 'off' | 'daily' | 'weekly'; email?: string; displayName?: string; lastDigestAt?: string };
  }> = {}
) =>
  new DigestEmailService({
    emailProvider: (overrides.provider ?? acceptingProvider()) as never,
    fromAddress: 'hello@subtrackr.app',
    preferences: overrides.preferences ?? (() => ({ frequency: 'daily' })),
    subscribers: () => overrides.subscribers ?? [subscription()],
    now: () => NOW,
  });

beforeEach(() => {
  sent = [];
});

describe('buildDigestWindow', () => {
  it('covers the previous UTC day for a daily digest', () => {
    const window = buildDigestWindow('daily', NOW);
    expect(window.start).toBe('2026-03-14T00:00:00.000Z');
    expect(window.end).toBe('2026-03-15T00:00:00.000Z');
    expect(window.frequency).toBe('daily');
  });

  it('covers seven days for a weekly digest', () => {
    const window = buildDigestWindow('weekly', NOW);
    expect(window.start).toBe('2026-03-08T00:00:00.000Z');
    expect(window.end).toBe('2026-03-15T00:00:00.000Z');
  });

  it('snaps the end to midnight so a run at any hour covers the same day', () => {
    const early = buildDigestWindow('daily', new Date('2026-03-15T00:01:00.000Z'));
    const late = buildDigestWindow('daily', new Date('2026-03-15T23:59:00.000Z'));
    expect(early).toEqual(late);
  });
});

describe('windowForSubscriber', () => {
  it('returns no window when digests are off', () => {
    expect(windowForSubscriber(subscription({ frequency: 'off' }), NOW)).toBeNull();
  });

  it('uses the natural window when the subscriber has never been digested', () => {
    expect(windowForSubscriber(subscription(), NOW)?.start).toBe('2026-03-14T00:00:00.000Z');
  });

  it('moves the start forward to the last digest, so nothing is sent twice', () => {
    const window = windowForSubscriber(
      subscription({ lastDigestAt: '2026-03-14T06:00:00.000Z' }),
      NOW
    );
    expect(window?.start).toBe('2026-03-14T06:00:00.000Z');
  });

  it('widens rather than truncates when the cadence is slowed to weekly', () => {
    const window = windowForSubscriber(
      subscription({ frequency: 'weekly', lastDigestAt: '2026-03-14T00:00:00.000Z' }),
      NOW
    );
    // The natural weekly start is 2026-03-08; a last digest after that must
    // not shrink the window, because the intermediate days were never sent.
    expect(window?.start).toBe('2026-03-08T00:00:00.000Z');
  });

  it('ignores an unparseable last-digest timestamp', () => {
    const window = windowForSubscriber(subscription({ lastDigestAt: 'not-a-date' }), NOW);
    expect(window?.start).toBe('2026-03-14T00:00:00.000Z');
  });
});

describe('isWithinWindow', () => {
  const window = buildDigestWindow('daily', NOW);

  it('includes the start bound', () => {
    expect(isWithinWindow(record('a', '2026-03-14T00:00:00.000Z'), window)).toBe(true);
  });

  it('excludes the end bound', () => {
    expect(isWithinWindow(record('a', '2026-03-15T00:00:00.000Z'), window)).toBe(false);
  });

  it('excludes a record before the window', () => {
    expect(isWithinWindow(record('a', '2026-03-13T23:59:59.999Z'), window)).toBe(false);
  });
});

describe('selectDigestRecords', () => {
  const window = buildDigestWindow('daily', NOW);

  it('keeps delivered, sent and suppressed records inside the window', () => {
    const records = [
      record('a', '2026-03-14T01:00:00.000Z', 'delivered'),
      record('b', '2026-03-14T02:00:00.000Z', 'sent'),
      record('c', '2026-03-14T03:00:00.000Z', 'suppressed'),
    ];
    expect(selectDigestRecords(records, window).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops failed records, which never reached the subscriber', () => {
    const records = [record('a', '2026-03-14T01:00:00.000Z', 'failed')];
    expect(selectDigestRecords(records, window)).toEqual([]);
  });

  it('drops still-scheduled records', () => {
    const records = [record('a', '2026-03-14T01:00:00.000Z', 'scheduled')];
    expect(selectDigestRecords(records, window)).toEqual([]);
  });

  it('returns records oldest first, regardless of input order', () => {
    const records = [
      record('late', '2026-03-14T05:00:00.000Z'),
      record('early', '2026-03-14T01:00:00.000Z'),
    ];
    expect(selectDigestRecords(records, window).map((r) => r.id)).toEqual(['early', 'late']);
  });
});

describe('groupIntoSections', () => {
  it('groups records into one section per type', () => {
    const sections = groupIntoSections([
      record('a', '2026-03-14T01:00:00.000Z', 'delivered', 'renewal_reminder'),
      record('b', '2026-03-14T02:00:00.000Z', 'delivered', 'charge_failed'),
    ]);
    expect(sections.map((s) => s.type)).toEqual(['renewal_reminder', 'charge_failed']);
  });

  it('orders sections by the canonical type order, not first-seen order', () => {
    const sections = groupIntoSections([
      record('a', '2026-03-14T01:00:00.000Z', 'delivered', 'promotion'),
      record('b', '2026-03-14T02:00:00.000Z', 'delivered', 'charge_failed'),
    ]);
    expect(sections.map((s) => s.type)).toEqual(['charge_failed', 'promotion']);
  });

  it('lists the first ten items and counts the rest as overflow', () => {
    const records = Array.from({ length: 13 }, (_, i) =>
      record(`n${i}`, `2026-03-14T01:${String(i).padStart(2, '0')}:00.000Z`)
    );
    const [result] = groupIntoSections(records);
    expect(result.items).toHaveLength(DIGEST_INLINE_LIMIT);
    expect(result.overflowCount).toBe(3);
  });

  it('honours a custom inline limit', () => {
    const records = Array.from({ length: 4 }, (_, i) =>
      record(`n${i}`, `2026-03-14T01:0${i}:00.000Z`)
    );
    const [result] = groupIntoSections(records, 2);
    expect(result.items).toHaveLength(2);
    expect(result.overflowCount).toBe(2);
  });

  it('returns no sections for an empty set', () => {
    expect(groupIntoSections([])).toEqual([]);
  });
});

describe('renderDigest', () => {
  const window = buildDigestWindow('daily', NOW);

  it('counts every item in the subject', () => {
    const { subject } = renderDigest([section()], digestStats(), window);
    expect(subject).toBe('Your SubTrackr today: 1 update');
  });

  it('pluralises the subject for more than one item', () => {
    const items = Array.from({ length: 2 }, (_, i) => ({
      ...section().items[0],
      recordId: `n${i}`,
    }));
    const { subject } = renderDigest([section({ items })], digestStats(), window);
    expect(subject).toBe('Your SubTrackr today: 2 updates');
  });

  it('uses the weekly scope in the subject', () => {
    const { subject } = renderDigest(
      [section()],
      digestStats(),
      buildDigestWindow('weekly', NOW)
    );
    expect(subject).toContain('this week');
  });

  it('greet the subscriber by name when one is known', () => {
    const { text, html } = renderDigest([section()], digestStats(), window, 'Ada');
    expect(text).toContain('Hi Ada,');
    expect(html).toContain('Hi Ada,');
  });

  it('falls back to a bare greeting without a display name', () => {
    const { text } = renderDigest([section()], digestStats(), window);
    expect(text).toContain('Hi,');
  });

  it('lists each section label and item in the plain text', () => {
    const { text } = renderDigest([section()], digestStats(), window);
    expect(text).toContain('RENEWAL REMINDER');
    expect(text).toContain('Netflix renews tomorrow');
  });

  it('summarises overflow in both renderings', () => {
    const rendered = renderDigest([section({ overflowCount: 4 })], digestStats(), window);
    expect(rendered.text).toContain('and 4 more');
    expect(rendered.html).toContain('and 4 more');
  });

  it('escapes HTML in item titles so a subject cannot inject markup', () => {
    const [unsafe] = [section()];
    const rendered = renderDigest(
      [{ ...unsafe, items: [{ ...unsafe.items[0], title: '<script>alert(1)</script>' }] }],
      digestStats(),
      window
    );
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });

  it('mentions muted items so a gap is explained rather than hidden', () => {
    const stats = { ...digestStats(), suppressed: 2 };
    const { text, html } = renderDigest([section()], stats, window);
    expect(text).toContain('2 item(s) were muted');
    expect(html).toContain('2 item(s) were muted');
  });

  it('says so plainly when there is nothing to report', () => {
    const { text, html } = renderDigest([], digestStats(), window);
    expect(text).toContain('No activity to report');
    expect(html).toContain('No activity to report');
  });
});

describe('buildFor', () => {
  it('returns null when the subscriber has digests off', () => {
    expect(buildService().buildFor(subscription({ frequency: 'off' }), [])).toBeNull();
  });

  it('builds sections and totals from the supplied records', () => {
    const digest = buildService().buildFor(
      subscription(),
      [
        record('a', '2026-03-14T01:00:00.000Z', 'delivered', 'renewal_reminder'),
        record('b', '2026-03-14T02:00:00.000Z', 'suppressed', 'promotion'),
      ]
    );
    expect(digest?.sections.map((s) => s.type)).toEqual(['renewal_reminder', 'promotion']);
    expect(digest?.totals.delivered).toBe(1);
    expect(digest?.skippedCount).toBe(1);
  });

  it('records the window the digest covers', () => {
    expect(buildService().buildFor(subscription(), [])?.window.frequency).toBe('daily');
  });
});

describe('sendTo', () => {
  it('sends an email addressed to the subscriber', async () => {
    const service = buildService();
    const result = await service.sendTo(subscription(), [
      record('a', '2026-03-14T01:00:00.000Z'),
    ]);
    expect(result.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual({ email: 'user@example.com' });
    expect(sent[0].from).toEqual({ email: 'hello@subtrackr.app' });
  });

  it('tags the message for provider analytics', async () => {
    const service = buildService();
    await service.sendTo(subscription(), [record('a', '2026-03-14T01:00:00.000Z')]);
    expect(sent[0].tags).toEqual(['digest', 'digest-daily']);
  });

  it('sends both a plain-text and an HTML body', async () => {
    const service = buildService();
    await service.sendTo(subscription(), [record('a', '2026-03-14T01:00:00.000Z')]);
    expect(sent[0].text.length).toBeGreaterThan(0);
    expect(sent[0].html).toContain('<p>');
  });

  it('does not send an empty digest', async () => {
    const result = await buildService().sendTo(subscription(), []);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('No activity in this window');
    expect(sent).toHaveLength(0);
  });

  it('skips a subscriber whose digests are off', async () => {
    const result = await buildService().sendTo(subscription({ frequency: 'off' }), []);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('Digests are turned off');
  });

  it('skips a subscriber with no email address', async () => {
    const result = await buildService().sendTo(subscription({ email: undefined }), [
      record('a', '2026-03-14T01:00:00.000Z'),
    ]);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('No email address on file');
    expect(sent).toHaveLength(0);
  });

  it('reports a provider rejection without throwing', async () => {
    const service = buildService({ provider: failingProvider() });
    const result = await service.sendTo(subscription(), [
      record('a', '2026-03-14T01:00:00.000Z'),
    ]);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('provider unavailable');
  });
});

describe('run', () => {
  it('considers every subscriber once', async () => {
    const summary = await buildService({
      subscribers: [subscription(), subscription({ userId: 'user_2', email: 'b@example.com' })],
    }).run(NOW, () => [record('a', '2026-03-14T01:00:00.000Z')]);
    expect(summary.considered).toBe(2);
    expect(summary.sent).toBe(2);
  });

  it('counts an empty window as skipped rather than failed', async () => {
    const summary = await buildService().run(NOW, () => []);
    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('counts a subscriber with no window as failed', async () => {
    const summary = await buildService({
      subscribers: [subscription({ frequency: 'off' })],
    }).run(NOW, () => []);
    expect(summary.failed).toBe(1);
  });

  it('keeps going when one subscriber has no address', async () => {
    const summary = await buildService({
      subscribers: [subscription(), subscription({ userId: 'user_2', email: undefined })],
    }).run(NOW, () => [record('a', '2026-03-14T01:00:00.000Z')]);
    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it('keeps going when one transport throws', async () => {
    const service = new DigestEmailService({
      emailProvider: throwingProvider() as never,
      fromAddress: 'hello@subtrackr.app',
      preferences: () => ({ frequency: 'daily' }),
      subscribers: () => [subscription()],
      now: () => NOW,
    });
    const summary = await service.run(NOW, () => [record('a', '2026-03-14T01:00:00.000Z')]);
    expect(summary.sent).toBe(0);
    expect(summary.results[0].reason).toBe('socket hang up');
  });

  it('lets a live preference override the subscriber list', async () => {
    const summary = await buildService({
      subscribers: [subscription({ frequency: 'daily' })],
      preferences: () => ({ frequency: 'off' }),
    }).run(NOW, () => [record('a', '2026-03-14T01:00:00.000Z')]);
    expect(summary.sent).toBe(0);
  });

  it('reports the window it covered', async () => {
    const summary = await buildService().run(NOW, () => [
      record('a', '2026-03-14T01:00:00.000Z'),
    ]);
    expect(summary.window.start).toBe('2026-03-14T00:00:00.000Z');
  });

  it('passes each subscriber its own records', async () => {
    const seen: string[] = [];
    const service = buildService({
      subscribers: [subscription(), subscription({ userId: 'user_2', email: 'b@example.com' })],
    });
    await service.run(NOW, (userId) => {
      seen.push(userId);
      return [record('a', '2026-03-14T01:00:00.000Z')];
    });
    expect(seen).toEqual([USER, 'user_2']);
  });
});

describe('summariseDigestRun', () => {
  it('reports one delivery per sent digest', () => {
    const summary = buildSummary();
    const analytics = summariseDigestRun(summary);
    expect(analytics.totals.sent).toBe(1);
    expect(analytics.totals.delivered).toBe(1);
    expect(analytics.bestChannel).toBe('email');
  });

  it('counts a suppressed digest separately from a failure', () => {
    const analytics = summariseDigestRun(buildSummary(false));
    expect(analytics.totals.suppressed).toBe(1);
    expect(analytics.totals.delivered).toBe(0);
  });

  it('has no best channel when nothing was delivered', () => {
    expect(summariseDigestRun(buildSummary(false)).bestChannel).toBeNull();
  });
});

describe('assertValidFrequency', () => {
  it('accepts every documented frequency', () => {
    expect(() => assertValidFrequency('daily')).not.toThrow();
    expect(() => assertValidFrequency('weekly')).not.toThrow();
    expect(() => assertValidFrequency('off')).not.toThrow();
  });

  it('rejects an unknown frequency with a notification error', () => {
    expect(() => assertValidFrequency('hourly')).toThrow(NotificationError);
  });
});

// ─── Helpers ────────────────────────────────────────────────────────

function digestStats() {
  return {
    sent: 0,
    delivered: 0,
    failed: 0,
    suppressed: 0,
    opened: 0,
    clicked: 0,
    deliveryRate: 0,
    openRate: 0,
    clickRate: 0,
  };
}

function buildSummary(sent: boolean = true) {
  const digest = {
    window: buildDigestWindow('daily', NOW),
    subject: 'Your SubTrackr today: 1 update',
    text: 'body',
    html: '<p>body</p>',
    sections: [section()],
    totals: digestStats(),
    skippedCount: 0,
  };
  return {
    window: digest.window,
    considered: 1,
    sent: sent ? 1 : 0,
    skipped: sent ? 0 : 1,
    failed: 0,
    results: [{ userId: USER, sent, digest }] as const,
  };
}
