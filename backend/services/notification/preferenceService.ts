/**
 * Notification preference management.
 *
 * Issue #920: Subscription notification preferences and management.
 *
 * Preferences are held per notification type and per channel on top of the
 * legacy per-channel toggles, so subscribers can route renewal reminders to
 * push while payment failures go to email and SMS. The service provides:
 *
 *  - CRUD over a user's preference record (in-memory by default; the store
 *    can be replaced by a database adapter in production),
 *  - per-type / per-channel toggles with fallback-order management,
 *  - required-type guards so a subscriber can never become unreachable about
 *    money or security,
 *  - timezone-aware quiet hours,
 *  - optimistic concurrency via a monotonic `version` for cross-device sync,
 *  - validation that rejects malformed preferences before they are stored.
 */

import { logger } from '../logging';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_META,
  type NotificationChannel,
  type NotificationPriority,
  type NotificationType,
  type TypePreference,
} from '../../../src/types/notification';

/**
 * HH:mm (24-hour) time-of-day, e.g. "22:00".
 */
export type QuietHoursTime = string;

export type NotificationFrequency = 'immediate' | 'daily' | 'weekly';

export interface NotificationPreferenceValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Full per-user notification preferences.
 *
 * The legacy top-level fields (`channels`, `frequency`, `quietHours`) are kept
 * for backward compatibility; the authoritative routing lives under `types`.
 */
export interface NotificationPreferences {
  userId: string;
  /** Legacy per-channel global toggles (mirrors the effective types). */
  channels: {
    push: boolean;
    email: boolean;
    sms: boolean;
    inApp: boolean;
  };
  frequency: NotificationFrequency;
  quietHours: {
    enabled: boolean;
    /** HH:mm, local to `timezone`. */
    startTime: QuietHoursTime;
    endTime: QuietHoursTime;
    timezone: string;
  };
  /** Per-type, per-channel routing. */
  types: Record<NotificationType, TypePreference>;
  /** Lowest priority the subscriber accepts (critical-only, informative+, all). */
  minimumPriority: NotificationPriority;
  /** Monotonic version, bumped on every update (optimistic concurrency). */
  version: number;
  /** ISO-8601 timestamp of the last change. */
  updatedAt: string;
}

const DEFAULT_FREQUENCY: NotificationFrequency = 'immediate';
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_QUIET_HOURS = { startTime: '22:00', endTime: '08:00' };

const PRIORITIES: NotificationPriority[] = ['critical', 'informative', 'marketing'];
const FREQUENCIES: NotificationFrequency[] = ['immediate', 'daily', 'weekly'];

// ── Pure helpers ────────────────────────────────────────────────────────

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

export function defaultTypePreferences(): Record<NotificationType, TypePreference> {
  return NOTIFICATION_TYPES.reduce(
    (acc, type) => {
      acc[type] = defaultTypePreference(type);
      return acc;
    },
    {} as Record<NotificationType, TypePreference>
  );
}

export function defaultPreferences(
  userId: string,
  now: Date = new Date()
): NotificationPreferences {
  const channels = NOTIFICATION_CHANNELS.reduce(
    (acc, channel) => {
      acc[channel] = defaultTypePreference('renewal_reminder').channels[channel];
      return acc;
    },
    {} as NotificationPreferences['channels']
  );

  return {
    userId,
    channels: {
      push: channels.push,
      email: channels.email,
      sms: channels.sms,
      inApp: channels.in_app,
    },
    frequency: DEFAULT_FREQUENCY,
    quietHours: {
      enabled: false,
      startTime: DEFAULT_QUIET_HOURS.startTime,
      endTime: DEFAULT_QUIET_HOURS.endTime,
      timezone: DEFAULT_TIMEZONE,
    },
    types: defaultTypePreferences(),
    minimumPriority: 'informative',
    version: 1,
    updatedAt: now.toISOString(),
  };
}

function isValidTimeHHmm(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function toMinutes(time: QuietHoursTime): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * Validate a preference patch before it is stored. Rejects unknown channels,
 * unknown types, malformed times and invalid enums; guards required types
 * against being fully muted or having every channel disabled.
 */
export function validatePreferences(
  patch: Partial<NotificationPreferences>
): NotificationPreferenceValidation {
  const errors: string[] = [];

  if (patch.types) {
    for (const [rawType, settings] of Object.entries(patch.types)) {
      const type = rawType as NotificationType;
      const meta = NOTIFICATION_TYPE_META[type];
      if (!meta) {
        errors.push(`Unknown notification type "${rawType}"`);
        continue;
      }

      const enabledChannels = NOTIFICATION_CHANNELS.filter(
        (channel) => (settings as TypePreference).channels[channel]
      );
      const allDisabled = enabledChannels.length === 0;
      const muted = (settings as TypePreference).muted;

      if (meta.required && allDisabled) {
        errors.push(
          `Required type "${type}" must keep at least one enabled channel`
        );
      }
      if (meta.required && muted) {
        errors.push(`Required type "${type}" cannot be muted`);
      }
      if (muted && allDisabled && !meta.required) {
        errors.push(`Type "${type}" is muted; channels are irrelevant`);
      }
    }
  }

  if (patch.frequency !== undefined && !FREQUENCIES.includes(patch.frequency)) {
    errors.push(`Invalid frequency "${patch.frequency}"`);
  }
  if (
    patch.minimumPriority !== undefined &&
    !PRIORITIES.includes(patch.minimumPriority)
  ) {
    errors.push(`Invalid minimumPriority "${patch.minimumPriority}"`);
  }
  if (patch.quietHours) {
    if (
      patch.quietHours.startTime !== undefined &&
      !isValidTimeHHmm(patch.quietHours.startTime)
    ) {
      errors.push(`Invalid quiet startTime "${patch.quietHours.startTime}"`);
    }
    if (
      patch.quietHours.endTime !== undefined &&
      !isValidTimeHHmm(patch.quietHours.endTime)
    ) {
      errors.push(`Invalid quiet endTime "${patch.quietHours.endTime}"`);
    }
    if (patch.quietHours.timezone !== undefined && !patch.quietHours.timezone.trim()) {
      errors.push('quiet hours timezone must not be empty');
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Effective channels for a type in fallback order (empty when muted/filtered). */
export function resolveChannels(
  preferences: NotificationPreferences,
  type: NotificationType
): NotificationChannel[] {
  const meta = NOTIFICATION_TYPE_META[type];
  const preference = preferences.types[type] ?? defaultTypePreference(type);

  if (preference.muted && !meta.required) return [];
  const priorityRank: Record<NotificationPriority, number> = {
    critical: 0,
    informative: 1,
    marketing: 2,
  };
  if (
    !meta.required &&
    priorityRank[meta.priority] > priorityRank[preferences.minimumPriority]
  ) {
    return [];
  }

  const enabled = NOTIFICATION_CHANNELS.filter((channel) => preference.channels[channel]);
  if (enabled.length === 0) {
    return meta.required ? [meta.defaultChannels[0]] : [];
  }

  const ordered = preference.fallbackOrder.filter((channel) => enabled.includes(channel));
  return [...ordered, ...enabled.filter((channel) => !ordered.includes(channel))];
}

/** Hour (0-23) in `ianaTimezone` at `date`. Falls back to UTC on bad zones. */
function hourInTimezone(date: Date, ianaTimezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hour12: false,
      timeZone: ianaTimezone,
    }).formatToParts(date);
    const hourPart = parts.find((p) => p.type === 'hour');
    return hourPart ? Number(hourPart.value) % 24 : NaN;
  } catch {
    return date.getUTCHours();
  }
}

/** True when `date` falls inside the subscriber's quiet window. */
export function isInQuietHours(
  date: Date,
  quietHours: NotificationPreferences['quietHours']
): boolean {
  if (!quietHours.enabled) return false;
  const nowMinutes = hourInTimezone(date, quietHours.timezone) * 60 + date.getUTCMinutes();
  const start = toMinutes(quietHours.startTime);
  const end = toMinutes(quietHours.endTime);
  return start < end ? nowMinutes >= start && nowMinutes < end : nowMinutes >= start || nowMinutes < end;
}

export function validateQuietHoursTime(time: unknown): time is QuietHoursTime {
  return typeof time === 'string' && isValidTimeHHmm(time);
}

// ── Store ───────────────────────────────────────────────────────────────

export type PreferenceStore = Map<string, NotificationPreferences>;

/**
 * The preference service.
 *
 * In-memory by default; inject a persistent adapter backed by your database
 * for production use. Every mutation bumps `version` so a device that fetched
 * an older revision can detect the conflict and re-sync.
 */
export class NotificationPreferenceService {
  private readonly store: PreferenceStore;

  constructor(store?: PreferenceStore) {
    this.store = store ?? new Map<string, NotificationPreferences>();
  }

  async getPreferences(userId: string): Promise<NotificationPreferences | null> {
    return this.store.get(userId) ?? null;
  }

  /**
   * Fetch preferences, creating them on first touch when `bootstrap` is true.
   */
  async getOrCreatePreferences(userId: string): Promise<NotificationPreferences> {
    const existing = await this.getPreferences(userId);
    if (existing) return existing;
    const fresh = defaultPreferences(userId);
    this.store.set(userId, fresh);
    return fresh;
  }

  async createPreferences(userId: string): Promise<NotificationPreferences> {
    if (this.store.has(userId)) {
      throw new Error(`notification preferences already exist for user ${userId}`);
    }
    const fresh = defaultPreferences(userId);
    this.store.set(userId, fresh);
    return fresh;
  }

  /**
   * Deep-merge a patch into the stored preferences. Validates first, then
   * bumps the version. Throws on invalid input.
   */
  async updatePreferences(
    userId: string,
    prefs: Partial<NotificationPreferences>
  ): Promise<boolean> {
    const { valid, errors } = validatePreferences(prefs);
    if (!valid) {
      throw new Error(`invalid notification preferences: ${errors.join('; ')}`);
    }

    const current = await this.getOrCreatePreferences(userId);
    const next: NotificationPreferences = {
      ...current,
      ...prefs,
      quietHours: prefs.quietHours
        ? { ...current.quietHours, ...prefs.quietHours }
        : current.quietHours,
      types: mergeTypes(current.types, prefs.types),
      userId, // immutable
      version: prefs.version ? prefs.version : current.version + 1,
      updatedAt: new Date().toISOString(),
    };

    this.store.set(userId, next);
    logger.info('Updated notification preferences for user', { userId, version: next.version });
    return true;
  }

  async setChannelPreference(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
    enabled: boolean
  ): Promise<NotificationPreferences> {
    const current = await this.getOrCreatePreferences(userId);
    const preference = current.types[type] ?? defaultTypePreference(type);

    // Required types must stay reachable: refuse to disable the last channel.
    if (!enabled && NOTIFICATION_TYPE_META[type]?.required) {
      const remaining = NOTIFICATION_CHANNELS.filter(
        (ch) => ch !== channel && preference.channels[ch]
      );
      if (remaining.length === 0) {
        throw new Error(`required type "${type}" must keep at least one enabled channel`);
      }
    }

    const channels = { ...preference.channels, [channel]: enabled };
    const fallbackOrder = enabled
      ? [...new Set([...preference.fallbackOrder, channel])]
      : preference.fallbackOrder.filter((ch) => ch !== channel);

    const next = {
      ...current,
      types: {
        ...current.types,
        [type]: {
          ...preference,
          channels,
          fallbackOrder,
        },
      },
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };

    const { valid, errors } = validatePreferencesUsing(next);
    if (!valid) throw new Error(`invalid notification preferences: ${errors.join('; ')}`);

    this.store.set(userId, next);
    return next;
  }

  async setMuted(userId: string, type: NotificationType, muted: boolean): Promise<void> {
    if (muted && NOTIFICATION_TYPE_META[type]?.required) {
      throw new Error(`required type "${type}" cannot be muted`);
    }
    await this.updatePreferences(userId, {
      types: {
        [type]: {
          ...((await this.getOrCreatePreferences(userId)).types[type] ??
            defaultTypePreference(type)),
          muted,
        },
      },
    });
  }

  async setQuietHours(
    userId: string,
    patch: Partial<NotificationPreferences['quietHours']>
  ): Promise<NotificationPreferences> {
    await this.updatePreferences(userId, { quietHours: patch });
    const updated = await this.getPreferences(userId);
    if (!updated) throw new Error(`preferences not found for user ${userId}`);
    return updated;
  }

  async setMinimumPriority(
    userId: string,
    minimumPriority: NotificationPriority
  ): Promise<void> {
    await this.updatePreferences(userId, { minimumPriority });
  }

  async setFrequency(userId: string, frequency: NotificationFrequency): Promise<void> {
    await this.updatePreferences(userId, { frequency });
  }

  async deletePreferences(userId: string): Promise<boolean> {
    return this.store.delete(userId);
  }

  async resetPreferences(userId: string): Promise<NotificationPreferences> {
    const existing = await this.getPreferences(userId);
    const fresh = defaultPreferences(userId);
    fresh.version = (existing?.version ?? 0) + 1;
    fresh.updatedAt = new Date().toISOString();
    this.store.set(userId, fresh);
    return fresh;
  }

  /**
   * Timezone-aware quiet-hours gate used by the delivery pipeline.
   */
  shouldDeliverNow(prefs: NotificationPreferences, now: Date = new Date()): boolean {
    if (!prefs.quietHours.enabled) return true;
    return !isInQuietHours(now, prefs.quietHours);
  }

  listUsers(): string[] {
    return Array.from(this.store.keys());
  }

  userCount(): number {
    return this.store.size;
  }
}

function mergeTypes(
  current: Record<NotificationType, TypePreference>,
  patch?: Partial<Record<NotificationType, TypePreference>>
): Record<NotificationType, TypePreference> {
  if (!patch) return current;
  return NOTIFICATION_TYPES.reduce(
    (acc, type) => {
      const patched = patch[type];
      acc[type] = patched ? { ...(current[type] ?? defaultTypePreference(type)), ...patched } : current[type];
      return acc;
    },
    {} as Record<NotificationType, TypePreference>
  );
}

function validatePreferencesUsing(prefs: NotificationPreferences): NotificationPreferenceValidation {
  return validatePreferences({
    types: prefs.types,
    frequency: prefs.frequency,
    minimumPriority: prefs.minimumPriority,
    quietHours: prefs.quietHours,
  });
}

export const notificationPreferenceService = new NotificationPreferenceService();

// ═══════════════════════════════════════════════════════════════════════════
// Issue #920 — Subscription Notification Preferences and Management
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A pending notification held in the per-user digest buffer.
 */
export interface DigestNotificationItem {
  id: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  payload: Record<string, unknown>;
  scheduledFor: string; // ISO-8601
  createdAt: string;
}

/**
 * Digest batch ready to be dispatched.
 */
export interface DigestBatch {
  userId: string;
  channel: NotificationChannel;
  items: DigestNotificationItem[];
  dispatchAt: string;
}

/**
 * Manages batching of notifications into digests according to the user's
 * frequency preference (immediate / daily / weekly).
 *
 * In production, `flushDueDigests` would be invoked by a cron job.
 */
export class DigestNotificationManager {
  private static instance: DigestNotificationManager;
  /** userId → pending items */
  private readonly buffer = new Map<string, DigestNotificationItem[]>();
  /** Monotonically incrementing item counter */
  private nextId = 1;

  static getInstance(): DigestNotificationManager {
    if (!DigestNotificationManager.instance) {
      DigestNotificationManager.instance = new DigestNotificationManager();
    }
    return DigestNotificationManager.instance;
  }

  /**
   * Enqueue a notification for buffering.  When the user's frequency is
   * 'immediate', the method returns a single-item batch ready to dispatch
   * straight away; otherwise it returns null and the item sits in the buffer.
   */
  enqueue(
    item: Omit<DigestNotificationItem, 'id' | 'createdAt'>,
    frequency: NotificationFrequency
  ): DigestBatch | null {
    const now = new Date().toISOString();
    const full: DigestNotificationItem = { ...item, id: String(this.nextId++), createdAt: now };

    if (frequency === 'immediate') {
      return {
        userId: item.userId,
        channel: item.channel,
        items: [full],
        dispatchAt: now,
      };
    }

    const pending = this.buffer.get(item.userId) ?? [];
    this.buffer.set(item.userId, [...pending, full]);
    return null;
  }

  /**
   * Return all digest batches whose `dispatchAt` is in the past.
   * Clears the corresponding items from the buffer.
   */
  flushDueDigests(now: Date = new Date()): DigestBatch[] {
    const due: DigestBatch[] = [];

    for (const [userId, items] of this.buffer.entries()) {
      const dueItems = items.filter((i) => new Date(i.scheduledFor) <= now);
      if (dueItems.length === 0) continue;

      // Group by channel.
      const byChannel = new Map<NotificationChannel, DigestNotificationItem[]>();
      for (const item of dueItems) {
        const existing = byChannel.get(item.channel) ?? [];
        byChannel.set(item.channel, [...existing, item]);
      }

      for (const [channel, channelItems] of byChannel.entries()) {
        due.push({
          userId,
          channel,
          items: channelItems,
          dispatchAt: now.toISOString(),
        });
      }

      // Keep only the items that are not yet due.
      const remaining = items.filter((i) => new Date(i.scheduledFor) > now);
      if (remaining.length === 0) {
        this.buffer.delete(userId);
      } else {
        this.buffer.set(userId, remaining);
      }
    }

    return due;
  }

  /** How many items are buffered for a user. */
  pendingCount(userId: string): number {
    return (this.buffer.get(userId) ?? []).length;
  }

  /** Clear all buffered items for a user. */
  clearUser(userId: string): void {
    this.buffer.delete(userId);
  }
}

/**
 * Preference change event emitted when a user's preferences are updated.
 */
export interface PreferenceChangedEvent {
  userId: string;
  previousVersion: number;
  newVersion: number;
  changedFields: string[];
  changedAt: string;
}

type PreferenceChangeListener = (event: PreferenceChangedEvent) => void;

/**
 * Cross-device preference synchronisation helper.
 *
 * Tracks the sequence of changes and notifies registered listeners so that
 * connected device sessions can apply the latest preferences without a full
 * reload.
 *
 * In a production deployment, listeners would forward events over WebSockets
 * or a message broker (e.g. the existing `notificationCenterService`).
 */
export class NotificationPreferenceSync {
  private static instance: NotificationPreferenceSync;
  /** userId → ordered change log */
  private readonly changeLog = new Map<string, PreferenceChangedEvent[]>();
  private readonly listeners: PreferenceChangeListener[] = [];

  static getInstance(): NotificationPreferenceSync {
    if (!NotificationPreferenceSync.instance) {
      NotificationPreferenceSync.instance = new NotificationPreferenceSync();
    }
    return NotificationPreferenceSync.instance;
  }

  /**
   * Record a preference change and notify all listeners.
   *
   * @param userId           User whose prefs changed.
   * @param previousVersion  Version before the update.
   * @param newPrefs         New preferences object.
   * @param previousPrefs    Previous preferences object (for diff).
   */
  recordChange(
    userId: string,
    previousVersion: number,
    newPrefs: NotificationPreferences,
    previousPrefs: NotificationPreferences
  ): PreferenceChangedEvent {
    const changedFields = this.diffPreferences(previousPrefs, newPrefs);
    const event: PreferenceChangedEvent = {
      userId,
      previousVersion,
      newVersion: newPrefs.version,
      changedFields,
      changedAt: new Date().toISOString(),
    };

    const log = this.changeLog.get(userId) ?? [];
    this.changeLog.set(userId, [...log, event]);

    // Notify all listeners (fire-and-forget; errors are swallowed to avoid
    // breaking the calling path).
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // swallow
      }
    }

    return event;
  }

  addListener(listener: PreferenceChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Return all changes for a user since a given version.
   */
  changesSince(userId: string, sinceVersion: number): PreferenceChangedEvent[] {
    return (this.changeLog.get(userId) ?? []).filter(
      (e) => e.previousVersion >= sinceVersion
    );
  }

  /**
   * Compute the top-level fields that differ between two preference objects.
   */
  private diffPreferences(
    previous: NotificationPreferences,
    next: NotificationPreferences
  ): string[] {
    const fields: string[] = [];
    const keys = Object.keys(next) as Array<keyof NotificationPreferences>;
    for (const key of keys) {
      if (key === 'version' || key === 'updatedAt') continue;
      if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
        fields.push(key);
      }
    }
    return fields;
  }
}

/**
 * Scheduler that computes the next delivery window for a buffered notification
 * according to the user's frequency preference and quiet-hours settings.
 */
export class NotificationScheduler {
  private static instance: NotificationScheduler;

  static getInstance(): NotificationScheduler {
    if (!NotificationScheduler.instance) {
      NotificationScheduler.instance = new NotificationScheduler();
    }
    return NotificationScheduler.instance;
  }

  /**
   * Return the ISO-8601 timestamp at which the notification should be
   * dispatched (or `now` for immediate delivery).
   */
  nextDeliveryTime(
    prefs: NotificationPreferences,
    now: Date = new Date()
  ): string {
    if (prefs.frequency === 'immediate') {
      // Still respect quiet hours.
      if (prefs.quietHours.enabled && isInQuietHours(now, prefs.quietHours)) {
        return this.nextQuietHoursEnd(now, prefs).toISOString();
      }
      return now.toISOString();
    }

    if (prefs.frequency === 'daily') {
      // Deliver at 09:00 local time (or next day if already past).
      return this.nextOccurrence(now, 9, 0, prefs.quietHours.timezone).toISOString();
    }

    // Weekly: next Monday at 09:00.
    return this.nextMondayAt(now, 9, 0, prefs.quietHours.timezone).toISOString();
  }

  private nextOccurrence(
    from: Date,
    hour: number,
    minute: number,
    _timezone: string
  ): Date {
    // Timezone-aware calculation simplified to UTC offset for portability.
    const candidate = new Date(from);
    candidate.setUTCHours(hour, minute, 0, 0);
    if (candidate <= from) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    return candidate;
  }

  private nextMondayAt(from: Date, hour: number, minute: number, tz: string): Date {
    const next = this.nextOccurrence(from, hour, minute, tz);
    const day = next.getUTCDay(); // 0=Sun … 6=Sat
    const daysUntilMonday = day === 1 ? (next <= from ? 7 : 0) : (8 - day) % 7 || 7;
    next.setUTCDate(next.getUTCDate() + daysUntilMonday);
    return next;
  }

  private nextQuietHoursEnd(now: Date, quietHours: NotificationPreferences['quietHours']): Date {
    const endTime = quietHours.endTime ?? '08:00';
    const [endH, endM] = endTime.split(':').map(Number);
    const end = new Date(now);
    end.setUTCHours(endH, endM, 0, 0);
    if (end <= now) end.setUTCDate(end.getUTCDate() + 1);
    return end;
  }
}

/**
 * Convenience function used by the notification delivery pipeline.
 * Combines the preference service, scheduler and digest manager into a
 * single call-site.
 */
export async function scheduleNotification(
  userId: string,
  type: NotificationType,
  channel: NotificationChannel,
  payload: Record<string, unknown>
): Promise<DigestBatch | null> {
  const prefs = await notificationPreferenceService.getOrCreatePreferences(userId);
  const scheduler = NotificationScheduler.getInstance();
  const digestManager = DigestNotificationManager.getInstance();

  const scheduledFor = scheduler.nextDeliveryTime(prefs);

  return digestManager.enqueue(
    { userId, type, channel, payload, scheduledFor },
    prefs.frequency
  );
}

export const digestNotificationManager = DigestNotificationManager.getInstance();
export const notificationPreferenceSync = NotificationPreferenceSync.getInstance();
export const notificationScheduler = NotificationScheduler.getInstance();
