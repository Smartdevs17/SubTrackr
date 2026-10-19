/**
 * In-app notification center.
 *
 * The backend notification service owns delivery; this store is the subscriber's
 * inbox — the feed the bell icon opens. It is separate from
 * `notificationPreferencesStore` because the two answer different questions:
 * that store is about *where* notifications go and holds the full cross-channel
 * history, while this one is only about *reading* the in-app feed, and is the
 * only one the notification badge reads on the hot path.
 *
 * Two decisions worth stating:
 *
 *  - **Grouping is by day, in the subscriber's own timezone.** A digest
 *    summarises by UTC because it is a server-side batch; an inbox is read on a
 *    phone, where "today" is the reader's day, not the server's.
 *  - **Dismissal is not deletion.** A dismissed item is hidden from the feed but
 *    still counts in analytics, so "the subscriber ignored it" stays
 *    distinguishable from "it was never delivered".
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import {
  NOTIFICATION_TYPE_META,
  type NotificationChannel,
  type NotificationRecord,
  type NotificationType,
} from '../types/notification';

const STORAGE_KEY = 'subtrackr-notification-center';

/** Feed entries kept on device. Beyond this the oldest read items are dropped. */
export const MAX_INBOX_ENTRIES = 100;

/** How the badge groups the feed for display. */
export type InboxGrouping = 'day' | 'type' | 'none';

// ─── Types ──────────────────────────────────────────────────────────

/** One notification as the inbox shows it, with the derived fields the UI needs. */
export interface InboxEntry {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  body: string;
  createdAt: string;
  readAt?: string;
  clickedAt?: string;
  /** Hidden from the feed, still counted in analytics. */
  dismissedAt?: string;
  /** Denormalised so the feed does not need `NOTIFICATION_TYPE_META` per row. */
  label: string;
  /** Lowest-case group key for the section heading, e.g. "renewal reminder". */
  category: string;
  /** True for the types the metadata marks as required. */
  important: boolean;
  /** Route to open when the entry is tapped. */
  deepLink?: string;
}

/** A run of entries under one heading. */
export interface InboxSection {
  key: string;
  heading: string;
  entries: InboxEntry[];
  unreadCount: number;
}

export interface InboxFilter {
  type?: NotificationType;
  unreadOnly?: boolean;
  importantOnly?: boolean;
  /** Hide dismissed entries. Defaults to true. */
  includeDismissed?: boolean;
  query?: string;
}

export interface NotificationBadge {
  total: number;
  /** Unread entries the subscriber has not dismissed. */
  unread: number;
  /** Unread entries whose type is marked required. */
  critical: number;
  /** True when the badge should be visible at all. */
  visible: boolean;
  /** Cap used to render a "9+" style badge. */
  label: string;
}

export interface InboxState {
  entries: InboxEntry[];
  grouping: InboxGrouping;
  /** IANA timezone used for day headings. */
  timezone: string;
}

// ─── Pure helpers ───────────────────────────────────────────────────

/** Map a delivery record onto an inbox entry. */
export function toInboxEntry(record: NotificationRecord): InboxEntry {
  const meta = NOTIFICATION_TYPE_META[record.type];
  return {
    id: record.id,
    type: record.type,
    channel: record.channel,
    title: record.title,
    body: record.body,
    createdAt: record.createdAt,
    readAt: record.readAt,
    clickedAt: record.clickedAt,
    dismissedAt: record.data?.dismissedAt,
    label: meta?.label ?? record.type,
    category: record.type.replace(/_/g, ' '),
    important: meta?.required ?? false,
    deepLink: record.data?.deepLink,
  };
}

/**
 * `YYYY-MM-DD` for an instant, in the given timezone.
 *
 * `Intl.DateTimeFormat` with an explicit timeZone is used rather than shifting
 * by an offset, because the offset depends on the instant — a user in
 * `Australia/Sydney` is a day ahead or behind the same UTC instant twice a year.
 */
export function dayKeyFor(instant: string | Date, timezone: string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return 'unknown';

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    // An invalid IANA zone must not break the feed; fall back to UTC.
    return date.toISOString().slice(0, 10);
  }
}

/** "Today" / "Yesterday" / an absolute date, in the subscriber's timezone. */
export function relativeDayLabel(dayKey: string, now: Date, timezone: string): string {
  const today = dayKeyFor(now, timezone);
  const yesterdayDate = new Date(now.getTime() - 86_400_000);
  const yesterday = dayKeyFor(yesterdayDate, timezone);

  if (dayKey === today) return 'Today';
  if (dayKey === yesterday) return 'Yesterday';

  const parsed = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return dayKey;
  return parsed.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** True when the entry should appear in the feed. */
export function isVisibleInFeed(entry: InboxEntry, filter: InboxFilter = {}): boolean {
  if (filter.includeDismissed === false && entry.dismissedAt) return false;
  if (entry.dismissedAt && filter.includeDismissed !== true) return false;
  if (filter.type && entry.type !== filter.type) return false;
  if (filter.importantOnly && !entry.important) return false;
  if (filter.unreadOnly && entry.readAt) return false;
  if (filter.query) {
    const needle = filter.query.toLowerCase();
    const haystack = `${entry.title} ${entry.body} ${entry.label}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** Newest first. */
export function sortEntries(entries: InboxEntry[]): InboxEntry[] {
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Split a feed into display sections.
 *
 * Sections are ordered by their newest entry, so an active day stays at the top
 * regardless of the grouping.
 */
export function buildSections(
  entries: InboxEntry[],
  grouping: InboxGrouping = 'day',
  now: Date = new Date(),
  timezone: string = 'UTC'
): InboxSection[] {
  const sorted = sortEntries(entries);
  if (grouping === 'none') {
    return sorted.length === 0
      ? []
      : [
          {
            key: 'all',
            heading: 'All notifications',
            entries: sorted,
            unreadCount: unreadOf(sorted),
          },
        ];
  }

  const groups = new Map<string, InboxEntry[]>();
  for (const entry of sorted) {
    const key = grouping === 'day' ? dayKeyFor(entry.createdAt, timezone) : entry.category;
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }

  return [...groups.entries()]
    .map(([key, groupEntries]) => ({
      key,
      heading: grouping === 'day' ? relativeDayLabel(key, now, timezone) : key,
      entries: groupEntries,
      unreadCount: unreadOf(groupEntries),
    }))
    .sort((a, b) => (a.entries[0].createdAt < b.entries[0].createdAt ? 1 : -1));
}

function unreadOf(entries: InboxEntry[]): number {
  return entries.filter((entry) => !entry.readAt && !entry.dismissedAt).length;
}

/** The bell badge. `visible` is false so the icon can be hidden when empty. */
export function buildBadge(entries: InboxEntry[], max: number = 99): NotificationBadge {
  const unreadEntries = entries.filter((entry) => !entry.readAt && !entry.dismissedAt);
  const critical = unreadEntries.filter((entry) => entry.important).length;
  const total = unreadEntries.length;

  return {
    total: entries.filter((entry) => !entry.dismissedAt).length,
    unread: total,
    critical,
    visible: total > 0,
    label: total > max ? `${max}+` : String(total),
  };
}

/**
 * Cap the feed, dropping the oldest **read** entries first.
 *
 * Unread entries are never dropped automatically: a notification the subscriber
 * has not seen yet is the one thing the inbox exists to deliver, and losing it
 * to a retention policy is worse than keeping a few extra rows.
 */
export function trimEntries(
  entries: InboxEntry[],
  limit: number = MAX_INBOX_ENTRIES
): InboxEntry[] {
  const sorted = sortEntries(entries);
  if (sorted.length <= limit) return sorted;

  const keep = new Set<string>();
  for (const entry of sorted) {
    if (keep.size >= limit) break;
    keep.add(entry.id);
  }
  for (const entry of sorted) {
    if (keep.size >= limit) break;
    if (!entry.readAt && !entry.dismissedAt) keep.add(entry.id);
  }
  return sorted.filter((entry) => keep.has(entry.id));
}

// ─── Store ──────────────────────────────────────────────────────────

export interface NotificationCenterActions {
  /** Ingest delivery records, replacing any entry with the same id. */
  ingest: (records: NotificationRecord[]) => void;
  add: (entry: InboxEntry) => void;
  markRead: (entryId: string) => void;
  markAllRead: () => number;
  /** Tapping an entry: implies a read and records the tap. */
  markClicked: (entryId: string) => void;
  /** Hide from the feed without deleting. */
  dismiss: (entryId: string) => void;
  restore: (entryId: string) => void;
  clearDismissed: () => number;
  clear: () => void;
  setGrouping: (grouping: InboxGrouping) => void;
  setTimezone: (timezone: string) => void;
}

export type NotificationCenterStore = NotificationCenterState &
  NotificationCenterActions &
  NotificationCenterSelectors;

export interface NotificationCenterState extends InboxState {}

export interface NotificationCenterSelectors {
  /** Visible entries for a filter, newest first. */
  getFeed: (filter?: InboxFilter) => InboxEntry[];
  /** Display sections for a filter. */
  getSections: (filter?: InboxFilter) => InboxSection[];
  /** The bell badge, computed over the whole feed. */
  getBadge: () => NotificationBadge;
  getEntry: (entryId: string) => InboxEntry | undefined;
  getUnreadCount: () => number;
  getCriticalCount: () => number;
  /** Categories present in the feed, for a filter chip row. */
  getCategories: () => Array<{ type: NotificationType; label: string; count: number }>;
}

const nowIso = (): string => new Date().toISOString();

export const useNotificationCenterStore = create<NotificationCenterStore>()(
  persist(
    (set, get) => ({
      entries: [],
      grouping: 'day',
      timezone: 'UTC',

      ingest: (records) =>
        set((state) => {
          const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
          for (const record of records) {
            const incoming = toInboxEntry(record);
            const existing = byId.get(incoming.id);
            // Merge rather than replace so a read state earned on the device
            // is not undone by a fresh copy from the server.
            byId.set(
              incoming.id,
              existing
                ? {
                    ...incoming,
                    readAt: incoming.readAt ?? existing.readAt,
                    dismissedAt: existing.dismissedAt,
                    clickedAt: incoming.clickedAt ?? existing.clickedAt,
                  }
                : incoming
            );
          }
          return { entries: trimEntries([...byId.values()]) };
        }),

      add: (entry) =>
        set((state) => ({
          entries: trimEntries([entry, ...state.entries.filter((e) => e.id !== entry.id)]),
        })),

      markRead: (entryId) =>
        set((state) => ({
          entries: state.entries.map((entry) =>
            entry.id === entryId && !entry.readAt ? { ...entry, readAt: nowIso() } : entry
          ),
        })),

      markAllRead: () => {
        const timestamp = nowIso();
        let count = 0;
        set((state) => ({
          entries: state.entries.map((entry) => {
            if (entry.readAt || entry.dismissedAt) return entry;
            count += 1;
            return { ...entry, readAt: timestamp };
          }),
        }));
        return count;
      },

      markClicked: (entryId) =>
        set((state) => {
          const timestamp = nowIso();
          return {
            entries: state.entries.map((entry) =>
              entry.id === entryId
                ? {
                    ...entry,
                    readAt: entry.readAt ?? timestamp,
                    clickedAt: entry.clickedAt ?? timestamp,
                  }
                : entry
            ),
          };
        }),

      dismiss: (entryId) =>
        set((state) => ({
          entries: state.entries.map((entry) =>
            entry.id === entryId ? { ...entry, dismissedAt: entry.dismissedAt ?? nowIso() } : entry
          ),
        })),

      restore: (entryId) =>
        set((state) => ({
          entries: state.entries.map((entry) =>
            entry.id === entryId ? { ...entry, dismissedAt: undefined } : entry
          ),
        })),

      clearDismissed: () => {
        const before = get().entries.length;
        set((state) => ({ entries: state.entries.filter((entry) => !entry.dismissedAt) }));
        return before - get().entries.length;
      },

      clear: () => set({ entries: [] }),

      setGrouping: (grouping) => set({ grouping }),
      setTimezone: (timezone) => set({ timezone }),

      getFeed: (filter) =>
        sortEntries(get().entries.filter((entry) => isVisibleInFeed(entry, filter))),

      getSections: (filter) =>
        buildSections(
          get().entries.filter((entry) => isVisibleInFeed(entry, filter)),
          get().grouping,
          new Date(),
          get().timezone
        ),

      getBadge: () => buildBadge(get().entries),
      getEntry: (entryId) => get().entries.find((entry) => entry.id === entryId),
      getUnreadCount: () => get().getBadge().unread,
      getCriticalCount: () => get().getBadge().critical,

      getCategories: () => {
        const counts = new Map<NotificationType, number>();
        for (const entry of get().entries) {
          if (entry.dismissedAt) continue;
          counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
        }
        return [...counts.entries()]
          .map(([type, count]) => ({
            type,
            label: NOTIFICATION_TYPE_META[type]?.label ?? type,
            count,
          }))
          .sort((a, b) => b.count - a.count);
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        entries: state.entries,
        grouping: state.grouping,
        timezone: state.timezone,
      }),
      merge: (persistedState, currentState) => {
        if (!persistedState || typeof persistedState !== 'object') return currentState;
        const persisted = persistedState as Partial<NotificationCenterState>;
        return {
          ...currentState,
          ...persisted,
          // A feed persisted by an older build has no derived fields; rebuild
          // them rather than rendering `undefined` labels.
          entries: (persisted.entries ?? []).map((entry) => ({
            ...entry,
            label: entry.label ?? NOTIFICATION_TYPE_META[entry.type]?.label ?? entry.type,
            category: entry.category ?? entry.type.replace(/_/g, ' '),
            important: entry.important ?? NOTIFICATION_TYPE_META[entry.type]?.required ?? false,
          })),
        };
      },
    }
  )
);
