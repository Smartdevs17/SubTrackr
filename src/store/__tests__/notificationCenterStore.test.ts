/**
 * Unit tests for notificationCenterStore.ts
 *
 * Covers:
 *  - record → entry conversion and the derived label/category/important fields
 *  - day keys and relative headings in the subscriber's timezone
 *  - feed filtering, including dismissed entries and text search
 *  - section grouping by day, by type and ungrouped
 *  - the bell badge, including the cap and the critical count
 *  - retention trimming, which drops read entries before unread ones
 *  - read, click, dismiss and restore, and their idempotence
 *  - ingestion merging, which must not undo a read earned on device
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  useNotificationCenterStore,
  toInboxEntry,
  dayKeyFor,
  relativeDayLabel,
  isVisibleInFeed,
  buildSections,
  buildBadge,
  trimEntries,
  MAX_INBOX_ENTRIES,
  type InboxEntry,
} from '../notificationCenterStore';
import type { NotificationRecord } from '../../types/notification';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const NOW = new Date('2026-03-15T12:00:00.000Z');

const record = (id: string, overrides: Partial<NotificationRecord> = {}): NotificationRecord => ({
  id,
  userId: 'user_1',
  type: 'renewal_reminder',
  channel: 'in_app',
  title: `Title ${id}`,
  body: 'Body text',
  status: 'delivered',
  createdAt: '2026-03-15T08:00:00.000Z',
  ...overrides,
});

const entry = (id: string, overrides: Partial<InboxEntry> = {}): InboxEntry => ({
  id,
  type: 'renewal_reminder',
  channel: 'in_app',
  title: `Title ${id}`,
  body: 'Body text',
  createdAt: '2026-03-15T08:00:00.000Z',
  label: 'Renewal reminders',
  category: 'renewal reminder',
  important: false,
  ...overrides,
});

const store = () => useNotificationCenterStore.getState();

beforeEach(async () => {
  store().clear();
  store().setGrouping('day');
  store().setTimezone('UTC');
  store().ingest([]);
});

describe('toInboxEntry', () => {
  it('copies the fields the feed renders', () => {
    const converted = toInboxEntry(record('n1'));
    expect(converted.id).toBe('n1');
    expect(converted.title).toBe('Title n1');
    expect(converted.createdAt).toBe('2026-03-15T08:00:00.000Z');
  });

  it('denormalises the label from the type metadata', () => {
    expect(toInboxEntry(record('n1')).label).toBe('Renewal reminders');
  });

  it('flattens the type into a category key', () => {
    expect(toInboxEntry(record('n1', { type: 'charge_failed' })).category).toBe('charge failed');
  });

  it('marks a required type as important', () => {
    expect(toInboxEntry(record('n1', { type: 'charge_failed' })).important).toBe(true);
  });

  it('does not mark an optional type as important', () => {
    expect(toInboxEntry(record('n1', { type: 'promotion' })).important).toBe(false);
  });

  it('carries a deep link through from the record data', () => {
    const converted = toInboxEntry(record('n1', { data: { deepLink: '/subscriptions/1' } }));
    expect(converted.deepLink).toBe('/subscriptions/1');
  });
});

describe('dayKeyFor', () => {
  it('uses the supplied timezone', () => {
    expect(dayKeyFor('2026-03-15T02:00:00.000Z', 'UTC')).toBe('2026-03-15');
    expect(dayKeyFor('2026-03-15T02:00:00.000Z', 'Australia/Sydney')).toBe('2026-03-15');
  });

  it('moves an evening instant to the next day ahead of UTC', () => {
    expect(dayKeyFor('2026-03-15T23:30:00.000Z', 'Australia/Sydney')).toBe('2026-03-16');
  });

  it('moves a morning instant to the previous day behind UTC', () => {
    expect(dayKeyFor('2026-03-15T02:00:00.000Z', 'America/Los_Angeles')).toBe('2026-03-14');
  });

  it('accepts a Date as well as a string', () => {
    expect(dayKeyFor(NOW, 'UTC')).toBe('2026-03-15');
  });

  it('falls back to UTC for an invalid timezone instead of throwing', () => {
    expect(dayKeyFor('2026-03-15T08:00:00.000Z', 'Not/AZone')).toBe('2026-03-15');
  });

  it('reports an unparseable instant as unknown', () => {
    expect(dayKeyFor('nonsense', 'UTC')).toBe('unknown');
  });
});

describe('relativeDayLabel', () => {
  it('names today and yesterday in the subscriber timezone', () => {
    expect(relativeDayLabel('2026-03-15', NOW, 'UTC')).toBe('Today');
    expect(relativeDayLabel('2026-03-14', NOW, 'UTC')).toBe('Yesterday');
  });

  it('falls back to an absolute date further back', () => {
    expect(relativeDayLabel('2026-01-05', NOW, 'UTC')).toContain('Jan 5, 2026');
  });

  it('returns an unparseable key unchanged', () => {
    expect(relativeDayLabel('unknown', NOW, 'UTC')).toBe('unknown');
  });
});

describe('isVisibleInFeed', () => {
  it('shows an ordinary entry', () => {
    expect(isVisibleInFeed(entry('a'))).toBe(true);
  });

  it('hides a dismissed entry by default', () => {
    expect(isVisibleInFeed(entry('a', { dismissedAt: '2026-03-15T09:00:00.000Z' }))).toBe(false);
  });

  it('shows a dismissed entry when asked to include them', () => {
    expect(
      isVisibleInFeed(entry('a', { dismissedAt: '2026-03-15T09:00:00.000Z' }), {
        includeDismissed: true,
      })
    ).toBe(true);
  });

  it('filters by type', () => {
    expect(isVisibleInFeed(entry('a'), { type: 'promotion' })).toBe(false);
    expect(isVisibleInFeed(entry('a', { type: 'promotion' }), { type: 'promotion' })).toBe(true);
  });

  it('filters to unread only', () => {
    expect(
      isVisibleInFeed(entry('a', { readAt: '2026-03-15T09:00:00.000Z' }), { unreadOnly: true })
    ).toBe(false);
  });

  it('filters to important only', () => {
    expect(isVisibleInFeed(entry('a'), { importantOnly: true })).toBe(false);
    expect(isVisibleInFeed(entry('a', { important: true }), { importantOnly: true })).toBe(true);
  });

  it('searches the title, body and label', () => {
    expect(isVisibleInFeed(entry('a', { title: 'Netflix renews' }), { query: 'netflix' })).toBe(
      true
    );
    expect(isVisibleInFeed(entry('a', { body: 'card ending 42' }), { query: 'CARD ENDING' })).toBe(
      true
    );
    expect(isVisibleInFeed(entry('a', { label: 'Renewal reminders' }), { query: 'renewal' })).toBe(
      true
    );
    expect(isVisibleInFeed(entry('a'), { query: 'nothing' })).toBe(false);
  });
});

describe('buildSections', () => {
  it('groups by day, newest day first', () => {
    const sections = buildSections(
      [
        entry('a', { createdAt: '2026-03-14T08:00:00.000Z' }),
        entry('b', { createdAt: '2026-03-15T08:00:00.000Z' }),
      ],
      'day',
      NOW,
      'UTC'
    );
    expect(sections.map((s) => s.heading)).toEqual(['Today', 'Yesterday']);
  });

  it('puts every entry from one day in a single section', () => {
    const sections = buildSections(
      [
        entry('a', { createdAt: '2026-03-15T08:00:00.000Z' }),
        entry('b', { createdAt: '2026-03-15T09:00:00.000Z' }),
      ],
      'day',
      NOW,
      'UTC'
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].entries).toHaveLength(2);
  });

  it('counts unread entries per section', () => {
    const sections = buildSections(
      [entry('a'), entry('b', { readAt: '2026-03-15T09:00:00.000Z' })],
      'day',
      NOW,
      'UTC'
    );
    expect(sections[0].unreadCount).toBe(1);
  });

  it('groups by type when asked', () => {
    const sections = buildSections(
      [entry('a', { type: 'renewal_reminder' }), entry('b', { type: 'promotion' })],
      'type',
      NOW,
      'UTC'
    );
    expect(sections.map((s) => s.key)).toEqual(['renewal reminder', 'promotion']);
  });

  it('returns one ungrouped section when grouping is off', () => {
    const sections = buildSections([entry('a'), entry('b')], 'none', NOW, 'UTC');
    expect(sections).toHaveLength(1);
    expect(sections[0].entries).toHaveLength(2);
  });

  it('returns no sections for an empty feed', () => {
    expect(buildSections([], 'day', NOW, 'UTC')).toEqual([]);
  });

  it('orders entries within a section newest first', () => {
    const sections = buildSections(
      [
        entry('old', { createdAt: '2026-03-15T01:00:00.000Z' }),
        entry('new', { createdAt: '2026-03-15T11:00:00.000Z' }),
      ],
      'day',
      NOW,
      'UTC'
    );
    expect(sections[0].entries.map((e) => e.id)).toEqual(['new', 'old']);
  });
});

describe('buildBadge', () => {
  it('reports zero and hides itself on an empty feed', () => {
    expect(buildBadge([])).toMatchObject({ total: 0, unread: 0, visible: false, label: '0' });
  });

  it('counts unread entries', () => {
    const badge = buildBadge([entry('a'), entry('b', { readAt: '2026-03-15T09:00:00.000Z' })]);
    expect(badge.unread).toBe(1);
    expect(badge.visible).toBe(true);
  });

  it('counts important unread entries separately', () => {
    const badge = buildBadge([entry('a', { important: true }), entry('b')]);
    expect(badge.critical).toBe(1);
  });

  it('does not count a dismissed entry as unread', () => {
    const badge = buildBadge([entry('a', { dismissedAt: '2026-03-15T09:00:00.000Z' })]);
    expect(badge.unread).toBe(0);
  });

  it('caps the label', () => {
    const many = Array.from({ length: 120 }, (_, i) => entry(`e${i}`));
    expect(buildBadge(many).label).toBe('99+');
  });

  it('does not cap below the max', () => {
    const many = Array.from({ length: 5 }, (_, i) => entry(`e${i}`));
    expect(buildBadge(many, 99).label).toBe('5');
  });
});

describe('trimEntries', () => {
  it('keeps everything below the limit', () => {
    expect(trimEntries([entry('a'), entry('b')], 5)).toHaveLength(2);
  });

  it('keeps the newest entries', () => {
    const entries = [
      entry('old', { createdAt: '2026-01-01T00:00:00.000Z' }),
      entry('new', { createdAt: '2026-03-15T00:00:00.000Z' }),
    ];
    expect(trimEntries(entries, 1).map((e) => e.id)).toEqual(['new']);
  });

  it('drops a read entry before an unread one', () => {
    const entries = [
      entry('unread', { createdAt: '2026-01-01T00:00:00.000Z' }),
      entry('read', { createdAt: '2026-02-01T00:00:00.000Z', readAt: '2026-02-02T00:00:00.000Z' }),
    ];
    expect(trimEntries(entries, 1).map((e) => e.id)).toEqual(['read']);
  });

  it('fills the remaining room with unread entries when everything is unread', () => {
    const entries = [
      entry('a', { createdAt: '2026-01-01T00:00:00.000Z' }),
      entry('b', { createdAt: '2026-02-01T00:00:00.000Z' }),
    ];
    expect(trimEntries(entries, 1).map((e) => e.id)).toEqual(['b']);
  });

  it('exports a default limit matching the feed cap', () => {
    expect(MAX_INBOX_ENTRIES).toBe(100);
  });
});

describe('ingest', () => {
  it('adds records to the feed', () => {
    store().ingest([record('n1')]);
    expect(store().getFeed()).toHaveLength(1);
    expect(store().getEntry('n1')?.label).toBe('Renewal reminders');
  });

  it('replaces an existing entry with the same id rather than duplicating it', () => {
    store().ingest([record('n1', { title: 'first' })]);
    store().ingest([record('n1', { title: 'second' })]);
    expect(store().getFeed()).toHaveLength(1);
    expect(store().getEntry('n1')?.title).toBe('second');
  });

  it('does not undo a read earned on device', () => {
    store().ingest([record('n1')]);
    store().markRead('n1');
    store().ingest([record('n1')]);
    expect(store().getEntry('n1')?.readAt).toBeTruthy();
  });

  it('does not resurrect a dismissed entry', () => {
    store().ingest([record('n1')]);
    store().dismiss('n1');
    store().ingest([record('n1')]);
    expect(store().getEntry('n1')?.dismissedAt).toBeTruthy();
  });

  it('accepts a batch', () => {
    store().ingest([record('n1'), record('n2'), record('n3')]);
    expect(store().getFeed()).toHaveLength(3);
  });
});

describe('read and click', () => {
  it('marks one entry read', () => {
    store().ingest([record('n1')]);
    store().markRead('n1');
    expect(store().getEntry('n1')?.readAt).toBeTruthy();
  });

  it('keeps the original read timestamp on a second read', () => {
    store().ingest([record('n1')]);
    store().markRead('n1');
    const first = store().getEntry('n1')?.readAt;
    store().markRead('n1');
    expect(store().getEntry('n1')?.readAt).toBe(first);
  });

  it('ignores an unknown entry', () => {
    store().ingest([record('n1')]);
    store().markRead('missing');
    expect(store().getEntry('n1')?.readAt).toBeUndefined();
  });

  it('marks every unread entry read and reports how many', () => {
    store().ingest([record('n1'), record('n2')]);
    expect(store().markAllRead()).toBe(2);
    expect(store().getUnreadCount()).toBe(0);
  });

  it('leaves dismissed entries out of a mark-all-read', () => {
    store().ingest([record('n1')]);
    store().dismiss('n1');
    expect(store().markAllRead()).toBe(0);
  });

  it('treats a click as an implicit read', () => {
    store().ingest([record('n1')]);
    store().markClicked('n1');
    expect(store().getEntry('n1')?.readAt).toBeTruthy();
    expect(store().getEntry('n1')?.clickedAt).toBeTruthy();
  });

  it('keeps the original read timestamp on a later click', () => {
    store().ingest([record('n1')]);
    store().markRead('n1');
    const readAt = store().getEntry('n1')?.readAt;
    store().markClicked('n1');
    expect(store().getEntry('n1')?.readAt).toBe(readAt);
  });
});

describe('dismissal', () => {
  it('hides an entry from the feed without deleting it', () => {
    store().ingest([record('n1')]);
    store().dismiss('n1');
    expect(store().getFeed()).toHaveLength(0);
    expect(store().getEntry('n1')).toBeDefined();
  });

  it('keeps the original dismissal timestamp', () => {
    store().ingest([record('n1')]);
    store().dismiss('n1');
    const first = store().getEntry('n1')?.dismissedAt;
    store().dismiss('n1');
    expect(store().getEntry('n1')?.dismissedAt).toBe(first);
  });

  it('restores a dismissed entry', () => {
    store().ingest([record('n1')]);
    store().dismiss('n1');
    store().restore('n1');
    expect(store().getFeed()).toHaveLength(1);
  });

  it('purges dismissed entries and reports the count', () => {
    store().ingest([record('n1'), record('n2')]);
    store().dismiss('n1');
    expect(store().clearDismissed()).toBe(1);
    expect(store().getFeed()).toHaveLength(1);
  });

  it('does not affect the badge for an entry that was never dismissed', () => {
    store().ingest([record('n1')]);
    expect(store().getBadge().unread).toBe(1);
  });
});

describe('selectors', () => {
  it('returns the whole feed in reverse chronological order', () => {
    store().ingest([
      record('old', { createdAt: '2026-03-14T08:00:00.000Z' }),
      record('new', { createdAt: '2026-03-15T08:00:00.000Z' }),
    ]);
    expect(
      store()
        .getFeed()
        .map((e) => e.id)
    ).toEqual(['new', 'old']);
  });

  it('applies a filter to the feed', () => {
    store().ingest([record('n1', { type: 'promotion' }), record('n2')]);
    expect(
      store()
        .getFeed({ type: 'promotion' })
        .map((e) => e.id)
    ).toEqual(['n1']);
  });

  it('applies the store grouping to sections', () => {
    store().ingest([record('n1', { type: 'promotion' }), record('n2', { type: 'charge_failed' })]);
    store().setGrouping('type');
    expect(
      store()
        .getSections()
        .map((s) => s.key)
    ).toEqual(['charge failed', 'promotion']);
  });

  it('counts categories for a filter chip row, most frequent first', () => {
    store().ingest([
      record('n1', { type: 'renewal_reminder' }),
      record('n2', { type: 'promotion' }),
      record('n3', { type: 'promotion' }),
    ]);
    const categories = store().getCategories();
    expect(categories[0]).toMatchObject({ type: 'promotion', count: 2 });
  });

  it('excludes dismissed entries from the category counts', () => {
    store().ingest([record('n1', { type: 'promotion' })]);
    store().dismiss('n1');
    expect(store().getCategories()).toEqual([]);
  });

  it('returns undefined for an unknown entry', () => {
    expect(store().getEntry('nope')).toBeUndefined();
  });

  it('empties the feed on clear', () => {
    store().ingest([record('n1')]);
    store().clear();
    expect(store().getFeed()).toHaveLength(0);
  });
});
