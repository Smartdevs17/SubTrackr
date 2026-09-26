/**
 * Notification center.
 *
 * Subscribers control notifications per type and per channel; the center
 * resolves those preferences into an ordered set of channels, renders the
 * type's template, dispatches through pluggable transports with fallback, and
 * records every attempt in a history that carries read status.
 *
 * Delivery is suppressed rather than dropped silently: a notification the
 * subscriber has muted, or that lands inside quiet hours, is recorded with the
 * reason so analytics can distinguish "not sent" from "sent and ignored".
 */

import { NotificationError, NotificationErrorCode } from './errors';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_META,
  type DeliveryResult,
  type NotificationAnalytics,
  type NotificationChannel,
  type NotificationHistoryFilter,
  type NotificationPriority,
  type NotificationRecord,
  type NotificationStats,
  type NotificationTemplate,
  type NotificationType,
  type RenderedTemplate,
  type TypePreference,
} from '../../../src/types/notification';

/** How many history records are retained per subscriber. */
export const MAX_HISTORY_PER_USER = 500;

const PRIORITY_RANK: Record<NotificationPriority, number> = {
  critical: 0,
  informative: 1,
  marketing: 2,
};

export interface QuietHours {
  enabled: boolean;
  /** 0-23, UTC. */
  startHour: number;
  endHour: number;
  timezone: string;
}

export interface SubscriberNotificationPreferences {
  userId: string;
  types: Record<NotificationType, TypePreference>;
  quietHours: QuietHours;
  /** Lowest priority the subscriber wants to receive at all. */
  minimumPriority: NotificationPriority;
  updatedAt: string;
}

/** Sends one rendered message on one channel. Resolves false on refusal. */
export type ChannelTransport = (input: {
  userId: string;
  channel: NotificationChannel;
  subject: string;
  body: string;
  data?: Record<string, string>;
}) => Promise<boolean>;

export interface DeliverInput {
  userId: string;
  type: NotificationType;
  /** Values substituted into the type's template. */
  variables?: Record<string, string>;
  /** Used when no template is registered for a channel. */
  fallbackSubject?: string;
  fallbackBody?: string;
  data?: Record<string, string>;
  /**
   * Stop after the first channel that accepts, instead of fanning out to every
   * enabled channel. Suits recovery flows where one successful reach is enough.
   */
  firstSuccessOnly?: boolean;
  /** Overrides "now" for scheduling decisions; defaults to the service clock. */
  at?: Date;
}

// ── Defaults ─────────────────────────────────────────────────────────

export function defaultTypePreference(type: NotificationType): TypePreference {
  const meta = NOTIFICATION_TYPE_META[type];
  const channels = NOTIFICATION_CHANNELS.reduce(
    (acc, channel) => {
      acc[channel] = meta.defaultChannels.includes(channel);
      return acc;
    },
    {} as Record<NotificationChannel, boolean>
  );

  return {
    type,
    channels,
    fallbackOrder: [...meta.defaultChannels],
    muted: false,
  };
}

export function defaultPreferences(
  userId: string,
  now: Date = new Date()
): SubscriberNotificationPreferences {
  return {
    userId,
    types: NOTIFICATION_TYPES.reduce(
      (acc, type) => {
        acc[type] = defaultTypePreference(type);
        return acc;
      },
      {} as Record<NotificationType, TypePreference>
    ),
    quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'UTC' },
    minimumPriority: 'informative',
    updatedAt: now.toISOString(),
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────

/**
 * Channels to attempt, in fallback order: the listed order first, then any
 * other enabled channel. Returns empty when the type is muted or filtered out
 * by the subscriber's minimum priority.
 */
export function resolveChannels(
  preferences: SubscriberNotificationPreferences,
  type: NotificationType
): NotificationChannel[] {
  const meta = NOTIFICATION_TYPE_META[type];
  const preference = preferences.types[type] ?? defaultTypePreference(type);

  if (preference.muted && !meta.required) return [];
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

/** True when `date` falls inside the quiet window. */
export function isInQuietHours(date: Date, quietHours: QuietHours): boolean {
  if (!quietHours.enabled) return false;
  const hour = date.getUTCHours();
  return quietHours.startHour < quietHours.endHour
    ? hour >= quietHours.startHour && hour < quietHours.endHour
    : hour >= quietHours.startHour || hour < quietHours.endHour;
}

/** The next moment outside the quiet window, or `date` if already outside. */
export function nextDeliveryTime(date: Date, quietHours: QuietHours): Date {
  if (!isInQuietHours(date, quietHours)) return date;
  const result = new Date(date);
  result.setUTCHours(quietHours.endHour, 0, 0, 0);
  if (result <= date) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
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

function emptyStats(): NotificationStats {
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

    const wasSent = record.status === 'sent' || record.status === 'delivered';
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
    averageTimeToReadMs: readLatencyCount === 0 ? 0 : Math.round(readLatencyTotal / readLatencyCount),
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

// ── Service ──────────────────────────────────────────────────────────

export class NotificationCenterService {
  private preferences = new Map<string, SubscriberNotificationPreferences>();
  private templates = new Map<string, NotificationTemplate>();
  private history: NotificationRecord[] = [];
  private transports = new Map<NotificationChannel, ChannelTransport>();
  private sequence = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  // ── Transports ─────────────────────────────────────────────────────

  /** Register the sender for a channel. Channels with no transport fail. */
  registerTransport(channel: NotificationChannel, transport: ChannelTransport): void {
    this.transports.set(channel, transport);
  }

  // ── Preferences ────────────────────────────────────────────────────

  getPreferences(userId: string): SubscriberNotificationPreferences {
    let preferences = this.preferences.get(userId);
    if (!preferences) {
      preferences = defaultPreferences(userId, this.now());
      this.preferences.set(userId, preferences);
    }
    return preferences;
  }

  /**
   * Turn one channel on or off for one type.
   *
   * A required type must keep at least one channel, so a subscriber can always
   * be reached about money and account security.
   */
  setChannelPreference(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
    enabled: boolean
  ): SubscriberNotificationPreferences {
    const preferences = this.getPreferences(userId);
    const preference = preferences.types[type];
    const meta = NOTIFICATION_TYPE_META[type];

    if (!enabled && meta.required) {
      const remaining = NOTIFICATION_CHANNELS.filter(
        (candidate) => candidate !== channel && preference.channels[candidate]
      );
      if (remaining.length === 0) {
        throw new NotificationError(
          NotificationErrorCode.INVALID_CHANNEL_CONFIG,
          `"${meta.label}" is a required notification and needs at least one channel.`,
          { userId, type, channel }
        );
      }
    }

    const updated: SubscriberNotificationPreferences = {
      ...preferences,
      types: {
        ...preferences.types,
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
      updatedAt: this.now().toISOString(),
    };

    this.preferences.set(userId, updated);
    return updated;
  }

  /** Reorder the channels a type falls back through. */
  setFallbackOrder(
    userId: string,
    type: NotificationType,
    fallbackOrder: NotificationChannel[]
  ): SubscriberNotificationPreferences {
    const preferences = this.getPreferences(userId);
    const unknown = fallbackOrder.filter((channel) => !NOTIFICATION_CHANNELS.includes(channel));
    if (unknown.length > 0) {
      throw new NotificationError(
        NotificationErrorCode.INVALID_CHANNEL_CONFIG,
        `Unknown notification channel(s): ${unknown.join(', ')}.`,
        { userId, type }
      );
    }

    const updated: SubscriberNotificationPreferences = {
      ...preferences,
      types: {
        ...preferences.types,
        [type]: { ...preferences.types[type], fallbackOrder: [...fallbackOrder] },
      },
      updatedAt: this.now().toISOString(),
    };
    this.preferences.set(userId, updated);
    return updated;
  }

  /** Silence a type entirely. Required types cannot be muted. */
  setMuted(
    userId: string,
    type: NotificationType,
    muted: boolean
  ): SubscriberNotificationPreferences {
    const meta = NOTIFICATION_TYPE_META[type];
    if (muted && meta.required) {
      throw new NotificationError(
        NotificationErrorCode.INVALID_CHANNEL_CONFIG,
        `"${meta.label}" cannot be muted.`,
        { userId, type }
      );
    }

    const preferences = this.getPreferences(userId);
    const updated: SubscriberNotificationPreferences = {
      ...preferences,
      types: { ...preferences.types, [type]: { ...preferences.types[type], muted } },
      updatedAt: this.now().toISOString(),
    };
    this.preferences.set(userId, updated);
    return updated;
  }

  setQuietHours(userId: string, patch: Partial<QuietHours>): SubscriberNotificationPreferences {
    const preferences = this.getPreferences(userId);
    const updated: SubscriberNotificationPreferences = {
      ...preferences,
      quietHours: { ...preferences.quietHours, ...patch },
      updatedAt: this.now().toISOString(),
    };
    this.preferences.set(userId, updated);
    return updated;
  }

  setMinimumPriority(
    userId: string,
    minimumPriority: NotificationPriority
  ): SubscriberNotificationPreferences {
    const preferences = this.getPreferences(userId);
    const updated = { ...preferences, minimumPriority, updatedAt: this.now().toISOString() };
    this.preferences.set(userId, updated);
    return updated;
  }

  // ── Templates ──────────────────────────────────────────────────────

  /** Register or replace the template for a (type, channel) pair. */
  upsertTemplate(
    input: Omit<NotificationTemplate, 'id' | 'version' | 'updatedAt'>
  ): NotificationTemplate {
    const id = `${input.type}:${input.channel}`;
    const previous = this.templates.get(id);
    const template: NotificationTemplate = {
      ...input,
      id,
      version: (previous?.version ?? 0) + 1,
      updatedAt: this.now().toISOString(),
    };
    this.templates.set(id, template);
    return template;
  }

  getTemplate(
    type: NotificationType,
    channel: NotificationChannel
  ): NotificationTemplate | undefined {
    return this.templates.get(`${type}:${channel}`);
  }

  listTemplates(type?: NotificationType): NotificationTemplate[] {
    const all = [...this.templates.values()];
    return type ? all.filter((template) => template.type === type) : all;
  }

  /** Render a channel's template, falling back to supplied copy. */
  renderFor(
    type: NotificationType,
    channel: NotificationChannel,
    variables: Record<string, string> = {},
    fallback?: { subject?: string; body?: string }
  ): RenderedTemplate {
    const template = this.getTemplate(type, channel);
    if (!template) {
      return {
        subject: fallback?.subject ?? NOTIFICATION_TYPE_META[type].label,
        body: fallback?.body ?? '',
        missingVariables: [],
      };
    }
    return renderTemplate(template, variables);
  }

  // ── Delivery ───────────────────────────────────────────────────────

  /**
   * Deliver one notification across the subscriber's enabled channels.
   *
   * Non-critical notifications that land inside quiet hours are recorded as
   * `scheduled` for the end of the window rather than sent; critical ones go
   * out immediately.
   */
  async deliver(input: DeliverInput): Promise<DeliveryResult> {
    const meta = NOTIFICATION_TYPE_META[input.type];
    const preferences = this.getPreferences(input.userId);
    const now = input.at ?? this.now();
    const channels = resolveChannels(preferences, input.type);

    const result: DeliveryResult = {
      userId: input.userId,
      type: input.type,
      delivered: [],
      failed: [],
      suppressed: [],
      records: [],
      scheduled: false,
    };

    if (channels.length === 0) {
      const record = this.record({
        userId: input.userId,
        type: input.type,
        channel: meta.defaultChannels[0],
        title: input.fallbackSubject ?? meta.label,
        body: input.fallbackBody ?? '',
        status: 'suppressed',
        createdAt: now.toISOString(),
        reason: preferences.types[input.type]?.muted
          ? 'Muted by the subscriber'
          : 'No channel enabled for this notification type',
        data: input.data,
      });
      result.suppressed.push(record.channel);
      result.records.push(record);
      return result;
    }

    const deferUntil =
      meta.priority === 'critical' ? null : nextDeliveryTime(now, preferences.quietHours);
    const deferred = deferUntil !== null && deferUntil.getTime() !== now.getTime();

    for (const channel of channels) {
      const rendered = this.renderFor(input.type, channel, input.variables, {
        subject: input.fallbackSubject,
        body: input.fallbackBody,
      });

      if (deferred) {
        const record = this.record({
          userId: input.userId,
          type: input.type,
          channel,
          title: rendered.subject,
          body: rendered.body,
          status: 'scheduled',
          createdAt: now.toISOString(),
          scheduledFor: deferUntil!.toISOString(),
          reason: 'Deferred past quiet hours',
          data: input.data,
        });
        result.records.push(record);
        continue;
      }

      const transport = this.transports.get(channel);
      let accepted = false;
      let reason: string | undefined;

      if (!transport) {
        reason = `No transport registered for ${channel}`;
      } else {
        try {
          accepted = await transport({
            userId: input.userId,
            channel,
            subject: rendered.subject,
            body: rendered.body,
            data: input.data,
          });
          if (!accepted) reason = `${channel} transport refused the notification`;
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error);
        }
      }

      const record = this.record({
        userId: input.userId,
        type: input.type,
        channel,
        title: rendered.subject,
        body: rendered.body,
        status: accepted ? 'delivered' : 'failed',
        createdAt: now.toISOString(),
        sentAt: now.toISOString(),
        reason,
        data: input.data,
      });
      result.records.push(record);

      if (accepted) {
        result.delivered.push(channel);
        if (input.firstSuccessOnly) break;
      } else {
        result.failed.push(channel);
      }
    }

    if (deferred) {
      result.scheduled = true;
      result.scheduledFor = deferUntil!.toISOString();
    }

    return result;
  }

  /**
   * Send every notification whose scheduled time has arrived.
   *
   * Returns the records that were delivered, so a caller can report on a
   * drained queue.
   */
  async flushScheduled(at: Date = this.now()): Promise<NotificationRecord[]> {
    const due = this.history.filter(
      (record) =>
        record.status === 'scheduled' &&
        record.scheduledFor !== undefined &&
        new Date(record.scheduledFor) <= at
    );

    const sent: NotificationRecord[] = [];
    for (const record of due) {
      const transport = this.transports.get(record.channel);
      let accepted = false;
      if (transport) {
        try {
          accepted = await transport({
            userId: record.userId,
            channel: record.channel,
            subject: record.title,
            body: record.body,
            data: record.data,
          });
        } catch {
          accepted = false;
        }
      }
      record.status = accepted ? 'delivered' : 'failed';
      record.sentAt = at.toISOString();
      record.reason = accepted
        ? undefined
        : transport
          ? `${record.channel} transport refused the notification`
          : `No transport registered for ${record.channel}`;
      if (accepted) sent.push(record);
    }
    return sent;
  }

  // ── History ────────────────────────────────────────────────────────

  getHistory(filter: NotificationHistoryFilter = {}): NotificationRecord[] {
    return this.history
      .filter((record) => matchesHistoryFilter(record, filter))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Mark one delivered notification as read. Reading twice is a no-op. */
  markRead(recordId: string): NotificationRecord {
    const record = this.requireRecord(recordId);
    if (!record.readAt) record.readAt = this.now().toISOString();
    return record;
  }

  /** Mark every unread notification for a subscriber as read. */
  markAllRead(userId: string): number {
    const timestamp = this.now().toISOString();
    let count = 0;
    for (const record of this.history) {
      if (record.userId !== userId || record.readAt) continue;
      if (record.status !== 'delivered' && record.status !== 'sent') continue;
      record.readAt = timestamp;
      count += 1;
    }
    return count;
  }

  /** Record that the subscriber acted on a notification. Implies a read. */
  markClicked(recordId: string): NotificationRecord {
    const record = this.requireRecord(recordId);
    const timestamp = this.now().toISOString();
    if (!record.readAt) record.readAt = timestamp;
    if (!record.clickedAt) record.clickedAt = timestamp;
    return record;
  }

  getUnreadCount(userId: string): number {
    return this.getHistory({ userId, unreadOnly: true }).filter(
      (record) => record.status === 'delivered' || record.status === 'sent'
    ).length;
  }

  // ── Analytics ──────────────────────────────────────────────────────

  getAnalytics(filter: NotificationHistoryFilter = {}): NotificationAnalytics {
    return computeAnalytics(this.getHistory(filter));
  }

  // ── Internals ──────────────────────────────────────────────────────

  private record(input: Omit<NotificationRecord, 'id'>): NotificationRecord {
    this.sequence += 1;
    const record: NotificationRecord = {
      ...input,
      id: `ntf_${this.sequence.toString(36)}_${input.channel}`,
    };
    this.history.push(record);
    this.trimHistory(input.userId);
    return record;
  }

  private trimHistory(userId: string): void {
    const forUser = this.history.filter((record) => record.userId === userId);
    if (forUser.length <= MAX_HISTORY_PER_USER) return;
    const drop = new Set(
      forUser
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, forUser.length - MAX_HISTORY_PER_USER)
        .map((record) => record.id)
    );
    this.history = this.history.filter((record) => !drop.has(record.id));
  }

  private requireRecord(recordId: string): NotificationRecord {
    const record = this.history.find((candidate) => candidate.id === recordId);
    if (!record) {
      throw new NotificationError(
        NotificationErrorCode.PREFERENCE_NOT_FOUND,
        `Notification ${recordId} not found.`,
        { recordId }
      );
    }
    return record;
  }
}

export const notificationCenterService = new NotificationCenterService();
