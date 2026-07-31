/**
 * Notification preferences, history and analytics.
 *
 * Preferences are held per notification type and per channel, so a subscriber
 * can take renewal reminders by push but payment failures by email and SMS.
 * Every delivery attempt lands in a local history that carries read status,
 * which the analytics selectors turn into open and engagement rates.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import type { OptInCategory, NotificationPriority } from '../services/pushScheduleEngine';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_META,
  type NotificationAnalytics,
  type NotificationChannel,
  type NotificationHistoryFilter,
  type NotificationRecord,
  type NotificationStats,
  type NotificationType,
  type NotificationTemplate,
  type RenderedTemplate,
  type TypePreference,
} from '../types/notification';

const STORAGE_KEY = 'subtrackr-notification-preferences';

/** How many history records are retained on device. */
export const MAX_HISTORY_ENTRIES = 200;

const PRIORITY_RANK: Record<NotificationPriority, number> = {
  critical: 0,
  informative: 1,
  marketing: 2,
};

export interface QuietHoursConfig {
  enabled: boolean;
  startHour: number; // 0-23
  endHour: number; // 0-23
  timezone: string;
}

export interface NotificationPreferences {
  /** Per-category opt-in flags */
  optInCategories: Record<OptInCategory, boolean>;
  /** Per-type, per-channel routing */
  types: Record<NotificationType, TypePreference>;
  /** Digest batching instead of individual pushes */
  digestFrequency: 'immediate' | 'daily' | 'weekly';
  /** Quiet hours configuration */
  quietHours: QuietHoursConfig;
  /** Minimum priority to show: critical-only, informative+, or all */
  minimumPriority: NotificationPriority;
  /** A/B test variant assigned to this user */
  abVariant: 'A' | 'B';
}

// ── Pure helpers ─────────────────────────────────────────────────────

export function defaultTypePreference(type: NotificationType): TypePreference {
  const meta = NOTIFICATION_TYPE_META[type];
  const channels = NOTIFICATION_CHANNELS.reduce(
    (acc, channel) => {
      acc[channel] = meta.defaultChannels.includes(channel);
      return acc;
    },
    {} as Record<NotificationChannel, boolean>
  );

  return { type, channels, fallbackOrder: [...meta.defaultChannels], muted: false };
}

export function defaultTypePreferences(): Record<NotificationType, TypePreference> {
  return NOTIFICATION_TYPES.reduce(
    (acc, type) => {
      acc[type] = defaultTypePreference(type);
      return acc;
    },
    {} as Record<NotificationType, TypePreference>
  );
}

/**
 * Channels to attempt, in fallback order: the listed order first, then any
 * other enabled channel. Empty when the type is muted or filtered out by the
 * subscriber's minimum priority.
 */
export function resolveChannels(
  preferences: NotificationPreferences,
  type: NotificationType
): NotificationChannel[] {
  const meta = NOTIFICATION_TYPE_META[type];
  const preference = preferences.types[type] ?? defaultTypePreference(type);

  if (preference.muted && !meta.required) return [];
  if (!meta.required && !preferences.optInCategories[meta.category]) return [];
  if (!meta.required && PRIORITY_RANK[meta.priority] > PRIORITY_RANK[preferences.minimumPriority]) {
    return [];
  }

  const enabled = NOTIFICATION_CHANNELS.filter((channel) => preference.channels[channel]);
  if (enabled.length === 0) {
    // A required type keeps a guaranteed route even with every channel off.
    return meta.required ? [meta.defaultChannels[0]] : [];
  }

  const ordered = preference.fallbackOrder.filter((channel) => enabled.includes(channel));
  return [...ordered, ...enabled.filter((channel) => !ordered.includes(channel))];
}

/** Substitute `{{variable}}` placeholders, reporting any left unfilled. */
export function renderTemplate(
  template: Pick<NotificationTemplate, 'subject' | 'body' | 'variables'>,
  variables: Record<string, string> = {}
): RenderedTemplate {
  const missingVariables = template.variables.filter(
    (name) => variables[name] === undefined || variables[name] === ''
  );
  const substitute = (text: string): string =>
    text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, name: string) => variables[name] ?? '');

  return {
    subject: substitute(template.subject),
    body: substitute(template.body),
    missingVariables,
  };
}

const emptyStats = (): NotificationStats => ({
  sent: 0,
  delivered: 0,
  failed: 0,
  suppressed: 0,
  opened: 0,
  clicked: 0,
  deliveryRate: 0,
  openRate: 0,
  clickRate: 0,
});

const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

function accumulate(stats: NotificationStats, record: NotificationRecord): void {
  switch (record.status) {
    case 'sent':
    case 'delivered':
      stats.sent += 1;
      stats.delivered += 1;
      break;
    case 'failed':
      stats.sent += 1;
      stats.failed += 1;
      break;
    case 'suppressed':
      stats.suppressed += 1;
      break;
    case 'scheduled':
      break;
  }
  if (record.readAt) stats.opened += 1;
  if (record.clickedAt) stats.clicked += 1;
}

function finalize(stats: NotificationStats): NotificationStats {
  stats.deliveryRate = rate(stats.delivered, stats.delivered + stats.failed);
  stats.openRate = rate(stats.opened, stats.delivered);
  stats.clickRate = rate(stats.clicked, stats.delivered);
  return stats;
}

/** Aggregate delivery and engagement over a set of history records. */
export function computeAnalytics(records: NotificationRecord[]): NotificationAnalytics {
  const totals = emptyStats();
  const byChannel = NOTIFICATION_CHANNELS.reduce(
    (acc, channel) => {
      acc[channel] = emptyStats();
      return acc;
    },
    {} as Record<NotificationChannel, NotificationStats>
  );
  const byType = NOTIFICATION_TYPES.reduce(
    (acc, type) => {
      acc[type] = emptyStats();
      return acc;
    },
    {} as Record<NotificationType, NotificationStats>
  );

  let unreadCount = 0;
  let readLatencyTotal = 0;
  let readLatencyCount = 0;

  for (const record of records) {
    accumulate(totals, record);
    accumulate(byChannel[record.channel], record);
    accumulate(byType[record.type], record);

    const wasSent = record.status === 'delivered' || record.status === 'sent';
    if (wasSent && !record.readAt) unreadCount += 1;
    if (record.readAt && record.sentAt) {
      readLatencyTotal += new Date(record.readAt).getTime() - new Date(record.sentAt).getTime();
      readLatencyCount += 1;
    }
  }

  finalize(totals);
  NOTIFICATION_CHANNELS.forEach((channel) => finalize(byChannel[channel]));
  NOTIFICATION_TYPES.forEach((type) => finalize(byType[type]));

  const bestChannel =
    NOTIFICATION_CHANNELS.filter((channel) => byChannel[channel].delivered > 0).sort(
      (a, b) => byChannel[b].openRate - byChannel[a].openRate
    )[0] ?? null;

  return {
    totals,
    byChannel,
    byType,
    unreadCount,
    averageTimeToReadMs:
      readLatencyCount === 0 ? 0 : Math.round(readLatencyTotal / readLatencyCount),
    bestChannel,
  };
}

export function matchesHistoryFilter(
  record: NotificationRecord,
  filter: NotificationHistoryFilter
): boolean {
  if (filter.userId && record.userId !== filter.userId) return false;
  if (filter.type && record.type !== filter.type) return false;
  if (filter.channel && record.channel !== filter.channel) return false;
  if (filter.status && record.status !== filter.status) return false;
  if (filter.unreadOnly && record.readAt) return false;
  if (filter.since && record.createdAt < filter.since) return false;
  if (filter.until && record.createdAt >= filter.until) return false;
  return true;
}

// ── Store ────────────────────────────────────────────────────────────

interface NotificationPreferencesState {
  preferences: NotificationPreferences;
  history: NotificationRecord[];
  templates: Record<string, NotificationTemplate>;

  // Preferences
  updatePreferences: (patch: Partial<NotificationPreferences>) => void;
  toggleCategory: (category: OptInCategory) => void;
  setQuietHours: (qh: Partial<QuietHoursConfig>) => void;
  setChannelPreference: (
    type: NotificationType,
    channel: NotificationChannel,
    enabled: boolean
  ) => void;
  setFallbackOrder: (type: NotificationType, fallbackOrder: NotificationChannel[]) => void;
  setMuted: (type: NotificationType, muted: boolean) => void;
  channelsFor: (type: NotificationType) => NotificationChannel[];
  resetToDefaults: () => void;

  // Templates
  upsertTemplate: (
    input: Omit<NotificationTemplate, 'id' | 'version' | 'updatedAt'>
  ) => NotificationTemplate;
  getTemplate: (
    type: NotificationType,
    channel: NotificationChannel
  ) => NotificationTemplate | undefined;
  renderFor: (
    type: NotificationType,
    channel: NotificationChannel,
    variables?: Record<string, string>,
    fallback?: { subject?: string; body?: string }
  ) => RenderedTemplate;

  // History
  recordNotification: (record: Omit<NotificationRecord, 'id'>) => NotificationRecord;
  getHistory: (filter?: NotificationHistoryFilter) => NotificationRecord[];
  markRead: (recordId: string) => void;
  markAllRead: (userId?: string) => number;
  markClicked: (recordId: string) => void;
  unreadCount: (userId?: string) => number;
  clearHistory: () => void;

  // Analytics
  analytics: (filter?: NotificationHistoryFilter) => NotificationAnalytics;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  optInCategories: {
    billing: true,
    product: true,
    marketing: false,
    security: true,
  },
  types: defaultTypePreferences(),
  digestFrequency: 'immediate',
  quietHours: {
    enabled: false,
    startHour: 22,
    endHour: 8,
    timezone: 'UTC',
  },
  minimumPriority: 'informative',
  abVariant: Math.random() < 0.5 ? 'A' : 'B',
};

let recordSequence = 0;
const generateRecordId = (channel: NotificationChannel): string => {
  recordSequence += 1;
  return `ntf_${Date.now().toString(36)}_${recordSequence.toString(36)}_${channel}`;
};

export const useNotificationPreferencesStore = create<NotificationPreferencesState>()(
  persist(
    (set, get) => ({
      preferences: DEFAULT_PREFERENCES,
      history: [],
      templates: {},

      // ── Preferences ──────────────────────────────────────────────

      updatePreferences: (patch) =>
        set((state) => ({
          preferences: { ...state.preferences, ...patch },
        })),

      toggleCategory: (category) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            optInCategories: {
              ...state.preferences.optInCategories,
              [category]: !state.preferences.optInCategories[category],
            },
          },
        })),

      setQuietHours: (qh) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            quietHours: { ...state.preferences.quietHours, ...qh },
          },
        })),

      setChannelPreference: (type, channel, enabled) => {
        const meta = NOTIFICATION_TYPE_META[type];
        const preference = get().preferences.types[type] ?? defaultTypePreference(type);

        // A required type must stay reachable on at least one channel.
        if (!enabled && meta.required) {
          const remaining = NOTIFICATION_CHANNELS.filter(
            (candidate) => candidate !== channel && preference.channels[candidate]
          );
          if (remaining.length === 0) return;
        }

        set((state) => ({
          preferences: {
            ...state.preferences,
            types: {
              ...state.preferences.types,
              [type]: {
                ...preference,
                channels: { ...preference.channels, [channel]: enabled },
                fallbackOrder: enabled
                  ? preference.fallbackOrder.includes(channel)
                    ? preference.fallbackOrder
                    : [...preference.fallbackOrder, channel]
                  : preference.fallbackOrder.filter((c) => c !== channel),
              },
            },
          },
        }));
      },

      setFallbackOrder: (type, fallbackOrder) =>
        set((state) => {
          const preference = state.preferences.types[type] ?? defaultTypePreference(type);
          return {
            preferences: {
              ...state.preferences,
              types: {
                ...state.preferences.types,
                [type]: {
                  ...preference,
                  fallbackOrder: fallbackOrder.filter((channel) =>
                    NOTIFICATION_CHANNELS.includes(channel)
                  ),
                },
              },
            },
          };
        }),

      setMuted: (type, muted) => {
        // Required types cannot be silenced.
        if (muted && NOTIFICATION_TYPE_META[type].required) return;
        set((state) => {
          const preference = state.preferences.types[type] ?? defaultTypePreference(type);
          return {
            preferences: {
              ...state.preferences,
              types: { ...state.preferences.types, [type]: { ...preference, muted } },
            },
          };
        });
      },

      channelsFor: (type) => resolveChannels(get().preferences, type),

      resetToDefaults: () =>
        set({ preferences: { ...DEFAULT_PREFERENCES, types: defaultTypePreferences() } }),

      // ── Templates ────────────────────────────────────────────────

      upsertTemplate: (input) => {
        const id = `${input.type}:${input.channel}`;
        const previous = get().templates[id];
        const template: NotificationTemplate = {
          ...input,
          id,
          version: (previous?.version ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({ templates: { ...state.templates, [id]: template } }));
        return template;
      },

      getTemplate: (type, channel) => get().templates[`${type}:${channel}`],

      renderFor: (type, channel, variables = {}, fallback) => {
        const template = get().templates[`${type}:${channel}`];
        if (!template) {
          return {
            subject: fallback?.subject ?? NOTIFICATION_TYPE_META[type].label,
            body: fallback?.body ?? '',
            missingVariables: [],
          };
        }
        return renderTemplate(template, variables);
      },

      // ── History ──────────────────────────────────────────────────

      recordNotification: (input) => {
        const record: NotificationRecord = { ...input, id: generateRecordId(input.channel) };
        set((state) => ({ history: [record, ...state.history].slice(0, MAX_HISTORY_ENTRIES) }));
        return record;
      },

      getHistory: (filter = {}) =>
        get()
          .history.filter((record) => matchesHistoryFilter(record, filter))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),

      markRead: (recordId) =>
        set((state) => ({
          history: state.history.map((record) =>
            record.id === recordId && !record.readAt
              ? { ...record, readAt: new Date().toISOString() }
              : record
          ),
        })),

      markAllRead: (userId) => {
        const timestamp = new Date().toISOString();
        let count = 0;
        set((state) => ({
          history: state.history.map((record) => {
            if (userId && record.userId !== userId) return record;
            if (record.readAt) return record;
            if (record.status !== 'delivered' && record.status !== 'sent') return record;
            count += 1;
            return { ...record, readAt: timestamp };
          }),
        }));
        return count;
      },

      markClicked: (recordId) =>
        set((state) => ({
          history: state.history.map((record) => {
            if (record.id !== recordId) return record;
            const timestamp = new Date().toISOString();
            return {
              ...record,
              readAt: record.readAt ?? timestamp,
              clickedAt: record.clickedAt ?? timestamp,
            };
          }),
        })),

      unreadCount: (userId) =>
        get()
          .getHistory({ userId, unreadOnly: true })
          .filter((record) => record.status === 'delivered' || record.status === 'sent').length,

      clearHistory: () => set({ history: [] }),

      // ── Analytics ────────────────────────────────────────────────

      analytics: (filter = {}) => computeAnalytics(get().getHistory(filter)),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        preferences: state.preferences,
        history: state.history,
        templates: state.templates,
      }),
      merge: (persistedState: unknown, currentState) => {
        if (!persistedState || typeof persistedState !== 'object') return currentState;
        const persisted = persistedState as Partial<NotificationPreferencesState>;
        return {
          ...currentState,
          ...persisted,
          preferences: {
            ...currentState.preferences,
            ...(persisted.preferences ?? {}),
            // Preferences persisted before per-type routing existed have no
            // `types` map, so fall back to defaults rather than crashing.
            types: {
              ...defaultTypePreferences(),
              ...(persisted.preferences?.types ?? {}),
            },
          },
        };
      },
    }
  )
);
