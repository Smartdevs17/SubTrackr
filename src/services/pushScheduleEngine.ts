/**
 * PushScheduleEngine — timezone-aware delivery scheduling with quiet hours,
 * priority tiers, and A/B test variant selection.
 *
 * DigestBuilder — batches low-priority notifications into daily/weekly digests.
 */

export type NotificationPriority = 'critical' | 'informative' | 'marketing';

export type OptInCategory = 'billing' | 'product' | 'marketing' | 'security';

export interface ScheduledNotification {
  id: string;
  userId: string;
  priority: NotificationPriority;
  category: OptInCategory;
  title: string;
  body: string;
  /** ISO-8601 — when to deliver (after quiet-hours / window optimization) */
  deliverAt: string;
  abVariant?: 'A' | 'B';
  metadata?: Record<string, string>;
}

export interface DigestEntry {
  userId: string;
  notifications: { title: string; body: string; category: OptInCategory }[];
  scheduledFor: string; // ISO-8601
  frequency: 'daily' | 'weekly';
}

export interface OpenRateRecord {
  userId: string;
  hour: number; // 0-23 UTC
  openCount: number;
  sendCount: number;
}

// ─── PushScheduleEngine ───────────────────────────────────────────────────────

export class PushScheduleEngine {
  /** In-memory open rate history — replace with DB in production */
  private openRates = new Map<string, OpenRateRecord[]>();

  /**
   * Schedule a notification, respecting quiet hours and delivery window.
   * Critical notifications bypass quiet hours.
   */
  schedule(
    userId: string,
    priority: NotificationPriority,
    category: OptInCategory,
    title: string,
    body: string,
    quietHours: { enabled: boolean; startHour: number; endHour: number; timezone: string },
    optInCategories: OptInCategory[],
    abVariant?: 'A' | 'B'
  ): ScheduledNotification | null {
    // Check opt-in for non-critical categories
    if (priority !== 'critical' && !optInCategories.includes(category)) {
      return null;
    }

    let deliverAt = new Date();

    // Critical bypasses quiet hours; others must wait
    if (priority !== 'critical' && quietHours.enabled) {
      deliverAt = this._adjustForQuietHours(deliverAt, quietHours);
    }

    // Optimize delivery window based on historical open rates (non-critical only)
    if (priority === 'informative' || priority === 'marketing') {
      const bestHour = this._getBestDeliveryHour(userId);
      if (bestHour !== null) {
        deliverAt = this._setHour(deliverAt, bestHour);
        // Re-check quiet hours after window optimization
        if (quietHours.enabled) {
          deliverAt = this._adjustForQuietHours(deliverAt, quietHours);
        }
      }
    }

    return {
      id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      userId,
      priority,
      category,
      title: abVariant === 'B' ? `${title} ✨` : title,
      body,
      deliverAt: deliverAt.toISOString(),
      abVariant,
    };
  }

  /**
   * Escalate priority for overdue payments.
   * If a billing notification has been pending >24h, escalate to critical.
   */
  escalateOverdue(
    notification: ScheduledNotification,
    overdueHours: number
  ): ScheduledNotification {
    if (notification.category === 'billing' && overdueHours >= 24) {
      return { ...notification, priority: 'critical', deliverAt: new Date().toISOString() };
    }
    return notification;
  }

  /** Record open event to improve future delivery timing */
  recordOpen(userId: string, deliveredAt: Date): void {
    const hour = deliveredAt.getUTCHours();
    const records = this.openRates.get(userId) ?? [];
    const existing = records.find((r) => r.hour === hour);
    if (existing) {
      existing.openCount += 1;
    } else {
      records.push({ userId, hour, openCount: 1, sendCount: 1 });
    }
    this.openRates.set(userId, records);
  }

  recordSend(userId: string, deliveredAt: Date): void {
    const hour = deliveredAt.getUTCHours();
    const records = this.openRates.get(userId) ?? [];
    const existing = records.find((r) => r.hour === hour);
    if (existing) {
      existing.sendCount += 1;
    } else {
      records.push({ userId, hour, openCount: 0, sendCount: 1 });
    }
    this.openRates.set(userId, records);
  }

  getOpenRates(userId: string): OpenRateRecord[] {
    return this.openRates.get(userId) ?? [];
  }

  private _getBestDeliveryHour(userId: string): number | null {
    const records = this.openRates.get(userId);
    if (!records || records.length === 0) return null;
    let best: OpenRateRecord | null = null;
    let bestRate = -1;
    for (const r of records) {
      const rate = r.sendCount > 0 ? r.openCount / r.sendCount : 0;
      if (rate > bestRate) {
        bestRate = rate;
        best = r;
      }
    }
    return best?.hour ?? null;
  }

  private _adjustForQuietHours(
    date: Date,
    qh: { startHour: number; endHour: number; timezone: string }
  ): Date {
    if (!isWithinQuietHoursDate(date, { ...qh, enabled: true })) return date;
    // Push to the end of the quiet period, read in the subscriber's timezone.
    return utcInstantForLocalHour(date, qh.endHour, qh.timezone);
  }

  private _setHour(date: Date, hour: number): Date {
    const result = new Date(date);
    result.setUTCHours(hour, 0, 0, 0);
    if (result < date) {
      result.setUTCDate(result.getUTCDate() + 1);
    }
    return result;
  }
}

// ─── Timezone helpers (Issue #1744) ──────────────────────────────────────────

export interface QuietHoursWindow {
  enabled: boolean;
  startHour: number; // 0-23, local to `timezone`
  endHour: number; // 0-23, local to `timezone`
  timezone: string; // IANA zone, e.g. 'Europe/Berlin'
}

function timeZoneOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const truncated = Math.floor(at.getTime() / 1000) * 1000;
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return asUtc - truncated;
}

/** The wall-clock hour (0-23) `date` falls on in `timezone`, or UTC if unknown. */
export function localHourOf(date: Date, timezone: string): number {
  try {
    const hour = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(date);
    return Number(hour) % 24;
  } catch {
    return date.getUTCHours();
  }
}

/**
 * The first UTC instant at or after `date` whose wall-clock time in
 * `timezone` is `hour:00`. Two passes handle DST offsets correctly.
 */
export function utcInstantForLocalHour(date: Date, hour: number, timezone: string): Date {
  try {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string): number => Number(local.find((p) => p.type === type)?.value ?? '0');

    const base = Date.UTC(get('year'), get('month') - 1, get('day'), hour);
    let candidate = base - timeZoneOffsetMs(new Date(base), timezone);
    candidate = base - timeZoneOffsetMs(new Date(candidate), timezone);
    if (candidate <= date.getTime()) {
      const nextDay = new Date(candidate);
      const shifted = Date.UTC(
        nextDay.getUTCFullYear(),
        nextDay.getUTCMonth(),
        nextDay.getUTCDate() + 1,
        hour
      );
      candidate = shifted - timeZoneOffsetMs(new Date(shifted), timezone);
    }
    return new Date(candidate);
  } catch {
    const fallback = new Date(date);
    fallback.setUTCHours(hour, 0, 0, 0);
    if (fallback <= date) fallback.setUTCDate(fallback.getUTCDate() + 1);
    return fallback;
  }
}

/** True when `date` sits inside the quiet window, evaluated in `timezone`. */
export function isWithinQuietHoursDate(date: Date, qh: QuietHoursWindow): boolean {
  if (!qh.enabled || qh.startHour === qh.endHour) return false;
  const hour = localHourOf(date, qh.timezone);
  return qh.startHour < qh.endHour
    ? hour >= qh.startHour && hour < qh.endHour
    : hour >= qh.startHour || hour < qh.endHour;
}

/** The next UTC instant outside the quiet window (or `date` when outside). */
export function nextQuietHoursEnd(date: Date, qh: QuietHoursWindow): Date {
  if (!isWithinQuietHoursDate(date, qh)) return date;
  return utcInstantForLocalHour(date, qh.endHour, qh.timezone);
}

// ─── DigestBuilder ────────────────────────────────────────────────────────────

/**
 * The UTC instant a digest for items buffered at `now` should go out (Issue
 * #1746): 09:00 UTC on the next day (daily) or next Monday (weekly).
 */
export function digestWindowFor(frequency: 'daily' | 'weekly', now: Date = new Date()): Date {
  const window = new Date(now.getTime());
  if (frequency === 'daily') {
    window.setUTCHours(9, 0, 0, 0);
    if (window.getTime() <= now.getTime()) {
      window.setUTCDate(window.getUTCDate() + 1);
    }
    return window;
  }
  // Weekly: next Monday at 09:00 UTC (strictly after `now`).
  const daysUntilMonday = (8 - window.getUTCDay()) % 7 || 7;
  window.setUTCDate(window.getUTCDate() + daysUntilMonday);
  window.setUTCHours(9, 0, 0, 0);
  if (window.getTime() <= now.getTime()) {
    window.setUTCDate(window.getUTCDate() + 7);
  }
  return window;
}

export class DigestBuilder {
  private queue = new Map<string, { title: string; body: string; category: OptInCategory }[]>();

  /** Queue a notification for digest instead of immediate delivery */
  enqueue(userId: string, title: string, body: string, category: OptInCategory): void {
    const existing = this.queue.get(userId) ?? [];
    existing.push({ title, body, category });
    this.queue.set(userId, existing);
  }

  /** Build a digest for the user, scheduled at the next daily/weekly window */
  buildDigest(userId: string, frequency: 'daily' | 'weekly'): DigestEntry | null {
    const items = this.queue.get(userId);
    if (!items || items.length === 0) return null;

    const scheduledFor = new Date();
    if (frequency === 'daily') {
      scheduledFor.setUTCDate(scheduledFor.getUTCDate() + 1);
      scheduledFor.setUTCHours(9, 0, 0, 0); // 9am UTC next day
    } else {
      const daysUntilMonday = (8 - scheduledFor.getUTCDay()) % 7 || 7;
      scheduledFor.setUTCDate(scheduledFor.getUTCDate() + daysUntilMonday);
      scheduledFor.setUTCHours(9, 0, 0, 0);
    }

    this.queue.delete(userId); // consume queue
    return {
      userId,
      notifications: items,
      scheduledFor: scheduledFor.toISOString(),
      frequency,
    };
  }

  getPendingCount(userId: string): number {
    return this.queue.get(userId)?.length ?? 0;
  }

  /** Drop buffered items (all users, or just one). */
  clear(userId?: string): void {
    if (userId === undefined) this.queue.clear();
    else this.queue.delete(userId);
  }
}

export const pushScheduleEngine = new PushScheduleEngine();
export const digestBuilder = new DigestBuilder();
